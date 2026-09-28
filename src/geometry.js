/* Generative geometry for the hero plates.
 *
 * Their six are gravlens, harmonograph and sphere by name, plus a crosshatch
 * grid, a wireframe cube and a dot-matrix form. These are built from the
 * published equations with constants that were rendered and checked, not from
 * reading their output.
 *
 * Budget: one CSS animation per primitive, so element count is the hard limit.
 * 300 elements at 17ms of stagger is a 5.1 second draw-on, already the ceiling.
 */

export const TAU = Math.PI * 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalise any point set into the 0..100 box. */
export function fit(polys, pad = 8) {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (const p of polys) for (const q of p) {
    if (q[0] < mnx) mnx = q[0]; if (q[0] > mxx) mxx = q[0];
    if (q[1] < mny) mny = q[1]; if (q[1] > mxy) mxy = q[1];
  }
  const span = Math.max(mxx - mnx, mxy - mny) || 1;
  const k = (100 - 2 * pad) / span;
  const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
  return polys.map(p => p.map(q => [(q[0] - cx) * k + 50, (q[1] - cy) * k + 50]));
}

export const toPath = (poly) =>
  "M" + poly.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L");

/* HARMONOGRAPH. One element.
 *
 * driftPi is the control nobody publishes: the detune has to accumulate about
 * half a turn to a full turn of phase drift across the run, so
 * df = driftPi * pi / T. At 0 the figure is a static rosette with no
 * precession. Past 4 it is scribble. Petals = f1 + f2.
 *
 * Bourke says frequencies should not be integer multiples. True for a physical
 * harmonograph, wrong for a legible drawing: non-integer ratios measured at
 * 19.6% ink, past the mud threshold. Near-integer plus a small detune instead.
 */
export function harmonograph({ base = [5, 4], driftPi = 1.2, cycles = 34,
                               decayTo = 0.26, spc = 48,
                               phase = [0, Math.PI / 2, 0, Math.PI / 2] } = {}) {
  const T = (cycles * TAU) / Math.max(...base);
  const df = (driftPi * Math.PI) / T;
  const f = [base[0], base[1] + df, base[1], base[0] + df];
  // Damping set by where it should end, not by a raw constant: the right value
  // moves by 10x with run length.
  const d = -Math.log(decayTo) / T;
  const N = Math.round(cycles * spc);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = (T * i) / (N - 1), e = Math.exp(-d * t);
    pts.push([
      Math.sin(t * f[0] + phase[0]) * e + Math.sin(t * f[1] + phase[1]) * e,
      Math.sin(t * f[2] + phase[2]) * e + Math.sin(t * f[3] + phase[3]) * e,
    ]);
  }
  return fit([pts]);
}

/* WIREFRAME SPHERE. Their version runs 101 paths; this runs latitude rings and
 * longitude arcs as separate polylines so each draws as one stroke. */
export function sphere({ lats = 9, longs = 14, seg = 30 } = {}) {
  const out = [], R = 1;
  for (let i = 1; i < lats; i++) {
    const phi = (i / lats) * Math.PI;
    const y = -Math.cos(phi), r = Math.sin(phi);
    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU;
      // Squashed vertically, which is what gives the perspective read.
      ring.push([r * Math.cos(a), y + r * 0.34 * Math.sin(a)]);
    }
    out.push(ring);
  }
  for (let k = 0; k < longs; k++) {
    const th = (k / longs) * Math.PI, arc = [];
    for (let j = 0; j <= seg; j++) {
      const p = (j / seg) * Math.PI;
      arc.push([R * Math.sin(p) * Math.cos(th), -R * Math.cos(p)]);
    }
    out.push(arc);
  }
  return fit(out);
}

/* GRAVITATIONAL LENS. Straight rays deflected by a central mass, which is what
 * their "spread under strain" plate is: light bent around something heavy.
 * 48 elements, matching theirs. */
