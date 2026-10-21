/**
 * tabular-analyze.js — deterministic, dependency-free analysis engine for
 * inbound CSV / TSV / XLSX attachments (Tab 24, the "code interpreter").
 *
 * Why a structured engine instead of DuckDB-wasm: the brief named
 * @duckdb/duckdb-wasm, but that bundle is browser-targeted (web-worker +
 * fetch-based wasm load), ~30MB, and awkward in Node ESM. Letting an LLM
 * emit arbitrary SQL that we execute also fights the repo's own security
 * rules (no eval / no string-built queries on untrusted input). Instead the
 * model passes a STRUCTURED analysis spec (filter / derive / group_by /
 * aggregate / sort) which we run over rows parsed by the already-present
 * SheetJS (XLSX/XLS) or a hand-rolled RFC-4180 CSV parser (CSV/TSV/TXT).
 * That nails the acceptance cases ("top post by likes", "sum of column B
 * grouped by month") deterministically, with zero new dependencies, and is
 * fully unit-testable without the network.
 *
 * Everything in here is pure (no I/O). The tool wrapper
 * (tools/data-analyze.js) owns the fetch, the image-host chart upload, and
 * the tenant scoping. Functions return values or throw TabularError; the
 * wrapper converts throws into { error } so the agent never crashes.
 */

// Hard ceiling on parsed cells so a giant sheet can't blow past the ~256MB
// memory budget. 2M cells of typical string content stays comfortably under.
const MAX_CELLS = 2_000_000;
// Cap how many result rows we hand back to the model (the sanitizer caps at
// 16K chars anyway; this keeps grouped output legible).
const DEFAULT_RESULT_LIMIT = 100;

export class TabularError extends Error {
  constructor(message) {
    super(message);
    this.name = "TabularError";
  }
}

// ─── CSV / TSV parsing (RFC 4180-ish, quote-aware) ─────────────────────────

/**
 * Sniff the delimiter from the header line: tab if the first line has more
 * tabs than commas, else comma. Caller can override via opts.delimiter.
 */
function sniffDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf("\n") + 1 || text.length);
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas && semis > tabs) return ";";
  return ",";
}

/**
 * Parse delimited text into an array of string[] rows. Handles quoted fields
 * with embedded delimiters, escaped quotes (""), and CRLF / LF newlines.
 */
export function parseDelimited(text, delimiter = ",") {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let started = false;

  const pushField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\r") {
      // swallow; the \n (if any) finalizes the row
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
      started = true;
    }
  }
  // Flush the trailing field/row when the file doesn't end in a newline.
  if (started || field.length > 0 || row.length > 0) pushRow();
  return rows;
}

/**
 * Turn a 2D string grid into an array of row objects keyed by the header
 * row. Blank trailing rows are dropped; duplicate headers get a _2 suffix.
 */
function gridToRecords(grid) {
  const nonEmpty = grid.filter(
    (r) => r.length > 0 && !(r.length === 1 && r[0].trim() === ""),
  );
  if (nonEmpty.length === 0) return { columns: [], rows: [] };

  const rawHeader = nonEmpty[0];
  const seen = new Map();
  const columns = rawHeader.map((h, idx) => {
    let name = String(h ?? "").trim() || `col_${idx + 1}`;
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      name = `${name}_${n}`;
    } else {
      seen.set(name, 1);
    }
    return name;
  });

  const rows = [];
  for (let r = 1; r < nonEmpty.length; r++) {
    const cells = nonEmpty[r];
    const obj = {};
    for (let c = 0; c < columns.length; c++) {
      obj[columns[c]] = cells[c] !== undefined ? cells[c] : "";
    }
    rows.push(obj);
  }
  return { columns, rows };
}

function assertSize(rowCount, colCount) {
  if (rowCount * colCount > MAX_CELLS) {
    throw new TabularError(
      `dataset too large (${rowCount} rows x ${colCount} cols > ${MAX_CELLS} cells). ` +
        `Filter or narrow the columns before analyzing.`,
    );
  }
}

/**
 * Parse a CSV/TSV/plain buffer into { columns, rows }.
 */
export function parseCsvBuffer(buffer, { delimiter } = {}) {
  const text =
    typeof buffer === "string" ? buffer : Buffer.from(buffer).toString("utf8");
  const delim = delimiter || sniffDelimiter(text);
  const grid = parseDelimited(text, delim);
  const { columns, rows } = gridToRecords(grid);
  assertSize(rows.length, columns.length);
  return { columns, rows };
}

/**
 * Parse an XLSX/XLS buffer via SheetJS (already a dependency). Reads one
 * sheet (named via opts.sheet, else the first). Dynamic import so the CSV
 * path — and the unit tests — never require xlsx to be installed.
 */
