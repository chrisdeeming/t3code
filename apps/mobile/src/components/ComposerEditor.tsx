import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { encodeComposerContextFragment } from "@t3tools/shared/composerContextClipboard";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { ComposerEditor as NativeComposerEditor } from "../native/T3ComposerEditor";
import type { ComposerEditorProps as NativeComposerEditorProps } from "../native/T3ComposerEditor";
import {
  appendComposerDraftAttachments,
  getComposerDraftSnapshot,
  insertComposerDraftContext,
  rememberComposerDraftSelection,
  setComposerContextImporting,
  stashComposerDraft,
  useComposerDraft,
} from "../state/use-composer-drafts";
import {
  importComposerContextClipboard,
  readComposerContextClipboard,
  type NativeContextClipboard,
} from "../lib/composerContextClipboard";
import { ComposerContextSheet } from "./ComposerContextSheet";
import { AppText as Text } from "./AppText";
import { ComposerStashSheet } from "./ComposerStashSheet";
import { uuidv4 } from "../lib/uuid";

export type ComposerEditorProps = NativeComposerEditorProps & {
  readonly draftKey?: string | null;
  readonly environmentId?: EnvironmentId;
};

export function ComposerEditor({ draftKey, environmentId, ...props }: ComposerEditorProps) {
  const draft = useComposerDraft(draftKey ?? null);
  const [selected, setSelected] = useState<{ source: string; start: number; end: number } | null>(
    null,
  );
  const [showContextList, setShowContextList] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const stash = async () => {
    if (!draftKey || importing || props.readOnly || props.editable === false) return;
    try {
      if (!(await stashComposerDraft(draftKey, uuidv4())))
        Alert.alert(
          "Could not stash prompt",
          "The draft is empty or this thread already has 20 stashed prompts.",
        );
    } catch {
      Alert.alert(
        "Could not save stash",
        "Your prompt remains available in memory. Try again before closing the app.",
      );
    }
  };
  const importRef = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(
    () => () => {
      importRef.current?.abort();
    },
    [draftKey],
  );
  const pasteContext = async (clipboard: NativeContextClipboard) => {
    if (!draftKey || importRef.current || props.readOnly || props.editable === false) return;
    const controller = new AbortController();
    importRef.current = controller;
    setImporting(true);
    setComposerContextImporting(draftKey, true);
    try {
      const result = await importComposerContextClipboard(
        clipboard,
        getComposerDraftSnapshot(draftKey).attachments.length,
        controller.signal,
        getComposerDraftSnapshot(draftKey).context?.records.length ?? 0,
      );
      if (!result) {
        insertComposerDraftContext(draftKey, {
          text: clipboard.text,
          context: { version: 1, records: [] },
        });
        return;
      }
      const rejected = appendComposerDraftAttachments(draftKey, result.attachments);
      const ids = new Set(
        getComposerDraftSnapshot(draftKey).attachments.map((attachment) => attachment.id),
      );
      insertComposerDraftContext(draftKey, {
        text: result.text,
        context: {
          version: 1,
          records: result.context.records.filter(
            (record) => !("attachmentId" in record) || ids.has(record.attachmentId),
          ),
        },
      });
      if (result.failures.length > 0 || rejected > 0)
        Alert.alert(
          "Some attachments could not be copied",
          "Reconnect to the source environment and copy them again. References without their files are marked unavailable.",
        );
    } catch (error) {
      if (!controller.signal.aborted)
        Alert.alert(
          "Could not paste context",
          error instanceof Error ? error.message : "Try copying again.",
        );
    } finally {
      setComposerContextImporting(draftKey, false);
      importRef.current = null;
      setImporting(false);
    }
  };
  const clipboardFragment = useMemo(
    () =>
      environmentId && draft.context
        ? encodeComposerContextFragment({
            version: 1,
            source: { environmentId },
            records: draft.context.records.map((record) => {
              if (!("attachmentId" in record)) return record;
              const attachment = draft.attachments.find(
                (entry) => entry.id === record.attachmentId,
              );
              return {
                ...record,
                attachmentId:
                  attachment?.uploadEnvironmentId === environmentId
                    ? (attachment.uploadedAttachmentId ?? record.attachmentId)
                    : record.attachmentId,
              };
            }),
          })
        : "",
    [environmentId, draft.context, draft.attachments],
  );
  const references = collectComposerContextReferences(props.value);
  const selectedReference = selected
    ? collectComposerContextReferences(selected.source)[0]
    : undefined;
  const record = draft.context?.records.find(
    (entry) => entry.contextId === selectedReference?.contextId,
  );
  return (
    <>
      <NativeComposerEditor
        {...props}
        readOnly={props.readOnly || importing}
        onSubmit={importing ? undefined : props.onSubmit}
        clipboardFragment={clipboardFragment}
        onPasteContext={(clipboard) => void pasteContext(clipboard)}
        context={draft.context}
        onContextPress={setSelected}
        onSelectionChange={(selection) => {
          if (draftKey) rememberComposerDraftSelection(draftKey, props.value, selection);
          props.onSelectionChange?.(selection);
        }}
      />
      {importing ? (
        <Text className="py-2 text-xs text-foreground-muted">Copying context…</Text>
      ) : null}
      {draftKey && props.scrollEnabled !== false ? (
        <View className="flex-row gap-4">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void readComposerContextClipboard()
                .then(pasteContext)
                .catch(() =>
                  Alert.alert("Could not read clipboard", "Copy the context again and retry."),
                );
            }}
            disabled={importing || props.readOnly || props.editable === false}
            className="py-2"
          >
            <Text className="text-xs text-foreground-muted">Paste context</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void stash()}
            disabled={importing || props.readOnly || props.editable === false}
            className="py-2"
          >
            <Text className="text-xs text-foreground-muted">Stash prompt</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowStash(true)}
            disabled={importing || props.readOnly || props.editable === false}
            className="py-2"
          >
            <Text className="text-xs text-foreground-muted">Stashed prompts</Text>
          </Pressable>
        </View>
      ) : null}
      {showStash && draftKey ? (
        <ComposerStashSheet draftKey={draftKey} onClose={() => setShowStash(false)} />
      ) : null}
      {references.length > 0 && props.scrollEnabled !== false ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showContextList }}
            onPress={() => setShowContextList((value) => !value)}
            className="py-2"
          >
            <Text className="text-xs text-foreground-muted">
              Review context ({references.length})
            </Text>
          </Pressable>
          {showContextList ? (
            <ScrollView style={{ maxHeight: 144 }} keyboardShouldPersistTaps="handled">
              {references.map((reference) => (
                <Pressable
                  key={reference.start}
                  accessibilityRole="button"
                  onPress={() => setSelected(reference)}
                  className="py-2"
                >
                  <Text className="text-foreground">
                    {reference.label}
                    {draft.context?.records.some((entry) => entry.contextId === reference.contextId)
                      ? ""
                      : " · unavailable"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      {selected && selectedReference ? (
        <ComposerContextSheet
          label={selectedReference.label}
          record={record}
          environmentId={environmentId}
          records={draft.context?.records}
          attachments={draft.attachments}
          onClose={() => setSelected(null)}
          onRemove={
            props.readOnly || props.editable === false
              ? undefined
              : () => {
                  if (props.value.slice(selected.start, selected.end) === selected.source) {
                    props.onChangeText(
                      props.value.slice(0, selected.start) + props.value.slice(selected.end),
                    );
                    props.onSelectionChange?.({ start: selected.start, end: selected.start });
                  }
                  setSelected(null);
                }
          }
        />
      ) : null}
    </>
  );
}
export type { ComposerEditorHandle, ComposerEditorSelection } from "../native/T3ComposerEditor";