export function gravlens({ rays = 48, seg = 90, mass = 0.34 } = {}) {
  const out = [];
  for (let i = 0; i < rays; i++) {
    const b = -1.4 + (2.8 * i) / (rays - 1);   // impact parameter
    const line = [];
    for (let j = 0; j <= seg; j++) {
      const x = -1.6 + (3.2 * j) / seg;
      const r2 = x * x + b * b;
      // Deflection falls off with distance, so rays far from the centre stay
      // straight and only the near ones bend. That contrast IS the figure.
      const bend = (mass * b) / (r2 + 0.06);
      line.push([x, b - bend]);
    }
    out.push(line);
  }
  return fit(out);
}

/* CHLADNI nodal lines, contours stitched.
 *
 * Stitching is not optional: raw marching-squares output at n=3 m=5 is 812
 * loose segments and stitched it is 8. A hundredfold reduction, and the
 * draw-on becomes one continuous stroke per contour instead of a hundred
 * disconnected ticks appearing in random order.
 *
 * n != m, both >= 2, coprime, and n + m <= 18. Equal or common-factor pairs
 * degenerate into a plain grid.
 */
export function chladni({ n = 4, m = 7, res = 90 } = {}) {
  const f = (x, y) =>
    Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) -
    Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y);

  const V = [];
  for (let i = 0; i <= res; i++) { V[i] = []; for (let j = 0; j <= res; j++) V[i][j] = f(i / res, j / res); }

  const segs = [];
  for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) {
    const v = [V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]];
    const c = [[i / res, j / res], [(i + 1) / res, j / res],
               [(i + 1) / res, (j + 1) / res], [i / res, (j + 1) / res]];
    let idx = 0; v.forEach((q, k) => { if (q > 0) idx |= 1 << k; });
    if (idx === 0 || idx === 15) continue;
    const ip = (A, B, va, vb) => { const t = va / (va - vb);
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; };
    const e = [];
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4;
      if ((v[k] > 0) !== (v[k2] > 0)) e.push(ip(c[k], c[k2], v[k], v[k2])); }
    for (let k = 0; k + 1 < e.length; k += 2) segs.push([e[k], e[k + 1]]);
  }

  const key = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const at = new Map();
  segs.forEach((s, i) => s.forEach(p => {
    const k = key(p); if (!at.has(k)) at.set(k, []); at.get(k).push(i);
  }));
  const used = new Array(segs.length).fill(false), out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const poly = [segs[i][0], segs[i][1]];
    for (const fwd of [true, false]) {
      let grow = true;
      while (grow) {
        grow = false;
        const end = fwd ? poly[poly.length - 1] : poly[0];
        for (const j of at.get(key(end)) ?? []) {
          if (used[j]) continue;
          const [a, b] = segs[j];
          const nxt = key(a) === key(end) ? b : key(b) === key(end) ? a : null;
          if (!nxt) continue;
          used[j] = true;
          fwd ? poly.push(nxt) : poly.unshift(nxt);
          grow = true; break;
        }
      }
    }
    if (poly.length >= 4) out.push(poly);
  }
  return fit(out);
}

/* CROSSHATCH in perspective. Their 378-path plate. Two families of lines
 * converging on a vanishing point. */
export function crosshatch({ n = 22, seg = 8 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const line = [];
    for (let j = 0; j <= seg; j++) {
      const u = j / seg;
      // Perspective: spacing compresses toward the horizon.
      const y = -1 + 2 * Math.pow(t, 1.7);
      line.push([-1 + 2 * u, y * (0.35 + 0.65 * u)]);
    }
    out.push(line);
    const line2 = [];
    for (let j = 0; j <= seg; j++) {
      const u = j / seg;
      const x = -1 + 2 * t;
      line2.push([x * (0.35 + 0.65 * u), -1 + 2 * u]);
    }
    out.push(line2);
  }
  return fit(out);
}

