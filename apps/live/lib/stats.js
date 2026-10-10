// The math that decides what a reader may conclude from a campaign's numbers.
//
// Reply rates on small counts are noise: Maggie's Serif report showed 3 replies
// on 1,702 sends, and a week of Zeutara waves runs 20 to 200 emails per
// campaign. So every rate carries a Wilson 95% interval, and a campaign is only
// called ahead or behind when its interval clears another's. Everything else is
// "too early to tell", which is the honest answer most weeks.

// 1.96 is the two-sided 95% normal quantile.
export const Z95 = 1.959963984540054;

// Deliverability: past roughly 5% hard bounces, inbox providers start treating
// the sending domains as careless, and every later email from them lands worse.
// The 5% line is the one Caleb named for this page (2026-10-10); providers
// publish no exact number.
export const BOUNCE_FLAG = 0.05;

/** Wilson score interval for k successes in n trials. null when n is 0. */
export function wilson(k, n, z = Z95) {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0) return null;
  if (k < 0 || k > n) throw new RangeError(`wilson: need 0 <= k <= n, got k=${k} n=${n}`);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * Verdict for each item from its interval alone: "ahead" when its low end
 * clears the high end of every other item, "behind" when its high end sits
 * under the low end of some other item, else "early". Items with no data are
 * "none". Order is never changed here: ranking is the caller's choice, and the
 * page only ranks when a verdict separates.
 */
export function verdicts(items) {
  const scored = items.map((it) => (it && it.interval ? it.interval : null));
  return scored.map((iv, i) => {
    if (!iv) return "none";
    const others = scored.filter((o, j) => j !== i && o);
    if (!others.length) return "early";
    if (others.every((o) => iv.low > o.high)) return "ahead";
    if (others.some((o) => iv.high < o.low)) return "behind";
    return "early";
  });
}

export function bounceFlag(bounces, sent) {
  if (!sent) return false;
  return bounces / sent > BOUNCE_FLAG;
}

/**
 * One campaign row (or a sum of them) turned into the rates the page shows.
 * Every rate is per email sent: Clay's date range scopes sends, replies and
 * bounces but not its funnel ("Funnel blocks remain the campaign's current
 * lead state", campaigns analytics --help, read 2026-10-10), so per email is
 * the one denominator that means the same thing this week and all time.
 */
export function rates(row) {
  const sent = num(row.sent);
  const bounces = Math.min(num(row.bounces), sent);
  const replies = num(row.human_replies);
  return {
    leads: row.leads == null ? null : num(row.leads),
    sent,
    replies,
    bounces,
    delivered: sent ? (sent - bounces) / sent : null,
    reply: wilson(Math.min(replies, sent), sent),
    bounce: sent ? bounces / sent : null,
    bounce_flag: bounceFlag(bounces, sent),
  };
}

export function sum(rows, keys = ["leads", "sent", "human_replies", "replies", "bounces"]) {
  const out = {};
  for (const k of keys) {
    if (k === "leads" && rows.some((r) => r.leads == null)) out.leads = null;
    else out[k] = rows.reduce((a, r) => a + num(r[k]), 0);
  }
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function pct(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(digits)}%`;
}