export async function parseXlsxBuffer(buffer, { sheet } = {}) {
  let XLSX;
  try {
    XLSX = await import("xlsx");
  } catch {
    throw new TabularError(
      "xlsx parser unavailable in this runtime; send the data as CSV instead.",
    );
  }
  const wb = XLSX.read(buffer, { type: "buffer" });
  const names = Array.isArray(wb?.SheetNames) ? wb.SheetNames : [];
  if (names.length === 0) throw new TabularError("workbook has no sheets");
  const target = sheet && names.includes(sheet) ? sheet : names[0];
  const ws = wb.Sheets[target];
  // header:1 → array-of-arrays grid, matching the CSV path exactly.
  const grid = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  const norm = grid.map((r) =>
    (Array.isArray(r) ? r : [r]).map((v) =>
      v === null || v === undefined ? "" : v,
    ),
  );
  const { columns, rows } = gridToRecords(norm);
  assertSize(rows.length, columns.length);
  return { columns, rows, sheet: target, sheetNames: names };
}

// ─── Value helpers ─────────────────────────────────────────────────────────

/**
 * Coerce a cell to a finite number, tolerating currency symbols, thousands
 * separators, percent signs, and surrounding whitespace. Returns NaN when
 * the value isn't numeric so aggregations can skip it.
 */
export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  const cleaned = value.replace(/[$£€,%\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseDateParts(value) {
  if (value === null || value === undefined || value === "") return null;
  // SheetJS may already hand back a Date when cellDates is on; otherwise we
  // parse common string shapes. Numeric-only excel serials are out of scope.
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    // Fallback: bare YYYY-MM or YYYY-MM-DD without time.
    const m = String(value).match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (m) {
      const yr = Number(m[1]);
      const mo = Number(m[2]);
      const day = m[3] ? Number(m[3]) : 1;
      return { year: yr, month: mo, day, weekday: null };
    }
    return null;
  }
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Compute a derived value from a source cell. Used by the `derive` step so
 * "group by month" works without the caller pre-bucketing dates.
 */
export function deriveValue(raw, fn) {
  switch (fn) {
    case "month": {
      const p = parseDateParts(raw);
      return p ? p.month : null;
    }
    case "year": {
      const p = parseDateParts(raw);
      return p ? p.year : null;
    }
    case "year_month": {
      const p = parseDateParts(raw);
      return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : null;
    }
    case "day": {
      const p = parseDateParts(raw);
      return p ? p.day : null;
    }
    case "weekday": {
      const p = parseDateParts(raw);
      return p && p.weekday !== null ? WEEKDAYS[p.weekday] : null;
    }
    case "lower":
      return String(raw ?? "").toLowerCase();
    case "upper":
      return String(raw ?? "").toUpperCase();
    case "number":
      return toNumber(raw);
    case "abs": {
      const n = toNumber(raw);
      return Number.isNaN(n) ? null : Math.abs(n);
    }
    case "round": {
      const n = toNumber(raw);
      return Number.isNaN(n) ? null : Math.round(n);
    }
    default:
      throw new TabularError(`unknown derive fn: ${fn}`);
  }
}

// ─── Operations ────────────────────────────────────────────────────────────

const FILTER_OPS = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startswith",
  "in",
  "notnull",
]);

function matchesFilter(row, { column, op, value }) {
  if (!column || !FILTER_OPS.has(op)) {
    throw new TabularError(`invalid filter: ${JSON.stringify({ column, op })}`);
  }
  const cell = row[column];
  switch (op) {
    case "notnull":
      return cell !== "" && cell !== null && cell !== undefined;
    case "in": {
      const list = Array.isArray(value) ? value : [value];
      return list.map(String).includes(String(cell));
    }
    case "contains":
      return String(cell ?? "")
        .toLowerCase()
        .includes(String(value ?? "").toLowerCase());
    case "startswith":
      return String(cell ?? "")
        .toLowerCase()
        .startsWith(String(value ?? "").toLowerCase());
    case "eq":
    case "ne": {
      const cn = toNumber(cell);
      const vn = toNumber(value);
      let equal;
      if (!Number.isNaN(cn) && !Number.isNaN(vn)) equal = cn === vn;
      else equal = String(cell) === String(value);
      return op === "eq" ? equal : !equal;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const cn = toNumber(cell);
      const vn = toNumber(value);
      if (Number.isNaN(cn) || Number.isNaN(vn)) return false;
      if (op === "gt") return cn > vn;
      if (op === "gte") return cn >= vn;
      if (op === "lt") return cn < vn;
      return cn <= vn;
    }
    default:
      return false;
  }
}

