import type { EnvironmentId, ProjectReadFileResult } from "@t3tools/contracts";
import { ActivityIndicator, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { useEnvironmentQuery } from "../../state/query";
import { projectEnvironment } from "../../state/projects";
import { SourceFileSurface } from "./SourceFileSurface";
import { basename } from "./filePath";

/** Source-file preview for a project draft that does not have a thread yet. */
export function WorkspaceFilePreviewSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const query = useEnvironmentQuery(
    projectEnvironment.readFile({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, relativePath: props.path },
    }),
  );
  const file = query.data as ProjectReadFileResult | null;
  return (
    <Modal presentationStyle="pageSheet" animationType="slide" onRequestClose={props.onClose}>
      <View
        className="flex-1 bg-sheet-solid"
        style={
          Platform.OS === "android"
            ? { paddingTop: insets.top, paddingBottom: insets.bottom }
            : undefined
        }
      >
        <View className="flex-row items-center justify-between border-b border-border p-4">
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-base font-t3-semibold text-foreground">
              {basename(props.path)}
            </Text>
            <Text numberOfLines={1} className="text-xs text-foreground-muted">
              {props.path}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close file preview"
            onPress={props.onClose}
            className="p-3"
          >
            <Text className="text-foreground">Done</Text>
          </Pressable>
        </View>
        {file ? (
          <>
            {file.truncated ? (
              <Text className="px-4 py-2 text-xs text-foreground-muted">
                Preview limited to the first 1 MB.
              </Text>
            ) : null}
            <SourceFileSurface
              contents={file.contents}
              path={props.path}
              onRefresh={() => query.refresh()}
            />
          </>
        ) : query.error ? (
          <View className="flex-1 items-center justify-center px-6">
            <EmptyState title="File unavailable" detail={query.error} />
          </View>
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        )}
      </View>
    </Modal>
  );
}
