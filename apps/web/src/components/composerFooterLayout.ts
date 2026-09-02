export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
export const RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT = 3;

export function getRestingComposerImagePreviewCounts(imageCount: number): {
  visibleCount: number;
  overflowCount: number;
} {
  const visibleCount = Math.min(imageCount, RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT);
  return {
    visibleCount,
    overflowCount: Math.max(0, imageCount - visibleCount),
  };
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
  // the prompt row and overlays its actions; non-image attachment and context
  // rows keep their natural height above it while image previews move inline.
  // A mounted context strip is required because it hosts the relocated
  // controls. Its responsive visibility is deliberately absent here: at
  // narrower widths the host remains mounted and the controls return when
  // the composer is focused.
  return (
    input.hasControlsHost &&
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

export const RESTING_COMPOSER_CONTROLS_RESTORE_HYSTERESIS_PX = 16;

/**
 * Decide how many trailing resting control blocks move into the overflow
 * menu, and whether the cluster can show at all, from natural widths.
 *
 * Widths must be natural (unsqueezed) so the fit computed here matches what
 * renders. Trailing blocks hide first; when even the picker and overflow
 * trigger cannot fit, the whole cluster hides rather than clipping. A small
 * hysteresis keeps both boundaries from flapping while the host resizes.
 */
export function resolveRestingComposerControlsLayout(input: {
  hostWidth: number;
  gap: number;
  fixedWidth: number;
  blockWidths: readonly number[];
  overflowWidth: number;
  currentHiddenCount: number;
  currentVisible: boolean;
}): { hiddenCount: number; visible: boolean } {
  const { blockWidths, gap, hostWidth } = input;
  const widthWithHidden = (hidden: number) => {
    const visibleCount = blockWidths.length - hidden;
    return (
      input.fixedWidth +
      blockWidths.slice(0, visibleCount).reduce((sum, width) => sum + width, 0) +
      (hidden > 0 ? input.overflowWidth : 0) +
      gap * (visibleCount + (hidden > 0 ? 1 : 0))
    );
  };
  const restoreWidth = hostWidth - RESTING_COMPOSER_CONTROLS_RESTORE_HYSTERESIS_PX;

  let hiddenCount = Math.min(Math.max(0, input.currentHiddenCount), blockWidths.length);
  while (hiddenCount < blockWidths.length && widthWithHidden(hiddenCount) > hostWidth) {
    hiddenCount += 1;
  }
  while (hiddenCount > 0 && widthWithHidden(hiddenCount - 1) <= restoreWidth) {
    hiddenCount -= 1;
  }
  const visible = widthWithHidden(hiddenCount) <= (input.currentVisible ? hostWidth : restoreWidth);
  return { hiddenCount, visible };
}
