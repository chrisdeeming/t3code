import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "~/lib/terminalContext";

import {
  convertTiptapCodeFenceOnEnter,
  serializeTiptapComposerWithCursor,
  shouldConvertTiptapCodeFenceForEnter,
  tiptapComposerPositionForExpandedCursor,
} from "./TiptapComposerPromptEditor";
import { getTiptapComposerMarkdown, tiptapComposerExtensions } from "./tiptapComposerExtensions";

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

describe("Tiptap composer Markdown", () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
  });

  it("does not register StarterKit's automatic trailing node", () => {
    const editor = createComposerEditor("```ts\ntest\n```");

    expect(
      editor.extensionManager.extensions.some((extension) => extension.name === "trailingNode"),
    ).toBe(false);
  });

  it("round-trips the Markdown features intended for the composer", () => {
    const markdown = [
      "Use **bold**, *italic*, `inline code`, and [a link](https://example.com).",
      "",
      "> Then explain:",
      "",
      "- one",
      "- two",
      "",
      "```ts",
      "const answer = 42",
      "```",
    ].join("\n");

    expect(getTiptapComposerMarkdown(createComposerEditor(markdown))).toBe(markdown);
  });

  it("parses and serializes T3 inline tokens as atomic nodes", () => {
    const markdown = `Inspect [config.json](src/config.json) with $review ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} please`;
    const editor = createComposerEditor(markdown);
    const tokens = editor
      .getJSON()
      .content?.[0]?.content?.filter((node) => node.type === "composerToken");

    expect(tokens).toEqual([
      {
        type: "composerToken",
        attrs: { kind: "mention", value: "src/config.json", contextId: null },
      },
      { type: "composerToken", attrs: { kind: "skill", value: "review", contextId: null } },
      { type: "composerToken", attrs: { kind: "terminal-context", value: "", contextId: null } },
    ]);
    expect(getTiptapComposerMarkdown(editor)).toBe(markdown);
  });

  /**
   * The token grammar requires whitespace after a match, which a token at the
   * end of a line does not have, so a file link closing a list item stayed raw
   * Markdown instead of becoming a chip.
   */
  it("recognises a file link that ends its line", () => {
    const markdown = "- Brief: [notes.md](/tmp/notes.md)";
    const editor = createComposerEditor(markdown);
    let mentions = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "composerToken") mentions += 1;
    });

    expect(mentions).toBe(1);
    expect(getTiptapComposerMarkdown(editor)).toBe(markdown);
  });

  it("recognises a file link that ends the document", () => {
    const editor = createComposerEditor("See [notes.md](/tmp/notes.md)");
    let mentions = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "composerToken") mentions += 1;
    });

    expect(mentions).toBe(1);
  });

  /**
   * marked autolinks a typed URL into a link mark, which the serializer then
   * writes as `[https://x](https://x)` — the user's URL duplicated in a prompt
   * they never marked up.
   */
  it.each([
    "see https://example.com/x now",
    "bare https://example.com at end",
    "mail me@example.com now",
  ])("keeps a typed URL or email bare: %j", (markdown) => {
    expect(getTiptapComposerMarkdown(createComposerEditor(markdown))).toBe(markdown);
  });

  /**
   * A mention for a file in the repo root serializes with a matching label and
   * href, exactly like an autolink. Collapsing it would turn a chip back into
   * plain text, so the collapse only applies to real URL and email shapes.
   */
  it.each(["see [notes.md](notes.md) now", "see [a.ts](a.ts) now"])(
    "keeps a root-level mention intact: %j",
    (markdown) => {
      const editor = createComposerEditor(markdown);
      let chips = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "composerToken") chips += 1;
      });

      expect(chips).toBe(1);
      expect(getTiptapComposerMarkdown(editor)).toBe(markdown);
    },
  );

  /**
   * Stock Markdown emphasis, underscores included, so what the composer shows
   * matches what the chat renderer does with the same text. The cost is that
   * typing `__init__` or `MAX_SIZE` formats mid-word; the fix for code is to
   * put it in inline code or a fence. Under review — see
   * `.t3/tiptap-composer/TODO.md`.
   *
   * Input rules only fire against a live view, so this asserts the registration
   * that drives them; the typed behavior is checked in the browser.
   */
  it("keeps the stock underscore input rules for bold and italic", () => {
    const editor = createComposerEditor("x");
    const underscorePatterns = editor.extensionManager.extensions
      .filter((extension) => extension.name === "bold" || extension.name === "italic")
      .flatMap((extension) => {
        const addInputRules = extension.config.addInputRules as
          | (() => ReadonlyArray<{ find: unknown }>)
          | undefined;
        const context = {
          name: extension.name,
          options: extension.options,
          storage: {},
          editor,
          type: editor.schema.marks[extension.name],
        };
        return (addInputRules?.call(context as never) ?? []).map((rule) => rule.find);
      })
      .filter((pattern) => pattern instanceof RegExp && pattern.source.includes("_"));

    expect(underscorePatterns.length).toBeGreaterThan(0);
  });

  it("leaves ordinary Markdown links and scoped packages alone", () => {
    const markdown = "Read [Tiptap](https://tiptap.dev) then run npm install @scope/pkg now";
    const editor = createComposerEditor(markdown);
    const tokens = editor
      .getJSON()
      .content?.[0]?.content?.filter((node) => node.type === "composerToken");

    expect(tokens).toEqual([]);
    expect(getTiptapComposerMarkdown(editor)).toBe(markdown);
  });

  it.each([
    "first line\nsecond line",
    "one\n\n\n\nthree",
    "npm install @scope/pkg && echo '$PATH'",
    "A <tag> should remain literal",
  ])("preserves coding-composer edge case %j", (markdown) => {
    expect(getTiptapComposerMarkdown(createComposerEditor(markdown))).toBe(markdown);
  });

  /**
   * Markdown backslash escapes are consumed while parsing, before the editor
   * sees the text, so they cannot be reproduced on the way out. The escaped
   * character itself survives, which is what the prompt is about.
   */
  it("drops backslash escapes from Markdown loaded into the editor", () => {
    const editor = createComposerEditor("Keep \\*these\\* characters literal");

    expect(getTiptapComposerMarkdown(editor)).toBe("Keep *these* characters literal");
  });

  it("keeps a backslash the user types rather than doubling it", () => {
    const editor = createComposerEditor("windows");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.dispatch(editor.state.tr.insertText(" C:\\Users\\me"));

    expect(getTiptapComposerMarkdown(editor)).toBe("windows C:\\Users\\me");
  });

  it("emits incomplete Markdown exactly as the user typed it", () => {
    const editor = createComposerEditor("**unfinished emphasis");

    expect(getTiptapComposerMarkdown(editor)).toBe("**unfinished emphasis");
  });

  it.each([
    "path/to_file_name.ts",
    "array[0] and list[1]",
    "call foo(a, b) then bar_baz()",
    "grep -n 'x' | wc -l",
  ])("sends coding prompt text through unescaped: %j", (markdown) => {
    expect(getTiptapComposerMarkdown(createComposerEditor(markdown))).toBe(markdown);
  });

  it("maps ProseMirror positions through Markdown delimiters", () => {
    const editor = createComposerEditor("Use **bold** now");

    expect(serializeTiptapComposerWithCursor(editor, 7)).toEqual({
      value: "Use **bold** now",
      expandedCursor: 8,
    });
    expect(tiptapComposerPositionForExpandedCursor(editor, 8)).toBe(7);
  });

  it("maps positions around serialized composer atoms", () => {
    const editor = createComposerEditor("See [config.json](src/config.json) now");

    expect(serializeTiptapComposerWithCursor(editor, 5).expandedCursor).toBe(4);
    expect(serializeTiptapComposerWithCursor(editor, 6).expandedCursor).toBe(34);
    expect(tiptapComposerPositionForExpandedCursor(editor, 34)).toBe(6);
  });

  it("maps whole-document selection boundaries without creating paragraphs", () => {
    const editor = createComposerEditor("first\n\nsecond");

    expect(serializeTiptapComposerWithCursor(editor, 0)).toEqual({
      value: "first\n\nsecond",
      expandedCursor: 0,
    });
    expect(serializeTiptapComposerWithCursor(editor, editor.state.doc.content.size)).toEqual({
      value: "first\n\nsecond",
      expandedCursor: 13,
    });
  });

  it("does not change Markdown while mapping positions in trailing empty paragraphs", () => {
    const editor = new Editor({
      extensions: tiptapComposerExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "test" }] },
          { type: "paragraph" },
          { type: "paragraph" },
        ],
      },
    });
    editors.push(editor);
    const value = getTiptapComposerMarkdown(editor);
    const document = editor.getJSON();

    for (let position = 1; position < editor.state.doc.content.size; position += 1) {
      expect(serializeTiptapComposerWithCursor(editor, position).value).toBe(value);
      expect(editor.getJSON()).toEqual(document);
    }
  });

  it("loads list and fenced-code nodes from Markdown", () => {
    const editor = createComposerEditor("- one\n- two\n\n```ts\nconst answer = 42\n```");

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["bulletList", "codeBlock"]);
  });

  it.each([
    ["```", null],
    ["```ts", "ts"],
    ["```objective-c", "objective-c"],
    ["```c++", "c++"],
  ])("turns %s into an empty code block on Enter", (fence, language) => {
    const editor = new Editor({
      extensions: tiptapComposerExtensions(),
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: fence }] }],
      },
    });
    editors.push(editor);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(
      convertTiptapCodeFenceOnEnter(editor.state, (transaction) =>
        editor.view.dispatch(transaction),
      ),
    ).toBe(true);
    expect(editor.getJSON().content).toEqual([{ type: "codeBlock", attrs: { language } }]);
  });

  it("reserves modifier-Enter for submission instead of converting a fence", () => {
    expect(
      shouldConvertTiptapCodeFenceForEnter({
        key: "Enter",
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBe(false);
    expect(
      shouldConvertTiptapCodeFenceForEnter({
        key: "Enter",
        shiftKey: false,
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe(false);
  });

  it("keeps a trailing code-block escape paragraph out of Markdown", () => {
    const editor = createComposerEditor("```ts\nconst answer = 42\n```");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(editor.commands.exitCode()).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["codeBlock", "paragraph"]);
    expect(getTiptapComposerMarkdown(editor)).toBe("```ts\nconst answer = 42\n```");
    expect(
      serializeTiptapComposerWithCursor(editor, editor.state.selection.anchor).expandedCursor,
    ).toBe(getTiptapComposerMarkdown(editor).length);
    expect(
      tiptapComposerPositionForExpandedCursor(editor, getTiptapComposerMarkdown(editor).length),
    ).toBe(editor.state.doc.content.size - 1);

    editor.view.dispatch(editor.state.tr.insertText("Explain this code"));
    expect(getTiptapComposerMarkdown(editor)).toBe(
      "```ts\nconst answer = 42\n```\n\nExplain this code",
    );
  });

  it("keeps a trailing blockquote escape paragraph out of Markdown", () => {
    const editor = new Editor({
      extensions: tiptapComposerExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }],
          },
          { type: "paragraph" },
        ],
      },
    });
    editors.push(editor);

    expect(getTiptapComposerMarkdown(editor)).toBe("> quoted");
  });

  /**
   * The composer suppresses its trigger menu inside a fence by asking the
   * editor whether the caret's parent is a code block — the flat prompt text
   * cannot tell a fence's first line from a paragraph, so a `/` that is simply
   * code would otherwise offer commands.
   */
  it("marks a code block as code so the trigger menu can be suppressed there", () => {
    const editor = createComposerEditor("```js\nconst x = 1;\n```");
    editor.commands.setTextSelection(3);

    expect(editor.state.selection.$from.parent.type.spec.code).toBe(true);
  });

  it("leaves a paragraph and a list item unmarked, so the menu still opens", () => {
    for (const markdown of ["plain text", "- list item"]) {
      const editor = createComposerEditor(markdown);
      editor.commands.setTextSelection(3);

      expect(editor.state.selection.$from.parent.type.spec.code).not.toBe(true);
    }
  });
});
