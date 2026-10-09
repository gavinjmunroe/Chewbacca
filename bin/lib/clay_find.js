// Locates and presses one control on the Clay page for clay-build. Plain
// script on purpose: clay_page.py inlines this file into a single
// `chewie web eval` expression, and tests/test_clay_find.mjs loads it under
// node, where only the pure functions at the top run.

function normalise(text) {
  return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
}

function matches(text, alt) {
  const t = normalise(text);
  if (alt.text_re !== undefined) return new RegExp(alt.text_re).test(t);
  if (alt.text === undefined) return true;
  const want = normalise(alt.text);
  if (alt.match === "prefix") return t.startsWith(want);
  if (alt.match === "contains") return t.includes(want);
  return t === want;
}

// The label a control sits under: the nearest earlier sibling with text that
// is not another control of the same tag. Siblings only: Clay's Find leads
// flyout on 2026-10-09 was one flat list ("Search directly", five buttons,
// "Create a workflow", two buttons), and a control with no labelled sibling
// gets no section, so a recipe asking for one stops instead of guessing.
function sectionOf(el) {
  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
    if (sib.tagName === el.tagName) continue;
    const text = normalise(sib.innerText);
    if (text) return text;
  }
  return "";
}

function startsWith(have, want) {
  return want === undefined || normalise(have).startsWith(normalise(want));
}

// One visible match, or the reason there is not one. Two matches stop the
// run rather than pressing whichever came first in the DOM.
function pick(candidates, alt) {
  const hits = candidates.filter((c) => c.visible && matches(c.text, alt)
    && startsWith(c.placeholder, alt.placeholder) && startsWith(c.section, alt.section));
  if (hits.length === 0) return { ok: false, reason: "missing" };
  if (hits.length > 1) return { ok: false, reason: "ambiguous", count: hits.length };
  return { ok: true, index: hits[0].index };
}

function describe(el, index) {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    index,
    text: el.innerText || el.value || el.getAttribute("aria-label") || "",
    placeholder: el.getAttribute("placeholder") || "",
    section: sectionOf(el),
    visible: r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none",
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
}

function locate(alts) {
  const tried = [];
  for (const alt of alts) {
    const els = Array.from(document.querySelectorAll(alt.css));
    const got = pick(els.map(describe), alt);
    tried.push({ css: alt.css, text: alt.text || alt.text_re || "", section: alt.section || "", result: got.ok ? "ok" : got.reason,
      count: got.count || 0 });
    if (got.ok) {
      const el = els[got.index];
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const seen = describe(el, got.index);
      return { ok: true, el, rect: seen.rect, text: normalise(seen.text).slice(0, 80), tried };
    }
  }
  return { ok: false, tried };
}

// Why a press must not happen here, or null. Once the test has made a table,
// nothing is pressed on any other, matched by whole path segment so t_new1
// never passes for t_new12. A paid press also needs the control to still say
// what the card showed when it was approved.
function refuse(pathname, text, want) {
  if (want.table) {
    const parts = String(pathname).split("/");
    const at = parts.indexOf("tables");
    if (at < 0 || parts[at + 1] !== want.table) return "wrong table";
  }
  if (want.text !== null && want.text !== undefined && text !== want.text) return "changed";
  return null;
}

function frame() {
  return {
    screen_x: window.screenX, screen_y: window.screenY, outer_w: window.outerWidth,
    outer_h: window.outerHeight, inner_w: window.innerWidth, inner_h: window.innerHeight,
    dpr: window.devicePixelRatio, href: location.href,
  };
}

function setValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function isChecked(el) {
  const box = el.control || el;
  return box.checked === true || box.getAttribute("aria-checked") === "true";
}

// Presses are synthetic (isTrusted false), so the takeover listener below
// never mistakes clay-build's own press for the person's. A "check" on
// something already ticked does nothing: clicking it again would untick it.
function act(found, action) {
  const el = found.el;
  if (action.do === "click") el.click();
  if (action.do === "check") {
    if (!isChecked(el)) el.click();
    if (!isChecked(el)) return { ok: false, reason: "did not tick" };
  }
  if (action.do === "type") {
    el.focus();
    setValue(el, action.value);
    if (el.value !== action.value) return { ok: false, reason: "value did not stick" };
    if (action.enter) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    }
  }
  if (action.do === "open-submenu") {
    el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));
  }
  return { ok: true };
}

function expectMet(expect) {
  if (expect.url !== undefined) return { ok: location.href.includes(expect.url) };
  if (expect.text !== undefined) return { ok: document.body.innerText.includes(expect.text) };
  if (expect.text_re !== undefined) {
    const m = new RegExp(expect.text_re).exec(document.body.innerText);
    return m ? { ok: true, captured: normalise(m[1] || m[0]).slice(0, 80) } : { ok: false };
  }
  const el = document.querySelector(expect.css);
  return { ok: !!el && el.getBoundingClientRect().width > 0 };
}

// A trusted click, key or scroll in the page is the person taking over.
function armTakeover() {
  const state = window.__clayBuild = window.__clayBuild || { took: false, armed: false };
  if (!state.armed) {
    for (const type of ["pointerdown", "keydown", "wheel"]) {
      window.addEventListener(type, (e) => { if (e.isTrusted) state.took = true; }, { capture: true, passive: true });
    }
    state.armed = true;
  }
  return state;
}

function waitFor(expect, timeoutMs) {
  const state = armTakeover();
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (state.took || document.visibilityState === "hidden") return resolve({ ok: false, reason: "takeover" });
      const met = expectMet(expect);
      if (met.ok) return resolve(met);
      if (Date.now() - started > timeoutMs) return resolve({ ok: false, reason: "timeout" });
      setTimeout(tick, 250);
      return undefined;
    };
    tick();
  });
}

if (typeof module !== "undefined") module.exports = { normalise, matches, pick, refuse, sectionOf };
