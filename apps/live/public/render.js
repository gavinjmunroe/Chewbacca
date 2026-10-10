// Draws one block. Takes `h(tag, props, ...children)` so the same code builds
// real DOM in the browser and plain objects in tests. Every string goes in as
// a text node: nothing a source returns is ever parsed as HTML. A block type
// this file does not know draws nothing.

export const KNOWN = ["kpi_row", "bar_list", "table", "reply_cards", "timeline", "text", "notice"];

const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? "n/a" : `${(x * 100).toFixed(d)}%`);
const int = (x) => (x == null || !Number.isFinite(x) ? "n/a" : Math.round(x).toLocaleString("en-US"));

function fmt(v, format) {
  if (format === "pct") return pct(v);
  if (format === "int") return int(v);
  if (format === "interval") return v ? `${pct(v.rate)}` : "n/a";
  return v == null ? "" : String(v);
}

function when(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s || "");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const VERDICT = { ahead: "Ahead", behind: "Behind", early: "Too early to tell", none: "No sends yet" };

export function freshness(h, block) {
  if (!block.source) return null;
  const src = block.source === "clay" ? "Clay" : "Togari";
  if (block.stale) {
    return h("div", { class: `fresh stale${block.stale.refreshing ? " refreshing" : ""}` },
      h("span", { class: "dot" }),
      block.stale.note ? block.stale.note : `${src}, from ${block.stale.age} ago. ${block.stale.refreshing ? "Refreshing now." : ""}`);
  }
  const at = block.as_of ? new Date(block.as_of) : null;
  const t = at && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
  return h("div", { class: "fresh" }, h("span", { class: "dot live" }), `Live from ${src}${t ? `, ${t}` : ""}`);
}

const DRAW = {
  kpi_row: (h, b) =>
    h("div", { class: "kpis" },
      ...b.items.map((it) =>
        h("div", { class: `kpi tone-${it.tone || "plain"}` },
          h("div", { class: "kpi-label" }, it.label),
          h("div", { class: "kpi-value" }, fmt(it.value, it.format)),
          it.sub ? h("div", { class: "kpi-sub" }, it.sub) : null))),

  bar_list: (h, b) => {
    const max = b.mode === "count"
      ? Math.max(1, ...b.items.map((i) => i.value || 0))
      : Math.max(0.05, ...b.items.map((i) => i.high ?? i.value ?? 0)) * 1.1;
    return h("div", { class: `bars mode-${b.mode || "rate"}` },
      ...b.items.map((it) => {
        const w = (x) => `${Math.max(0, Math.min(100, ((x || 0) / max) * 100)).toFixed(2)}%`;
        return h("div", { class: `bar verdict-${it.verdict || "none"}` },
          h("div", { class: "bar-head" },
            h("span", { class: "bar-label" }, it.label),
            h("span", { class: "bar-value" }, b.mode === "count" ? int(it.value) : pct(it.value))),
          h("div", { class: "track" },
            b.mode === "count" ? null : h("div", { class: "band", style: `left:${w(it.low)};width:calc(${w(it.high)} - ${w(it.low)})` }),
            h("div", { class: "fill", style: `width:${w(it.value)}` })),
          h("div", { class: "bar-foot" },
            it.sub ? h("span", {}, it.sub) : null,
            b.mode === "count" || it.low == null ? null : h("span", { class: "range" }, `likely ${pct(it.low)} to ${pct(it.high)}`),
            it.verdict && b.mode !== "count" ? h("span", { class: `pill ${it.verdict}` }, VERDICT[it.verdict]) : null));
      }));
  },

  table: (h, b) => {
    const cell = (row, c) => {
      const v = row[c.key];
      if (c.format === "link" && typeof v === "string" && /^https:\/\//.test(v)) return h("a", { href: v, target: "_blank", rel: "noopener noreferrer" }, "Open");
      if (c.format === "interval" && v) return h("span", { class: "iv" }, pct(v.rate), h("small", {}, ` ${pct(v.low)} to ${pct(v.high)}`));
      return fmt(v, c.format);
    };
    const tr = (row, cls) =>
      h("tr", { class: `${cls} lvl-${row.level || 0}${row.flag ? ` flag-${row.flag}` : ""}` },
        ...b.columns.map((c) => h(c.key === b.columns[0].key ? "th" : "td", { class: c.align === "right" ? "num" : "", scope: c.key === b.columns[0].key ? "row" : undefined }, cell(row, c))));
    return h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, ...b.columns.map((c) => h("th", { class: c.align === "right" ? "num" : "", scope: "col" }, c.label)))),
        h("tbody", {}, ...b.rows.map((r) => tr(r, "row"))),
        b.total ? h("tfoot", {}, tr(b.total, "total")) : null));
  },

  reply_cards: (h, b) =>
    h("div", { class: "cards" },
      ...b.items.map((it) =>
        h("article", { class: "reply" },
          h("header", {},
            h("div", { class: "avatar", "aria-hidden": "true" }, (it.investor || "?").trim().charAt(0).toUpperCase()),
            h("div", {},
              h("div", { class: "who" }, it.investor),
              h("div", { class: "firm" }, [it.firm, it.company].filter(Boolean).join(" for "))),
            it.when ? h("time", {}, when(it.when)) : null),
          h("blockquote", {}, it.wrote),
          h("footer", {}, h("span", { class: "did-label" }, "Togari"), h("span", { class: "did" }, it.did || ""))))),

  timeline: (h, b) =>
    h("ol", { class: "timeline" },
      ...b.items.map((it) => h("li", {}, h("time", {}, when(it.when)), h("div", {}, h("strong", {}, it.title), it.detail ? h("span", {}, it.detail) : null)))),

  text: (h, b) => h("p", { class: "say" }, b.text),

  notice: (h, b) => h("div", { class: `notice ${b.tone || "info"}`, role: b.tone === "warn" ? "alert" : "status" }, b.text),
};

/** The block's element, or null for a type this renderer does not know. */
export function renderBlock(h, block) {
  if (!block || !KNOWN.includes(block.type) || !DRAW[block.type]) return null;
  const body = DRAW[block.type](h, block);
  const wrap = block.type === "text" || block.type === "notice";
  return h("section", { class: `block block-${block.type}${wrap ? " bare" : ""}`, "data-id": block.id },
    block.title ? h("h3", {}, block.title) : null,
    block.caption ? h("p", { class: "caption" }, block.caption) : null,
    body,
    block.more ? h("p", { class: "more" }, `${block.more} more not shown`) : null,
    freshness(h, block));
}
