/* Section B: the failure wall.

   It arrives in three stages, and the first one looks like a bug if you have
   not seen the sequence. That misreading already happened once on this
   project: the solid brand-coloured course was filed as "the bricks never
   got their borders" and somebody nearly deleted it. The solid stage is the
   point. It is a wall of runs that all came back 200.

     1  solid brand bricks land in offset masonry courses
     2  each brick becomes an outlined chip carrying a monospace run id
     3  roughly one chip in four flips to a warm-red failure state with a
        category and a one-line quote

   Every stage is driven from one rAF clock that BANKS its elapsed time when
   the section scrolls off screen, so coming back resumes mid-sequence instead
   of restarting. That is what the reference does on every figure and it is
   most of why its motion feels settled rather than eager.

   Only `transform` and `opacity` are written per frame. The fill change from
   solid to outlined is two stacked layers crossfading, not an animated
   `background-color`, and the outline is a layer whose opacity rises, not an
   animated `border-width`. */

export const MOUNT = "#failure-wall";

/* ------------------------------------------------------------------ copy */

/* Ours. The section is about the failure that does not raise, so the
   headline has to say the absence out loud rather than gesture at
   "unpredictable behaviour". */
const COPY = {
  label: "Failure modes",
  head: "Your agents fail without raising anything.",
  body:
    "Every block below is one production run from a support agent's first " +
    "week. The red ones returned a success status and still did the wrong " +
    "thing, so you hear about them from a user instead of from your logs.",
};

/* Ours as well. A monitoring product's taxonomy has to name things a stack
   trace cannot, which is why not one of these is an exception type.

   THE QUOTE BUDGET IS 29 CHARACTERS, measured rather than estimated. A
   15-unit brick, the narrowest that is failure-eligible, renders 183.9px
   wide at the 1168px content column. Inside its 6px padding, 9px mono fits
   29 characters. The first draft of the no-op line ran to 32 and overflowed
   by exactly 3px, which the ellipsis then ate a word to hide. Anything
   longer only survives if it happens to land on a wide brick, which is luck,
   not design. */
const FAILURES = [
  ["tool drift", "used neither search result"],
  ["stale context", "cited a doc deleted in March"],
  ["loop", "retried one call nine times"],
  ["dropped handoff", "escalated to an empty queue"],
  ["policy breach", "refunded above its own cap"],
  ["fabrication", "cited an order that never existed"],
  ["truncation", "stopped mid-sentence, returned 200"],
  ["schema drift", "sent a string, tool wanted a date"],
  ["no-op", "said it filed the ticket"],
  ["timeout ignored", "tool timed out, answered anyway"],
  ["overreach", "edited a field nobody asked for"],
  ["empty retrieval", "zero matches, answered anyway"],
];

/* -------------------------------------------------------------- geometry */

/* Seven courses. Six read as a band and eight pushed the section past one
   screen at 1280x900, where the whole point is that the sequence finishes
   while you are still looking at it. */
const ROWS = 7;

/* Brick widths in units, where the wall is 100 units wide, so a unit is a
   percent of the content column. The set is deliberately uneven: an
   arithmetic run (8,12,16,20,24) produced courses whose seams landed on a
   4-unit lattice and therefore lined up with the course above no matter how
   far it was dragged sideways. */
const WIDTHS = [8, 10, 13, 16, 19, 23, 28];

/* How far left each course is dragged, in units. Hand-set rather than
   random, because random offsets gave two adjacent courses 1 unit apart
   twice in ten seeds and that reads as a mistake. Adjacent values here are
   never closer than 2 and the sequence does not drift in one direction. */
const OFFSETS = [0, 7, 3, 11, 5, 9, 2];

/* Minimum distance, in units, between a seam and any seam in the course
   above. 5 units is 55px at the 1100px content column, which is wider than
   the 3px mortar by an order of magnitude, so a near-miss cannot read as an
   alignment. Measured: at 5 the generator satisfies every course inside 400
   attempts and the achieved minimum across the wall is published as
   `data-fw-seam-min` on the wall element, so this number is falsifiable
   rather than asserted. */
