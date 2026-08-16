import type { NodeViewRenderer } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { TiptapComposerTokenView } from "./TiptapComposerTokenView";

/**
 * React NodeViews for the composer, kept apart from the extension list so the
 * headless extension module stays renderer-agnostic.
 */
export function composerTokenNodeView(): NodeViewRenderer {
  return ReactNodeViewRenderer(TiptapComposerTokenView, { as: "span" });
}
