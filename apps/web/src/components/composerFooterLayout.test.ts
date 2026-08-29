import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_RESTING_CONTROLS_MIN_WIDTH_REM,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  hasRestingComposerControlsSpace,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
  shouldUseRestingComposerLayout,
} from "./composerFooterLayout";

describe("hasRestingComposerControlsSpace", () => {
  it("requires enough room for the compact picker and overflow affordance", () => {
    const minimumWidth = COMPOSER_RESTING_CONTROLS_MIN_WIDTH_REM * 16;

    expect(hasRestingComposerControlsSpace(minimumWidth - 1, 16)).toBe(false);
    expect(hasRestingComposerControlsSpace(minimumWidth, 16)).toBe(true);
  });

  it("scales the minimum with the app root font size", () => {
    expect(hasRestingComposerControlsSpace(96, 20)).toBe(false);
    expect(hasRestingComposerControlsSpace(120, 20)).toBe(true);
  });
});

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

describe("shouldUseRestingComposerLayout", () => {
  const resting = {
    hasControlsHost: true,
    isExistingThread: true,
    isMobileViewport: false,
    isFocused: false,
    hasExpandedChrome: false,
    hasInlineAccessories: false,
  };

  it("uses the resting layout for an unfocused desktop composer", () => {
    expect(shouldUseRestingComposerLayout(resting)).toBe(true);
  });

  it("stays expanded until the resting controls have a visible host", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, hasControlsHost: false })).toBe(false);
  });

  it("keeps new-thread composers expanded", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, isExistingThread: false })).toBe(false);
  });

  it("leaves responsive mobile on its existing collapse path", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, isMobileViewport: true })).toBe(false);
  });

  it("expands when focus is anywhere in the composer", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, isFocused: true })).toBe(false);
  });

  it("keeps drawers and composer-owned menus expanded", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, hasExpandedChrome: true })).toBe(false);
  });

  it("keeps inline task and stash accessories at full height", () => {
    expect(shouldUseRestingComposerLayout({ ...resting, hasInlineAccessories: true })).toBe(false);
  });
});