/* PHYLLOTAXIS. Vogel: r = c*sqrt(n), theta = n * 137.508deg.
 *
 * Two measured thresholds. Under 100 marks reads as scattered noise; 250 and
 * above and the Fibonacci arms are the dominant read. And the mark radius
 * matters as much as the count: at 0.52 of the packing constant the dots float,
 * at 0.70 to 0.75 the arms lock in, because near-touching neighbours are what
 * make the eye trace a chain.
 *
 * Emitted as circles, so the element count costs zero path points. Radius is
 * kept low here because at 0.72 this measured 33% ink, well past the 15% mud
 * threshold, on a page that also has five other plates.
 */
export function phyllotaxis({ n = 260, k = 0.42 } = {}) {
  const out = [];
  const maxR = Math.sqrt(n - 1);
  const scale = 42 / maxR;
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(i), a = i * GOLDEN_ANGLE;
    out.push({
      cx: 50 + r * Math.cos(a) * scale,
      cy: 50 + r * Math.sin(a) * scale,
      r: Math.max(0.3, k * scale),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Figures added 2026-09-26 to match the reference hero plates. Each one is
   a named construction with its own parameters, not a scribble: the first
   attempt drew random polylines and read as noise next to the reference's
   six distinct, legible objects. */

/* A ruled hyperboloid. Straight chords between two circles, offset by a
   twist. The waist is not drawn: it EMERGES where the chords crowd, which
   is the whole reason this shape is beautiful and why drawing a curve
   instead would look dead. */
export function hyperboloid({ n = 46, twist = 1.15, w = 120, h = 74 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = a + twist;
    out.push([[Math.cos(a) * w, -h], [Math.cos(b) * w, h]]);
  }
  return out;
}

/* A torus seen face-on: concentric rings with a density falloff, so the
   band reads as glowing without any blur filter. Opacity does the work a
   gradient would, and stays crisp at any zoom. */
export function ring({ bands = 26, r = 74, thick = 26 } = {}) {
  const out = [];
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const rr = r - thick / 2 + t * thick;
    const pts = [];
    for (let k = 0; k <= 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.96]);
    }
    out.push({ pts, o: 0.16 + Math.sin(t * Math.PI) * 0.72 });
  }
  return out;
}

/* An isometric cube with one solid face. The reference fills the top face
   dark and leaves the rest wireframe, which is what makes it read as a
   physical object sitting in the drawing rather than a diagram of one. */
export function isoCube({ s = 42 } = {}) {
  const top = [[0, -s * 0.5], [s, -s], [s * 2, -s * 0.5], [s, 0]];
  const left = [[0, -s * 0.5], [0, s * 0.42], [s, s * 0.92], [s, 0]];
  const right = [[s * 2, -s * 0.5], [s * 2, s * 0.42], [s, s * 0.92], [s, 0]];
  return { top, left, right };
}

/* A dotted field masked to an arch. Dot SIZE carries the gradient, not
   opacity, because the reference's dots stay individually countable at the
   top of the arch where they thin out. */
/* RECOVERED from the reference's own 2,000 circles, not designed.

   Parsing their plate showed the construction is nothing like what was here
   before. There is NO arch mask. It is a complete 40 x 50 rectangular grid
   covering the whole viewBox, x pitch 2.5 from 1.25, y pitch 1.84 from 8.92,
   and the half-width is 48.75 at every single row.

   The radius takes exactly TWO values, 0.221 and 0.589, split 1158 to 842.
   The arch you see is a DITHER: the probability of a dot being large rises
   with depth, from 0.025 in the top row to 0.65 in the bottom, and falls off
   away from the centre column. The shape is made of probability.

   Fitting individual dots gets R^2 0.117 and 59% classification, barely over
   chance, because each dot is a random draw. So this reproduces the PROCESS
   and not the sample: matching their exact dots would be overfitting to one
   seed of their random number generator, and would look no better.

   p(d) = -1.0125d^2 + 1.4126d + 0.0556 by depth, R^2 0.79 on row means. */
