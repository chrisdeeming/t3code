import { Extension, type JSONContent } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Selection } from "@tiptap/pm/state";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

/**
 * Builds the inline content a pasted string should become, turning canonical
 * file links into mention atoms and leaving everything else as text.
 *
 * Mirrors the Lexical `registerComposerInlineTokenPaste` behavior, including
 * its two spacing rules: the token grammar needs whitespace on both sides, so
 * a mention landing against a non-space character gains a leading space, and a
 * paste ending in a mention gains the trailing space autocomplete would add.
 *
 * Returns null when the text holds no mentions, letting the default paste run.
 */
export function composerPasteContent(
  text: string,
  abutsNonWhitespace: boolean,
  abutsNonWhitespaceAfter = true,
): JSONContent[] | null {
  // Token grammar requires trailing whitespace; a virtual newline lets a
  // mention at the very end of the pasted text still parse.
  const mentions = collectComposerInlineTokens(`${text}\n`).filter(
    (token) => token.type === "mention" && token.end <= text.length,
  );
  if (mentions.length === 0) return null;

  const content: JSONContent[] = [];
  const appendText = (value: string) => {
    const lines = value.split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.length > 0) content.push({ type: "text", text: line });
      if (index < lines.length - 1) content.push({ type: "hardBreak" });
    }
  };

  if (mentions[0]?.start === 0 && abutsNonWhitespace) {
    content.push({ type: "text", text: " " });
  }

  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start < cursor) continue;
    if (mention.start > cursor) appendText(text.slice(cursor, mention.start));
    content.push({
      type: "composerToken",
      attrs: { kind: "mention", value: mention.value },
    });
    cursor = mention.end;
  }

  if (cursor < text.length) {
    appendText(text.slice(cursor));
  } else if (abutsNonWhitespaceAfter) {
    // The paste ends on a mention, whose grammar needs whitespace after it —
    // but only when the document does not already supply some.
    content.push({ type: "text", text: " " });
  }

  return content;
}

/**
 * Whether a paste at this selection may produce structure — chips or parsed
 * Markdown — rather than literal characters.
 *
 * Inside a fence every character is content, so a path there is just a path.
 * Both ends matter: a range reaching into a fence replaces it, so honouring
 * only the start would delete the block outright. A selection resolved at the
 * document (Cmd+A) has no textblock parent to trust.
 */
export function composerPasteAppliesTo(selection: Selection): boolean {
  const { $from, $to } = selection;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;
  return !$from.parent.type.spec.code && !$to.parent.type.spec.code;
}

/**
 * Block-level Markdown constructs that only make sense as structure. Inline
 * emphasis is deliberately absent: `*` and `_` appear constantly in prose and
 * code, and treating them as a signal would rewrite text the user pasted
 * literally. A fence, heading, list marker, quote or table row is unambiguous
 * enough to act on.
 */
const MARKDOWN_BLOCK_SIGNALS = [
  /^```/m,
  /^~~~/m,
  /^#{1,6}\s/m,
  /^\s*[-*+]\s/m,
  /^\s*\d+[.)]\s/m,
  /^\s*>\s/m,
  /^\s*\|.*\|/m,
];

/**
 * Whether pasted text should be parsed as Markdown rather than inserted as
 * literal characters.
 *
 * Typing ```` ```php ```` builds a code block, so pasting the same source has
 * to as well — anything else makes the composer's behaviour depend on how the
 * text arrived. Text without a block-level signal is left alone, so prose and
 * code snippets keep every character the user copied.
 */
export function pastedTextLooksLikeMarkdown(text: string): boolean {
  return MARKDOWN_BLOCK_SIGNALS.some((signal) => signal.test(text));
}

/**
 * Plain text as inline content, one hard break per newline.
 *
 * ProseMirror's default splits pasted text into a paragraph per line, which
 * serializes back with a blank line between every line — so a pasted stack
 * trace reached the agent double-spaced. Mirrors Lexical's
 * `$appendTextWithLineBreaks`.
 */
export function plainTextContent(text: string): JSONContent[] {
  const content: JSONContent[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.length > 0) content.push({ type: "text", text: line });
    if (index < lines.length - 1) content.push({ type: "hardBreak" });
  }
  return content;
}

export const composerPasteKey = new PluginKey("composerInlineTokenPaste");

/**
 * Owns plain-text pasting, so that text arriving from the clipboard behaves the
 * same as text the user typed.
 *
 * Three cases, in order: inside a fence the text stays literal; text carrying
 * block-level Markdown is parsed, so pasting a ```` ```php ```` block yields the
 * same code block typing it does; everything else is inserted verbatim with its
 * newlines intact. Canonical file links still become mention chips.
 */
export const TiptapComposerPaste = Extension.create({
  name: "composerInlineTokenPaste",

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: composerPasteKey,
        props: {
          handlePaste(view, event) {
            if (!event.clipboardData || event.clipboardData.files.length > 0) return false;
            const text = event.clipboardData.getData("text/plain");
            if (!text) return false;

            // Prefer real HTML from rich sources; only plain text is ours.
            if (event.clipboardData.types.includes("text/html")) return false;

            const { $from, $to } = view.state.selection;
            if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;

            // In a fence every character is content, including newlines.
            if (!composerPasteAppliesTo(view.state.selection)) {
              editor.commands.insertContent(plainTextContent(text));
              return true;
            }

            // Structure first: the Markdown parser builds mention chips too, so
            // checking mentions ahead of it would trade a pasted list or fence
            // for the one chip inside it.
            if (pastedTextLooksLikeMarkdown(text)) {
              editor.commands.insertContent(text, { contentType: "markdown" });
              return true;
            }

            const mentions = composerPasteContent(
              text,
              pasteAbutsNonWhitespace($from),
              pasteAbutsNonWhitespaceAfter(view.state.selection.$to),
            );
            if (mentions) {
              editor.commands.insertContent(mentions);
              return true;
            }

            editor.commands.insertContent(plainTextContent(text));
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Whether the paste would land straight against a non-whitespace neighbour,
 * which is when the mention grammar needs a space inserted before it.
 *
 * An existing chip counts as one: `textBetween` skips atom nodes and reports
 * nothing there, so a mention pasted directly after a chip would gain no
 * separating space and the two would fuse into a single unparseable token.
 */
export function pasteAbutsNonWhitespace($from: ResolvedPos): boolean {
  const before = $from.nodeBefore;
  if (!before) return false;
  if (before.type.name === "composerToken") return true;
  if (!before.isText) return false;
  const character = before.text?.slice(-1) ?? "";
  return character.length > 0 && !/\s/.test(character);
}

/**
 * The mirror of `pasteAbutsNonWhitespace` for the other end of the paste: true
 * when the text after the insertion point starts with something the mention
 * grammar would need a space against.
 *
 * The end of a block counts as whitespace, because there is nothing there to
 * fuse with. Without this a mention pasted before existing text — or over a
 * selected chip, where the replaced range leaves its surrounding spaces intact
 * — gained a space it did not need and the prompt grew one every time.
 */
export function pasteAbutsNonWhitespaceAfter($to: ResolvedPos): boolean {
  const after = $to.nodeAfter;
  if (!after) return false;
  if (after.type.name === "composerToken") return true;
  if (!after.isText) return false;
  const character = after.text?.slice(0, 1) ?? "";
  return character.length > 0 && !/\s/.test(character);
}
