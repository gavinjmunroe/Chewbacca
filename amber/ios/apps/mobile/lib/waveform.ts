// THE WAVEFORM, in one place.
//
// A recording carries the RECORDER'S OWN waveform to everyone who plays it back
// later: without that, each listener would have to invent a shape and two
// people looking at the same clip would see different pictures. So the same
// signal chain has to serve the live meter you watch while recording and the
// static bars stored with the clip, or the thing you saw while speaking is not
// the thing that gets saved.
//
// WHY THIS IS STATEFUL NOW, and it is the whole point of the rewrite.
//
// It used to be one pure function: clamp the metering dB to -60..0 and map it
// linearly onto 0..100. Two things are wrong with that, and both of them were
// visible in the app.
//
// The first is that a FIXED floor cannot work. The same sentence spoken in a
// quiet bedroom and spoken next to a running air conditioner is the same
// speech; only the room changed. A fixed -60 floor put that air conditioner --
// call it -40dB of broadband hum -- a third of the way up the meter, so every
// bar stood a third tall before anyone said anything. Room tone is not signal,
// and the only way to know where the room ends is to watch it and find out.
// This tracks the noise floor: fast down, slow up, and only rising while things
// are quiet enough that the rise could plausibly be the room rather than a
// word.
//
// The second is that dB is LOGARITHMIC and a linear map of it is not a picture
// of loudness. Ordinary speech occupies maybe -30 to -14dB, which on a -60..0
// linear map is 50 to 77 -- a 27-point band riding on a 50-point pedestal. That
// is a solid block with a slightly bumpy top, which is exactly what the voice
// bio looked like: "all just one blob, not actually peaks and valleys." Gating
// at the measured floor and then normalizing what survives against a running
// loudness reference is what turns that band back into peaks and valleys: the
// gaps between words reach zero, and the loud syllables reach the top.
//
// None of this is noise SUPPRESSION -- the audio is untouched, and the clip
// still contains whatever the room contained. It is the meter telling the truth
// about which parts of it are you.

/** How many samples a stored waveform is squeezed down to. */
export const MAX_PEAKS = 240;

// Below this there is nothing to measure: iOS reports around -160 for "no
// reading yet" as well as for true silence, and letting that value into the
// floor tracker would drag the floor to the bottom and undo the adaptation on
// the first frame of every recording. Treated as silence, and ignored.
const NO_SIGNAL_DB = -80;

// How far above the measured floor a sample has to be before it counts as
// signal at all. Broadband room tone wanders by a few dB; 8 clears that without
// swallowing a quiet word.
const GATE_MARGIN_DB = 8;