/* ---------------------------------------------------------------------- */
/* RULE 30, an elementary cellular automaton (Wolfram, 1983).

   READ OUT OF THE REFERENCE'S OWN BUNDLE on 2026-09-27, not guessed. Their
   component is named CellularAutomataFigure and the rule number 30 is
   decomposed into its 8 bits exactly as below.

   This replaces a probability dither I had fitted to the same plate:

       p(d) = -1.0125 d^2 + 1.4126 d + 0.0556

   That quadratic reproduced the plate's DENSITY profile to within a few
   percent and was still fiction. It is a curve fitted to the silhouette of a
   Rule 30 triangle. Every dot it placed was placed for the wrong reason, and
   no amount of refitting it would ever have produced the interior structure,
   because the interior of Rule 30 is chaotic on the left and periodic on the
   right and a separable p(row) * f(col) cannot express that.

   The lesson is cheaper to write down than it was to learn: a generative
   figure has a generator, and fitting its output distribution is not
   recovering it. Read the source.

   GENERATOR: 40 cells, 50 generations, one live cell at index 20, PERIODIC
   boundaries (the row wraps, so the triangle's arms re-enter on the far
   side rather than being clipped). Those four facts are the whole figure.

   The live/dead counts are not tuned. 40 x 50 = 2000 cells and Rule 30 from
   a single seed happens to leave 842 live and 1158 dead. Matching those
   counts by choosing a fill fraction is the same mistake as the quadratic. */

const RULE_30 = Array.from({ length: 8 }, (_, i) => ((30 >> i) & 1) === 1);

export function rule30({ cols = 40, rows = 50, seed = null } = {}) {
  const gens = [];
  let row = new Array(cols).fill(false);
  row[seed === null ? Math.floor(cols / 2) : seed] = true;
  gens.push(row);
  for (let g = 1; g < rows; g++) {
    const prev = gens[g - 1];
    const next = new Array(cols).fill(false);
    for (let c = 0; c < cols; c++) {
      // The 3-cell neighbourhood as a 0-7 index, left bit most significant.
      // Periodic: both neighbours wrap, which is what lets the pattern reach
      // the full width instead of dying inside a clipped cone.
      const l = prev[(c - 1 + cols) % cols] ? 1 : 0;
      const m = prev[c] ? 1 : 0;
      const r = prev[(c + 1) % cols] ? 1 : 0;
      next[c] = RULE_30[(l << 2) | (m << 1) | r];
    }
    gens.push(next);
  }
  const live = [], dead = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      (gens[r][c] ? live : dead).push([r, c]);
  return { gens, live, dead, cols, rows };
}

/* Their placement, in the 0-100 viewBox both plates share.
   Pitch 2.5 x 1.84, cells sampled at their centres, field starting at y=8. */
export const CA_PITCH_X = 2.5;
export const CA_PITCH_Y = 1.84;
export const CA_Y0 = 8;
export const CA_R_LIVE = 0.5888;
export const CA_R_DEAD = 0.2208;
export const CA_R_HIT = 1.012;          // the invisible click target per live cell

export const caX = c => (c + 0.5) * CA_PITCH_X;
export const caY = r => CA_Y0 + (r + 0.5) * CA_PITCH_Y;

/* The reveal is a clip rect growing DOWNWARD one generation at a time, so
   rows appear as the automaton computes them. Nothing translates and nothing
   fades: the figure is drawn by uncovering it.

   70ms per generation x 50 generations = 3500ms. Their loop variant holds the
   finished state and restarts at 5100ms, so the hold is 1600ms. */
export const CA_MS_PER_GEN = 70;
export const CA_GROW_MS = CA_MS_PER_GEN * 50;     // 3500
export const CA_LOOP_MS = 5100;
export const caClipHeight = gen => CA_Y0 + CA_PITCH_Y * gen;


/* ---------------------------------------------------------------------- */
/* THE EXTRUDED CUBE. Recovered 2026-09-27 from the reference's bundle,
   where the component is ExtrudedCubePreview.

   I had called this dead code. It is the richest thing on their page.

   PROJECTION. Orthographic, not isometric and not a 2D rotation. A unit cube
   at +/-1 is rotated about Y by `spin` degrees, then tilted about X by `tilt`,
   then scaled by 22 and centred in the 100x100 box every plate shares. There
   is no perspective divide, which is why the silhouette stays honest at any
   angle instead of ballooning.

   Earlier I drew this as a rotate(45deg) square and was told, correctly, that
   a rotated square has EQUAL diagonals while a cube face on this plane has a
   2:1 ratio. The fix is not a better angle. It is doing the projection.

   TOP FACE. Vertices 3,2,6,7 in the order below form the top quad, and the
   reference uses it as a clip-path polygon with an animated mesh-gradient
   shader rendered inside it. That is the part I could never have guessed from
   looking: the cube's lid is a living gradient, masked to a face that turns. */

