import { harmonograph, sphere, gravlens, chladni, crosshatch, phyllotaxis, toPath } from "./geometry.js";

const STILL = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* ============================================================
   1. SMOOTH SCROLL: removed.
   A lerp toward scrollY wrote a --sy custom property that nothing consumed.
   It burned a requestAnimationFrame every frame of the page's life and moved
   no pixels. Their page runs Lenis for real; a fake one is worse than none,
   because the next person reads the function name and believes it.

   If it comes back it has to actually transform the content and be disabled
   under prefers-reduced-motion, since hijacked scroll is the most
   disorienting thing available to someone who has that set.
   ============================================================ */

/* ============================================================
   2. THE PLATES
   One CSS animation per primitive is where their 214-at-load comes from. Not
   canvas, not a library: a stroke-dashoffset draw per element.

   pathLength=1 normalises every primitive to unit length so one CSS rule
   animates a 3-unit line and a 90-unit arc identically.

   The stagger step is computed per plate against the 400ms ceiling, because a
   1-element figure and a 260-element one cannot share a delay: at a flat 17ms
   the phyllotaxis alone would run 4.4 seconds.
   ============================================================ */
const PLATES = [
  { code: "UX. 1.1", label: "rays under mass",        build: () => ({ polys: gravlens() }) },
  { code: "UX. 1.2", label: "pattern from rotation",  build: () => ({ polys: harmonograph() }) },
  { code: "UX. 1.3", label: "state under tilt",       build: () => ({ polys: sphere() }) },
  { code: "UX. 2.1", label: "where the plate is still", build: () => ({ polys: chladni() }) },
  { code: "UX. 2.2", label: "depth from convergence", build: () => ({ polys: crosshatch() }) },
  { code: "UX. 2.3", label: "every sample, packed",   build: () => ({ dots: phyllotaxis() }) },
];

function renderPlate({ code, label, build }) {
  const { polys = [], dots = [] } = build();
  const n = polys.length + dots.length;
  // (n-1) * step <= 400ms. Cap the delay, never the count.
  const step = n > 1 ? Math.min(0.02, 0.4 / (n - 1)) : 0;

  const fig = document.createElement("figure");
  fig.className = "plate";
  const bar = document.createElement("div");
  bar.className = "plate-bar";
  const box = document.createElement("div");
  box.className = "plate-box";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);

  polys.forEach((p, i) => {
    const el = document.createElementNS(svg.namespaceURI, "path");
    el.setAttribute("d", toPath(p));
    el.setAttribute("pathLength", "1");
    el.style.animationDelay = `${(i % 40) * step}s`;
    svg.append(el);
  });
  dots.forEach((d, i) => {
    const el = document.createElementNS(svg.namespaceURI, "circle");
    el.setAttribute("cx", d.cx.toFixed(2));
    el.setAttribute("cy", d.cy.toFixed(2));
    el.setAttribute("r", d.r.toFixed(2));
    el.style.animationDelay = `${(i % 40) * step}s`;
    svg.append(el);
  });

  box.append(svg);
  const cap = document.createElement("figcaption");
  cap.innerHTML = `<span class="code">${code}</span><span class="label">${label}</span>`;
  fig.append(bar, box, cap);

  // Cursor tilt. transform only, and it settles rather than snapping.
  if (!STILL) {
    fig.addEventListener("pointermove", (e) => {
      const r = fig.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      box.style.transform = `perspective(700px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg)`;
    });
    fig.addEventListener("pointerleave", () => { box.style.transform = ""; });
  }
  return fig;
}

/* Composition, not a scatter. Every value here is a decision:
 *
 *   x/y     position as a percentage of the hero box, which is inset past the
 *           viewport on both sides so a plate can bleed.
 *   w       width in vw. The spread runs 2.4x from largest to smallest,
 *           because equal sizes read as a catalogue and a catalogue has no
 *           focal point.
 *   z       stacking. Pairs are placed to CROSS: 1.2 sits under 1.3, and 2.1
 *           under 2.2. Occlusion is the depth cue.
 *   rot     under a degree. Enough to break the grid, not enough to read as a
 *           tilt effect.
 *
 * The largest plate is top-left against a centred headline, so the eye enters
 * high-left, crosses the type, and exits down-right through the small ones.
 */
const SCATTER = [
  { i: 0, x: "1%",  y: "6%",  w: 25, z: 2, rot: 0     },  // biggest, anchors top-left
  { i: 1, x: "76%", y: "2%",  w: 17, z: 1, rot: 0.6   },  // bleeds off the right
  { i: 2, x: "69%", y: "16%", w: 20, z: 3, rot: -0.4  },  // crosses in front of it
  { i: 3, x: "3%",  y: "60%", w: 15, z: 1, rot: -0.7  },
  { i: 4, x: "11%", y: "70%", w: 19, z: 2, rot: 0.3   },  // crosses in front of 3
  { i: 5, x: "74%", y: "62%", w: 21, z: 2, rot: 0.5   },
];

