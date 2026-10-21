/**
 * REPORTING SOMEBODY, AND WHAT HAPPENS TO THE REPORT.
 *
 * The app had a block and no way to tell us anything. Those are different
 * things: a block is a private boundary between two people, and a report is a
 * claim that something should stop for everybody. An app where users see what
 * other users wrote needs both, and Apple's Guideline 1.2 says so explicitly.
 *
 * ── THE REPORT CARRIES EVIDENCE, OR IT IS NOT A REPORT ──────────────────────
 *
 * The obvious implementation stores who reported whom and why. Then the
 * reporter clears the thread -- which the app encourages, right next to the
 * block button -- and the report becomes an accusation with nothing behind it.
 * Nobody can act on that, in either direction: you cannot ban the accused and
 * you cannot clear them.
 *
 * So filing a report snapshots what the reported person actually sent, at the
 * moment it is filed. Only their half. The reporter's own messages are not
 * evidence of what somebody else did, and copying them would mean a report was
 * also a way to hand over your own words.
 *
 * ── FILING IS IDEMPOTENT, ON PURPOSE ────────────────────────────────────────
 *
 * A double tap, or a retry after the response was dropped, must not put two
 * rows in the review queue: a reviewer cannot tell that from a second incident,
 * and the count is the thing that turns three complaints into a pattern. The
 * partial unique index in migration 054 collapses them, and this returns the
 * existing report rather than an error, because from the user's side the answer
 * is the same -- it is reported.
 */

import { query } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * The reasons a person can pick, and the CHECK in migration 054 holds the same
 * list. Frozen because a caller pushing a new one here would insert fine in
 * tests with a fake query and fail against the real database.
 */
export const REPORT_REASONS = Object.freeze([
  "harassment",
  "spam",
  "impersonation",
  "sexual",
  "threat",
  "other",
]);

export const isReportReason = (v) => REPORT_REASONS.includes(v);

/** How much of the thread travels with the report. */
export const EVIDENCE_MAX = 20;
/** And how much of any one message, so a pasted wall of text cannot bloat a row. */
export const EVIDENCE_BODY_MAX = 2000;
/** The reporter's own note. */
export const DETAIL_MAX = 1000;

/**
 * Trim a list of thread messages down to the reported person's half.
 *
 * Takes messages in the shape dm-store returns them (newest first, with `mine`)
 * and returns oldest-first, because a reviewer reads a conversation forwards.
 */
export function evidenceFrom(messages, { max = EVIDENCE_MAX } = {}) {
  if (!Array.isArray(messages)) return [];
  return messages
    // NOT `!m.mine`: a message with no `mine` field at all is of unknown
    // authorship, and putting the reporter's own words in front of a reviewer
    // as the accused's is the one mistake here that is worse than no evidence.
    .filter((m) => m && m.mine === false)
    .slice(0, Math.max(0, max))
    .reverse()
    .map((m) => ({
      id: m.id == null ? null : String(m.id),
      kind: typeof m.kind === "string" ? m.kind : "text",
      body: typeof m.body === "string" ? m.body.slice(0, EVIDENCE_BODY_MAX) : "",
      createdAt: m.createdAt ?? null,
    }));
}

/**
 * File a report.
 *
 * @returns {Promise<{ok: true, id: string}|{ok: false, error: string}>}
 *   A named error rather than a boolean, because "you already reported this"
 *   and "the database is down" want different words on the screen.
 */
export async function fileReport(
  { reporterId, reportedId, threadId = null, reason, detail = null, evidence = [] },
  deps = {},
) {
  const run = deps.query || query;
  const reporter = asUuid(reporterId);
  const reported = asUuid(reportedId);
  if (!reporter || !reported) return { ok: false, error: "bad_party" };
  // Reporting yourself is not a thing, and the unique index would happily
  // accept it -- so it is refused here rather than reaching a reviewer.
  if (reporter === reported) return { ok: false, error: "bad_party" };
  if (!isReportReason(reason)) return { ok: false, error: "bad_reason" };

  const note =
    typeof detail === "string" && detail.trim() ? detail.trim().slice(0, DETAIL_MAX) : null;
  const tid = typeof threadId === "string" && threadId.trim() ? threadId.trim().slice(0, 64) : null;

  try {
    const { rows } = await run(
      /**
       * ON CONFLICT names the partial index by its predicate, which is the only
       * way to target a partial unique index. DO UPDATE rather than DO NOTHING
       * so the statement still RETURNS the row: DO NOTHING returns nothing at
       * all on a conflict, and the caller would read a successful duplicate as
       * a failed insert.
       *
       * The update also refreshes the detail and evidence, so somebody who
       * reports again after more messages arrive adds what is new rather than
       * silently changing nothing.
       */
      `INSERT INTO abuse_reports
         (reporter_amber_id, reported_amber_id, thread_id, reason, detail, evidence)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
       ON CONFLICT (reporter_amber_id, reported_amber_id, COALESCE(thread_id, ''))
         WHERE status = 'open'
         DO UPDATE SET reason   = EXCLUDED.reason,
                       detail   = COALESCE(EXCLUDED.detail, abuse_reports.detail),
                       evidence = EXCLUDED.evidence
       RETURNING id`,
      [reporter, reported, tid, reason, note, JSON.stringify(evidence ?? [])],
    );
    const id = rows?.[0]?.id;
    if (id == null) return { ok: false, error: "report_failed" };
    /**
     * LOUD, AND DELIBERATELY SO. There is no reviewer console yet, and a report
     * that lands only in a table nobody queries is the same as no report. This
     * line is what a log alert can be pointed at on the day this ships, and it
     * names no message bodies -- the evidence stays in the row.
     */
    console.warn(`ABUSE_REPORT_FILED id=${id} reason=${reason} reported=${reported}`);
    return { ok: true, id: String(id) };
  } catch (err) {
    console.error(`ABUSE_REPORT_ERR ${err?.message || err}`);
    return { ok: false, error: "report_failed" };
  }
}

/**
 * The open queue, oldest first. For the reviewer surface, whatever that becomes.
 * Read-only and deliberately not exposed on any user-facing route.
 */
export async function listOpenReports({ limit = 50 } = {}, deps = {}) {
  const run = deps.query || query;
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  try {
    const { rows } = await run(
      `SELECT id, reporter_amber_id, reported_amber_id, thread_id, reason,
              detail, evidence, created_at
         FROM abuse_reports
        WHERE status = 'open'
        ORDER BY created_at ASC
        LIMIT $1`,
      [cap],
    );
    return rows;
  } catch (err) {
    console.error(`ABUSE_REPORT_LIST_ERR ${err?.message || err}`);
    return [];
  }
}
