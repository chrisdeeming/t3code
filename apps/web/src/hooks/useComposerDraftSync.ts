import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createComposerDraftSync,
  type ComposerDraftSyncStatus,
} from "@t3tools/client-runtime/composer-draft-sync";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  executeAtomQuery,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  WS_METHODS,
  type EnvironmentId,
  type SharedComposerDraftContent,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import {
  useComposerDraftStore,
  type ComposerThreadTarget,
  type ComposerThreadDraftState,
  type ComposerImageAttachment,
  type ComposerFileAttachment,
} from "../composerDraftStore";
import { MAX_STASH_ENTRIES, usePromptStashStore } from "../promptStashStore";
import { buildMessageContext } from "../lib/composerContextRecords";
import {
  getUploadedAttachments,
  readAttachmentUpload,
  useAttachmentUploadStore,
} from "../lib/attachmentUploadQueue";
import { readFileAsDataUrl } from "../components/ChatView.logic";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { assetEnvironment } from "../state/assets";
import { serverEnvironment } from "../state/server";
import { environmentSession, readPreparedConnection } from "../state/session";
import { toastManager } from "../components/ui/toast";

const subscription = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  tag: WS_METHODS.composerDraftSubscribe,
  label: "web:composer-draft-sync",
  idleTtlMs: 0,
});
const update = createEnvironmentRpcCommand(connectionAtomRuntime, {
  tag: WS_METHODS.composerDraftUpdate,
  label: "web:composer-draft-sync:update",
});

export function sharedWebComposerDraft(
  draft: ComposerThreadDraftState | null,
  environmentId: EnvironmentId,
): SharedComposerDraftContent | null | undefined {
  if (!draft || (!draft.prompt && !draft.images.length && !draft.files.length)) return null;
  const files = [...draft.images, ...draft.files];
  const attachments = getUploadedAttachments({ environmentId, images: files });
  if (!attachments) return undefined;
  return {
    text: draft.prompt,
    attachments,
    context: buildMessageContext({
      syncedContext: draft.syncedContext,
      terminalContexts: draft.terminalContexts,
      reviewComments: draft.reviewComments,
      previewAnnotations: draft.previewAnnotations,
      attachments: files.map((attachment, index) => ({
        attachment,
        attachmentId: attachments[index]!.id,
      })),
    }),
  };
}

