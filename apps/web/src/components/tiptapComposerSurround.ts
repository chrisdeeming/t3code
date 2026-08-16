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
 * Refuses when the range is empty, crosses a block, sits in code, spans an
 * atomic token, or touches the whitespace a mention needs on either side.
 * The Lexical plugin guarded the token cases; the block and code cases are new,
 * because it worked on flat prompt text where a block break was only a `\n`.
 */
export function surroundComposerSelection(editor: Editor, input: string): boolean {
  const close = surroundCloseSymbol(input);
  if (!close) return false;

  const { state } = editor;
  const { selection } = state;
  const { $from, $to, from, to, empty } = selection;
  if (empty) return false;

  // Cmd+A installs an AllSelection, whose ends resolve at the document rather
  // than a textblock: `sameParent` is trivially true and `parent.type.spec.code`
  // is undefined, so every guard below would wave it through and wrap the whole
  // prompt. Only a range inside one textblock can be wrapped.
  if (!(selection instanceof TextSelection)) return false;
  // One delimiter per block would land the pair in two different paragraphs.
  if (!$from.sameParent($to)) return false;
  if (!$from.parent.isTextblock) return false;
  // In a fence the delimiters are code, not markup.
  if ($from.parent.type.spec.code) return false;
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
  const selectionEnd = selectionStart + selectedLength;
  // Preserve which end the user was extending from, so Shift+Arrow continues
  // in the direction they were already going.
  const backwards = state.selection.anchor > state.selection.head;
  transaction.setSelection(
    TextSelection.create(
      transaction.doc,
      backwards ? selectionEnd : selectionStart,
      backwards ? selectionStart : selectionEnd,
    ),
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
  const isTokenAt = (position: number) =>
    position >= 0 &&
    position < state.doc.content.size &&
    state.doc.nodeAt(position)?.type.name === "composerToken";
  const isWhitespaceAt = (position: number) =>
    position >= 0 &&
    position < state.doc.content.size &&
    /\s/.test(state.doc.textBetween(position, position + 1, "\n"));

  // A leading space that follows a token, or a trailing space that precedes one.
  if (isWhitespaceAt(from) && isTokenAt(from - 1)) return true;
  if (to > from && isWhitespaceAt(to - 1) && isTokenAt(to)) return true;
  return false;
}

export const composerSurroundKey = new PluginKey("composerSurroundSelection");

/**
 * Known gap: macOS dead keys (Option+` then Space) deliver the backtick through
 * composition, and prosemirror-view's keypress handler bails out near a
 * composition before `handleTextInput` runs, so that route does not wrap. The
 * Lexical plugin carried a separate `beforeinput`/`compositionend` state machine
 * for it. Ordinary typed delimiters are unaffected.
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
