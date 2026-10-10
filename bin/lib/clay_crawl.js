// In-page half of `clay-map crawl`. Installed into the signed-in Clay tab next
// to clay_guard.js. It enumerates every interactive element in the current
// state, presses exactly one when asked, and reports what appeared.
//
// Privacy: raw labels never leave the page. A label is returned only when the
// same text is compiled into Clay's own JavaScript bundle (so it is Clay's UI
// copy, not a customer's data); numbers are folded to #. Anything else comes
// back as <data>, and labels of repeated row/column/campaign elements come
// back as <per-row>.
(cfg) => {
  const C = window.__cm || (window.__cm = {});
  C.cfg = cfg;
  const gate = new RegExp("\\b(" + cfg.gate + ")\\b", "i");
  const deny = new RegExp("\\b(" + cfg.deny + ")\\b", "i");
  const names = new Set((cfg.names || []).map((n) => n.toLowerCase()));
  C.vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(e);
    return (
      s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"
    );
  };
  C.raw = (e) =>
    (
      e.getAttribute("aria-label") ||
      e.innerText ||
      e.getAttribute("title") ||
      e.getAttribute("placeholder") ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
  C.role = (e) =>
    e.getAttribute("role") ||
    { A: "link", BUTTON: "button", TEXTAREA: "textarea", SELECT: "select" }[
      e.tagName
    ] ||
    (e.tagName === "INPUT"
      ? "input-" + (e.type || "text")
      : e.isContentEditable
        ? "editable"
        : "pointer");
  const seg = (x) =>
    x.tagName.toLowerCase() +
    (x.getAttribute("role") ? "[" + x.getAttribute("role") + "]" : "") +
    (x.getAttribute("data-testid")
      ? "#" + x.getAttribute("data-testid").replace(/\d+/g, "N")
      : "") +
    (x.getAttribute("data-sidebar")
      ? "@" + x.getAttribute("data-sidebar")
      : "");
  C.struct = (e) => {
    const p = [];
    let x = e;
    for (let i = 0; i < 6 && x && x !== document.body; i++) {
      p.unshift(seg(x));
      x = x.parentElement;
    }
    return p.join(">");
  };

  // The label rule is clay_sanitize.py's, exactly: a label is kept only when
  // it equals an entry of the vocabulary Python built from Clay's public
  // JavaScript string literals (handed over by setVocab), or is several
  // entries joined by numbers. Exact Set membership, never a substring.
  C.addVocab = (list) => {
    for (const w of list) C.vocab.add(w);
    safeCache.clear();
    return C.vocab.size;
  };
  C.setVocab = (list) => {
    C.vocab = new Set(list);
    safeCache.clear();
    return C.vocab.size;
  };
  const STRIP = " ,.:/%()+-\u2013~|\u00b7\u2219";
  const word = (s) => !!C.vocab && C.vocab.has(s) && !names.has(s.toLowerCase());
  const strip = (s) => {
    let i = 0, j = s.length;
    while (i < j && STRIP.includes(s[i])) i++;
    while (j > i && STRIP.includes(s[j - 1])) j--;
    return s.slice(i, j);
  };
  const fold = (s) => {
    let out = "", digit = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i], isD = ch >= "0" && ch <= "9";
      if (digit && (ch === "." || ch === ",") && i + 1 < s.length && s[i + 1] >= "0" && s[i + 1] <= "9") continue;
      if (isD) { if (!digit) out += "#"; digit = true; } else { out += ch; digit = false; }
    }
    return out;
  };
  const safeCache = new Map();
  C.safe = (label) => {
    if (safeCache.has(label)) return safeCache.get(label);
    const v = C.safe1(label);
    safeCache.set(label, v);
    return v;
  };
  C.safe1 = (raw) => {
    const label = (raw || "").split(/\s+/).filter(Boolean).join(" ");
    if (!label) return "";
    if (word(label)) return fold(label);
    const folded = fold(label);
    if (!folded.includes("#")) return "<data>";
    const pieces = folded.split("#").map(strip).filter(Boolean);
    return pieces.length && pieces.every(word) ? folded : "<data>";
  };

  C.overlays = () =>
    [
      ...document.querySelectorAll(
        "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[data-radix-popper-content-wrapper]",
      ),
    ]
      .filter(C.vis)
      .filter((o, i, a) => !a.some((p) => p !== o && p.contains(o)));
  const ISEL =
    "a[href],button,input,textarea,select,[contenteditable=true],[role=button],[role=tab],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=switch],[role=checkbox],[role=radio],[role=combobox],[role=treeitem]";
  C.interactive = (root) => {
    const els = [...root.querySelectorAll(ISEL)].filter(C.vis);
    // Clickable rows with no role (Clay's inbox thread list) only show up as cursor:pointer.
    // Only Tailwind's cursor-pointer class is checked, not every div's computed
    // style, which a 300-row table would make slow (guessed, never measured).
    // The inbox thread rows that need this carry the class.
    const extra = [...root.querySelectorAll("[class*=cursor-pointer]")]
      .filter((e) => {
        if (e.closest(ISEL) || e.querySelector(ISEL)) return false;
        const r = e.getBoundingClientRect();
        return (
          r.height >= 12 &&
          r.height <= 160 &&
          getComputedStyle(e).cursor === "pointer" &&
          C.vis(e) &&
          !(
            e.parentElement &&
            getComputedStyle(e.parentElement).cursor === "pointer" &&
            !e.parentElement.closest(ISEL)
          )
        );
      })
      .slice(0, 300);
    return els.concat(extra);
  };
  C.scope = () => {
    const o = C.overlays();
    return o.length ? o[o.length - 1] : document.body;
  };
  C.keyOf = (e) =>
    C.struct(e) + "|" + (e.getAttribute("data-testid") || C.safe(C.raw(e)));
  C.keys = (root) => new Set(C.interactive(root || document.body).map(C.keyOf));

  C.enum = () => {
    const root = C.scope();
    const els = C.interactive(root);
    // A template is a control repeated per data row, column or campaign: three
    // or more with the same structure whose labels are data (or the same icon
    // with no label). A list of distinct UI labels (the sidebar) is not one.
    const info = els.map((e) => ({ e, s: C.struct(e), raw: C.raw(e) }));
    info.forEach((x) => {
      x.safe = C.safe(x.raw);
      x.data = x.safe === "<data>" || x.safe === "";
    });
    const groups = {};
    info.forEach((x) => {
      const g = x.s + "|" + (x.data ? "<data>" : x.safe);
      (groups[g] = groups[g] || []).push(x);
    });
    C.byId = new Map();
    return info.map((x, i) => {
      const e = x.e,
        s = x.s,
        raw = x.raw;
      C.byId.set(i, e);
      const group = groups[s + "|" + (x.data ? "<data>" : x.safe)];
      const template = group.length >= 3;
      const same = group.every((g) => g.raw === raw);
      const href = e.tagName === "A" ? e.getAttribute("href") || "" : "";
      // Only same-site paths are pages to crawl. A mailto: or tel: link
      // carries an address in the href itself, so only its scheme is kept.
      const internal =
        (() => { try { return new URL(href, location.href).origin === "https://app.clay.com"; } catch (e) { return false; } })();
      const ext =
        !href || internal
          ? ""
          : /^https?:/.test(href)
            ? new URL(href).host
            : href.split(":")[0] + ":";
      const role = C.role(e);
      const field =
        /^(input-(?!button|submit)|textarea|select|editable|combobox)/.test(
          role,
        );
      const toggle =
        /^(input-checkbox|input-radio|checkbox|radio|switch|option|menuitemcheckbox|menuitemradio)$/.test(
          role,
        );
      return {
        i,
        role,
        struct: s,
        testid: e.getAttribute("data-testid") || "",
        popup: e.getAttribute("aria-haspopup") || "",
        expanded: e.getAttribute("aria-expanded"),
        selected:
          e.getAttribute("aria-selected") === "true" ||
          e.getAttribute("data-state") === "active",
        label: template && !same ? "<per-row>" : x.safe,
        template,
        instances: group.length,
        index: group.indexOf(x),
        href: href && !ext ? (() => { const u = new URL(href, location.href); return u.pathname + u.search; })() : "",
        ext,
        gate: gate.test(raw),
        deny: deny.test(raw),
        field,
        toggle,
        chrome: !!e.closest("[data-sidebar=sidebar]"),
        in_overlay: root !== document.body,
      };
    });
  };

  // Waiting is driven from Python, which polls every 50 ms. The page only
  // records when the DOM last changed. The earlier in-page loop spun a
  // MessageChannel the whole time and kept a CPU core busy for hours; on
  // 2026-10-10 the Mac overloaded during a crawl.
  C.watchStart = (url0, ov0) => {
    if (C.w && C.w.mo) C.w.mo.disconnect();
    const w = (C.w = {t0: performance.now(), first: 0, url0, ov0});
    w.last = w.t0;
    w.changed = () => url0 === null || (location.pathname + location.search) !== url0 || C.overlays().length !== ov0;
    w.mo = new MutationObserver(() => {
      w.last = performance.now();
      if (!w.first && w.changed()) w.first = w.last;
    });
    w.mo.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
    return true;
  };
  C.watchPoll = () => {
    const w = C.w, n = performance.now();
    if (!w) return JSON.stringify({gone: true});
    if (!w.first && w.changed()) w.first = n;
    const g = window.__clayGuard;
    const pending = g && w.l0 !== undefined ? g.log.slice(w.l0).filter((r) => r.status === undefined).length : 0;
    return JSON.stringify({elapsed: Math.round(n - w.t0), first_ms: w.first ? Math.round(w.first - w.t0) : null,
      since_last: Math.round(n - w.last), quiet_ms: Math.round(w.last - w.t0), pending});
  };
  C.watchStop = () => {
    const w = C.w;
    if (!w) return {first_ms: null, quiet_ms: 0};
    w.mo.disconnect();
    C.w = null;
    return {first_ms: w.first ? Math.round(w.first - w.t0) : null, quiet_ms: Math.round(w.last - w.t0)};
  };
  C.press = (e) =>
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
      e.dispatchEvent(t.startsWith("pointer")
        ? new PointerEvent(t, {bubbles: true, cancelable: true, view: window, pointerType: "mouse", button: 0, isPrimary: true})
        : new MouseEvent(t, {bubbles: true, cancelable: true, view: window, button: 0})));
  C.escapeKeys = (n) => {
    for (let k = 0; k < n; k++) {
      const t = document.activeElement || document.body;
      for (const type of ["keydown", "keyup"])
        t.dispatchEvent(new KeyboardEvent(type, {key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true}));
    }
    return n;
  };

  // Requests logged by clay_guard.js since index l0, waiting briefly for any
  // still in flight so status and duration are filled in.
  C.requests = (l0) =>
    (window.__clayGuard ? window.__clayGuard.log.slice(l0) : []).map((r) => ({
      method: r.method,
      path: r.path,
      query: r.query,
      body: r.body,
      status: r.status === undefined ? "pending" : r.status,
      ms: r.ms,
    }));
  // Press element i from the last enum, then start watching. Refuses
  // anything enum marked unsafe. actEnd reports what the press opened.
  C.actStart = (i) => {
    const e = C.byId && C.byId.get(i);
    if (!e || !e.isConnected) return JSON.stringify({err: "stale"});
    const raw = C.raw(e), role = C.role(e);
    if (gate.test(raw) || deny.test(raw)) return JSON.stringify({err: "refused: gate word"});
    if (/^(input-(?!button)|textarea|select|editable|checkbox|radio|switch|option|menuitemcheckbox|menuitemradio)/.test(role))
      return JSON.stringify({err: "refused: field or toggle"});
    const g = window.__clayGuard || {blocked: [], log: [], ws: 0};
    const url0 = location.pathname + location.search, ov0 = C.overlays().length;
    C.a = {l0: g.log.length, url0, ov0, keys0: C.keys(), b0: g.blocked.length, ws0: g.ws};
    C.watchStart(url0, ov0);
    C.w.l0 = C.a.l0;
    C.press(e);
    return JSON.stringify({ok: true});
  };
  C.actEnd = () => {
    const a = C.a, t = C.watchStop();
    const g = window.__clayGuard || {blocked: [], log: [], ws: 0};
    const url1 = location.pathname + location.search, ovs = C.overlays();
    const top = ovs.length > a.ov0 ? ovs[ovs.length - 1] : null;
    const fresh = C.interactive(top || document.body).filter((x) => !a.keys0.has(C.keyOf(x)));
    const orole = top ? top.getAttribute("role") || ((top.querySelector("[role]") || {getAttribute: () => "popover"}).getAttribute("role")) || "popover" : "";
    const keys1 = C.keys();
    const gone = [...a.keys0].filter((k) => !keys1.has(k)).length;
    return JSON.stringify({
      url0: a.url0, url1, overlay: orole, overlays: ovs.length - a.ov0, timing: t,
      blocked: g.blocked.slice(a.b0), requests: C.requests(a.l0), ws: g.ws - a.ws0, gone,
      fresh: fresh.slice(0, 40).map((x) => ({role: C.role(x), label: C.safe(C.raw(x)), popup: x.getAttribute("aria-haspopup") || "",
        struct: C.struct(x), key: C.keyOf(x)})),
      fresh_count: fresh.length,
    });
  };
  return JSON.stringify({ installed: true });
};
