/**
 * THE CEILING, ENFORCED AT THE DOOR.
 *
 * Every lever an admin has over the relationship graph restricts. None of
 * them expose one person's private history to another, and there is no
 * column that could -- which is the point, because a switch that makes
 * everyone's interactions company-visible gets flipped within a quarter by
 * somebody with a dashboard to fill, and then the graph goes empty quietly:
 * people stop connecting rather than complain, and nobody files a ticket
 * saying they declined to adopt.
 *
 * WHY ENFORCEMENT IS HERE AND NOT IN THE ROUTES. A policy checked by each
 * caller is a policy that holds until somebody adds a caller. record() is
 * the single door into the ledger, so the check sits next to it and a
 * producer written next year inherits it without knowing it exists.
 *
 * WHAT MAKES IT EVIDENCE RATHER THAN A CLAIM. Two things, and neither is the
 * check itself. Every interaction records the policy version in force when
 * it was written, so a row from March can be tested against March's rules
 * instead of today's. And every refusal is written down -- a gate that
 * silently drops writes is indistinguishable from a broken sync, and the
 * first person to notice is whoever was relying on the relationship that
 * went missing.
 */

import { query } from "./sql.js";

/** Everything a source could be, which is also the ceiling's maximum. */
export const ALL_SOURCES = [
  "calendar", "mail", "transcript", "crm", "enrichment", "manual",
  "chatgpt", "claude", "copilot", "gemini",
];

/** Sources that are an agent acting, rather than a person's own tool syncing. */
const AGENT_SOURCES = new Set(["chatgpt", "claude", "copilot", "gemini"]);

const DEFAULTS = {
  version: 1,
  sources: ["calendar", "mail", "transcript", "crm", "enrichment", "manual"],
  allow_external: false,
  retention_months: null,
  require_gate: true,
};

/**
 * The company's policy, created on first read.
 *
 * A company that has never opened the screen has the defaults, and a missing
 * row is not a different state from an untouched one -- so rather than
 * branching on absence everywhere, absence is resolved once, here.
 */
export async function getPolicy({ orgId } = {}) {
  if (!orgId) return { ...DEFAULTS };

  const { rows } = await query(
    `SELECT version, sources, allow_external, retention_months, require_gate,
            updated_at, updated_by
       FROM org_memory_policy WHERE org_id = $1::uuid`,
    [orgId],
  );
  if (rows.length > 0) return rows[0];

  const { rows: made } = await query(
    `INSERT INTO org_memory_policy (org_id) VALUES ($1::uuid)
     ON CONFLICT (org_id) DO NOTHING
     RETURNING version, sources, allow_external, retention_months, require_gate,
               updated_at, updated_by`,
    [orgId],
  );
  if (made.length > 0) return made[0];

  // Lost a race. Read what the winner wrote.
  const { rows: again } = await query(
    `SELECT version, sources, allow_external, retention_months, require_gate,
            updated_at, updated_by
       FROM org_memory_policy WHERE org_id = $1::uuid`,
    [orgId],
  );
  return again[0] ?? { ...DEFAULTS };
}

/**
 * Change the policy. Admin only, enforced by the route.
 *
 * The version bumps on every accepted change, including one that loosens a
 * rule, because the question an audit asks is "what was in force on the 3rd"
 * and that has to have exactly one answer.
 */
export async function setPolicy({ orgId, byAmberId = null, patch = {} } = {}) {
  if (!orgId) return { ok: false, reason: "bad_input" };

  const sources = Array.isArray(patch.sources)
    ? [...new Set(patch.sources.filter((s) => ALL_SOURCES.includes(s)))]
    : null;

  if (patch.sources && sources.length === 0) {
    // An empty list is almost certainly a UI bug rather than an intention,
    // and acting on it would silently stop every sync in the company.
    return { ok: false, reason: "no_sources" };
  }

  const months =
    patch.retentionMonths === null || patch.retentionMonths === undefined
      ? null
      : Math.max(1, Math.min(240, Number(patch.retentionMonths) || 0));

  const { rows } = await query(
    `INSERT INTO org_memory_policy (org_id, sources, allow_external, retention_months,
                                    require_gate, updated_by)
     VALUES ($1::uuid,
             COALESCE($2::text[], $7::text[]),
             COALESCE($3::boolean, false),
             $4::int,
             COALESCE($5::boolean, true),
             $6::uuid)
     ON CONFLICT (org_id) DO UPDATE SET
       version          = org_memory_policy.version + 1,
       sources          = COALESCE($2::text[], org_memory_policy.sources),
       allow_external   = COALESCE($3::boolean, org_memory_policy.allow_external),
       retention_months = CASE WHEN $8::boolean THEN $4::int
                               ELSE org_memory_policy.retention_months END,
       require_gate     = COALESCE($5::boolean, org_memory_policy.require_gate),
       updated_at       = now(),
       updated_by       = $6::uuid
     RETURNING version, sources, allow_external, retention_months, require_gate,
               updated_at, updated_by`,
    [
      orgId,
      sources,
      patch.allowExternal === undefined ? null : !!patch.allowExternal,
      months,
      patch.requireGate === undefined ? null : !!patch.requireGate,
      byAmberId,
      DEFAULTS.sources,
      // retention is the one field whose intended value can be null, so
      // "was it passed" cannot be inferred from the value itself.
      Object.prototype.hasOwnProperty.call(patch, "retentionMonths"),
    ],
  );

  return { ok: true, policy: rows[0] };
}

