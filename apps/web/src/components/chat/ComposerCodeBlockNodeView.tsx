import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { useTheme } from "../../hooks/useTheme";
import { MarkdownCodeBlockTitleContent } from "../ChatMarkdown";

/**
 * Draws a composer fence as the chat view draws a rendered one, down to the
 * class names, so a draft looks like the message it is about to become.
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
      className="chat-markdown-codeblock my-[0.65rem] overflow-hidden rounded-[var(--radius)] border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32"
      data-language={language}
      data-wrap="true"
    >
      <div
        contentEditable={false}
        className="chat-markdown-codeblock-header flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3 select-none"
      >
        <span className="inline-flex min-w-0 items-center gap-[0.4rem] [font-family:var(--font-mono,ui-monospace,SFMono-Regular,monospace)] [font-size:0.6875rem]">
          <MarkdownCodeBlockTitleContent
            fenceTitle={null}
            language={language}
            theme={resolvedTheme}
          />
        </span>
      </div>
      <div className="chat-markdown-shiki">
        <pre>
          <NodeViewContent<"code"> as="code" />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
