import { ComposerContextId, type ComposerContextRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { upgradeLegacyContextMessage } from "./composerContextLegacy.ts";
import { formatComposerContextReference } from "./composerContextReferences.ts";
import { serializeLegacyContextMessage } from "./composerContextLegacySend.ts";

const terminal = {
  version: 1,
  contextId: ComposerContextId.make("terminal_t1"),
  kind: "terminal",
  label: "Terminal 1 lines 3-4",
  terminalId: "terminal-1",
  terminalLabel: "Terminal 1",
  lineStart: 3,
  lineEnd: 4,
  text: "boom\nagain",
} satisfies ComposerContextRecord;

const review = {
  version: 1,
  contextId: ComposerContextId.make("review-comment_rc1"),
  kind: "review-comment",
  label: "b.ts L4",
  sectionId: "file:a/b.ts",
  sectionTitle: "File comment",
  filePath: "a/b.ts",
  startIndex: 3,
  endIndex: 3,
  rangeLabel: "L4",
  text: "Why this branch?",
  diff: "const x = 1;",
  fenceLanguage: "ts",
} satisfies ComposerContextRecord;

describe("serializeLegacyContextMessage", () => {
  it("carries terminal payloads an older server would otherwise discard", () => {
    const text = `Look at ${formatComposerContextReference(terminal)} please`;
    const legacy = serializeLegacyContextMessage({ text, records: [terminal] });

    // An older server forwards text verbatim, so the payload has to be in it.
    expect(legacy).not.toContain("t3-context://");
    expect(legacy).toContain("boom");

    // A newer client reading that message reconstructs the same excerpt.
    const upgraded = upgradeLegacyContextMessage(legacy);
    expect(upgraded.records).toHaveLength(1);
    expect(upgraded.records[0]).toMatchObject({
      kind: "terminal",
      terminalLabel: "Terminal 1",
      lineStart: 3,
      lineEnd: 4,
      text: "boom\nagain",
    });
  });

  it("inlines a review comment with its diff intact", () => {
    const text = `See ${formatComposerContextReference(review)} here`;
    const legacy = serializeLegacyContextMessage({ text, records: [review] });
    expect(legacy).not.toContain("t3-context://");

    const upgraded = upgradeLegacyContextMessage(legacy);
    expect(upgraded.records[0]).toMatchObject({
      kind: "review-comment",
      filePath: "a/b.ts",
      rangeLabel: "L4",
      text: "Why this branch?",
      diff: "const x = 1;",
    });
  });

  it("keeps prose without context untouched", () => {
    expect(serializeLegacyContextMessage({ text: "just prose", records: [] })).toBe("just prose");
  });
});