const CUBE_VERTS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1],
];

const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],      // back face
  [4, 5], [5, 6], [6, 7], [7, 4],      // front face
  [0, 4], [1, 5], [2, 6], [3, 7],      // the four struts
];

export const CUBE_SCALE = 22;
export const CUBE_TOP_FACE = [3, 2, 6, 7];

export function extrudedCube({ spin = 35, tilt = 22, cx = 50, cy = 50, s = CUBE_SCALE } = {}) {
  const ry = spin * Math.PI / 180, rx = tilt * Math.PI / 180;
  const p = CUBE_VERTS.map(([x, y, z]) => {
    // Yaw about the vertical axis.
    const xr =  x * Math.cos(ry) + z * Math.sin(ry);
    const zr = -x * Math.sin(ry) + z * Math.cos(ry);
    // Then pitch, and drop the depth term. Screen y grows downward, hence
    // the subtraction rather than an added term.
    return { x: cx + s * xr, y: cy - s * (y * Math.cos(rx) - zr * Math.sin(rx)) };
  });
  return {
    verts: p,
    edges: CUBE_EDGES.map(([a, b]) => ({ x1: p[a].x, y1: p[a].y, x2: p[b].x, y2: p[b].y })),
    topVerts: CUBE_TOP_FACE.map(i => p[i]),
  };
}

/* Their motion, exactly.

   A cubic ease-out carries it through one full turn in 1.2s, and after that
   it just keeps going at 6 degrees per second forever. The slow constant
   drift is what makes it read as an object sitting there rather than an
   animation that has finished.

   The pointer contributes through a lerp at 0.08 per frame, so the cube
   leans toward the cursor and settles back rather than snapping: +/-45 deg
   of extra yaw and +/-35 of pitch at the corners of its own box.

   Off screen it PAUSES and banks the elapsed time, so scrolling back finds
   it where it was rather than at the start of its spin. */
export const CUBE_SPINUP_S = 1.2;
export const CUBE_DRIFT_DEG_S = 6;
export const CUBE_POINTER_LERP = 0.08;
export const CUBE_POINTER_YAW = 45;
export const CUBE_POINTER_PITCH = 35;

export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
export const easeInCubic  = t => t * t * t;

/* Degrees of yaw at t seconds of accumulated on-screen time. */
export function cubeSpinAt(t) {
  return t < CUBE_SPINUP_S
    ? easeOutCubic(t / CUBE_SPINUP_S) * 360
    : 360 + (t - CUBE_SPINUP_S) * CUBE_DRIFT_DEG_S;
}

export function dotArch({ cols = 30, rows = 24, w = 200, h = 170 } = {}) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c / (cols - 1) - 0.5) * w;
      const y = (r / (rows - 1) - 0.5) * h;
      // Arch mask: a parabola opening downward, plus straight legs.
      const nx = x / (w / 2), ny = y / (h / 2);
      const inside = ny > -1 + nx * nx * 0.92;
      if (!inside) continue;
      const d = (ny + 1) / 2;                 // 0 at the crown, 1 at the base
      out.push([x, y, 0.5 + d * 1.5]);
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* RECOVERED 2026-09-26 by ux-recover, from the reference's own served
   geometry. Every constant below was read out of their SVG, not chosen. */