function mountPlates() {
  const host = document.querySelector(".scatter");
  if (host) {
    for (const s of SCATTER) {
      const fig = renderPlate(PLATES[s.i]);
      fig.style.left = s.x;
      fig.style.top = s.y;
      fig.style.width = `${s.w}vw`;
      fig.style.zIndex = s.z;
      fig.style.rotate = `${s.rot}deg`;
      // Parallax rate comes FROM the plate's apparent depth, so the motion
      // agrees with the occlusion the eye already read. A near plate (large,
      // high z) travels further than a far one. Picking rates by hand is what
      // makes parallax read as a gimmick: the rates disagree with the depth
      // cues and the brain notices before you do.
      //
      // Range is 2px to 14px across the whole run. Val Head's variable is
      // virtual DISTANCE, not duration, and 16 to 32px is a reveal while
      // 400px is a ride. This stays under a reveal on purpose, because six
      // plates moving at once accumulate.
      const depth = (s.w / 25) * 0.6 + (s.z / 3) * 0.4;   // 0..1, near = 1
      fig.dataset.par = (2 + depth * 12).toFixed(1);
      host.append(fig);
    }
  }
  // Scene 3 keeps a small pair, so the motif returns after the pin's trough.
  const small = document.querySelector(".plates-small");
  if (small) [PLATES[2], PLATES[5]].forEach((p) => small.append(renderPlate(p)));
}

/* ============================================================
   3. THE FIELD
   Their trace grid holds 42 rects constant while the text count goes 33 to 51
   and the filled count goes 0 to 9. Nothing animates. Scroll drives state and
   the state decides what has been written, which is why an animation-only
   capture reports the best effect on their page as static.

   One SVG, centred viewBox, brick-offset rows, varying widths.
   ============================================================ */
const VB = { x: -1200, y: -760, w: 2400, h: 1420 };
const CELL = { w: 320, h: 130, r: 6 };
const COLS = 6, ROWS = 7, GAP = 14;

const GHOST = ["transition", "keyframes", "easing", "duration", "delay", "fill-mode",
  "transform", "opacity", "will-change", "timeline", "range", "iteration",
  "cubic-bezier", "steps", "direction", "playState", "currentTime", "startTime",
  "composite", "pseudoElement", "timing", "effect", "target", "pending",
  "replaceState", "overallProgress", "rangeStart", "rangeEnd", "scrollTimeline",
  "viewTimeline", "subject", "axis", "inset", "cover", "contain", "entry", "exit",
  "animationName", "playbackRate"];

const LIT = [
  { at: 9,  tag: "scroll-linked", said: "tracks your scroll, monotonically" },
  { at: 16, tag: "state-swap",    said: "stepped, because the page re-rendered" },
  { at: 26, tag: "constant",      said: "loops on its own clock, ignores you" },
  { at: 33, tag: "spawn",         said: "fired once on arrival, then held" },
];

function layoutField() {
  const litBy = new Map(LIT.map((l) => [l.at, l]));
  const cells = [];
  const rowOffsets = [0, 0.42, 0.18, 0.55, 0.1, 0.36, 0.26];
  let seed = 17;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  for (let r = 0; r < ROWS; r++) {
    let x = VB.x + 110 + rowOffsets[r] * (CELL.w + GAP);
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      if (i >= 42) break;
      const w = CELL.w * (0.8 + rand() * 0.52);
      cells.push({
        i, x, y: VB.y + 130 + r * (CELL.h + GAP), w,
        code: `AN-${(i * 41 + 23).toString(16).toUpperCase().padStart(3, "0").slice(-3)}`,
        ghost: GHOST[i % GHOST.length],
        lit: litBy.get(i),
      });
      x += w + GAP;
    }
  }
  return cells;
}

const FIELD_CELLS = layoutField();

function mountField() {
  const host = document.querySelector(".field");
  if (!host) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label",
    "A field of animation properties. Four of them carry a behaviour label instead: " +
    LIT.map((l) => l.said).join("; ") + ".");

  const made = FIELD_CELLS.map((c) => {
    const g = document.createElementNS(svg.namespaceURI, "g");
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("x", c.x); rect.setAttribute("y", c.y);
    rect.setAttribute("width", c.w); rect.setAttribute("height", CELL.h);
    rect.setAttribute("rx", CELL.r);
    g.append(rect);
    svg.append(g);
    return { ...c, g, rect, texts: [] };
  });

  host.append(svg);
  return { svg, cells: made };
}

