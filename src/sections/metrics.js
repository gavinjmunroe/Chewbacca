/* Panel 4, "Metrics": the issue is fixed and resolved, Sift turns the failure
 * into an online eval, the eval draws clean, then the failure comes back and
 * the issue reopens itself.
 *
 * Mechanism read out of the reference's chunk 5133 (RegressionsVisual): five
 * stages, fixing 1800 / resolving 1400 / metric 2000 / graph 3600 /
 * regression 4000 ms. The Resolve button presses for 450ms at the start of
 * resolving. The chart line draws over 4200ms (metrics.css) from the start of graph, so it
 * is still drawing when the regression lands and turns it red mid-stroke.
 * Measured at 1440: zoom 1.05 on a natural 518px card, 508px tall at 544.
 *
 * Every string, the eval name and the curve are ours.
 */

export const MOUNT = "#metrics";

const STAGES = ["fixing", "resolving", "metric", "graph", "regression"];
const STAGE_MS = [1800, 1400, 2000, 3600, 4000];
const PRESS_MS = 450;

const EVAL = "confirm_after_payout";

/* Flat and under the threshold for about 70% of the width, then a climb
 * past it to the right edge. Threshold dashed at y=60 of 96. */
const LINE =
  "M0,82 C26,88 50,77 82,84 S136,91 168,83 S222,75 254,85 S274,91 284,81 C296,67 302,47 316,35 L400,25";
const AREA = `${LINE} L400,96 L0,96 Z`;

const ICON_CHECK =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_SPIN =
  '<svg class="mx-spin" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".25"/><path d="M6 1.6a4.4 4.4 0 0 1 4.4 4.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const ICON_WARN =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1.4 11 10.4H1z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6 4.8v2.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><circle cx="6" cy="8.8" r=".6" fill="currentColor"/></svg>';
const ICON_PULSE =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1 9h3l2-5 3 8 2-4.5 1.2 1.5H15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_BELL =
  '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M3.2 10V6.4a3.8 3.8 0 0 1 7.6 0V10l1.2 1.2H2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.6 12.4a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

export function panel() {
  return `<div class="mx-zoom">
    <div class="mx-panel">
      <div class="mx-hd"><span>Issue</span><span class="mx-pri">P1</span></div>
      <div class="mx-body">
        <div class="mx-top">
          <h3 class="mx-title">Refund confirmed before the payout returned</h3>
          <span class="mx-btn" role="presentation"><span class="mx-btn-idle">Resolve</span><span class="mx-btn-done">${ICON_CHECK}Resolved</span></span>
        </div>
        <div class="mx-tags">
          <span class="mx-chip mx-chip-fix">${ICON_SPIN}Fixing</span>
          <span class="mx-chip mx-chip-re">${ICON_WARN}Reopened</span>
          <span class="mx-agent">refund-agent</span>
        </div>
        <div class="mx-fade mx-f-metric">
          <div class="mx-metric">
            <span class="mx-pulse">${ICON_PULSE}</span>
            <div class="mx-metric-t">
              <p class="mx-m1">Eval live: <span class="mx-mono">${EVAL}</span></p>
              <p class="mx-m2">Each new run is scored for this failure</p>
            </div>
          </div>
        </div>
        <div class="mx-fade mx-f-graph">
          <div class="mx-chart">
            <div class="mx-chart-hd">
              <span class="mx-chart-n">${EVAL}</span>
              <span class="mx-chart-s"><span class="mx-ok">0 failing</span><span class="mx-bad">regression found</span></span>
            </div>
            <svg class="mx-svg" viewBox="0 0 400 96" aria-hidden="true">
              <defs>
                <linearGradient id="mx-teal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2bc392" stop-opacity=".22"/><stop offset="100%" stop-color="#2bc392" stop-opacity="0"/></linearGradient>
                <linearGradient id="mx-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ee5557" stop-opacity=".22"/><stop offset="100%" stop-color="#ee5557" stop-opacity="0"/></linearGradient>
                <clipPath id="mx-reveal"><rect class="mx-clip" x="0" y="0" width="400" height="96"/></clipPath>
              </defs>
              <line x1="0" y1="60" x2="400" y2="60" stroke="#a3a3ab" stroke-width="1" stroke-dasharray="5 5" opacity=".55"/>
              <path class="mx-area-ok" d="${AREA}" fill="url(#mx-teal)" clip-path="url(#mx-reveal)"/>
              <path class="mx-area-bad" d="${AREA}" fill="url(#mx-red)" clip-path="url(#mx-reveal)"/>
              <path class="mx-line" d="${LINE}" fill="none" stroke-width="2.5" stroke-linecap="round" pathLength="100" stroke-dasharray="100"/>
            </svg>
          </div>
        </div>
        <div class="mx-fade mx-f-alert">
          <div class="mx-alert">
            <span class="mx-bell">${ICON_BELL}</span>
            <span class="mx-chip mx-chip-sm">Reopened</span>
            <span class="mx-alert-t">Back 2m ago, 3 runs flagged, on-call paged</span>
          </div>
        </div>
      </div>
      <div class="mx-steps">${STAGES.map(() => '<span class="mx-step"></span>').join("")}</div>
    </div>
  </div>`;
}

export function render() {
  return panel();
}

export function mount(root) {
  const panelEl = root.querySelector(".mx-panel");
  const steps = [...root.querySelectorAll(".mx-step")];
  let timers = [];
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  /* Stage classes drive everything in CSS: s0..s4 on the panel, plus
   * is-press for the 450ms button press and is-draw while the chart draws. */
  function paint(s, animate) {
    STAGES.forEach((_, i) => panelEl.classList.toggle(`mx-s${i}`, i === s));
    panelEl.classList.toggle("mx-past0", s >= 1);
    panelEl.classList.toggle("mx-past1", s >= 2);
    panelEl.classList.toggle("mx-past2", s >= 3);
    steps.forEach((el, i) => {
      el.innerHTML =
        animate && i === s
          ? `<span class="mx-fill" style="animation-duration:${STAGE_MS[s]}ms"></span>`
          : "";
    });
  }

  function setDraw(on, instant) {
    if (instant) {
      panelEl.classList.add("mx-instant");
      panelEl.classList.toggle("is-draw", on);
      void panelEl.offsetWidth;
      panelEl.classList.remove("mx-instant");
    } else {
      panelEl.classList.toggle("is-draw", on);
    }
  }

  function enter(s) {
    paint(s, true);
    const name = STAGES[s];
    if (name === "fixing") setDraw(false, true);
    if (name === "graph") setDraw(true, false);
    if (name === "resolving") {
      panelEl.classList.add("is-press");
      timers.push(
        window.setTimeout(() => panelEl.classList.remove("is-press"), PRESS_MS),
      );
    }
    timers.push(
      window.setTimeout(() => enter((s + 1) % STAGES.length), STAGE_MS[s]),
    );
  }

  function finished() {
    panelEl.classList.remove("is-press");
    paint(STAGES.length - 1, false);
    setDraw(true, true);
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  finished();

  return {
    setActive(on) {
      clear();
      if (reduced) return finished();
      if (on) {
        panelEl.classList.remove("is-press");
        enter(0);
      }
    },
  };
}

