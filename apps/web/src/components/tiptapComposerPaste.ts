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
  } else {
    content.push({ type: "text", text: " " });
  }

  return content;
}

/**
 * Whether a paste at this selection should become mention chips.
 *
 * Inside a fence a path is just text, and turning it into a chip would lift the
 * paste out of the code block. Both ends matter: a range reaching into a fence
 * replaces it, so honouring only the start would delete the block outright. A
 * selection resolved at the document (Cmd+A) has no textblock parent to trust.
 */
export function composerPasteAppliesTo(selection: Selection): boolean {
  const { $from, $to } = selection;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;
  return !$from.parent.type.spec.code && !$to.parent.type.spec.code;
}

export const composerPasteKey = new PluginKey("composerInlineTokenPaste");

/**
 * Intercepts plain-text pastes that carry canonical file links so they arrive
 * as mention chips rather than raw Markdown the user has to look at.
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

            if (!composerPasteAppliesTo(view.state.selection)) return false;

            const { $from } = view.state.selection;
            const content = composerPasteContent(text, pasteAbutsNonWhitespace($from));
            if (!content) return false;

            editor.commands.insertContent(content);
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
