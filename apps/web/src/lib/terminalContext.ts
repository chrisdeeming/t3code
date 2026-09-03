import type { ComposerContextId, ThreadId } from "@t3tools/contracts";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  replaceComposerContextReferences,
  type ComposerContextReferenceOccurrence,
} from "@t3tools/shared/composerContextReferences";

import { extractTrailingElementContexts, type ParsedElementContextEntry } from "./elementContext";

export interface TerminalContextSelection {
  terminalId: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
}

export interface TerminalContextDraft extends TerminalContextSelection {
  id: string;
  threadId: ThreadId;
  createdAt: string;
}

export interface ExtractedTerminalContexts {
  promptText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedTerminalContextEntry[];
}

export interface DisplayedUserMessageState {
  visibleText: string;
  copyText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedTerminalContextEntry[];
  /**
   * Element-context entries extracted from the trailing `<element_context>`
   * block (if any). Stripped from `visibleText` so the raw block doesn't
   * leak into the user's bubble.
   */
  elementContexts: ParsedElementContextEntry[];
}

export interface ParsedTerminalContextEntry {
  header: string;
  body: string;
}

/** Legacy ordinal placeholder from drafts saved before context references. Migration only. */
export const INLINE_TERMINAL_CONTEXT_PLACEHOLDER = "\uFFFC";

export interface TerminalContextReferenceSource {
  id: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
}

/** The canonical inline link that stands for this context in the prompt. */
export function formatTerminalContextReference(context: TerminalContextReferenceSource): string {
  return formatComposerContextReference({
    kind: "terminal",
    contextId: context.id as ComposerContextId,
    label: formatTerminalContextLabel(context),
  });
}

function isTerminalReference(occurrence: ComposerContextReferenceOccurrence): boolean {
  return occurrence.kind === "terminal";
}

export function collectInlineTerminalContextIds(prompt: string): string[] {
  return collectComposerContextReferences(prompt)
    .filter(isTerminalReference)
    .map((occurrence) => occurrence.contextId);
}

/** Prose without any context link, for "does this prompt say anything" checks. */
export function stripInlineContextReferences(prompt: string): string {
  return replaceComposerContextReferences(prompt, () => "");
}

const TRAILING_TERMINAL_CONTEXT_BLOCK_PATTERN =
  /\n*<terminal_context>\n([\s\S]*?)\n<\/terminal_context>\s*$/;

export function normalizeTerminalContextText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function hasTerminalContextText(context: { text: string }): boolean {
  return normalizeTerminalContextText(context.text).length > 0;
}

export function isTerminalContextExpired(context: { text: string }): boolean {
  return !hasTerminalContextText(context);
}

export function filterTerminalContextsWithText<T extends { text: string }>(
  contexts: ReadonlyArray<T>,
): T[] {
  return contexts.filter((context) => hasTerminalContextText(context));
}

function previewTerminalContextText(text: string): string {
  const normalized = normalizeTerminalContextText(text);
  if (normalized.length === 0) {
    return "";
  }
  const lines = normalized.split("\n");
  const visibleLines = lines.slice(0, 3);
  if (lines.length > 3) {
    visibleLines.push("...");
  }
  const preview = visibleLines.join("\n");
  return preview.length > 180 ? `${preview.slice(0, 177)}...` : preview;
}

