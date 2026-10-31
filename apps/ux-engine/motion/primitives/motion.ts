// Motion primitives for scroll-driven and timed web motion. No dependencies,
// no DOM: every function maps numbers to numbers, so a site copies this file
// and wires the output into transform, opacity and filter itself.
//
// The rules behind each function, with sources, are in
// library/crafts/motion-film.md. Erasable TypeScript only (no enums, no
// parameter properties), so `node file.ts` runs it on Node 22.18 and later.

// ---------------------------------------------------------------------------
// Basic curves

export const clamp = (x: number, lo = 0, hi = 1): number =>
  Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/** Interpolate in log space, so a scale change reads as a camera dolly. */
export function logLerp(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, t);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 0 at both ends, 1 at the midpoint. FilmCraft uses it to peak blur mid-transition. */
export function bell(p: number): number {
  const t = 4 * p * (1 - p);
  return t * t * (3 - 2 * t);
}

/** FilmCraft's crossfade weight for "distort out, distort in" transitions. */
export const midMix = (p: number): number => smoothstep(0.3, 0.7, p);

export const easeInCubic = (t: number): number => Math.pow(clamp(t), 3);
export const easeOutCubic = (t: number): number =>
  1 - Math.pow(1 - clamp(t), 3);
export function easeInOutCubic(t: number): number {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Ease out with overshoot `s` (0 is a plain ease out). FilmCraft back_out. */
export function backOut(x: number, s = 1.70158): number {
  const u = clamp(x) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

/** Damped spring that lands exactly on 1. FilmCraft spring_motion, bounce 0..1. */
export function spring(x: number, bounce = 0.3): number {
  const w = (2 + 4 * bounce) * Math.PI;
  const k = 4 + 6 * (1 - bounce);
  const f = (u: number) => 1 - Math.exp(-k * u) * Math.cos(w * u);
  // a slower start (u = x^1.6) so the move reads before the bounce
  const u = Math.pow(clamp(x), 1.6);
  return f(u) + u * (1 - f(1));
}

/** Steep sigmoid normalised to 0..1, fast in the middle. FilmCraft whip, k = 14. */
export function whipCurve(p: number, k = 14): number {
  const s = (u: number) => 1 / (1 + Math.exp(-(u - 0.5) * k));
  return (s(clamp(p)) - s(0)) / (s(1) - s(0));
}

// ---------------------------------------------------------------------------
// Cubic bezier keyframes, FilmCraft's influence model
// (crates/project/src/keyframe.rs: ease() and cubic_bezier_y_for_x())

/** Solve CSS cubic-bezier(x1, y1, x2, y2) for y at x: Newton, then bisection. */
export function cubicBezierYForX(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
): number {
  const bx = (s: number) =>
    3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const by = (s: number) =>
    3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  const dbx = (s: number) =>
    3 * (1 - s) * (1 - s) * x1 +
    6 * (1 - s) * s * (x2 - x1) +
    3 * s * s * (1 - x2);
  let s = x;
  for (let i = 0; i < 8; i++) {
    const d = dbx(s);
    if (Math.abs(d) < 1e-9) break;
    const ns = s - (bx(s) - x) / d;
    if (ns < 0 || ns > 1) break;
    s = ns;
  }
  if (Math.abs(bx(s) - x) > 1e-7) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      s = (lo + hi) / 2;
      if (bx(s) < x) lo = s;
      else hi = s;
    }
  }
  return by(s);
}

export type Interp = "linear" | "hold" | "bezier" | "easeIn" | "easeOut";

export interface Keyframe {
  /** Time in any unit (ms, frames, scroll progress). */
  t: number;
  v: number;
  /** Governs the segment leaving this keyframe. Default linear. */
  interp?: Interp;
  /** Handle influence 0..1. Default 1/3, which is After Effects' Easy Ease. */
  outInfluence?: number;
  inInfluence?: number;
}

const DEFAULT_INFLUENCE = 1 / 3;

/**
 * Eased progress 0..1 between keyframes a and b at linear progress u.
 * Flat handles (velocity 0) with influence as the handle length in time.
 */
