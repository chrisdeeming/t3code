import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  decodeComposerContextFragment,
  encodeComposerContextFragment,
  encodeComposerContextClipboardHtml,
  decodeComposerContextClipboardHtml,
} from "./composerContextClipboard.ts";

describe("composerContextClipboard", () => {
  it("round-trips native/browser HTML without interpreting captured content as markup", () => {
    const raw = JSON.stringify({
      version: 1,
      source: { environmentId: "env-1" },
      records: [
        {
          version: 1,
          kind: "terminal",
          contextId: "terminal",
          label: 'Build "failure"',
          terminalId: "main",
          terminalLabel: "Main",
          lineStart: 1,
          lineEnd: 1,
          text: "<script> & café",
        },
      ],
    });
    const html = encodeComposerContextClipboardHtml("<script> & café", raw);
    expect(html).toContain("&lt;script&gt; &amp; café");
    expect(html).not.toContain("<script>");
    expect(decodeComposerContextClipboardHtml(html)).toEqual(JSON.parse(raw));
    expect(
      decodeComposerContextClipboardHtml('<pre data-t3-context-fragment="%ZZ">bad</pre>'),
    ).toBeNull();
    expect(decodeComposerContextClipboardHtml("<p>Ordinary clipboard</p>")).toBeNull();
  });
  it("round-trips a fragment and drops records it cannot decode", () => {
    const encoded = encodeComposerContextFragment({
      version: 1,
      source: { environmentId: "env-1" as never, threadId: "thread-1" as never },
      records: [
        { version: 1, contextId: "ctx-1" as never, kind: "skill", label: "$x", name: "x" },
        { version: 1, contextId: "ctx-2" as never, kind: "image", label: "bad" } as never,
      ],
    });
    const decoded = decodeComposerContextFragment(encoded);
    expect(decoded?.source.threadId).toBe("thread-1");
    expect(decoded?.records.map((record) => record.contextId)).toEqual(["ctx-1"]);
  });

  it("rejects garbage, other versions, and oversized payloads", () => {
    expect(decodeComposerContextFragment(null)).toBeNull();
    expect(decodeComposerContextFragment("not json")).toBeNull();
    expect(
      decodeComposerContextFragment(
        JSON.stringify({ version: 2, source: { environmentId: "e" }, records: [] }),
      ),
    ).toBeNull();
    expect(decodeComposerContextFragment("x".repeat(2_000_001))).toBeNull();
    expect(COMPOSER_CONTEXT_CLIPBOARD_MIME).toMatch(/^web application\//);
  });
});
