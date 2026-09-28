/* Section F: Integrations.
 *
 * Spec: docs/spec/SECTIONS.md "F. Integrations". Centred label, headline and
 * one-line subhead; a horizontal row of framework marks faded at both ends so
 * it reads as continuing past the viewport; two numbered monospace panels
 * below, side by side at desktop, the second carrying a copy affordance.
 *
 * Marks and copy are OURS. The names below are invented SDK names and the
 * glyphs are geometry written by hand, because vendoring a real framework's
 * logo is the one thing the section spec forbids twice.
 */

export const MOUNT = "#integrations";

/* The rail has to OVERFLOW its container for the edge fade to mean anything.
 * A mask over a row that already fits fades page background into page
 * background and looks identical to no mask at all. Measured in the render:
 * 13 cells x 150px = 1950px of rail inside a full-bleed clip. Measured in the
 * render: the rail box sits at x=-335 in a 1280 viewport and at x=-575 in an
 * 800 one, so it is cut by 335px and 575px on EACH side respectively and the
 * mask always has real ink to fade. The 150px cell width itself lives in
 * integrations.css, because nothing in JS reads it. */

/* Our own marks. Each glyph is a 18x18 viewBox of stroked primitives, all
 * stroke-width 1 so the row keeps one hairline weight across every cell. */
const MARKS = [
  {
    name: "Orchard",
    d: '<circle cx="9" cy="9" r="7"/><circle cx="9" cy="9" r="2.6"/>',
  },
  { name: "Vane", d: '<path d="M2 15 9 3l7 12z"/>' },
  {
    name: "Corda",
    d: '<rect x="2" y="2" width="14" height="14"/><rect x="6" y="6" width="6" height="6"/>',
  },
  { name: "Relay", d: '<path d="M3 5h8l4 4-4 4H3"/><path d="M3 9h8"/>' },
  { name: "Quill", d: '<path d="M9 2 16 9 9 16 2 9z"/>' },
  { name: "Lattice", d: '<path d="M2 6h14M2 12h14M6 2v14M12 2v14"/>' },
  {
    name: "Mesa",
    d: '<path d="M2 14h14"/><path d="M4 14V8h5v6"/><path d="M11 14V5h3v9"/>',
  },
  {
    name: "Kiln",
    d: '<path d="M9 2v14"/><path d="M3 6l6-4 6 4"/><path d="M3 12l6 4 6-4"/>',
  },
  {
    name: "Harbor",
    d: '<path d="M2 9a7 7 0 0 1 14 0"/><path d="M2 9h14"/><circle cx="9" cy="13" r="2"/>',
  },
  { name: "Drift", d: '<path d="M2 12c3.5 0 3.5-6 7-6s3.5 6 7 6"/>' },
  { name: "Pilot", d: '<circle cx="9" cy="9" r="7"/><path d="M9 2v14"/>' },
  {
    name: "Vector",
    d: '<path d="M3 15 15 3"/><path d="M15 3v6"/><path d="M15 3H9"/>',
  },
  {
    name: "Slate",
    d: '<rect x="2" y="4" width="14" height="10"/><path d="M2 8h14"/>',
  },
];

/* Our own env var names, our own project slug, our own fake key. The key is
 * obviously synthetic on purpose: a plausible-looking secret in a replica repo
 * is the kind of string someone later greps for and panics about. */
const ENV_LINES = [
  ["SIFT_API_KEY", '"lk_demo_not_a_real_key"'],
  ["SIFT_PROJECT", '"agents-prod"'],
  ["SIFT_SAMPLE_RATE", '"1.0"'],
];

/* Our own prompt copy, written for the agent-monitoring product this replica
 * is a study of. */
const PROMPT_LINES = [
  "Review the last 24 hours of traces on",
  "agents-prod. Flag every run where the agent",
  "answered from retrieved context that did not",
  "contain the answer, then group the flags by",
  "tool call and tell me which tool produces",
  "the most of them.",
];

const COPY_TEXT = PROMPT_LINES.join(" ").replace(/\s+/g, " ");

function markCell({ name, d }) {
  return `<div class="ig-mark">
      <svg class="ig-mark-glyph" viewBox="0 0 18 18" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1"
           stroke-linecap="square" stroke-linejoin="miter">${d}</g>
      </svg>
      <span class="ig-mark-name">${name}</span>
    </div>`;
}

