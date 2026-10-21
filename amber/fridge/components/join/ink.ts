import type { Stroke } from "./card";

/**
 * BALLPOINT ON CARD STOCK, DRAWN FROM THE VISITOR'S OWN POINTER.
 *
 * The handwriting standard (chewbacca skills/handwriting/references/standard.md,
 * section 6) asks a ballpoint for narrow strokes, mild pressure variation,
 * ink starvation, darker crossings and a small blob where the pen pauses. Each
 * of those comes from something measured on the stroke rather than from noise
 * laid over a vector line:
 *
 * - width follows `p`, which is real pen pressure when the device reports it
 *   and otherwise falls with speed, the way a fast ballpoint stroke thins
 * - starvation is a slow, seeded drift along the stroke, stronger when fast
 * - the start of each stroke gets a blob, because the ball sits before it rolls
 * - each stroke is laid down on its own layer and multiplied in, so crossings
 *   come out darker
 * - a fibre mask knocks tiny holes in the ink, so the edge is never clean
 *
 * The canvas itself is multiplied over the paper in CSS, so the card's fibre
 * shows through the ink.
 */

const INK: [number, number, number] = [26, 40, 112];
const PAPER: [number, number, number] = [250, 248, 242];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise, so starvation drifts instead of flickering. */
function drift(seed: number) {
  const r = rng(seed);
  const knots = Array.from({ length: 64 }, () => r());
  return (s: number) => {
    const i = Math.floor(s) & 63;
    const f = s - Math.floor(s);
    const u = f * f * (3 - 2 * f);
    return knots[i] * (1 - u) + knots[(i + 1) & 63] * u;
  };
}

let fibre: HTMLCanvasElement | null = null;

/** Tiny clustered specks, the gaps where ink skipped over raised fibre. */
function fibreMask(): HTMLCanvasElement {
  if (fibre) return fibre;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const r = rng(91);
  for (let i = 0; i < 1100; i++) {
    const x = r() * 128;
    const y = r() * 128;
    const len = 0.6 + r() * 2.2;
    const ang = r() * Math.PI;
    ctx.strokeStyle = `rgba(0,0,0,${0.25 + r() * 0.55})`;
    ctx.lineWidth = 0.5 + r() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  fibre = c;
  return c;
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  k: number,
) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
}

let layer: HTMLCanvasElement | null = null;

/**
 * Draws strokes (card or page coordinates, 0..1) onto ctx. `cardW` x `cardH`
 * is the whole surface in CSS px; `top` and `left` are where the canvas starts
 * on it when it only covers part of it. `dpr` is the backing-store scale.
 */
export function drawInk(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  opts: { cardW: number; cardH: number; top?: number; left?: number; dpr: number; nib?: number },
) {
  const { cardW, cardH, dpr } = opts;
  const top = opts.top ?? 0;
  const left = opts.left ?? 0;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  if (!strokes.length) return;

  if (!layer) layer = document.createElement("canvas");
  if (layer.width !== cw || layer.height !== ch) {
    layer.width = cw;
    layer.height = ch;
  }
  const lctx = layer.getContext("2d");
  if (!lctx) return;
  // A real ballpoint line is about 0.5 mm. On a 5 inch card shown 560 px wide
  // that is 2.2 px; the floor keeps a pinned thumbnail from vanishing.
  // `nib` (CSS px) overrides it when the canvas is not the paper's width, as
  // on the full-frame journal view, where cardW is the whole room.
  const base = (opts.nib ?? Math.max(0.55, cardW * 0.0042)) * dpr;
  const pattern = ctx.createPattern(fibreMask(), "repeat");

  strokes.forEach((stroke, si) => {
    if (!stroke.length) return;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, cw, ch);
    lctx.lineCap = "round";
    lctx.lineJoin = "round";
    const seed = si * 7919 + Math.round(stroke[0].x * 1e4);
    const starve = drift(seed);
    const wobble = drift(seed + 1);
    const pts = stroke.map((q) => ({
      x: (q.x * cardW - left) * dpr,
      y: (q.y * cardH - top) * dpr,
      p: q.p,
      t: q.t,
    }));
    let travelled = 0;

    if (pts.length === 1) {
      lctx.fillStyle = mix(INK, PAPER, 0.05);
      lctx.beginPath();
      lctx.arc(
        pts[0].x,
        pts[0].y,
        base * (0.55 + 0.4 * pts[0].p),
        0,
        Math.PI * 2,
      );
      lctx.fill();
    }

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      travelled += len;
      const s = travelled / (base * 14);
      const p = (a.p + b.p) / 2;
      // Lift-off: the last few points thin as the pen leaves the card.
      const fromEnd = pts.length - 1 - i;
      const taper = fromEnd < 3 ? 0.7 + fromEnd * 0.1 : 1;
      const width = base * (0.55 + 0.75 * p) * taper;
      // Fast strokes starve more. p is low when the stroke was fast.
      const skip = Math.max(0, starve(s) - 0.55) * (1.6 - p) * 0.9;
      lctx.strokeStyle = mix(INK, PAPER, Math.min(0.55, 0.04 + skip));
      lctx.lineWidth = width;
      // A hair of sideways wobble, correlated along the stroke.
      const nx = (-dy / len) * (wobble(s * 0.5) - 0.5) * 0.35 * dpr;
      const ny = (dx / len) * (wobble(s * 0.5) - 0.5) * 0.35 * dpr;
      lctx.beginPath();
      lctx.moveTo(a.x + nx, a.y + ny);
      if (i + 1 < pts.length) {
        const c = pts[i + 1];
        lctx.quadraticCurveTo(
          b.x + nx,
          b.y + ny,
          (b.x + c.x) / 2 + nx,
          (b.y + c.y) / 2 + ny,
        );
      } else {
        lctx.lineTo(b.x + nx, b.y + ny);
      }
      lctx.stroke();
    }

    // The ball pauses before it rolls: a small, dense start blob.
    const first = pts[0];
    lctx.fillStyle = mix(INK, [0, 0, 30], 0.15);
    lctx.beginPath();
    lctx.ellipse(
      first.x,
      first.y,
      base * 0.62,
      base * 0.5,
      seed % 3,
      0,
      Math.PI * 2,
    );
    lctx.fill();

    if (pattern) {
      lctx.globalCompositeOperation = "destination-out";
      lctx.globalAlpha = 0.5;
      lctx.fillStyle = pattern;
      lctx.fillRect(0, 0, cw, ch);
      lctx.globalAlpha = 1;
      lctx.globalCompositeOperation = "source-over";
    }

    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(layer as HTMLCanvasElement, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  });
}

/**
 * Effective pressure from a pointer sample. Pens report real pressure. Mice
 * and most fingers do not (they report 0.5 or a flat 0 or 1), so speed stands
 * in for it: a fast ballpoint stroke lays down a thinner line.
 */
export function effectivePressure(
  pointerType: string,
  pressure: number,
  speedCardWidthsPerSec: number,
  previous: number | null,
): number {
  const fromSpeed = Math.min(
    1,
    Math.max(0.12, 1.05 - (speedCardWidthsPerSec - 0.25) / 2.4),
  );
  const real = pointerType === "pen" && pressure > 0 && pressure !== 0.5;
  const target = real ? Math.min(1, Math.max(0.1, pressure * 1.15)) : fromSpeed;
  // Smoothed, because a hand's pressure changes continuously.
  return previous === null ? target : previous + (target - previous) * 0.35;
}
