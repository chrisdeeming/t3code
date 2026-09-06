import type { ComposerContextRecord, EnvironmentId } from "@t3tools/contracts";
import { Alert, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import type { DraftComposerAttachment } from "../lib/composerImages";
import { loadLocalAttachmentPreview } from "../lib/localAttachmentPreview";
import { downloadAndShareAttachment } from "../lib/attachmentDownload";
import { useAssetUrlState, useRefreshAssetUrl } from "../state/assets";
import { AppText as Text } from "./AppText";

export function ComposerContextAttachment(props: {
  record: Extract<ComposerContextRecord, { attachmentId: string }>;
  environmentId?: EnvironmentId;
  attachment?: DraftComposerAttachment;
}) {
  const { record, attachment } = props;
  const resource = useMemo(
    () => ({
      _tag: "attachment" as const,
      attachmentId: record.attachmentId,
      fileName: record.name,
    }),
    [record.attachmentId, record.name],
  );
  const local = attachment?.fileUri
    ? (attachment as DraftComposerAttachment & { fileUri: string })
    : undefined;
  const asset = useAssetUrlState(local ? null : (props.environmentId ?? null), resource);
  const refresh = useRefreshAssetUrl(local ? null : (props.environmentId ?? null), resource);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    void loadLocalAttachmentPreview(local, controller.signal)
      .then((preview) => {
        if (!preview) return;
        if (controller.signal.aborted) return preview.dispose();
        dispose = preview.dispose;
        setLocalUri(preview.uri);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("The local file is unavailable. Attach it again.");
      });
    return () => {
      controller.abort();
      dispose?.();
    };
  }, [local]);
  const uri = local ? localUri : asset._tag === "Success" ? asset.url : null;
  const share = async () => {
    if (sharing) return;
    setSharing(true);
    const controller = new AbortController();
    try {
      if (local) {
        const preview = await loadLocalAttachmentPreview(local, controller.signal);
        try {
          await preview?.share(controller.signal);
        } finally {
          preview?.dispose();
        }
      } else {
        const url = await refresh();
        if (!url) throw new Error("Reconnect to the environment and try again.");
        await downloadAndShareAttachment({ url, attachment: record, signal: controller.signal });
      }
    } catch (cause) {
      Alert.alert(
        "Could not open attachment",
        cause instanceof Error ? cause.message : "Try again.",
      );
    } finally {
      setSharing(false);
    }
  };
  return (
    <View className="gap-3">
      {record.kind === "image" && uri ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: 280 }}
          contentFit="contain"
          accessibilityLabel={record.name}
        />
      ) : null}
      {error || (!local && asset._tag === "Failure") ? (
        <Text className="text-foreground-muted">
          {error ?? "Attachment unavailable. Reconnect and try again."}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={sharing}
        onPress={() => void share()}
        className="rounded-xl bg-subtle p-4"
      >
        <Text className="text-foreground">
          {sharing ? "Opening attachment…" : "Open or share attachment"}
        </Text>
      </Pressable>
    </View>
  );
}
