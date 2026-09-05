import type {
  ComposerContextId,
  ComposerContextRecord,
  ElementContextRecord,
  PreviewAnnotationContextRecord,
  ReviewCommentContextRecord,
  TerminalContextRecord,
} from "@t3tools/contracts";

import { formatComposerContextReference } from "./composerContextReferences.ts";

/**
 * Upgrades a message written before inline context references: trailing
 * `<terminal_context>`, `<element_context>` and `<preview_annotation>` blocks, inline or
 * trailing `<review_comment>` blocks, and U+FFFC terminal placeholders. Produces canonical
 * reference links plus records so old messages render and copy through the new path.
 * Event history is never rewritten; this runs in memory on read.
 */

export interface UpgradedLegacyContext {
  text: string;
  records: ComposerContextRecord[];
}

const PLACEHOLDER = "￼";
const TRAILING_TERMINAL = /\n*<terminal_context>\n([\s\S]*?)\n<\/terminal_context>\s*$/;
const TRAILING_ELEMENT = /\n*<element_context>\n([\s\S]*?)\n<\/element_context>\s*$/;
const TRAILING_PREVIEW =
  /\n*<preview_annotation>\n((?:(?!<preview_annotation>)[\s\S])*)\n<\/preview_annotation>\s*$/;
const INLINE_REVIEW = /<review_comment\b([^>]*)>\s*([\s\S]*?)<\/review_comment>/g;
const REVIEW_ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9_-]*)="([^"]*)"/g;
const REVIEW_FENCE = /(`{3,})([^\s`]*)[^\n]*\n([\s\S]*?)\n\1/g;
const REVIEW_TOKEN = "\uE000";
const TRAILING_REVIEW_TOKENS = /(?:\s*\uE000(\d+)\uE000)+\s*$/;
const LEGACY_MARKERS =
  /<(?:terminal_context|element_context|preview_annotation|review_comment)\b|￼/;

interface ParsedEntry {
  header: string;
  body: string;
}

