export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  const breakpoint = options?.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

export function shouldUseRestingComposerLayout(input: {
  isExistingThread: boolean;
  isMobileViewport: boolean;
  isFocused: boolean;
  hasExpandedChrome: boolean;
  hasInlineAccessories: boolean;
}): boolean {
  // Passive draft content is deliberately absent here. Resting only clamps
  // the prompt row and overlays its actions; attachment and context rows keep
  // their natural height above it. Resting is also deliberately independent
  // of whether the context strip can show the relocated controls: where the
  // strip lacks the room, the controls are simply not shown until the
  // composer is focused again.
  return (
    input.isExistingThread &&
    !input.isMobileViewport &&
    !input.isFocused &&
    !input.hasExpandedChrome &&
    !input.hasInlineAccessories
  );
}

export function shouldAnimateComposerRestingTransition(input: {
  hasCompletedInitialLayout: boolean;
  stateChanged: boolean;
  hasInterruptedAnimation: boolean;
}): boolean {
  return input.hasCompletedInitialLayout && (input.stateChanged || input.hasInterruptedAnimation);
}

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;
}
