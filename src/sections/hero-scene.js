/* The hero scene: one pinned block, twelve viewports tall, that carries the
 * hero, the logo wall, the trace wall, the lattice and the mark.
 *
 * REBUILT 2026-10-03 FROM THEIR SHIPPED CODE, NOT FROM SCREENSHOTS.
 *
 * The previous version was a hand-fitted reading of their scroll: windows
 * guessed from samples every 600px, a caption at x=16, no lead paragraphs,
 * failures that lit for a few hundred pixels, and a separate 1000svh run
 * sitting AFTER the hero. Their chunk 768 holds the whole scene as one
 * component and chunk 598 holds every constant, so the mechanism here is
 * theirs and everything a visitor reads (copy, failure labels, IDs, the mark
 * the voxels build) is ours. Their logo, their logo voxel mask and their
 * customer list are not used.
 *
 * What the code said that the samples never could:
 *
 *   one progress value N over the whole 1200vh block, lerped at 0.2 a frame
 *   four phases on N           intro 0-0.055, failures 0.138-0.505,
 *                              traces 0.533-0.734, solution 0.762-1
 *   six beats INSIDE failures  solid->outline, light up, go dark, narrow,
 *                              become diamonds, land on the lattice
 *   a sweep that is TIMED, not scrolled: 1800ms, once per entry to traces
 *   captions that wipe on a clip-path driven by N, not by a timer
 *   the counter is not a count: six digit reels spinning forever, blurred
 */
import { mountIntro } from "./hero-intro.js";
import { attachMeshToSvgFaces, MESH_COLORS } from "./mesh-gradient.js";

const NS = "http://www.w3.org/2000/svg";
const ACCENT = "#755CFE";
const RED = "#EE5557";
const TOPS = ["#322C8A", "#1D1956", "#5D4EE7"];
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Block height in viewports, and the follower rate. 12 and 0.2 are theirs:
 * 10800px at 900 tall, which is the hero height every measurement here has
 * reported, and `o.current += delta * 0.2` in their progress hook. */
const VIEWPORTS = 12;
const FOLLOW = 0.2;

const PHASE = {
  intro: { start: 0, end: 0 },
  failures: { start: 0.138, end: 0.505 },
  traces: { start: 0.533, end: 0.734 },
  solution: { start: 0.762, end: 1 },
};
const INTRO_SPAN = 0.055;
const LOGO_IN = { start: 0.028, span: 0.047 };
const LOGO_OUT = { start: 0.103, span: 0.047 };
const RISE = { start: 0.127, span: 0.039 };
const CAP_A_IN = { start: 0.171, span: 0.041 };

/* World units. The stage draws in a 2400 x 1500 box anchored to the bottom
 * of an 80vh area, so at 1440x900 one unit is 0.48px and a 130-unit brick is
 * the 62px everyone measured. */
const VIEWBOX = "-1200 -800 2400 1500";
const VIEWBOX_NARROW = "-750 -800 1500 1500";
const TILE_W = 70,
  TILE_H = 35,
  GRID_Y = 100,
  GRID_N = 22;
const SQUARE = 130,
  BRICK_H = 130,
  ROW_PITCH = 146,
  GAP = 16,
  TOP_ROW = -488;

/* Four widths in a fixed sequence per row, rows alternating 40 left and 40
 * right of centre. Same palette that was measured off the wall on 09-28 and
 * that their constants confirm exactly. */
const ROWS = [
  [320, 460, 380, 410, 320, 410],
  [410, 380, 320, 460, 320, 460],
  [380, 460, 380, 320, 410, 320],
  [320, 460, 380, 320, 410, 380],
  [460, 320, 380, 460, 320, 380],
  [380, 410, 320, 380, 460, 320],
  [320, 380, 460, 320, 380, 460],
];

/* Ours, in our words, on THEIR nine cells. The cells are layout and come
 * from their 598 constants; the words are ours. A brick's lit width is
 * max(14.4 * label, 15.6 * (example + 2)) + 104, so each example is held to
 * the length of theirs in the same cell. Our earlier cells put a 37
 * character example at the end of row 2, and that brick widened past the
 * wall's right edge and off the screen. */
const FAILURES = [
  { row: 0, col: 4, label: "WRONG TOOL", example: "Refunded to check a balance" },
  { row: 1, col: 2, label: "LOOPING", example: "Asked for it 4 times" },
  { row: 0, col: 1, label: "MADE IT UP", example: "Our warranty covers floods" },
  { row: 1, col: 5, label: "SKIPPED STEP", example: "Closed it before a reply" },
  { row: 2, col: 4, label: "STALE CONTEXT", example: "Quoted last year's rates" },
  { row: 3, col: 1, label: "GAVE UP", example: "Let me get you a human" },
  { row: 4, col: 0, label: "POLICY BREACH", example: "Promised a refund after 60 days" },
  { row: 5, col: 4, label: "LOST THE THREAD", example: "Which account did you mean?" },
  { row: 6, col: 2, label: "UNSAFE ACTION", example: "Deleted the draft unasked" },
];

