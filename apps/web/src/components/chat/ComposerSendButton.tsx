import { memo, type PointerEventHandler } from "react";
import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { StageBackdropButtonArt, useSidebarStageBackdropVariant } from "../SidebarStageBackdrop";
import { Spinner } from "../ui/spinner";

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

/**
 * Resolves the send control's accessible name. The label carries the reason a
 * send is unavailable, so a disabled button still explains itself.
 */
export function composerSendButtonLabel(input: {
  isEnvironmentUnavailable: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isPreparingWorktree: boolean;
  isSendBusy: boolean;
}): string {
  if (input.isEnvironmentUnavailable) return "Environment disconnected";
  if (input.sendDisabledReason !== null) return input.sendDisabledReason;
  if (input.isConnecting) return "Connecting";
  if (input.isPreparingWorktree) return "Preparing worktree";
  if (input.isSendBusy) return "Sending";
  return "Send message";
}

interface ComposerSendButtonProps {
  disabled: boolean;
  label: string;
  /** Swaps the glyph for a spinner while a send is in flight. */
  isBusy: boolean;
  /** Submits via the enclosing form; the collapsed row calls `onClick` instead. */
  type: "submit" | "button";
  preserveComposerFocusOnPointerDown?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Marks the collapsed row's copy so focusing it does not expand the composer. */
  collapsedControl?: boolean;
}

/**
 * The composer's send control. Both the expanded footer and the collapsed
 * resting row render this, so clicking the row swaps the composer around a
 * button that keeps the same weight, shadow and glyph.
 */
export const ComposerSendButton = memo(function ComposerSendButton({
  disabled,
  label,
  isBusy,
  type,
  preserveComposerFocusOnPointerDown,
  onClick,
  collapsedControl,
}: ComposerSendButtonProps) {
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );

  return (
    <button
      type={type}
      {...(collapsedControl ? { "data-chat-composer-collapsed-controls": "true" } : {})}
      className={cn(
        "relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8",
        stageBackdropVariant
          ? "bg-transparent text-white enabled:shadow-black/24 enabled:hover:brightness-110"
          : "bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover",
      )}
      {...(preserveComposerFocusOnPointerDown ? { onPointerDown: preventPointerFocus } : {})}
      {...(onClick ? { onClick } : {})}
      disabled={disabled}
      aria-label={label}
    >
      {stageBackdropVariant ? (
        <span className="absolute inset-0 -z-10" aria-hidden="true">
          <StageBackdropButtonArt variant={stageBackdropVariant} />
        </span>
      ) : null}
      {isBusy ? (
        <Spinner className="size-3.5" aria-hidden="true" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
});