// The floor may not settle outside this. The low end stops a genuinely silent
// room from pushing the gate so low that the tracker takes seconds to recover;
// THE FIRST VERSION OF THIS FROZE, and the symptom was the exact thing it was
// written to fix: an air conditioner drawing 60%-tall bars while nobody spoke.
//
// It moved the floor with two rules -- fall fast toward anything quieter, rise
// slowly while the sample was "close" to the floor:
//
//     if (level < floorDb)           floorDb += (level - floorDb) * 0.25;
//     else if (level < floorDb + 12) floorDb += 0.02;
//
// The second condition was meant to stop a long sentence dragging the floor up
// under itself. What it actually did was let the INITIAL GUESS decide whether
// the floor could ever move at all. The guess was -50. A room quieter than -38
// converges. A room LOUDER than -38 satisfies neither branch -- not below the
// floor, not within 12dB of it -- so the floor sat at -50 forever and the gate
// at -42 while the room hummed at -35. Every bar then reads about 60% of full
// height with a little variation on top, which is a waveform of the air
// conditioning. An iPhone mic in a room with an AC running is comfortably
// louder than -38, so the one case this had to handle was the one it locked up
// on.
//
// WHAT REPLACES IT: the quietest thing heard in the last three seconds. Speech
// has gaps -- between words, between syllables, between sentences -- so the
// minimum over a few seconds IS the room, and it cannot freeze, because nothing
// about whether it moves depends on the floor's own current value.
//
// Two guards keep it honest:
//
//   * THE FIRST SAMPLE SETS THE FLOOR OUTRIGHT. Converging from a guess costs
//     seconds of wrong bars at the start of every recording, and the start of a
//     recording is nearly always silence -- the best possible moment to measure
//     a room.
//
//   * THE FLOOR MAY NEVER RISE WITHIN FLOOR_SPEECH_HEADROOM_DB OF THE LOUDNESS
//     REFERENCE. Someone talking continuously for longer than the window with
//     no gap at all would otherwise walk the floor up into their own voice and
//     fade themselves out mid-sentence. This is what the old `+ 12` window was
//     reaching for, expressed against the SPEAKER rather than against the
//     floor's own last value -- so it constrains the failure case without being
//     able to cause one.
//   * AND THE HEADROOM GUARD MAY ONLY LOWER THE FLOOR TO THE ROOM, NEVER
//     BELOW IT. This is the regression that brought the air conditioner back,
//     and it is worth the arithmetic because "it works sometimes" was the
//     report:
//
//         target = min(windowMin, refDb - 18)
//
//     Speak loudly -- ref -14 -- and the guard sits at -32, above a -35 room,
//     so the min() picks the room and the meter is flat in the gaps. Speak
//     quietly, or hold the phone further away -- ref -28 -- and the guard sits
//     at -46, THIRTEEN DECIBELS BELOW the same room, so the min() picks the
//     guard, the floor falls to -46, the gate lands at -38, and a -35dB air
//     conditioner clears it by 3dB and draws at half height. Same room, same
//     code, opposite result depending on how loudly the last sentence was
//     spoken -- which is exactly the inconsistency described.
//
//     The guard exists to stop the floor RISING into a voice. Letting it push
//     the floor DOWN was never its job: the room is a measurement and the guard
//     is only a limit on it. So it is clamped to the room, with two decibels of
//     slack for a quiet talker.
const FLOOR_WINDOW = 150; // samples; ~3s at the 20ms sampling interval
const FLOOR_FALL = 0.3; // a room that goes quiet has genuinely changed
const FLOOR_RISE = 0.06; // ~3dB/s: fast enough to follow a fan switching on
const FLOOR_MIN_DB = -62;
/** How far below the measured room the speech guard may ever pull the floor. */
const FLOOR_CAP_SLACK_DB = 2;
/**
 * WHICH "QUIETEST" — and it is a percentile, not the minimum.
 *
 * The strict minimum over three seconds is one sample, so ONE anomalous frame
 * decides the room for the next three seconds. iOS metering does produce them
 * (a buffer boundary, a moment of AGC), and a single -70 reading in a -35 room
 * drops the floor 35dB, opens the gate, and draws the air conditioner at full
 * height until it ages out of the ring. The 10th percentile of 150 readings is
 * the same measurement -- speech has gaps and the gaps are the room -- without
 * being hostage to the worst single frame in it.
 */
const FLOOR_PERCENTILE = 0.1;
/**
 * Once a bar is up, it stays up until the level drops this far BELOW the gate.
 *
 * Speech crosses its own gate constantly -- the dip between two syllables is
 * several dB -- and a single threshold turns that into a comb of full-height
 * bars and zeros. A little hysteresis is what makes a word read as a word.
 */
const GATE_RELEASE_DB = 3;
// -20, not -30. A genuinely loud room is still a room, and clamping the floor
// below it puts us straight back to gating against a level the room exceeds.
const FLOOR_MAX_DB = -20;
const FLOOR_SPEECH_HEADROOM_DB = 18;

// The loudness reference the gated signal is normalized against: a peak
// follower with a fast attack and a slow release, so the tall bars are tall
// however loudly this particular person happens to talk or however far away
// they hold the phone.
const REF_ATTACK = 0.4;
// 0.02 -> 0.04 dB per sample (~2dB/s). The reference is SEEDED from the first
// reading plus REF_MIN_SPAN_DB, and when a recording opens mid-word that seed
// is about 12dB above the speaker -- so with a 1dB/s release it took ten
// seconds of talking to come down to them, and every bar was short for the
// first half of the clip. Twice as fast still cannot chase a syllable (the
// attack is 0.4 for that); it only stops a bad start from lasting.
const REF_RELEASE_DB = 0.04;
const REF_CEIL_DB = -3;
const REF_MIN_SPAN_DB = 12;

