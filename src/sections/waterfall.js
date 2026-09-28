/* Section G: the trace waterfall panel.
 *
 * Mechanism read out of the reference's chunk 8331 (TraceShowcaseVisual):
 * a header row, an occurrences block of expandable findings, and a nested
 * span tree whose bars are positioned and sized by each span's offset and
 * length inside the trace. See docs/spec/SECTIONS.md section G.
 *
 * The trace below is ours. It is a support-triage agent run written for this
 * repo: our span names, our findings, our durations.
 */

export const MOUNT = "#waterfall";

/* ---- the trace ------------------------------------------------------- *
 * start and dur are milliseconds from the start of the trace. Depth is NOT
 * stored: it comes from the nesting, so a row can never be indented to a
 * level its parent does not actually have.
 */
const TRACE_ID = "tr_9f41c2ad8e7b0356";

const TRACE = {
  kind: "agent",
  name: "agent.run triage_ticket",
  start: 0,
  dur: 4820,
  children: [
    { kind: "guard", name: "guardrail.input_scope", start: 12, dur: 96 },
    { kind: "gen", name: "llm.plan_route", start: 118, dur: 742 },
    {
      kind: "tool",
      name: "tool.fetch_ticket",
      start: 872,
      dur: 268,
      children: [
        { kind: "retr", name: "retrieve.ticket_thread", start: 902, dur: 214 },
      ],
    },
    {
      kind: "retr",
      name: "retrieve.kb_passages",
      start: 1156,
      dur: 1486,
      children: [
        { kind: "vec", name: "vector.search kb_chunks_v3", start: 1180, dur: 604, note: "41 hits" },
        {
          kind: "vec",
          name: "vector.search runbooks_v1",
          start: 1802,
          dur: 392,
          error: true,
          note: "0 hits",
        },
        { kind: "gen", name: "llm.rerank_passages", start: 2208, dur: 418 },
      ],
    },
    {
      kind: "tool",
      name: "tool.post_reply",
      start: 2664,
      dur: 834,
      children: [
        {
          kind: "gen",
          name: "llm.compose_reply",
          start: 2690,
          dur: 726,
          children: [
            { kind: "guard", name: "guardrail.pii_redact", start: 3208, dur: 184 },
          ],
        },
      ],
    },
    {
      kind: "gen",
      name: "llm.summarize_resolution",
      start: 3512,
      dur: 1192,
      children: [
        { kind: "guard", name: "guardrail.output_policy", start: 4598, dur: 98 },
      ],
    },
    /* THE TAIL. Added 2026-09-28 because the panel sat 380px tall inside a
       900px stage with white under it, and theirs fills the height.

       Padding would have been the wrong fix. The heading over this panel is
       "read every span", and a trace that stops after the reply is sent is
       exactly the trace that misses what this product is for: the work an
       agent does AFTER it has answered. So the tail is the part that
       matters, and it is where both findings now live.

       Timings continue from 4704 and stay inside the 4820 total. */
    {
      kind: "tool",
      name: "tool.update_ticket",
      start: 4704,
      dur: 96,
      children: [
        { kind: "retr", name: "retrieve.ticket_state", start: 4712, dur: 38 },
        { kind: "guard", name: "guardrail.write_scope", start: 4758, dur: 34 },
      ],
    },
    {
      kind: "tool",
      name: "tool.emit_metrics",
      start: 4712,
      dur: 74,
      note: "3 counters",
      children: [
        { kind: "vec", name: "vector.upsert trace_embedding", start: 4720, dur: 52 },
      ],
    },
    {
      kind: "gen",
      name: "llm.label_resolution",
      start: 4736,
      dur: 68,
      error: true,
      note: "schema mismatch",
    },
    { kind: "guard", name: "guardrail.pii_audit", start: 4762, dur: 44 },
    { kind: "agent", name: "agent.close triage_ticket", start: 4790, dur: 28 },
  ],
};

/* Our own findings, both of them derivable from the trace above:
 * runbooks_v1 returned nothing, and the summary starts 3512 - 3498 = 14ms
 * after the reply span returns. */
const FINDINGS = [
  {
    id: "wf-f1",
    title: "Retrieval fell back to a stale index",
    runs: "38 runs",
    span: "vector.search runbooks_v1",
    body:
      "The runbook index returned 0 hits in 392ms and the run carried on with kb_chunks_v3 alone. Nothing failed, so nothing paged anyone. The index had not been rebuilt in 9 days.",
  },
  {
    id: "wf-f2",
    title: "The summary ran after the reply was already out",
    runs: "12 runs",
    span: "llm.summarize_resolution",
    body:
      "tool.post_reply returns at 3.50s and the summary starts 14ms later, so the resolution note is written from the reply instead of checked against it. Every one of these looks clean in the reply and wrong in the log.",
  },
];

