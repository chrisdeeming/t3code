import {
  decodeHtmlEntities,
  type Editor,
  Node,
  type Extensions,
  type JSONContent,
  type MarkdownToken,
  type NodeViewRenderer,
} from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "~/lib/terminalContext";

import { TiptapComposerPaste } from "./tiptapComposerPaste";

export type ComposerTokenKind = "mention" | "skill" | "terminal-context";

type ComposerTokenAttributes = {
  kind: ComposerTokenKind;
  value: string;
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

/**
 * Removes the atom immediately before or after a collapsed cursor. Returns
 * false when the cursor is not touching one, letting the default chain run.
 */
export function deleteAdjacentComposerToken(editor: Editor, side: "before" | "after"): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  const candidate = side === "before" ? $from.nodeBefore : $from.nodeAfter;
  if (candidate?.type.name !== "composerToken") return false;
  const from = side === "before" ? $from.pos - candidate.nodeSize : $from.pos;
  return editor.commands.deleteRange({ from, to: from + candidate.nodeSize });
}

export interface ComposerTokenOptions {
  /** Set by the React entry point; headless tests render the fallback HTML. */
  nodeView: NodeViewRenderer | null;
}

/**
 * Selectable so ProseMirror's own NodeSelection drives the legacy behaviors:
 * arrows step over the chip as one unit, a range spanning it paints, and
 * Backspace/Delete removes the whole token instead of splitting it.
 */
export const TiptapComposerToken = Node.create<ComposerTokenOptions>({
  name: "composerToken",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { nodeView: null };
  },

  // A falsy result leaves the node on its plain renderHTML output.
  addNodeView() {
    return this.options.nodeView as NodeViewRenderer;
  },

  addAttributes() {
    return {
      kind: { default: null },
      value: { default: "" },
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
      },
      attributes.kind === "terminal-context" ? "Terminal context" : attributes.value,
    ];
  },

  renderText({ node }) {
    return serializedToken(node.toJSON());
  },

  /**
   * Tiptap's default Backspace chain only *selects* an adjacent atom
   * (`selectNodeBackward`), leaving a second keypress to delete it. The legacy
   * composer removed a chip in one press, so delete the neighbouring token
   * outright before the default chain runs.
   */
  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteAdjacentComposerToken(this.editor, "before"),
      Delete: () => deleteAdjacentComposerToken(this.editor, "after"),
    };
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

export interface TiptapComposerExtensionOptions {
  placeholder?: string;
  /**
   * Supplied by the React entry point. Kept as an injection point so this
   * module — and the tests that drive a headless editor through it — stay
   * free of React and the DOM.
   */
  tokenNodeView?: NodeViewRenderer;
}

export function tiptapComposerExtensions(options: TiptapComposerExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      link: {
        autolink: false,
        openOnClick: false,
      },
      trailingNode: false,
    }),
    TiptapComposerToken.configure({ nodeView: options.tokenNodeView ?? null }),
    TiptapComposerPaste,
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