/* The mark the voxels build is OUR header logo laid on the lattice: a square
 * plate and two chevrons beneath it, the same three layers the brand svg
 * draws. Cells are (i, j) on the isometric grid. */
function markCells() {
  const out = new Map();
  const add = (i, j) => out.set(`${i},${j}`, { i, j });
  for (let i = -7; i <= -2; i++) for (let j = -7; j <= -2; j++) add(i, j);
  for (const k of [1, 2])
    for (let t = -7; t <= 2; t++) {
      add(k, t);
      add(t, k);
    }
  for (const k of [5, 6])
    for (let t = -7; t <= 6; t++) {
      add(k, t);
      add(t, k);
    }
  return [...out.values()].map((c) => ({
    ...c,
    delay: Math.abs(c.i + 2) + Math.abs(c.j + 2),
  }));
}

const EXTRUDE = 38,
  HOVER_EXTRUDE = 55;
const CELL_STEP = 0.02,
  CELL_SPAN = 0.25;

/* The sweep across the lattice. Timed, from -2000 to 2200 in 1800ms, cubes
 * rising as cos^2 of distance from the crest to at most 60 units. */
const SWEEP_MS = 1800,
  SWEEP_HALF = 600,
  SWEEP_MAX = 60,
  SWEEP_FROM = -2000,
  SWEEP_TO = 2200;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (v, a, b) => clamp((v - a) / (b - a));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
/* 1 inside [a, b], ramping over `edge` either side. Their window function. */
const windowed = (v, a, b, edge = 0.05) =>
  v < a - edge || v > b + edge
    ? 0
    : v < a
      ? (v - (a - edge)) / edge
      : v > b
        ? Math.max(0, 1 - (v - b) / edge)
        : 1;

