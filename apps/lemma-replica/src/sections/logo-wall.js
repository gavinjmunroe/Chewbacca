/* Section A: the logo wall.
 *
 * The inversion is the point. The section label does not sit above the grid,
 * it occupies the centre cell, with mark cells around it. Everything else
 * here exists to keep that one cell reading as part of the same object as
 * its neighbours: one shared hairline, one shared cell metric, no border of
 * its own.
 *
 * Marks are invented. No real company name, wordmark or third-party asset
 * appears in this file, and none is fetched at runtime.
 */

export const MOUNT = "#logo-wall";

/* 15 cells, and the label at index 7.
 *
 * Why those two numbers together: index 7 is the exact centre cell of a
 * 15-cell grid at 5 columns (row 2, col 3), at 3 columns (row 3, col 2) and
 * at 1 column (the 8th of 15). So the label stays in the middle cell through
 * every breakpoint without the module ever measuring the layout. Changing
 * CELLS away from an odd multiple of both column counts breaks that, which
 * is the one thing this section cannot get wrong. */
const CELLS = 15;
const LABEL_INDEX = 7;

/* Cross-fade duration. From the spec: content swaps cross-fade over ~300ms.
 * 300 also sits next to the reference's own most common durations (220ms at
 * 1,684 occurrences, then 450, 400, 200, 150), so it is in family rather
 * than invented from nothing. */
const FADE_MS = 300;

/* Hold between swaps. CHOSEN, NOT MEASURED. What was measured is that
 * `lg-cell` fits scroll position at r2 0.23 to 0.61, far too low for a tween:
 * the cells are swapping content on their own clock, not being scrubbed. The
 * clock's rate was never recovered, so this is ours. 2600ms reads as a wall
 * that is alive without pulling the eye off the copy beside it. */
const HOLD_MS = 2600;

/* Roughly one swap in seven empties a cell instead of repopulating it,
 * because the measured behaviour is cells populating AND emptying. CHOSEN.
 * Capped by MAX_EMPTY so the wall never looks broken or half-loaded. */
const EMPTY_ODDS = 7;
const MAX_EMPTY = 2;

/* Invented marks. Coined names, kept to seven characters or fewer so the
 * widest one still fits a 112px cell at 375px viewport width, which is the
 * narrowest cell this layout produces. */
const MARKS = [
  { name: "Quenta",  desc: "agent runtime",     glyph: 0 },
  { name: "Volarix", desc: "retrieval layer",   glyph: 1 },
  { name: "Miretta", desc: "eval harness",      glyph: 2 },
  { name: "Halden",  desc: "prompt registry",   glyph: 3 },
  { name: "Orbica",  desc: "vector store",      glyph: 4 },
  { name: "Pellum",  desc: "tool gateway",      glyph: 5 },
  { name: "Tundrel", desc: "trace pipeline",    glyph: 6 },
  { name: "Cavasi",  desc: "policy checks",     glyph: 7 },
  { name: "Merodin", desc: "task queue",        glyph: 0 },
  { name: "Wexley",  desc: "session replay",    glyph: 1 },
  { name: "Ostara",  desc: "model router",      glyph: 2 },
  { name: "Bramit",  desc: "schema diffs",      glyph: 3 },
  { name: "Corvane", desc: "cost ledger",       glyph: 4 },
  { name: "Dalquin", desc: "run comparison",    glyph: 5 },
  { name: "Elmoss",  desc: "span sampling",     glyph: 6 },
  { name: "Fenrick", desc: "guardrail suite",   glyph: 7 },
  { name: "Girala",  desc: "dataset curation",  glyph: 0 },
  { name: "Hadrix",  desc: "replay sandbox",    glyph: 1 },
  { name: "Ivorel",  desc: "drift alerts",      glyph: 2 },
  { name: "Jannix",  desc: "context cache",     glyph: 3 },
  { name: "Kestrix", desc: "batch inference",   glyph: 4 },
  { name: "Lumeva",  desc: "label review",      glyph: 5 },
];

/* Eight geometric glyphs, drawn inside an 18x18 box at the left of each
 * mark. Stroke only, 1.1 units, so they carry the page's hairline weight
 * rather than reading as filled icons. */
const GLYPHS = [
  '<circle cx="9" cy="9" r="7"/><circle cx="9" cy="9" r="2.6"/>',
  '<path d="M9 2.4 16 15H2z"/>',
  '<rect x="2.4" y="2.4" width="13.2" height="13.2"/><rect x="6.4" y="6.4" width="5.2" height="5.2"/>',
  '<path d="M3 6.2 9 2.6l6 3.6M3 11.8 9 15.4l6-3.6"/>',
  '<path d="M2.4 9h13.2M9 2.4v13.2"/><circle cx="9" cy="9" r="5"/>',
  '<path d="M3.2 13.6h2.6V5.2M8.2 13.6h2.6V7.8M13.2 13.6h2.6V3.4" />',
  '<path d="M2.6 9a6.4 6.4 0 0 1 12.8 0"/><path d="M5.2 12.6a3.8 3.8 0 0 1 7.6 0"/>',
  '<path d="M9 2.2 15.4 5.9v6.2L9 15.8 2.6 12.1V5.9z"/>',
];

function escapeText(value) {
  return String(value).replace(/[&<>"]/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]
  ));
}

/* One mark, as a single inline SVG so the glyph and the wordmark scale and
 * align as one object.
 *
 * Width is computed rather than fixed: 9.4 units per character is the
 * measured advance of the 15px sans at 400 weight, near enough that no name
 * in MARKS overflows its declared box. The SVG carries explicit width and
 * height attributes equal to its viewBox, so one user unit is one CSS pixel
 * and letter spacing stays identical from the shortest name to the longest.
 * A uniform width would instead rescale each mark by its name length, which
 * is the exact tell that makes an invented logo wall look generated. */
