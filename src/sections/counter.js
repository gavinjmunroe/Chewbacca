/* Counter: the odometer.
   Recovered from the reference's chunk 768, which shipped the reel mechanism
   rather than a tween on a number. Six digits means six independent reels.

   The geometry is not a style choice, it is forced. A reel is a column of 11
   cells holding `(start + i) % 10`, and the column travels exactly -10em. Cell
   10 therefore holds `(start + 10) % 10`, which IS `start`. So the cell the
   reel lands on is the cell it left, and `start` is necessarily the digit's
   final value. The eleventh cell is not decoration: without it, -10em parks
   the window on nothing and the digit disappears at the end of its own spin.

   The blur is the other half. Each reel owns a private SVG filter, id'd by
   reel index, and its vertical blur is driven by the reel's own velocity. One
   shared filter blurs the whole number by one amount, which reads as a number
   fading in. Six filters moving at six speeds read as machinery. */

export const MOUNT = "#counter";

/* ---- configuration --------------------------------------------------- */

const DEFAULTS = {
  target: 412908,
  digits: 6,
  group: 3, // thousands separator every 3 digits, 0 to disable
};

let config = { ...DEFAULTS };

/* Instance counter, so two odometers on one page cannot collide on a filter
   id. Deterministic on purpose: a random id would make the render output
   untestable. */
let instanceSeq = 0;

/** Set the number and how many reels carry it. Call before `render()`. */
export function setTarget(target, digits) {
  return configure({ target, digits });
}

/** Merge options into the module config and return the result. */
export function configure(next = {}) {
  config = { ...config, ...next };
  if (!Number.isFinite(config.target) || config.target < 0) {
    config.target = DEFAULTS.target;
  }
  config.target = Math.floor(config.target);
  config.digits = Math.max(1, Math.floor(config.digits) || DEFAULTS.digits);
  config.group = Math.max(0, Math.floor(config.group) || 0);
  return { ...config };
}

export function getConfig() {
  return { ...config };
}

/* ---- timing ---------------------------------------------------------- */

/* Per-reel duration and delay are OUR choice. The reference was measured to
   give every reel its own pair; the pair itself was not recovered, so nothing
   below is a finding.

   The shape is chosen so two things are true at once:
   - reels settle left to right, one at a time, because a number resolves the
     way it is read
   - the right-hand reels move FASTER, because on a real odometer the units
     wheel is the blurred one

   Those pull against each other, hence the split: duration shrinks rightward
   (faster) while delay grows rightward (later start). Settle time is
   delay + duration, and it increases as long as
   REEL_STAGGER_MS > (REEL_SLOW_MS - REEL_FAST_MS) / (n - 1). At n = 6 the
   right side of that is 110ms, so 260ms leaves a 150ms gap between landings:
   visibly sequential, not a stutter. */
const REEL_SLOW_MS = 1400; // leftmost reel, the slowest sweep
const REEL_FAST_MS = 850; // rightmost reel, the fastest
const REEL_STAGGER_MS = 260; // added start delay per reel, left to right

/** Sweep duration in ms for reel `idx` of `count`. */
export function reelDuration(idx, count) {
  if (count <= 1) return REEL_SLOW_MS;
  const span = REEL_SLOW_MS - REEL_FAST_MS;
  return REEL_SLOW_MS - (span * idx) / (count - 1);
}

/** Start delay in ms for reel `idx`. */
export function reelDelay(idx) {
  return REEL_STAGGER_MS * idx;
}

/* Blur per unit of reel speed, in em of vertical sigma per digit-per-second.

   Set by eye against the reference's mid-count frame, not measured off it: at
   32px the fastest reel lands on 3.6px of sigma and the slowest on 2.2px,
   which smears the glyph without turning it into a grey bar. Raising it past
   roughly 0.015 makes the whole number unreadable mid-spin, which is the
   failure this constant exists to stay short of. */
const BLUR_EM_PER_DPS = 0.0095;

/** Reel speed in digits per second: 10 cells crossed over its own duration. */
function reelSpeed(idx, count) {
  return 10 / (reelDuration(idx, count) / 1000);
}

/** Peak vertical blur sigma in px for reel `idx` at a given font size. */
function reelBlurPeak(idx, count, fontPx) {
  return reelSpeed(idx, count) * BLUR_EM_PER_DPS * fontPx;
}