// Slightly below 1, so ordinary speech uses most of the height without the
// quiet end being lifted so far that it rejoins the loud end. The old value
// lived in two places (0.7 on playback, 1.35 on the live bars) and they
// disagreed, which is why a clip did not look like the meter that recorded it.
const SHAPE_GAMMA = 0.75;

export type Meter = {
  /**
   * Current estimate of where the room's own noise sits, in dBFS. Null until
   * the first reading, which sets it outright rather than converging toward it.
   */
  floorDb: number | null;
  /** Current estimate of how loud this speaker's loud moments are, in dBFS. */
  refDb: number | null;
  /** The last FLOOR_WINDOW readings, as a ring. Its 10th percentile is the room. */
  ring: number[];
  ringAt: number;
  ringFull: boolean;
  /** Scratch for the percentile, so a sample per 20ms allocates nothing. */
  scratch: number[];
  /** True while a bar is being drawn — see GATE_RELEASE_DB. */
  open: boolean;
};

/**
 * One meter per recording. Its state is the room and the speaker, so it must
 * not be shared between two clips and must not be recreated per sample.
 *
 * Nothing is guessed. floorDb and refDb are null until the first reading
 * arrives and sets them from what is actually there — a guess is what the
 * previous version's freeze was built on.
 */
export function createMeter(): Meter {
  return {
    floorDb: null,
    refDb: null,
    ring: new Array(FLOOR_WINDOW).fill(0),
    ringAt: 0,
    ringFull: false,
    scratch: new Array(FLOOR_WINDOW).fill(0),
    open: false,
  };
}

/**
 * Feed one metering reading in, get one bar height out, 0..1.
 *
 * MUTATES the meter, deliberately: the adaptation IS the return value's
 * meaning, and threading it through a return would let a caller drop it and
 * silently fall back to fixed thresholds.
 */
export function meterSample(meter: Meter, db: number | undefined | null): number {
  if (db == null || !Number.isFinite(db) || db <= NO_SIGNAL_DB) return 0;
  const level = Math.min(0, db);

  // ── the last few seconds, and the quietest thing in them ──────────────────
  meter.ring[meter.ringAt] = level;
  meter.ringAt = (meter.ringAt + 1) % meter.ring.length;
  if (meter.ringAt === 0) meter.ringFull = true;
  const filled = meter.ringFull ? meter.ring.length : meter.ringAt;
  // The 10th percentile of what has been heard, which is the room. Sorted into
  // the meter's own scratch array: 150 numbers every 20ms is nothing, and it
  // costs no allocation.
  for (let i = 0; i < filled; i += 1) meter.scratch[i] = meter.ring[i]!;
  const win = meter.scratch.slice(0, filled).sort((a, b) => a - b);
  const roomDb =
    win.length > 0 ? win[Math.min(win.length - 1, Math.floor((win.length - 1) * FLOOR_PERCENTILE))]! : level;

  // ── the speaker ───────────────────────────────────────────────────────────
  // Before the floor, because the floor's headroom guard is expressed against
  // it. Uses the PREVIOUS reference for that guard, which is what breaks the
  // circularity between the two estimates.
  if (meter.refDb === null) {
    meter.refDb = level + REF_MIN_SPAN_DB;
  } else if (level > meter.refDb) {
    meter.refDb += (level - meter.refDb) * REF_ATTACK;
  } else {
    meter.refDb -= REF_RELEASE_DB;
  }

  // ── the room ──────────────────────────────────────────────────────────────
  //
  // The guard may pull the floor down TO the room and no further. See
  // FLOOR_CAP_SLACK_DB: letting it go below is what put the air conditioner
  // back on screen for a quiet talker.
  const guard = meter.refDb - FLOOR_SPEECH_HEADROOM_DB;
  const target = Math.max(roomDb - FLOOR_CAP_SLACK_DB, Math.min(roomDb, guard));
  if (meter.floorDb === null) {
    meter.floorDb = target;
  } else {
    meter.floorDb +=
      (target - meter.floorDb) * (target < meter.floorDb ? FLOOR_FALL : FLOOR_RISE);
  }
  meter.floorDb = Math.max(FLOOR_MIN_DB, Math.min(FLOOR_MAX_DB, meter.floorDb));

  const gateDb = meter.floorDb + GATE_MARGIN_DB;
  meter.refDb = Math.max(gateDb + REF_MIN_SPAN_DB, Math.min(REF_CEIL_DB, meter.refDb));

  // ── the bar ───────────────────────────────────────────────────────────────
  //
  // Two thresholds, not one: open at the gate, close 3dB under it. Within a
  // word the level crosses its own gate repeatedly and a single threshold draws
  // that as alternating full-height bars and zeros.
  const openNow = meter.open ? level > gateDb - GATE_RELEASE_DB : level > gateDb;
  meter.open = openNow;
  if (!openNow) return 0;
  const over = level - gateDb;
  if (over <= 0) return 0;
  const span = Math.max(REF_MIN_SPAN_DB, meter.refDb - gateDb);
  const t = Math.min(1, over / span);
  return Math.pow(t, SHAPE_GAMMA);
}

