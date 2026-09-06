import { useAtomValue } from "@effect/atom-react";
import {
  createComposerDraftSync,
  type ComposerDraftSyncStatus,
} from "@t3tools/client-runtime/composer-draft-sync";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ComposerContextId,
  WS_METHODS,
  type EnvironmentId,
  type SharedComposerDraftContent,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { connectionAtomRuntime } from "../connection/runtime";
import { importAttachment } from "../lib/composerContextClipboard";
import { uploadedComposerContext } from "../lib/composerContext";
import {
  removePersistedComposerAttachmentFile,
  type DraftComposerAttachment,
} from "../lib/composerImages";
import { uuidv4 } from "../lib/uuid";
import { appAtomRegistry } from "./atom-registry";
import { serverEnvironment } from "./server";
import { environmentSession } from "./session";
import {
  applySyncedComposerDraftContent,
  composerDraftsAtom,
  getComposerDraftSnapshot,
  preserveComposerDraftConflict,
  setComposerDraftSyncCheckpoint,
  waitForComposerDraftsLoaded,
  scheduleUnusedComposerAttachmentCleanup,
  type ComposerDraft,
} from "./use-composer-drafts";

const subscription = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  tag: WS_METHODS.composerDraftSubscribe,
  label: "mobile:composer-draft-sync",
  idleTtlMs: 0,
});
const update = createEnvironmentRpcCommand(connectionAtomRuntime, {
  tag: WS_METHODS.composerDraftUpdate,
  label: "mobile:composer-draft-sync:update",
});

export function sharedMobileComposerDraft(
  draft: ComposerDraft,
  environmentId: EnvironmentId,
): SharedComposerDraftContent | null | undefined {
  if (
    draft.attachments.some(
      (file) => !file.uploadedAttachmentId || file.uploadEnvironmentId !== environmentId,
    )
  )
    return undefined;
  if (!draft.text && draft.attachments.length === 0) return null;
  const attachments = draft.attachments.map((file) => ({
    id: file.uploadedAttachmentId!,
    type: file.type,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  }));
  return {
    text: draft.text,
    attachments,
    context: uploadedComposerContext(draft.context, draft.attachments, attachments),
  };
}

export function useComposerDraftSync(
  draftKey: string | null,
  environmentId: EnvironmentId | undefined,
) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId ?? null));
  const enabled = config?.environment.capabilities.composerDraftSync === true;
  const [status, setStatus] = useState<ComposerDraftSyncStatus | null>(null);
  useEffect(() => {
    if (!enabled || !draftKey || !environmentId || draftKey.startsWith("pending-task:")) return;
    const prefix = `${environmentId}:`;
    const key = draftKey.startsWith(`new-task:${prefix}`)
      ? `project:${draftKey.slice(`new-task:${prefix}`.length)}`
      : draftKey.startsWith(prefix)
        ? `thread:${draftKey.slice(prefix.length)}`
        : null;
    if (!key) return;
    let stopped = false;
    let cleanup = () => {};
    const abort = new AbortController();
    setStatus("connecting");
    void waitForComposerDraftsLoaded()
      .then(() => {
        if (stopped) return;
        let applying = false;
        const read = () =>
          sharedMobileComposerDraft(getComposerDraftSnapshot(draftKey), environmentId);
        let previous = getComposerDraftSnapshot(draftKey);
        const sync = createComposerDraftSync({
          key,
          writerId: uuidv4(),
          checkpoint: getComposerDraftSnapshot(draftKey).syncCheckpoint,
          read,
          status: setStatus,
          saveCheckpoint: (checkpoint) => setComposerDraftSyncCheckpoint(draftKey, checkpoint),
          update: async (input) => {
            const result = await update.run(appAtomRegistry, { environmentId, input });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            return result.value;
          },
          preserveConflict: async () => {
            await preserveComposerDraftConflict(draftKey, uuidv4());
            Alert.alert(
              "Draft updated on another device",
              "Your local edits are safe in Stashed prompts.",
            );
          },
          apply: async (content, canCommit) => {
            const existing = getComposerDraftSnapshot(draftKey).attachments;
            const attachments: DraftComposerAttachment[] = [];
            const created: DraftComposerAttachment[] = [];
            try {
              for (const attachment of content?.attachments ?? []) {
                const local = existing.find(
                  (file) =>
                    file.uploadedAttachmentId === attachment.id &&
                    file.uploadEnvironmentId === environmentId,
                );
                if (local) {
                  attachments.push(local);
                  continue;
                }
                if (attachment.type !== "image" && attachment.type !== "file")
                  throw new Error("Unsupported draft attachment");
                const imported = await importAttachment(
                  {
                    ...attachment,
                    version: 1,
                    kind: attachment.type === "image" ? "image" : "file",
                    contextId: ComposerContextId.make(attachment.id),
                    label: attachment.name,
                    attachmentId: attachment.id,
                  },
                  environmentId,
                  abort.signal,
                );
                const file = {
                  ...imported,
                  id: attachment.id,
                  uploadedAttachmentId: attachment.id,
                  uploadEnvironmentId: environmentId,
                };
                attachments.push(file);
                created.push(file);
              }
              if (!canCommit()) return false;
              // Retained local files keep their local ids; bind incoming records to those ids.
              const context = uploadedComposerContext(
                content?.context,
                content?.attachments ?? [],
                attachments,
              );
              applying = true;
              applySyncedComposerDraftContent(draftKey, {
                text: content?.text ?? "",
                context,
                attachments,
              });
              scheduleUnusedComposerAttachmentCleanup(existing);
              previous = getComposerDraftSnapshot(draftKey);
              created.length = 0;
              return true;
            } finally {
              applying = false;
              await Promise.all(
                created.map((file) =>
                  file.fileUri
                    ? removePersistedComposerAttachmentFile(file.fileUri)
                    : Promise.resolve(),
                ),
              );
            }
          },
        });
        const stopLocal = appAtomRegistry.subscribe(composerDraftsAtom, () => {
          const next = getComposerDraftSnapshot(draftKey);
          if (
            next.text === previous.text &&
            next.context === previous.context &&
            next.attachments === previous.attachments
          )
            return;
          previous = next;
          if (!applying) sync.localChanged();
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
        cleanup = () => {
          stopLocal();
          stopRemote();
          stopConnection();
          void sync.dispose();
        };
      })
      .catch(() => setStatus("offline"));
    return () => {
      stopped = true;
      abort.abort();
      cleanup();
    };
  }, [draftKey, environmentId, enabled]);
  return enabled ? status : null;
}
