import type { Stroke } from "./card";
import { DIGITS, DIGIT_HEIGHT } from "./digits";
import { phoneGroups } from "@/lib/fridge";

/**
 * THE TYPED NUMBER, WRITTEN BY HAND ON THE LINE.
 *
 * Each digit is one of the learned glyphs in digits.ts, picked by its place in
 * the number so the same digit twice is written two slightly different ways,
 * the way a hand does. The result is ordinary strokes in page coordinates, so
 * ink.ts draws it with the same ballpoint as the signature.
 */

export type Line = {
  /** Left end of the number column, as a fraction of page width. */
  left: number;
  /** Right end, as a fraction of page width. */
  right: number;
  /** The ruled line the digits sit on, as a fraction of page height. */
  baseline: number;
  /** Digit height, as a fraction of page height. */
  height: number;
  /** Page width over page height, so a digit keeps its shape. */
  aspect: number;
};

export function writeDigits(digits: string, line: Line): Stroke[] {
  const groups = phoneGroups(digits.replace(/\D/g, ""));
  if (!groups.length) return [];

  // Lay out in model units first, then scale to fit the column.
  // The learned glyphs carry their lead-in strokes inside `w`, so neighbours
  // need more air than the ink box suggests or a 1 runs into the 3 before it.
  const gap = DIGIT_HEIGHT * 0.3;
  const groupGap = DIGIT_HEIGHT * 0.55;
  const placed: { x: number; strokes: [number, number][][] }[] = [];
  let x = 0;
  let n = 0;
  groups.forEach((g, gi) => {
    if (gi > 0) x += groupGap;
    for (const ch of g) {
      const variants = DIGITS[ch];
      if (!variants) continue;
      const glyph = variants[(n * 7 + ch.charCodeAt(0)) % variants.length];
      placed.push({ x, strokes: glyph.s });
      x += glyph.w + gap;
      n++;
    }
  });
  const totalUnits = Math.max(1, x - gap);

  // A digit's height in page-width units, then shrink if the number runs long.
  const want = line.height / DIGIT_HEIGHT; // page-height fraction per unit
  const unitW = want / line.aspect; // the same unit as a page-width fraction
  const room = line.right - line.left;
  const k = Math.min(1, room / (totalUnits * unitW));
  const sx = unitW * k;
  const sy = want * k;

  let t = 0;
  const out: Stroke[] = [];
  for (const p of placed) {
    for (const s of p.strokes) {
      out.push(
        s.map(([gx, gy], i) => {
          t += i === 0 ? 120 : 14;
          return {
            x: line.left + (p.x + gx) * sx,
            y: line.baseline + gy * sy,
            t,
            p: 0.62,
          };
        }),
      );
    }
  }
  return out;
}
