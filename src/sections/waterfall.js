/* Panel 1, "Traces": a run arrives span by span, gets audited, and the
 * findings land above the tree.
 *
 * Mechanism read out of the reference's chunk 8331 (TraceShowcaseVisual):
 * a four-stage machine, tracing 2600 / processing 2000 / flagging 3000 /
 * done 3200 ms, cycling through two traces. Rows stream in at
 * 100 + i * 2000 / n ms, findings at 300 and 1600 ms into flagging. Measured
 * on their page at 1440: no scale wrapper is active at desktop width, so the
 * panel renders at natural size, 544 wide and 502 tall.
 *
 * The traces, names and findings are ours, written for Sift.
 */

export const MOUNT = "#waterfall";

const STAGES = ["tracing", "processing", "flagging", "done"];
const STAGE_MS = [2600, 2000, 3000, 3200];
/* The whole tree streams in over 2000ms of the 2600ms tracing stage. */
const STREAM_MS = 2000;
const FINDING_AT = [300, 1600];
/* h-7 in theirs. The spacer under a partial tree is (n - shown) * ROW_H so
 * the panel is the same height before the first span and after the last. */
const ROW_H = 28;

/* ---- the traces ------------------------------------------------------ *
 * [kind, name, start ms, duration ms, error?, children?]. Both traces are 10
 * spans so the panel height never changes between them; theirs alternates
 * 10 and 9 and jumps 28px on the swap. */
function span(kind, name, start, dur, error, children) {
  return {
    kind,
    name,
    start,
    dur,
    error: Boolean(error),
    children: children || [],
  };
}

const TRACES = [
  {
    id: "7d3a91f0-2c4b-4e8a-b615-0f9c2e4ad781",
    total: 11800,
    root: span("agent", "refund-agent", 0, 11800, false, [
      span("guardrail", "scope_check", 140, 1250),
      span("tool", "load_order", 1420, 2240, false, [
        span("tool", "order_history", 1910, 1380),
      ]),
      span("generation", "llm.plan_refund", 3720, 2880),
      span("tool", "settle", 6650, 3100, false, [
        span("tool", "issue_payout", 6790, 2920, false, [
          span("generation", "llm.compose_note", 7400, 1700),
        ]),
      ]),
      span("generation", "llm.confirm_refund", 9810, 1620, true),
      span("tool", "notify_customer", 11460, 340, true),
    ]),
    findings: [
      "Told the customer the refund was sent before the payout returned",
      "Sent the confirmation even though issue_payout came back empty",
    ],
  },
  {
    id: "c05e2b77-91d4-4f3a-8e20-6ab4d19f3c02",
    total: 9200,
    root: span("agent", "billing-agent", 0, 9200, false, [
      span("generation", "classify_intent", 92, 640),
      span("tool", "fetch_account", 760, 1500, false, [
        span("retriever", "account_db", 980, 1050),
      ]),
      span("retriever", "kb_search", 2300, 1720, true, [
        span("embedding", "embed_query", 2380, 420),
      ]),
      span("generation", "llm.draft_answer", 4080, 2150),
      span("tool", "apply_credit", 6260, 1380, false, [
        span("tool", "ledger_write", 6420, 860),
      ]),
      span("generation", "llm.final_reply", 7700, 1380, true),
    ]),
    findings: [
      "Credited the account twice for a single disputed charge",
      "Quoted a fee policy the knowledge base never returned",
    ],
  },
];

function order(node, out = []) {
  out.push(node);
  node.children.forEach((c) => order(c, out));
  return out;
}
TRACES.forEach((t) => {
  t.order = order(t.root);
});

/* ---- formatting and glyphs ------------------------------------------- */

