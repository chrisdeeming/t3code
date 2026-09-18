import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { useTheme } from "../../hooks/useTheme";
import {
  MARKDOWN_CODE_BLOCK_CLASS_NAME,
  MARKDOWN_CODE_BLOCK_HEADER_CLASS_NAME,
  MARKDOWN_CODE_BLOCK_TITLE_CLASS_NAME,
  MarkdownCodeBlockTitleContent,
} from "../ChatMarkdown";

/**
 * Draws a composer fence with the chat view's own code block frame, so a
 * draft looks like the message it is about to become.
 *
 * The chrome stops at the language icon. Chat's wrap and copy buttons act on
 * text the reader cannot change; here the text is the draft, and both are
 * already a selection away.
 */
export function ComposerCodeBlockNodeView({ node }: NodeViewProps) {
  const { resolvedTheme } = useTheme();
  const declared = typeof node.attrs.language === "string" ? node.attrs.language.trim() : "";
  // An undeclared fence reads "text", the same fallback the chat view applies
  // when a fence arrives without an info string.
  const language = declared || "text";
  return (
    <NodeViewWrapper
      as="div"
      className={MARKDOWN_CODE_BLOCK_CLASS_NAME}
      data-language={language}
      data-wrap="true"
    >
      <div contentEditable={false} className={MARKDOWN_CODE_BLOCK_HEADER_CLASS_NAME}>
        <span className={MARKDOWN_CODE_BLOCK_TITLE_CLASS_NAME}>
          <MarkdownCodeBlockTitleContent
            fenceTitle={null}
            language={language}
            theme={resolvedTheme}
          />
        </span>
      </div>
      <div className="chat-markdown-shiki">
        <pre className="max-w-full overflow-x-auto px-[0.7rem] pt-1 pb-2">
          {/* A caret needs a line to sit on even before any code is typed. */}
          <NodeViewContent<"code">
            as="code"
            className="block min-h-[1lh] border-0 bg-transparent p-0 font-mono whitespace-pre-wrap [color:inherit] [font-size:var(--font-size-code,0.92em)] [overflow-wrap:anywhere]"
          />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
