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
   are abstract shapes drawn for this page and stand for nothing real. Each
   is a 28px box like theirs (every item measured 28x28 at 1440). The
   seventh is theirs' "coming soon" slot: not a link, and dimmer. */
const GLYPHS = [
  `<path d="M14 4 25 23H3z"/>`,
  `<circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="14" cy="14" r="3.2"/>`,
  `<rect x="4" y="6" width="20" height="5" rx="2.5"/><rect x="4" y="12" width="14" height="5" rx="2.5"/><rect x="4" y="18" width="20" height="5" rx="2.5" opacity=".6"/>`,
  `<path d="M5 23 14 5l9 18-9-5z"/>`,
  `<path d="M4 6h8l12 16h-8z"/><path d="M4 22h7l-3.5-5z"/>`,
  `<rect x="3" y="8" width="22" height="12" rx="6"/><circle cx="10" cy="14" r="2.2" fill="#f2f2f2"/><circle cx="18" cy="14" r="2.2" fill="#f2f2f2"/>`,
  `<path d="M4 22 10 6h3L7 22z"/><path d="M12 22 18 6h3l-6 16z" opacity=".7"/><path d="M20 22l3-8 2 8z" opacity=".45"/>`,
];
/* Our names for the seven, generic on purpose: each glyph is a way of
   getting runs into Sift, not anybody's product. The last is not built. */
const GLYPH_NAMES = [
  "Python SDK",
  "TypeScript SDK",
  "Batch import",
  "REST ingest",
  "Queue workers",
  "Webhook export",
  "Streaming ingest",
];
const SOON = 6;

/* ---- the integrations marquee -------------------------------------------
   Theirs (chunk 768, module 68482): the items rendered twice in one flex
   row, gap 48 (gap-12), padding 8/16 (py-2 px-4), inside a box 70% of the
   column (526.4 of 752 at 1440), 64px fades at both edges from the
   background to transparent. A rAF loop advances it 0.02px per ms with the
   frame delta capped at 50ms, and wraps by half the content. Touch, pointer
   down and wheel hold it for 2500ms. An IntersectionObserver runs the loop
   only while the row is on screen, and under reduced motion it never
   starts.

   Theirs scrolls the box (scrollLeft); ours moves the track with a
   transform, per this repo's rule, and holds the offset while paused or
   offscreen, which is the bank. Theirs wraps at scrollWidth / 2, which
   counts the row's own 32px of padding and one gap fewer than a period
   (1048 / 2 = 524 against a true period of 7 x 76 = 532), so every lap
   jumps 8px. Ours wraps at the measured offset of the second copy, the
   true period, and does not jump. */
const MQ_PX_PER_MS = 0.02;
const MQ_MAX_DT = 50;
const MQ_HOLD_MS = 2500;

function glyphSvg(g) {
  return `<svg viewBox="0 0 28 28" width="28" height="28" fill="currentColor" aria-hidden="true" focusable="false">${g}</svg>`;
}

/* One copy of the seven. `copy` is false for the duplicate, which exists
   only to fill the loop: hidden from assistive tech and out of the tab
   order, so a keyboard user meets each link once. */
function mqSet(copy) {
  const items = GLYPHS.map((g, i) => {
    const name = GLYPH_NAMES[i];
    if (i === SOON) {
      return `<span class="lw-mq-item is-soon"${copy ? ` role="img" aria-label="${name}, coming soon"` : ""}>${glyphSvg(g)}</span>`;
    }
    return copy
      ? `<a class="lw-mq-item" href="#" aria-label="${name}">${glyphSvg(g)}</a>`
      : `<a class="lw-mq-item" href="#" tabindex="-1">${glyphSvg(g)}</a>`;
  }).join("");
  return `<div class="lw-mq-set"${copy ? "" : ' aria-hidden="true"'}>${items}</div>`;
}

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
      <div class="lw-mq" role="group" aria-label="Integrations">
        <div class="lw-mq-row"><div class="lw-mq-track">${mqSet(true)}${mqSet(false)}</div></div>
        <div class="lw-mq-fade is-l" aria-hidden="true"></div>
        <div class="lw-mq-fade is-r" aria-hidden="true"></div>
      </div>
      <div class="lw-steps">
        <div class="lw-step">
          <div class="lw-step-h"><span class="lw-step-n">1</span><h3 class="lw-step-t">Create a project key</h3></div>
          <div class="lw-code">
            <div class="lw-code-h">.env.example</div>
            <div class="lw-code-b">
              <div><span class="lw-k">SIFT_API_KEY</span><span class="lw-eq">=</span><span class="lw-v">paste_key_here</span></div>
              <div><span class="lw-k">SIFT_PROJECT_ID</span><span class="lw-eq">=</span><span class="lw-v lw-scramble">0aea4e153c71b2</span></div>
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
      <div class="lw-chips">${TRUST.map(([t]) => `<span class="lw-chip">${t}</span>`).join("")}</div>
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

