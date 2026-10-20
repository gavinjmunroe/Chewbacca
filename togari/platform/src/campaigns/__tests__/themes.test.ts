import { describe, expect, it } from "vitest";
import { CALENDAR_THEMES, themeFor } from "../themes";

/** WCAG contrast ratio between two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(Object.entries(CALENDAR_THEMES))("theme %s", (_name, t) => {
  it("keeps every line of text readable where it sits", () => {
    for (const bg of [t.page, t.band, t.surface, t.accentSoft]) {
      expect(contrast(t.ink, bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.text, bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.muted, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accent, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.attention, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t.ink, t.today)).toBeGreaterThanOrEqual(7);
  });

  it("has eight campaign colors that hold up on the calendar", () => {
    expect(t.campaigns).toHaveLength(8);
    expect(new Set(t.campaigns).size).toBe(8);
    for (const c of t.campaigns)
      expect(contrast(c, t.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe("themeFor", () => {
  it("falls back to the default for an unknown or missing name", () => {
    expect(themeFor("nobody")).toBe(CALENDAR_THEMES.default);
    expect(themeFor(undefined)).toBe(CALENDAR_THEMES.default);
    expect(themeFor("serif")).toBe(CALENDAR_THEMES.serif);
  });
});