/** 0..1 from the meter -> the 0..100 integers a clip is stored with. */
export function toStoredLevel(level: number): number {
  // NaN CLAMPS TO ZERO RATHER THAN PROPAGATING. Math.min/Math.max both return
  // NaN when either side is NaN, so a single bad sample -- the meter reads
  // undefined for one frame, a dropped peak arrives as null, a division by a
  // zero-length window -- came out as NaN, went into the peaks array, and was
  // JSON.stringify'd as `null` into the stored clip. Everything downstream then
  // draws a gap where the audio has sound, permanently, for that recording.
  //
  // Not a hypothetical shape: meterSample can be handed `db` of undefined, and
  // this is the one place between it and storage.
  if (!Number.isFinite(level)) return 0;
  return Math.round(Math.max(0, Math.min(1, level)) * 100);
}

/**
 * Squeeze an arbitrarily long recording down to `target` samples.
 *
 * THE LOUDEST SAMPLE IN EACH BUCKET, not the average of them. This averaged,
 * and averaging a waveform is how a waveform becomes a smooth hedge: a bucket
 * holding one loud syllable and four gaps averages to something quiet, so the
 * syllable and the gaps both disappear and what is left is the mean loudness of
 * the clip drawn as a rectangle. A level meter shows the peak of each slice --
 * that is what makes the shape read as speech - and the live meter in
 * RecordingWaveform already peak-holds each slice, so averaging here also meant
 * the stored clip did not match the meter that recorded it.
 */
export function downsamplePeaks(levels: number[], target = MAX_PEAKS): number[] {
  if (levels.length <= target) return levels;
  const out: number[] = [];
  for (let i = 0; i < target; i += 1) {
    const start = Math.floor((i * levels.length) / target);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / target));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const v = levels[j] ?? 0;
      if (v > peak) peak = v;
    }
    out.push(peak);
  }
  return out;
}

/**
 * Resample a stored waveform to however many bars fit on screen, again by peak.
 *
 * Shared with playback for the same reason downsamplePeaks is not an average:
 * a 240-sample clip drawn as 40 bars is six samples per bar, and averaging six
 * samples flattens every onset in the clip.
 */
export function resamplePeaks(peaks: number[], bars: number): number[] {
  if (bars <= 0) return [];
  if (peaks.length === 0) return new Array(bars).fill(0);
  if (peaks.length === bars) return peaks.slice();
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const start = Math.floor((i * peaks.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / bars));
    let peak = 0;
    for (let j = start; j < end && j < peaks.length; j += 1) {
      const v = peaks[j] ?? 0;
      if (v > peak) peak = v;
    }
    out.push(peak);
  }
  return out;
}


/**
 * How many bars actually fit in `width`.
 *
 * USE THIS INSTEAD OF HARD-CODING A COUNT. A fixed count is a fixed WIDTH: 18
 * bars at 2.5pt with a 3pt gap is 99pt of waveform, so in a row 300pt wide the
 * other 200pt is empty -- the white space beside the recorder that was reported
 * twice. And in the other direction a count too large for the slot overflows
 * onto whatever is beside it, which is how a waveform once drew over its own
 * cancel button.
 *
 * Returns 0 for an unmeasured (zero) width, so a caller can hold off rendering
 * rather than briefly drawing a one-bar waveform on the first layout pass.
 */
export function barsForWidth(width: number, barWidth = 2.5, gap = 2.5): number {
  if (!(width > 0)) return 0;
  return Math.max(1, Math.floor((width + gap) / (barWidth + gap)));
}
