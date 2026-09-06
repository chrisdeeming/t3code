import { requireOptionalNativeModule } from "expo";

interface T3MarkdownTextSelectionNativeModule {
  readonly installCopySanitizer: (reactTag: number, contextClipboardConfig: string) => void;
}

const nativeModule =
  requireOptionalNativeModule<T3MarkdownTextSelectionNativeModule>("T3MarkdownTextSelection");

export function installMarkdownCopySanitizer(reactTag: number, contextClipboardConfig = ""): void {
  nativeModule?.installCopySanitizer(reactTag, contextClipboardConfig);
}
