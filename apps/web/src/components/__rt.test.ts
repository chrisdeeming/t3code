import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vite-plus/test";
import { tiptapComposerExtensions, getTiptapComposerMarkdown } from "./tiptapComposerExtensions";

describe("autocomplete-style splice", () => {
  it("shows whether typing then setContent rewrites the text", () => {
    for (const typed of [
      "fix __init__ please",
      "see https://example.com/path please",
      "use _emphasis_ here",
    ]) {
      // Simulate: user types plain text (no parse), then a controlled update
      // re-parses the whole prompt as autocomplete insertion does.
      const e = new Editor({
        extensions: tiptapComposerExtensions(),
        content: "x",
        contentType: "markdown",
      });
      e.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: typed }] }],
      });
      const afterTyping = getTiptapComposerMarkdown(e);
      e.commands.setContent(afterTyping, { contentType: "markdown" });
      const afterReparse = getTiptapComposerMarkdown(e);
      console.log(JSON.stringify(typed));
      console.log(
        "  typed  ->",
        JSON.stringify(afterTyping),
        afterTyping === typed ? "OK" : "CHANGED",
      );
      console.log(
        "  reparse->",
        JSON.stringify(afterReparse),
        afterReparse === typed ? "OK" : "CHANGED",
      );
      e.destroy();
    }
    expect(true).toBe(true);
  });
});