/* A PENCIL OF LINES THROUGH A POINT. Their LEM 1.1 plate: 48 rays, start
   heights 9.73 to 90.27 at pitch 1.71, and every single ray passes through
   EXACTLY (50, 50) at its midpoint. Measured waist width: 0.00.

   So the hourglass is not a hyperboloid and not a ruled surface. It is the
   simplest possible construction, a pencil of straight lines through one
   point, and the bright waist is pure convergence: 48 strokes crossing the
   same pixel. I had built a twisted ruled surface, which looks superficially
   similar and can never produce that pinch, because its lines never actually
   meet. */
export function pencil({ rays = 48, seg = 61, cx = 50, cy = 50,
                         lo = 9.73, hi = 90.27 } = {}) {
  const out = [];
  for (let i = 0; i < rays; i++) {
    const y0 = lo + (hi - lo) * (i / (rays - 1));
    const y1 = 2 * cy - y0;                 // mirrored through the centre
    const line = [];
    for (let j = 0; j < seg; j++) {
      const t = j / (seg - 1);
      line.push([t * 100, y0 + (y1 - y0) * t]);
    }
    out.push(line);
  }
  return out;
}

/* A PENTAGON ROSE. Their 60 "harmograph-line" paths are byte-identical: one
   regular pentagon, repeated, each rotated by k * 6.10 degrees about (50,50).
   60 * 6.10 is 366, so it closes just past a full turn.

   The vertices below are theirs exactly. Nothing about this is a
   harmonograph despite the class name, which is why building one produced
   something unrelated. */
export const PENTAGON = [[50, 12], [86.14, 38.26], [72.34, 80.74],
                         [27.66, 80.74], [13.86, 38.26]];
export function rose({ copies = 60, stepDeg = 6.10 } = {}) {
  return Array.from({ length: copies }, (_, i) => ({
    pts: PENTAGON, rot: +(i * stepDeg).toFixed(2),
  }));
}

/* AN ISOMETRIC QUAD TILING. Their lattice plate is 1,116 four-point paths,
   not crossing lines. Two edges are always 4.47 long and two vary; the edge
   vectors are (4.0, 1.118) and (-2.237, 1.592), giving a 3.58:1 shallow
   isometric basis. Centres sit on a 2.0 x-pitch.

   Building this from lines produced a fan, because a lattice of lines and a
   lattice of tiles are different objects: only the tiles can be individually
   filled, faded or lifted, which is what the reference does to them. */
export const ISO_U = [4.0, 1.118];
export const ISO_V = [-2.237, 1.592];
/* LEM 2.1, recovered exactly from the reference's 378 tile paths.

   This plate was `isoTiles({cols:36, rows:24})`: a flat rectangular sheet of
   864 rhombi spanning x -48.8 to 148.8 in a 0..100 box, so more than half of
   it rendered outside the plate and was clipped. Theirs is not a sheet.

   Reading every tile's `d` attribute and grouping by row gives the whole
   construction with no fitting involved:

       tile        rhombus, half-width 4, half-height 2
       rows        y = 29 to 99, one every 2 units, 36 rows
       rows 0-12   row r holds r+1 tiles, centred on x=50, step 8
       rows 13-35  full width, alternating 13 tiles from x=2 and 12 from x=6
       total       91 + 144 + 143 = 378

   So it is an apex at (50,29) widening at a constant 4 units per row until
   it reaches the plate edge at row 12, then continuing straight down. That
   is the same pentagon silhouette as 1.3 (60 rotated pentagons) and 2.3 (the
   automaton's dot field). The pentagon is the motif of the whole plate
   series, and this plate was the one place we had not noticed it.

   Row 12 needs no special case: the triangle formula at r=12 gives 13 tiles
   from x=2 to x=98, which is exactly the wide row the lattice then alternates
   with. The two halves meet without a seam because they are the same lattice. */
export function meshPentagon() {
  const HW = 4, HH = 2, ROWS = 36, APEX_ROWS = 12;
  const centres = [];
  for (let r = 0; r < ROWS; r++) {
    const y = 29 + r * 2;
    if (r <= APEX_ROWS) {
      for (let i = 0; i <= r; i++) centres.push([50 - 4 * r + 8 * i, y]);
    } else {
      const wide = r % 2 === 0;
      const x0 = wide ? 2 : 6, n = wide ? 13 : 12;
      for (let i = 0; i < n; i++) centres.push([x0 + 8 * i, y]);
    }
  }
  return centres.map(([x, y]) => [
    [x, y], [x + HW, y + HH], [x, y + 2 * HH], [x - HW, y + HH], [x, y],
  ]);
}