function parseEntries(block: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let current: { header: string; bodyLines: string[] } | null = null;
  const commit = () => {
    if (!current) return;
    entries.push({ header: current.header, body: current.bodyLines.join("\n").trimEnd() });
    current = null;
  };
  for (const line of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(line);
    if (headerMatch) {
      commit();
      current = { header: headerMatch[1]!, bodyLines: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("  ")) current.bodyLines.push(line.slice(2));
    else if (line.length === 0) current.bodyLines.push("");
  }
  commit();
  return entries;
}

/** The inline label the old send path wrote for a terminal excerpt: `@terminal-1:509-514`. */
function inlineTerminalLabel(record: TerminalContextRecord): string {
  const slug = record.terminalLabel.trim().toLowerCase().replace(/\s+/g, "-");
  const range =
    record.lineStart === record.lineEnd
      ? `${record.lineStart}`
      : `${record.lineStart}-${record.lineEnd}`;
  return `@${slug}:${range}`;
}

function legacyId(kind: string, index: number): ComposerContextId {
  return `legacy_${kind}_${index}` as ComposerContextId;
}

function terminalRecord(entry: ParsedEntry, index: number): TerminalContextRecord | null {
  const header = /^(.*?) (?:line (\d+)|lines (\d+)-(\d+))$/.exec(entry.header);
  if (!header) return null;
  const terminalLabel = header[1]!.trim();
  if (!terminalLabel) return null;
  const lineStart = Number(header[2] ?? header[3]);
  const lineEnd = Number(header[2] ?? header[4]);
  const text = entry.body
    .split("\n")
    .map((line) => line.replace(/^\d+ \| ?/, ""))
    .join("\n");
  return {
    version: 1,
    contextId: legacyId("terminal", index),
    kind: "terminal",
    label: entry.header,
    terminalId: terminalLabel.toLowerCase().replace(/\s+/g, "-"),
    terminalLabel,
    lineStart,
    lineEnd,
    text,
  };
}

function parseSource(location: string): ElementContextRecord["source"] {
  const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(location);
  if (!match || !match[1]) return null;
  return {
    functionName: null,
    fileName: match[1],
    lineNumber: match[2] === undefined ? null : Number(match[2]),
    columnNumber: match[3] === undefined ? null : Number(match[3]),
  };
}

function elementRecord(entry: ParsedEntry, index: number): ElementContextRecord | null {
  const header = /^<([^>]+)>/.exec(entry.header);
  if (!header) return null;
  const inner = header[1]!;
  const fields: Record<string, string> = {};
  const sections: Record<string, string[]> = {};
  let section: string | null = null;
  for (const line of entry.body.split("\n")) {
    if (section && (line.startsWith("  ") || line.length === 0)) {
      sections[section]!.push(line.slice(2));
      continue;
    }
    section = null;
    const field = /^([a-z]+): (.*)$/.exec(line);
    if (field) {
      fields[field[1]!] = field[2]!;
      continue;
    }
    const sectionStart = /^(html|styles):$/.exec(line);
    if (sectionStart) {
      section = sectionStart[1]!;
      sections[section] = [];
    }
  }
  return {
    version: 1,
    contextId: legacyId("element", index),
    kind: "element",
    label: `<${inner}>`,
    pageUrl: fields.url ?? "",
    pageTitle: null,
    tagName: inner.toLowerCase(),
    selector: fields.selector ?? null,
    htmlPreview: (sections.html ?? []).join("\n").trimEnd(),
    componentName: /[A-Z]/.test(inner) ? inner : null,
    source: fields.source ? parseSource(fields.source) : null,
    styles: (sections.styles ?? []).join("\n").trimEnd(),
  };
}

function previewRecord(body: string, index: number): PreviewAnnotationContextRecord {
  const lines = body.split("\n");
  const read = (prefix: string) =>
    lines
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? "";
  const styleHeading = lines.indexOf("Requested visual changes:");
  const styleChanges: string[] = [];
  if (styleHeading >= 0) {
    for (const line of lines.slice(styleHeading + 1)) {
      if (!line.startsWith("- ")) break;
      styleChanges.push(line.slice(2));
    }
  }
  const pageTitle = read("Page: ");
  return {
    version: 1,
    contextId: legacyId("preview-annotation", index),
    kind: "preview-annotation",
    label: pageTitle || "Preview annotation",
    annotationId: read("Id: "),
    pageUrl: "",
    pageTitle: pageTitle || null,
    comment: read("Comment: "),
    targetSummary: read("Targets: "),
    styleChanges,
  };
}

function unescapeAttribute(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function reviewRecord(
  rawAttributes: string,
  rawBody: string,
  index: number,
): ReviewCommentContextRecord | null {
  const attributes: Record<string, string> = {};
  for (const match of rawAttributes.matchAll(REVIEW_ATTRIBUTE)) {
    attributes[match[1]!] = unescapeAttribute(match[2] ?? "");
  }
  const filePath = attributes.filePath?.trim();
  const sectionId = attributes.sectionId?.trim();
  const startIndex = attributes.startIndex;
  const endIndex = attributes.endIndex;
  if (!filePath || !sectionId || !/^\d+$/.test(startIndex ?? "") || !/^\d+$/.test(endIndex ?? "")) {
    return null;
  }
  const fences = Array.from(rawBody.matchAll(REVIEW_FENCE));
  const fence = fences.at(-1);
  const rangeLabel = attributes.rangeLabel?.trim() || "line";
  const basename = filePath.split(/[\\/]/).at(-1) ?? filePath;
  return {
    version: 1,
    contextId: legacyId("review-comment", index),
    kind: "review-comment",
    label: `${basename} ${rangeLabel}`,
    sectionId,
    sectionTitle: attributes.sectionTitle?.trim() || "Review",
    filePath,
    startIndex: Math.min(Number(startIndex), Number(endIndex)),
    endIndex: Math.max(Number(startIndex), Number(endIndex)),
    rangeLabel,
    text: rawBody.slice(0, fence?.index ?? rawBody.length).trim(),
    diff: fence?.[3] ?? "",
    fenceLanguage: fence?.[2]?.trim() || "diff",
  };
}

function stripTrailing(
  text: string,
  pattern: RegExp,
): { text: string; match: RegExpExecArray } | null {
  const match = pattern.exec(text);
  if (!match) return null;
  return { text: text.slice(0, match.index).replace(/\n+$/, ""), match };
}

export function upgradeLegacyContextMessage(text: string): UpgradedLegacyContext {
  if (!LEGACY_MARKERS.test(text)) return { text, records: [] };

  const terminalEntries: ParsedEntry[] = [];
  const elementEntries: ParsedEntry[] = [];
  const previewBodies: string[] = [];
  const reviews: ReviewCommentContextRecord[] = [];

  // Review blocks become tokens in place first so they neither hide the trailing blocks
  // behind them nor lose their position. Unparseable blocks stay as text.
  let rest = text.replace(INLINE_REVIEW, (whole, attributes: string, rawBody: string) => {
    const record = reviewRecord(attributes, rawBody, reviews.length + 1);
    if (!record) return whole;
    reviews.push(record);
    return `${REVIEW_TOKEN}${reviews.length - 1}${REVIEW_TOKEN}`;
  });

  // Blocks were appended in send order (terminal, element, preview, review), so they peel
  // off the end in reverse. Each peel exposes the next block as trailing.
  // Only reviews that trailed the original text were appended by the old send path; a
  // review that sat before other blocks keeps its place.
  const trailingReviewTokens: number[] = [];
  const tokens = TRAILING_REVIEW_TOKENS.exec(rest);
  if (tokens && tokens[0].length > 0) {
    trailingReviewTokens.push(
      ...Array.from(tokens[0].matchAll(/\uE000(\d+)\uE000/g), (m) => Number(m[1])),
    );
    rest = rest.slice(0, tokens.index).replace(/\n+$/, "");
  }
  for (;;) {
    const preview = stripTrailing(rest, TRAILING_PREVIEW);
    if (preview) {
      rest = preview.text;
      previewBodies.unshift(preview.match[1] ?? "");
      continue;
    }
    const element = stripTrailing(rest, TRAILING_ELEMENT);
    if (element) {
      rest = element.text;
      elementEntries.unshift(...parseEntries(element.match[1] ?? ""));
      continue;
    }
    const terminal = stripTrailing(rest, TRAILING_TERMINAL);
    if (terminal) {
      rest = terminal.text;
      terminalEntries.unshift(...parseEntries(terminal.match[1] ?? ""));
      continue;
    }
    break;
  }

  const terminals = terminalEntries
    .map((entry, index) => terminalRecord(entry, index + 1))
    .filter((record) => record !== null);
  const elements = elementEntries
    .map((entry, index) => elementRecord(entry, index + 1))
    .filter((record) => record !== null);
  const previews = previewBodies.map((body, index) => previewRecord(body, index + 1));
  const appendedReviews = trailingReviewTokens.map((index) => reviews[index]!);

  let body = rest.replace(/\uE000(\d+)\uE000/g, (_whole, index: string) =>
    formatComposerContextReference(reviews[Number(index)]!),
  );

  // Placeholders bind to terminal entries in order, like the old materialize step did.
  let placeholderIndex = 0;
  body = body.replace(new RegExp(PLACEHOLDER, "g"), () => {
    const record = terminals[placeholderIndex];
    placeholderIndex += 1;
    return record ? formatComposerContextReference(record) : "";
  });
  // Sent messages carry the materialized `@terminal-1:509-514` label instead of the
  // placeholder; each such label becomes the chip in place.
  const placedTerminals = new Set(terminals.slice(0, placeholderIndex));
  for (const record of terminals) {
    if (placedTerminals.has(record)) continue;
    const label = inlineTerminalLabel(record);
    const at = body.indexOf(label);
    if (at === -1) continue;
    body = `${body.slice(0, at)}${formatComposerContextReference(record)}${body.slice(at + label.length)}`;
    placedTerminals.add(record);
  }
  body = body.replace(/[ \t]+$/gm, "").trimEnd();

  const appended = [
    ...terminals.filter((record) => !placedTerminals.has(record)),
    ...elements,
    ...previews,
    ...appendedReviews,
  ].map((record) => formatComposerContextReference(record));
  const upgradedText =
    appended.length === 0
      ? body
      : body.length > 0
        ? `${body}\n\n${appended.join(" ")}`
        : appended.join(" ");

  return {
    text: upgradedText,
    records: [...terminals, ...elements, ...previews, ...reviews],
  };
}