export function keyframeEase(a: Keyframe, b: Keyframe, u: number): number {
  const ai = a.interp ?? "linear";
  const bi = b.interp ?? "linear";
  const outEase = ai === "bezier" || ai === "easeOut";
  const inEase = bi === "bezier" || bi === "easeIn" || ai === "bezier";
  if (!outEase && !inEase) return u;
  const x1 = outEase
    ? clamp(a.outInfluence ?? DEFAULT_INFLUENCE, 0.01, 1)
    : 1 / 3;
  const y1 = outEase ? 0 : 1 / 3;
  const x2 = inEase
    ? 1 - clamp(b.inInfluence ?? DEFAULT_INFLUENCE, 0.01, 1)
    : 2 / 3;
  const y2 = inEase ? 1 : 2 / 3;
  return cubicBezierYForX(x1, y1, x2, y2, u);
}

/** Value of a keyframed parameter at time t. Keyframes must be sorted by t. */
export function valueAt(keys: Keyframe[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  if (a.t === t) return a.v;
  if ((a.interp ?? "linear") === "hold") return a.v;
  const u = (t - a.t) / (b.t - a.t);
  return lerp(a.v, b.v, keyframeEase(a, b, u));
}

/** CSS cubic-bezier() string for a pair of influences, for CSS transitions. */
export function influenceToCss(
  outInfluence = DEFAULT_INFLUENCE,
  inInfluence = DEFAULT_INFLUENCE,
): string {
  const f = (n: number) => Number(n.toFixed(3));
  return `cubic-bezier(${f(outInfluence)}, 0, ${f(1 - inInfluence)}, 1)`;
}

// ---------------------------------------------------------------------------
// Range selector text animator (After Effects Animator > Range Selector)

export type RangeShape =
  | "square"
  | "rampUp"
  | "rampDown"
  | "triangle"
  | "round"
  | "smooth";

export interface RangeSelector {
  /** Percent of the text, After Effects defaults 0 and 100. */
  start?: number;
  end?: number;
  /** Percent, -100..100. Animate this to sweep the selection. */
  offset?: number;
  shape?: RangeShape;
  /** Square only: edge softness, 0..100 percent of one character. */
  smoothness?: number;
  /** 0..100. Flattens the selection curve where it is fully selected / unselected. */
  easeHigh?: number;
  easeLow?: number;
}

/**
 * How much of the animator applies to unit i of n (0 = at rest, 1 = full
 * animator values). Ramp Up selects everything past the range end, so
 * sweeping offset from -100 to 100 reveals left to right.
 */
export function rangeAmount(
  i: number,
  n: number,
  sel: RangeSelector = {},
): number {
  const offset = sel.offset ?? 0;
  const s = ((sel.start ?? 0) + offset) / 100;
  const e = ((sel.end ?? 100) + offset) / 100;
  const shape = sel.shape ?? "square";
  const c = (i + 0.5) / Math.max(1, n);
  const width = Math.max(1e-9, e - s);
  const r = (c - s) / width;
  let a: number;
  switch (shape) {
    case "square": {
      const soft = ((sel.smoothness ?? 100) / 100) * (0.5 / Math.max(1, n));
      if (soft <= 0) a = c >= s && c <= e ? 1 : 0;
      else
        a =
          smoothstep(s - soft, s + soft, c) *
          (1 - smoothstep(e - soft, e + soft, c));
      break;
    }
    case "rampUp":
      a = clamp(r);
      break;
    case "rampDown":
      a = 1 - clamp(r);
      break;
    case "triangle":
      a = r < 0 || r > 1 ? 0 : 1 - Math.abs(2 * r - 1);
      break;
    case "round":
      a =
        r < 0 || r > 1 ? 0 : Math.sqrt(Math.max(0, 1 - Math.pow(2 * r - 1, 2)));
      break;
    case "smooth":
      a = r < 0 || r > 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * r);
      break;
  }
  // Ease High / Low: 0 keeps the shape linear, 100 flattens that end to an
  // easy ease. An approximation of After Effects, whose exact curve is closed.
  const lowK = 1 - clamp((sel.easeLow ?? 0) / 100);
  const highK = 1 - clamp((sel.easeHigh ?? 0) / 100);
  if (lowK < 1 || highK < 1)
    a = cubicBezierYForX(1 / 3, lowK / 3, 2 / 3, 1 - highK / 3, clamp(a));
  return clamp(a);
}

