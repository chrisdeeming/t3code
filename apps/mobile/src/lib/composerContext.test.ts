import { ComposerContextId, type OrchestrationMessageContext } from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  projectComposerContextForProvider,
} from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";
import {
  composerContextEditorTokens,
  createComposerContextHistory,
  referencedComposerContext,
  reidentifyComposerContext,
  uploadedComposerContext,
} from "./composerContext";

const terminal = {
  version: 1 as const,
  kind: "terminal" as const,
  contextId: ComposerContextId.make("terminal-1"),
  label: "Build output",
  terminalId: "main",
  terminalLabel: "Terminal",
  lineStart: 4,
  lineEnd: 5,
  text: "build failed\nretry",
};
const image = {
  version: 1 as const,
  kind: "image" as const,
  contextId: ComposerContextId.make("image-1"),
  label: "Screenshot",
  attachmentId: "local-image",
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 123,
};
const annotation = {
  version: 1 as const,
  kind: "preview-annotation" as const,
  contextId: ComposerContextId.make("preview-1"),
  label: "Button",
  annotationId: "button-1",
  pageUrl: "https://example.com",
  pageTitle: null,
  comment: "Keep the cart",
  targetSummary: "Button",
  styleChanges: [],
  screenshotContextId: image.contextId,
};

describe("mobile composer context", () => {
  it("restores deleted payloads on undo without adding removed context to the current draft", () => {
    const restore = createComposerContextHistory();
    const source = formatComposerContextReference(annotation);
    const initial = { version: 1 as const, records: [annotation, image] };
    expect(restore("deleted", initial)).toBeUndefined();
    expect(restore(source)?.records).toEqual(initial.records);
    expect(restore("deleted")?.records ?? []).toEqual([]);
    expect(createComposerContextHistory()(source)?.records).toEqual([]);
  });
  it("keeps exact source positions and repeated references alongside existing native tokens", () => {
    const reference = formatComposerContextReference(terminal);
    const text = `Use $playwright and [app.ts](src/app.ts) with ${reference} then ${reference}`;
    const tokens = composerContextEditorTokens(text, collectComposerInlineTokens(text));
    expect(tokens.map((token) => token.type)).toEqual(["skill", "mention", "context", "context"]);
    for (const token of tokens) expect(text.slice(token.start, token.end)).toBe(token.source);
  });

  it("removes deleted payloads but keeps the screenshot linked to a remaining annotation", () => {
    const context: OrchestrationMessageContext = {
      version: 1,
      records: [terminal, annotation, image],
    };
    expect(
      referencedComposerContext(formatComposerContextReference(annotation), context)?.records,
    ).toEqual([annotation, image]);
    expect(referencedComposerContext("plain text", context)).toBeUndefined();
  });

  it("reidentifies pasted records and their screenshot binding without changing repeated-reference identity", () => {
    let next = 0;
    const text = `${formatComposerContextReference(annotation)} ${formatComposerContextReference(annotation)}`;
    const imported = reidentifyComposerContext(text, [annotation, image], () => `copy-${++next}`);
    expect(collectComposerContextReferences(imported.text).map((ref) => ref.contextId)).toEqual([
      "copy-1",
      "copy-1",
    ]);
    expect(imported.context.records[0]).toMatchObject({
      contextId: "copy-1",
      screenshotContextId: "copy-2",
    });
    expect(annotation.contextId).toBe("preview-1");
  });

  it("binds uploaded files to their wire ids and preserves terminal payloads for every provider", () => {
    const context = uploadedComposerContext(
      { version: 1, records: [terminal, image] },
      [{ id: "local-image" }],
      [{ id: "uploaded-image" }],
    );
    expect(context?.records).toEqual([terminal, { ...image, attachmentId: "uploaded-image" }]);
    const prompt = projectComposerContextForProvider({
      text: formatComposerContextReference(terminal),
      records: context!.records,
    });
    expect(prompt).toContain("4 | build failed\n5 | retry");
    expect(prompt).not.toContain('unavailable="true"');
  });
});
