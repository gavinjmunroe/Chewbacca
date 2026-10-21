/**
 * The pure half of the kitchen page: which light, which camera, and where a
 * point of the render lands on the screen. No DOM, so it is unit tested
 * (lib/fridge.test.mjs) and the component only has to apply the numbers.
 */

export type Light = "morning" | "golden" | "night";
export type Camera = "wide" | "tall";
export type Pt = [number, number];
/** x, y, w, h in percent of the frame. */
export type Rect = [number, number, number, number];

export const LIGHTS: Light[] = ["morning", "golden", "night"];

/**
 * The visitor's own clock picks the light: morning before 11, golden hour from
 * 11 to 18, night after. Before 5 in the morning it is still night, because a
 * 2 a.m. visitor shown a sunrise would know it was fake.
 */
export function lightFor(hour: number): Light {
  if (hour < 5) return "night";
  if (hour < 11) return "morning";
  if (hour < 18) return "golden";
  return "night";
}

export function parseLight(value: string | null | undefined): Light | null {
  return value === "morning" || value === "golden" || value === "night"
    ? value
    : null;
}

/**
 * The camera whose aspect is closest to the viewport's, compared on a log
 * scale so 2:1 and 1:2 are equally far from square. The two renders are
 * framed separately in Blender, so one is never cropped into the other.
 */
export function pickCamera(
  viewW: number,
  viewH: number,
  cameras: Record<Camera, { width: number; height: number }>,
): Camera {
  const v = Math.log(viewW / Math.max(1, viewH));
  const wide = Math.abs(v - Math.log(cameras.wide.width / cameras.wide.height));
  const tall = Math.abs(v - Math.log(cameras.tall.width / cameras.tall.height));
  // Equal aspects (a stand-in tall camera reusing the wide frame): go by the
  // viewport's orientation, so a phone still gets the phone framing.
  if (Math.abs(tall - wide) < 1e-9) return viewH > viewW ? "tall" : "wide";
  return tall < wide ? "tall" : "wide";
}

export type View = { scale: number; x: number; y: number };

/**
 * object-fit: cover, computed rather than left to CSS, so the hotspots, clips
 * and clock layers ride the exact same transform as the still and stay pixel
 * aligned at every size and zoom. `focus` (percent) is the point kept as close
 * to the centre as the crop allows; the default is the frame's centre.
 */
export function coverView(
  frameW: number,
  frameH: number,
  viewW: number,
  viewH: number,
  focus: Pt = [50, 50],
): View {
  const scale = Math.max(viewW / frameW, viewH / frameH);
  const w = frameW * scale;
  const h = frameH * scale;
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));
  return {
    scale,
    x: clamp(viewW / 2 - (focus[0] / 100) * w, viewW - w, 0),
    y: clamp(viewH / 2 - (focus[1] / 100) * h, viewH - h, 0),
  };
}

/**
 * The view that brings `rect` (percent of the frame) to the middle of the
 * screen at the largest size that still leaves `margin` of the viewport
 * around it. Used to zoom onto the journal page.
 */
export function zoomView(
  frameW: number,
  frameH: number,
  viewW: number,
  viewH: number,
  rect: Rect,
  margin = 0.08,
): View {
  const rw = (rect[2] / 100) * frameW;
  const rh = (rect[3] / 100) * frameH;
  const scale = Math.min(
    (viewW * (1 - margin * 2)) / rw,
    (viewH * (1 - margin * 2)) / rh,
  );
  const cx = ((rect[0] + rect[2] / 2) / 100) * frameW;
  const cy = ((rect[1] + rect[3] / 2) / 100) * frameH;
  return { scale, x: viewW / 2 - cx * scale, y: viewH / 2 - cy * scale };
}

/** Where a frame point (percent) lands on screen under a view, in CSS px. */
export function toScreen(
  pt: Pt,
  frameW: number,
  frameH: number,
  view: View,
): Pt {
  return [
    view.x + (pt[0] / 100) * frameW * view.scale,
    view.y + (pt[1] / 100) * frameH * view.scale,
  ];
}

/** Bounding box of a polygon, in the polygon's own units. */
export function boundsOf(poly: Pt[]): Rect {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x || 1, Math.max(...ys) - y || 1];
}

/** CSS clip-path for a polygon, relative to its own bounding box. */
export function clipPathFor(poly: Pt[]): string {
  const [x, y, w, h] = boundsOf(poly);
  const pts = poly
    .map(
      ([px, py]) =>
        `${(((px - x) / w) * 100).toFixed(2)}% ${(((py - y) / h) * 100).toFixed(2)}%`,
    )
    .join(", ");
  return `polygon(${pts})`;
}

/**
 * Clock hand angles in degrees clockwise from twelve. The hour hand creeps
 * with the minutes the way a real movement does; the minute hand jumps once a
 * minute, which is all the page redraws.
 */
export function clockAngles(date: Date): { hour: number; minute: number } {
  const m = date.getMinutes();
  const h = date.getHours() % 12;
  return { hour: h * 30 + m * 0.5, minute: m * 6 };
}

/** Milliseconds until the next whole minute, so the hands move on the minute. */
export function msToNextMinute(date: Date): number {
  return 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds());
}

/** The digits of a US cell number, with a leading country code dropped. */
export function phoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

/**
 * Complete means ten digits and an area code that can exist. A number that is
 * not complete is never sent; there is no button to press too early.
 */
export function isCompletePhone(raw: string): boolean {
  const d = phoneDigits(raw);
  return d.length === 10 && d[0] !== "0" && d[0] !== "1";
}

/**
 * How the digits are grouped when written on the line: 555 010 0002, the way
 * people write a number by hand, with a small gap rather than punctuation.
 */
export function phoneGroups(digits: string): string[] {
  const d = digits.slice(0, 15);
  if (d.length <= 3) return d ? [d] : [];
  if (d.length <= 6) return [d.slice(0, 3), d.slice(3)];
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
}
