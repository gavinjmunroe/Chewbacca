/**
 * THE WAVEFORM ON A VOICE CLIP, AS ARITHMETIC.
 *
 * Split out of lib/commentVoice.ts for one reason: that file imports expo-audio
 * to hold a microphone, and a test cannot load expo-audio. The recorder and the
 * upload genuinely cannot be tested -- they need a mic, a bucket and a
 * permission. The two functions here are the part between them that everybody
 * SEES, and they are the part that can be quietly wrong.
 *
 * See lib/commentVoice.test.mts.
 */

/**
 * THE WAVEFORM IS SAMPLED WHILE RECORDING, not derived afterwards.
 *
 * The peaks are what every listener sees, so they have to be the SPEAKER's
 * waveform rather than a decorative one drawn per device. expo-audio reports a
 * metering level in dB (roughly -160 silent, 0 loudest); this maps it onto the
 * 0-100 the server stores.
 *
 * A LOG SCALE COMPRESSED TO A USEFUL RANGE. Speech lives between about -40 and
 * -5 dB, so mapping the full -160..0 linearly puts every syllable in the bottom
 * quarter of the bar and draws a flat line with occasional spikes.
 */
export function levelToPeak(db: number | null | undefined): number {
  if (typeof db !== 'number' || Number.isNaN(db)) return 0;
  const FLOOR = -45;
  const CEIL = -5;
  const clamped = Math.max(FLOOR, Math.min(CEIL, db));
  return Math.round(((clamped - FLOOR) / (CEIL - FLOOR)) * 100);
}

/**
 * Thin a sampled waveform down to the number of bars a card can draw.
 *
 * AVERAGED PER BUCKET rather than sampled every Nth, because taking every Nth
 * value of a waveform is picking an arbitrary phase of it: a clip with a
 * regular rhythm can come back looking silent or looking clipped, entirely by
 * where the stride happened to land.
 */
export function thinPeaks(peaks: number[], bars = 48): number[] {
  const src = (peaks ?? []).filter((n) => Number.isFinite(n));
  if (src.length === 0) return [];
  if (src.length <= bars) return src.map((n) => Math.max(0, Math.min(100, Math.round(n))));
  const out: number[] = [];
  const size = src.length / bars;
  for (let i = 0; i < bars; i += 1) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += src[j]!;
    out.push(Math.max(0, Math.min(100, Math.round(sum / (end - start)))));
  }
  return out;
}
