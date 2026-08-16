import { Extension, type Editor } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

/**
 * Typing one of these with text selected wraps the selection instead of
 * replacing it. Mirrors `SURROUND_SYMBOLS` in the Lexical composer.
 */
export const SURROUND_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["'", "'"],
  ['"', '"'],
  ["“", "”"],
  ["`", "`"],
  ["<", ">"],
  ["«", "»"],
  ["*", "*"],
  ["_", "_"],
];

const SURROUND_SYMBOLS_MAP = new Map<string, string>(SURROUND_SYMBOLS);

export function surroundCloseSymbol(input: string): string | null {
  return SURROUND_SYMBOLS_MAP.get(input) ?? null;
}

/**
 * Wraps the current selection in `input` and its partner, leaving the original
 * text selected between the delimiters so the user can keep typing pairs.
 *
 * Refuses when the range is empty, spans an atomic token, or touches the
 * whitespace a mention needs on either side — wrapping there would break the
 * token grammar, which is why the Lexical plugin guarded the same cases.
 */
export function surroundComposerSelection(editor: Editor, input: string): boolean {
  const close = surroundCloseSymbol(input);
  if (!close) return false;

  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty) return false;

  if (selectionSpansComposerToken(state, from, to)) return false;
  // The mention grammar is whitespace-delimited, so a wrap that swallows the
  // space beside a token would silently dissolve it back into plain text.
  if (selectionEatsTokenBoundaryWhitespace(state, from, to)) return false;

  // Inserting the delimiters as text steps rather than parsed content keeps the
  // selected characters exactly as the user typed them.
  const selectedLength = to - from;
  // Close first: inserting at `to` before `from` keeps the earlier offset valid.
  const transaction = state.tr.insertText(close, to).insertText(input, from);
  const selectionStart = from + input.length;
  transaction.setSelection(
    TextSelection.create(transaction.doc, selectionStart, selectionStart + selectedLength),
  );
  editor.view.dispatch(transaction);
  return true;
}

function selectionSpansComposerToken(state: EditorState, from: number, to: number): boolean {
  let spansToken = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "composerToken") spansToken = true;
  });
  return spansToken;
}

/**
 * True when either edge of the range would consume the whitespace separating a
 * token from its neighbours, which is what keeps the token parseable.
 */
function selectionEatsTokenBoundaryWhitespace(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const isTokenAt = (position: number) => state.doc.nodeAt(position)?.type.name === "composerToken";
  const isWhitespaceAt = (position: number) =>
    /\s/.test(state.doc.textBetween(position, position + 1, "\n"));

  // A leading space that follows a token, or a trailing space that precedes one.
  if (isWhitespaceAt(from) && isTokenAt(from - 1)) return true;
  if (to > from && isWhitespaceAt(to - 1) && isTokenAt(to)) return true;
  return false;
}

export const composerSurroundKey = new PluginKey("composerSurroundSelection");

/**
 * macOS dead keys (Option+`) emit the backtick through composition rather than
 * a plain `insertText`, so the composition path is handled alongside it.
 */
export const TiptapComposerSurround = Extension.create({
  name: "composerSurroundSelection",

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: composerSurroundKey,
        props: {
          handleTextInput(_view, _from, _to, text) {
            if (text.length !== 1) return false;
            return surroundComposerSelection(editor, text);
          },
        },
      }),
    ];
  },
});
