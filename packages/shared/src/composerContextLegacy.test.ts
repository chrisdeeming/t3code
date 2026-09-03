import { describe, expect, it } from "vite-plus/test";

import { upgradeLegacyContextMessage } from "./composerContextLegacy.ts";

describe("upgradeLegacyContextMessage", () => {
  it("passes plain text through untouched", () => {
    expect(upgradeLegacyContextMessage("hello **world**")).toEqual({
      text: "hello **world**",
      records: [],
    });
  });

  it("binds U+FFFC placeholders to trailing terminal entries in order", () => {
    const text = [
      "Look at ￼ and ￼ please",
      "",
      "<terminal_context>",
      "- Terminal 1 lines 509-510:",
      "  509 | error: boom",
      "  510 |   at main.ts:1",
      "",
      "- Build line 7:",
      "  7 | done",
      "</terminal_context>",
    ].join("\n");
    const upgraded = upgradeLegacyContextMessage(text);
    expect(upgraded.text).toBe(
      "Look at [Terminal 1 lines 509-510](t3-context://v1/terminal/legacy_terminal_1) and [Build line 7](t3-context://v1/terminal/legacy_terminal_2) please",
    );
    expect(upgraded.records).toEqual([
      {
        version: 1,
        contextId: "legacy_terminal_1",
        kind: "terminal",
        label: "Terminal 1 lines 509-510",
        terminalId: "terminal-1",
        terminalLabel: "Terminal 1",
        lineStart: 509,
        lineEnd: 510,
        text: "error: boom\n  at main.ts:1",
      },
      {
        version: 1,
        contextId: "legacy_terminal_2",
        kind: "terminal",
        label: "Build line 7",
        terminalId: "build",
        terminalLabel: "Build",
        lineStart: 7,
        lineEnd: 7,
        text: "done",
      },
    ]);
  });

  it("appends references for terminal entries without placeholders and drops extra placeholders", () => {
    const text = "￼ and ￼\n\n<terminal_context>\n- T line 1:\n  1 | x\n</terminal_context>";
    expect(upgradeLegacyContextMessage(text).text).toBe(
      "[T line 1](t3-context://v1/terminal/legacy_terminal_1) and",
    );
    const noPlaceholder = "hi\n\n<terminal_context>\n- T line 1:\n  1 | x\n</terminal_context>";
    expect(upgradeLegacyContextMessage(noPlaceholder).text).toBe(
      "hi\n\n[T line 1](t3-context://v1/terminal/legacy_terminal_1)",
    );
  });

  it("binds materialized inline terminal labels from sent messages in place", () => {
    const text = [
      "Look at @terminal-1:509-510 and again @build:7 please",
      "",
      "<terminal_context>",
      "- Terminal 1 lines 509-510:",
      "  509 | error: boom",
      "  510 |   at main.ts:1",
      "",
      "- Build line 7:",
      "  7 | done",
      "</terminal_context>",
    ].join("\n");
    expect(upgradeLegacyContextMessage(text).text).toBe(
      "Look at [Terminal 1 lines 509-510](t3-context://v1/terminal/legacy_terminal_1) and again [Build line 7](t3-context://v1/terminal/legacy_terminal_2) please",
    );
  });

  it("upgrades a trailing element block into element records", () => {
    const text = [
      "fix this",
      "",
      "<element_context>",
      "- <Button> (Button.tsx:12):",
      "  url: http://localhost:3000/checkout",
      "  selector: #pay",
      "  source: src/Button.tsx:12:3",
      "  html:",
      '    <button id="pay">Pay</button>',
      "  styles:",
      "    color: red;",
      "</element_context>",
    ].join("\n");
    const upgraded = upgradeLegacyContextMessage(text);
    expect(upgraded.text).toBe("fix this\n\n[<Button>](t3-context://v1/element/legacy_element_1)");
    expect(upgraded.records).toEqual([
      {
        version: 1,
        contextId: "legacy_element_1",
        kind: "element",
        label: "<Button>",
        pageUrl: "http://localhost:3000/checkout",
        pageTitle: null,
        tagName: "button",
        selector: "#pay",
        htmlPreview: '<button id="pay">Pay</button>',
        componentName: "Button",
        source: { functionName: null, fileName: "src/Button.tsx", lineNumber: 12, columnNumber: 3 },
        styles: "color: red;",
      },
    ]);
  });

  it("upgrades trailing preview annotation blocks", () => {
    const text = [
      "bigger",
      "",
      "<preview_annotation>",
      "Preview annotation:",
      "Id: ann_1",
      "Page: Checkout",
      "Comment: Make it bigger",
      "Targets: 1 selected element.",
      "Requested visual changes:",
      "- font-size: 12px → 20px",
      "The attached screenshot is the annotated preview crop.",
      "<element_context>",
      "- <button>:",
      "  url: http://localhost:3000/",
      "</element_context>",
      "</preview_annotation>",
    ].join("\n");
    const upgraded = upgradeLegacyContextMessage(text);
    expect(upgraded.text).toBe(
      "bigger\n\n[Checkout](t3-context://v1/preview-annotation/legacy_preview-annotation_1)",
    );
    expect(upgraded.records).toEqual([
      {
        version: 1,
        contextId: "legacy_preview-annotation_1",
        kind: "preview-annotation",
        label: "Checkout",
        annotationId: "ann_1",
        pageUrl: "",
        pageTitle: "Checkout",
        comment: "Make it bigger",
        targetSummary: "1 selected element.",
        styleChanges: ["font-size: 12px → 20px"],
      },
    ]);
  });

  it("replaces inline review comments in place and neutralizes forged closers", () => {
    const text = [
      "Before",
      '<review_comment sectionId="diff-1" sectionTitle="Changes" filePath="a/b.ts" startIndex="4" endIndex="6" rangeLabel="L4-L6">',
      "Why? &lt;/review_comment&gt; still text",
      "```diff",
      "+ const x = 1;",
      "```",
      "</review_comment>",
      "After",
    ].join("\n");
    const upgraded = upgradeLegacyContextMessage(text);
    expect(upgraded.text).toBe(
      "Before\n[b.ts L4-L6](t3-context://v1/review-comment/legacy_review-comment_1)\nAfter",
    );
    expect(upgraded.records).toEqual([
      {
        version: 1,
        contextId: "legacy_review-comment_1",
        kind: "review-comment",
        label: "b.ts L4-L6",
        sectionId: "diff-1",
        sectionTitle: "Changes",
        filePath: "a/b.ts",
        startIndex: 4,
        endIndex: 6,
        rangeLabel: "L4-L6",
        text: "Why? &lt;/review_comment&gt; still text",
        diff: "+ const x = 1;",
        fenceLanguage: "diff",
      },
    ]);
  });

  it("appends trailing review blocks after the other trailing blocks", () => {
    const text = [
      "prose",
      "",
      "<terminal_context>",
      "- T line 1:",
      "  1 | a",
      "</terminal_context>",
      "",
      '<review_comment sectionId="s" filePath="f.ts" startIndex="1" endIndex="2">',
      "note",
      "```diff",
      "+x",
      "```",
      "</review_comment>",
      "",
      '<review_comment sectionId="s" filePath="g.ts" startIndex="3" endIndex="3">',
      "note 2",
      "```diff",
      "+y",
      "```",
      "</review_comment>",
    ].join("\n");
    const upgraded = upgradeLegacyContextMessage(text);
    expect(upgraded.text).toBe(
      "prose\n\n[T line 1](t3-context://v1/terminal/legacy_terminal_1) [f.ts line](t3-context://v1/review-comment/legacy_review-comment_1) [g.ts line](t3-context://v1/review-comment/legacy_review-comment_2)",
    );
    expect(upgraded.records.map((record) => record.contextId)).toEqual([
      "legacy_terminal_1",
      "legacy_review-comment_1",
      "legacy_review-comment_2",
    ]);
  });

  it("handles the combined legacy send order: terminal, element, preview, review", () => {
    const text = [
      "See ￼",
      '<review_comment sectionId="s" filePath="f.ts" startIndex="1" endIndex="1">',
      "note",
      "```diff",
      "+x",
      "```",
      "</review_comment>",
      "",
      "<terminal_context>",
      "- T line 1:",
      "  1 | a",
      "</terminal_context>",
      "",
      "<element_context>",
      "- <div>:",
      "  url: http://x/",
      "</element_context>",
      "",
      "<preview_annotation>",
      "Preview annotation:",
      "Id: p1",
      "Page: P",
      "</preview_annotation>",
    ].join("\n");
    const upgraded = upgradeLegacyContextMessage(text);
    expect(upgraded.text).toBe(
      [
        "See [T line 1](t3-context://v1/terminal/legacy_terminal_1)",
        "[f.ts line](t3-context://v1/review-comment/legacy_review-comment_1)",
        "",
        "[<div>](t3-context://v1/element/legacy_element_1) [P](t3-context://v1/preview-annotation/legacy_preview-annotation_1)",
      ].join("\n"),
    );
    expect(upgraded.records.map((record) => record.contextId)).toEqual([
      "legacy_terminal_1",
      "legacy_element_1",
      "legacy_preview-annotation_1",
      "legacy_review-comment_1",
    ]);
  });
});