function fmt(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/* 12x12, filled, one colour per kind, same pairing as theirs: agent purple,
 * generation pink, tool orange, guardrail red, retriever teal, embedding
 * amber. The shapes are ours. */
const ICON = {
  agent:
    '<rect x="2" y="3" width="8" height="7" rx="1.5"/><rect x="5.4" y="1" width="1.2" height="2.4"/><circle cx="4.5" cy="6.4" r=".9" fill="#fff"/><circle cx="7.5" cy="6.4" r=".9" fill="#fff"/>',
  generation:
    '<circle cx="6" cy="3.6" r="2.1"/><circle cx="3.4" cy="8.2" r="2.1"/><circle cx="8.6" cy="8.2" r="2.1"/>',
  tool: '<path d="M8.6 1.2a2.6 2.6 0 0 0-2.4 3.5L1.5 9.4l1.1 1.1 4.7-4.7a2.6 2.6 0 0 0 3.5-2.4L9.3 4.9 7.4 4.6 7.1 2.7z"/>',
  guardrail:
    '<path d="M6 1 10.4 2.6v3.2c0 2.6-2 4.4-4.4 5.2-2.4-.8-4.4-2.6-4.4-5.2V2.6z"/><path d="M4.1 6 5.5 7.3 8 4.8" stroke="#fff" stroke-width="1.1" fill="none"/>',
  retriever:
    '<circle cx="5.2" cy="5.2" r="3.4"/><path d="M7.4 7.6 10.6 10.8" stroke="currentColor" stroke-width="1.6"/><circle cx="5.2" cy="5.2" r="1.6" fill="#fff"/>',
  embedding:
    '<rect x="1.5" y="1.5" width="4" height="4"/><rect x="6.5" y="6.5" width="4" height="4"/><rect x="6.5" y="1.5" width="4" height="4" opacity=".5"/>',
};

function icon(kind) {
  return `<svg class="wf-ico wf-k-${kind}" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">${ICON[kind]}</svg>`;
}

const ERR_ICON =
  '<svg class="wf-err" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5.5" fill="currentColor"/><path d="M6 3.2v3.4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="6" cy="8.6" r=".75" fill="#fff"/></svg>';

const CARET =
  '<svg class="wf-caret" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2.5 3.8 5 6.3 7.5 3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CHEV =
  '<svg class="wf-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* Lissajous 3:2 with a quarter-turn phase, 140 segments, in a 100 box. The
 * same curve family as their loader, drawn here from the parametric form. */
const ORBIT = (() => {
  let d = "";
  for (let i = 0; i <= 140; i += 1) {
    const t = (i / 140) * Math.PI * 2;
    const x = 50 + 40 * Math.sin(3 * t + Math.PI / 2);
    const y = 50 + 40 * Math.sin(2 * t);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
})();

const LOADER = `<svg class="wf-orbit" viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <path d="${ORBIT}" pathLength="100" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity=".2"/>
  <path class="wf-orbit-run" d="${ORBIT}" pathLength="100" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="32 68"/>
</svg>`;

/* ---- tree ------------------------------------------------------------ */

function rowHtml(node, depth, isLast, guides, trace) {
  const kids = node.children;
  let lead = "";
  if (depth === 0) {
    lead = '<span class="wf-pad"></span>';
  } else {
    lead =
      guides
        .map(
          (g) =>
            `<span class="wf-col">${g ? '<i class="wf-v"></i>' : ""}</span>`,
        )
        .join("") +
      `<span class="wf-col"><i class="wf-v${isLast ? " wf-half" : ""}"></i><i class="wf-h"></i></span>` +
      '<span class="wf-gap"></span>';
  }
  const left = Math.max((node.start / trace.total) * 100, 0);
  const width = Math.max(
    Math.min((node.dur / trace.total) * 100, 100 - left),
    1,
  );
  return `<div class="wf-row${node.error ? " is-err" : ""}">
      ${lead}
      <span class="wf-cv">${kids.length ? CARET : ""}</span>
      ${icon(node.kind)}
      <span class="wf-nm">${node.name}</span>
      ${node.error ? ERR_ICON : ""}
      <span class="wf-dur">${fmt(node.dur)}</span>
      <span class="wf-track"><span class="wf-bar wf-b-${node.kind}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span></span>
    </div>`;
}

/* Renders only the first `count` spans in depth-first order. Last-sibling
 * guides are worked out over the VISIBLE children, as theirs does, so a
 * branch drawn mid-stream ends its line where the stream currently ends. */
function treeHtml(trace, count) {
  const shown = new Set(trace.order.slice(0, count));
  const walk = (node, depth, isLast, guides) => {
    const kids = node.children.filter((c) => shown.has(c));
    const next = depth > 0 ? [...guides, !isLast] : guides;
    return (
      rowHtml(node, depth, isLast, guides, trace) +
      kids
        .map((c, i) => walk(c, depth + 1, i === kids.length - 1, next))
        .join("")
    );
  };
  const body = shown.has(trace.root) ? walk(trace.root, 0, true, []) : "";
  return `${body}<div class="wf-spacer" style="height:${(trace.order.length - count) * ROW_H}px"></div>`;
}

function findingsHtml(trace, count) {
  return trace.findings
    .slice(0, count)
    .map(
      (title) => `<div class="wf-card">
        <p class="wf-card-t">${title}</p>${CHEV}
      </div>`,
    )
    .join("");
}

/* ---- panel ----------------------------------------------------------- */

export function panel() {
  return `<div class="wf-panel">
    <div class="wf-hd">
      <span class="wf-tid"></span>
      <span class="wf-meta"></span>
    </div>
    <div class="wf-occ">
      <div class="wf-wait">${LOADER}<span class="wf-wait-t"></span></div>
      <div class="wf-found">
        <p class="wf-found-h">${ERR_ICON.replace('class="wf-err"', 'class="wf-found-ico"')}<span>Flagged in this run</span></p>
        <div class="wf-cards"></div>
      </div>
    </div>
    <div class="wf-tree"></div>
    <div class="wf-steps">${STAGES.map(() => '<span class="wf-step"></span>').join("")}</div>
  </div>`;
}

export function render() {
  return panel();
}

/* ---- mount ----------------------------------------------------------- */

export function mount(root) {
  const $ = (s) => root.querySelector(s);
  const tid = $(".wf-tid");
  const meta = $(".wf-meta");
  const wait = $(".wf-wait");
  const waitT = $(".wf-wait-t");
  const found = $(".wf-found");
  const cards = $(".wf-cards");
  const tree = $(".wf-tree");
  const steps = [...root.querySelectorAll(".wf-step")];

  let traceIx = 0;
  let stage = 0;
  let timers = [];
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));

  function paintTrace(trace) {
    tid.textContent = trace.id;
    meta.textContent = `${(trace.total / 1000).toFixed(1)}s · ${trace.order.length} spans`;
  }

  function paintFindings(trace, n) {
    cards.innerHTML = findingsHtml(trace, n);
    const has = n > 0;
    wait.classList.toggle("is-off", has);
    found.classList.toggle("is-on", has);
    found.style.setProperty(
      "--wf-reveal",
      `${Math.round((n / trace.findings.length) * 100)}%`,
    );
  }

  function enter(s) {
    stage = s;
    const trace = TRACES[traceIx];
    const name = STAGES[s];
    steps.forEach((el, i) => el.classList.toggle("is-on", i <= s));
    if (name === "tracing") {
      paintTrace(trace);
      paintFindings(trace, 0);
      tree.innerHTML = treeHtml(trace, 0);
      const gap = STREAM_MS / trace.order.length;
      trace.order.forEach((_, i) =>
        later(() => (tree.innerHTML = treeHtml(trace, i + 1)), 100 + i * gap),
      );
    } else {
      tree.innerHTML = treeHtml(trace, trace.order.length);
    }
    waitT.textContent =
      name === "tracing" ? "Listening for a run…" : "Auditing the run…";
    if (name === "flagging") {
      trace.findings.forEach((_, i) =>
        later(() => paintFindings(trace, i + 1), FINDING_AT[i]),
      );
    }
    later(() => {
      if (s === STAGES.length - 1) {
        traceIx = (traceIx + 1) % TRACES.length;
        enter(0);
      } else {
        enter(s + 1);
      }
    }, STAGE_MS[s]);
  }

  function finished() {
    const trace = TRACES[0];
    paintTrace(trace);
    tree.innerHTML = treeHtml(trace, trace.order.length);
    paintFindings(trace, trace.findings.length);
    steps.forEach((el) => el.classList.add("is-on"));
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  finished();

  return {
    setActive(on) {
      clear();
      if (reduced) return finished();
      if (on) {
        traceIx = 0;
        enter(0);
      }
    },
  };
}
