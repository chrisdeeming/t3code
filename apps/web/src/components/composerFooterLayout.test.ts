import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  shouldCollapseRestingComposer,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerFooter", () => {
  it("stays expanded without a measured width", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("stays expanded at and above the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48)).toBe(false);
  });

  it("uses a higher breakpoint for wide action states", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("shouldCollapseRestingComposer", () => {
  const resting = {
    isFocused: false,
    hasAttachments: false,
    hasActionableChrome: false,
    hasTransientChrome: false,
    isBusy: false,
    forceExpanded: false,
  };

  it("collapses an empty unfocused composer", () => {
    expect(shouldCollapseRestingComposer(resting)).toBe(true);
  });

  it("stays expanded while focused", () => {
    expect(shouldCollapseRestingComposer({ ...resting, isFocused: true })).toBe(false);
  });

  it("stays expanded when attachments would otherwise be hidden", () => {
    expect(shouldCollapseRestingComposer({ ...resting, hasAttachments: true })).toBe(false);
  });

  it("stays expanded while work is in flight so Stop and the spinner stay reachable", () => {
    expect(shouldCollapseRestingComposer({ ...resting, isBusy: true })).toBe(false);
  });

  it("stays expanded for approval, pending input and plan follow-up panels", () => {
    expect(shouldCollapseRestingComposer({ ...resting, hasActionableChrome: true })).toBe(false);
  });

  it("stays expanded while keybinding-surfaced chrome is showing", () => {
    expect(shouldCollapseRestingComposer({ ...resting, hasTransientChrome: true })).toBe(false);
  });

  it("never collapses when expansion is forced", () => {
    expect(shouldCollapseRestingComposer({ ...resting, forceExpanded: true })).toBe(false);
  });
});

describe("shouldUseCompactComposerPrimaryActions", () => {
  it("matches the wide footer breakpoint", () => {
    expect(
      shouldUseCompactComposerPrimaryActions(
        COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1,
        { hasWideActions: true },
      ),
    ).toBe(true);
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});
