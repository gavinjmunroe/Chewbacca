/**
 * The six dimensions of health, in the order the radar draws them.
 *
 * WHY THIS IS A .ts IN lib/ AND NOT A CONSTANT IN THE COMPONENT. Node's
 * type-stripping runs .ts directly but cannot load .tsx -- JSX is not stripped
 * -- so anything a test needs to import must not live in a component file. This
 * list is the single thing the mapping in lib/selfDimensions.ts has to agree
 * with, and a mapping nothing can test is exactly the mapping that plots every
 * score on the wrong spoke and looks completely fine doing it.
 *
 * THIS IS A DISPLAY ORDER, NOT THE ONTOLOGY'S ORDER. amber_id numbers them
 * spiritual, emotional, physical, intellectual, social, financial (dimension_id
 * 1..6); this is clockwise from the top of a hexagon, chosen for how it reads.
 * Never index one by the other -- match on the code. See dimensionsToRadar.
 *
 * The sixth entry said "Occupational" for a long time and amber_id has never had
 * such a dimension. Its src/lib/dimensions.js opens with "Never invent new
 * dimensions. Never rename. Never merge." Nothing had ever written a row against
 * occupational, so the spoke could only be empty, and the first real values
 * would have plotted financial evidence under it.
 */
export const RADAR_DIMENSIONS = [
  'Physical',
  'Emotional',
  'Intellectual',
  'Social',
  'Spiritual',
  'Financial',
] as const;

export type RadarDimension = (typeof RADAR_DIMENSIONS)[number];

export type DimensionCoverage = {
  code: string;
  label: string;
  /** 0..1, capped. 1 means Amber has a real read on this part of your life. */
  score: number;
  /** Uncapped evidence, so "just crossed" is tellable from "knows a lot". */
  evidence: number;
  facts: number;
  questions: number;
};

export type CoverageSummary = { known: number; some: number; empty: number; total: number };


/**
 * THE ONTOLOGY'S ORDER IS NOT THE RADAR'S ORDER, and this is the only place that
 * knows it.
 *
 * The server returns dimensions in id order -- spiritual, emotional, physical,
 * intellectual, social, financial. The radar draws them clockwise from the top
 * in a different order chosen for how it looks. Handing the server's array
 * straight to `values` would plot every score on the wrong spoke, and the result
 * would look entirely plausible: six numbers, six points, a shape. Nothing about
 * it would appear broken.
 *
 * Matched on the CODE, never on position. A dimension the server did not send is
 * zero rather than a hole, because the radar needs exactly six.
 */
export function dimensionsToRadar(rows: DimensionCoverage[] | null | undefined): number[] {
  const byCode = new Map(
    (rows ?? []).map((r) => [String(r.code || '').toLowerCase(), Number(r.score) || 0]),
  );
  return RADAR_DIMENSIONS.map((label) => {
    const v = byCode.get(label.toLowerCase());
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  });
}

/** Has Amber heard anything at all yet? Governs "building your read" vs a shape. */
export function hasAnyCoverage(rows: DimensionCoverage[] | null | undefined): boolean {
  return (rows ?? []).some((r) => (Number(r.score) || 0) > 0);
}

/**
 * The line under the radar. A count of dimensions, never an average.
 *
 * AN AVERAGE SAYS THE SAME THING ABOUT TWO OPPOSITE PEOPLE. Somebody Amber knows
 * deeply on two dimensions and not at all on four averages to the same number as
 * somebody it knows slightly across all six, and those want completely different
 * things said to them. "Across 4 of 6" is a fact; "63%" is a number that cannot
 * be wrong because it does not claim anything.
 */
export function coverageLine(summary: CoverageSummary | null | undefined): string {
  const s = summary ?? { known: 0, some: 0, empty: 6, total: 6 };
  if (s.known === 0 && s.some === 0) return 'Nothing learned yet';
  if (s.known === s.total) return `Known across all ${s.total}`;
  if (s.known === 0) return `Starting to learn ${s.some} of ${s.total}`;
  return `Known across ${s.known} of ${s.total}`;
}

/**
 * The prompt underneath, naming what Amber has not heard about.
 *
 * NAMES AT MOST TWO. A list of four things you have not talked about reads as a
 * scolding, and the point is to offer one easy next thing, not to audit
 * somebody's conversation. Empty dimensions are named ahead of thin ones because
 * a dimension with nothing in it is the cheapest one to improve.
 */
export function coverageNudge(rows: DimensionCoverage[] | null | undefined): string {
  const list = rows ?? [];
  if (list.length === 0) return '';
  const empty = list.filter((r) => (Number(r.score) || 0) <= 0).map((r) => r.label.toLowerCase());
  if (empty.length === 0) return 'Based on what you have shared with Amber.';
  if (empty.length === list.length) {
    return 'Tell Amber something about yourself and this starts to fill in.';
  }
  const named = empty.slice(0, 2).join(' or ');
  return `Nothing yet on ${named}.`;
}
