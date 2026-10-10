// The closed block catalog for Chewbacca Live. An answer is a list of typed
// blocks and nothing else: no HTML, no markdown, no component the page does
// not know. Same rule as the HUD's generated surfaces (docs/reference/GENUI.md,
// "a closed component catalog, and the model only picks from it"), and each
// block maps onto a Kyber component so one answer can render on either.

export const KYBER = {
  kpi_row: "Metric",
  bar_list: "Bars",
  table: "Table",
  reply_cards: "List",
  timeline: "Events",
  text: "Text",
  notice: "Status",
};

export const TYPES = Object.keys(KYBER);

// Row caps follow config/genui/policy.json in spirit: a glanceable panel shows
// a handful, and "more" says what the cap hid. 12 cards and 40 table rows were
// sized to Zeutara's 19 live campaigns plus five company headers and a total
// (2026-10-10); guessed for reply volume, never measured on a busy week.
const CAPS = { kpi_row: 6, bar_list: 24, table: 40, reply_cards: 12, timeline: 20 };
const TEXT_MAX = 600;
const STR_MAX = 400;

const COMMON = new Set(["type", "id", "title", "source", "as_of", "stale", "more", "caption"]);
const FIELDS = {
  kpi_row: ["items"],
  bar_list: ["items", "mode"],
  table: ["columns", "rows", "total"],
  reply_cards: ["items"],
  timeline: ["items"],
  text: ["text"],
  notice: ["text", "tone"],
};

const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v) => v === null || isNum(v);

function itemsCheck(block, path, check) {
  if (!Array.isArray(block.items)) return [`${path}.items must be an array`];
  if (block.items.length > CAPS[block.type]) return [`${path}.items has ${block.items.length}, cap is ${CAPS[block.type]}`];
  return block.items.flatMap((it, i) => (it && typeof it === "object" ? check(it, `${path}.items[${i}]`) : [`${path}.items[${i}] must be an object`]));
}

const CHECKS = {
  kpi_row: (b, p) =>
    itemsCheck(b, p, (it, ip) => [
      ...(isStr(it.label) ? [] : [`${ip}.label must be a string`]),
      ...(isNumOrNull(it.value) ? [] : [`${ip}.value must be a number or null`]),
      ...(it.format === undefined || ["int", "pct"].includes(it.format) ? [] : [`${ip}.format must be int or pct`]),
    ]),
  bar_list: (b, p) => [
    ...(b.mode === undefined || ["rate", "count"].includes(b.mode) ? [] : [`${p}.mode must be rate or count`]),
    ...itemsCheck(b, p, (it, ip) => [
      ...(isStr(it.label) ? [] : [`${ip}.label must be a string`]),
      ...(isNumOrNull(it.value) ? [] : [`${ip}.value must be a number or null`]),
      ...(it.low === undefined || isNumOrNull(it.low) ? [] : [`${ip}.low must be a number`]),
      ...(it.high === undefined || isNumOrNull(it.high) ? [] : [`${ip}.high must be a number`]),
      ...(it.verdict === undefined || ["ahead", "behind", "early", "none"].includes(it.verdict) ? [] : [`${ip}.verdict is unknown`]),
    ]),
  ],
  table: (b, p) => {
    const errs = [];
    if (!Array.isArray(b.columns) || !b.columns.length) errs.push(`${p}.columns must be a non-empty array`);
    else b.columns.forEach((c, i) => { if (!c || !isStr(c.key) || !isStr(c.label)) errs.push(`${p}.columns[${i}] needs key and label`); });
    if (!Array.isArray(b.rows)) errs.push(`${p}.rows must be an array`);
    else if (b.rows.length > CAPS.table) errs.push(`${p}.rows has ${b.rows.length}, cap is ${CAPS.table}`);
    else b.rows.forEach((r, i) => { if (!r || typeof r !== "object") errs.push(`${p}.rows[${i}] must be an object`); });
    if (b.total !== undefined && (b.total === null || typeof b.total !== "object")) errs.push(`${p}.total must be an object`);
    return errs;
  },
  reply_cards: (b, p) =>
    itemsCheck(b, p, (it, ip) => [
      ...(isStr(it.investor) ? [] : [`${ip}.investor must be a string`]),
      ...(isStr(it.wrote) ? [] : [`${ip}.wrote must be a string`]),
    ]),
  timeline: (b, p) =>
    itemsCheck(b, p, (it, ip) => [
      ...(isStr(it.when) ? [] : [`${ip}.when must be a string`]),
      ...(isStr(it.title) ? [] : [`${ip}.title must be a string`]),
    ]),
  text: (b, p) => (isStr(b.text) && b.text.length <= TEXT_MAX ? [] : [`${p}.text must be a string of at most ${TEXT_MAX}`]),
  notice: (b, p) => [
    ...(isStr(b.text) && b.text.length <= TEXT_MAX ? [] : [`${p}.text must be a string`]),
    ...(b.tone === undefined || ["info", "warn"].includes(b.tone) ? [] : [`${p}.tone must be info or warn`]),
  ],
};

/** Every error in one block, as path: message strings. Empty means valid. */
export function validateBlock(block, path = "block") {
  if (!block || typeof block !== "object" || Array.isArray(block)) return [`${path} must be an object`];
  if (!TYPES.includes(block.type)) return [`${path}.type ${JSON.stringify(block.type)} is not a block type (${TYPES.join(", ")})`];
  if (!isStr(block.id) || !/^[a-z0-9_-]{1,40}$/.test(block.id)) return [`${path}.id must be a short lowercase id`];
  const allowed = new Set([...COMMON, ...FIELDS[block.type]]);
  const extra = Object.keys(block).filter((k) => !allowed.has(k));
  const errs = extra.map((k) => `${path}.${k} is not a field of ${block.type}`);
  for (const k of ["title", "source", "as_of", "caption"]) {
    if (block[k] !== undefined && block[k] !== null && (!isStr(block[k]) || block[k].length > STR_MAX)) errs.push(`${path}.${k} must be a short string`);
  }
  if (block.stale !== undefined && block.stale !== null && typeof block.stale !== "object") errs.push(`${path}.stale must be an object`);
  if (block.more !== undefined && !isNum(block.more)) errs.push(`${path}.more must be a number`);
  return [...errs, ...CHECKS[block.type](block, path)];
}

/** Throws with every error when a block is invalid; returns it when valid. */
export function assertBlock(block) {
  const errs = validateBlock(block);
  if (errs.length) throw new TypeError(errs.join("; "));
  return block;
}

/** Trims a list to its cap and records how many were hidden. */
export function capItems(type, items) {
  const cap = CAPS[type];
  if (!cap || items.length <= cap) return { items, more: undefined };
  return { items: items.slice(0, cap), more: items.length - cap };
}

export { CAPS };