/* ---- geometry -------------------------------------------------------- */

/** Depth-first flatten. Depth is the nesting level, computed here. */
function flatten(node, depth, out) {
  out.push({
    kind: node.kind,
    name: node.name,
    start: node.start,
    dur: node.dur,
    error: Boolean(node.error),
    note: node.note || "",
    depth,
  });
  (node.children || []).forEach((child) => flatten(child, depth + 1, out));
  return out;
}

export const SPANS = flatten(TRACE, 0, []);
export const TOTAL_MS = TRACE.dur;
export const MAX_DEPTH = SPANS.reduce((m, s) => Math.max(m, s.depth), 0);

/**
 * A span's bar geometry as percentages of the track. This is the whole point
 * of the panel: nothing about a bar is placed by hand.
 */
export function geometry(span, total = TOTAL_MS) {
  return {
    left: (span.start / total) * 100,
    width: (span.dur / total) * 100,
  };
}

function ms(value) {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(2)}s`;
}

/* ---- timing ---------------------------------------------------------- *
 * 220ms is the reference's most common transition duration, 1684 occurrences
 * across its stylesheet (ux-engine/research/REFERENCE-SPEC.md, "Motion").
 */
const ROW_FADE_MS = 220;

/* Derived from the repo's own recorded target, "700ms draw-ons at 15-20ms
 * stagger" (PLAN.md 4.2): the last row has to finish inside 700ms, so with a
 * 220ms fade the 13 gaps between 14 rows get (700 - 220) / 13 = 36.9ms each.
 * At the measured 20ms the sweep is over in 260ms and reads as one block
 * appearing rather than as a waterfall. */
const ROW_STAGGER_MS = 36;

const REVEAL_TOTAL_MS = ROW_STAGGER_MS * SPANS.length + ROW_FADE_MS;

/* ---- icons ----------------------------------------------------------- *
 * One glyph per span kind, 10x10, currentColor so the kind colour drives it.
 */
const ICONS = {
  agent:
    '<circle cx="5" cy="5" r="3.4"/><circle cx="5" cy="5" r=".9" fill="currentColor" stroke="none"/>',
  gen: '<path d="M1.5 3h7M1.5 5h5M1.5 7h3"/>',
  tool: '<path d="M3.4 1.6H1.6v6.8h1.8M6.6 1.6h1.8v6.8H6.6"/>',
  retr: '<path d="M5 1.4v4.4M3.2 4.2 5 6l1.8-1.8M1.6 8.4h6.8"/>',
  vec: '<circle cx="5" cy="2.2" r=".95"/><circle cx="2.2" cy="7.2" r=".95"/><circle cx="7.8" cy="7.2" r=".95"/>',
  guard:
    '<path d="M5 1.2 8.4 2.6v3C8.4 7.3 5 8.8 5 8.8S1.6 7.3 1.6 5.6v-3z"/>',
};

const KIND_LABEL = {
  agent: "agent run",
  gen: "text generation",
  tool: "tool call",
  retr: "retrieval",
  vec: "vector search",
  guard: "guardrail check",
};

function iconSvg(kind) {
  return (
    `<svg class="wf-ico" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round" ` +
    `stroke-linejoin="round">${ICONS[kind]}</svg>`
  );
}

/* ---- render ---------------------------------------------------------- */

function rowHtml(span, index) {
  const { left, width } = geometry(span);
  return `
      <li class="wf-row${span.error ? " is-error" : ""}" data-kind="${span.kind}"
          data-index="${index}" data-start="${span.start}" data-dur="${span.dur}"
          style="--depth:${span.depth}">
        ${span.error ? '<span class="wf-mark" aria-hidden="true"></span>' : ""}
        <span class="wf-name">
          ${iconSvg(span.kind)}<span class="wf-sr">${KIND_LABEL[span.kind]}${
            span.error ? ", error" : ""
          }</span><span class="wf-nm">${span.name}</span>${
            span.note ? `<span class="wf-note">${span.note}</span>` : ""
          }
        </span>
        <span class="wf-dur">${ms(span.dur)}</span>
        <span class="wf-track">
          <span class="wf-bar" style="left:${left.toFixed(4)}%;width:${width.toFixed(
            4,
          )}%"></span>
        </span>
      </li>`;
}

function findingHtml(finding) {
  return `
        <div class="wf-find">
          <button class="wf-find-hd" type="button" aria-expanded="false" aria-controls="${finding.id}">
            <svg class="wf-chev" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"
                 fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"
                 stroke-linejoin="round"><path d="M3.6 2 6.8 5 3.6 8"/></svg>
            <span class="wf-find-t">${finding.title}</span>
            <span class="wf-find-n">${finding.runs}</span>
          </button>
          <div class="wf-find-bd" id="${finding.id}" hidden>
            <p class="wf-find-p">${finding.body}</p>
            <p class="wf-find-sp">${finding.span}</p>
          </div>
        </div>`;
}

