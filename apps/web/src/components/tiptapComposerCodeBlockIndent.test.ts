import { describe, expect, it } from "vite-plus/test";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import {
  CODE_BLOCK_INDENT,
  indentCodeBlock,
  indentLines,
  indentedNewlineInCodeBlock,
  leadingWhitespace,
  outdentLine,
} from "./tiptapComposerCodeBlockIndent";
import { tiptapComposerExtensions } from "./tiptapComposerExtensions";

describe("leadingWhitespace", () => {
  it("reads the indent a new line should inherit", () => {
    expect(leadingWhitespace("    nested()")).toBe("    ");
    expect(leadingWhitespace("\tnested()")).toBe("\t");
    expect(leadingWhitespace("flush()")).toBe("");
  });

  it("stops at the first non-space so code is never treated as indent", () => {
    expect(leadingWhitespace("  a  b")).toBe("  ");
  });
});

describe("outdentLine", () => {
  it("removes a full indent when there is one", () => {
    expect(outdentLine("    deep")).toBe("  deep");
  });

  /** Hand-indented lines should still outdent rather than refuse to move. */
  it("falls back to a single space or tab", () => {
    expect(outdentLine(" odd")).toBe("odd");
    expect(outdentLine("\ttabbed")).toBe("tabbed");
  });

  it("bottoms out instead of eating code", () => {
    expect(outdentLine("flush()")).toBe("flush()");
  });
});

describe("indentLines", () => {
  it("indents every line it is given", () => {
    expect(indentLines(["a", "b"], "in")).toEqual([`${CODE_BLOCK_INDENT}a`, `${CODE_BLOCK_INDENT}b`]);
  });

  /** Indenting a blank line would leave whitespace the user cannot see. */
  it("leaves blank lines alone", () => {
    expect(indentLines(["a", "", "b"], "in")).toEqual([
      `${CODE_BLOCK_INDENT}a`,
      "",
      `${CODE_BLOCK_INDENT}b`,
    ]);
  });

  it("outdents every line it is given", () => {
    expect(indentLines(["    a", "  b", "c"], "out")).toEqual(["  a", "b", "c"]);
  });
});

/** Builds an editor holding a single fenced block, with the caret placed by offset. */
function codeEditor(code: string, at?: { from: number; to?: number }) {
  const editor = new Editor({
    extensions: tiptapComposerExtensions(),
    content: { type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: code }] }] },
  });
  const start = 1;
  const from = start + (at?.from ?? code.length);
  const to = start + (at?.to ?? at?.from ?? code.length);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
  return editor;
}

const textOf = (editor: Editor) => editor.state.doc.textContent;

describe("indentedNewlineInCodeBlock", () => {
  it("carries the current indentation onto the new line", () => {
    const editor = codeEditor("function f() {\n  body()");
    const handled = indentedNewlineInCodeBlock(editor.state, (tr) => editor.view.dispatch(tr));
    expect(handled).toBe(true);
    expect(textOf(editor)).toBe("function f() {\n  body()\n  ");
  });

  /**
   * With no indent to carry there is nothing to add, so the default newline
   * should handle it and stay a single undo step.
   */
  it("declines an unindented line", () => {
    const editor = codeEditor("flush()");
    expect(indentedNewlineInCodeBlock(editor.state, (tr) => editor.view.dispatch(tr))).toBe(false);
    expect(textOf(editor)).toBe("flush()");
  });

  it("indents from the line the caret is on, not the last line", () => {
    const editor = codeEditor("    deep()\nflush()", { from: 10 });
    indentedNewlineInCodeBlock(editor.state, (tr) => editor.view.dispatch(tr));
    expect(textOf(editor)).toBe("    deep()\n    \nflush()");
  });

  it("replaces the selected text rather than keeping it", () => {
    const editor = codeEditor("  keep()DROP", { from: 8, to: 12 });
    indentedNewlineInCodeBlock(editor.state, (tr) => editor.view.dispatch(tr));
    expect(textOf(editor)).toBe("  keep()\n  ");
  });

  it("does nothing outside a code block", () => {
    const editor = new Editor({
      extensions: tiptapComposerExtensions(),
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "  hi" }] }] },
    });
    expect(indentedNewlineInCodeBlock(editor.state, (tr) => editor.view.dispatch(tr))).toBe(false);
  });
});

describe("indentCodeBlock", () => {
  it("inserts an indent at a collapsed caret", () => {
    const editor = codeEditor("ab", { from: 1 });
    expect(indentCodeBlock(editor.state, "in", (tr) => editor.view.dispatch(tr))).toBe(true);
    expect(textOf(editor)).toBe(`a${CODE_BLOCK_INDENT}b`);
  });

  it("indents every line a selection touches", () => {
    const editor = codeEditor("one\ntwo\nthree", { from: 1, to: 9 });
    indentCodeBlock(editor.state, "in", (tr) => editor.view.dispatch(tr));
    expect(textOf(editor)).toBe("  one\n  two\n  three");
  });

  it("outdents every line a selection touches", () => {
    const editor = codeEditor("  one\n  two", { from: 2, to: 9 });
    indentCodeBlock(editor.state, "out", (tr) => editor.view.dispatch(tr));
    expect(textOf(editor)).toBe("one\ntwo");
  });

  /** Repeated Tab presses should keep working on the same block. */
  it("keeps the selection across the shifted lines", () => {
    const editor = codeEditor("one\ntwo", { from: 0, to: 7 });
    indentCodeBlock(editor.state, "in", (tr) => editor.view.dispatch(tr));
    indentCodeBlock(editor.state, "in", (tr) => editor.view.dispatch(tr));
    expect(textOf(editor)).toBe("    one\n    two");
  });

  it("reports handled when outdenting can go no further, so Tab never escapes the editor", () => {
    const editor = codeEditor("one\ntwo", { from: 0, to: 7 });
    expect(indentCodeBlock(editor.state, "out", (tr) => editor.view.dispatch(tr))).toBe(true);
    expect(textOf(editor)).toBe("one\ntwo");
  });

  it("does nothing outside a code block", () => {
    const editor = new Editor({
      extensions: tiptapComposerExtensions(),
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
    });
    expect(indentCodeBlock(editor.state, "in", (tr) => editor.view.dispatch(tr))).toBe(false);
  });
});
