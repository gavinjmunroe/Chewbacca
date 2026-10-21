import { useEffect, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LIGHT } from '../lib/theme';
import { barsForWidth, createMeter, meterSample } from '../lib/waveform';

// A LIVE recording waveform, Apple Voice Memos style: a row of thin vertical
// bars whose heights track the real microphone loudness at each instant. New
// samples push in on the right and the row scrolls left, so the shape reads as
// a "mountain" of what was just said. Unlike the decorative `Waveform`, this is
// driven by real `expo-audio` metering (a dB value) supplied via `getMetering`.
//
// Performance: metering is polled on a single JS interval, and the rolling
// buffer is written to ONE Reanimated shared value per tick. Each bar reads its
// slot off that shared value on the UI thread (with a short `withTiming` for
// smoothing) — so nothing here triggers a React re-render while recording.

// THE dB -> HEIGHT MAP LIVES IN lib/waveform NOW, and that is the fix.
//
// This file had its own: floor at -55, gate at a tenth of the range, re-expand
// what survives. Three problems. The thresholds were FIXED, so an air
// conditioner at -40dB sat a quarter of the way up the meter and every bar
// stood a quarter tall before anyone spoke. The map was linear in dB, which is
// not a picture of loudness. And it was a SECOND map -- the stored clip used a
// different one in lib/waveform and the playback bars a third gamma on top of
// that, so the waveform you watched while recording, the waveform saved with
// the clip, and the waveform someone else played back were three different
// shapes of the same sound.
//
// One adaptive meter, one gamma, three call sites. See lib/waveform.ts.

// A FLAT LINE AT REST, NOT A HEDGE.
//
// This was 0.12 -- at silence every bar stood 12% tall, so the recorder always
// showed a shallow row of stubs and speech only made an already-busy shape
// busier. Now it is just enough to leave a hairline of dots across the middle,
// the way Voice Memos and a heart-rate monitor sit flat until something happens.
// Not zero: bars scaled to nothing disappear, and a waveform that vanishes
// between words looks broken rather than quiet.
const MIN_FRACTION = 0.05;

// How often the microphone is actually read, versus how often a bar is drawn.
// Reading is cheap (a property off the recorder); drawing is what costs, so the
// two are decoupled and every drawn bar is the peak of four readings.
const SAMPLE_MS = 20;

// Most a slice may fall below the one before it. Scaled down with the slice
// length: at 80ms 0.28 decayed over about four bars, and keeping 0.28 at 55ms
// would decay in the same four bars but a third of the time, clipping the tail
// off every word. 0.2 holds the same ~250ms decay.
const RELEASE_PER_TICK = 0.2;

// barsForWidth MOVED TO lib/waveform. It is geometry, not a component, and
// living in a .tsx file made it untestable: node can strip types from .ts but
// not JSX, so the one function whose arithmetic decides whether the row fills
// its slot could not be checked. Re-exported here because callers import it
// from this module.
export { barsForWidth } from '../lib/waveform';