const SEAM_TOL = 5;

/* A failure chip has to hold a category and a quote. Below 15 units the quote
   ellipsises on the first word at 1100px, so only bricks at or above this
   are eligible, and the 1-in-4 target is filled from that pool. */
const FAIL_MIN_W = 15;

/* Fixed seed. The wall must be identical between `render()` and `mount()`,
   between reloads, and between screenshots, or nothing about it can be
   diffed. */
const SEED = 0x5ecbf1;

const ROW_TAGS = "ABCDEFG";

/* ---------------------------------------------------------------- timing */

/* Durations and curves carry their source. Three of the four curves were
   measured off the reference's shipped keyframes; the one that was not says
   so. */
const T = {
  /* lemma-blog-fade-up on the reference: .7s, cubic-bezier(.33,1,.68,1),
     translateY(18px) plus opacity. The landing brick is the same move. */
  landDur: 700,
  landRise: 18,
  /* Per-course and per-brick offsets are mine. Set so the last brick lands
     at ~1.2s: longer and the solid stage outstays its welcome before it has
     said anything. */
  landStepRow: 60,
  landStepCol: 22,
  /* The solid wall is then held whole. Without this the solid state existed
     only as the frame between the last landing and the first outline, which
     is exactly how it got misread as a bug. 420ms is long enough to register
     as a state. */
  holdSolid: 420,
  /* 220ms is the reference's most common duration, 1684 occurrences across
     its stylesheet. The crossfade to outlined is that. */
  chipDur: 220,
  chipStep: 16,
  holdChip: 320,
  /* The flip. Its second half carries the overshoot from lemma-cube-flip,
     .9s cubic-bezier(.34,1.3,.64,1), whose 1.3 control point is the pop. */
  flipDur: 300,
  flipStep: 90,
};

/* ----------------------------------------------------------------- maths */

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));

/* cubic-bezier evaluated the way a CSS engine does it: solve x(t) = p for t
   by Newton, then return y(t). Written out because the reference's curves
   are cubic-beziers and a named easing cannot express the one that matters,
   lemma-cube-flip, whose y2 of 1.3 overshoots past the endpoint. */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  const sy = t => ((ay * t + by) * t + cy) * t;
  return p => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - p;
      if (Math.abs(e) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(t);
  };
}

const easeEntry = bezier(0.33, 1, 0.68, 1);      // lemma-blog-fade-up
const easeChip = bezier(0.33, 1, 0.68, 1);       // lemma-cl-entry shares it
const easePop = bezier(0.34, 1.3, 0.64, 1);      // lemma-cube-flip, overshoots
/* No ease-in ships in the reference's 24 keyframes, so the first half of the
   flip uses a plain quadratic. Mine, and marked as mine. */
const easeIn = t => t * t;

/* mulberry32. One line of state, uniform enough for brick widths, and
   reproducible across engines, which Math.random is not. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ plan */

/* Builds the wall once: courses, brick widths, ids, which bricks fail, and
   every brick's place in the timeline. Pure, seeded, memoised. */