/** Simple time stagger: local 0..1 progress of unit i when the whole run is at p. */
export function staggerProgress(
  i: number,
  n: number,
  p: number,
  stagger = 0.08,
): number {
  const span = 1 + Math.max(0, n - 1) * stagger;
  return clamp(p * span - i * stagger);
}

export interface TextAnimator {
  /** Offset at full selection, px. jayd3nfx: [0, 100]. */
  position?: [number, number];
  /** Blur at full selection, px. jayd3nfx: 45. */
  blur?: number;
  /** Opacity at full selection, 0..1. jayd3nfx: 0. */
  opacity?: number;
  /** Extra rotation at full selection, degrees. */
  rotation?: number;
  scale?: number;
}

export interface UnitState {
  x: number;
  y: number;
  blur: number;
  opacity: number;
  rotation: number;
  scale: number;
}

/** Apply animator values scaled by selection amount a (0 = rest). */
export function applyAnimator(a: number, anim: TextAnimator): UnitState {
  const [px, py] = anim.position ?? [0, 0];
  return {
    x: px * a,
    y: py * a,
    blur: (anim.blur ?? 0) * a,
    opacity: lerp(1, anim.opacity ?? 1, a),
    rotation: (anim.rotation ?? 0) * a,
    scale: lerp(1, anim.scale ?? 1, a),
  };
}

/** The jayd3nfx reveal: position 0,100, blur 45, opacity 0, Ramp Up, offset swept by an eased keyframe pair. */
export const JAYD3N_REVEAL: {
  animator: TextAnimator;
  selector: RangeSelector;
  offsetFrom: number;
  offsetTo: number;
} = {
  animator: { position: [0, 100], blur: 45, opacity: 0 },
  selector: { shape: "rampUp", easeHigh: 50, easeLow: 100 },
  offsetFrom: -100,
  offsetTo: 100,
};

/**
 * Per-character states for a range-selector reveal at progress p (0..1).
 * The offset is keyframed with the given influence (Easy Ease by default).
 */
export function revealText(
  n: number,
  p: number,
  opts: {
    animator?: TextAnimator;
    selector?: RangeSelector;
    offsetFrom?: number;
    offsetTo?: number;
    influence?: number;
  } = {},
): UnitState[] {
  const animator = opts.animator ?? JAYD3N_REVEAL.animator;
  const base = opts.selector ?? JAYD3N_REVEAL.selector;
  const inf = opts.influence ?? DEFAULT_INFLUENCE;
  const offset = valueAt(
    [
      {
        t: 0,
        v: opts.offsetFrom ?? JAYD3N_REVEAL.offsetFrom,
        interp: "bezier",
        outInfluence: inf,
        inInfluence: inf,
      },
      {
        t: 1,
        v: opts.offsetTo ?? JAYD3N_REVEAL.offsetTo,
        interp: "bezier",
        outInfluence: inf,
        inInfluence: inf,
      },
    ],
    clamp(p),
  );
  const out: UnitState[] = [];
  for (let i = 0; i < n; i++)
    out.push(applyAnimator(rangeAmount(i, n, { ...base, offset }), animator));
  return out;
}

/** CSS for one unit. The caller sets display:inline-block on each character span. */
export function unitCss(u: UnitState): {
  transform: string;
  filter: string;
  opacity: string;
} {
  return {
    transform: `translate(${u.x.toFixed(2)}px, ${u.y.toFixed(2)}px) rotate(${u.rotation.toFixed(2)}deg) scale(${u.scale.toFixed(4)})`,
    filter: u.blur > 0.05 ? `blur(${u.blur.toFixed(2)}px)` : "none",
    opacity: u.opacity.toFixed(3),
  };
}

// ---------------------------------------------------------------------------
// Triple wheel: phrases on spokes, the group turns so the active one reads

export interface WheelItem {
  index: number;
  /** Spoke angle in screen degrees after the group rotation (0 = right, 90 = down). */
  angle: number;
  /** Text centre, px from the hub. */
  x: number;
  y: number;
  /** Rotation to apply to the phrase so it lies along its spoke and reads left to right. */
  rotation: number;
  /** 1 = active (ink), 0 = inactive (grey). Mix colour with this. */
  ink: number;
}

