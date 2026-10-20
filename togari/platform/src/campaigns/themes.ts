/**
 * How a client's campaign calendar looks: fonts, colors and the campaign
 * colors, picked by name in the client's config (campaignCalendar.theme).
 * A new client's brand is one more entry here; the page itself never changes.
 *
 * Text colors are checked in __tests__/themes.test.ts: muted text at least
 * 4.5:1 on every background it sits on, campaign colors at least 3:1 on the
 * calendar. Campaign colors go in a fixed order, first campaign first, and an
 * order was chosen so neighbours stay apart for colorblind readers (worst
 * adjacent pair 8.4 for both themes, checked 2026-10-14).
 */
export interface CalendarTheme {
  /** The Google Fonts css2 query, e.g. "family=Sora:wght@400;600". */
  fonts: string;
  heading: string;
  body: string;
  /** Page background. */
  page: string;
  /** Background of the week section under the calendar. */
  band: string;
  /** Cards and the calendar. */
  surface: string;
  /** A wash over Saturday and Sunday; translucent so a selected week shows through. */
  weekend: string;
  line: string;
  /** Headings and numbers. */
  ink: string;
  text: string;
  /** Secondary text. At least 4.5:1 on page, band and surface. */
  muted: string;
  /** Dates outside the month. */
  faint: string;
  /** Links, focus, the selected week's edge, the Interested bar. */
  accent: string;
  /** The selected week. */
  accentSoft: string;
  /** Every other outcome bar. */
  barSoft: string;
  /** Behind today's date, under ink text. */
  today: string;
  /** The waiting count and reply tags. */
  attention: string;
  /** Borders on buttons. */
  control: string;
  /** Campaign colors in order. A ninth campaign in one month gets `faint`. */
  campaigns: string[];
}

export const CALENDAR_THEMES: Record<string, CalendarTheme> = {
  default: {
    fonts: "family=Inter:wght@400;500;600",
    heading: "Inter, system-ui, sans-serif",
    body: "Inter, system-ui, sans-serif",
    page: "#ffffff",
    band: "#f6f7f9",
    surface: "#ffffff",
    weekend: "rgba(22, 24, 29, 0.025)",
    line: "#e4e7ec",
    ink: "#16181d",
    text: "#31363f",
    muted: "#5c6370",
    faint: "#8a909b",
    accent: "#256abf",
    accentSoft: "#eef4fc",
    barSoft: "#cfe0f6",
    today: "#fff1b8",
    attention: "#b45309",
    control: "#16181d",
    campaigns: [
      "#2a78d6",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#4a3aa7",
      "#e34948",
    ],
  },
  // Taken from serifhealth.com on 2026-10-14: Sora headings, navy #001639
  // buttons, blue #1058e5 and violet #8c20c0, pale blue sections, a lime
  // highlight. Their blue leads the campaign colors. Their violet sits further
  // down: next to the blue, colorblind readers can't tell the two apart.
  serif: {
    fonts: "family=Sora:wght@400;500;600&family=Inter:wght@400;500;600",
    heading: "Sora, Inter, system-ui, sans-serif",
    body: "Inter, system-ui, sans-serif",
    page: "#ffffff",
    band: "#eef7ff",
    surface: "#ffffff",
    weekend: "rgba(0, 22, 57, 0.025)",
    line: "#e4e7ec",
    ink: "#16181d",
    text: "#31363f",
    muted: "#5c6370",
    faint: "#8a909b",
    accent: "#1058e5",
    accentSoft: "#eef7ff",
    barSoft: "#badfff",
    today: "#e2fc9a",
    attention: "#8c20c0",
    control: "#001639",
    campaigns: [
      "#1058e5",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#8c20c0",
      "#e34948",
    ],
  },
};

export function themeFor(name: string | undefined): CalendarTheme {
  return (name && CALENDAR_THEMES[name]) || CALENDAR_THEMES.default;
}
