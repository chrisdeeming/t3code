import { useAtomValue } from "@effect/atom-react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import {
  composerDraftsAtom,
  deleteStashedComposerDraft,
  restoreStashedComposerDraft,
} from "../state/use-composer-drafts";
import { uuidv4 } from "../lib/uuid";
import { AppText as Text } from "./AppText";

export function ComposerStashSheet(props: {
  readonly draftKey: string;
  readonly onClose: () => void;
}) {
  const drafts = useAtomValue(composerDraftsAtom);
  const entries = Object.entries(drafts).flatMap(([draftKey, draft]) =>
    (draft.stashedPrompts ?? []).map((prompt) => ({ draftKey, prompt })),
  );
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View className="flex-1 bg-sheet-solid">
        <View className="flex-row items-center justify-between border-b border-border p-4">
          <Text className="text-lg font-t3-semibold text-foreground">Stashed prompts</Text>
          <Pressable accessibilityRole="button" onPress={props.onClose} className="p-3">
            <Text className="text-foreground">Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
          {entries.length === 0 ? (
            <Text className="text-foreground-muted">No stashed prompts on this device.</Text>
          ) : null}
          {entries.map(({ draftKey, prompt }) => (
            <View key={`${draftKey}:${prompt.id}`} className="rounded-xl bg-subtle p-3">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Restore ${replaceComposerContextReferences(prompt.text, (ref) => ref.label).slice(0, 80) || "attachments"}`}
                onPress={async () => {
                  try {
                    if (
                      await restoreStashedComposerDraft(draftKey, props.draftKey, prompt.id, uuidv4)
                    )
                      props.onClose();
                    else
                      Alert.alert(
                        "Could not restore prompt",
                        "Remove some attachments from your draft and try again.",
                      );
                  } catch {
                    Alert.alert(
                      "Could not save restored prompt",
                      "Your prompt remains available in memory. Try again before closing the app.",
                    );
                  }
                }}
                className="gap-2 p-2"
              >
                <Text numberOfLines={3} className="text-foreground">
                  {replaceComposerContextReferences(prompt.text, (ref) => ref.label) ||
                    "Attachments"}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {prompt.attachments.length} attachments · {prompt.context?.records.length ?? 0}{" "}
                  context items
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete stashed prompt"
                className="self-end p-2"
                onPress={() =>
                  Alert.alert(
                    "Delete stashed prompt?",
                    "This removes the saved prompt from this device.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                          void deleteStashedComposerDraft(draftKey, prompt.id).catch(() =>
                            Alert.alert(
                              "Could not save stash change",
                              "Try again before closing the app.",
                            ),
                          );
                        },
                      },
                    ],
                  )
                }
              >
                <Text className="text-sm text-foreground-muted">Delete</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
