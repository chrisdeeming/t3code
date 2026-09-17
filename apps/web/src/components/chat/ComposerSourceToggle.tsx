import { CodeIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const LABEL_ON = "Edit the Markdown source";
const LABEL_OFF = "Back to the rich text editor";

/**
 * Swaps the composer between rich text and its literal Markdown source.
 *
 * There is no second editor behind this: plain mode is the same Tiptap
 * document with the mark extensions off, so the draft, the chips and the
 * caret all survive the flip. The button writes the same client setting the
 * Settings panel exposes, which is what makes the two agree.
 */
export const ComposerSourceToggle = memo(function ComposerSourceToggle(props: {
  richTextEnabled: boolean;
  size?: "sm" | "xs";
  onToggle: () => void;
}) {
  const size = props.size ?? "sm";
  const label = props.richTextEnabled ? LABEL_ON : LABEL_OFF;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            type="button"
            size={size}
            aria-label={label}
            aria-pressed={!props.richTextEnabled}
            data-composer-source-toggle={props.richTextEnabled ? "closed" : "open"}
            className={cn(
              "shrink-0 px-2",
              !props.richTextEnabled && "bg-accent text-accent-foreground hover:bg-accent/80",
            )}
            onClick={props.onToggle}
          />
        }
      >
        <ComposerControlIcon icon={CodeIcon} size={size} />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
});
