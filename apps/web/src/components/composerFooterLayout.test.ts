import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  getRestingComposerImagePreviewCounts,
  RESTING_COMPOSER_CONTROLS_RESTORE_HYSTERESIS_PX,
  resolveRestingComposerControlsLayout,
  shouldAnimateComposerRestingTransition,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
  shouldUseRestingComposerLayout,
} from "./composerFooterLayout";

describe("getRestingComposerImagePreviewCounts", () => {
  it("shows at most three thumbnails and counts the remainder", () => {
    expect(getRestingComposerImagePreviewCounts(0)).toEqual({
      visibleCount: 0,
      overflowCount: 0,
    });
    expect(getRestingComposerImagePreviewCounts(3)).toEqual({
      visibleCount: 3,
      overflowCount: 0,
    });
    expect(getRestingComposerImagePreviewCounts(7)).toEqual({
      visibleCount: 3,
      overflowCount: 4,
    });
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

  it("keeps the full footer when there is no context strip to host its controls", () => {
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

describe("shouldAnimateComposerRestingTransition", () => {
  it("does not animate layout measurements that settle during initial mount", () => {
    expect(
      shouldAnimateComposerRestingTransition({
        hasCompletedInitialLayout: false,
        stateChanged: true,
        hasInterruptedAnimation: false,
      }),
    ).toBe(false);
  });

  it("animates later resting-state changes and interrupted transitions", () => {
    expect(
      shouldAnimateComposerRestingTransition({
        hasCompletedInitialLayout: true,
        stateChanged: true,
        hasInterruptedAnimation: false,
      }),
    ).toBe(true);
    expect(
      shouldAnimateComposerRestingTransition({
        hasCompletedInitialLayout: true,
        stateChanged: false,
        hasInterruptedAnimation: true,
      }),
    ).toBe(true);
  });
});

describe("resolveRestingComposerControlsLayout", () => {
  // Natural widths: picker 140 (+ separator 9 = fixed 149), traits 60, mode 140,
  // overflow 24, gap 4.
  const base = {
    gap: 4,
    fixedWidth: 149,
    blockWidths: [60, 140],
    overflowWidth: 24,
    currentHiddenCount: 0,
    currentVisible: true,
  };

  it("shows everything when the host has room", () => {
    // 149 + 60 + 140 + 4 * 2 = 357
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 357 })).toEqual({
      hiddenCount: 0,
      visible: true,
    });
  });

  it("moves trailing blocks into the overflow menu until the rest fits", () => {
    // 149 + 60 + 24 + 4 * 2 = 241
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 356 })).toEqual({
      hiddenCount: 1,
      visible: true,
    });
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 241 })).toEqual({
      hiddenCount: 1,
      visible: true,
    });
    // 149 + 24 + 4 = 177
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 240 })).toEqual({
      hiddenCount: 2,
      visible: true,
    });
  });

  it("hides the whole cluster when even the picker and overflow menu cannot fit", () => {
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 176 })).toEqual({
      hiddenCount: 2,
      visible: false,
    });
    expect(resolveRestingComposerControlsLayout({ ...base, hostWidth: 0 })).toEqual({
      hiddenCount: 2,
      visible: false,
    });
  });

  it("keeps hidden blocks hidden until there is hysteresis room to restore them", () => {
    const hiddenOne = { ...base, currentHiddenCount: 1 };
    expect(resolveRestingComposerControlsLayout({ ...hiddenOne, hostWidth: 357 })).toEqual({
      hiddenCount: 1,
      visible: true,
    });
    expect(
      resolveRestingComposerControlsLayout({
        ...hiddenOne,
        hostWidth: 357 + RESTING_COMPOSER_CONTROLS_RESTORE_HYSTERESIS_PX,
      }),
    ).toEqual({ hiddenCount: 0, visible: true });
  });

  it("keeps a hidden cluster hidden until there is hysteresis room to show it", () => {
    const hiddenCluster = { ...base, currentHiddenCount: 2, currentVisible: false };
    expect(resolveRestingComposerControlsLayout({ ...hiddenCluster, hostWidth: 177 })).toEqual({
      hiddenCount: 2,
      visible: false,
    });
    expect(
      resolveRestingComposerControlsLayout({
        ...hiddenCluster,
        hostWidth: 177 + RESTING_COMPOSER_CONTROLS_RESTORE_HYSTERESIS_PX,
      }),
    ).toEqual({ hiddenCount: 2, visible: true });
  });

  it("restores several blocks at once when the host grows enough", () => {
    expect(
      resolveRestingComposerControlsLayout({
        ...base,
        currentHiddenCount: 2,
        currentVisible: false,
        hostWidth: 600,
      }),
    ).toEqual({ hiddenCount: 0, visible: true });
  });

  it("clamps a stale hidden count to the current block list", () => {
    expect(
      resolveRestingComposerControlsLayout({
        ...base,
        blockWidths: [140],
        currentHiddenCount: 2,
        hostWidth: 600,
      }),
    ).toEqual({ hiddenCount: 0, visible: true });
  });
});