const AGG_FNS = new Set([
  "count",
  "count_distinct",
  "sum",
  "avg",
  "min",
  "max",
  "median",
]);

function aggregate(rows, { fn, column, as }) {
  if (!AGG_FNS.has(fn)) throw new TabularError(`unknown aggregate fn: ${fn}`);
  const label = as || (fn === "count" ? "count" : `${fn}_${column}`);

  if (fn === "count") return { label, value: rows.length };
  if (fn === "count_distinct") {
    if (!column) throw new TabularError("count_distinct needs a column");
    const set = new Set(rows.map((r) => String(r[column])));
    return { label, value: set.size };
  }
  if (!column) throw new TabularError(`${fn} needs a column`);
  const nums = rows
    .map((r) => toNumber(r[column]))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return { label, value: null };
  switch (fn) {
    case "sum":
      return { label, value: round(nums.reduce((a, b) => a + b, 0)) };
    case "avg":
      return {
        label,
        value: round(nums.reduce((a, b) => a + b, 0) / nums.length),
      };
    case "min":
      return { label, value: Math.min(...nums) };
    case "max":
      return { label, value: Math.max(...nums) };
    case "median": {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const val =
        sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { label, value: round(val) };
    }
    default:
      return { label, value: null };
  }
}

function round(n) {
  // Avoid float noise like 0.1+0.2 in summed money columns.
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

function sortRows(rows, { by, dir = "desc" }) {
  if (!by) throw new TabularError("sort needs a `by` column");
  const factor = String(dir).toLowerCase() === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const an = toNumber(a[by]);
    const bn = toNumber(b[by]);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * factor;
    return String(a[by]).localeCompare(String(b[by])) * factor;
  });
}

/**
 * Run a structured analysis spec over { columns, rows }. Returns
 * { columns, rows, rowCount } where rows is the (capped) result set.
 *
 * spec = {
 *   filter?:    [{ column, op, value }],
 *   derive?:    [{ column, as, fn }],
 *   group_by?:  ["col", ...],
 *   aggregate?: [{ fn, column?, as? }],
 *   sort?:      { by, dir },
 *   select?:    ["col", ...],
 *   limit?:     number,
 * }
 */
