import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "~/lib/terminalContext";

import {
  composerTerminalContextIndexBefore,
  deleteAdjacentComposerToken,
  getTiptapComposerMarkdown,
  tiptapComposerExtensions,
} from "./tiptapComposerExtensions";

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

  it("numbers terminal-context tokens by how many precede them", () => {
    const editor = createComposerEditor(
      `one ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} two ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} three`,
    );
    const positions = tokenPositions(editor);

    expect(
      positions.map((position) => composerTerminalContextIndexBefore(editor.state.doc, position)),
    ).toEqual([0, 1]);
  });

  /**
   * A walk that only skipped children would keep counting the token in the
   * second paragraph, giving the first chip the second draft's context.
   */
  it("does not count tokens that follow the position in a later block", () => {
    const editor = createComposerEditor(
      `first ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}\n\nsecond ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}`,
    );
    const [firstToken, secondToken] = tokenPositions(editor);

    expect(composerTerminalContextIndexBefore(editor.state.doc, firstToken!)).toBe(0);
    expect(composerTerminalContextIndexBefore(editor.state.doc, secondToken!)).toBe(1);
  });

  it("carries only the attributes Markdown round-trips", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");
    const [tokenPosition] = tokenPositions(editor);

    expect(editor.state.doc.nodeAt(tokenPosition!)?.attrs).toEqual({
      kind: "mention",
      value: "src/config.json",
    });
  });
});
