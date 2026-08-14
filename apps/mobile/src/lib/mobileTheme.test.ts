import { describe, expect, it } from "vite-plus/test";

import { BUILT_IN_THEME_IDS, BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";

import {
  createMobileThemeVariables,
  DEFAULT_MOBILE_THEME_ID,
  getMobileThemePreviewColors,
  getMobileThemeVariables,
  normalizeMobileThemeId,
  normalizeMobileThemeMode,
  themeColorWithAlpha,
  themeColorToNativeColor,
} from "./mobileTheme";

describe("mobile themes", () => {
  it("shares all built-in desktop palettes", () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(BUILT_IN_THEME_IDS);
    for (const themeId of BUILT_IN_THEME_IDS) {
      expect(getMobileThemeVariables(themeId, "light")["--color-screen"]).toMatch(/^#/);
      expect(getMobileThemeVariables(themeId, "dark")["--color-screen"]).toMatch(/^#/);
    }
  });

  it("preserves the existing mobile palette as the default", () => {
    expect(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "light")["--color-screen"]).toBe(
      "#f2f2f7",
    );
    expect(getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "dark")["--color-screen"]).toBe(
      "#0a0a0a",
    );
    expect(
      getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "light")[
        "--color-user-bubble-skill-foreground"
      ],
    ).toBe("#f0abfc");
  });

  it("uses the same preview roles and standard artwork as desktop", () => {
    expect(getMobileThemePreviewColors(DEFAULT_MOBILE_THEME_ID, "light")).toEqual({
      canvas: "#fcfcfc",
      accent: "#f4f4f5",
      messageAction: "#4f46e5",
    });
    const desktopOcean = BUILT_IN_THEMES.find((theme) => theme.id === "ocean")!;
    expect(getMobileThemePreviewColors("ocean", "light")).toEqual({
      canvas: themeColorToNativeColor(desktopOcean.colors.canvas),
      accent: themeColorToNativeColor(desktopOcean.colors.accent),
      messageAction: themeColorToNativeColor(desktopOcean.colors.messageAction),
    });
  });

  it("normalizes persisted theme preferences", () => {
    expect(normalizeMobileThemeId("ocean")).toBe("ocean");
    expect(normalizeMobileThemeId("missing-theme")).toBe(DEFAULT_MOBILE_THEME_ID);
    expect(normalizeMobileThemeMode("dark")).toBe("dark");
    expect(normalizeMobileThemeMode("sepia")).toBe("system");
  });

  it("converts OKLCH colors to React Native sRGB ColorValues", () => {
    expect(themeColorToNativeColor("oklch(1 0 0)")).toBe("#ffffff");
    expect(themeColorToNativeColor("oklch(0 0 0)")).toBe("#000000");
    expect(themeColorToNativeColor("#123456")).toBe("#123456");
  });

  it("changes native palette color opacity for fades", () => {
    expect(themeColorWithAlpha("#123456", 0)).toBe("rgba(18, 52, 86, 0)");
    expect(themeColorWithAlpha("rgba(18, 52, 86, 0.98)", 0)).toBe("rgba(18, 52, 86, 0)");
  });

  it("maps semantic palette roles onto every mobile color variable", () => {
    const variables = createMobileThemeVariables(BUILT_IN_THEMES[0].colors);
    expect(Object.keys(variables)).toHaveLength(61);
    expect(variables["--color-primary"]).not.toBe(variables["--color-screen"]);
    expect(variables["--color-user-bubble-foreground"]).toMatch(/^#/);
  });
});
