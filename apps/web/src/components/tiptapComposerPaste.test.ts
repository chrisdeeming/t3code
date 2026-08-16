import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getTiptapComposerMarkdown, tiptapComposerExtensions } from "./tiptapComposerExtensions";
import { composerPasteContent, pasteAbutsNonWhitespace } from "./tiptapComposerPaste";

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
});