export interface WheelOptions {
  count?: number;
  /** Distance from hub to the phrase centre, px. */
  radius?: number;
  /** Screen angle where the active phrase lands. 0 reads level; the reference sits about -35. */
  readingAngle?: number;
  /** Turn direction for increasing index: 1 clockwise, -1 counter-clockwise. */
  direction?: 1 | -1;
}

/** Layout of a wheel whose active index may be fractional mid-turn. */
export function tripleWheel(
  active: number,
  opts: WheelOptions = {},
): WheelItem[] {
  const n = opts.count ?? 3;
  const r = opts.radius ?? 220;
  const reading = opts.readingAngle ?? 0;
  const dir = opts.direction ?? 1;
  const step = 360 / n;
  const groupRotation = reading - dir * active * step;
  const items: WheelItem[] = [];
  for (let i = 0; i < n; i++) {
    const angle = groupRotation + dir * i * step;
    const rad = (angle * Math.PI) / 180;
    // keep text upright: a spoke pointing left gets flipped half a turn
    const norm = ((angle % 360) + 360) % 360;
    const rotation = norm > 90 && norm < 270 ? angle - 180 : angle;
    let d = Math.abs(i - active) % n;
    d = Math.min(d, n - d);
    items.push({
      index: i,
      angle,
      x: r * Math.cos(rad),
      y: r * Math.sin(rad),
      rotation,
      ink: clamp(1 - d),
    });
  }
  return items;
}

/**
 * One turn of the wheel from index `from` to `to` at progress p: whip timing
 * (fast middle) and a spin-blur length that peaks mid-turn.
 */
export function wheelTurn(
  p: number,
  from: number,
  to: number,
  opts: {
    radius?: number;
    count?: number;
    shutter?: number;
    frames?: number;
  } = {},
): { active: number; blurPx: number } {
  const e = whipCurve(p);
  const active = lerp(from, to, e);
  const n = opts.count ?? 3;
  const r = opts.radius ?? 220;
  const frames = opts.frames ?? 12;
  // arc travelled per frame at this instant, times the shutter fraction
  const h = 1e-3;
  const de =
    (whipCurve(clamp(p + h)) - whipCurve(clamp(p - h))) /
    (clamp(p + h) - clamp(p - h));
  const degPerFrame = (Math.abs(to - from) * (360 / n) * de) / frames;
  const arc = (r * degPerFrame * Math.PI) / 180;
  return { active, blurPx: motionBlurPx(arc, opts.shutter ?? 180) };
}

// ---------------------------------------------------------------------------
// Whip, motion blur, and the FilmCraft transitions that map to scroll

/** Streak length of a shutter: speed in px per frame times shutter angle / 360. */
export function motionBlurPx(pxPerFrame: number, shutterAngle = 180): number {
  return Math.abs(pxPerFrame) * (shutterAngle / 360);
}

/** Gaussian std-dev pair that approximates a box streak of `len` px along (dx, dy). For SVG feGaussianBlur. */
export function directionalBlurStdDev(
  len: number,
  dx: number,
  dy: number,
): [number, number] {
  const l = Math.hypot(dx, dy) || 1;
  const sigma = Math.abs(len) / Math.sqrt(12);
  return [(sigma * Math.abs(dx)) / l, (sigma * Math.abs(dy)) / l];
}

/**
 * FilmCraft whip (crates/render/src/transitions/motion.rs): A and B ride one
 * strip, the curve is a k=14 sigmoid, and the streak is blur * bell(p) * 18%
 * of the travel. blur is 0..1; FilmCraft's default is 0.8.
 */
export function whip(
  p: number,
  travel: number,
  blur = 0.8,
): { outOffset: number; inOffset: number; blurPx: number } {
  const e = whipCurve(p);
  return {
    outOffset: travel * e,
    inOffset: travel * (e - 1),
    blurPx: blur * bell(clamp(p)) * travel * 0.18,
  };
}

/** FilmCraft push: both frames move together on ease-in-out cubic. */
export function push(
  p: number,
  travel: number,
): { outOffset: number; inOffset: number } {
  const e = easeInOutCubic(p);
  return { outOffset: travel * e, inOffset: travel * (e - 1) };
}

