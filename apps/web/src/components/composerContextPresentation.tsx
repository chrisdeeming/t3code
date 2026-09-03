import { CircleDashedIcon } from "lucide-react";
import { createContext, type ReactElement, use } from "react";

import { cn } from "~/lib/utils";
import type { TerminalContextDraft } from "~/lib/terminalContext";
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
export type ComposerDraftContextRecord = { kind: "terminal"; record: TerminalContextDraft };

export type ComposerDraftContextRecords = ReadonlyMap<string, ComposerDraftContextRecord>;

export const EMPTY_COMPOSER_CONTEXT_RECORDS: ComposerDraftContextRecords = new Map();

export const ComposerContextRecordsContext = createContext<ComposerDraftContextRecords>(
  EMPTY_COMPOSER_CONTEXT_RECORDS,
);

export function composerContextRecordsFromDraft(input: {
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): ComposerDraftContextRecords {
  const records = new Map<string, ComposerDraftContextRecord>();
  for (const record of input.terminalContexts) {
    records.set(record.id, { kind: "terminal", record });
  }
  return records;
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
  return <UnresolvedContextChip label={props.label} />;
}