/* A long frame delta is banked, not spent. rAF stops firing in a backgrounded
   tab, so the first frame after a tab switch can arrive seconds late and, left
   alone, would advance the whole spin in one step: the roll never happens and
   the number is just there. 64ms is four frames at 60Hz. Chosen, not
   measured. */
const MAX_FRAME_MS = 64;

/* ---- markup ---------------------------------------------------------- */

function digitsOf(target, count) {
  const text = String(target).padStart(count, "0");
  // A number wider than its reel count keeps its low-order digits, because
  // truncating the other end would silently change the value on screen.
  return text.slice(-count).split("").map(Number);
}

function groupedText(digits, group) {
  if (!group) return digits.join("");
  const out = [];
  digits.forEach((digit, i) => {
    const fromRight = digits.length - i;
    if (i > 0 && fromRight % group === 0) out.push(",");
    out.push(String(digit));
  });
  return out.join("");
}

function reelCells(startDigit) {
  let cells = "";
  // 11 cells: i runs 0..10 inclusive so the wrap cell exists.
  for (let i = 0; i <= 10; i += 1) {
    cells += `<span class="counter-cell">${(startDigit + i) % 10}</span>`;
  }
  return cells;
}

function reelMarkup(digit, idx, uid) {
  return (
    `<span class="counter-reel" data-reel="${idx}">` +
    `<span class="counter-reel-col" data-reel-col="${idx}"` +
    ` style="filter:url(#reel-blur-${uid}-${idx})">` +
    reelCells(digit) +
    `</span></span>`
  );
}

function filtersMarkup(count, uid) {
  let defs = "";
  for (let i = 0; i < count; i += 1) {
    /* One filter per reel, id carrying the reel index.

       color-interpolation-filters="sRGB" is load bearing: the SVG default is
       linearRGB, which lightens a dark glyph as it blurs, so the number pales
       mid-spin instead of smearing.

       stdDeviation is "0 s", vertical only. The reel travels on one axis, so
       blurring the other axis would just soften the glyph. */
    defs +=
      `<filter id="reel-blur-${uid}-${i}" color-interpolation-filters="sRGB"` +
      ` x="-25%" y="-25%" width="150%" height="150%">` +
      `<feGaussianBlur data-reel-blur="${i}" stdDeviation="0 0"/>` +
      `</filter>`;
  }
  return (
    `<svg class="counter-filters" aria-hidden="true" focusable="false"` +
    ` width="0" height="0"><defs>${defs}</defs></svg>`
  );
}

export function render() {
  const { target, digits: count, group } = config;
  const digits = digitsOf(target, count);
  const uid = `c${(instanceSeq += 1)}`;
  const label = groupedText(digits, group);

  let reels = "";
  digits.forEach((digit, i) => {
    const fromRight = digits.length - i;
    if (group && i > 0 && fromRight % group === 0) {
      reels += `<span class="counter-sep">,</span>`;
    }
    reels += reelMarkup(digit, i, uid);
  });

  return (
    `<div class="counter">` +
    `<div class="counter-inner">` +
    `<p class="counter-label">Volume</p>` +
    `<h2 class="counter-headline" data-counter-headline>` +
    `Your agents left ` +
    `<span class="counter-odometer" data-counter-odometer data-uid="${uid}"` +
    ` aria-hidden="true">${reels}</span>` +
    `<span class="counter-sr">${label}</span>` +
    ` traces last week. Nobody was going to read them.` +
    `</h2>` +
    `<p class="counter-sub">Every one gets scored against the instructions you` +
    ` actually wrote. The handful that went wrong come to you with the span` +
    ` already open.</p>` +
    `</div>` +
    filtersMarkup(digits.length, uid) +
    `</div>`
  );
}

