/**
 * WHAT ENRICHMENT HAS COST, AND WHETHER IT MAY COST ANY MORE.
 *
 * Enrichment is the only per-contact spend in the system, and the way it goes
 * wrong is never a decision somebody made -- it is a retry loop, a sync that
 * re-enqueues, a second instance running the same sweep. So the answer is not
 * "be careful", it is a meter that a runaway cannot get past and a ledger that
 * says where the money went.
 *
 * THE LEDGER IS THE COUNTER AND THE LOCK, BOTH.
 *
 *   how much has this owner spent today?   sum cost_units over the window
 *   may this contact be enriched again?    is there a recent row for it
 *
 * One table answering both means they cannot disagree. A separate
 * `last_enriched_at` column on contacts would be a second source of truth for
 * the same fact, and the two would drift the first time a write partially
 * failed.
 *
 * THE DECISION IS A PURE FUNCTION, deliberately. Whether a request is inside
 * budget is the thing most worth testing and the thing least worth a database
 * to test -- `decide()` takes numbers and returns a verdict, and every
 * interesting case (limit zero, limit unset, cooldown still running, a request
 * that would straddle the limit) is a two-line test.
 *
 * FAILURES COST NOTHING AND ARE STILL RECORDED. A provider erroring twenty
 * times is the most important thing in this table and a ledger of successes
 * would be blind to it.
 */

import { query } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * Service defaults, overridable per owner by a row in enrichment_limits and by
 * env for the whole service.
 *
 * The numbers are conservative on purpose. An enrichment budget that is too low
 * produces a clear message and a support conversation; one that is too high
 * produces an invoice.
 */
export const DEFAULT_LIMITS = Object.freeze({
  dailyUnits: Number(process.env.ENRICH_DAILY_UNITS) || 200,
  monthlyUnits: Number(process.env.ENRICH_MONTHLY_UNITS) || 2000,
  /** How long before the same contact may be enriched again. */
  cooldownHours: Number(process.env.ENRICH_COOLDOWN_HOURS) || 24 * 14,
});

/**
 * May this request proceed? Pure.
 *
 * `spentDay` / `spentMonth` are sums already taken from the ledger, `limits`
 * the resolved limits, `contactLastAt` the timestamp of the last attempt on
 * this contact (or null).
 *
 * Returns `{ allowed, reason, remaining }`. The reason is a machine code, not a
 * sentence, because the route wants to choose a status and the client wants to
 * choose a message, and a sentence here would take that from both.
 */
export function decide({
  spentDay = 0,
  spentMonth = 0,
  cost = 1,
  limits = DEFAULT_LIMITS,
  contactLastAt = null,
  now = Date.now(),
} = {}) {
  const daily = numOrNull(limits?.dailyUnits) ?? DEFAULT_LIMITS.dailyUnits;
  const monthly = numOrNull(limits?.monthlyUnits) ?? DEFAULT_LIMITS.monthlyUnits;
  const cooldownH = numOrNull(limits?.cooldownHours) ?? DEFAULT_LIMITS.cooldownHours;
  const want = Math.max(0, Number(cost) || 0);

  const remaining = {
    day: Math.max(0, daily - spentDay),
    month: Math.max(0, monthly - spentMonth),
  };

  // Off is off, and it is checked first so the message says "disabled" rather
  // than "out of budget" -- those want different answers from whoever reads it.
  if (daily === 0 || monthly === 0) {
    return { allowed: false, reason: "enrichment_disabled", remaining };
  }

  if (contactLastAt) {
    const since = (now - Date.parse(contactLastAt)) / 3_600_000;
    if (Number.isFinite(since) && since < cooldownH) {
      return {
        allowed: false,
        reason: "recently_enriched",
        remaining,
        retryAfterHours: Math.ceil(cooldownH - since),
      };
    }
  }

  // THE CHECK IS "WOULD THIS REQUEST EXCEED", not "is there anything left".
  // Checking remaining > 0 lets a 10-unit request through on a 1-unit budget,
  // which is how a limit gets quietly overshot on the single most expensive
  // call of the day.
  if (spentDay + want > daily) return { allowed: false, reason: "daily_limit", remaining };
  if (spentMonth + want > monthly) return { allowed: false, reason: "monthly_limit", remaining };

  return { allowed: true, reason: "ok", remaining };
}

