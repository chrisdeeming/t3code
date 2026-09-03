import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendTerminalContextsToPrompt,
  buildTerminalContextPreviewTitle,
  buildTerminalContextBlock,
  collectInlineTerminalContextIds,
  deriveDisplayedUserMessageState,
  ensureInlineTerminalContextReferences,
  extractTrailingTerminalContexts,
  filterTerminalContextsWithText,
  formatInlineTerminalContextLabel,
  formatTerminalContextLabel,
  formatTerminalContextReference,
  hasTerminalContextText,
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextReference,
  isTerminalContextExpired,
  materializeInlineTerminalContextPrompt,
  migrateLegacyTerminalContextPlaceholders,
  removeInlineTerminalContextReference,
  stripInlineContextReferences,
  type TerminalContextDraft,
} from "./terminalContext";

function makeContext(overrides?: Partial<TerminalContextDraft>): TerminalContextDraft {
  return {
    id: "context-1",
    threadId: ThreadId.make("thread-1"),
    terminalId: "default",
    terminalLabel: "Terminal 1",
    lineStart: 12,
    lineEnd: 13,
    text: "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("terminalContext", () => {
  it("formats terminal labels with line ranges", () => {
    expect(formatTerminalContextLabel(makeContext())).toBe("Terminal 1 lines 12-13");
    expect(
      formatTerminalContextLabel(
        makeContext({
          lineStart: 9,
          lineEnd: 9,
        }),
      ),
    ).toBe("Terminal 1 line 9");
  });

  it("builds a numbered terminal context block", () => {
    expect(buildTerminalContextBlock([makeContext()])).toBe(
      [
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("appends terminal context blocks after prompt text", () => {
    expect(appendTerminalContextsToPrompt("Investigate this", [makeContext()])).toBe(
      [
        "Investigate this",
        "",
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("replaces inline references with inline terminal labels before appending context blocks", () => {
    expect(
      appendTerminalContextsToPrompt(
        `Investigate ${formatTerminalContextReference(makeContext())} carefully`,
        [makeContext()],
      ),
    ).toBe(
      [
        "Investigate @terminal-1:12-13 carefully",
        "",
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("extracts terminal context blocks from message text", () => {
    const prompt = appendTerminalContextsToPrompt("Investigate this", [makeContext()]);
    expect(extractTrailingTerminalContexts(prompt)).toEqual({
      promptText: "Investigate this",
      contextCount: 1,
      previewTitle: "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
        },
      ],
    });
  });

  it("derives displayed user message state from terminal context prompts", () => {
    const prompt = appendTerminalContextsToPrompt("Investigate this", [makeContext()]);
    expect(deriveDisplayedUserMessageState(prompt)).toEqual({
      visibleText: "Investigate this",
      copyText: prompt,
      contextCount: 1,
      previewTitle: "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
        },
      ],
      elementContexts: [],
    });
  });

  it("preserves prompt text when no trailing terminal context block exists", () => {
    expect(extractTrailingTerminalContexts("No attached context")).toEqual({
      promptText: "No attached context",
      contextCount: 0,
      previewTitle: null,
      contexts: [],
    });
  });

  it("returns null preview title when every context is invalid", () => {
    expect(
      buildTerminalContextPreviewTitle([
        makeContext({
          terminalId: "   ",
        }),
        makeContext({
          id: "context-2",
          text: "\n\n",
        }),
      ]),
    ).toBeNull();
  });

  it("formats a terminal context as a canonical reference link", () => {
    expect(formatTerminalContextReference(makeContext())).toBe(
      "[Terminal 1 lines 12-13](t3-context://v1/terminal/context-1)",
    );
  });

  it("inserts a reference at the cursor with spacing and lands the cursor after it", () => {
    const link = formatTerminalContextReference(makeContext());
    expect(insertInlineTerminalContextReference("abc", 1, makeContext())).toEqual({
      prompt: `a ${link} bc`,
      cursor: 2 + link.length + 1,
    });
    expect(
      insertInlineTerminalContextReference("Inspect @package.json ", 22, makeContext()),
    ).toEqual({ prompt: `Inspect @package.json ${link} `, cursor: 22 + link.length + 1 });
    // Consumes an existing trailing space at the insertion point.
    expect(insertInlineTerminalContextReference("yo whats", 3, makeContext())).toEqual({
      prompt: `yo ${link} whats`,
      cursor: 3 + link.length + 1,
    });
  });

  it("removes a reference by id together with one adjacent space", () => {
    const first = formatTerminalContextReference(makeContext());
    const second = formatTerminalContextReference(makeContext({ id: "context-2" }));
    expect(removeInlineTerminalContextReference(`a ${first} ${second} c`, "context-2")).toEqual({
      prompt: `a ${first} c`,
      cursor: 2 + first.length + 1,
    });
    expect(removeInlineTerminalContextReference("plain", "context-9")).toEqual({
      prompt: "plain",
      cursor: 5,
    });
  });

  it("collects referenced ids and strips references for content checks", () => {
    const first = formatTerminalContextReference(makeContext());
    const second = formatTerminalContextReference(makeContext({ id: "context-2" }));
    const prompt = `see ${first} and ${second} and [img](t3-context://v1/image/ctx_9)`;
    expect(collectInlineTerminalContextIds(prompt)).toEqual(["context-1", "context-2"]);
    expect(stripInlineContextReferences(prompt)).toBe("see  and  and ");
  });

  it("prepends references for contexts the prompt does not mention yet", () => {
    const first = formatTerminalContextReference(makeContext());
    const second = formatTerminalContextReference(makeContext({ id: "context-2" }));
    const contexts = [makeContext(), makeContext({ id: "context-2" })];
    expect(ensureInlineTerminalContextReferences(`x ${second}`, contexts)).toBe(
      `${first} x ${second}`,
    );
    expect(ensureInlineTerminalContextReferences(`${first} ${second}`, contexts)).toBe(
      `${first} ${second}`,
    );
    expect(ensureInlineTerminalContextReferences("", contexts)).toBe(`${first} ${second} `);
  });

  it("migrates legacy placeholders to references in order and drops extras", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    const first = formatTerminalContextReference(makeContext());
    const contexts = [makeContext()];
    expect(
      migrateLegacyTerminalContextPlaceholders(`a ${placeholder} b ${placeholder}`, contexts),
    ).toBe(`a ${first} b `);
    expect(migrateLegacyTerminalContextPlaceholders("plain", contexts)).toBe("plain");
  });

  it("marks contexts without snapshot text as expired and filters them from sendable contexts", () => {
    const liveContext = makeContext();
    const expiredContext = makeContext({
      id: "context-2",
      text: "",
    });

    expect(hasTerminalContextText(liveContext)).toBe(true);
    expect(isTerminalContextExpired(liveContext)).toBe(false);
    expect(hasTerminalContextText(expiredContext)).toBe(false);
    expect(isTerminalContextExpired(expiredContext)).toBe(true);
    expect(filterTerminalContextsWithText([expiredContext, liveContext])).toEqual([liveContext]);
  });

  it("formats and materializes inline terminal labels from references by id", () => {
    expect(formatInlineTerminalContextLabel(makeContext())).toBe("@terminal-1:12-13");
    const known = formatTerminalContextReference(makeContext());
    const unknown = formatTerminalContextReference(makeContext({ id: "gone" }));
    expect(
      materializeInlineTerminalContextPrompt(`Investigate ${known} carefully ${unknown}!`, [
        makeContext(),
      ]),
    ).toBe("Investigate @terminal-1:12-13 carefully !");
  });
});
