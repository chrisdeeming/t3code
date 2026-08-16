import {
  decodeHtmlEntities,
  type Editor,
  Node,
  type Extensions,
  type JSONContent,
  type MarkdownToken,
} from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "~/lib/terminalContext";

export type ComposerTokenKind = "mention" | "skill" | "terminal-context";

type ComposerTokenAttributes = {
  kind: ComposerTokenKind;
  value: string;
  contextId?: string;
  label?: string;
};

function tokenAttributes(token: MarkdownToken): ComposerTokenAttributes {
  const attributes = token.attributes as Partial<ComposerTokenAttributes> | undefined;
  if (
    attributes?.kind !== "mention" &&
    attributes?.kind !== "skill" &&
    attributes?.kind !== "terminal-context"
  ) {
    throw new Error("Invalid composer token kind");
  }
  return { kind: attributes.kind, value: attributes.value ?? "" };
}

function serializedToken(node: JSONContent): string {
  const attributes = node.attrs as Partial<ComposerTokenAttributes> | undefined;
  switch (attributes?.kind) {
    case "mention":
      return serializeComposerFileLink(attributes.value ?? "");
    case "skill":
      return `$${attributes.value ?? ""}`;
    case "terminal-context":
      return INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    default:
      return "";
  }
}

function firstComposerTokenOffset(source: string): number {
  const inlineToken = collectComposerInlineTokens(source)[0];
  const terminalContextOffset = source.indexOf(INLINE_TERMINAL_CONTEXT_PLACEHOLDER);
  if (!inlineToken) return terminalContextOffset;
  if (terminalContextOffset < 0) return inlineToken.start;
  return Math.min(inlineToken.start, terminalContextOffset);
}

export const TiptapComposerToken = Node.create({
  name: "composerToken",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      kind: { default: null },
      value: { default: "" },
      contextId: { default: null },
      label: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-composer-token]" }];
  },

  renderHTML({ node }) {
    const attributes = node.attrs as ComposerTokenAttributes;
    return [
      "span",
      {
        "data-composer-token": attributes.kind,
        "data-composer-token-value": attributes.value,
        contenteditable: "false",
        class: "rounded bg-muted px-1.5 py-0.5 text-[0.9em] text-foreground",
      },
      attributes.label ??
        (attributes.kind === "terminal-context" ? "Terminal context" : attributes.value),
    ];
  },

  renderText({ node }) {
    return serializedToken(node.toJSON());
  },

  markdownTokenName: "composerToken",

  markdownTokenizer: {
    name: "composerToken",
    level: "inline",
    start: firstComposerTokenOffset,
    tokenize(source) {
      if (source.startsWith(INLINE_TERMINAL_CONTEXT_PLACEHOLDER)) {
        return {
          type: "composerToken",
          raw: INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
          attributes: { kind: "terminal-context", value: "" },
        };
      }

      const token = collectComposerInlineTokens(source)[0];
      if (!token || token.start !== 0) return undefined;
      return {
        type: "composerToken",
        raw: token.source,
        attributes: { kind: token.type, value: token.value },
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("composerToken", tokenAttributes(token));
  },

  renderMarkdown(node) {
    return serializedToken(node);
  },
});

export function tiptapComposerExtensions(options: { placeholder?: string } = {}): Extensions {
  return [
    StarterKit.configure({
      link: {
        autolink: false,
        openOnClick: false,
      },
      trailingNode: false,
    }),
    TiptapComposerToken,
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "paragraph" ? (options.placeholder ?? "") : "",
    }),
    Markdown.configure({
      markedOptions: {
        breaks: false,
        gfm: true,
      },
    }),
  ];
}

/**
 * Tiptap encodes HTML-sensitive characters during Markdown serialization.
 * That is correct for rendered Markdown, but composer output is also a raw
 * coding prompt, where changing `&&` to `&amp;&amp;` changes its meaning.
 */
export function getTiptapComposerMarkdown(editor: Editor): string {
  const document = editor.getJSON();
  const content = document.content ?? [];
  const trailingNode = content.at(-1);
  const previousNode = content.at(-2);
  const hasEditorEscapeParagraph =
    trailingNode?.type === "paragraph" &&
    !trailingNode.content?.length &&
    previousNode != null &&
    ["blockquote", "bulletList", "codeBlock", "orderedList"].includes(previousNode.type);

  if (!hasEditorEscapeParagraph) return decodeHtmlEntities(editor.getMarkdown());

  const markdown = editor.markdown;
  if (!markdown) throw new Error("Tiptap Markdown manager is unavailable");
  return decodeHtmlEntities(
    markdown.serialize({
      ...document,
      content: content.slice(0, -1),
    }),
  );
}
