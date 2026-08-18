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

/**
 * Whether the composer rests as a single row instead of the full editor plus
 * toolbar. Unfocused is the base rule: a drafted message still collapses,
 * shown truncated in the collapsed row, so parking a draft does not cost the
 * transcript ~90px.
 *
 * It stays expanded whenever collapsing would hide something the user needs to
 * act on. The collapsed row carries only prompt text and a send button, so
 * staged attachments, a running turn's Stop control, and the plan follow-up
 * actions each keep the full composer mounted. Approvals and pending inputs
 * are not listed here because they render their own collapsed variants.
 *
 * `hasTransientChrome` covers the things a global keybinding can surface inside
 * the expanded tree: the stash menu, the model picker, and the stash badge
 * pulse that confirms a save. Collapsing would leave those shortcuts opening
 * nothing, or firing with no visible feedback.
 */
export function shouldCollapseRestingComposer(input: {
  isFocused: boolean;
  hasAttachments: boolean;
  hasActionableChrome: boolean;
  hasTransientChrome: boolean;
  isBusy: boolean;
  forceExpanded: boolean;
}): boolean {
  if (input.forceExpanded || input.isFocused) {
    return false;
  }
  return (
    !input.hasAttachments &&
    !input.hasActionableChrome &&
    !input.hasTransientChrome &&
    !input.isBusy
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
