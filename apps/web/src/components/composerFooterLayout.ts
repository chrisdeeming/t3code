export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
export const COMPOSER_RESTING_CONTROLS_MIN_WIDTH_REM = 6;

export function hasRestingComposerControlsSpace(width: number, rootFontSize: number): boolean {
  return width >= COMPOSER_RESTING_CONTROLS_MIN_WIDTH_REM * rootFontSize;
}

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
  hasControlsHost: boolean;
  isExistingThread: boolean;
  isMobileViewport: boolean;
  isFocused: boolean;
  hasExpandedChrome: boolean;
  hasInlineAccessories: boolean;
}): boolean {
  // Passive draft content is deliberately absent here. Resting only clamps
  // the prompt row and overlays its actions; attachment and context rows keep
  // their natural height above it.
  return (
    input.hasControlsHost &&
    input.isExistingThread &&
    !input.isMobileViewport &&
    !input.isFocused &&
    !input.hasExpandedChrome &&
    !input.hasInlineAccessories
  );
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
