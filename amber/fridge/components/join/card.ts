/**
 * What a pen stroke is, shared by the journal (Journal.tsx), the ink engine
 * (ink.ts), the typed number (pen-digits.ts) and the guestbook route, which
 * validates the same shape with zod.
 */

export type StrokePoint = { x: number; y: number; t: number; p: number };
/** One pen-down to pen-up, in page coordinates 0..1, t in ms from the first point. */
export type Stroke = StrokePoint[];