export function useComposerDraftSync(target: ComposerThreadTarget, environmentId: EnvironmentId) {
  const localDraftId = typeof target === "string" ? target : null;
  const targetThreadId = typeof target === "string" ? null : target.threadId;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const enabled = config?.environment.capabilities.composerDraftSync === true;
  const projectId = useComposerDraftStore((store) =>
    typeof target === "string" ? store.getDraftSession(target)?.projectId : undefined,
  );
  const key =
    typeof target === "string"
      ? projectId
        ? `project:${projectId}`
        : null
      : `thread:${target.threadId}`;
  const [status, setStatus] = useState<ComposerDraftSyncStatus>("connecting");
  useEffect(() => {
    if (!enabled || !key) return;
    const target = localDraftId ?? scopeThreadRef(environmentId, targetThreadId!);
    const abort = new AbortController();
    const readDraft = () => useComposerDraftStore.getState().getComposerDraft(target);
    const read = () => sharedWebComposerDraft(readDraft(), environmentId);
    let previous = readDraft();
    let applying = false;
    setStatus("connecting");
    const sync = createComposerDraftSync({
      key,
      writerId: randomUUID(),
      checkpoint: readDraft()?.syncCheckpoint,
      read,
      status: setStatus,
      saveCheckpoint: (syncCheckpoint) => {
        const current = readDraft()?.syncCheckpoint;
        if (
          current?.revision !== syncCheckpoint.revision ||
          current?.dirty !== syncCheckpoint.dirty
        )
          useComposerDraftStore.getState().patchSyncedDraft(target, { syncCheckpoint });
      },
      update: async (input) => {
        const result = await update.run(appAtomRegistry, { environmentId, input });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        return result.value;
      },
      preserveConflict: async () => {
        const draft = readDraft();
        if (!draft) return;
        if (usePromptStashStore.getState().entries.length >= MAX_STASH_ENTRIES)
          throw new Error("Make room in stashed prompts first");
        const files = draft.files.map((file) => {
          const upload = readAttachmentUpload(file.id);
          const attachmentId =
            file.uploadedAttachmentId ??
            (upload?.status === "ready" ? upload.attachmentId : undefined);
          if (!attachmentId) throw new Error("Wait for local attachments to finish uploading");
          return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            attachmentId,
            environmentId,
          };
        });
        const attachments = await Promise.all(
          draft.images.map(async (image) => ({
            id: image.id,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl: await readFileAsDataUrl(image.file),
          })),
        );
        const records = buildMessageContext({
          syncedContext: draft.syncedContext,
          terminalContexts: draft.terminalContexts,
          reviewComments: draft.reviewComments,
          previewAnnotations: draft.previewAnnotations,
        })?.records;
        const saved = usePromptStashStore.getState().stashEntry({
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          prompt: draft.prompt,
          attachments,
          files,
          droppedImageNames: [],
          ...(records ? { records } : {}),
        });
        if (!saved.durable) throw new Error("The conflicting draft could not be saved safely");
        toastManager.add({
          type: "info",
          title: "Draft updated on another device",
          description: "Your local edits are safe in Stashed prompts.",
        });
      },
      apply: async (content, canCommit) => {
        const current = readDraft();
        const previousAttachments = [...(current?.images ?? []), ...(current?.files ?? [])];
        const images: ComposerImageAttachment[] = [];
        const files: ComposerFileAttachment[] = [];
        const createdUrls: string[] = [];
        const localIdByServerId = new Map<string, string>();
        try {
          for (const attachment of content?.attachments ?? []) {
            const existing = previousAttachments.find((file) => {
              const upload = readAttachmentUpload(file.id);
              return (
                upload?.status === "ready" &&
                upload.environmentId === environmentId &&
                upload.attachmentId === attachment.id
              );
            });
            if (existing) {
              localIdByServerId.set(attachment.id, existing.id);
              if (existing.type === "image")
                images.push({
                  ...existing,
                  uploadedAttachmentId: attachment.id,
                  uploadEnvironmentId: environmentId,
                });
              else files.push(existing);
              continue;
            }
            localIdByServerId.set(attachment.id, attachment.id);
            if (attachment.type === "file") {
              files.push({
                ...attachment,
                type: "file",
                file: null,
                uploadedAttachmentId: attachment.id,
                uploadEnvironmentId: environmentId,
              });
            } else if (attachment.type === "image") {
              const connection = readPreparedConnection(environmentId);
              if (!connection) throw new Error("Reconnect to load the draft attachments");
              const result = await executeAtomQuery(
                appAtomRegistry,
                assetEnvironment.createUrl({
                  environmentId,
                  input: {
                    resource: {
                      _tag: "attachment",
                      attachmentId: attachment.id,
                      fileName: attachment.name,
                    },
                  },
                }),
                { refresh: true, reportFailure: false },
              );
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              const url = resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl);
              if (!url) throw new Error("Draft attachment URL unavailable");
              const response = await fetch(url, { signal: abort.signal });
              if (!response.ok) throw new Error("Could not load a draft image");
              const blob = await response.blob();
              if (blob.size !== attachment.sizeBytes) throw new Error("Draft image size changed");
              const file = new File([blob], attachment.name, { type: attachment.mimeType });
              const previewUrl = URL.createObjectURL(file);
              createdUrls.push(previewUrl);
              images.push({
                ...attachment,
                type: "image",
                file,
                previewUrl,
                uploadedAttachmentId: attachment.id,
                uploadEnvironmentId: environmentId,
              });
            } else throw new Error("Unsupported draft attachment");
          }
          if (!canCommit()) return false;
          const syncedContext = content?.context
            ? {
                ...content.context,
                records: content.context.records.map((record) =>
                  "attachmentId" in record
                    ? {
                        ...record,
                        attachmentId:
                          localIdByServerId.get(record.attachmentId) ?? record.attachmentId,
                      }
                    : record,
                ),
              }
            : undefined;
          applying = true;
          useAttachmentUploadStore.setState((state) => ({
            uploadsByImageId: {
              ...state.uploadsByImageId,
              ...Object.fromEntries(
                (content?.attachments ?? []).map((file) => [
                  localIdByServerId.get(file.id)!,
                  { status: "ready" as const, environmentId, attachmentId: file.id },
                ]),
              ),
            },
          }));
          useComposerDraftStore.getState().patchSyncedDraft(target, {
            prompt: content?.text ?? "",
            syncedContext,
            images,
            files,
            terminalContexts: [],
            reviewComments: [],
            previewAnnotations: [],
            persistedAttachments: [],
            nonPersistedImageIds: [],
          });
          previous = readDraft();
          for (const attachment of previousAttachments) {
            if (
              attachment.type === "image" &&
              !images.some((image) => image.previewUrl === attachment.previewUrl)
            ) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
          }
          createdUrls.length = 0;
          return true;
        } finally {
          applying = false;
          for (const url of createdUrls) URL.revokeObjectURL(url);
        }
      },
    });
    const stopLocal = useComposerDraftStore.subscribe(() => {
      const next = readDraft();
      if (
        next?.prompt === previous?.prompt &&
        next?.images === previous?.images &&
        next?.files === previous?.files &&
        next?.terminalContexts === previous?.terminalContexts &&
        next?.reviewComments === previous?.reviewComments &&
        next?.previewAnnotations === previous?.previewAnnotations &&
        next?.syncedContext === previous?.syncedContext
      )
        return;
      previous = next;
      if (!applying) sync.localChanged();
    });
    const stopUploads = useAttachmentUploadStore.subscribe((state, before) => {
      const files = [...(readDraft()?.images ?? []), ...(readDraft()?.files ?? [])];
      if (
        !applying &&
        files.some(
          (file) =>
            state.uploadsByImageId[file.id]?.status === "ready" &&
            state.uploadsByImageId[file.id] !== before.uploadsByImageId[file.id],
        )
      )
        sync.localChanged();
    });
    const stopRemote = appAtomRegistry.subscribe(
      subscription({ environmentId, input: { key } }),
      (result) => {
        if (result._tag === "Success") sync.receive(result.value);
        else if (result._tag === "Failure") sync.disconnected();
      },
      { immediate: true },
    );
    const stopConnection = appAtomRegistry.subscribe(
      environmentSession.preparedConnectionValueAtom(environmentId),
      (connection) => {
        if (connection._tag === "None") sync.disconnected();
      },
      { immediate: true },
    );
    return () => {
      abort.abort();
      stopLocal();
      stopUploads();
      stopRemote();
      stopConnection();
      void sync.dispose();
    };
  }, [enabled, environmentId, key, localDraftId, targetThreadId]);
  return config === null ? "connecting" : enabled ? status : null;
}
