/* Everything below the pinned demo, plus the footer. Owned by one writer; see
   README. Geometry in lower.css is read off their page at 1440x900
   (lower-brief/p_ref2.txt). Every word, glyph and number here is ours. */
export const MOUNT = "#lower";

import { attachMeshGradient, MESH_COLORS } from "./mesh-gradient.js";

/* The three-layer mark from the header in index.html, so the footer logo is
   the same drawing at a larger size rather than a second design. */
const MARK = (w, h) => `
  <svg viewBox="0 0 22 20" width="${w}" height="${h}" aria-hidden="true">
    <path d="M11 1 1 6l10 5 10-5z" fill="#1d1956"/>
    <path d="M1 10.5 11 15.5 21 10.5" fill="none" stroke="#755cfe" stroke-width="1.6"/>
    <path d="M1 14.5 11 19.5 21 14.5" fill="none" stroke="#755cfe" stroke-width="1.6" opacity=".55"/>
  </svg>`;

/* Seven framework glyphs. Theirs is a row of seven third-party marks; ours
   are abstract shapes drawn for this page and stand for nothing real. 28px
   box, centres 76px apart like theirs (475, 551 ... 931 at 1440). */
const GLYPHS = [
  `<path d="M14 4 25 23H3z"/>`,
  `<circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="14" cy="14" r="3.2"/>`,
  `<rect x="4" y="6" width="20" height="5" rx="2.5"/><rect x="4" y="12" width="14" height="5" rx="2.5"/><rect x="4" y="18" width="20" height="5" rx="2.5" opacity=".6"/>`,
  `<path d="M5 23 14 5l9 18-9-5z"/>`,
  `<path d="M4 6h8l12 16h-8z"/><path d="M4 22h7l-3.5-5z"/>`,
  `<rect x="3" y="8" width="22" height="12" rx="6"/><circle cx="10" cy="14" r="2.2" fill="#f2f2f2"/><circle cx="18" cy="14" r="2.2" fill="#f2f2f2"/>`,
  `<path d="M4 22 10 6h3L7 22z"/><path d="M12 22 18 6h3l-6 16z" opacity=".7"/><path d="M20 22l3-8 2 8z" opacity=".45"/>`,
];

const COPY_ICON = `
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <rect x="3.5" y="0.5" width="8" height="8" fill="none" stroke="currentColor"/>
    <path d="M2.5 3.5h-2v8h8v-2" fill="none" stroke="currentColor"/>
  </svg>`;

/* Copy is ours. tools/check_copy.py refuses any of their strings of 18+
   characters, which is why nothing below matches their wording. */
const TRUST = [
  ["SOC 2 Type II", "Audited by a third party, every year."],
  ["Encrypted end to end", "AES-256 on disk, TLS 1.3 on the wire."],
  ["Data isolation", "Every org gets its own isolated store."],
];

const FOOT_COLS = [
  [
    "Resources",
    [
      ["Docs", "#"],
      ["Blog", "#"],
      ["Weekly", "#"],
      ["Changelog", "#"],
      ["Careers", "#careers", "careers"],
      ["Trust center", "#"],
    ],
  ],
  [
    "Company",
    [
      ["About", "#"],
      ["Status", "#"],
      ["Contact", "mailto:hello@sift.example"],
    ],
  ],
];

export function render() {
  const glyphs = GLYPHS.map(
    (g) =>
      `<svg class="lw-fw" viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true">${g}</svg>`,
  ).join("");

  const trust = TRUST.map(
    ([t, d]) => `
        <div class="lw-trust-item">
          <p class="lw-trust-t">${t}</p>
          <p class="lw-trust-d">${d}</p>
        </div>`,
  ).join("");

  return `
  <section class="lw-band" aria-labelledby="lw-int-h">
    <div class="lw-band-in">
      <header class="lw-head">
        <p class="lw-eyebrow">Integrations</p>
        <h2 id="lw-int-h" class="lw-h2">Drops into the stack you already run.</h2>
        <p class="lw-lead">Tracing hooks for the agent frameworks your team ships on today.</p>
      </header>
      <div class="lw-fws" aria-hidden="true">${glyphs}</div>
      <div class="lw-steps">
        <div class="lw-step">
          <div class="lw-step-h"><span class="lw-step-n">1</span><h3 class="lw-step-t">Create a project key</h3></div>
          <div class="lw-code">
            <div class="lw-code-h">.env.example</div>
            <div class="lw-code-b">
              <div><span class="lw-k">SIFT_API_KEY</span><span class="lw-eq">=</span><span class="lw-v">paste_key_here</span></div>
              <div><span class="lw-k">SIFT_PROJECT_ID</span><span class="lw-eq">=</span><span class="lw-v">0aea4e153c71b2</span></div>
            </div>
          </div>
        </div>
        <div class="lw-step">
          <div class="lw-step-h"><span class="lw-step-n">2</span><h3 class="lw-step-t">Hand it to your coding agent</h3></div>
          <div class="lw-code">
            <div class="lw-code-h"><span>Prompt</span>
              <button class="lw-copy" type="button" aria-label="Copy prompt">${COPY_ICON}</button></div>
            <div class="lw-code-b lw-prompt">Run npx sift-skill init, then use it to add tracing to every agent entry point in this repo.</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="lw-band" aria-labelledby="lw-sec-h">
    <div class="lw-band-in">
      <header class="lw-head">
        <p class="lw-eyebrow">Security</p>
        <h2 id="lw-sec-h" class="lw-h2">Your traces stay yours.</h2>
        <p class="lw-lead">Traces carry customer data, so we treat them that way.<br>
          Audited controls, encrypted everywhere, nothing shared.</p>
      </header>
      <div class="lw-trust">${trust}
      </div>
      <div class="lw-trust-cta"><a class="lw-btn lw-btn-ghost" href="#">View trust center</a></div>
    </div>
  </section>

  <section id="testimonials" data-reveal></section>

  <section class="lw-news" aria-labelledby="lw-news-h">
    <div class="lw-news-box">
      <div class="lw-news-grid">
        <div class="lw-news-l">
          <p class="lw-news-eyebrow">Sift Weekly</p>
          <h2 id="lw-news-h" class="lw-news-h2">A Friday read on why agents break, and what caught it.</h2>
          <div class="lw-issue">
            <p class="lw-issue-meta">Latest &middot; Issue 014 &middot; September 25, 2026</p>
            <a class="lw-issue-t group" href="#"><span class="ul-grow">The refund that ran twice</span></a>
            <p class="lw-issue-b">A support agent retried a payment tool after a timeout, got two
              success responses back, and told the customer all was well. How the duplicate
              surfaced nine days later, and the check that now catches it on the first run.</p>
            <div class="lw-issue-links">
              <a class="lw-link-latest group" href="#"><span class="ul-grow">Read the latest issue</span></a>
              <a class="lw-link-all group" href="#"><span class="ul-grow">View all issues</span></a>
            </div>
          </div>
        </div>
        <div class="lw-news-r">
          <h2 class="lw-sub-h">Subscribe</h2>
          <p class="lw-sub-p">One email on Friday, on what actually broke this week.</p>
          <form class="lw-form" onsubmit="return false">
            <input class="lw-input" type="email" placeholder="you@work.com" aria-label="Email address" autocomplete="email">
            <button class="lw-submit" type="submit">Get Weekly</button>
          </form>
          <p class="lw-sub-note">Fridays only. Leave whenever.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="lw-cta" aria-labelledby="lw-cta-h">
    <div class="lw-cta-mesh" aria-hidden="true"></div>
    <div class="lw-cta-in">
      <h2 id="lw-cta-h" class="lw-cta-h">See what your agents did today</h2>
      <a class="lw-btn lw-btn-ghost" href="#">Book a demo</a>
    </div>
  </section>`;
}