function buildPlan() {
  const rand = rng(SEED);
  const hex = n => Math.floor(rand() * 16 ** n).toString(16).padStart(n, "0");

  const rows = [];
  let prevSeams = [];
  let seamMin = Infinity;

  for (let r = 0; r < ROWS; r++) {
    const offset = OFFSETS[r];
    let best = null;

    /* Draw a course, measure how close its seams come to the course above,
       and keep drawing until they clear SEAM_TOL. Bounded at 400 attempts;
       if none clears, the widest-gap attempt is taken and the achieved
       minimum is published rather than hidden. */
    for (let attempt = 0; attempt < 400; attempt++) {
      const widths = [];
      let total = 0;
      /* Overshoot the right edge by at least 6 units so the last brick is
         cut by the wall's clip, the same way the dragged left edge is. A
         course that ends flush reads as a table row, not as masonry. */
      while (total < 100 + offset + 6) {
        const w = WIDTHS[Math.floor(rand() * WIDTHS.length)];
        widths.push(w);
        total += w;
      }
      const seams = [];
      let s = 0;
      for (let i = 0; i < widths.length - 1; i++) {
        s += widths[i];
        const at = s - offset;
        /* Window matches what is actually on screen. It was [3,97] first, and
           a playwright measurement of the rendered layout found a pair 3.00
           units apart because a seam at 98.0 had been filtered out of the
           check while remaining perfectly visible. A constraint that does not
           cover every seam it claims to cover is worse than no constraint. */
        if (at > 1 && at < 99) seams.push(at);
      }
      let gap = Infinity;
      for (const a of seams) {
        for (const b of prevSeams) gap = Math.min(gap, Math.abs(a - b));
      }
      if (!best || gap > best.gap) best = { widths, total, seams, gap };
      if (gap >= SEAM_TOL) break;
    }

    if (r > 0) seamMin = Math.min(seamMin, best.gap);
    prevSeams = best.seams;
    rows.push({ offset, widths: best.widths, total: best.total });
  }

  /* Flatten to bricks, keeping each one's left edge and whether the wall
     clips it, so the clip is known here rather than discovered in a
     screenshot. `start < 0` is a course dragged past the left edge;
     `start + units > 100` is one overshooting the right. */
  const bricks = [];
  rows.forEach((row, r) => {
    let at = -row.offset;
    row.widths.forEach((w, c) => {
      const start = at;
      at += w;
      bricks.push({
        row: r,
        col: c,
        units: w,
        start,
        whole: start >= 0 && start + w <= 100,
        /* Our id scheme: course tag, brick index in the course, then four hex
           of run hash. Eight characters, which fits the narrowest 8-unit
           brick at 8px mono with room left. */
        id: `${ROW_TAGS[r]}${String(c + 1).padStart(2, "0")}·${hex(4)}`,
        fail: null,
      });
    });
  });

  /* One in four, capped at the size of the taxonomy so no category is ever
     shown twice on one wall. At seven courses the two numbers agree exactly:
     47 bricks gives a target of 12 and there are 12 categories. Add a course
     and the cap binds, and the ratio drops rather than a category repeating. */
  const target = Math.round(bricks.length / 4);
  /* Wide enough to carry a quote, and not clipped by either wall edge. The
     clip rule came out of a screenshot: a lead-cut brick rendered
     "CATION / an order that never existed", because the wall ate the left
     half of FABRICATION. The cut is right for a brick and wrong for a
     sentence. */
  const pool = bricks.filter(b => b.units >= FAIL_MIN_W && b.whole);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const taxonomy = FAILURES.slice();
  const chosen = pool.slice(0, Math.min(target, pool.length, taxonomy.length));

  /* Pair the longest quote with the widest brick, second longest with second
     widest, and so on. Assigning at random left a 32-character line on the
     narrowest eligible brick, 3px over, and the ellipsis ate the word that
     made the sentence a failure. Rank pairing makes the fit a property of
     the assignment instead of a property of the seed, so changing SEED or
     WIDTHS cannot quietly reintroduce it.

     The shuffle above is what keeps this from reading as sorted: `chosen`
     arrives in random wall order, so rank pairing scatters the categories
     across the wall even though it orders them by length. */
  const byWidth = chosen.slice().sort((a, b) => b.units - a.units);
  const byLength = taxonomy.slice().sort((a, b) => b[1].length - a[1].length);
  byWidth.forEach((b, i) => { b.fail = byLength[i]; });

  /* Timeline. Each stage starts from where the previous one actually ended,
     the way the reference chains lemma-cube-draw into lemma-cube-dashed at
     0.42 + 1.1 = 1.52. An `index * step` stagger cannot do this, because it
     never knows how long the stage before it took. */
  let landEnd = 0;
  bricks.forEach(b => {
    b.landAt = b.row * T.landStepRow + b.col * T.landStepCol;
    landEnd = Math.max(landEnd, b.landAt + T.landDur);
  });

  const chipStart = landEnd + T.holdSolid;
  let chipEnd = chipStart;
  bricks.forEach((b, i) => {
    b.chipAt = chipStart + i * T.chipStep;
    chipEnd = Math.max(chipEnd, b.chipAt + T.chipDur);
  });

  const flipStart = chipEnd + T.holdChip;
  let flipEnd = flipStart;
  /* Flips fire in wall order, not in selection order, so the red spreads
     across the wall instead of hopping about. */
  const order = bricks.filter(b => b.fail);
  order.forEach((b, i) => {
    b.flipAt = flipStart + i * T.flipStep;
    flipEnd = Math.max(flipEnd, b.flipAt + T.flipDur);
  });

  return {
    rows, bricks,
    failures: order.length,
    seamMin: seamMin === Infinity ? 0 : seamMin,
    marks: { landEnd, chipStart, chipEnd, flipStart, flipEnd },
  };
}

