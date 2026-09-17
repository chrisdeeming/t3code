import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getTiptapComposerMarkdown, tiptapComposerExtensions } from "./tiptapComposerExtensions";
import { replaceChangedSpan } from "./TiptapComposerPromptEditor";

const editors: Editor[] = [];

/**
 * An editor holding text the user typed, rather than text parsed from Markdown.
 * Typing is what preserves `__init__`; a parse is what rewrites it, so the
 * distinction is the whole point of these tests.
 */
function typedEditor(text: string): Editor {
  const editor = new Editor({
    extensions: tiptapComposerExtensions(),
    content: "seed",
    contentType: "markdown",
  });
  editor.commands.setContent({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  editors.push(editor);
  return editor;
}

function chipCount(editor: Editor): number {
  let chips = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "composerToken") chips += 1;
  });
  return chips;
}

describe("composer controlled updates", () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  /**
   * Autocomplete replaces one range but used to send the whole prompt back
   * through the Markdown parser, which rewrote text the user never touched:
   * `__init__` became `**init**` and a bare URL became a link — mid-sentence,
   * as they picked a file.
   */
  it("leaves text outside the replaced range exactly as typed", () => {
    const typed = "fix __init__ and see https://example.com/x @sr";
    const editor = typedEditor(typed);

    const handled = replaceChangedSpan(editor, typed, typed.replace("@sr", "[a.ts](src/a.ts) "));

    expect(handled).toBe(true);
    expect(getTiptapComposerMarkdown(editor)).toBe(
      "fix __init__ and see https://example.com/x [a.ts](src/a.ts) ",
    );
  });

  it("still parses the inserted span, so a file link becomes a chip", () => {
    const typed = "see @sr";
    const editor = typedEditor(typed);

    replaceChangedSpan(editor, typed, "see [a.ts](src/a.ts) ");

    expect(chipCount(editor)).toBe(1);
  });

  it("widens an autocomplete diff so a completed skill becomes a chip", () => {
    const typed = "use $pinch";
    const editor = typedEditor(typed);

    replaceChangedSpan(editor, typed, "use $pinchtab ");

    expect(chipCount(editor)).toBe(1);
    expect(getTiptapComposerMarkdown(editor)).toBe("use $pinchtab ");
  });

  it("promotes a fully typed skill when autocomplete only adds its trailing space", () => {
    const typed = "use $pinchtab";
    const editor = typedEditor(typed);

    replaceChangedSpan(editor, typed, "use $pinchtab ");

    expect(chipCount(editor)).toBe(1);
  });

  it("handles a pure insertion with no replaced text", () => {
    const typed = "hello world";
    const editor = typedEditor(typed);

    expect(replaceChangedSpan(editor, typed, "hello brave world")).toBe(true);
    expect(getTiptapComposerMarkdown(editor)).toBe("hello brave world");
  });

  it("handles a pure deletion", () => {
    const typed = "hello brave world";
    const editor = typedEditor(typed);

    expect(replaceChangedSpan(editor, typed, "hello world")).toBe(true);
    expect(getTiptapComposerMarkdown(editor)).toBe("hello world");
  });

  /** Block syntax reshapes the document, which a span replacement cannot do. */
  it("declines an edit that introduces block structure", () => {
    const typed = "a line";
    const editor = typedEditor(typed);

    expect(replaceChangedSpan(editor, typed, "a line\n\n# heading")).toBe(false);
  });

  it("declines when the value changes to something unrelated", () => {
    const typed = "one two three";
    const editor = typedEditor(typed);

    // No shared prefix or suffix: the whole document is the changed span, and a
    // full parse is the honest way to apply it.
    expect(replaceChangedSpan(editor, typed, "# totally different\n\n- list")).toBe(false);
  });
});