/** Write down what was refused, and why. */
async function recordRefusal({ orgId, amberId, source, reason, detail, version }) {
  await query(
    `INSERT INTO org_policy_refusals (org_id, amber_id, source, reason, detail, policy_version)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
    [orgId, amberId ?? null, source, reason, detail ?? null, version],
  ).catch(() => null);
}

/**
 * May this write happen, and under which rules.
 *
 * Returns { ok, version } or { ok: false, reason }. Called by record() for
 * every interaction, which is the only reason this holds: a check each
 * caller performs is a check that lasts until somebody adds a caller.
 */
export async function checkWrite({ orgId, amberId = null, source } = {}) {
  const policy = await getPolicy({ orgId });

  if (!policy.sources.includes(source)) {
    await recordRefusal({
      orgId,
      amberId,
      source,
      reason: "source_forbidden",
      detail: `${source} is not an allowed source for this company`,
      version: policy.version,
    });
    return { ok: false, reason: "source_forbidden", version: policy.version };
  }

  /*
   * THE GATE, and it is deliberately narrow rather than impressive.
   *
   * It does not read the content and judge it -- that would be a claim we
   * could not stand behind. It enforces the one thing that is actually
   * checkable at the door: when the gate is on, a write attributed to no
   * person, from an agent source, is refused. An agent writing into a
   * company's relationship record without a human principal is the exact
   * shape of the thing nobody can audit afterwards.
   */
  if (policy.require_gate && AGENT_SOURCES.has(source) && !amberId) {
    await recordRefusal({
      orgId,
      amberId: null,
      source,
      reason: "gate",
      detail: "an agent write with no human principal, while the gate is required",
      version: policy.version,
    });
    return { ok: false, reason: "gate_requires_principal", version: policy.version };
  }

  return { ok: true, version: policy.version };
}

/** May person-level data leave the company through a key? */
export async function mayLeave({ orgId } = {}) {
  const policy = await getPolicy({ orgId });
  return { ok: !!policy.allow_external, version: policy.version };
}

export async function noteExternalRefusal({ orgId, detail } = {}) {
  const policy = await getPolicy({ orgId });
  await recordRefusal({
    orgId,
    amberId: null,
    source: "api",
    reason: "external_forbidden",
    detail: detail ?? "person-level read refused: external sharing is off",
    version: policy.version,
  });
}

/**
 * Apply the retention rule.
 *
 * DELETES, rather than hiding. A retention promise that leaves the rows in
 * place and filters them out of reads is not a retention promise, it is a
 * report, and the first subpoena establishes the difference.
 *
 * Edges are rebuilt afterwards for anybody affected, because an edge derived
 * from interactions that no longer exist is asserting a relationship whose
 * evidence has been deleted.
 */
export async function applyRetention({ orgId } = {}) {
  const policy = await getPolicy({ orgId });
  if (!policy.retention_months) return { ok: true, removed: 0, skipped: "no_retention" };

  const { rows: touched } = await query(
    `SELECT DISTINCT person_id, member_id FROM org_interactions
      WHERE org_id = $1::uuid AND member_id IS NOT NULL
        AND occurred_at < now() - make_interval(months => $2::int)`,
    [orgId, policy.retention_months],
  );

  const { rowCount: removed } = await query(
    `DELETE FROM org_interactions
      WHERE org_id = $1::uuid
        AND occurred_at < now() - make_interval(months => $2::int)`,
    [orgId, policy.retention_months],
  );

  if (removed > 0) {
    const { refreshEdge } = await import("./org-memory-store.js");
    for (const t of touched) {
      await refreshEdge({ orgId, personId: t.person_id, memberId: t.member_id }).catch(() => null);
    }
    await query(
      `DELETE FROM org_person_edges e
        WHERE e.org_id = $1::uuid
          AND NOT EXISTS (
            SELECT 1 FROM org_interactions i
             WHERE i.org_id = e.org_id AND i.person_id = e.person_id
               AND i.member_id = e.member_id
          )`,
      [orgId],
    );
  }

  return { ok: true, removed };
}

/** What the gate has stopped, newest first. The evidence an auditor asks for. */
export async function listRefusals({ orgId, limit = 50 } = {}) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT r.id, r.source, r.reason, r.detail, r.policy_version, r.occurred_at,
            u.full_name AS member_name
       FROM org_policy_refusals r
       LEFT JOIN users u ON u.amber_id = r.amber_id
      WHERE r.org_id = $1::uuid
      ORDER BY r.occurred_at DESC
      LIMIT $2`,
    [orgId, Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}