export function renderFooter() {
  const cols = FOOT_COLS.map(
    ([h, links]) => `
        <div class="lw-foot-col">
          <h3 class="lw-foot-h">${h}</h3>
          <ul>${links
            .map(
              ([t, href, id]) =>
                `<li><a class="group" href="${href}"${id ? ` id="${id}"` : ""}><span class="ul-grow">${t}</span></a></li>`,
            )
            .join("")}</ul>
        </div>`,
  ).join("");

  return `
  <footer class="lw-foot">
    <div class="lw-foot-in">
      <div class="lw-foot-brand">
        <a class="lw-foot-logo" href="#top">${MARK(36, 33)}<span>Sift</span></a>
        <p class="lw-foot-tag">Every agent run, replayed and graded.</p>
      </div>
      <nav class="lw-foot-links" aria-label="Footer">${cols}
      </nav>
    </div>
    <div class="lw-foot-bar">
      <div class="lw-foot-bar-in">
        <p class="lw-copyright">&copy; 2026 Sift Labs, Inc.</p>
        <button class="lw-cookie-btn group" type="button"><span class="ul-grow">Cookie settings</span></button>
        <p class="lw-contact">Any questions? contact hello@sift.example</p>
      </div>
    </div>
  </footer>`;
}

export function mount(root) {
  /* The one write outside root the contract allows: the footer slot. */
  const foot = document.querySelector("#lower-footer");
  if (foot && !foot.firstElementChild) foot.innerHTML = renderFooter();

  /* The cookie card lives in index.html, outside both roots, so the footer
     only announces the request. app.js can listen for it and unhide the card. */
  const cookieBtn = foot && foot.querySelector(".lw-cookie-btn");
  const onCookie = () =>
    document.dispatchEvent(new CustomEvent("sift:cookie-settings"));
  cookieBtn?.addEventListener("click", onCookie);

  /* Copies the prompt text, and acknowledges by swapping the button label
     for 1.2s. Clipboard can reject outside a secure context; then nothing
     happens and nothing throws. */
  const copyBtn = root.querySelector(".lw-copy");
  const prompt = root.querySelector(".lw-prompt");
  let timer = 0;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.textContent.trim());
      copyBtn.classList.add("is-done");
      clearTimeout(timer);
      timer = setTimeout(() => copyBtn.classList.remove("is-done"), 1200);
    } catch {
      /* clipboard unavailable: leave the button as it was */
    }
  };
  copyBtn?.addEventListener("click", onCopy);

  /* The band's mesh. Theirs mounts the same shader behind the CTA text with
     the parameters in mesh-gradient.js. Without WebGL the CSS gradient on
     .lw-cta stays, which is our stand-in for their #1D1956 fallback. */
  const cta = root.querySelector(".lw-cta");
  const meshHost = root.querySelector(".lw-cta-mesh");
  let stopMesh = null;
  if (cta && meshHost) {
    stopMesh = attachMeshGradient(meshHost, {
      colors: MESH_COLORS,
      onLost: () => cta.classList.remove("is-mesh"),
    });
    if (stopMesh) cta.classList.add("is-mesh");
  }

  return () => {
    stopMesh?.();
    clearTimeout(timer);
    copyBtn?.removeEventListener("click", onCopy);
    cookieBtn?.removeEventListener("click", onCookie);
  };
}
