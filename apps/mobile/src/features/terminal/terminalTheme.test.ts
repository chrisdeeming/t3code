import { describe, expect, it } from "vite-plus/test";

import {
  buildGhosttyThemeConfig,
  getMobileTerminalTheme,
  getPierreTerminalTheme,
} from "./terminalTheme";

describe("getPierreTerminalTheme", () => {
  it("returns the Pierre light terminal palette", () => {
    expect(getPierreTerminalTheme("light")).toMatchObject({
      background: "#f2f2f7",
      foreground: "#6C6C71",
      cursorForeground: "#009fff",
      cursorBackground: "#f2f2f7",
    });
  });

  it("returns the Pierre dark terminal palette", () => {
    expect(getPierreTerminalTheme("dark")).toMatchObject({
      background: "#0a0a0a",
      foreground: "#adadb1",
      cursorForeground: "#009fff",
      cursorBackground: "#0a0a0a",
    });
  });
});

describe("getMobileTerminalTheme", () => {
  it("preserves the Pierre terminal for the default theme", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(getMobileTerminalTheme("t3-code", scheme)).toEqual(getPierreTerminalTheme(scheme));
    }
  });

  it("applies the selected palette without replacing ANSI status colors", () => {
    const standard = getMobileTerminalTheme("t3-code", "dark");
    const ocean = getMobileTerminalTheme("ocean", "dark");

    expect(ocean.background).not.toBe(standard.background);
    expect(ocean.cursorForeground).not.toBe(standard.cursorForeground);
    expect(ocean.palette).toEqual(standard.palette);
  });
});

describe("buildGhosttyThemeConfig", () => {
  it("serializes theme colors into a ghostty config file", () => {
    const config = buildGhosttyThemeConfig(getPierreTerminalTheme("dark"));

    expect(config).toContain("background = #0a0a0a");
    expect(config).toContain("foreground = #adadb1");
    expect(config).toContain("cursor-color = #009fff");
    expect(config).toContain("palette = 0=#141415");
    expect(config).toContain("palette = 15=#c6c6c8");
    expect(config.endsWith("\n")).toBe(true);
  });
});