function paintField(field, p) {
  if (!field) return;
  // Labels populate across the first 60%; the lit cells bloom over the last
  // 45%, so the answer arrives after the reader has taken in the field.
  const labelled = Math.round(field.cells.length * clamp(p / 0.6));
  const litShown = Math.round(LIT.length * clamp((p - 0.55) / 0.45));
  let seen = 0;

  for (const c of field.cells) {
    const isLit = Boolean(c.lit);
    const on = isLit && seen++ < litShown;
    const hasLabel = c.i < labelled;
    const want = on ? "lit" : hasLabel ? "label" : "bare";
    if (c.state === want) continue;
    c.state = want;

    c.texts.forEach((t) => t.remove());
    c.texts = [];
    c.rect.classList.toggle("on", on);

    const text = (cls, dy, str) => {
      const t = document.createElementNS(c.g.namespaceURI, "text");
      t.setAttribute("class", cls);
      t.setAttribute("x", c.x + 22);
      t.setAttribute("y", c.y + dy);
      t.textContent = str;
      c.g.append(t);
      c.texts.push(t);
    };
    if (want === "label") { text("code", 40, c.code); text("word", 82, c.ghost); }
    if (want === "lit")   { text("tag", 42, c.lit.tag.toUpperCase()); text("said", 86, `"${c.lit.said}"`); }
  }
}

/* ============================================================
   4. THE SCENE MACHINE
   The presence curve needs a PLATEAU, not a peak. A linear falloff from the
   centre means a scene hits full opacity at exactly one scroll position and
   sits at 0.41 everywhere else, so the reader never gets a legible frame.
   ============================================================ */
function sceneMachine(field) {
  const run = document.querySelector(".run");
  const scenes = [...document.querySelectorAll(".scene")];
  const n = scenes.length;
  const rail = document.querySelector(".rail");
  if (rail) rail.innerHTML = scenes.map(() => "<i></i>").join("");
  const ticks = rail ? [...rail.children] : [];

  if (STILL) { paintField(field, 1); scenes.forEach(revealScene); return; }

  /* A symmetric dissolve CANNOT be exclusive: at the midpoint between two
   * scenes both sit at the same value by construction, so both render. That
   * was fine when every scene had the same footprint and catastrophic here,
   * where one scene is a 42-cell field and the next is a 15rem numeral. The
   * field drew straight through the headline.
   *
   * Their page does not dissolve. Sampling it at scroll 3400 showed the trace
   * grid NOT MOUNTED: they swap scenes outright. So this is a hard window
   * with a short ramp at the seam, and anything outside its window leaves the
   * layout entirely rather than sitting at 0.3 on top of the next thing.
   *
   * d runs 0 at this scene's centre to 1 at its neighbour's. */
  /* PARTITION OF UNITY. Two scenes may be mid-crossfade; their opacities
   * must SUM TO 1 at every scroll position. This has now been wrong twice in
   * opposite directions, so the constraint is written down rather than tuned.
   *
   * Neighbouring scenes always satisfy d_i + d_next = 1 by construction.
   *
   *   V1 centred the ramp on d = 1. A scene a full step away sat at 0.5 and
   *   drew through its neighbour: sum 1.5.
   *   V2 "fixed" it with a plateau holding full opacity out to d = 0.76.
   *   But then d_i = 0.4 and d_next = 0.6 are BOTH inside the plateau, so
   *   both scenes painted at opacity 1: sum 2.0, over half of every
   *   transition. That is the hero and the next scene rendered on top of
   *   each other, which is what shipped.
   *
   * Centring the crossfade on d = 0.5 makes the sum identically 1. With a
   * linear ramp of half-width W:
   *   a_i + a_next = (0.5+W-d)/(2W) + (0.5+W-(1-d))/(2W) = 2W/2W = 1
   * The plateau survives: a scene is whole until d = 0.5-W and gone by
   * d = 0.5+W, and its neighbour is exactly the complement.
   */
  const W = 0.15;
  const presence = (i, p) => {
    // Centres span END TO END, i/(n-1), not the centre of an equal slice.
    // With slice centres the first scene sits at 12.5% of the run, so at
    // scroll zero it is half present, its entrance never fires, and the hero
    // renders blank. The first scene must be whole before anyone scrolls.
    const centre = i / (n - 1);
    const d = Math.abs(p - centre) * (n - 1);
    if (d <= 0.5 - W) return 1;
    if (d >= 0.5 + W) return 0;
    return (0.5 + W - d) / (2 * W);
  };

  // The invariant, asserted rather than trusted. Both previous versions
  // looked correct while reading them; only summing them exposes the fault.
  if (!STILL) {
    let worst = 0;
    for (let k = 0; k <= 400; k++) {
      const p = k / 400;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += presence(i, p);
      worst = Math.max(worst, Math.abs(sum - 1));
    }
    if (worst > 0.01) {
      throw new Error(`scene presence is not a partition of unity: ` +
                      `worst |sum-1| = ${worst.toFixed(3)}`);
    }
  }

  const parallaxEls = STILL ? [] : [...document.querySelectorAll("[data-par]")];

  let frame = 0;
  const update = () => {
    frame = 0;
    const r = run.getBoundingClientRect();
    const travel = r.height - innerHeight;
    if (travel <= 0) return;
    const p = clamp(-r.top / travel);

    scenes.forEach((s, i) => {
      const a = presence(i, p);
      s.style.opacity = a;
      // Blur and a small lift are both on Val Head's safe list; the travel
      // stays inside the 16-32px a reveal is allowed.
      s.style.filter = a > 0.99 ? "none" : `blur(${(1 - a) * 7}px)`;
      s.style.transform = a > 0.99 ? "none" : `translateY(${(1 - a) * 22}px)`;
      // display:none, not visibility:hidden. A hidden element still occupies
      // its grid cell and still paints its children's stacking context on
      // some engines; taking it out of the flow is what actually stops the
      // field from drawing through the headline.
      s.style.display = a <= 0.001 ? "none" : "";
      s.style.pointerEvents = a > 0.5 ? "" : "none";
      s.setAttribute("aria-hidden", a < 0.5);
      if (a > 0.5) revealScene(s);
      if (ticks[i]) ticks[i].style.opacity = 0.18 + a * 0.82;
    });

    // Scene 1 owns the second quarter, so the field reads its LOCAL progress.
    paintField(field, clamp((p - 1 / n) * n));

    // Parallax. transform only, and it rides the same frame as everything
    // else rather than adding a listener.
    for (const fig of parallaxEls) {
      const rate = +fig.dataset.par;
      fig.style.translate = `0 ${(-p * rate).toFixed(2)}px`;
    }
  };

  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  update();
}

