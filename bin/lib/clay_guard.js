// Read-only guard for crawling Clay: installed into the signed-in tab while
// clay-map walks every control. Any request to api.clay.com that is not a
// GET, HEAD or OPTIONS is refused before it leaves the page, unless its path
// is on the read allowlist (Clay reads several lists with POST). Refusals are
// logged, so a control that tried to write is recorded as a gate along with
// the endpoint it tried.
//
// Every api.clay.com request is also logged for the map: method, the path
// with ids templated, the names of query and top-level body fields (never
// their values), status and duration. That is what links a control to the
// API call behind it.
//
// mode "log" lets everything through and only records; it is how the
// allowlist was built on 2026-10-09 (page loads only, no clicks).
(mode, allow) => {
  const g =
    window.__clayGuard ||
    (window.__clayGuard = { blocked: [], seen: [], log: [], ws: 0 });
  g.mode = mode;
  g.allow = allow;
  if (g.installed) return JSON.stringify({ installed: true, again: true });
  g.installed = true;
  // Exact origin, never a pattern: "https://evil.example/?x=//api.clay.com/"
  // and "https://api.clay.com.evil.example" are not Clay.
  const api = (u) => { try { return new URL(String(u), location.href).origin === "https://api.clay.com"; } catch (e) { return false; } };
  g.isApi = api;
  const norm = (u) =>
    String(u)
      .split("?")[0]
      .replace(/^https:\/\/api\.clay\.com/, "")
      .replace(/\/\d{4,}/g, "/{n}")
      .replace(/\b([a-z]{1,8})_[A-Za-z0-9]{8,}/g, "{$1}")
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/{uuid}")
      .replace(/\/\d+(?=\/|$)/g, "/{n}");
  const qkeys = (u) => {
    try {
      return [...new URL(String(u), location.href).searchParams.keys()].sort();
    } catch (e) {
      return [];
    }
  };
  const bkeys = (b) => {
    if (typeof b !== "string")
      return b
        ? [
            typeof b === "object" && b.constructor
              ? "<" + b.constructor.name + ">"
              : "<body>",
          ]
        : [];
    try {
      const o = JSON.parse(b);
      return o && typeof o === "object" && !Array.isArray(o)
        ? Object.keys(o).sort()
        : ["<array>"];
    } catch (e) {
      return ["<text>"];
    }
  };
  const reading = (m, u) =>
    !m ||
    /^(GET|HEAD|OPTIONS)$/i.test(m) ||
    !api(u) ||
    g.allow.some((r) => new RegExp(r).test(norm(u)));
  const record = (m, u, body) => {
    const M = String(m || "GET").toUpperCase();
    if (!api(u)) return null;
    if (!/^(GET|HEAD|OPTIONS)$/.test(M)) g.seen.push(M + " " + norm(u));
    const r = {
      method: M,
      path: norm(u),
      query: qkeys(u),
      body: bkeys(body),
      t0: performance.now(),
    };
    g.log.push(r);
    if (g.log.length > 5000) g.log.splice(0, 1000);
    return r;
  };
  const refuse = (m, u) => g.mode === "strict" && !reading(m, u);
  const f = window.fetch;
  window.fetch = function (input, init) {
    const u = typeof input === "string" ? input : (input && input.url) || "";
    const m = (init && init.method) || (input && input.method) || "GET";
    const r = record(m, u, init && init.body);
    if (refuse(m, u)) {
      g.blocked.push(String(m).toUpperCase() + " " + norm(u));
      if (r) {
        r.status = "blocked";
        r.ms = 0;
      }
      return Promise.reject(new TypeError("clay-map read-only guard"));
    }
    const p = f.apply(this, arguments);
    if (r)
      p.then(
        (res) => {
          r.status = res.status;
          r.ms = Math.round(performance.now() - r.t0);
        },
        () => {
          r.status = "error";
        },
      );
    return p;
  };
  const open = XMLHttpRequest.prototype.open,
    send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__cg = [m, String(u)];
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const [m, u] = this.__cg || ["GET", ""];
    const r = record(m, u, body);
    if (refuse(m, u)) {
      g.blocked.push(String(m).toUpperCase() + " " + norm(u));
      if (r) {
        r.status = "blocked";
        r.ms = 0;
      }
      this.abort();
      return;
    }
    if (r)
      this.addEventListener("loadend", () => {
        r.status = this.status;
        r.ms = Math.round(performance.now() - r.t0);
      });
    return send.apply(this, arguments);
  };
  const beacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (beacon)
    navigator.sendBeacon = (u, d) =>
      api(u) && g.mode === "strict"
        ? (g.blocked.push("BEACON " + norm(u)), false)
        : beacon(u, d);
  const wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function () {
    g.ws++;
    return wsSend.apply(this, arguments);
  };
  return JSON.stringify({ installed: true });
};