function markSvg(mark) {
  const width = Math.round(26 + mark.name.length * 9.4);
  return `<svg class="lw-svg" width="${width}" height="22" viewBox="0 0 ${width} 22" aria-hidden="true" focusable="false">
        <g class="lw-glyph" transform="translate(0 2)">${GLYPHS[mark.glyph]}</g>
        <text class="lw-word" x="26" y="15.5">${escapeText(mark.name)}</text>
      </svg>`;
}

function markHtml(mark) {
  if (!mark) return "";
  return `<span class="lw-mark">${markSvg(mark)}<span class="lw-desc">${escapeText(mark.desc)}</span></span>`;
}

/* The two stacked layers are what make the swap a real cross-fade. With one
 * layer the only available move is fade out, replace, fade in, which is
 * 600ms of a cell sitting empty and reads as a load failure. */
function cellHtml(index, mark) {
  return `<div class="lw-cell" data-slot="${index}">
      <div class="lw-layer is-on" data-layer="0">${markHtml(mark)}</div>
      <div class="lw-layer" data-layer="1"></div>
    </div>`;
}

function labelCellHtml() {
  return `<div class="lw-cell lw-cell-label">
      <p class="lw-label">Running in production at</p>
      <p class="lw-label-sub">teams shipping agents their users depend on</p>
    </div>`;
}

export function render() {
  const cells = [];
  let markCursor = 0;
  for (let i = 0; i < CELLS; i += 1) {
    if (i === LABEL_INDEX) {
      cells.push(labelCellHtml());
    } else {
      cells.push(cellHtml(i, MARKS[markCursor]));
      markCursor += 1;
    }
  }
  return `<div class="lw-wrap">
    <div class="lw-grid">${cells.join("")}</div>
  </div>`;
}

export function mount(root) {
  const grid = root.querySelector(".lw-grid");
  if (!grid) return undefined;

  const cells = Array.from(grid.querySelectorAll(".lw-cell[data-slot]"));
  if (cells.length === 0) return undefined;

  /* Reduced motion gets the settled state render() already produced: every
   * cell populated, nothing swapping, no observer, no timer. The wall is
   * information; only the swapping goes. */
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches) return undefined;

  /* slotMark[i] is the index into MARKS currently shown in cell i, or null
   * for an empty cell. render() filled the cells in MARKS order. */
  const slotMark = new Map();
  cells.forEach((cell, position) => slotMark.set(cell, position));

  const front = new Map();
  cells.forEach((cell) => front.set(cell, 0));

  /* Round-robin over a shuffled order rather than an independent random pick
   * each time. Random picking visibly clusters: it revisits one corner three
   * times before touching the opposite one, and on a 14-cell wall that reads
   * as a bug rather than as life. */
  const order = cells.slice();
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let orderCursor = 0;

  let timer = null;
  let deadline = 0;
  let remaining = HOLD_MS;
  let running = false;
  let destroyed = false;

  function emptyCells() {
    return cells.filter((cell) => slotMark.get(cell) === null);
  }

  function nextCell() {
    const empties = emptyCells();
    /* Repopulating an empty cell is preferred most of the time, so the wall
     * trends full instead of draining toward MAX_EMPTY and staying there. */
    if (empties.length > 0 && Math.random() < 0.6) {
      return empties[Math.floor(Math.random() * empties.length)];
    }
    const cell = order[orderCursor % order.length];
    orderCursor += 1;
    return cell;
  }

  function nextMark(cell) {
    const current = slotMark.get(cell);
    if (current !== null && emptyCells().length < MAX_EMPTY
      && Math.random() < 1 / EMPTY_ODDS) {
      return null;
    }
    const shown = new Set();
    slotMark.forEach((markIndex) => {
      if (markIndex !== null) shown.add(markIndex);
    });
    const candidates = [];
    for (let i = 0; i < MARKS.length; i += 1) {
      if (!shown.has(i)) candidates.push(i);
    }
    if (candidates.length === 0) return current;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function swapOnce() {
    if (destroyed) return;
    const cell = nextCell();
    const layers = cell.querySelectorAll(".lw-layer");
    const frontIndex = front.get(cell);
    const backIndex = frontIndex === 0 ? 1 : 0;
    const showing = layers[frontIndex];
    const incoming = layers[backIndex];

    const markIndex = nextMark(cell);
    incoming.innerHTML = markHtml(markIndex === null ? null : MARKS[markIndex]);
    slotMark.set(cell, markIndex);

    /* One frame so the incoming layer is laid out at opacity 0 before the
     * class flips. Without it the browser can collapse both style changes
     * into one recalculation and the new content appears instantly. */
    requestAnimationFrame(() => {
      if (destroyed) return;
      incoming.classList.add("is-on");
      showing.classList.remove("is-on");
      front.set(cell, backIndex);
    });

    schedule(HOLD_MS);
  }

  function schedule(ms) {
    remaining = ms;
    deadline = performance.now() + ms;
    timer = window.setTimeout(swapOnce, ms);
  }

  function start() {
    if (running || destroyed) return;
    running = true;
    /* Bank what was left of the hold rather than restarting it, so scrolling
     * away and back does not reset the wall's clock. */
    schedule(Math.max(120, remaining));
  }

  function stop() {
    if (!running) return;
    running = false;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    remaining = Math.max(120, deadline - performance.now());
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) start();
      else stop();
    });
  }, { threshold: 0 });
  observer.observe(grid);

  return function cleanup() {
    destroyed = true;
    stop();
    observer.disconnect();
  };
}
