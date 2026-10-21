/**
 * DOES THE METER ACTUALLY GATE THE ROOM OUT? Run it and find out:
 *
 *   node --experimental-strip-types scripts/waveform-check.mts
 *
 * This exists because the noise floor was got wrong TWICE by reasoning about it
 * on paper. The first version mapped dB linearly and drew an air conditioner at
 * a third of full height. The second tracked the floor adaptively but gated its
 * own rise on being within 12dB of the floor's current value -- so a room
 * louder than the initial guess froze the tracker at that guess forever, which
 * is the one case it existed to handle.
 *
 * Both would have been caught in a second by simulating a constant tone and
 * looking at the number. So: constant tones at four room levels must come out
 * flat, synthetic speech over each of them must come out tall, and the gaps
 * between syllables must come out at zero while the syllables do not. That last
 * pair is "peaks and valleys" stated as an assertion.
 *
 * THIRD TIME. The report was "it works once in a while really well" -- two
 * voice notes back to back, one clean and one full of air conditioner. The
 * cause was the speech-headroom guard: `min(windowMin, refDb - 18)` pulls the
 * floor BELOW the measured room whenever the speaker is quiet, so how loudly
 * the last sentence was spoken decided whether the room got gated out. The
 * cases below now include that pairing explicitly -- SAME room, two speaking
 * volumes, both must be flat in the gaps -- plus a single dropout frame, which
 * a strict minimum lets decide the floor for three seconds.
 */
import { createMeter, meterSample } from '../lib/waveform.ts';

function run(label: string, levels: number[]) {
  const m = createMeter();
  const out: number[] = [];
  for (const db of levels) out.push(meterSample(m, db));
  const tail = out.slice(-40);
  const avg = tail.reduce((a, b) => a + b, 0) / tail.length;
  const max = Math.max(...tail);
  console.log(
    `${label.padEnd(34)} avg=${avg.toFixed(3)} max=${max.toFixed(3)}  floor=${(m.floorDb ?? 0).toFixed(1)} ref=${(m.refDb ?? 0).toFixed(1)}`,
  );
  return { avg, max };
}

const N = 400; // 8s at 20ms
const const_ = (db: number) => new Array(N).fill(db);
const jitter = (db: number, j = 2) =>
  new Array(N).fill(0).map(() => db + (Math.random() - 0.5) * j);

console.log('\n─── SILENCE / ROOM ONLY: every one of these must be ~0 ───');
const quiet = run('quiet room  -55', jitter(-55));
const ac    = run('AC hum      -42', jitter(-42));
const loudAc= run('LOUD AC     -35', jitter(-35));
const veryLoud = run('very loud room -28', jitter(-28));

console.log('\n─── SPEECH over that room: must be tall, with valleys ───');
// syllables: 120ms loud, 80ms back to room
function speech(room: number, peak: number) {
  const out: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const phase = i % 10;
    out.push(phase < 6 ? peak + (Math.random() - 0.5) * 6 : room + (Math.random() - 0.5) * 2);
  }
  return out;
}
const sp1 = run('speech -18 over AC -42', speech(-42, -18));
const sp2 = run('speech -18 over LOUD AC -35', speech(-35, -18));
const sp3 = run('quiet speech -28 over AC -42', speech(-42, -28));

console.log('\n─── THE REGRESSION: same room, two speaking volumes ───');
// The exact pairing that made it look random. Both must be flat in the gaps:
// the ONLY difference is how loudly the person spoke, which must not decide
// whether their air conditioner is on screen.
function gapsOf(levels: number[]) {
  const m = createMeter();
  const out = levels.map((db) => meterSample(m, db));
  const gaps: number[] = [];
  out.forEach((v, i) => {
    if (i > N / 2 && i % 10 >= 6) gaps.push(v);
  });
  const avg = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const max = Math.max(...gaps);
  return { avg, max };
}
const loudTalker = gapsOf(speech(-35, -14));
const quietTalker = gapsOf(speech(-35, -24));
console.log(`  loud talker  -14 over -35 AC: gap avg=${loudTalker.avg.toFixed(3)} max=${loudTalker.max.toFixed(3)}`);
console.log(`  quiet talker -24 over -35 AC: gap avg=${quietTalker.avg.toFixed(3)} max=${quietTalker.max.toFixed(3)}`);

