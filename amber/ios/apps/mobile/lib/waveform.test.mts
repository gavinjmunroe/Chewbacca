/**
 * DRAWING A RECORDING. scripts/waveform-check.mts already simulates the METER
 * (does the room get gated out, do syllables read as syllables). This is the
 * other half: the array math that turns a live recording into a stored clip and
 * a stored clip into however many bars fit on screen.
 *
 * The property that matters throughout is that a LOUD MOMENT SURVIVES. Both
 * resamplers take the peak of each bucket rather than the average, because
 * averaging a waveform turns speech into a smooth hedge -- and once that is
 * wrong, the recorded clip no longer matches the meter that drew it while the
 * person was talking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PEAKS, barsForWidth, downsamplePeaks, resamplePeaks, toStoredLevel } from './waveform.ts';

test('a short recording is left exactly as it is', () => {
  const levels = [0.1, 0.9, 0.3];
  assert.equal(downsamplePeaks(levels, 240), levels);
  assert.deepEqual(downsamplePeaks([], 240), []);
});

test('a long recording comes down to exactly the target length', () => {
  const levels = Array.from({ length: 5000 }, (_, i) => (i % 97) / 96);
  assert.equal(downsamplePeaks(levels).length, MAX_PEAKS);
  assert.equal(downsamplePeaks(levels, 40).length, 40);
  assert.equal(downsamplePeaks(levels, 1).length, 1);
});

test('THE LOUDEST MOMENT IS NEVER AVERAGED AWAY', () => {
  // One shout in four seconds of silence. Averaged it disappears; peaked it is
  // still the tallest bar in the clip, which is the whole reason a waveform is
  // worth drawing.
  const levels = new Array(4000).fill(0);
  levels[1999] = 1;
  const out = downsamplePeaks(levels, 240);
  assert.equal(Math.max(...out), 1, 'the peak was averaged out of existence');
  assert.equal(out.filter((v) => v === 1).length, 1, 'the peak was smeared across several bars');
});

test('downsampling covers the whole recording, with no sample skipped or double-counted', () => {
  // A bucket boundary that is off by one drops the first or last moment of a
  // clip -- audible as a waveform that starts flat while the audio does not.
  const n = 1000;
  const levels = Array.from({ length: n }, (_, i) => i / n);
  const out = downsamplePeaks(levels, 10);
  assert.equal(out.length, 10);
  assert.ok(out[0] > 0, 'the first bucket is empty, so the start of the clip was dropped');
  assert.equal(out.at(-1), levels.at(-1), 'the last sample was not included in the last bucket');
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(out[i] >= out[i - 1], 'a monotonically rising clip did not come out rising');
  }
});

test('resampling to the screen keeps the number of bars asked for', () => {
  const peaks = Array.from({ length: 240 }, (_, i) => (i % 10) / 9);
  for (const bars of [1, 7, 39, 240, 500]) {
    assert.equal(resamplePeaks(peaks, bars).length, bars, `bars=${bars}`);
  }
});

test('resampling a clip to its own length changes nothing, and returns a copy', () => {
  const peaks = [0.2, 0.4, 0.6];
  const out = resamplePeaks(peaks, 3);
  assert.deepEqual(out, peaks);
  assert.notEqual(out, peaks, 'the caller can mutate the result without corrupting the stored clip');
});

test('an empty clip draws flat bars rather than nothing', () => {
  // A note whose peaks failed to save still has a row to draw. Zero bars would
  // collapse the layout; zeroes keep the shape and say "no signal".
  assert.deepEqual(resamplePeaks([], 5), [0, 0, 0, 0, 0]);
  assert.deepEqual(resamplePeaks([], 0), []);
  assert.deepEqual(resamplePeaks([0.5], 0), []);
  assert.deepEqual(resamplePeaks([0.5], -3), []);
});

test('upsampling a short clip never invents a level louder than the clip has', () => {
  const peaks = [0.1, 0.5, 0.2];
  const out = resamplePeaks(peaks, 30);
  assert.equal(Math.max(...out), 0.5);
  assert.ok(out.every((v) => peaks.includes(v)), 'a value appeared that was not in the source');
});

test('stored levels are whole numbers from 0 to 100, clamped', () => {
  assert.equal(toStoredLevel(0), 0);
  assert.equal(toStoredLevel(1), 100);
  assert.equal(toStoredLevel(0.5), 50);
  assert.equal(toStoredLevel(0.005), 1);
  assert.equal(toStoredLevel(-3), 0, 'a negative level would draw a bar below the baseline');
  assert.equal(toStoredLevel(42), 100, 'an out-of-range level would draw off the top of the row');
  assert.equal(toStoredLevel(Number.NaN), 0);
  for (const v of [0, 0.13, 0.5, 0.99, 1]) {
    assert.ok(Number.isInteger(toStoredLevel(v)), `${v} stored as a fraction`);
  }
});

test('bar count fits the measured width and refuses to guess before layout', () => {
  // Zero width means the view has not been measured yet. Returning 1 there
  // draws a single bar for one frame on every recording.
  assert.equal(barsForWidth(0), 0);
  assert.equal(barsForWidth(-10), 0);
  assert.equal(barsForWidth(Number.NaN), 0);
  assert.equal(barsForWidth(5, 2.5, 2.5), 1);
  assert.equal(barsForWidth(100, 2.5, 2.5), 20);
  // Never negative, never fractional, at any width.
  for (const w of [1, 3.7, 50, 393, 1024]) {
    const n = barsForWidth(w);
    assert.ok(Number.isInteger(n) && n >= 1, `width ${w} -> ${n}`);
  }
});

test('a recording round-trips from live meter to stored clip to screen', () => {
  // The end-to-end path, as one property: whatever is drawn is bounded by what
  // was recorded, and the loudest moment is still the loudest.
  const live = Array.from({ length: 3000 }, (_, i) => (i === 1500 ? 1 : Math.abs(Math.sin(i / 40)) * 0.4));
  const stored = downsamplePeaks(live).map((v) => toStoredLevel(v) / 100);
  const drawn = resamplePeaks(stored, barsForWidth(320));
  assert.ok(drawn.length > 0);
  assert.ok(Math.max(...drawn) >= 0.99, 'the loudest moment did not survive to the screen');
  assert.ok(Math.max(...drawn) <= 1 && Math.min(...drawn) >= 0);
});