/* ---- behaviour ------------------------------------------------------- */

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function mount(root) {
  const odometer = root.querySelector("[data-counter-odometer]");
  const headline = root.querySelector("[data-counter-headline]");
  if (!odometer) return () => {};

  const columns = Array.from(root.querySelectorAll("[data-reel-col]"));
  const count = columns.length;
  if (!count) return () => {};

  const blurs = columns.map((_, i) =>
    root.querySelector(`[data-reel-blur="${i}"]`),
  );
  const timings = columns.map((_, i) => ({
    delay: reelDelay(i),
    duration: reelDuration(i, count),
  }));

  // Published on the DOM so a test, or anything downstream, can read the plan
  // instead of recomputing it.
  columns.forEach((column, i) => {
    column.dataset.reelDuration = String(Math.round(timings[i].duration));
    column.dataset.reelDelay = String(Math.round(timings[i].delay));
  });

  const settled = columns.map(() => false);
  let fontPx = 32;
  let elapsed = 0; // banked run time, advanced only while on screen
  let lastFrame = 0;
  let frameHandle = 0;
  let running = false;
  let awake = false; // has it ever entered the viewport
  let finished = false;

  function jumpToEnd() {
    columns.forEach((column, i) => {
      // p = 0 already shows the target digit, because cell 0 and cell 10 hold
      // the same value. So the finished state needs no transform at all.
      column.style.transform = "none";
      column.style.filter = "none";
      if (blurs[i]) blurs[i].setAttribute("stdDeviation", "0 0");
      column.dataset.reelSettled = "0";
      settled[i] = true;
    });
    finished = true;
    odometer.dataset.counterState = "settled";
  }

  function applyAt(ms) {
    let allDone = true;
    for (let i = 0; i < count; i += 1) {
      const { delay, duration } = timings[i];
      const t = clamp01((ms - delay) / duration);
      // easeOutCubic, 1 - (1 - t)^3. Same curve the reference drives its
      // headline wipe with, so the two land with one feel.
      const p = 1 - Math.pow(1 - t, 3);
      columns[i].style.transform =
        `translate3d(0, ${(-p * 10).toFixed(4)}em, 0)`;

      if (t < 1) {
        allDone = false;
        // Velocity of that curve is 3(1 - t)^2, so blur proportional to
        // (1 - t)^2 is the reel's own speed. It reaches zero exactly when the
        // reel stops, with nothing tuning it to do so.
        const sigma = reelBlurPeak(i, count, fontPx) * Math.pow(1 - t, 2);
        if (blurs[i])
          blurs[i].setAttribute("stdDeviation", `0 ${sigma.toFixed(3)}`);
      } else if (!settled[i]) {
        settled[i] = true;
        if (blurs[i]) blurs[i].setAttribute("stdDeviation", "0 0");
        // Drop the filter once the reel is still: a filtered element is
        // rasterised every frame even when nothing about it changes.
        columns[i].style.filter = "none";
        columns[i].dataset.reelSettled = String(Math.round(ms));
        odometer.dispatchEvent(
          new CustomEvent("counter:reelsettle", {
            bubbles: true,
            detail: { index: i, at: Math.round(ms) },
          }),
        );
      }
    }
    return allDone;
  }

  function stop() {
    running = false;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }

  function frame(now) {
    if (!running) return;
    elapsed += Math.min(now - lastFrame, MAX_FRAME_MS);
    lastFrame = now;
    const done = applyAt(elapsed);
    if (done) {
      stop();
      finished = true;
      odometer.dataset.counterState = "settled";
      odometer.dispatchEvent(
        new CustomEvent("counter:settled", {
          bubbles: true,
          detail: { at: Math.round(elapsed) },
        }),
      );
      return;
    }
    frameHandle = requestAnimationFrame(frame);
  }

  function start() {
    if (running || finished) return;
    // Read the rendered size here rather than at render time, so the blur is
    // right at whichever breakpoint the section actually mounted in.
    fontPx = parseFloat(getComputedStyle(odometer).fontSize) || 32;
    running = true;
    odometer.dataset.counterState = "spinning";
    lastFrame = performance.now();
    frameHandle = requestAnimationFrame(frame);
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches) {
    jumpToEnd();
    return () => {};
  }

  function onReducedChange(event) {
    if (event.matches && !finished) {
      stop();
      jumpToEnd();
    }
  }
  if (reduced.addEventListener)
    reduced.addEventListener("change", onReducedChange);

  applyAt(0);
  odometer.dataset.counterState = "waiting";

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          awake = true;
          start();
        } else if (awake) {
          // Bank, never reset. Scrolling past mid-spin and coming back resumes
          // where it stopped instead of replaying the entrance.
          stop();
        }
      }
      if (finished) observer.disconnect();
    },
    { threshold: 0.35 },
  );
  observer.observe(headline || odometer);

  return () => {
    stop();
    observer.disconnect();
    if (reduced.removeEventListener) {
      reduced.removeEventListener("change", onReducedChange);
    }
  };
}