const svgEl = (n, attrs = {}) => {
  const e = document.createElementNS(NS, n);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const diamond = (cx, cy) =>
  `M ${cx},${cy - TILE_H / 2} L ${cx + TILE_W / 2},${cy} L ${cx},${cy + TILE_H / 2} L ${cx - TILE_W / 2},${cy} Z`;
const tileXY = (i, j) => [
  ((i - j) * TILE_W) / 2,
  ((i + j) * TILE_H) / 2 + GRID_Y,
];

function cubeFaces(cx, cy, h) {
  const o = { x: cx, y: cy - TILE_H / 2 - h },
    n = { x: cx + TILE_W / 2, y: cy - h },
    r = { x: cx, y: cy + TILE_H / 2 - h },
    l = { x: cx - TILE_W / 2, y: cy - h },
    s = { x: cx + TILE_W / 2, y: cy },
    u = { x: cx, y: cy + TILE_H / 2 },
    w = { x: cx - TILE_W / 2, y: cy };
  const P = (pts) =>
    "M " +
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ") +
    " Z";
  return {
    top: P([o, n, r, l]),
    left: P([l, r, u, w]),
    right: P([r, n, s, u]),
  };
}

/* Mulberry32: a 32-bit seeded generator, so the brick landing spots are the
 * same on every load. A different seed from theirs, so a different scatter. */
function rng(seed) {
  let t = seed;
  return () => {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let a = Math.imul(t ^ (t >>> 15), 1 | t);
    a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBricks() {
  const bricks = [];
  ROWS.forEach((widths, row) => {
    const total = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * GAP;
    let x = -total / 2 + (row % 2 === 0 ? 40 : -40);
    widths.forEach((w, col) => {
      const y = TOP_ROW + row * ROW_PITCH;
      bricks.push({
        row,
        col,
        x,
        y,
        w,
        cx: x + w / 2,
        cy: y + BRICK_H / 2,
        fail: FAILURES.findIndex((f) => f.row === row && f.col === col),
      });
      x += w + GAP;
    });
  });
  /* Each brick lands on a lattice tile near where it stood, compressed into
   * the plane, nudged randomly so the landing reads as scattered rather than
   * as the wall projected, and never two on one tile. */
  const maxCx = bricks.reduce((m, b) => Math.max(m, Math.abs(b.cx)), 1);
  const rand = rng(51973),
    used = new Set();
  return bricks.map((b) => {
    const targetY = GRID_Y - 480 + 100 * b.row;
    const reach = Math.min(
      1000 / (TILE_W / 2),
      2 * GRID_N - Math.abs(targetY - GRID_Y) / (TILE_H / 2) - 6,
    );
    const u = (b.cx * (((TILE_W / 2) * reach) / maxCx)) / (TILE_W / 2),
      v = (targetY - GRID_Y) / (TILE_H / 2);
    let i = Math.round((u + v) / 2),
      j = Math.round((v - u) / 2);
    for (let k = 0; k < 40; k++) {
      const ci = i + Math.round(-3 + 6 * rand()),
        cj = j + Math.round(-3 + 6 * rand());
      if (Math.abs(ci) > GRID_N || Math.abs(cj) > GRID_N) continue;
      const [tx, ty] = tileXY(ci, cj);
      if (
        Math.abs(tx) > 1000 ||
        ty < -500 ||
        ty > 550 ||
        used.has(`${ci},${cj}`)
      )
        continue;
      i = ci;
      j = cj;
      break;
    }
    used.add(`${i},${j}`);
    const [tx, ty] = tileXY(i, j);
    return { ...b, ti: i, tj: j, tx, ty };
  });
}

/* A failure brick widens to fit what it has to say. Their formula: the wider
 * of the label at 14.4 a character and the quote at 15.6, plus 104 of
 * padding, never narrower than the brick already is. */
const failWidth = (f, w) =>
  Math.max(
    w,
    Math.max(14.4 * f.label.length, (f.example.length + 2) * 15.6) + 104,
  );
const brickId = (row, col) =>
  "RUN-" +
  (((6 * row + col) * 53 + 29) % 4096)
    .toString(16)
    .toUpperCase()
    .padStart(3, "0");

/* Caption wipe. Entering, it uncovers left to right; leaving, it is eaten
 * from the left. Cubic ease-out on both. */
function capClip(entry, exit) {
  if (exit >= 1 || entry <= 0) return "inset(0 0 0 100%)";
  if (exit > 0)
    return `inset(0 0 0 ${(100 * easeOut(clamp(exit))).toFixed(2)}%)`;
  return `inset(0 ${((1 - easeOut(clamp(entry))) * 100).toFixed(2)}% 0 0)`;
}

/* Digit reels. Six columns, each spinning through 0-9 forever at its own
 * rate, the slow ones sharp and the fast ones blurred. The number is never
 * meant to be read, which is the point: it is too many to count. */
function reels() {
  const h = Math.sqrt(1.5);
  const cols = [3, 8, 0, 6, 1, 9].map((start, t) => {
    const a = h ** (5 - t);
    return {
      start,
      dur: Math.round(900 * a),
      blur: +(2.6 / a).toFixed(2),
      delay: 160 * t,
    };
  });
  return (
    `<span class="hs-count" aria-label="hundreds of thousands of">` +
    cols
      .map((c, t) => {
        const digits = Array.from({ length: 11 }, (_, k) => (c.start + k) % 10)
          .map((d) => `<span>${d}</span>`)
          .join("");
        return (
          (t === 3 ? `<span aria-hidden="true">,</span>` : "") +
          `<span class="hs-reel-win" aria-hidden="true"><span class="hs-reel" style="animation-duration:${c.dur}ms;` +
          `animation-delay:-${c.delay}ms;filter:url(#hs-blur-${t})">${digits}</span>` +
          `<svg width="0" height="0" style="position:absolute"><filter id="hs-blur-${t}" x="-10%" y="-30%" width="120%" height="160%">` +
          `<feGaussianBlur stdDeviation="0 ${c.blur}"/></filter></svg></span>`
        );
      })
      .join("") +
    `</span>`
  );
}

/* The logo wall's own marks. Invented names, our own glyphs. */
const MARKS = [
  ["Quenta", '<circle cx="9" cy="9" r="7"/><circle cx="9" cy="9" r="2.6"/>'],
  ["Volarix", '<path d="M9 2.4 16 15H2z"/>'],
  [
    "Miretta",
    '<rect x="2.4" y="2.4" width="13.2" height="13.2"/><rect x="6.4" y="6.4" width="5.2" height="5.2"/>',
  ],
  ["Halden", '<path d="M3 6.2 9 2.6l6 3.6M3 11.8 9 15.4l6-3.6"/>'],
  ["Pellum", '<path d="M2 9h14M9 2v14"/><circle cx="9" cy="9" r="4"/>'],
  ["Orbica", '<circle cx="6" cy="9" r="4"/><circle cx="12" cy="9" r="4"/>'],
  ["Tundrel", '<path d="M2 14 7 4l4 7 2-3 3 6z"/>'],
  ["Cavasi", '<path d="M9 2 16 9 9 16 2 9z"/>'],
  ["Wexley", '<path d="M2 4l3.5 10L9 6l3.5 8L16 4"/>'],
  ["Ostara", '<path d="M9 2v14M3 5.5l12 7M15 5.5l-12 7"/>'],
];
const MARK_BLURBS = [
  "Agent runtime",
  "Retrieval layer",
  "Eval harness",
  "Prompt registry",
  "Tool gateway",
  "Vector store",
  "Trace pipeline",
  "Policy checks",
  "Session replay",
  "Model router",
];

function logoWallHTML() {
  const LAYOUT = [
    [0, 1, 2, 3],
    [4, null, 5],
    [6, 7, 8, 9],
  ];
  let k = 0;
  const cells = LAYOUT.flatMap((row, r) =>
    row.map((m, c) => {
      const cls = [
        "hs-lw-cell",
        r > 0 ? "bt" : "",
        c > 0 ? "bl" : "",
        m === null ? "span2" : "",
      ].join(" ");
      const idx = k;
      k += m === null ? 2 : 1;
      if (m === null)
        return `<div class="${cls}" data-k="${idx}" data-r="${r}"><p class="hs-lw-label">Running in production at</p></div>`;
      const [name, glyph] = MARKS[m];
      return (
        `<div class="${cls}" data-k="${idx}" data-r="${r}"><a class="hs-lw-mark" href="#" aria-label="${name}">` +
        `<svg viewBox="0 0 18 18" aria-hidden="true">${glyph}</svg><span>${name}</span></a>` +
        `<span class="hs-lw-tip" aria-hidden="true">${MARK_BLURBS[m]}</span></div>`
      );
    }),
  ).join("");
  return `<div class="hs-lw-band"><div class="hs-lw-grid">${cells}</div></div>`;
}

export function mountHeroScene(run) {
  const pin = run.querySelector(".hs-pin");
  const hero = run.querySelector(".hero");
  const introExit = mountIntro(hero);
  const wall = run.querySelector(".hs-logos");
  wall.innerHTML = logoWallHTML();
  const wallClip = wall.querySelector(".hs-lw-band");
  const wallCells = [...wall.querySelectorAll(".hs-lw-cell")];

  const caps = run.querySelectorAll(".hs-cap");
  const [capA, capB, capC] = caps;
  capB.querySelector(".hs-reels").outerHTML = reels();

  if (REDUCED) {
    run.classList.add("hs-static");
    return;
  }

  const stage = run.querySelector(".hs-stage");
  const rise = stage.querySelector(".hs-rise");
  const svg = svgEl("svg", {
    class: "hs-svg",
    viewBox: VIEWBOX,
    preserveAspectRatio: "xMidYMax meet",
  });
  rise.appendChild(svg);
  const canvas = document.createElement("canvas");
  canvas.className = "hs-canvas";
  canvas.setAttribute("aria-hidden", "true");
  rise.appendChild(canvas);

  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", {
    id: "hs-top",
    gradientUnits: "userSpaceOnUse",
    x1: -1200,
    y1: -800,
    x2: 1200,
    y2: 700,
  });
  [
    ["0%", TOPS[1]],
    ["52%", TOPS[2]],
    ["100%", TOPS[0]],
  ].forEach(([o, c]) =>
    grad.appendChild(svgEl("stop", { offset: o, "stop-color": c })),
  );
  /* The tops carry a slow drift through the gradient so the mark is alive
   * while it holds. Theirs runs a WebGL mesh gradient here; a rotating SVG
   * gradient is the same idea at a fraction of the cost. */
  grad.appendChild(
    svgEl("animateTransform", {
      attributeName: "gradientTransform",
      type: "rotate",
      from: "0 0 100",
      to: "360 0 100",
      dur: "24s",
      repeatCount: "indefinite",
    }),
  );
  defs.appendChild(grad);
  svg.appendChild(defs);

  const gGrid = svgEl("g");
  const gBricks = svgEl("g");
  const gMark = svgEl("g");
  const gHover = svgEl("g", { "pointer-events": "none" });
  svg.append(gGrid, gBricks, gMark, gHover);

  /* The lattice: 45 x 45 tiles, each faded by distance from the centre. */
  for (let i = -GRID_N; i <= GRID_N; i++)
    for (let j = -GRID_N; j <= GRID_N; j++) {
      const [cx, cy] = tileXY(i, j);
      const op = Math.max(
        0.1,
        Math.min(0.42, 0.45 - Math.hypot(cx, cy - GRID_Y - 100) / 2000),
      );
      gGrid.appendChild(
        svgEl("path", {
          d: diamond(cx, cy),
          stroke: ACCENT,
          "stroke-width": 0.6,
          fill: "none",
          opacity: op.toFixed(3),
        }),
      );
    }

  const bricks = buildBricks();
  const brickNodes = bricks.map((b) => {
    const g = svgEl("g");
    const rect = svgEl("rect", {
      height: BRICK_H,
      "stroke-width": 2,
      stroke: ACCENT,
    });
    const poly = svgEl("polygon", {
      fill: ACCENT,
      stroke: ACCENT,
      style: "display:none",
    });
    g.append(rect, poly);
    let id = null,
      lab = null,
      quote = null,
      words = null;
    if (b.fail < 0) {
      id = svgEl("text", {
        "font-size": 20,
        "font-family": "IBM Plex Mono, monospace",
        "letter-spacing": 1.5,
        fill: ACCENT,
      });
      id.textContent = brickId(b.row, b.col);
      g.appendChild(id);
    } else {
      const f = FAILURES[b.fail];
      words = svgEl("g");
      lab = svgEl("text", {
        "font-size": 20,
        "font-family": "IBM Plex Mono, monospace",
        "font-weight": 500,
        fill: "white",
        "letter-spacing": 2,
      });
      lab.textContent = f.label;
      quote = svgEl("text", {
        "font-size": 30,
        "font-family": "Figtree, sans-serif",
        fill: "white",
      });
      quote.textContent = `“${f.example}”`;
      words.append(lab, quote);
      g.appendChild(words);
    }
    gBricks.appendChild(g);
    return { b, g, rect, poly, id, lab, quote, words };
  });

  const MARK = markCells();
  const markNodes = MARK.map((c) => {
    const g = svgEl("g", { style: "display:none" });
    const base = svgEl("path", {
      fill: ACCENT,
      "fill-opacity": 0.15,
      stroke: ACCENT,
      "stroke-width": 1.2,
    });
    const left = svgEl("path", {
      fill: "white",
      stroke: ACCENT,
      "stroke-width": 1.2,
    });
    const right = svgEl("path", {
      fill: "white",
      stroke: ACCENT,
      "stroke-width": 1.2,
    });
    const top = svgEl("path", {
      fill: "url(#hs-top)",
      stroke: ACCENT,
      "stroke-width": 1.2,
    });
    g.append(base, left, right, top);
    return { c, g, base, left, right, top };
  });
  /* Painter's order: back to front along i + j, fixed once. */
  markNodes
    .sort((a, b) => a.c.i + a.c.j - (b.c.i + b.c.j))
    .forEach((m) => gMark.appendChild(m.g));
  /* Theirs: one foreignObject over the stage box holding a mesh gradient,
   * clipped to every visible top face. Null without WebGL, and the
   * url(#hs-top) fill underneath stays as the fallback. */
  const meshTops = attachMeshToSvgFaces(gMark, [-1200, -800, 2400, 1500], { colors: MESH_COLORS });

  /* ---- the sweep, on a canvas because it redraws 2000 tiles a frame ---- */
  const landed = new Set(bricks.map((b) => `${b.ti},${b.tj}`));
  const sweepTiles = [];
  for (let i = -GRID_N; i <= GRID_N; i++)
    for (let j = -GRID_N; j <= GRID_N; j++) {
      const [cx, cy] = tileXY(i, j);
      sweepTiles.push({ i, j, cx, cy });
    }
  sweepTiles.sort((a, b) => a.i + a.j - (b.i + b.j));
  const ctx = canvas.getContext("2d");
  let sweepRaf = 0,
    sweepT0 = 0,
    accent = 1,
    map = null;
  function sizeCanvas() {
    const w = canvas.offsetWidth,
      h = canvas.offsetHeight,
      dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const [vx, vy, vw, vh] = svg.getAttribute("viewBox").split(" ").map(Number);
    const narrow = vw < 2000,
      s = Math.min(w / vw, h / vh);
    map = {
      dpr,
      s,
      ox: (w - vw * s) / 2,
      oy: (h - vh * s) * (narrow ? 0.5 : 1),
      vx,
      vy,
    };
  }
  const X = (x) => map.ox + (x - map.vx) * map.s,
    Y = (y) => map.oy + (y - map.vy) * map.s;
  function sweepFrame(now) {
    const t = Math.min(1, (now - sweepT0) / SWEEP_MS),
      crest = SWEEP_FROM + t * (SWEEP_TO - SWEEP_FROM);
    ctx.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = map.s;
    ctx.lineJoin = "round";
    for (const e of sweepTiles) {
      const d = Math.abs(e.cx - crest);
      if (d >= SWEEP_HALF) continue;
      const h = Math.cos(((d / SWEEP_HALF) * Math.PI) / 2) ** 2 * SWEEP_MAX;
      if (h < 0.5) continue;
      const f = cubeFaces(e.cx, e.cy, h);
      for (const [key, path] of [
        ["l", f.left],
        ["r", f.right],
        ["t", f.top],
      ]) {
        const p = new Path2D();
        const pts = path
          .slice(2, -2)
          .split(" L ")
          .map((s) => s.split(",").map(Number));
        pts.forEach(([x, y], k) =>
          k ? p.lineTo(X(x), Y(y)) : p.moveTo(X(x), Y(y)),
        );
        p.closePath();
        if (key === "t" && accent > 0.01 && landed.has(`${e.i},${e.j}`)) {
          ctx.fillStyle = "#F2F2F2";
          ctx.fill(p);
          ctx.fillStyle = `rgba(117,92,254,${(0.15 * accent).toFixed(3)})`;
          ctx.fill(p);
        } else {
          ctx.fillStyle = "white";
          ctx.fill(p);
        }
        ctx.stroke(p);
      }
    }
    if (t < 1) sweepRaf = requestAnimationFrame(sweepFrame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  let inTraces = false;
  function setTraces(on) {
    if (on === inTraces) return;
    inTraces = on;
    cancelAnimationFrame(sweepRaf);
    canvas.style.display = on ? "block" : "none";
    if (on) {
      sizeCanvas();
      sweepT0 = performance.now();
      sweepRaf = requestAnimationFrame(sweepFrame);
    }
  }

  /* ---- hover: the tile under the pointer rises, on the lattice only ---- */
  const lifted = new Map();
  let hoverTarget = null,
    pointer = null,
    follow = null,
    hoverRaf = 0,
    hoverOn = false;
  svg.addEventListener("pointermove", (e) => {
    if (!hoverOn) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return;
    const q = pt.matrixTransform(m.inverse());
    pointer = { x: q.x, y: q.y };
    follow ||= { ...pointer };
  });
  svg.addEventListener("pointerleave", () => {
    pointer = follow = null;
    hoverTarget = null;
  });
  function hoverFrame() {
    if (pointer && follow) {
      follow.x += 0.18 * (pointer.x - follow.x);
      follow.y += 0.18 * (pointer.y - follow.y);
      const u = follow.x / (TILE_W / 2),
        v = (follow.y - GRID_Y) / (TILE_H / 2);
      const i = Math.round((u + v) / 2),
        j = Math.round((v - u) / 2);
      hoverTarget =
        Math.abs(i) <= GRID_N && Math.abs(j) <= GRID_N ? `${i},${j}` : null;
    }
    for (const [k, c] of lifted)
      c.target = k === hoverTarget ? HOVER_EXTRUDE : 0;
    if (hoverTarget && !lifted.has(hoverTarget)) {
      const [i, j] = hoverTarget.split(",").map(Number);
      lifted.set(hoverTarget, { i, j, ext: 0, target: HOVER_EXTRUDE });
    }
    gHover.replaceChildren();
    [...lifted.entries()]
      .sort((a, b) => a[1].i + a[1].j - (b[1].i + b[1].j))
      .forEach(([k, c]) => {
        c.ext += (c.target - c.ext) * 0.1;
        if (c.target === 0 && c.ext < 0.1) {
          lifted.delete(k);
          return;
        }
        const [cx, cy] = tileXY(c.i, c.j),
          f = cubeFaces(cx, cy, c.ext);
        for (const d of [f.left, f.right, f.top])
          gHover.appendChild(
            svgEl("path", {
              d,
              fill: "white",
              stroke: ACCENT,
              "stroke-width": 1,
            }),
          );
      });
    hoverRaf = requestAnimationFrame(hoverFrame);
  }
  function setHover(on, op) {
    gHover.setAttribute("opacity", op.toFixed(3));
    svg.style.pointerEvents = on ? "auto" : "none";
    if (on === hoverOn) return;
    hoverOn = on;
    if (on) hoverRaf = requestAnimationFrame(hoverFrame);
    else {
      cancelAnimationFrame(hoverRaf);
      lifted.clear();
      gHover.replaceChildren();
      pointer = follow = null;
    }
  }

  /* ---- one render, from one progress value ---- */
  function render(N) {
    /* Logo wall. Cells rise in 0.05 apart, the band clips open from the
     * bottom, and it leaves upward by 320px while its lower edge is cut.
     * The whole exit runs on ONE cubic ease-in, t*t*t in their 598 chunk:
     * rise, clip, per-row offset and fade. Three of the four were on an
     * ease-out here, so at 1050px of scroll ours was already half gone
     * while theirs had barely started. */
    const enter = clamp((N - LOGO_IN.start) / LOGO_IN.span);
    const exit = clamp((N - LOGO_OUT.start) / LOGO_OUT.span);
    const inE = easeOut(enter),
      outI = easeIn(exit);
    const wallOp = inE * (1 - outI);
    wall.style.display = wallOp <= 0 ? "none" : "";
    wall.style.opacity = wallOp.toFixed(3);
    wall.style.transform = `translateY(${(-320 * outI).toFixed(2)}px)`;
    wall.style.pointerEvents = wallOp > 0.7 ? "auto" : "none";
    wallClip.style.clipPath =
      exit > 0
        ? `inset(0 0 ${(100 * outI).toFixed(2)}% 0)`
        : `inset(${((1 - easeOut(clamp(enter / 0.25))) * 100).toFixed(2)}% 0 0 0)`;
    const span = 1 - 0.05 * (MARKS.length - 1);
    for (const cell of wallCells) {
      const k = +cell.dataset.k,
        r = +cell.dataset.r;
      const c = easeOut(clamp((inE - 0.05 * k) / span));
      cell.style.opacity = c.toFixed(3);
      cell.style.transform = `translateY(${((1 - c) * 26 - outI * (2 - r) * 40).toFixed(2)}px)`;
    }

    /* The failures phase and its six beats, each a slice of local progress. */
    const V = prog(N, PHASE.failures.start, PHASE.failures.end);
    const beat2 = clamp((V - 0.2) / 0.08); // solid -> outline
    const beat3 = clamp((V - 0.4) / 0.08); // the nine light up and widen
    const beat4a = clamp((V - 0.62) / 0.06); // they go dark again
    const beat4b = clamp((V - 0.68) / 0.08); // every brick narrows to a square
    const beat4c = clamp((V - 0.76) / 0.09); // squares become lattice diamonds
    const beat4d = clamp((V - 0.85) / 0.08); // and land on their tiles
    const S = windowed(N, PHASE.failures.start, PHASE.failures.end);
    const E = windowed(N, PHASE.traces.start, PHASE.traces.end);
    const T = windowed(N, PHASE.solution.start, PHASE.solution.end);
    const F = windowed(N, PHASE.intro.start, PHASE.intro.end, INTRO_SPAN);
    introExit(N);
    const melt = prog(N, PHASE.traces.start, PHASE.traces.end);
    const gridOp = Math.max(
      (S > 0) * clamp((V - 0.93) / 0.07),
      windowed(N, PHASE.traces.start, PHASE.solution.end),
    );

    /* The stage rises in from a full viewport below, and during traces it
     * drops 120px while its top edge fades, so the lattice reads as ground. */
    const W = easeOut(clamp((N - RISE.start) / RISE.span));
    rise.style.transform =
      W < 1 ? `translateY(${((1 - W) * 100).toFixed(2)}vh)` : "";
    const U = clamp((N - PHASE.traces.start) / 0.05);
    stage.style.transform = `translateY(${(120 * U).toFixed(1)}px)`;
    const mask =
      `linear-gradient(to bottom, rgba(0,0,0,${(1 - U).toFixed(3)}) 0px, ` +
      `rgba(0,0,0,${(1 - 0.75 * U).toFixed(3)}) ${(20 * U).toFixed(1)}%, rgba(0,0,0,1) ${(45 * U).toFixed(1)}%)`;
    stage.style.maskImage = stage.style.webkitMaskImage = mask;
    stage.style.display = N > 0.005 ? "" : "none";

    gGrid.setAttribute("opacity", gridOp.toFixed(3));
    gGrid.style.display = gridOp > 0 ? "" : "none";

    /* Bricks. Within a row, a widening failure pushes its neighbours apart
     * by half its growth each way, so the row stays centred. */
    const showBricks = F > 0 || S > 0 || E > 0 || T > 0;
    gBricks.style.display = showBricks ? "" : "none";
    if (showBricks) {
      const keep = 1 - beat4b,
        grow = easeOut(beat3 * (1 - beat4a));
      const shifts = new Map();
      for (const n of brickNodes) {
        const b = n.b;
        if (b.fail < 0 || keep <= 0 || grow <= 0) continue;
        const amount =
          (lerp(b.w, failWidth(FAILURES[b.fail], b.w), grow) - b.w) * keep;
        if (amount > 0)
          (shifts.get(b.row) || shifts.set(b.row, []).get(b.row)).push({
            col: b.col,
            amount,
          });
      }
      /* Under 768 theirs keeps every failure and every other healthy brick,
         so the wall still reads as a wall in a 1500-unit-wide box. */
      const narrow = innerWidth < 768;
      for (const [idx, n] of brickNodes.entries()) {
        const b = n.b,
          f = b.fail >= 0 ? FAILURES[b.fail] : null;
        n.g.style.display = narrow && !f && idx % 2 !== 0 ? "none" : "";
        const dx = (shifts.get(b.row) || []).reduce(
          (s, t) =>
            b.col === t.col
              ? s
              : s + (b.col < t.col ? -t.amount / 2 : t.amount / 2),
          0,
        );
        const lit = beat3 * (1 - beat4a);
        const isLit = f !== null && lit > 0;
        const fillOp = f ? lit : Math.max(0, 1 - beat2 - beat4a * (1 - beat2));
        const strokeOp = Math.max(
          beat2 * (1 - (f ? lit : 0)),
          (f ? 1 : 0) * beat4a,
        );
        const wide = f ? failWidth(f, b.w) : b.w;
        const k = f ? easeOut(f ? lit : 0) : 0;
        const w0 = f ? lerp(b.w, wide, k) : b.w;
        const w = lerp(w0, SQUARE, beat4b);
        const rx = (f ? lerp(6, 10, k) : 6) * (1 - beat4b);
        const cx = lerp(b.cx + dx, b.tx + dx, beat4d),
          cy = lerp(b.cy, b.ty, beat4d);
        const x = cx - w / 2,
          y = cy - BRICK_H / 2;

        if (beat4c > 0) {
          n.rect.style.display = "none";
          n.poly.style.display = "";
          if (n.id) n.id.style.display = "none";
          if (n.words) n.words.style.display = "none";
          const J = SQUARE / 2,
            R = [
              [0, -TILE_H / 2],
              [TILE_W / 2, 0],
              [0, TILE_H / 2],
              [-TILE_W / 2, 0],
            ];
          const pts = [
            [-J, -J],
            [J, -J],
            [J, J],
            [-J, J],
          ]
            .map(
              ([a, c], t) =>
                `${(lerp(a, R[t][0], beat4c) + cx).toFixed(2)},${(lerp(c, R[t][1], beat4c) + cy).toFixed(2)}`,
            )
            .join(" ");
          n.poly.setAttribute("points", pts);
          n.poly.setAttribute(
            "fill-opacity",
            (0.15 * beat4c * (1 - melt)).toFixed(3),
          );
          n.poly.setAttribute("stroke-width", lerp(2, 0.6, melt).toFixed(2));
          n.poly.setAttribute("stroke-opacity", lerp(1, 0.35, melt).toFixed(3));
          continue;
        }
        n.rect.style.display = "";
        n.poly.style.display = "none";
        n.rect.setAttribute("x", x.toFixed(1));
        n.rect.setAttribute("y", y.toFixed(1));
        n.rect.setAttribute("width", w.toFixed(1));
        n.rect.setAttribute("rx", rx.toFixed(2));
        n.rect.setAttribute("fill", isLit ? RED : ACCENT);
        n.rect.setAttribute("fill-opacity", fillOp.toFixed(3));
        n.rect.setAttribute("stroke-opacity", strokeOp.toFixed(3));
        if (n.id) {
          const o = 0.6 * beat2 * (1 - beat4a);
          const on = o > 0.01 && w > 200;
          n.id.style.display = on ? "" : "none";
          if (on) {
            n.id.setAttribute("x", (x + 24).toFixed(1));
            n.id.setAttribute("y", (y + 48).toFixed(1));
            n.id.setAttribute("opacity", o.toFixed(3));
          }
        }
        if (n.words) {
          const on = lit > 0 && w > 240;
          n.words.style.display = on ? "" : "none";
          if (on) {
            n.words.setAttribute("opacity", lit.toFixed(3));
            n.lab.setAttribute("x", (x + 52).toFixed(1));
            n.lab.setAttribute("y", (y + 48).toFixed(1));
            n.quote.setAttribute("x", (x + 52).toFixed(1));
            n.quote.setAttribute("y", (y + 90).toFixed(1));
          }
        }
      }
    }

    /* The mark. Each cell rises after a delay set by its distance from the
     * centre, so the shape grows outward rather than appearing. */
    const sol = prog(N, PHASE.solution.start, PHASE.solution.end);
    gMark.style.display = T > 0 ? "" : "none";
    if (T > 0)
      for (const m of markNodes) {
        const a = 0.05 + m.c.delay * CELL_STEP;
        const ext = easeOut(clamp((sol - a) / CELL_SPAN)) * EXTRUDE;
        if (ext <= 0.1) {
          m.g.style.display = "none";
          continue;
        }
        m.g.style.display = "";
        const [cx, cy] = tileXY(m.c.i, m.c.j),
          f = cubeFaces(cx, cy, ext);
        m.base.setAttribute("d", diamond(cx, cy));
        m.left.setAttribute("d", f.left);
        m.right.setAttribute("d", f.right);
        m.top.setAttribute("d", f.top);
      }
    if (T > 0)
      meshTops?.sync(
        markNodes.filter((m) => m.g.style.display !== "none").map((m) => m.top.getAttribute("d")),
      );

    accent = 1 - melt;
    setTraces(N >= PHASE.traces.start && N <= PHASE.traces.end);
    setHover(
      gridOp > 0 &&
        N <
          PHASE.solution.start +
            (PHASE.solution.end - PHASE.solution.start) * 0.05,
      gridOp,
    );

    /* Captions. A leaves when the failures go dark; B spans traces; C stays
     * until the block unpins and carries it away. */
    const capB_in = clamp((N - PHASE.traces.start) / 0.04),
      capB_out = clamp((N - (PHASE.traces.end - 0.03)) / 0.03);
    const capC_in = clamp((N - PHASE.solution.start) / 0.04);
    const capA_in = clamp((N - CAP_A_IN.start) / CAP_A_IN.span);
    for (const [cap, a, b] of [
      [capA, capA_in, beat4a],
      [capB, capB_in, capB_out],
      [capC, capC_in, 0],
    ]) {
      const hidden = a <= 0 || b >= 1;
      cap.style.display = hidden ? "none" : "block";
      if (!hidden) cap.style.clipPath = capClip(a, b);
    }
  }

  /* The follower. Scroll sets the target and the scene chases it at 0.2 a
   * frame, which is what gives the brick wall its weight on a flick. */
  let target = 0,
    cur = 0,
    raf = 0;
  const measure = () => {
    const travel = run.offsetHeight - innerHeight;
    target = travel > 0 ? clamp(-run.getBoundingClientRect().top / travel) : 0;
  };
  const frame = () => {
    const d = target - cur;
    if (Math.abs(d) < 8e-5) {
      cur = target;
      render(cur);
      raf = 0;
      return;
    }
    cur += d * FOLLOW;
    render(cur);
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    measure();
    if (!raf) raf = requestAnimationFrame(frame);
  };
  addEventListener("scroll", kick, { passive: true });
  addEventListener("resize", () => {
    const narrow = innerWidth < 768;
    svg.setAttribute("viewBox", narrow ? VIEWBOX_NARROW : VIEWBOX);
    svg.setAttribute(
      "preserveAspectRatio",
      narrow ? "xMidYMid meet" : "xMidYMax meet",
    );
    if (inTraces) sizeCanvas();
    kick();
  });
  if (innerWidth < 768) {
    svg.setAttribute("viewBox", VIEWBOX_NARROW);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }
  measure();
  cur = target;
  render(cur);
}

export const HERO_VIEWPORTS = VIEWPORTS;
