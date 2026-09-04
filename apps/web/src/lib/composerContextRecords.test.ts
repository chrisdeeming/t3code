import { ThreadId, type PreviewAnnotationPayload } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  attachmentContextRecord,
  buildMessageContext,
  isPullRequestSummaryContext,
  pullRequestContextDisplayState,
  pullRequestContextKindLabel,
  previewAnnotationContextLabel,
  previewAnnotationContextRecord,
  resolveUserMessageContext,
  reviewCommentContextLabel,
  reviewCommentContextRecord,
  terminalContextRecord,
} from "./composerContextRecords";

const annotation: PreviewAnnotationPayload = {
  id: "ann_1",
  pageUrl: "http://localhost:3000/checkout",
  pageTitle: "Checkout",
  comment: "  Make this   bigger ",
  elements: [
    {
      id: "el_1",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      element: {
        pageUrl: "http://localhost:3000/checkout",
        pageTitle: "Checkout",
        tagName: "BUTTON",
        selector: "#pay",
        htmlPreview: '<button id="pay">Pay</button>',
        componentName: "Button",
        source: null,
        stack: [],
        styles: "color: red;",
        pickedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ],
  regions: [],
  strokes: [],
  styleChanges: [
    { targetId: "el_1", selector: "#pay", property: "font-size", previousValue: "", value: "20px" },
  ],
  screenshot: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("composerContextRecords", () => {
  it.each([
    ["+181", "a.ts L181"],
    ["+181 to +183", "a.ts L181 to L183"],
    ["-63", "a.ts L63 (before)"],
    ["L4", "a.ts L4"],
  ])("presents review range %s consistently as %s", (rangeLabel, expected) => {
    expect(
      reviewCommentContextLabel({
        id: "review-1",
        sectionId: "file:src/a.ts",
        sectionTitle: "File comment",
        filePath: "src/a.ts",
        startIndex: 0,
        endIndex: 0,
        rangeLabel,
        text: "",
        diff: "",
      }),
    ).toBe(expected);
  });

  it("distinguishes a PR summary from a comment on its diff", () => {
    const summary = {
      id: "review-1",
      sectionId: "pull-request:42",
      sectionTitle: "PR #42",
      filePath: "PR #42",
      startIndex: 0,
      endIndex: 0,
      rangeLabel: "Improve context chips",
      text: "Pull request details",
      diff: "",
      pullRequest: {
        number: 42,
        title: "Improve context chips",
        url: "https://github.com/pingdotgg/t3code/pull/42",
        headBranch: "feat/context-chips",
        baseBranch: "main",
        state: "open" as const,
        isDraft: false,
      },
    };

    expect(isPullRequestSummaryContext(summary)).toBe(true);
    expect(reviewCommentContextLabel(summary)).toBe("#42");
    expect(pullRequestContextDisplayState(summary)).toBe("open");
    expect(pullRequestContextKindLabel(summary)).toBe("Open pull request");
    expect(
      pullRequestContextDisplayState({
        ...summary,
        pullRequest: { ...summary.pullRequest, isDraft: true },
      }),
    ).toBe("draft");
    expect(
      isPullRequestSummaryContext({
        ...summary,
        pullRequest: undefined,
        filePath: "src/a.ts",
        rangeLabel: "+12",
        diff: "+const answer = 42;",
      }),
    ).toBe(false);
  });

  it("builds a preview annotation record with element details and readable style changes", () => {
    expect(previewAnnotationContextLabel(annotation)).toBe("Make this bigger");
    expect(previewAnnotationContextRecord(annotation, { screenshotContextId: "ann_1" })).toEqual({
      version: 1,
      contextId: "annotation-ann_1",
      kind: "preview-annotation",
      label: "Make this bigger",
      annotationId: "ann_1",
      pageUrl: "http://localhost:3000/checkout",
      pageTitle: "Checkout",
      comment: "Make this   bigger",
      targetSummary: "1 selected element",
      styleChanges: ["font-size: (unset) → 20px"],
      screenshotContextId: "ann_1",
      elements: [
        {
          pageUrl: "http://localhost:3000/checkout",
          pageTitle: "Checkout",
          tagName: "button",
          selector: "#pay",
          htmlPreview: '<button id="pay">Pay</button>',
          componentName: "Button",
          source: null,
          styles: "color: red;",
        },
      ],
    });
  });

  it("builds terminal and review records and a message context in draft order", () => {
    const terminal = terminalContextRecord({
      id: "term-1",
      threadId: ThreadId.make("t"),
      createdAt: "2026-01-01T00:00:00.000Z",
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 3,
      lineEnd: 4,
      text: "\nboom\n",
    });
    expect(terminal).toMatchObject({
      kind: "terminal",
      label: "Terminal 1 lines 3-4",
      text: "boom",
    });
    const review = reviewCommentContextRecord({
      id: "rc-1",
      sectionId: "file:a/b.ts",
      sectionTitle: "File comment",
      filePath: "a/b.ts",
      startIndex: 3,
      endIndex: 3,
      rangeLabel: "L4",
      text: "Why?",
      diff: "const x = 1;",
      fenceLanguage: "ts",
    });
    expect(review).toMatchObject({ kind: "review-comment", label: "b.ts L4", fenceLanguage: "ts" });
    const context = buildMessageContext({
      terminalContexts: [],
      reviewComments: [
        {
          id: "rc-1",
          sectionId: "s",
          sectionTitle: "t",
          filePath: "a/b.ts",
          startIndex: 0,
          endIndex: 0,
          rangeLabel: "L1",
          text: "",
          diff: "",
        },
      ],
      previewAnnotations: [annotation],
    });
    expect(context?.records.map((record) => record.contextId)).toEqual([
      "rc-1",
      "annotation-ann_1",
    ]);
    expect(
      buildMessageContext({ terminalContexts: [], reviewComments: [], previewAnnotations: [] }),
    ).toBeUndefined();
  });

  it("resolves structured context directly and upgrades legacy text otherwise", () => {
    const structured = resolveUserMessageContext({
      text: "hi [b.ts L4](t3-context://v1/review-comment/rc-1)",
      context: {
        version: 1,
        records: [
          reviewCommentContextRecord({
            id: "rc-1",
            sectionId: "s",
            sectionTitle: "t",
            filePath: "a/b.ts",
            startIndex: 3,
            endIndex: 3,
            rangeLabel: "L4",
            text: "",
            diff: "",
          }),
        ],
      },
    });
    expect(structured.recordsById.get("rc-1")?.kind).toBe("review-comment");
    const legacy = resolveUserMessageContext({
      text: "hi\n\n<terminal_context>\n- T line 1:\n  1 | x\n</terminal_context>",
    });
    expect(legacy.text).toBe("hi\n\n[T line 1](t3-context://v1/terminal/legacy_terminal_1)");
    expect(legacy.recordsById.get("legacy_terminal_1")?.kind).toBe("terminal");
  });
});

describe("attachment context records", () => {
  it("binds image and file records to the given attachment id", () => {
    const image = attachmentContextRecord({
      attachment: {
        type: "image",
        id: "img-1",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 10,
        previewUrl: "blob:x",
        file: new File(["x"], "shot.png", { type: "image/png" }),
      },
      attachmentId: "pending-abc",
    });
    expect(image).toEqual({
      version: 1,
      contextId: "img-1",
      kind: "image",
      label: "shot.png",
      attachmentId: "pending-abc",
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    const file = attachmentContextRecord({
      attachment: {
        type: "file",
        id: "file-1",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 3,
        file: null,
        uploadedAttachmentId: "pending-def",
      },
      attachmentId: "pending-def",
    });
    expect(file).toMatchObject({ kind: "file", contextId: "file-1", attachmentId: "pending-def" });
    const context = buildMessageContext({
      terminalContexts: [],
      reviewComments: [],
      previewAnnotations: [],
      attachments: [
        {
          attachment: {
            type: "file",
            id: "file-1",
            name: "n",
            mimeType: "text/plain",
            sizeBytes: 1,
            file: null,
          },
          attachmentId: "file-1",
        },
      ],
    });
    expect(context?.records.map((record) => record.kind)).toEqual(["file"]);
  });
});

describe("producer ids that do not fit the grammar", () => {
  it("folds review comment ids and keeps the raw id in the draft shape", () => {
    const record = reviewCommentContextRecord({
      id: "pull-request-finding:42",
      sectionId: "s",
      sectionTitle: "t",
      filePath: "a/b.ts",
      startIndex: 0,
      endIndex: 0,
      rangeLabel: "L1",
      text: "",
      diff: "",
    });
    expect(record.contextId).toMatch(/^pull-request-finding-42-[0-9a-f]{8}$/);
    expect(
      resolveUserMessageContext({
        text: `[b.ts L1](t3-context://v1/review-comment/${record.contextId})`,
        context: { version: 1, records: [record] },
      }).recordsById.has(record.contextId),
    ).toBe(true);
  });
});