function captionBar(num, text, withCopy) {
  return `<div class="ig-cap">
      <span class="ig-num" aria-hidden="true">${num}</span>
      <span class="ig-cap-text">${text}</span>
      ${
        withCopy
          ? `<button type="button" class="ig-copy" aria-label="Copy the prompt">
        <span class="ig-copy-label">Copy</span>
      </button>`
          : ""
      }
    </div>`;
}

export function render() {
  return `<div class="ig">
    <div class="wrap ig-head">
      <div class="label ig-label">Integrations</div>
      <h2 class="ig-title">Two lines of config, then ask in plain English.</h2>
      <p class="ig-sub">Drop the SDK into the framework you already run, set one key, and every
        agent run shows up as a trace you can interrogate.</p>
    </div>
${panel()}
  </div>`;
}

/* THE PANEL, SEPARATE FROM THE SECTION.

   Same reason as the other two: the reference's four feature blocks are four
   text columns scrolling past ONE pinned panel, so the panel is exported
   alone and the heading and lead come from the DEMO entry. `render()` above
   keeps working standalone.

   The framework rail comes with it. It is the part of this panel that says
   "drop it into what you already run", and without it the two config blocks
   are a screenshot of a dotfile. */
export function panel() {
  const rail = MARKS.map(markCell).join("");
  const envBody = ENV_LINES.map(
    ([k, v]) => `<div class="ig-line"><span class="ig-key">${k}</span><span
        class="ig-eq">=</span><span class="ig-val">${v}</span></div>`,
  ).join("");
  const promptBody = PROMPT_LINES.map(
    (line) => `<div class="ig-line ig-line-prompt">${line}</div>`,
  ).join("");
  return `
    <div class="ig-rail-clip" role="list" aria-label="Supported agent frameworks">
      <div class="ig-rail">${rail}</div>
    </div>

    <div class="wrap">
      <div class="ig-panels">
        <div class="ig-panel">
          ${captionBar("01", ".env.local", false)}
          <div class="ig-body">${envBody}</div>
        </div>
        <div class="ig-panel">
          ${captionBar("02", "ask sift", true)}
          <div class="ig-body">${promptBody}</div>
        </div>
      </div>
    </div>`;
}

export function mount(root) {
  const cleanups = [];

  /* Copy affordance. Clipboard access throws on an insecure origin and in a
   * headless context, so the label falls back to "Select" rather than lying
   * about having copied anything. */
  const copyBtn = root.querySelector(".ig-copy");
  const copyLabel = root.querySelector(".ig-copy-label");
  /* 1400ms: long enough that the label change is legible after a click without
   * the button sitting in a confirmed state while someone reads the panel.
   * Chosen, not measured off the reference. */
  const COPIED_HOLD_MS = 1400;
  let holdTimer = 0;

  if (copyBtn && copyLabel) {
    const onCopy = async () => {
      let ok = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(COPY_TEXT);
          ok = true;
        }
      } catch {
        ok = false;
      }
      copyLabel.textContent = ok ? "Copied" : "Select";
      copyBtn.classList.toggle("is-done", ok);
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        copyLabel.textContent = "Copy";
        copyBtn.classList.remove("is-done");
      }, COPIED_HOLD_MS);
    };
    copyBtn.addEventListener("click", onCopy);
    cleanups.push(() => {
      copyBtn.removeEventListener("click", onCopy);
      clearTimeout(holdTimer);
    });
  }

  /* Entrance. One shot, unobserved once it fires, so scrolling back never
   * replays it and there is no elapsed time to bank. prefers-reduced-motion
   * lands on the finished state in CSS, so nothing here is gated on it. */
  const staged = Array.from(
    root.querySelectorAll(".ig-head, .ig-rail-clip, .ig-panel"),
  );
  if (!("IntersectionObserver" in window)) {
    staged.forEach((el) => el.classList.add("is-in"));
    return () => cleanups.forEach((fn) => fn());
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    },
    /* 0.15: the panels are ~200px tall against a 900px viewport, so a
     * threshold this low fires while the panel is still entering rather than
     * after it has already settled in the middle of the screen. */
    { threshold: 0.15 },
  );
  staged.forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());

  return () => cleanups.forEach((fn) => fn());
}
