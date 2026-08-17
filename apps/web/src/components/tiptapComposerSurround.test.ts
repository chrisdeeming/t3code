import { Editor } from "@tiptap/core";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getTiptapComposerMarkdown, tiptapComposerExtensions } from "./tiptapComposerExtensions";
import {
  markdownDelimiterMark,
  surroundCloseSymbol,
  surroundComposerSelection,
} from "./tiptapComposerSurround";

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

function selectText(editor: Editor, needle: string): { from: number; to: number } {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "￼");
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`"${needle}" is not in the document`);
  // Document positions lead text offsets by the opening paragraph token.
  const from = index + 1;
  const to = from + needle.length;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
  return { from, to };
}

describe("Tiptap composer selection surround", () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  it("pairs the bracket and quote symbols with literal partners", () => {
    expect(surroundCloseSymbol("(")).toBe(")");
    expect(surroundCloseSymbol("[")).toBe("]");
    expect(surroundCloseSymbol("{")).toBe("}");
    expect(surroundCloseSymbol("<")).toBe(">");
    expect(surroundCloseSymbol("«")).toBe("»");
    expect(surroundCloseSymbol("a")).toBeNull();
  });

  /**
   * Markdown delimiters format instead of inserting characters. Typing them as
   * text left raw backticks on screen in a WYSIWYG editor, and `*` twice built
   * `**text**` as literal characters rather than bold.
   */
  it("maps Markdown delimiters to the mark they format with", () => {
    expect(markdownDelimiterMark("`")).toBe("code");
    expect(markdownDelimiterMark("*")).toBe("italic");
    expect(markdownDelimiterMark("_")).toBe("italic");
    expect(markdownDelimiterMark("~")).toBe("strike");
    expect(markdownDelimiterMark("(")).toBeNull();
  });

  it("applies inline code when a backtick is typed over a selection", () => {
    const editor = createComposerEditor("wrap this word");
    selectText(editor, "this");

    expect(surroundComposerSelection(editor, "`")).toBe(true);
    expect(getTiptapComposerMarkdown(editor)).toBe("wrap `this` word");
    expect(editor.isActive("code")).toBe(true);
  });

  it("surrounds with literal characters for a bracket", () => {
    const editor = createComposerEditor("wrap this word");
    selectText(editor, "this");

    expect(surroundComposerSelection(editor, "(")).toBe(true);
    expect(getTiptapComposerMarkdown(editor)).toBe("wrap (this) word");
  });

  it("keeps the original text selected inside the delimiters", () => {
    const editor = createComposerEditor("wrap this word");
    selectText(editor, "this");

    surroundComposerSelection(editor, "(");

    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("this");
  });

  /** Toggling means a second press removes the mark, rather than doubling it. */
  it("toggles a Markdown mark off when the delimiter is typed again", () => {
    const editor = createComposerEditor("wrap this word");
    selectText(editor, "this");

    surroundComposerSelection(editor, "*");
    expect(getTiptapComposerMarkdown(editor)).toBe("wrap *this* word");

    surroundComposerSelection(editor, "*");
    expect(getTiptapComposerMarkdown(editor)).toBe("wrap this word");
  });

  it("ignores characters that are not wrapping symbols", () => {
    const editor = createComposerEditor("wrap this word");
    selectText(editor, "this");

    expect(surroundComposerSelection(editor, "a")).toBe(false);
    expect(getTiptapComposerMarkdown(editor)).toBe("wrap this word");
  });

  it("does nothing without a selection", () => {
    const editor = createComposerEditor("wrap this word");
    editor.commands.setTextSelection(3);

    expect(surroundComposerSelection(editor, "`")).toBe(false);
  });

  it("refuses to wrap a range that spans a token", () => {
    const editor = createComposerEditor("see [config.json](src/config.json) now");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1),
      ),
    );

    expect(surroundComposerSelection(editor, "`")).toBe(false);
    expect(getTiptapComposerMarkdown(editor)).toBe("see [config.json](src/config.json) now");
  });

  /**
   * The delimiters would land in different paragraphs, e.g.
   * `first (para\n\nsec)ond para`.
   */
  it("refuses to wrap a selection that crosses a block boundary", () => {
    const editor = createComposerEditor("first para\n\nsecond para");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 17)),
    );

    expect(surroundComposerSelection(editor, "(")).toBe(false);
    expect(getTiptapComposerMarkdown(editor)).toBe("first para\n\nsecond para");
  });

  it("refuses to wrap inside a code block, where a delimiter is code", () => {
    const editor = createComposerEditor("```ts\nconst a = 1\n```");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7, 12)),
    );

    expect(surroundComposerSelection(editor, "`")).toBe(false);
    expect(getTiptapComposerMarkdown(editor)).toBe("```ts\nconst a = 1\n```");
  });

  it("keeps a backwards selection backwards after wrapping", () => {
    const editor = createComposerEditor("wrap this word");
    editor.view.dispatch(
      // anchor after head: the user extended leftwards.
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 10, 6)),
    );

    surroundComposerSelection(editor, "(");

    const { anchor, head } = editor.state.selection;
    expect(anchor).toBeGreaterThan(head);
    expect(editor.state.doc.textBetween(head, anchor)).toBe("this");
  });

  /**
   * The composer binds Cmd/Ctrl+A to an AllSelection, whose ends resolve at the
   * document rather than a textblock. That made `sameParent` trivially true and
   * `parent.type.spec.code` undefined, so the block and code guards both passed
   * and the whole prompt got wrapped.
   */
  it("refuses to wrap a whole-document selection", () => {
    const editor = createComposerEditor("first para\n\nsecond para");
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));

    expect(surroundComposerSelection(editor, "(")).toBe(false);
    expect(getTiptapComposerMarkdown(editor)).toBe("first para\n\nsecond para");
  });

  it("refuses a whole-document selection over a code block", () => {
    const editor = createComposerEditor("```ts\nconst a = 1\n```");
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));

    expect(surroundComposerSelection(editor, "`")).toBe(false);
    expect(getTiptapComposerMarkdown(editor)).toBe("```ts\nconst a = 1\n```");
  });

  it("still wraps a selection that spans marks within one paragraph", () => {
    const editor = createComposerEditor("hello **bold** world");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 15)),
    );

    expect(surroundComposerSelection(editor, "(")).toBe(true);
    expect(getTiptapComposerMarkdown(editor)).toBe("(hello **bold** wor)ld");
  });

  it("refuses to swallow the whitespace a token needs beside it", () => {
    const editor = createComposerEditor("see [config.json](src/config.json) now");
    // Selects the space directly after the token plus the following word.
    const tokenEnd = editor.state.doc.content.size - 5;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, tokenEnd, editor.state.doc.content.size - 1),
      ),
    );

    expect(surroundComposerSelection(editor, "`")).toBe(false);
  });
});
