import type { ComposerContextRecord, EnvironmentId } from "@t3tools/contracts";
import { Alert, Linking, Modal, Pressable, ScrollView, View } from "react-native";
import type { DraftComposerAttachment } from "../lib/composerImages";
import { ComposerContextAttachment } from "./ComposerContextAttachment";
import { AppText as Text } from "./AppText";

function ContextField(props: { label: string; value: string | null | undefined; code?: boolean }) {
  if (!props.value) return null;
  return (
    <View className="gap-1">
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
      <Text
        selectable
        className={props.code ? "font-mono text-sm text-foreground" : "text-base text-foreground"}
      >
        {props.value}
      </Text>
    </View>
  );
}

/** Touch equivalent of the web context popover; snapshots remain readable offline. */
export function ComposerContextSheet(props: {
  readonly label: string;
  readonly record: ComposerContextRecord | undefined;
  readonly onClose: () => void;
  readonly onRemove?: () => void;
  readonly onOpenAttachment?: () => void;
  readonly onOpenPullRequest?: () => void;
  readonly environmentId?: EnvironmentId;
  readonly records?: ReadonlyArray<ComposerContextRecord>;
  readonly attachments?: ReadonlyArray<DraftComposerAttachment>;
}) {
  const record = props.record;
  const attachmentRecord =
    record && "attachmentId" in record
      ? record
      : record?.kind === "preview-annotation" && "screenshotContextId" in record
        ? props.records?.find(
            (entry) => entry.contextId === record.screenshotContextId && "attachmentId" in entry,
          )
        : undefined;
  const pullRequestUrl =
    record?.kind === "review-comment" && "pullRequest" in record
      ? record.pullRequest?.url
      : undefined;
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View className="flex-1 bg-sheet-solid">
        <View className="flex-row items-center justify-between border-b border-border p-4">
          <Text className="flex-1 text-lg font-t3-semibold text-foreground" numberOfLines={2}>
            {props.label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close context"
            onPress={props.onClose}
            className="p-3"
          >
            <Text className="text-foreground">Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 48 }}>
          {!record ? (
            <Text className="text-foreground">
              Context unavailable. The reference was copied without its payload. Copy it again from
              the original message or remove it.
            </Text>
          ) : "payload" in record ? (
            <Text className="text-foreground">
              This context type is not supported by this version of the app. Its payload will be
              preserved when sent.
            </Text>
          ) : (
            <>
              <ContextField label="Type" value={record.kind.replace(/-/g, " ")} />
              {record.kind === "terminal" ? (
                <>
                  <ContextField
                    label="Terminal"
                    value={`${record.terminalLabel} · lines ${record.lineStart}–${record.lineEnd}`}
                  />
                  <ContextField label="Captured output" value={record.text} code />
                </>
              ) : null}
              {record.kind === "review-comment" ? (
                <>
                  {record.pullRequest ? (
                    <ContextField
                      label={`#${record.pullRequest.number} · ${record.pullRequest.isDraft ? "draft" : record.pullRequest.state}`}
                      value={`${record.pullRequest.title}\n${record.pullRequest.headBranch} → ${record.pullRequest.baseBranch}`}
                    />
                  ) : null}
                  <ContextField label="File" value={`${record.filePath} · ${record.rangeLabel}`} />
                  <ContextField label="Review" value={record.sectionTitle} />
                  <ContextField label="Comment" value={record.text} />
                  <ContextField label="Diff" value={record.diff} code />
                </>
              ) : null}
              {record.kind === "preview-annotation" ? (
                <>
                  <ContextField label="Page" value={record.pageTitle ?? record.pageUrl} />
                  <ContextField label="URL" value={record.pageUrl} />
                  <ContextField label="Comment" value={record.comment} />
                  <ContextField label="Selection" value={record.targetSummary} />
                  <ContextField label="Requested changes" value={record.styleChanges.join("\n")} />
                  {record.elements?.map((element, index) => (
                    <View key={index} className="gap-3">
                      <ContextField
                        label="Element"
                        value={element.componentName ?? element.tagName}
                      />
                      <ContextField label="Selector" value={element.selector} code />
                      <ContextField label="Source" value={element.source?.fileName} />
                      <ContextField label="HTML" value={element.htmlPreview} code />
                      <ContextField label="Styles" value={element.styles} code />
                    </View>
                  ))}
                </>
              ) : null}
              {record.kind === "element" ? (
                <>
                  <ContextField label="Page" value={record.pageUrl} />
                  <ContextField label="Element" value={record.componentName ?? record.tagName} />
                  <ContextField label="Selector" value={record.selector} code />
                  <ContextField
                    label="Source"
                    value={
                      record.source?.fileName
                        ? `${record.source.fileName}:${record.source.lineNumber ?? 1}`
                        : null
                    }
                  />
                  <ContextField label="HTML" value={record.htmlPreview} code />
                  <ContextField label="Styles" value={record.styles} code />
                </>
              ) : null}
              {record.kind === "image" || record.kind === "file" ? (
                <ContextField
                  label="File"
                  value={`${record.name}\n${record.mimeType} · ${record.sizeBytes} bytes`}
                />
              ) : null}
              {record.kind === "mention" ? (
                <ContextField label="Path" value={record.path} code />
              ) : null}
              {record.kind === "skill" ? <ContextField label="Skill" value={record.name} /> : null}
            </>
          )}
          {attachmentRecord && "attachmentId" in attachmentRecord ? (
            <ComposerContextAttachment
              record={attachmentRecord}
              environmentId={props.environmentId}
              attachment={props.attachments?.find(
                (entry) => entry.id === attachmentRecord.attachmentId,
              )}
            />
          ) : null}
          {pullRequestUrl && /^https?:\/\//i.test(pullRequestUrl) ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(pullRequestUrl).catch(() =>
                  Alert.alert("Could not open pull request", "Try again when connected."),
                );
              }}
              className="rounded-xl bg-subtle p-4"
            >
              <Text className="text-foreground">Open pull request</Text>
            </Pressable>
          ) : null}
          {props.onOpenAttachment ? (
            <Pressable
              accessibilityRole="button"
              onPress={props.onOpenAttachment}
              className="rounded-xl bg-subtle p-4"
            >
              <Text className="text-foreground">Open attachment</Text>
            </Pressable>
          ) : null}
          {props.onOpenPullRequest ? (
            <Pressable
              accessibilityRole="button"
              onPress={props.onOpenPullRequest}
              className="rounded-xl bg-subtle p-4"
            >
              <Text className="text-foreground">Open pull request</Text>
            </Pressable>
          ) : null}
          {props.onRemove ? (
            <Pressable
              accessibilityRole="button"
              onPress={props.onRemove}
              className="rounded-xl bg-subtle p-4"
            >
              <Text className="text-foreground">Remove from draft</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
