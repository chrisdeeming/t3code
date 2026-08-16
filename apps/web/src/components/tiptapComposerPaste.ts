import { Extension, type JSONContent } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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
  precedingCharacter: string,
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

  if (mentions[0]?.start === 0 && precedingCharacter.length > 0 && !/\s/.test(precedingCharacter)) {
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

            const { $from } = view.state.selection;
            const content = composerPasteContent(text, characterBefore(view.state, $from.pos));
            if (!content) return false;

            editor.commands.insertContent(content);
            return true;
          },
        },
      }),
    ];
  },
});

function characterBefore(
  state: { doc: { textBetween: (from: number, to: number) => string } },
  position: number,
): string {
  if (position <= 1) return "";
  return state.doc.textBetween(position - 1, position);
}