/* Runs the integrations marquee in `wrap`. Returns a cleanup. */
function mountMarquee(wrap) {
  const row = wrap.querySelector(".lw-mq-row");
  const track = wrap.querySelector(".lw-mq-track");
  const sets = wrap.querySelectorAll(".lw-mq-set");
  if (!row || !track || sets.length < 2) return () => {};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  let x = 0; /* px travelled, banked across pauses */
  let period = 0;
  let last = 0;
  let raf = 0;
  let onScreen = false;
  let holdUntil = 0;
  let focused = false;

  const measure = () => {
    period = sets[1].offsetLeft - sets[0].offsetLeft;
  };
  const paint = () => {
    track.style.transform = `translate3d(${(-x).toFixed(2)}px,0,0)`;
  };
  const running = () => onScreen && !focused && !reduced.matches && !document.hidden;

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(MQ_MAX_DT, now - last) : 0;
    last = now;
    if (now > holdUntil && period > 0) {
      x += MQ_PX_PER_MS * dt;
      if (x >= period) x -= period;
      paint();
    }
    if (running()) raf = requestAnimationFrame(frame);
  }
  function update() {
    if (running()) {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  /* Reduced motion: the finished state is the row at rest with its first
     copy showing; lower.css lets it scroll by hand instead. */
  const syncReduced = () => {
    wrap.classList.toggle("is-static", reduced.matches);
    if (reduced.matches) {
      x = 0;
      track.style.transform = "";
    }
    update();
  };

  const hold = () => {
    holdUntil = performance.now() + MQ_HOLD_MS;
  };
  /* A focused link must be on screen. Theirs gets this free from the
     browser scrolling its box; ours moves the track so the link sits in
     the middle, then holds still until focus leaves the row. */
  const onFocusIn = (e) => {
    focused = true;
    update();
    const item = e.target.closest(".lw-mq-item");
    if (!item || reduced.matches || !period) return;
    const at = item.offsetLeft + item.offsetWidth / 2 - row.clientWidth / 2;
    /* Clamped, not wrapped: wrapping would centre the hidden duplicate
       and leave the focused original out of view. */
    x = Math.max(0, Math.min(at, period - 0.01));
    paint();
  };
  const onFocusOut = (e) => {
    if (wrap.contains(e.relatedTarget)) return;
    focused = false;
    update();
  };
  const onVis = () => update();

  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    update();
  });
  const ro = new ResizeObserver(() => {
    measure();
    if (period > 0) x %= period;
  });

  measure();
  ro.observe(track);
  io.observe(wrap);
  row.addEventListener("pointerdown", hold);
  row.addEventListener("touchstart", hold, { passive: true });
  row.addEventListener("wheel", hold, { passive: true });
  wrap.addEventListener("focusin", onFocusIn);
  wrap.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onVis);
  reduced.addEventListener("change", syncReduced);
  syncReduced();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    row.removeEventListener("pointerdown", hold);
    row.removeEventListener("touchstart", hold);
    row.removeEventListener("wheel", hold);
    wrap.removeEventListener("focusin", onFocusIn);
    wrap.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("visibilitychange", onVis);
    reduced.removeEventListener("change", syncReduced);
  };
}

/* ---- the project id that never settles ----------------------------------
   Theirs (chunk 768, module 54032, mounted on the second .env line with
   length 14): a hex string where every 90ms each character is re-rolled
   with probability .16, forever, so the value shimmers while the key above
   it stays put. It was the 5267px change inside the integrations band in
   the 2026-10-03 idle sweep (bbox down to y 432 at scroll 14500) that ours
   lacked. Their seed is a fixed pattern; ours starts from our own value.
   Reduced motion: it never starts. Theirs keeps its interval running
   offscreen; ours stops while the line is out of view. The text is
   monospace, so a swap moves nothing around it. */
const SCRAMBLE_MS = 90;
const SCRAMBLE_P = 0.16;
const HEX = "0123456789abcdef";

function mountScramble(el) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const chars = [...el.textContent.trim()];
  let timer = 0;
  const tick = () => {
    for (let i = 0; i < chars.length; i++)
      if (Math.random() < SCRAMBLE_P) chars[i] = HEX[Math.floor(Math.random() * 16)];
    el.textContent = chars.join("");
  };
  let onScreen = false;
  const update = () => {
    const run = onScreen && !reduced.matches && !document.hidden;
    if (run && !timer) timer = setInterval(tick, SCRAMBLE_MS);
    if (!run && timer) {
      clearInterval(timer);
      timer = 0;
    }
  };
  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    update();
  });
  io.observe(el);
  document.addEventListener("visibilitychange", update);
  reduced.addEventListener("change", update);
  return () => {
    clearInterval(timer);
    io.disconnect();
    document.removeEventListener("visibilitychange", update);
    reduced.removeEventListener("change", update);
  };
}

export function mount(root) {
  const mq = root.querySelector(".lw-mq");
  const stopMarquee = mq ? mountMarquee(mq) : null;
  const scr = root.querySelector(".lw-scramble");
  const stopScramble = scr ? mountScramble(scr) : null;

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
      /* Theirs runs from page load, offscreen too; see mesh-gradient.js. */
      wallClock: true,
      onLost: () => cta.classList.remove("is-mesh"),
    });
    if (stopMesh) cta.classList.add("is-mesh");
  }

  return () => {
    stopMarquee?.();
    stopScramble?.();
    stopMesh?.();
    clearTimeout(timer);
    copyBtn?.removeEventListener("click", onCopy);
    cookieBtn?.removeEventListener("click", onCookie);
  };
}