/* THE PANEL, SEPARATE FROM THE SECTION.

   This module used to render a whole standalone section: its own label,
   heading, lead and panel. That section had no counterpart on the reference,
   whose four feature blocks are four text columns scrolling past ONE pinned
   panel. So the panel is now exported on its own and mounted inside that
   pinned stage, where the heading and lead come from the DEMO entry instead.

   `render()` is kept and calls this, so the module still works standalone if
   it is ever wanted back. */
export function panel() {
  const errors = SPANS.filter((s) => s.error).length;
  return `
  <div class="wf-panel">
    <div class="wf-hd">
      <span class="wf-tid">${TRACE_ID}</span>
      <span class="wf-hd-meta">
        <span class="wf-hd-v">${ms(TOTAL_MS)}</span>
        <span class="wf-hd-sep" aria-hidden="true"></span>
        <span class="wf-hd-v">${SPANS.length} spans</span>
        ${
          errors
            ? `<span class="wf-hd-sep" aria-hidden="true"></span><span class="wf-hd-err">${errors} error</span>`
            : ""
        }
      </span>
    </div>

    <div class="wf-occ">
      <p class="wf-occ-label">Occurrences</p>
      ${FINDINGS.map(findingHtml).join("")}
    </div>

    <div class="wf-tree">
      <div class="wf-cols" aria-hidden="true">
        <span>Span</span><span>Dur</span><span>Offset in trace</span>
      </div>
      <ol class="wf-rows">${SPANS.map(rowHtml).join("")}</ol>
    </div>
  </div>`;
}

export function render() {
  return `
<div class="wf">
  <div class="wf-copy">
    <p class="wf-label">Traces</p>
    <h2 class="wf-h">Read every span, not just the ones that errored.</h2>
    <p class="wf-sub">Every span of every run, timed against the one before it.
      The audit reads the whole tree, so a retrieval that quietly fell back to a
      stale index shows up as a finding instead of as a good answer.</p>
  </div>
${panel()}
</div>`;
}

/* ---- mount ----------------------------------------------------------- */

export function mount(root) {
  const rows = Array.from(root.querySelectorAll(".wf-row"));
  const teardown = [];

  /* Findings. The body is hidden outright so it is out of the tab order, then
   * given a frame before the class lands so the transition has two states to
   * run between. */
  root.querySelectorAll(".wf-find-hd").forEach((button) => {
    const body = root.querySelector(`#${button.getAttribute("aria-controls")}`);
    let closeTimer = 0;
    const onClick = () => {
      const open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", open ? "false" : "true");
      if (open) {
        body.classList.remove("is-open");
        closeTimer = window.setTimeout(() => {
          body.hidden = true;
        }, ROW_FADE_MS);
      } else {
        window.clearTimeout(closeTimer);
        body.hidden = false;
        requestAnimationFrame(() => body.classList.add("is-open"));
      }
    };
    button.addEventListener("click", onClick);
    teardown.push(() => {
      button.removeEventListener("click", onClick);
      window.clearTimeout(closeTimer);
    });
  });

  const settle = () => rows.forEach((row) => row.classList.add("is-in"));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    settle();
    return () => teardown.forEach((fn) => fn());
  }

  /* Elapsed time is banked, not restarted: leaving the panel mid-sweep and
   * scrolling back resumes where it stopped. */
  let elapsed = 0;
  let lastFrame = 0;
  let running = false;
  let raf = 0;

  const apply = () => {
    for (let i = 0; i < rows.length; i += 1) {
      if (elapsed >= i * ROW_STAGGER_MS) rows[i].classList.add("is-in");
    }
  };

  const frame = (now) => {
    if (!running) return;
    if (lastFrame) elapsed += now - lastFrame;
    lastFrame = now;
    apply();
    if (elapsed < REVEAL_TOTAL_MS) {
      raf = requestAnimationFrame(frame);
    } else {
      running = false;
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (!running && elapsed < REVEAL_TOTAL_MS) {
            running = true;
            lastFrame = 0;
            raf = requestAnimationFrame(frame);
          }
        } else {
          running = false;
          lastFrame = 0;
          cancelAnimationFrame(raf);
        }
      });
    },
    { threshold: 0.15 },
  );

  const panel = root.querySelector(".wf-panel");
  if (panel) observer.observe(panel);

  return () => {
    observer.disconnect();
    cancelAnimationFrame(raf);
    teardown.forEach((fn) => fn());
  };
}
