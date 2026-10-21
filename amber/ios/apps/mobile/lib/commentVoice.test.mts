/**
 * THE WAVEFORM ON A VOICE COMMENT.
 *
 * The recorder and the upload cannot be tested -- they need a microphone, a
 * bucket and a permission. What CAN be wrong without anybody noticing is the
 * arithmetic between them, and it is the part everybody sees:
 *
 *   THE FLAT LINE   expo-audio reports dB from about -160 to 0, and speech
 *                   lives between -40 and -5. Mapping the full range linearly
 *                   puts every syllable in the bottom quarter of the bar, so
 *                   every clip draws as a flat line with occasional spikes.
 *   THE WRONG SHAPE thinning a waveform by taking every Nth sample is picking
 *                   an arbitrary phase of it. A clip with a regular rhythm can
 *                   come back looking silent, purely by where the stride landed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelToPeak, thinPeaks } from './voicePeaks.ts';

test('THE FLAT LINE: speech uses most of the bar, not the bottom of it', () => {
  // Silence and near-silence are the floor.
  assert.equal(levelToPeak(-160), 0);
  assert.equal(levelToPeak(-45), 0);
  // Loud is the ceiling, and anything above it stays there rather than
  // overflowing into a bar taller than the row.
  assert.equal(levelToPeak(-5), 100);
  assert.equal(levelToPeak(0), 100);

  // THE POINT: ordinary speech has to land in the middle, visibly. A linear map
  // of -160..0 would put -25 dB at 84% of silence; here it is a real bar.
  const speaking = levelToPeak(-25);
  assert.ok(speaking > 35 && speaking < 65, `ordinary speech drew at ${speaking}%`);
  // ...and quieter speech is visibly different from louder speech, which is the
  // whole reason to draw a waveform rather than a rectangle.
  assert.ok(levelToPeak(-35) < levelToPeak(-25));
  assert.ok(levelToPeak(-25) < levelToPeak(-15));
});

test('a missing or nonsense level is silence, never NaN in a view', () => {
  for (const bad of [null, undefined, Number.NaN, 'loud' as unknown as number]) {
    assert.equal(levelToPeak(bad), 0, `${String(bad)} produced a bar`);
  }
});

test('THE WRONG SHAPE: thinning averages each bucket rather than sampling every Nth', () => {
  // A clip that alternates loud and quiet every sample. Taking every 2nd sample
  // returns ALL 100s or ALL 0s depending on phase -- a waveform that is either
  // clipped or silent, and wrong either way. Averaging returns the truth: 50.
  const alternating = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 100 : 0));
  const thinned = thinPeaks(alternating, 20);
  assert.equal(thinned.length, 20);
  assert.ok(
    thinned.every((n) => n === 50),
    `phase-dependent thinning produced ${thinned.slice(0, 5).join(',')}`,
  );
});

test('a short clip keeps every sample rather than being stretched', () => {
  assert.deepEqual(thinPeaks([10, 20, 30], 48), [10, 20, 30]);
});

test('the shape survives thinning: a clip that gets louder still gets louder', () => {
  const ramp = Array.from({ length: 480 }, (_, i) => Math.round((i / 479) * 100));
  const thinned = thinPeaks(ramp, 48);
  assert.equal(thinned.length, 48);
  assert.ok(thinned[0]! < 10, `the quiet start drew at ${thinned[0]}`);
  assert.ok(thinned.at(-1)! > 90, `the loud end drew at ${thinned.at(-1)}`);
  for (let i = 1; i < thinned.length; i += 1) {
    assert.ok(thinned[i]! >= thinned[i - 1]!, `the ramp went backwards at bar ${i}`);
  }
});

test('every bar is a number a view can draw, whatever came in', () => {
  const junk = [500, -20, Number.NaN, Infinity, 42];
  for (const n of thinPeaks(junk, 5)) {
    assert.ok(Number.isFinite(n) && n >= 0 && n <= 100, `a bar of ${n} would break the row`);
  }
  assert.deepEqual(thinPeaks([], 48), []);
  assert.deepEqual(thinPeaks(null as unknown as number[], 48), []);
});