function Bar({
  index,
  levels,
  barWidth,
  height,
  color,
}: {
  index: number;
  levels: SharedValue<number[]>;
  barWidth: number;
  height: number;
  color: string;
}) {
  // scaleY, NOT height. `height` is a LAYOUT property: animating it runs Yoga over
  // this bar's subtree every frame, and there are 3-40 of these bars animating at
  // once -- one instance lives inside the People header, which was rewritten
  // specifically to do no layout work during a transition, so a per-frame Yoga pass in
  // there defeats the point. A transform is handled by the compositor and touches no
  // layout at all. The bar's box is a fixed `height` and the scale is applied about its
  // center (Reanimated's default origin), which reproduces the symmetrical
  // grow-from-the-middle shape the height version had.
  // NOTHING IS WRITTEN FROM IN HERE.
  //
  // This used to keep a `previous` shared value and assign to it inside the
  // worklet, to tell a rising sample from a falling one. Writing a shared value
  // from inside useAnimatedStyle is not allowed -- the write marks the mapper
  // dirty, so it re-runs, so it writes again, and on Reanimated 4 the style
  // simply stops settling. The bars sat where they were. Every "the waveform
  // still does not react to my voice" report after that change was this line.
  //
  // Attack and release belong to the SIGNAL, not to the bar, and that is where
  // they live now (see the sampler below). A scrolling waveform's bar does not
  // track one sound over time anyway -- each tick it shows a different, older
  // sample -- so per-bar release smoothing was smearing the envelope sideways.
  // What is left here is one short uniform ease so the scroll does not step.
  const animatedStyle = useAnimatedStyle(() => {
    // NO SHAPING HERE. This applied Math.pow(raw, 1.35) while the playback bars
    // applied Math.pow(level, 0.7) to the same recording -- one pushing the
    // quiet end down, the other pulling it up, so a clip never looked like the
    // meter that recorded it. Shaping happens once, in lib/waveform, where the
    // gate and the loudness reference that give it meaning also live.
    const target = MIN_FRACTION + (1 - MIN_FRACTION) * (levels.value[index] ?? 0);
    return {
      transform: [{ scaleY: withTiming(target, { duration: 90 }) }],
    };
  });

  return (
    <Animated.View
      style={[
        {
          width: barWidth,
          // The full-height box. Scale shrinks it; it never grows past this.
          height,
          borderRadius: barWidth / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

export function RecordingWaveform({
  getMetering,
  active = true,
  // NO COUNT MEANS "FILL THE SPACE", and that default is the fix for a bug that
  // has been reported twice.
  //
  // "When I record a voice note, it still is showing a bunch of white space in
  //  the area where it's supposed to show the entire waveform UI."
  //
  // A hard-coded count is a FIXED WIDTH: `bars={18}` at 2.5+3 is 99pt of
  // waveform, so in a row 300pt wide the other 200pt is empty. Two callers were
  // already measuring their slot and deriving the count (see barsForWidth), and
  // the ones that were not are exactly the ones with the gap. Measuring belongs
  // in here, where it cannot be forgotten: pass a count only for a deliberately
  // small indicator (a chip's three bars), and otherwise let it fill.
  bars,
  // Thinner and tighter, and a shorter slice: Voice Memos draws a dense row of
  // hairlines, and at an 80ms slice a syllable is one bar, which is why speech
  // came out as a plateau. 55ms puts three or four bars inside a syllable, which
  // is where peaks and valleys actually come from -- not from amplitude range
  // but from time resolution.
  barWidth = 2.5,
  gap = 2.5,
  height = 44,
  color = LIGHT.accent,
  intervalMs = 55,
  style,
}: {
  /** Returns the recorder's current metering value in dB, or undefined. */
  getMetering: () => number | undefined | null;
  active?: boolean;
  /** Omit to fill the measured width. Pass a number only for a fixed-size indicator. */
  bars?: number;
  barWidth?: number;
  gap?: number;
  height?: number;
  color?: string;
  intervalMs?: number;
  style?: ViewStyle;
}) {
  // MEASURED, when no count was given. Zero until the first layout pass, which
  // is why the row renders nothing rather than one lonely bar until then.
  const [measured, setMeasured] = useState(0);
  const autoBars = barsForWidth(measured, barWidth, gap);
  const barCount = bars ?? autoBars;

  // The rolling buffer of normalized levels (0..1), index 0 = oldest (left),
  // last = newest (right). Mutated on a plain ref, snapshotted into the shared
  // value each tick so the UI thread can read every bar's height cheaply.
  const buffer = useRef<number[]>(new Array(Math.max(1, barCount)).fill(0));
  const levels = useSharedValue<number[]>(new Array(Math.max(1, barCount)).fill(0));

  // `bars` is now DERIVED FROM MEASURED WIDTH by some callers, so it changes after
  // the first layout pass. The buffer was sized once at mount and never resized,
  // which left every bar past the original count reading `undefined` (drawn as
  // silence) forever — a waveform that was permanently flat on its right-hand
  // side. Resize in place, keeping the most recent samples so a live recording
  // does not blink.
  useEffect(() => {
    const buf = buffer.current;
    if (barCount < 1 || buf.length === barCount) return;
    buffer.current =
      buf.length > barCount
        ? buf.slice(buf.length - barCount)
        : new Array(barCount - buf.length).fill(0).concat(buf);
    levels.value = buffer.current.slice();
  }, [barCount, levels]);

  // PEAK-HOLD, NOT A SNAPSHOT.
  //
  // One instantaneous reading every 80ms is a sample of a waveform that swings
  // through zero hundreds of times in that window, and it lands in the gap
  // between two syllables often enough that speech drew as a broken, twitchy row
  // -- which reads as "it isn't responding to my voice" even though it is.
  //
  // A real level meter watches continuously and draws the LOUDEST thing that
  // happened in each slice. So: sample at SAMPLE_MS, hold the peak, and every
  // intervalMs push that peak into the row and start a new slice. Same one
  // shared-value write per displayed bar; the extra work is a number comparison.
  //
  // The release is here too, on the signal: a slice may not fall more than
  // RELEASE_PER_TICK below the last one, so a word decays over a few bars
  // instead of dropping off a cliff, while an onset is free to jump the whole
  // way in a single bar. Fast attack, eased release -- the asymmetry that makes
  // a meter look alive, applied to the thing that is actually moving.
  useEffect(() => {
    if (!active) return undefined;
    let peak = 0;
    let last = 0;
    // One meter for this recording, created when it starts. It holds the running
    // noise-floor and loudness estimates, so it cannot be per-sample (there
    // would be nothing to adapt) and must not be per-mount-of-the-component
    // (a second recording would inherit the first room's floor).
    const meter = createMeter();
    const sampler = setInterval(() => {
      const n = meterSample(meter, getMetering());
      if (n > peak) peak = n;
    }, SAMPLE_MS);
    const id = setInterval(() => {
      const next = peak >= last ? peak : Math.max(peak, last - RELEASE_PER_TICK);
      last = next;
      peak = 0;
      const buf = buffer.current;
      buf.shift(); // drop the oldest (falls off the left)
      buf.push(next); // newest enters on the right -> scrolls left
      levels.value = buf.slice(); // one shared-value write; drives all bars
    }, intervalMs);
    return () => {
      clearInterval(sampler);
      clearInterval(id);
    };
  }, [active, intervalMs, getMetering, levels]);

  return (
    <View
      onLayout={
        bars == null
          ? (e) => {
              const w = Math.floor(e.nativeEvent.layout.width);
              setMeasured((prev) => (Math.abs(prev - w) > 1 ? w : prev));
            }
          : undefined
      }
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          height,
          gap,
          // Filling mode takes the width it is given. `minWidth: 0` so it can
          // also SHRINK: a flex child defaults to its content's intrinsic width
          // as its minimum, which is what let a fixed-count row push its parent
          // wider than the screen and draw over the button beside it.
          ...(bars == null ? { flex: 1, minWidth: 0 } : null),
          // A HARD GUARD, not decoration. `bars * (barWidth + gap)` is an intrinsic
          // width: pass more bars than the space allows and the row silently
          // overflows its parent and draws on top of whatever is beside it — which
          // is exactly how the recorder's waveform ended up covering its own X
          // button. Callers should size bars from measured width (barsForWidth
          // below); this makes the failure mode "clipped" rather than "on top of
          // the cancel button".
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {Array.from({ length: Math.max(0, barCount) }).map((_, i) => (
        <Bar key={i} index={i} levels={levels} barWidth={barWidth} height={height} color={color} />
      ))}
    </View>
  );
}
