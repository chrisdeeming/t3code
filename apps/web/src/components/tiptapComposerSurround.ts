import { Extension, type Editor } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

/**
 * Brackets and quotes: typing one with text selected surrounds the selection
 * with the literal characters instead of replacing it. From Lexical's
 * `SURROUND_SYMBOLS`, minus the Markdown delimiters, which now toggle a mark.
 */
export const SURROUND_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["'", "'"],
  ['"', '"'],
  ["“", "”"],
  ["<", ">"],
  ["«", "»"],
];

/**
 * Markdown delimiters apply formatting rather than literal characters. In a
 * WYSIWYG editor the delimiters are meant to disappear into the mark, the same
 * way `# ` becomes a heading — inserting them as text left the user looking at
 * raw backticks and asterisks, and pressing `*` twice produced `**text**` as
 * literal characters rather than bold.
 */
const MARKDOWN_DELIMITER_MARKS: ReadonlyArray<readonly [string, string]> = [
  ["`", "code"],
  ["*", "italic"],
  ["_", "italic"],
  ["~", "strike"],
];

const SURROUND_SYMBOLS_MAP = new Map<string, string>(SURROUND_SYMBOLS);
const MARKDOWN_DELIMITER_MARK_MAP = new Map<string, string>(MARKDOWN_DELIMITER_MARKS);

export function surroundCloseSymbol(input: string): string | null {
  return SURROUND_SYMBOLS_MAP.get(input) ?? null;
}

/** The mark a Markdown delimiter toggles, if it is one. */
export function markdownDelimiterMark(input: string): string | null {
  return MARKDOWN_DELIMITER_MARK_MAP.get(input) ?? null;
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
  const markName = markdownDelimiterMark(input);
  if (!close && !markName) return false;

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

  // A Markdown delimiter formats the selection rather than surrounding it with
  // characters, so the mark does the work and the selection is left alone.
  if (markName) {
    if (!state.schema.marks[markName]) return false;
    // No `.focus()`: the editor already has focus when a key produced this,
    // and the call fails without a view, which headless tests run without.
    return editor.commands.toggleMark(markName);
  }
  if (!close) return false;

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
 * `handleTextInput` covers delimiters typed as ordinary keypresses, which is
 * every direct key on every layout. Characters delivered through IME
 * composition instead — a macOS dead key such as Option+` then Space — arrive
 * on a path prosemirror-view deliberately keeps clear of text-input handling,
 * and insert literally rather than wrapping the selection.
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
