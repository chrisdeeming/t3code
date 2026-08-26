import { Editor } from "@tiptap/core";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getTiptapComposerMarkdown, tiptapComposerExtensions } from "./tiptapComposerExtensions";
import {
  composerPasteAppliesTo,
  composerPasteContent,
  pasteAbutsNonWhitespace,
  pasteAbutsNonWhitespaceAfter,
  pastedTextLooksLikeMarkdown,
  plainTextContent,
} from "./tiptapComposerPaste";

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

/** Whether a paste here may build structure, rather than staying literal. */
const pasteMayCreateStructure = (editor: Editor) => composerPasteAppliesTo(editor.state.selection);

function tokenPosition(editor: Editor): number {
  let position = -1;
  editor.state.doc.descendants((node, nodePosition) => {
    if (node.type.name === "composerToken") position = nodePosition;
  });
  return position;
}

/** Applies what the paste handler would insert at the current selection. */
function paste(editor: Editor, text: string, abutsNonWhitespace = false): boolean {
  const content = composerPasteContent(text, abutsNonWhitespace);
  if (!content) return false;
  editor.commands.insertContent(content);
  return true;
}

describe("Tiptap composer paste", () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  it("declines text without a canonical file link so the default paste runs", () => {
    expect(composerPasteContent("just some prose", false)).toBeNull();
    expect(composerPasteContent("see https://example.com/a.ts for details", false)).toBeNull();
  });

  it("turns a pasted file link into a mention atom", () => {
    const editor = createComposerEditor("start ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(paste(editor, "[config.json](src/config.json)")).toBe(true);

    const tokens = editor
      .getJSON()
      .content?.[0]?.content?.filter((node) => node.type === "composerToken");
    expect(tokens).toEqual([
      {
        type: "composerToken",
        attrs: { kind: "mention", value: "src/config.json", contextId: null },
      },
    ]);
  });

  it("adds the trailing space a mention needs to stay parseable", () => {
    const editor = createComposerEditor("start ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    paste(editor, "[config.json](src/config.json)");

    expect(getTiptapComposerMarkdown(editor)).toBe("start [config.json](src/config.json) ");
  });

  it("adds a leading space when the mention would abut existing text", () => {
    const content = composerPasteContent("[config.json](src/config.json)", true);

    expect(content?.[0]).toEqual({ type: "text", text: " " });
  });

  it("does not add a leading space after whitespace", () => {
    const content = composerPasteContent("[config.json](src/config.json)", false);

    expect(content?.[0]).toEqual({
      type: "composerToken",
      attrs: { kind: "mention", value: "src/config.json" },
    });
  });

  it("keeps the text around a pasted mention", () => {
    const editor = createComposerEditor("start ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    paste(editor, "check [config.json](src/config.json) then run");

    expect(getTiptapComposerMarkdown(editor)).toBe(
      "start check [config.json](src/config.json) then run",
    );
  });

  it("converts several mentions in one paste", () => {
    const content = composerPasteContent("[a.ts](src/a.ts) and [b.ts](src/b.ts)", false);

    expect(content?.filter((node) => node.type === "composerToken")).toEqual([
      { type: "composerToken", attrs: { kind: "mention", value: "src/a.ts" } },
      { type: "composerToken", attrs: { kind: "mention", value: "src/b.ts" } },
    ]);
  });

  it("keeps multi-line pastes on separate lines", () => {
    const content = composerPasteContent("[a.ts](src/a.ts)\nsecond line", false);

    expect(content).toEqual([
      { type: "composerToken", attrs: { kind: "mention", value: "src/a.ts" } },
      { type: "hardBreak" },
      { type: "text", text: "second line" },
    ]);
  });

  it("leaves scoped package references as plain text", () => {
    expect(composerPasteContent("npm install @scope/pkg", false)).toBeNull();
  });

  /**
   * Checking only `$from` let a range that started in prose and ended in a
   * fence through: the paste replaced the selection, deleting the code block
   * and leaving a chip where the fence had been.
   */
  it("keeps a paste literal when the selection reaches into a code block", () => {
    const editor = createComposerEditor("para text\n\n```\ncode here\n```");
    const codeBlockStart = editor.state.doc.content.size - 11;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 5, codeBlockStart)),
    );

    expect(pasteMayCreateStructure(editor)).toBe(false);
  });

  it("keeps a paste literal for a whole-document selection", () => {
    const editor = createComposerEditor("```\ncode here\n```");
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));

    expect(pasteMayCreateStructure(editor)).toBe(false);
  });

  /**
   * Typing a fence builds a code block, so pasting the same source has to as
   * well. Previously no handler ran, ProseMirror's default split the text into
   * one paragraph per line, and the block never appeared.
   */
  it("recognises block-level Markdown so a pasted fence becomes a code block", () => {
    expect(pastedTextLooksLikeMarkdown("```php\n<?php\n```")).toBe(true);
    expect(pastedTextLooksLikeMarkdown("# Title")).toBe(true);
    expect(pastedTextLooksLikeMarkdown("- one\n- two")).toBe(true);
    expect(pastedTextLooksLikeMarkdown("1. one")).toBe(true);
    expect(pastedTextLooksLikeMarkdown("> quoted")).toBe(true);
  });

  /**
   * A paste can carry both a file link and block structure. Checking mentions
   * first returned early and traded the list, the fences and the blank lines
   * for the single chip inside them.
   */
  it("treats text with both a mention and block structure as Markdown", () => {
    expect(pastedTextLooksLikeMarkdown("- Brief: [notes.md](/tmp/notes.md)")).toBe(true);
    expect(composerPasteContent("- Brief: [notes.md](/tmp/notes.md)\n", false)).not.toBeNull();
  });

  /**
   * Emphasis characters are everywhere in prose and code. Treating them as a
   * signal would rewrite text the user pasted literally.
   */
  it("leaves prose and code snippets alone", () => {
    expect(pastedTextLooksLikeMarkdown("just some prose")).toBe(false);
    expect(pastedTextLooksLikeMarkdown("fix __init__ please")).toBe(false);
    expect(pastedTextLooksLikeMarkdown("a * b and c_d_e")).toBe(false);
    expect(pastedTextLooksLikeMarkdown('Traceback:\n  File "a.py", line 3')).toBe(false);
  });

  /**
   * ProseMirror's default made a paragraph per line, which serializes with a
   * blank line between each — a pasted stack trace arrived double-spaced.
   */
  it("keeps newlines single when inserting plain text", () => {
    const editor = createComposerEditor("start");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    editor.commands.insertContent(plainTextContent("line 1\nline 2\nline 3"));

    expect(getTiptapComposerMarkdown(editor)).toBe("startline 1\nline 2\nline 3");
  });

  /**
   * `textBetween` skips atom nodes, so measuring the neighbour by position
   * reported nothing next to a chip. The pasted mention then fused with the
   * existing one and re-parsing the prompt found a single token.
   */
  it("treats an existing chip as a neighbour that needs separating", () => {
    const editor = createComposerEditor("see [a.ts](src/a.ts) ");
    const tokenEnd = tokenPosition(editor) + 1;
    editor.commands.setTextSelection(tokenEnd);

    expect(pasteAbutsNonWhitespace(editor.state.doc.resolve(tokenEnd))).toBe(true);
  });

  it("does not need a separator when the cursor follows a space", () => {
    const editor = createComposerEditor("see a file ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(pasteAbutsNonWhitespace(editor.state.selection.$from)).toBe(false);
  });

  it("needs a separator when the cursor follows a word character", () => {
    const editor = createComposerEditor("see");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(pasteAbutsNonWhitespace(editor.state.selection.$from)).toBe(true);
  });

  /**
   * Pasting a mention over a selected chip left the spaces that surrounded the
   * chip in place, so the trailing space the grammar adds became a second one
   * and the prompt grew a space on every such paste.
   */
  it("omits the trailing space when whitespace already follows the paste", () => {
    const content = composerPasteContent("[a.ts](src/a.ts)", false, false);

    expect(content?.at(-1)).toEqual({
      type: "composerToken",
      attrs: { kind: "mention", value: "src/a.ts" },
    });
  });

  it("keeps the trailing space when real text follows the paste", () => {
    const content = composerPasteContent("[a.ts](src/a.ts)", false, true);

    expect(content?.at(-1)).toEqual({ type: "text", text: " " });
  });

  it("reads whitespace from the node after the selection", () => {
    const editor = createComposerEditor("lead [a.ts](src/a.ts) tail");
    const { doc } = editor.state;
    let chipPos = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "composerToken") chipPos = pos;
    });

    // Replacing the chip: " tail" follows it, so no separator is needed.
    expect(pasteAbutsNonWhitespaceAfter(TextSelection.create(doc, chipPos, chipPos + 1).$to)).toBe(
      false,
    );
    // A caret at the start sits against "lead", which does need one.
    expect(pasteAbutsNonWhitespaceAfter(TextSelection.create(doc, 1, 1).$to)).toBe(true);
  });

  /** Nothing after the caret means nothing to fuse with. */
  it("treats the end of a block as whitespace", () => {
    const editor = createComposerEditor("lead ");
    const end = TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1);

    expect(pasteAbutsNonWhitespaceAfter(end.$to)).toBe(false);
  });
});