export function normalizeTerminalContextSelection(
  selection: TerminalContextSelection,
): TerminalContextSelection | null {
  const text = normalizeTerminalContextText(selection.text);
  const terminalId = selection.terminalId.trim();
  const terminalLabel = selection.terminalLabel.trim();
  if (text.length === 0 || terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(selection.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(selection.lineEnd));
  return {
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text,
  };
}

export function formatTerminalContextRange(selection: {
  lineStart: number;
  lineEnd: number;
}): string {
  return selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}-${selection.lineEnd}`;
}

export function formatTerminalContextLabel(selection: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
}): string {
  return `${selection.terminalLabel} ${formatTerminalContextRange(selection)}`;
}

export function formatInlineTerminalContextLabel(selection: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
}): string {
  const terminalLabel = selection.terminalLabel.trim().toLowerCase().replace(/\s+/g, "-");
  const range =
    selection.lineStart === selection.lineEnd
      ? `${selection.lineStart}`
      : `${selection.lineStart}-${selection.lineEnd}`;
  return `@${terminalLabel}:${range}`;
}

export function buildTerminalContextPreviewTitle(
  contexts: ReadonlyArray<TerminalContextSelection>,
): string | null {
  if (contexts.length === 0) {
    return null;
  }
  const previewParts: string[] = [];
  for (const context of contexts) {
    const normalized = normalizeTerminalContextSelection(context);
    if (!normalized) continue;
    const preview = previewTerminalContextText(normalized.text);
    previewParts.push(
      preview.length > 0
        ? `${formatTerminalContextLabel(normalized)}\n${preview}`
        : formatTerminalContextLabel(normalized),
    );
  }
  const previews = previewParts.join("\n\n");
  return previews.length > 0 ? previews : null;
}

function buildTerminalContextBodyLines(selection: TerminalContextSelection): string[] {
  return normalizeTerminalContextText(selection.text)
    .split("\n")
    .map((line, index) => `  ${selection.lineStart + index} | ${line}`);
}

export function buildTerminalContextBlock(
  contexts: ReadonlyArray<TerminalContextSelection>,
): string {
  const normalizedContexts: TerminalContextSelection[] = [];
  for (const context of contexts) {
    const normalized = normalizeTerminalContextSelection(context);
    if (normalized !== null) {
      normalizedContexts.push(normalized);
    }
  }
  if (normalizedContexts.length === 0) {
    return "";
  }
  const lines: string[] = [];
  for (let index = 0; index < normalizedContexts.length; index += 1) {
    const context = normalizedContexts[index]!;
    lines.push(`- ${formatTerminalContextLabel(context)}:`);
    lines.push(...buildTerminalContextBodyLines(context));
    if (index < normalizedContexts.length - 1) {
      lines.push("");
    }
  }
  return ["<terminal_context>", ...lines, "</terminal_context>"].join("\n");
}

export function materializeInlineTerminalContextPrompt(
  prompt: string,
  contexts: ReadonlyArray<TerminalContextReferenceSource>,
): string {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return replaceComposerContextReferences(prompt, (occurrence) => {
    if (!isTerminalReference(occurrence)) return occurrence.source;
    const context = contextsById.get(occurrence.contextId);
    return context ? formatInlineTerminalContextLabel(context) : "";
  });
}

export function appendTerminalContextsToPrompt(
  prompt: string,
  contexts: ReadonlyArray<TerminalContextSelection & { id: string }>,
): string {
  const trimmedPrompt = materializeInlineTerminalContextPrompt(prompt, contexts).trim();
  const contextBlock = buildTerminalContextBlock(contexts);
  if (contextBlock.length === 0) {
    return trimmedPrompt;
  }
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${contextBlock}` : contextBlock;
}

export function extractTrailingTerminalContexts(prompt: string): ExtractedTerminalContexts {
  const match = TRAILING_TERMINAL_CONTEXT_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return {
      promptText: prompt,
      contextCount: 0,
      previewTitle: null,
      contexts: [],
    };
  }
  const promptText = prompt.slice(0, match.index).replace(/\n+$/, "");
  const parsedContexts = parseTerminalContextEntries(match[1] ?? "");
  return {
    promptText,
    contextCount: parsedContexts.length,
    previewTitle:
      parsedContexts.length > 0
        ? parsedContexts
            .map(({ header, body }) => (body.length > 0 ? `${header}\n${body}` : header))
            .join("\n\n")
        : null,
    contexts: parsedContexts,
  };
}

