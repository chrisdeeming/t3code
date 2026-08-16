import {
  decodeHtmlEntities,
  type Editor,
  Extension,
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

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import type { DiffThemeName } from "~/lib/diffRendering";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "~/lib/terminalContext";

import { composerCodeBlockHighlight } from "./tiptapComposerCodeBlock";
import { TiptapComposerPaste } from "./tiptapComposerPaste";
import { TiptapComposerSurround } from "./tiptapComposerSurround";

export type ComposerTokenKind = "mention" | "skill" | "terminal-context";

type ComposerTokenAttributes = {
  kind: ComposerTokenKind;
  value: string;
  /**
   * Which terminal-context draft this node stands for. The Markdown
   * placeholder carries no identity, so it is stamped on after parsing and
   * then travels with the node, which is what lets the composer report the
   * surviving ids correctly when a chip in the middle is deleted.
   */
  contextId: string | null;
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
  return { kind: attributes.kind, value: attributes.value ?? "", contextId: null };
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

function isTerminalContextToken(node: ProseMirrorNode): boolean {
  return node.type.name === "composerToken" && node.attrs.kind === "terminal-context";
}

/**
 * Reports the drafts still referenced by the document, in document order.
 *
 * Nodes stamped by `stampComposerTerminalContextIds` know their own draft, so
 * deleting a chip in the middle drops that draft rather than the last one.
 */
export function composerTerminalContextIds(doc: ProseMirrorNode): string[] {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (!isTerminalContextToken(node)) return true;
    if (typeof node.attrs.contextId === "string") ids.push(node.attrs.contextId);
    return false;
  });
  return ids;
}

/**
 * Gives every unstamped terminal-context token the draft matching its position.
 *
 * The Markdown placeholder is identity-free, so a freshly parsed document has
 * to be matched up with the pending drafts once; after that the id rides along
 * with the node through edits. Returns true when the document changed.
 *
 * Must stay idempotent. This runs from `onUpdate`, and the transaction it
 * dispatches re-enters `onUpdate`; the second pass finding nothing to stamp is
 * the only thing that ends the cycle.
 */
export function stampComposerTerminalContextIds(
  editor: Editor,
  terminalContexts: ReadonlyArray<{ id: string }>,
): boolean {
  const stamped = new Set(composerTerminalContextIds(editor.state.doc));
  const available = terminalContexts.filter((context) => !stamped.has(context.id));
  let transaction = editor.state.tr;
  let nextAvailable = 0;

  editor.state.doc.descendants((node, position) => {
    if (!isTerminalContextToken(node)) return true;
    if (typeof node.attrs.contextId === "string") return false;
    const context = available[nextAvailable];
    nextAvailable += 1;
    if (!context) return false;
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      contextId: context.id,
    });
    return false;
  });

  if (transaction.steps.length === 0) return false;
  // Deliberately part of the history. Keeping it out meant undoing a chip
  // deletion restored the placeholder with no id: its draft had already been
  // released, so nothing was left to re-stamp it from, and the orphan shifted
  // the ordinal mapping the send path uses onto the wrong context.
  editor.view.dispatch(transaction);
  return true;
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
      contextId: { default: null },
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

/** Serializer internals we deliberately override; not part of the public type. */
type MarkdownEscaper = { escapeMarkdownSyntax: (text: string) => string };

/**
 * The composer's value is a coding prompt, not a document, so the characters
 * the user typed have to reach the agent unchanged. `@tiptap/markdown`
 * backslash-escapes ``\ ` * _ [ ] ~`` in every non-code text node, which turns
 * `path/to_file.ts` into `path/to\_file.ts` and `array[0]` into `array\[0\]`.
 *
 * There is no supported hook for this — `renderNodeToMarkdown` handles text
 * nodes before consulting the extension registry — so the escaper is replaced
 * on the manager instance. Mutating the instance rather than the prototype
 * keeps the change scoped to this editor and covers both serialization paths,
 * since `getMarkdown` and `editor.markdown.serialize` share the object.
 *
 * The trade this makes: literal text that looks like inline markup, such as
 * `[label](target)`, re-parses as markup on the next controlled update. That
 * round-trip was already partial — the escape set covers no block syntax, so
 * `# not a heading` never survived either — and exact prompt text matters more.
 */
const ComposerMarkdown = Markdown.extend({
  onBeforeCreate(props) {
    this.parent?.(props);
    const manager = this.editor.markdown as unknown as MarkdownEscaper | undefined;
    if (manager) manager.escapeMarkdownSyntax = (text: string) => text;
  },
});

/**
 * A soft break emits a plain newline rather than Markdown's two-trailing-spaces
 * form. The composer's value is a prompt, and invisible trailing whitespace on
 * every soft-broken line is noise the agent has to read past.
 */
const ComposerStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension.name === "hardBreak" ? extension.extend({ renderMarkdown: () => "\n" }) : extension,
    );
  },
});

/**
 * Mirrors the code block's language onto the `<pre>` so the stylesheet can
 * label the block, without putting a NodeView between the user and the text.
 * Rendered only; the value still lives on the code block's own attribute.
 */
const ComposerCodeBlockLanguageLabel = Extension.create({
  name: "composerCodeBlockLanguageLabel",

  addGlobalAttributes() {
    return [
      {
        types: ["codeBlock"],
        attributes: {
          language: {
            renderHTML: (attributes) =>
              attributes.language ? { "data-language": attributes.language } : {},
          },
        },
      },
    ];
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
  /**
   * Supplied by the React entry point so code blocks pick up the active theme.
   * Omitted in headless tests, which do not paint highlighting.
   */
  codeBlockTheme?: () => DiffThemeName;
}

export function tiptapComposerExtensions(options: TiptapComposerExtensionOptions = {}): Extensions {
  return [
    ComposerStarterKit.configure({
      link: {
        autolink: false,
        openOnClick: false,
      },
      trailingNode: false,
    }),
    ComposerCodeBlockLanguageLabel,
    TiptapComposerToken.configure({ nodeView: options.tokenNodeView ?? null }),
    TiptapComposerPaste,
    TiptapComposerSurround,
    ...(options.codeBlockTheme
      ? [composerCodeBlockHighlight({ resolveTheme: options.codeBlockTheme })]
      : []),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "paragraph" ? (options.placeholder ?? "") : "",
    }),
    ComposerMarkdown.configure({
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