/** FilmCraft dip to color: A fades into the colour, holds for `hold` (0..0.9), then B. */
export function dipToColor(
  p: number,
  hold = 0,
): { a: number; color: number; b: number } {
  const h = clamp(hold, 0, 0.9);
  const half = (1 - h) / 2;
  if (p < half) return { a: 1, color: p / half, b: 0 };
  if (p > 1 - half)
    return {
      a: 0,
      color: 1 - (p - (1 - half)) / half,
      b: (p - (1 - half)) / half,
    };
  return { a: 0, color: 1, b: 0 };
}

/** FilmCraft roll_3d (a cube turn): 90 degree turn on ease-in-out, pushed back 0.45 of a side at mid-turn. */
export function cubeTurn(
  p: number,
  side: number,
): { angle: number; pushBack: number } {
  return {
    angle: easeInOutCubic(p) * 90,
    pushBack: side * 0.45 * bell(clamp(p)),
  };
}

/**
 * FilmCraft motion_camera: A pushes in and turns, B arrives from the same push
 * and settles. Defaults zoom 0.4, rotation 8 degrees. mix is B's weight.
 */
export function cameraHandoff(
  p: number,
  zoom = 0.4,
  rotation = 8,
): {
  aScale: number;
  aRotate: number;
  bScale: number;
  bRotate: number;
  mix: number;
} {
  return {
    aScale: 1 + zoom * easeInCubic(Math.min(p, 0.7) / 0.7),
    aRotate: rotation * easeInCubic(p),
    bScale: 1 + zoom * (1 - easeOutCubic(clamp((p - 0.3) / 0.7))),
    bRotate: -rotation * (1 - easeOutCubic(p)),
    mix: midMix(p),
  };
}

/** FilmCraft echo weights: start * decay^k for k = 0..count. */
export function echoWeights(count: number, start = 1, decay = 0.5): number[] {
  const w: number[] = [];
  for (let k = 0; k <= count; k++) w.push(start * Math.pow(decay, k));
  return w;
}

/** FilmCraft posterize time: hold time to steps of 1/rate. rate 12 at 24 fps is "on twos". */
export function posterizeTime(t: number, rate: number): number {
  const r = Math.max(0.01, rate);
  return Math.floor(t * r + 1e-6) / r;
}

// ---------------------------------------------------------------------------
// Scroll follower with lag, and parallax depth

/** Frame-rate independent exponential follow: halves the gap every halfLifeMs. */
export function follow(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs: number,
): number {
  if (halfLifeMs <= 0) return target;
  return target + (current - target) * Math.pow(2, -dtMs / halfLifeMs);
}

/** Convert a per-frame lerp factor (e.g. 0.1 at 60 fps) to a half-life in ms. */
export function lerpToHalfLife(perFrame: number, fps = 60): number {
  return (
    (Math.log(0.5) / Math.log(1 - clamp(perFrame, 1e-6, 0.999999))) *
    (1000 / fps)
  );
}

export interface Follower {
  value: number;
  step(target: number, dtMs: number): number;
}

export function createFollower(initial: number, halfLifeMs: number): Follower {
  const f: Follower = {
    value: initial,
    step(target: number, dtMs: number): number {
      f.value = follow(f.value, target, dtMs, halfLifeMs);
      return f.value;
    },
  };
  return f;
}

/**
 * Parallax for a layer at `depth` behind the page plane (0 = moves with the
 * page, larger = farther). Speed factor 1/(1+depth), so depth 1 moves at half
 * speed. Returns the translate to add to the layer and its perspective scale.
 */
export function parallax(
  scroll: number,
  depth: number,
): { translate: number; scale: number; speed: number } {
  const speed = 1 / (1 + Math.max(-0.9, depth));
  return { translate: scroll * (1 - speed), scale: speed, speed };
}

/** Lag that grows with depth: farther layers settle later. base is the page plane's half-life. */
export function depthHalfLife(
  depth: number,
  baseMs = 90,
  perDepthMs = 60,
): number {
  return baseMs + Math.max(0, depth) * perDepthMs;
}

/** Progress 0..1 of a pinned scene: how far scroll is through [start, start + length]. */
export function sceneProgress(
  scroll: number,
  start: number,
  length: number,
): number {
  return clamp((scroll - start) / Math.max(1, length));
}