export function deriveDisplayedUserMessageState(prompt: string): DisplayedUserMessageState {
  // Order matters: send-time appends `<terminal_context>` first, then
  // `<element_context>` last. Strip element first so the (now-trailing)
  // terminal block can be matched by `extractTrailingTerminalContexts`.
  const extractedElement = extractTrailingElementContexts(prompt);
  const extractedTerminal = extractTrailingTerminalContexts(extractedElement.promptText);
  return {
    visibleText: extractedTerminal.promptText,
    copyText: prompt,
    contextCount: extractedTerminal.contextCount,
    previewTitle: extractedTerminal.previewTitle,
    contexts: extractedTerminal.contexts,
    elementContexts: extractedElement.contexts,
  };
}

function parseTerminalContextEntries(block: string): ParsedTerminalContextEntry[] {
  const entries: ParsedTerminalContextEntry[] = [];
  let current: { header: string; bodyLines: string[] } | null = null;

  const commitCurrent = () => {
    if (!current) {
      return;
    }
    entries.push({
      header: current.header,
      body: current.bodyLines.join("\n").trimEnd(),
    });
    current = null;
  };

  for (const rawLine of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(rawLine);
    if (headerMatch) {
      commitCurrent();
      current = {
        header: headerMatch[1]!,
        bodyLines: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (rawLine.startsWith("  ")) {
      current.bodyLines.push(rawLine.slice(2));
      continue;
    }
    if (rawLine.length === 0) {
      current.bodyLines.push("");
    }
  }

  commitCurrent();
  return entries;
}

function isInlineContextBoundaryWhitespace(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\n" || char === "\t" || char === "\r";
}

/** Prepends links for contexts the prompt does not reference yet, oldest first. */
export function ensureInlineTerminalContextReferences(
  prompt: string,
  contexts: ReadonlyArray<TerminalContextReferenceSource>,
): string {
  const referenced = new Set(collectInlineTerminalContextIds(prompt));
  const missing = contexts.filter((context) => !referenced.has(context.id));
  if (missing.length === 0) return prompt;
  return `${missing.map(formatTerminalContextReference).join(" ")} ${prompt}`;
}

/** Binds legacy U+FFFC placeholders to contexts in array order; leftover placeholders vanish. */
export function migrateLegacyTerminalContextPlaceholders(
  prompt: string,
  contexts: ReadonlyArray<TerminalContextReferenceSource>,
): string {
  if (!prompt.includes(INLINE_TERMINAL_CONTEXT_PLACEHOLDER)) return prompt;
  let index = 0;
  return prompt.replaceAll(INLINE_TERMINAL_CONTEXT_PLACEHOLDER, () => {
    const context = contexts[index];
    index += 1;
    return context ? formatTerminalContextReference(context) : "";
  });
}

export function insertInlineTerminalContextReference(
  prompt: string,
  cursorInput: number,
  context: TerminalContextReferenceSource,
): { prompt: string; cursor: number } {
  const cursor = Math.max(0, Math.min(prompt.length, Math.floor(cursorInput)));
  const needsLeadingSpace = !isInlineContextBoundaryWhitespace(prompt[cursor - 1]);
  const replacement = `${needsLeadingSpace ? " " : ""}${formatTerminalContextReference(context)} `;
  const rangeEnd = prompt[cursor] === " " ? cursor + 1 : cursor;
  return {
    prompt: `${prompt.slice(0, cursor)}${replacement}${prompt.slice(rangeEnd)}`,
    cursor: cursor + replacement.length,
  };
}

/** Removes the first reference to `contextId` plus one neighbouring space so words don't join. */
export function removeInlineTerminalContextReference(
  prompt: string,
  contextId: string,
): { prompt: string; cursor: number } {
  const occurrence = collectComposerContextReferences(prompt).find(
    (candidate) => isTerminalReference(candidate) && candidate.contextId === contextId,
  );
  if (!occurrence) return { prompt, cursor: prompt.length };
  let { start, end } = occurrence;
  if (prompt[end] === " ") end += 1;
  else if (prompt[start - 1] === " ") start -= 1;
  return { prompt: `${prompt.slice(0, start)}${prompt.slice(end)}`, cursor: start };
}
