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
 * their "distortion under load" plate is: light bent around something heavy.
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