/* ============================================================
   5. ENTRANCE ORDER FOLLOWS READING ORDER
   Their cascade is badge, headline line one, headline line two, subhead,
   buttons, then the plates LAST. Staggering by DOM position is the common
   failure and builds a cascade that fights the reader.
   ============================================================ */
function revealScene(scene) {
  if (scene.dataset.revealed) return;
  scene.dataset.revealed = "1";
  const items = [...scene.querySelectorAll("[data-enter]")]
    .sort((a, b) => +a.dataset.enter - +b.dataset.enter);
  items.forEach((el, i) => {
    // 70ms between beats: inside the 30-80ms band, and six items lands at
    // 350ms total, under the 400ms ceiling.
    setTimeout(() => el.classList.add("in"), STILL ? 0 : i * 70);
  });
  const plates = scene.querySelectorAll(".plate");
  plates.forEach((p, i) => setTimeout(() => p.classList.add("drawn"),
    STILL ? 0 : items.length * 70 + i * 60));
}

/* ============================================================
   6. CONTENT that would otherwise be markup noise
   ============================================================ */
function mountContent() {
  const labels = document.querySelector(".labels");
  if (labels) labels.innerHTML = LIT.map((l) =>
    `<li><b>${l.tag}</b><span>${l.said}</span></li>`).join("") +
    `<li><b>static</b><span>never moves, and most things should be this</span></li>`;

  const cards = document.querySelector(".cards");
  if (cards) cards.innerHTML = [
    ["load", "What resolved before anyone touched it."],
    ["hover", "Six targets driven, because most motion in a real system lives here."],
    ["focus", "Keyboard state, which a load-only crawl never reaches."],
    ["narrow", "375px, where a layout usually admits what it really is."],
    ["film", "Every animation frame across a constant-rate scroll."],
  ].map(([h, p]) => `<article><h3>${h}</h3><p>${p}</p></article>`).join("");

  const facts = document.querySelector(".facts");
  if (facts) facts.innerHTML = [
    ["Distinct animation durations", "2", "8"],
    ["Infinite loops", "0", "3"],
    ["Share of the page that is pinned", "—", "81%"],
    ["On-screen text elements, low to high", "—", "14 to 139"],
    ["Animations under reduced motion", "4 of ?", "4 of 214"],
  ].map(([k, was, is]) =>
    `<div><dt>${k}</dt><dd class="was">${was}</dd><dd class="is">${is}</dd></div>`).join("");
}

mountContent();
mountPlates();
sceneMachine(mountField());
