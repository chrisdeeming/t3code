import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getTiptapComposerMarkdown, tiptapComposerExtensions } from "./tiptapComposerExtensions";
import { composerPasteContent } from "./tiptapComposerPaste";

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

/** Applies what the paste handler would insert at the current selection. */
function paste(editor: Editor, text: string, precedingCharacter = ""): boolean {
  const content = composerPasteContent(text, precedingCharacter);
  if (!content) return false;
  editor.commands.insertContent(content);
  return true;
}

describe("Tiptap composer paste", () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  it("declines text without a canonical file link so the default paste runs", () => {
    expect(composerPasteContent("just some prose", "")).toBeNull();
    expect(composerPasteContent("see https://example.com/a.ts for details", "")).toBeNull();
  });

  it("turns a pasted file link into a mention atom", () => {
    const editor = createComposerEditor("start ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(paste(editor, "[config.json](src/config.json)")).toBe(true);

    const tokens = editor
      .getJSON()
      .content?.[0]?.content?.filter((node) => node.type === "composerToken");
    expect(tokens).toEqual([
      { type: "composerToken", attrs: { kind: "mention", value: "src/config.json" } },
    ]);
  });

  it("adds the trailing space a mention needs to stay parseable", () => {
    const editor = createComposerEditor("start ");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    paste(editor, "[config.json](src/config.json)");

    expect(getTiptapComposerMarkdown(editor)).toBe("start [config.json](src/config.json) ");
  });

  it("adds a leading space when the mention would abut existing text", () => {
    const content = composerPasteContent("[config.json](src/config.json)", "x");

    expect(content?.[0]).toEqual({ type: "text", text: " " });
  });

  it("does not add a leading space after whitespace", () => {
    const content = composerPasteContent("[config.json](src/config.json)", " ");

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
    const content = composerPasteContent("[a.ts](src/a.ts) and [b.ts](src/b.ts)", "");

    expect(content?.filter((node) => node.type === "composerToken")).toEqual([
      { type: "composerToken", attrs: { kind: "mention", value: "src/a.ts" } },
      { type: "composerToken", attrs: { kind: "mention", value: "src/b.ts" } },
    ]);
  });

  it("keeps multi-line pastes on separate lines", () => {
    const content = composerPasteContent("[a.ts](src/a.ts)\nsecond line", "");

    expect(content).toEqual([
      { type: "composerToken", attrs: { kind: "mention", value: "src/a.ts" } },
      { type: "hardBreak" },
      { type: "text", text: "second line" },
    ]);
  });

  it("leaves scoped package references as plain text", () => {
    expect(composerPasteContent("npm install @scope/pkg", "")).toBeNull();
  });
});
