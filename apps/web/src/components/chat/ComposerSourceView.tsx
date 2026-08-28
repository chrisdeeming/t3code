import { CodeIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "~/lib/terminalContext";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ComposerSourceToggleProps {
  open: boolean;
  disabled?: boolean;
  /** Rendered in the tooltip so the button advertises its shortcut. */
  shortcutLabel?: string | null;
  onToggle: () => void;
}

/**
 * Footer control that swaps the rich editor for its Markdown source. Kept as
 * its own component so moving it within the footer is a one-line change.
 */
export function ComposerSourceToggle(props: ComposerSourceToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={props.open}
            aria-label={props.open ? "Hide Markdown source" : "Show Markdown source"}
            data-composer-source-toggle={props.open ? "open" : "closed"}
            disabled={props.disabled ?? false}
            className={cn(
              "size-7 shrink-0 px-0 text-secondary-label",
              props.open && "bg-accent text-foreground",
            )}
            onClick={props.onToggle}
          />
        }
      >
        <CodeIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup>
        {props.open ? "Hide Markdown source" : "Show Markdown source"}
        {props.shortcutLabel ? ` (${props.shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

export interface ComposerSourceEditorProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  className?: string;
  onChange: (next: string, cursor: number) => void;
  /** Cmd/Ctrl+Enter, matching the editor's own escape hatch to send. */
  onSubmit: () => void;
  /** Escape returns to the rich editor without sending. */
  onClose: () => void;
}

const countTerminalContextPlaceholders = (value: string): number =>
  value.split(INLINE_TERMINAL_CONTEXT_PLACEHOLDER).length - 1;

/**
 * Keeps identity-bearing terminal contexts aligned while their identity-free
 * placeholders are edited in the source textarea. Context placeholders that
 * survive in the unchanged prefix or suffix retain their ids. Placeholders in
 * the replaced span are removals; newly typed or pasted placeholders are
 * stripped because source text cannot invent a matching context draft.
 */
export function reconcileSourceTerminalContexts(input: {
  currentPrompt: string;
  nextPrompt: string;
  nextCursor: number;
  terminalContextIds: ReadonlyArray<string>;
}): { prompt: string; cursor: number; terminalContextIds: string[] } {
  const { currentPrompt, nextPrompt, terminalContextIds } = input;
  let prefix = 0;
  const maxPrefix = Math.min(currentPrompt.length, nextPrompt.length);
  while (prefix < maxPrefix && currentPrompt[prefix] === nextPrompt[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(currentPrompt.length - prefix, nextPrompt.length - prefix);
  while (
    suffix < maxSuffix &&
    currentPrompt[currentPrompt.length - 1 - suffix] === nextPrompt[nextPrompt.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const prefixContextCount = countTerminalContextPlaceholders(currentPrompt.slice(0, prefix));
  const suffixContextCount = countTerminalContextPlaceholders(
    currentPrompt.slice(currentPrompt.length - suffix),
  );
  const changedEnd = nextPrompt.length - suffix;
  const changed = nextPrompt.slice(prefix, changedEnd);
  const sanitizedChanged = changed.replaceAll(INLINE_TERMINAL_CONTEXT_PLACEHOLDER, "");
  const prompt = `${nextPrompt.slice(0, prefix)}${sanitizedChanged}${nextPrompt.slice(changedEnd)}`;
  const removedBeforeCursor = countTerminalContextPlaceholders(
    changed.slice(0, Math.max(0, input.nextCursor - prefix)),
  );

  return {
    prompt,
    cursor: Math.max(0, input.nextCursor - removedBeforeCursor),
    terminalContextIds: [
      ...terminalContextIds.slice(0, prefixContextCount),
      ...(suffixContextCount > 0 ? terminalContextIds.slice(-suffixContextCount) : []),
    ],
  };
}

/**
 * The raw Markdown behind the prompt, in a plain textarea. Enter is a newline
 * here and never sends: the point of this view is to edit text the editor would
 * otherwise interpret, so a stray Enter submitting mid-edit would defeat it.
 * Sending stays on Mod+Enter, which works from the rich editor too.
 */
export function ComposerSourceEditor(props: ComposerSourceEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Opening the view should land the caret at the end, the way focusing the
  // rich editor does, rather than leaving focus on the toggle button.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  // A textarea keeps whatever height its rows give it, so without this a prompt
  // taller than the minimum scrolls inside a short box while the rich editor
  // would have grown. Reset first so deleting lines shrinks it back down; the
  // CSS max-height still caps it and takes over with a scrollbar.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [props.value]);

  return (
    <textarea
      ref={textareaRef}
      data-composer-source-editor="true"
      className={cn(
        "block max-h-50 min-h-17.5 w-full resize-none overflow-y-auto bg-transparent font-mono text-[0.8125rem] leading-relaxed text-foreground focus:outline-none",
        props.className,
      )}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      aria-label="Markdown source"
      onChange={(event) => {
        props.onChange(event.target.value, event.target.selectionStart);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          props.onSubmit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
          return;
        }
        // The composer's window-level shortcuts would otherwise see ordinary
        // typing here as chords; the textarea owns its own keys.
        event.stopPropagation();
      }}
    />
  );
}