export function isoTiles({ cols = 44, rows = 26, ox = 50, oy = 62 } = {}) {
  const out = [];
  for (let b = 0; b < rows; b++) {
    for (let a = 0; a < cols; a++) {
      const u = a - cols / 2, v = b - rows / 2;
      const x = ox + u * ISO_U[0] + v * ISO_V[0];
      const y = oy + u * ISO_U[1] + v * ISO_V[1];
      out.push([[x, y],
                [x + ISO_U[0], y + ISO_U[1]],
                [x + ISO_U[0] + ISO_V[0], y + ISO_U[1] + ISO_V[1]],
                [x + ISO_V[0], y + ISO_V[1]]]);
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* THEIR ACTUAL SOURCE, 2026-09-26.
 *
 * I said these generators were server-side and unrecoverable. Wrong. I had
 * downloaded 39 eager chunks; the build ships 116, and the rest are lazy.
 * Parsing the webpack chunk map reaches them, and the figures are in there.
 *
 * So everything below is transcribed from their shipped code, not fitted and
 * not guessed. Where my earlier measurement disagreed, their code wins and
 * the disagreement is noted, because those are the places my reasoning was
 * wrong in an instructive way. */

/* GRAVITATIONAL LENS. 48 rays, 61 samples, Gaussian deflection.
 *
 * I measured this as "a pencil of 48 straight lines through (50,50)" because
 * every ray passes through the lens centre with spread 0.00. The convergence
 * was real; the mechanism was not. They are Gaussian-deflected curves, and
 * at x = cx the exponential is exactly 1, so every ray lands on cy by
 * construction. A pencil of straight lines reproduces the waist and none of
 * the bowing on either side of it.
 *
 * sigma^2 = 784, so sigma = 28 in a 100-unit box. */
export function gravLens({ rays = 48, seg = 60, cx = 50, cy = 50, sigma2 = 784 } = {}) {
  const out = [];
  for (let i = 0; i < rays; i++) {
    const y0 = 8 + (i / (rays - 1)) * 84;      // their span: 8 to 92
    const n = y0 - cy;
    const line = [];
    for (let j = 0; j <= seg; j++) {
      const x = (j / seg) * 100;
      line.push([x, y0 - n * Math.exp(-((x - cx) ** 2) / sigma2)]);
    }
    out.push(line);
  }
  return out;
}

/* THE PENTAGON, exactly theirs: radius 38 about (50,50), first vertex at
 * -PI/2 so it points up. 60 copies at 6.10 degree steps. The class name on
 * these is "harmograph-line" and there is no harmonograph anywhere in it. */
export function pentagon({ r = 38, cx = 50, cy = 50, n = 5 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
}

/* WIREFRAME SPHERE. Recovered to rms 0.0041 user units against their 3,315
 * emitted coordinates, which is the bound imposed by their own 2-decimal
 * rounding. Five parameters, every one from a free least-squares fit rather
 * than assumed:
 *
 *   centre (50, 52)   NOT (50,50): the sphere sits two units low
 *   radius 38.0
 *   tilt   14.000 deg about the screen X axis
 *   phase  49.342 deg
 *
 * The tilt tips the north pole AWAY from the viewer, so the camera sits just
 * below the equator plane and the near half of the equator draws ABOVE the
 * horizontal centre line. Counterintuitive, and it is what the data says.
 *
 * 32 meridians at 11.25 deg and 19 rings at 9 deg, every curve 65 samples.
 * The 5..65 sample counts I had read as sloppiness are the VISIBILITY SPLIT:
 * each curve is cut where it crosses the horizon so the far half can be
 * drawn at lower opacity. Near z>0 is 0.7, far is 0.4, threshold exactly 0.
 *
 * The r=38 circle is the SILHOUETTE, not the equator, despite their own
 * class calling it sphere-equator. The real equator is a separate ring.
 *
 * Ring runs that straddle sample 0 emit TWO subpaths in one d. Joining them
 * draws a chord straight across the sphere. */
export function sphere3d({ meridians = 32, rings = 19, seg = 64,
                           cx = 50, cy = 52, r = 38,
                           tiltDeg = 14, phaseDeg = 49.342 } = {}) {
  const T = tiltDeg * Math.PI / 180;
  const P = (latDeg, lonDeg) => {
    const a = latDeg * Math.PI / 180, b = lonDeg * Math.PI / 180;
    const x = Math.cos(a) * Math.cos(b);
    const y = -Math.sin(a);                       // +lat is the TOP of screen
    const z = Math.cos(a) * Math.sin(b);
    return { sx: cx + r * x,
             sy: cy + r * (y * Math.cos(T) - z * Math.sin(T)),
             front: (y * Math.sin(T) + z * Math.cos(T)) > 0 };
  };
  const curves = [];
  for (let j = 0; j < meridians; j++) {
    const lon = phaseDeg - j * (360 / meridians);
    curves.push(Array.from({ length: seg + 1 },
      (_, i) => P(90 - i * (180 / seg), lon)));
  }
  for (let k = 0; k < rings; k++) {
    const lat = 81 - 9 * k;
    curves.push(Array.from({ length: seg + 1 },
      (_, i) => P(lat, phaseDeg - i * (360 / seg))));
  }
  // Split each curve into near and far runs, near emitted first.
  const out = [];
  for (const c of curves) {
    for (const want of [true, false]) {
      const runs = []; let run = [];
      for (const p of c) {
        if (p.front === want) run.push([p.sx, p.sy]);
        else if (run.length > 1) { runs.push(run); run = []; }
        else run = [];
      }
      if (run.length > 1) runs.push(run);
      if (runs.length) out.push({ runs, front: want, opacity: want ? 0.7 : 0.4 });
    }
  }
  return out;
}

/* VALUE NOISE. The reason their field reads as organic and mine did not.
 *
 * My dither drew each cell independently, so the result was statistically
 * uniform: every tile isolated, none touching, a perfectly even scatter.
 * Theirs has pairs and triples sitting adjacent, clumps with gaps between
 * them. That is not a different probability, it is a different PROCESS.
 *
 * Independent draws cannot cluster. Clustering requires the value at a cell
 * to be correlated with its neighbours, which is what value noise gives:
 * random values on a coarse grid, smoothly interpolated between. Threshold
 * that field and the cells above the line come out in connected blobs.
 *
 * This is the single difference between "random" and "organic", and no
 * amount of tuning a per-cell probability reaches it. */
export function valueNoise(seed = 1) {
  const rnd = rng(seed);
  const N = 64;
  const g = Array.from({ length: N * N }, () => rnd());
  const fade = t => t * t * (3 - 2 * t);           // smoothstep, C1 continuous
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const at = (a, b) => g[(((b % N) + N) % N) * N + (((a % N) + N) % N)];
    const a = at(xi, yi),     b = at(xi + 1, yi);
    const c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
  };
}

/* The tile field: a fine ground lattice plus sparse tiles that CLUSTER.
 * Two scales, because the reference has both: a dense grid providing
 * texture, and tiles an order of magnitude larger sitting in it. */
export function tileField({ cols = 46, rows = 34, fill = 0.055,
                            scale = 0.22, seed = 5 } = {}) {
  const noise = valueNoise(seed);
  const cells = [], tiles = [];
  for (let b = 0; b < rows; b++) {
    for (let a = 0; a < cols; a++) {
      const u = a - cols / 2, v = b - rows / 2;
      cells.push([u, v]);
      // Correlated field, so tiles above the threshold come out adjacent.
      if (noise(a * scale, b * scale) > 1 - fill * 6) tiles.push([u, v]);
    }
  }
  return { cells, tiles };
}
