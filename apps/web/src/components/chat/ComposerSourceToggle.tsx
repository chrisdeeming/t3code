import { CodeIcon } from "lucide-react";
import { memo } from "react";

import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const LABEL_ON = "Edit the Markdown source";
const LABEL_OFF = "Back to the rich text editor";

/**
 * Swaps the composer between rich text and its literal Markdown source. It
 * sits with the draft actions, beside attach, and looks like them: it acts on
 * the draft, not on how the agent runs.
 *
 * There is no second editor behind this: plain mode is the same Tiptap
 * document with the mark extensions off, so the draft, the chips and the
 * caret all survive the flip. The button writes the same client setting the
 * Settings panel exposes, which is what makes the two agree. Pointer-down is
 * swallowed so the click never takes focus from the editor it is flipping.
 */
export const ComposerSourceToggle = memo(function ComposerSourceToggle(props: {
  richTextEnabled: boolean;
  onToggle: () => void;
}) {
  const label = props.richTextEnabled ? LABEL_ON : LABEL_OFF;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            variant="ghost"
            size="sm"
            pressed={!props.richTextEnabled}
            onPressedChange={props.onToggle}
            aria-label={label}
            data-composer-source-toggle={props.richTextEnabled ? "closed" : "open"}
            onPointerDown={(event) => event.preventDefault()}
          />
        }
      >
        <CodeIcon className="size-4 sm:size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
});