let plan = null;
const getPlan = () => (plan ||= buildPlan());

/* ---------------------------------------------------------------- render */

const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function render() {
  const p = getPlan();

  const courses = p.rows.map((row, r) => {
    const cells = row.widths.map((w, c) => {
      const b = p.bricks.find(x => x.row === r && x.col === c);
      /* Basis is the brick's share of its own course, since the course is
         `row.total`% of the wall and the brick is `w`% of the wall. */
      const basis = (w / row.total * 100).toFixed(4);
      const fail = b.fail
        ? `<span class="fw-fail" aria-hidden="true">` +
            `<span class="fw-cat">${esc(b.fail[0])}</span>` +
            `<span class="fw-quote">${esc(b.fail[1])}</span>` +
          `</span>`
        : "";
      /* Only the failure cells carry anything a screen reader wants. The ids
         are 46 lines of hex otherwise. */
      const a11y = b.fail
        ? ` role="listitem" aria-label="${esc(b.fail[0])}: ${esc(b.fail[1])}"`
        : ` aria-hidden="true"`;
      return `<div class="fw-b" style="flex:0 0 ${basis}%"${a11y}>` +
        `<div class="fw-c">` +
          `<span class="fw-solid"></span>` +
          `<span class="fw-outline"></span>` +
          /* A lead-cut brick's id would start off the wall and render as a
             fragment, which reads as a bug rather than as a cut brick. */
          (b.start >= 0 ? `<span class="fw-id">${esc(b.id)}</span>` : "") +
          fail +
        `</div></div>`;
    }).join("");
    return `<div class="fw-row" style="width:${row.total}%;` +
      `margin-left:-${row.offset}%">${cells}</div>`;
  }).join("");

  return `
<div class="fw">
  <p class="fw-label">${esc(COPY.label)}</p>
  <h2 class="fw-head">${esc(COPY.head)}</h2>
  <p class="fw-body">${esc(COPY.body)}</p>
  <div class="fw-wall" role="list" data-fw-stage="idle"
       data-fw-rows="${p.rows.length}" data-fw-bricks="${p.bricks.length}"
       data-fw-failures="${p.failures}" data-fw-seam-min="${p.seamMin}"
       data-fw-end="${p.marks.flipEnd}">${courses}</div>
</div>`;
}

/* ----------------------------------------------------------------- mount */