console.log('\n─── ONE BAD FRAME must not open the gate for three seconds ───');
const dropout = (() => {
  const levels = jitter(-35);
  levels[120] = -70; // a single anomalous reading mid-recording
  const m = createMeter();
  const out = levels.map((db) => meterSample(m, db));
  const after = out.slice(125, 260);
  return { avg: after.reduce((a, b) => a + b, 0) / after.length, max: Math.max(...after) };
})();
console.log(`  after a -70 frame in a -35 room: avg=${dropout.avg.toFixed(3)} max=${dropout.max.toFixed(3)}`);

console.log('\n─── VALLEYS: gap bars vs peak bars in one utterance ───');
{
  const m = createMeter();
  const levels = speech(-35, -18);
  const out = levels.map((db) => meterSample(m, db));
  const peaks: number[] = [];
  const gaps: number[] = [];
  out.forEach((v, i) => ((i % 10) < 6 ? peaks : gaps).push(v));
  const mean = (a: number[]) => a.slice(-60).reduce((x, y) => x + y, 0) / Math.min(60, a.length);
  console.log(`  peak bars  avg=${mean(peaks).toFixed(3)}`);
  console.log(`  gap  bars  avg=${mean(gaps).toFixed(3)}`);
}

console.log('\n─── VERDICT ───');
const silentOk = [quiet, ac, loudAc, veryLoud].every((r) => r.avg < 0.02);
// 0.65, not 0.9: a quiet voice in a loud room SHOULD sit below full
// height. What must hold is that speech clears the room by a wide
// margin and the gaps inside it reach zero.
const speechOk = [sp1, sp2, sp3].every((r) => r.max > 0.65);
// THE ONE THAT MATTERS THIS TIME: both talkers, same room, gaps at zero.
const consistentOk = loudTalker.avg < 0.02 && quietTalker.avg < 0.02;
const dropoutOk = dropout.avg < 0.02;
console.log(`  silence flat:  ${silentOk ? 'PASS' : 'FAIL'}`);
console.log(`  speech tall:   ${speechOk ? 'PASS' : 'FAIL'}`);
console.log(`  loud AND quiet talkers both flat in the gaps: ${consistentOk ? 'PASS' : 'FAIL'}`);
console.log(`  one dropout frame does not open the gate:      ${dropoutOk ? 'PASS' : 'FAIL'}\n`);
if (!silentOk || !speechOk || !consistentOk || !dropoutOk) process.exitCode = 1;

// ── THE ROW MUST FILL ITS SLOT, NOT LEAVE WHITE SPACE ───────────────────────
//
// "When I record a voice note, it still is showing a bunch of white space in the
//  area where it's supposed to show the entire waveform UI."
//
// A hard-coded bar count is a fixed width: 18 bars at 2.5+3 is 99pt, so in a row
// 300pt wide the other 200pt is empty. barsForWidth is what turns a measured slot
// into a count that fills it, and these are its edges.
{
  const { barsForWidth } = await import('../lib/waveform.ts');
  const cases: [number, number, number][] = [
    // [width, barWidth, gap]
    [300, 2.5, 3],
    [99, 2.5, 3],
    [150, 2.5, 2.5],
    [52, 5, 6],
  ];
  let ok = true;
  for (const [w, bw, gap] of cases) {
    const n = barsForWidth(w, bw, gap);
    const drawn = n * bw + (n - 1) * gap;
    // It fills: the leftover must be smaller than one more bar would need.
    const leftover = w - drawn;
    if (!(leftover >= -0.001 && leftover < bw + gap)) {
      console.log(`FAIL  barsForWidth(${w},${bw},${gap}) = ${n} draws ${drawn} leaving ${leftover}`);
      ok = false;
    }
  }
  // An unmeasured slot draws nothing rather than one lonely bar.
  if (barsForWidth(0) !== 0) {
    console.log('FAIL  an unmeasured width should produce no bars');
    ok = false;
  }
  console.log(`  waveform fills its slot: ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exitCode = 1;
}