export function runAnalysis(data, spec = {}) {
  const inputCols = data.columns || [];
  let rows = Array.isArray(data.rows) ? data.rows : [];

  // 1. filter
  if (Array.isArray(spec.filter) && spec.filter.length) {
    rows = rows.filter((r) => spec.filter.every((f) => matchesFilter(r, f)));
  }

  // 2. derive — append computed columns
  const derivedCols = [];
  if (Array.isArray(spec.derive) && spec.derive.length) {
    rows = rows.map((r) => {
      const next = { ...r };
      for (const d of spec.derive) {
        if (!d || !d.column || !d.as) {
          throw new TabularError("derive needs { column, as, fn }");
        }
        next[d.as] = deriveValue(r[d.column], d.fn);
      }
      return next;
    });
    for (const d of spec.derive)
      if (!derivedCols.includes(d.as)) derivedCols.push(d.as);
  }

  const hasGroup = Array.isArray(spec.group_by) && spec.group_by.length > 0;
  const hasAgg = Array.isArray(spec.aggregate) && spec.aggregate.length > 0;

  let outColumns;
  let outRows;

  if (hasGroup || hasAgg) {
    const aggs =
      hasAgg && spec.aggregate.length
        ? spec.aggregate
        : [{ fn: "count", as: "count" }];

    if (hasGroup) {
      const groups = new Map();
      for (const r of rows) {
        const key = spec.group_by.map((c) => String(r[c])).join("");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      outRows = [];
      for (const [, groupRows] of groups) {
        const out = {};
        for (const c of spec.group_by) out[c] = groupRows[0][c];
        for (const a of aggs) {
          const { label, value } = aggregate(groupRows, a);
          out[label] = value;
        }
        outRows.push(out);
      }
      outColumns = [
        ...spec.group_by,
        ...aggs.map(
          (a) => a.as || (a.fn === "count" ? "count" : `${a.fn}_${a.column}`),
        ),
      ];
    } else {
      const out = {};
      for (const a of aggs) {
        const { label, value } = aggregate(rows, a);
        out[label] = value;
      }
      outRows = [out];
      outColumns = aggs.map(
        (a) => a.as || (a.fn === "count" ? "count" : `${a.fn}_${a.column}`),
      );
    }
  } else {
    outRows = rows;
    outColumns = [...inputCols, ...derivedCols];
  }

  // 3. sort
  if (spec.sort) outRows = sortRows(outRows, spec.sort);

  const totalResultRows = outRows.length;

  // 4. limit
  const limit =
    Number.isInteger(spec.limit) && spec.limit > 0
      ? spec.limit
      : DEFAULT_RESULT_LIMIT;
  outRows = outRows.slice(0, limit);

  // 5. select (projection) — applied last so derived/agg cols are selectable
  if (Array.isArray(spec.select) && spec.select.length) {
    outColumns = spec.select.filter((c) => outColumns.includes(c));
    outRows = outRows.map((r) => {
      const o = {};
      for (const c of outColumns) o[c] = r[c];
      return o;
    });
  }

  return { columns: outColumns, rows: outRows, rowCount: totalResultRows };
}

// ─── SVG chart (hand-rolled, no D3) ────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a bar or line chart of result rows as a standalone SVG string.
 * x = category column, y = numeric column. Returns null when the columns
 * aren't usable so the caller can skip the chart without failing.
 */
export function renderChartSvg(result, { type = "bar", x, y, title } = {}) {
  if (!x || !y) return null;
  const rows = (result.rows || []).filter((r) => !Number.isNaN(toNumber(r[y])));
  if (rows.length === 0) return null;

  const W = 720;
  const H = 420;
  const padL = 64;
  const padR = 24;
  const padT = title ? 56 : 28;
  const padB = 84;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const values = rows.map((r) => toNumber(r[y]));
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const span = maxV - minV || 1;
  const yToPx = (v) => padT + plotH - ((v - minV) / span) * plotH;

  const accent = "#6366f1";
  const grid = "#27272a";
  const text = "#a1a1aa";
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#0a0a0a"/>`);
  if (title) {
    parts.push(
      `<text x="${padL}" y="32" fill="#fafafa" font-size="18" font-weight="600">${esc(title)}</text>`,
    );
  }

  // Horizontal gridlines + y labels (4 ticks).
  for (let i = 0; i <= 4; i++) {
    const v = minV + (span * i) / 4;
    const py = yToPx(v);
    parts.push(
      `<line x1="${padL}" y1="${py.toFixed(1)}" x2="${W - padR}" y2="${py.toFixed(1)}" stroke="${grid}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${padL - 8}" y="${(py + 4).toFixed(1)}" fill="${text}" font-size="11" text-anchor="end">${esc(fmtNum(v))}</text>`,
    );
  }

  const n = rows.length;
  const slot = plotW / n;
  const baseY = yToPx(0);

  if (type === "line") {
    const pts = rows.map((r, i) => {
      const cx = padL + slot * (i + 0.5);
      const cy = yToPx(toNumber(r[y]));
      return `${cx.toFixed(1)},${cy.toFixed(1)}`;
    });
    parts.push(
      `<polyline points="${pts.join(" ")}" fill="none" stroke="${accent}" stroke-width="2.5"/>`,
    );
    rows.forEach((r, i) => {
      const cx = padL + slot * (i + 0.5);
      const cy = yToPx(toNumber(r[y]));
      parts.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="${accent}"/>`,
      );
    });
  } else {
    const barW = Math.max(2, Math.min(56, slot * 0.62));
    rows.forEach((r, i) => {
      const v = toNumber(r[y]);
      const cx = padL + slot * (i + 0.5);
      const yTop = yToPx(Math.max(v, 0));
      const h = Math.abs(baseY - yToPx(v));
      parts.push(
        `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" fill="${accent}"/>`,
      );
    });
  }

  // X axis labels (rotated when crowded).
  rows.forEach((r, i) => {
    const cx = padL + slot * (i + 0.5);
    const label = esc(truncate(String(r[x] ?? ""), 18));
    const ty = H - padB + 18;
    if (n > 8) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${ty}" fill="${text}" font-size="10" text-anchor="end" transform="rotate(-40 ${cx.toFixed(1)} ${ty})">${label}</text>`,
      );
    } else {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${ty}" fill="${text}" font-size="11" text-anchor="middle">${label}</text>`,
      );
    }
  });

  // Axis title for y.
  parts.push(
    `<text x="16" y="${padT + plotH / 2}" fill="${text}" font-size="11" text-anchor="middle" transform="rotate(-90 16 ${padT + plotH / 2})">${esc(y)}</text>`,
  );

  parts.push(`</svg>`);
  return parts.join("");
}

function fmtNum(v) {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const __internals = {
  sniffDelimiter,
  gridToRecords,
  matchesFilter,
  aggregate,
  sortRows,
  fmtNum,
  MAX_CELLS,
  DEFAULT_RESULT_LIMIT,
};