export function mount(root) {
  const p = getPlan();
  const wall = root.querySelector(".fw-wall");
  if (!wall) return;

  const cells = [...wall.querySelectorAll(".fw-c")];
  if (cells.length !== p.bricks.length) return;

  /* Cache the layers once. Re-querying 46 cells per frame was 4 selector
     walks a brick and showed up as a flat 2ms of every frame. */
  const parts = cells.map((c, i) => ({
    b: p.bricks[i],
    c,
    solid: c.querySelector(".fw-solid"),
    outline: c.querySelector(".fw-outline"),
    id: c.querySelector(".fw-id"),
    fail: c.querySelector(".fw-fail"),
    done: false,
  }));

  /* Paint one brick at wall-clock `t`. Returns false once nothing about it
     can change again, so settled bricks drop out of the frame loop. */
  function paint(part, t) {
    const { b, c } = part;

    const land = seg(t, b.landAt, b.landAt + T.landDur);
    const chip = seg(t, b.chipAt, b.chipAt + T.chipDur);
    const flip = b.fail ? seg(t, b.flipAt, b.flipAt + T.flipDur) : 0;

    const e = easeEntry(land);
    const ch = easeChip(chip);

    let y = (1 - e) * T.landRise;
    let angle = 0;
    let flipped = false;
    if (flip > 0) {
      if (flip < 0.5) {
        angle = 90 * easeIn(flip / 0.5);
      } else {
        /* easePop can exceed 1, which drives the angle past flat and back:
           the pop on landing. */
        angle = 90 * (1 - easePop((flip - 0.5) / 0.5));
        flipped = true;
      }
    }

    c.style.transform = `translateY(${y.toFixed(2)}px)` +
      (angle !== 0 ? ` perspective(420px) rotateX(${angle.toFixed(2)}deg)` : "");
    c.style.opacity = e.toFixed(3);

    /* Solid brand fill lands, then hands over to the outline. */
    part.solid.style.opacity = (1 - ch).toFixed(3);
    part.outline.style.opacity = ch.toFixed(3);
    /* Low opacity on the id, per the spec's outlined state. */
    if (part.id) part.id.style.opacity = (ch * (flipped ? 0 : 0.45)).toFixed(3);
    if (part.fail) part.fail.style.opacity = flipped ? "1" : "0";

    const settled = land >= 1 && chip >= 1 && (!b.fail || flip >= 1);
    return !settled;
  }

  /* prefers-reduced-motion: the wall is information, so it renders whole and
     the drawing of it is what goes. Read here rather than at module scope so
     a test can flip the emulation before mounting. */
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    parts.forEach(part => paint(part, p.marks.flipEnd + 1));
    wall.dataset.fwStage = "done";
    return () => {};
  }

  /* One clock, banked. `elapsed` only advances while the wall is on screen,
     so scrolling away mid-sequence and back resumes rather than restarts. */
  let elapsed = 0;
  let last = 0;
  let raf = 0;
  let live = false;

  const stageAt = t =>
    t <= 0 ? "idle"
    : t < p.marks.chipStart ? "solid"
    : t < p.marks.flipStart ? "outline"
    : t < p.marks.flipEnd ? "failure"
    : "done";

  function draw(t) {
    let moving = false;
    for (const part of parts) {
      if (part.done) continue;
      if (paint(part, t)) moving = true;
      else part.done = true;
    }
    const s = stageAt(t);
    if (wall.dataset.fwStage !== s) wall.dataset.fwStage = s;
    return moving;
  }

  function frame(now) {
    if (!live) return;
    /* First frame after a resume must not bank the gap it was away for. */
    const dt = last ? Math.min(now - last, 50) : 0;
    last = now;
    elapsed += dt;
    const moving = draw(elapsed);
    if (moving) raf = requestAnimationFrame(frame);
    else { live = false; raf = 0; }
  }

  function start() {
    if (live) return;
    live = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    live = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }

  draw(0);

  /* threshold 0.15: at 0 the sequence began while the wall was a sliver
     under the fold and a third of it had run before it was readable. */
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) start();
      else stop();
    }
  }, { threshold: 0.15 });
  io.observe(wall);

  /* Test hook. Verification needs to land on a stage rather than race it, and
     a screenshot timed against rAF is flaky enough to be worthless. */
  wall.__failureWall = {
    seek(t) { stop(); elapsed = t; parts.forEach(x => (x.done = false)); draw(t); },
    state() {
      return {
        rows: p.rows.length, bricks: p.bricks.length, failures: p.failures,
        seamMin: p.seamMin, marks: p.marks, stage: wall.dataset.fwStage,
        elapsed,
      };
    },
  };

  return () => { io.disconnect(); stop(); delete wall.__failureWall; };
}