const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The limits in force for one owner: their row, falling back to the defaults. */
export async function getLimits(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return { ...DEFAULT_LIMITS };
  const { rows } = await query(
    `SELECT daily_units, monthly_units, note FROM enrichment_limits WHERE owner_id = $1`,
    [owner],
  );
  const row = rows[0];
  if (!row) return { ...DEFAULT_LIMITS };
  return {
    // NULL in the column means "use the default", which is NOT the same as 0.
    // Coalescing them here would turn every deliberate zero into a full budget.
    dailyUnits: row.daily_units == null ? DEFAULT_LIMITS.dailyUnits : Number(row.daily_units),
    monthlyUnits: row.monthly_units == null ? DEFAULT_LIMITS.monthlyUnits : Number(row.monthly_units),
    cooldownHours: DEFAULT_LIMITS.cooldownHours,
    note: row.note ?? null,
  };
}

/**
 * What one owner has spent, and when this contact was last attempted.
 *
 * The windows are rolling (24 hours, 30 days) rather than calendar, because a
 * calendar day resets at a timezone somebody has to pick and a runaway does not
 * care which one.
 */
export async function getSpend(ownerId, contactId = null) {
  const owner = asUuid(ownerId);
  if (!owner) return { spentDay: 0, spentMonth: 0, contactLastAt: null };
  const contact = asUuid(contactId);

  const [spend, last] = await Promise.all([
    query(
      `SELECT
         coalesce(sum(cost_units) FILTER (WHERE created_at > now() - interval '24 hours'), 0)::int AS day,
         coalesce(sum(cost_units) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int  AS month
       FROM enrichment_ledger
      WHERE owner_id = $1 AND created_at > now() - interval '30 days'`,
      [owner],
    ),
    contact
      ? query(
          `SELECT max(created_at) AS at FROM enrichment_ledger
            WHERE owner_id = $1 AND contact_id = $2
              -- An attempt that ERRORED does not start a cooldown. Refusing to
              -- retry a contact for two weeks because the provider was down for
              -- a minute is the wrong lesson to draw from a 503.
              AND outcome <> 'error'`,
          [owner, contact],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    spentDay: Number(spend.rows[0]?.day ?? 0),
    spentMonth: Number(spend.rows[0]?.month ?? 0),
    contactLastAt: last.rows[0]?.at ? new Date(last.rows[0].at).toISOString() : null,
  };
}

/** Write one attempt to the ledger. Never throws -- a lost row must not fail a request. */
export async function record({
  ownerId,
  contactId = null,
  provider,
  outcome,
  costUnits = 1,
  fieldsFilled = 0,
  detail = null,
} = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  try {
    const { rows } = await query(
      `INSERT INTO enrichment_ledger
         (owner_id, contact_id, provider, outcome, cost_units, fields_filled, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        owner,
        asUuid(contactId),
        String(provider || "unknown").slice(0, 64),
        String(outcome || "error").slice(0, 32),
        Math.max(0, Number(costUnits) || 0),
        Math.max(0, Number(fieldsFilled) || 0),
        detail ? String(detail).slice(0, 500) : null,
      ],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The usage summary a settings screen shows: what is left, and what it went on.
 */
export async function usageSummary(ownerId, { recent = 20 } = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  const [limits, spend, byOutcome, recentRows] = await Promise.all([
    getLimits(owner),
    getSpend(owner),
    query(
      `SELECT outcome, count(*)::int AS n, coalesce(sum(cost_units), 0)::int AS units,
              coalesce(sum(fields_filled), 0)::int AS filled
         FROM enrichment_ledger
        WHERE owner_id = $1 AND created_at > now() - interval '30 days'
        GROUP BY outcome`,
      [owner],
    ),
    query(
      `SELECT l.contact_id, c.full_name, l.provider, l.outcome,
              l.cost_units, l.fields_filled, l.created_at
         FROM enrichment_ledger l
         LEFT JOIN contacts c ON c.owner_id = l.owner_id AND c.id = l.contact_id
        WHERE l.owner_id = $1
        ORDER BY l.created_at DESC
        LIMIT $2`,
      [owner, Math.min(Math.max(Number(recent) || 20, 1), 100)],
    ),
  ]);

  const verdict = decide({ ...spend, limits, cost: 1 });
  return {
    limits: {
      dailyUnits: limits.dailyUnits,
      monthlyUnits: limits.monthlyUnits,
      cooldownHours: limits.cooldownHours,
      note: limits.note ?? null,
    },
    spent: { day: spend.spentDay, month: spend.spentMonth },
    remaining: verdict.remaining,
    enabled: verdict.reason !== "enrichment_disabled",
    outcomes: Object.fromEntries(
      byOutcome.rows.map((r) => [r.outcome, { count: r.n, units: r.units, fieldsFilled: r.filled }]),
    ),
    recent: recentRows.rows.map((r) => ({
      contactId: r.contact_id,
      name: r.full_name ?? null,
      provider: r.provider,
      outcome: r.outcome,
      costUnits: r.cost_units,
      fieldsFilled: r.fields_filled,
      at: new Date(r.created_at).toISOString(),
    })),
  };
}
