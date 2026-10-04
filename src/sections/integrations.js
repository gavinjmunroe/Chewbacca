/* Panel 3, "Sift MCP": a coding agent in a terminal pane pulls the issue and
 * its traces from Sift's MCP server, patches the prompt, and reports back.
 *
 * Structure read out of the reference's chunk 7969 (McpVisual) and off its
 * rendered panel: a window titlebar, one tab, a dark terminal body whose
 * lines are typed prompt / tool call / tool result / diff / check / collapse
 * / recap, a status bar pinned to the foot, and a 6-segment strip. Each step
 * is preceded by a text progress bar that counts to 100% and is then
 * replaced by the step's lines. Measured at 1440: zoom 0.85 on a natural
 * 640px window, 576px tall at 544.
 *
 * The terminal component itself (their module 6606) was not in the chunks,
 * so the step durations below are ours, set so one pass is 13.4s, close to
 * the other three panels' cycles of 10.8 to 12.8s.
 *
 * Every line, tool name, file and id is ours.
 */

export const MOUNT = "#integrations";

/* Load time of each step, then a hold on the finished session with a live
 * cursor. Six entries, six strip segments. */
const STEP_MS = [1200, 1600, 1600, 2400, 2000, 2600];
/* 22 cells reads as a terminal bar at 640 natural without wrapping. */
const BAR_CELLS = 22;
const BAR_TICK_MS = 80;

const t = (text, cls = "") => ({ text, cls });

/* One group per load step. Each line is a list of styled runs. */
const GROUPS = [
  [{ kind: "prompt", runs: [t("close out the P1 payout issue Sift opened")] }],
  [
    {
      kind: "call",
      runs: [t("sift", "b"), t(" · "), t("get_issue", "b"), t("(iss_7c19)")],
    },
    {
      kind: "result",
      runs: [t("P1: refund confirmed before the payout returns")],
    },
  ],
  [
    {
      kind: "call",
      runs: [
        t("sift", "b"),
        t(" · "),
        t("get_traces", "b"),
        t("(refund_agent)"),
      ],
    },
    {
      kind: "result",
      runs: [t("21 traces · cause: step order changed in deploy d41e")],
    },
  ],
  [
    {
      kind: "call",
      runs: [
        t("Edit", "b"),
        t("("),
        t("prompts/refund_agent.md", "path"),
        t(")"),
      ],
    },
    {
      kind: "result",
      runs: [t("- Tell the customer the refund is on its way.", "del")],
    },
    {
      kind: "cont",
      runs: [t("+ Confirm a refund only after issue_payout succeeds.", "add")],
    },
    {
      kind: "cont",
      runs: [
        t("+ If the payout fails, say so and hand off to a person.", "add"),
      ],
    },
    { kind: "cont", runs: [t("✓ ", ""), t("Patch applied, PR #317 opened")] },
    { kind: "cont", runs: [t("… 4 more lines hidden", "dim")] },
  ],
  [
    {
      kind: "recap",
      runs: [
        t("recap: ", "b"),
        t(
          "Closed the P1 payout issue from Sift. Reordered prompts/refund_agent.md and replayed all 21 failing traces, which now pass. Next: merge PR #317 and watch the eval Sift set up.",
          "it",
        ),
      ],
    },
  ],
];

const STATUS = [
  t("▸▸ edits auto-approved", "red"),
  t(" · ", "dim"),
  t("1 task", "cyan"),
  t(" · ", "dim"),
  t("tab to switch", "dim"),
  t(" · ", "dim"),
  t("esc to stop", "dim"),
];

const runs = (list) =>
  list.map((r) => `<span class="ig-${r.cls || "n"}">${r.text}</span>`).join("");

const GUTTER = {
  prompt: '<span class="ig-g ig-dim">›</span>',
  call: '<span class="ig-g ig-dot">●</span>',
  result: '<span class="ig-g ig-dim">└</span>',
  cont: '<span class="ig-g"></span>',
  recap: '<span class="ig-g ig-dim">*</span>',
};

function lineHtml(line) {
  const indent = line.kind === "result" || line.kind === "cont" ? " ig-in" : "";
  return `<div class="ig-line ig-${line.kind}${indent}">${GUTTER[line.kind]}<span class="ig-t">${runs(line.runs)}</span></div>`;
}

const FOLDER =
  '<svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true"><path d="M1 2.2c0-.6.4-1 1-1h3.2l1.3 1.4H12c.6 0 1 .4 1 1V10c0 .6-.4 1-1 1H2c-.6 0-1-.4-1-1z" fill="#8ea2b8"/><path d="M1 4h12v6c0 .6-.4 1-1 1H2c-.6 0-1-.4-1-1z" fill="#a9bbcf"/></svg>';

export function panel() {
  return `<div class="ig-zoom">
    <div class="ig-panel">
      <div class="ig-title">
        <span class="ig-lights" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="ig-title-t">${FOLDER}refund-agent</span>
      </div>
      <div class="ig-tabs">
        <span class="ig-tab">agent session</span>
        <span class="ig-plus" aria-hidden="true">+</span>
      </div>
      <div class="ig-term">
        <div class="ig-lines">
          ${GROUPS.map((g) => `<div class="ig-group">${g.map(lineHtml).join("")}</div>`).join("")}
          <div class="ig-load"><span class="ig-bar"></span></div>
          <div class="ig-cursor"><span class="ig-dim">›</span> <i class="ig-caret"></i></div>
        </div>
        <div class="ig-status">${runs(STATUS)}</div>
      </div>
      <div class="ig-steps">${STEP_MS.map(() => '<span class="ig-step"></span>').join("")}</div>
    </div>
  </div>`;
}

export function render() {
  return panel();
}

export function mount(root) {
  const groups = [...root.querySelectorAll(".ig-group")];
  const load = root.querySelector(".ig-load");
  const bar = root.querySelector(".ig-bar");
  const cursor = root.querySelector(".ig-cursor");
  const steps = [...root.querySelectorAll(".ig-step")];
  const last = STEP_MS.length - 1;
  let timer = 0;
  let ticker = 0;

  function drawBar(fraction) {
    const full = Math.round(fraction * BAR_CELLS);
    bar.textContent = `[${"█".repeat(full)}${"░".repeat(BAR_CELLS - full)}] ${Math.round(fraction * 100)}%`;
  }

  /* Step s: groups before s are on screen. A load step shows the bar
   * counting up and then reveals group s; the last step is the hold. */
  function paint(s, animate) {
    groups.forEach((g, i) => g.classList.toggle("is-in", i < s));
    load.classList.toggle("is-on", animate && s < last);
    cursor.classList.toggle("is-on", s >= last);
    steps.forEach((el, i) => {
      el.classList.toggle("is-done", i < s || (!animate && i === s));
      el.innerHTML =
        animate && i === s
          ? `<span class="ig-fill" style="animation-duration:${STEP_MS[s]}ms"></span>`
          : "";
    });
  }

  function stop() {
    window.clearTimeout(timer);
    window.clearInterval(ticker);
  }

  function enter(s) {
    stop();
    paint(s, true);
    if (s < last) {
      const t0 = performance.now();
      drawBar(0);
      ticker = window.setInterval(() => {
        drawBar(Math.min((performance.now() - t0) / STEP_MS[s], 1));
      }, BAR_TICK_MS);
    }
    timer = window.setTimeout(() => enter(s === last ? 0 : s + 1), STEP_MS[s]);
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  paint(last, false);

  return {
    setActive(on) {
      stop();
      if (reduced) return paint(last, false);
      if (on) enter(0);
    },
  };
}
