import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import { CircleDashedIcon, MessageCircleIcon, MousePointerClickIcon } from "lucide-react";
import { createContext, type ReactElement, use } from "react";

import { cn } from "~/lib/utils";
import {
  previewAnnotationContextLabel,
  reviewCommentContextLabel,
} from "~/lib/composerContextRecords";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { ComposerPendingTerminalContextChip } from "./chat/ComposerPendingTerminalContexts";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "./composerInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Draft-side payload behind a context reference chip. Each kind keeps its existing draft
 * shape; the editor only needs a way to look one up by id.
 */
export type ComposerDraftContextRecord =
  | { kind: "terminal"; record: TerminalContextDraft }
  | { kind: "review-comment"; record: ReviewCommentContext }
  | { kind: "preview-annotation"; record: PreviewAnnotationPayload };

export type ComposerDraftContextRecords = ReadonlyMap<string, ComposerDraftContextRecord>;

export const EMPTY_COMPOSER_CONTEXT_RECORDS: ComposerDraftContextRecords = new Map();

export const ComposerContextRecordsContext = createContext<ComposerDraftContextRecords>(
  EMPTY_COMPOSER_CONTEXT_RECORDS,
);

export function composerContextRecordsFromDraft(input: {
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  reviewComments?: ReadonlyArray<ReviewCommentContext>;
  previewAnnotations?: ReadonlyArray<PreviewAnnotationPayload>;
}): ComposerDraftContextRecords {
  const records = new Map<string, ComposerDraftContextRecord>();
  for (const record of input.terminalContexts) {
    records.set(record.id, { kind: "terminal", record });
  }
  for (const record of input.reviewComments ?? []) {
    records.set(record.id, { kind: "review-comment", record });
  }
  for (const record of input.previewAnnotations ?? []) {
    records.set(record.id, { kind: "preview-annotation", record });
  }
  return records;
}

function ContextChip(props: { icon: ReactElement; label: string; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={COMPOSER_INLINE_CHIP_CLASS_NAME}>
            {props.icon}
            <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label}</span>
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap leading-tight">
        {props.tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

function reviewCommentTooltip(comment: ReviewCommentContext): string {
  const lines = [`${comment.filePath} ${comment.rangeLabel}`];
  if (comment.text.trim()) lines.push("", comment.text.trim());
  return lines.join("\n");
}

function previewAnnotationTooltip(annotation: PreviewAnnotationPayload): string {
  const lines = [annotation.pageTitle?.trim() || annotation.pageUrl];
  if (annotation.comment.trim()) lines.push("", annotation.comment.trim());
  const targets: string[] = [];
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  if (annotation.elements.length > 0) targets.push(plural(annotation.elements.length, "element"));
  if (annotation.regions.length > 0) targets.push(plural(annotation.regions.length, "region"));
  if (annotation.strokes.length > 0) targets.push(plural(annotation.strokes.length, "drawing"));
  if (annotation.styleChanges.length > 0) {
    targets.push(plural(annotation.styleChanges.length, "style change"));
  }
  if (targets.length > 0) lines.push("", targets.join(", "));
  return lines.join("\n");
}

function UnresolvedContextChip(props: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "border-dashed text-muted-foreground")}
            data-context-unresolved="true"
          >
            <CircleDashedIcon className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
            <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label}</span>
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-80 leading-tight">
        This context is no longer available. Remove it or attach it again.
      </TooltipPopup>
    </Tooltip>
  );
}

/** Compact chip for one reference. Unknown kinds and missing records get the unresolved chip. */
export function ComposerContextReferenceChip(props: {
  kind: string;
  contextId: string;
  label: string;
}): ReactElement {
  const records = use(ComposerContextRecordsContext);
  const entry = records.get(props.contextId);
  if (entry?.kind === "terminal" && props.kind === "terminal") {
    return <ComposerPendingTerminalContextChip context={entry.record} />;
  }
  if (entry?.kind === "review-comment" && props.kind === "review-comment") {
    return (
      <ContextChip
        icon={
          <MessageCircleIcon className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
        }
        label={reviewCommentContextLabel(entry.record)}
        tooltip={reviewCommentTooltip(entry.record)}
      />
    );
  }
  if (entry?.kind === "preview-annotation" && props.kind === "preview-annotation") {
    return (
      <ContextChip
        icon={
          <MousePointerClickIcon className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
        }
        label={previewAnnotationContextLabel(entry.record)}
        tooltip={previewAnnotationTooltip(entry.record)}
      />
    );
  }
  return <UnresolvedContextChip label={props.label} />;
}
