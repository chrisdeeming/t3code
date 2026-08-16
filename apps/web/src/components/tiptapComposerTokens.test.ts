import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "~/lib/terminalContext";

import {
  composerTerminalContextIds,
  deleteAdjacentComposerToken,
  getTiptapComposerMarkdown,
  stampComposerTerminalContextIds,
  tiptapComposerExtensions,
} from "./tiptapComposerExtensions";

const DRAFTS = [{ id: "a" }, { id: "b" }, { id: "c" }];

const editors: Editor[] = [];

function createComposerEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: tiptapComposerExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}

function tokenPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "composerToken") positions.push(position);
  });
  return positions;
}

// The composerToken extension binds Backspace/Delete straight to this helper;
// `commands.keyboardShortcut` needs a DOM KeyboardEvent the node environment
// lacks, so drive the handler itself.
const pressBackspace = (editor: Editor) => deleteAdjacentComposerToken(editor, "before");
const pressDelete = (editor: Editor) => deleteAdjacentComposerToken(editor, "after");

describe("Tiptap composer tokens", () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  /**
   * A chip is one unit: an arrow key moving onto it should select it, which is
   * the step that lets the next Backspace remove the whole chip. Skipping past
   * it instead would make the chip unreachable from the keyboard.
   */
  it("keeps the token selectable so arrows and clicks can land on it", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");
    const [tokenPosition] = tokenPositions(editor);

    expect(editor.state.doc.nodeAt(tokenPosition!)?.type.spec.selectable).toBe(true);
  });

  it("selects a whole token as one unit rather than splitting it", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");
    const [tokenPosition] = tokenPositions(editor);

    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tokenPosition!)),
    );

    const selection = editor.state.selection;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.attrs).toMatchObject({
      kind: "mention",
      value: "src/config.json",
    });
  });

  it("deletes an entire mention token instead of part of its Markdown", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");
    const [tokenPosition] = tokenPositions(editor);

    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tokenPosition!)),
    );
    editor.commands.deleteSelection();

    expect(getTiptapComposerMarkdown(editor)).toBe("See  now");
    expect(tokenPositions(editor)).toEqual([]);
  });

  it("removes the token before the cursor on Backspace", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");
    const [tokenPosition] = tokenPositions(editor);

    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, tokenPosition! + 1)),
    );
    expect(pressBackspace(editor)).toBe(true);

    expect(tokenPositions(editor)).toEqual([]);
    expect(getTiptapComposerMarkdown(editor)).toBe("See  now");
  });

  it("removes the token after the cursor on Delete", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");
    const [tokenPosition] = tokenPositions(editor);

    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, tokenPosition!)),
    );
    expect(pressDelete(editor)).toBe(true);

    expect(tokenPositions(editor)).toEqual([]);
    expect(getTiptapComposerMarkdown(editor)).toBe("See  now");
  });

  it("deletes a terminal-context token so its draft can be released", () => {
    const editor = createComposerEditor(`Look ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} here`);
    const [tokenPosition] = tokenPositions(editor);

    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tokenPosition!)),
    );
    editor.commands.deleteSelection();

    expect(getTiptapComposerMarkdown(editor)).toBe("Look  here");
    expect(tokenPositions(editor)).toEqual([]);
  });

  it("keeps a skill token intact when deleting the character beside it", () => {
    const editor = createComposerEditor("Run $review now");
    const [tokenPosition] = tokenPositions(editor);

    // Cursor sits after the space that follows the token; Backspace eats the space.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, tokenPosition! + 2)),
    );
    pressBackspace(editor);

    expect(tokenPositions(editor)).toHaveLength(1);
    expect(getTiptapComposerMarkdown(editor)).toBe("Run $review now");
  });

  it("leaves deletion to the default chain when no token is adjacent", () => {
    const editor = createComposerEditor("plain text");
    editor.commands.setTextSelection(4);

    expect(deleteAdjacentComposerToken(editor, "before")).toBe(false);
    expect(deleteAdjacentComposerToken(editor, "after")).toBe(false);
    expect(getTiptapComposerMarkdown(editor)).toBe("plain text");
  });

  it("matches each terminal-context placeholder to a draft in order", () => {
    const editor = createComposerEditor(
      `one ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} two ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} three`,
    );

    stampComposerTerminalContextIds(editor, DRAFTS);

    expect(composerTerminalContextIds(editor.state.doc)).toEqual(["a", "b"]);
  });

  /**
   * The reported ids drive `syncTerminalContextsByIds`, which reconciles by id.
   * Reporting them positionally released the last draft instead of the deleted
   * one, so the user lost a context they had not touched.
   */
  it("releases the deleted draft when a middle chip is removed", () => {
    const editor = createComposerEditor(
      `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} x ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} y ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}`,
    );
    stampComposerTerminalContextIds(editor, DRAFTS);
    const middle = tokenPositions(editor)[1];

    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, middle!)),
    );
    editor.commands.deleteSelection();

    expect(composerTerminalContextIds(editor.state.doc)).toEqual(["a", "c"]);
  });

  it("keeps a stamped id when the document is edited around it", () => {
    const editor = createComposerEditor(`start ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} end`);
    stampComposerTerminalContextIds(editor, DRAFTS);

    editor.commands.setTextSelection(1);
    editor.view.dispatch(editor.state.tr.insertText("more "));

    expect(composerTerminalContextIds(editor.state.doc)).toEqual(["a"]);
  });

  it("does not reuse a draft that is already stamped elsewhere", () => {
    const editor = createComposerEditor(
      `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} and ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}`,
    );
    stampComposerTerminalContextIds(editor, DRAFTS);

    // Running again must be a no-op rather than re-assigning from the top.
    expect(stampComposerTerminalContextIds(editor, DRAFTS)).toBe(false);
    expect(composerTerminalContextIds(editor.state.doc)).toEqual(["a", "b"]);
  });

  it("carries only the attributes the composer needs", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");
    const [tokenPosition] = tokenPositions(editor);

    // `contextId` is only ever set on terminal-context tokens.
    expect(editor.state.doc.nodeAt(tokenPosition!)?.attrs).toEqual({
      kind: "mention",
      value: "src/config.json",
      contextId: null,
    });
  });
});
