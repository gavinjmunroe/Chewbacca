/**
 * THE SELF SCORE, CLIENT SIDE.
 *
 * One bug here is invisible and total: the server returns dimensions in the
 * ontology's id order and the radar draws them in a display order, and those two
 * orders are NOT the same. Hand the array straight over and every score plots on
 * the wrong spoke -- six numbers, six points, a plausible shape, nothing that
 * looks broken to anyone. The first test is that one.
 *
 * The rest is wording, which matters more than usual here because the card is
 * about the person reading it. Every string has to say what Amber KNOWS and
 * never what the person IS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coverageLine,
  coverageNudge,
  dimensionsToRadar,
  hasAnyCoverage,
  type DimensionCoverage,
  RADAR_DIMENSIONS,
} from './healthDimensions.ts';

const row = (code: string, score: number): DimensionCoverage => ({
  code,
  label: code.charAt(0).toUpperCase() + code.slice(1),
  score,
  evidence: score * 2,
  facts: score > 0 ? 1 : 0,
  questions: 0,
});

/** The server's order: dimension_id 1..6. */
const SERVER_ORDER = ['spiritual', 'emotional', 'physical', 'intellectual', 'social', 'financial'];

test('THE SERVER ORDER IS NOT THE RADAR ORDER, and scores land on the right spokes', () => {
  // A distinct score per dimension, so a mis-mapping cannot coincidentally pass.
  const rows = SERVER_ORDER.map((code, i) => row(code, (i + 1) / 10));
  const values = dimensionsToRadar(rows);

  assert.equal(values.length, 6);
  for (let i = 0; i < RADAR_DIMENSIONS.length; i += 1) {
    const label = RADAR_DIMENSIONS[i]!.toLowerCase();
    const expected = rows.find((r) => r.code === label)!.score;
    assert.equal(values[i], expected, `${RADAR_DIMENSIONS[i]} got the wrong dimension's score`);
  }

  // And prove the naive version really would have been wrong, so this test is
  // guarding something rather than restating the implementation.
  const naive = rows.map((r) => r.score);
  assert.notDeepEqual(values, naive, 'the two orders coincide; this test proves nothing');
});

test('the radar has a spoke for every dimension the ontology has', () => {
  const labels = RADAR_DIMENSIONS.map((l) => l.toLowerCase()).sort();
  assert.deepEqual(labels, [...SERVER_ORDER].sort(), 'the radar and the ontology disagree about the six');
  // The specific drift this caught: a spoke labeled for a dimension no row can
  // ever be written against.
  assert.ok(!labels.includes('occupational'));
  assert.ok(labels.includes('financial'));
});

test('a missing or malformed dimension is zero, never a hole in the shape', () => {
  assert.deepEqual(dimensionsToRadar([]), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(dimensionsToRadar(null), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(dimensionsToRadar(undefined), [0, 0, 0, 0, 0, 0]);
  // Only two of six came back.
  const partial = dimensionsToRadar([row('social', 0.5), row('physical', 1)]);
  assert.equal(partial.length, 6);
  assert.equal(partial.filter((v) => v > 0).length, 2);
  // Garbage values are clamped rather than plotted off the chart.
  const junk = dimensionsToRadar([
    { ...row('social', 0), score: Number.NaN },
    { ...row('physical', 0), score: 40 },
    { ...row('emotional', 0), score: -3 },
  ] as DimensionCoverage[]);
  assert.ok(junk.every((v) => v >= 0 && v <= 1), `clamping failed: ${junk}`);
});

test('case and stray whitespace in a code do not lose a dimension', () => {
  const values = dimensionsToRadar([{ ...row('social', 0.9), code: 'SOCIAL' }]);
  const i = RADAR_DIMENSIONS.indexOf('Social');
  assert.equal(values[i], 0.9);
});

test('hasAnyCoverage tells a brand-new user from one Amber has started to read', () => {
  assert.equal(hasAnyCoverage([]), false);
  assert.equal(hasAnyCoverage(SERVER_ORDER.map((c) => row(c, 0))), false);
  assert.equal(hasAnyCoverage([row('social', 0.01)]), true);
});

// ── the words, which are the point of the card ──────────────────────────────

test('THE CARD SAYS WHAT AMBER KNOWS, NEVER WHAT THE PERSON IS', () => {
  /**
   * The line under a radar built from note-taking must not read as an assessment
   * of somebody's life. Someone who never mentions faith would otherwise be
   * shown a judgment made entirely of silence.
   */
  const strings = [
    coverageLine({ known: 0, some: 0, empty: 6, total: 6 }),
    coverageLine({ known: 2, some: 1, empty: 3, total: 6 }),
    coverageLine({ known: 6, some: 0, empty: 0, total: 6 }),
    coverageLine({ known: 0, some: 3, empty: 3, total: 6 }),
    coverageNudge(SERVER_ORDER.map((c) => row(c, 0))),
    coverageNudge([row('social', 1), ...SERVER_ORDER.slice(1).map((c) => row(c, 0))]),
    coverageNudge(SERVER_ORDER.map((c) => row(c, 1))),
  ];
  for (const s of strings) {
    assert.doesNotMatch(
      s,
      /\b(?:balance|balanced|healthy|unhealthy|score|poor|weak|low|neglect|lacking|deficient|improve your)\b/i,
      `"${s}" reads as a verdict on the person rather than a statement about what Amber knows`,
    );
  }
});

test('the line counts dimensions and never averages them', () => {
  assert.equal(coverageLine({ known: 0, some: 0, empty: 6, total: 6 }), 'Nothing learned yet');
  assert.equal(coverageLine({ known: 4, some: 1, empty: 1, total: 6 }), 'Known across 4 of 6');
  assert.equal(coverageLine({ known: 6, some: 0, empty: 0, total: 6 }), 'Known across all 6');
  assert.equal(coverageLine({ known: 0, some: 3, empty: 3, total: 6 }), 'Starting to learn 3 of 6');
  // Missing summary is the first-run state, not a crash.
  assert.equal(coverageLine(null), 'Nothing learned yet');
  assert.equal(coverageLine(undefined), 'Nothing learned yet');
});

test('THE NUDGE NAMES AT MOST TWO THINGS, so it reads as an offer and not an audit', () => {
  const fourEmpty = [
    row('social', 1),
    row('emotional', 1),
    row('spiritual', 0),
    row('financial', 0),
    row('physical', 0),
    row('intellectual', 0),
  ];
  const nudge = coverageNudge(fourEmpty);
  assert.match(nudge, /^Nothing yet on /);
  // Two named, not four.
  assert.equal(nudge.split(' or ').length, 2, `named too many: "${nudge}"`);
});

test('the nudge handles both ends: nothing known, and everything known', () => {
  assert.match(
    coverageNudge(SERVER_ORDER.map((c) => row(c, 0))),
    /Tell Amber something about yourself/,
  );
  assert.match(coverageNudge(SERVER_ORDER.map((c) => row(c, 1))), /what you have shared/);
  assert.equal(coverageNudge([]), '');
  assert.equal(coverageNudge(null), '');
});
