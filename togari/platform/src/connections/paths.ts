/**
 * connection_paths persistence (migration 0041): warm-intro paths on their
 * way to, and through, the daily Slack digest.
 *
 * Owns every write to connection_paths. path_id uniqueness is a property of
 * the MERGE below, not of the table, as for reply_items.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import type { ConnectionPathPayload } from "./types";

const logger = createLogger("connections/paths");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function pathsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.connection_paths\``;
}

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

export type PathVerdict = "good" | "not_a_fit";

export interface ConnectionPath {
  path_id: string;
  client_id: string;
  person_row_id: string | null;
  champion_name: string;
  champion_title: string | null;
  champion_company: string | null;
  champion_email: string | null;
  bridge_name: string;
  bridge_title: string | null;
  bridge_relation: string | null;
  bridge_linkedin: string | null;
  former_employer: string | null;
  former_title: string | null;
  start_year: number | null;
  end_year: number | null;
  role_source_url: string | null;
  target_account: string;
  target_segment: string | null;
  match: string | null;
  buyer_name: string;
  buyer_title: string | null;
  buyer_persona: string | null;
  buyer_linkedin: string | null;
  buyer_source_url: string | null;
  buyer_joined_year: number | null;
  tenure_overlap: string | null;
  overlap_years: number | null;
  slack_channel: string | null;
  slack_ts: string | null;
  thread_ts: string | null;
  verdict: PathVerdict | null;
  verdict_by: string | null;
  verdict_at: string | null;
  draft: string | null;
  draft_ts: string | null;
}

/**
 * The same four people and places, however they were found. Names are
 * lowercased and whitespace-collapsed so a capitalization change in a re-run
 * does not mint a second path.
 */
export function connectionPathId(p: {
  client_id: string;
  person_name: string;
  bridge_name: string;
  target_account: string;
  target_contact_name: string;
}): string {
  const key = [p.client_id, p.person_name, p.bridge_name, p.target_account, p.target_contact_name]
    .map((v) => v.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Loose enough for a contact field, strict enough not to show a row id as one. */
export function isEmail(value: string | null | undefined): value is string {
  return !!value && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(value.trim());
}

/**
 * How to reach the champion: the email stored with the path, or a person
 * row id that is itself an email (Clay's intake often keys on it).
 */
export function contactEmail(p: Pick<ConnectionPath, "champion_email" | "person_row_id">): string | null {
  if (isEmail(p.champion_email)) return p.champion_email.trim();
  if (isEmail(p.person_row_id)) return p.person_row_id.trim();
  return null;
}

/** Insert a path if it is new. Returns false for a path already known. */
export async function insertPath(
  p: ConnectionPathPayload,
  championEmail: string | null = null,
): Promise<{ pathId: string; inserted: boolean }> {
  const pathId = connectionPathId(p);
  const num = (n: number | null | undefined) => (n == null ? null : String(n));
  const res = await bq().executeWrite(
    `MERGE ${pathsTable()} T
     USING (SELECT @pathId AS path_id) S
     ON T.path_id = S.path_id
     WHEN NOT MATCHED THEN INSERT
       (path_id, client_id, person_row_id, created_at, updated_at,
        champion_name, champion_title, champion_company, champion_email,
        bridge_name, bridge_title, bridge_relation, bridge_linkedin,
        former_employer, former_title, start_year, end_year, role_source_url,
        target_account, target_segment, match,
        buyer_name, buyer_title, buyer_persona, buyer_linkedin, buyer_source_url,
        buyer_joined_year, tenure_overlap, overlap_years)
     VALUES
       (@pathId, @clientId, @personRowId, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
        @championName, @championTitle, @championCompany, @championEmail,
        @bridgeName, @bridgeTitle, @bridgeRelation, @bridgeLinkedin,
        @formerEmployer, @formerTitle, SAFE_CAST(@startYear AS INT64),
        SAFE_CAST(@endYear AS INT64), @roleSourceUrl,
        @targetAccount, @targetSegment, @match,
        @buyerName, @buyerTitle, @buyerPersona, @buyerLinkedin, @buyerSourceUrl,
        SAFE_CAST(@buyerJoinedYear AS INT64), @tenureOverlap,
        SAFE_CAST(@overlapYears AS INT64))`,
    {
      pathId,
      clientId: p.client_id,
      personRowId: p.person_row_id ?? null,
      championName: p.person_name,
      championTitle: p.person_title ?? null,
      championCompany: p.person_company ?? null,
      championEmail: championEmail,
      bridgeName: p.bridge_name,
      bridgeTitle: p.bridge_title ?? null,
      bridgeRelation: p.bridge_relation ?? null,
      bridgeLinkedin: p.bridge_linkedin ?? null,
      formerEmployer: p.former_employer ?? null,
      formerTitle: p.former_title ?? null,
      startYear: num(p.start_year),
      endYear: num(p.end_year),
      roleSourceUrl: p.role_source_url ?? null,
      targetAccount: p.target_account,
      targetSegment: p.target_segment ?? null,
      match: p.match ?? null,
      buyerName: p.target_contact_name,
      buyerTitle: p.target_contact_title ?? null,
      buyerPersona: p.target_contact_persona ?? null,
      buyerLinkedin: p.target_contact_linkedin ?? null,
      buyerSourceUrl: p.target_contact_source_url ?? null,
      buyerJoinedYear: num(p.target_contact_joined_year),
      tenureOverlap: p.tenure_overlap ?? null,
      overlapYears: num(p.overlap_years),
    },
  );
  return { pathId, inserted: Number(res.numDmlAffectedRows ?? "0") > 0 };
}

const PATH_COLUMNS = `path_id, client_id, person_row_id, champion_name, champion_title,
  champion_company, champion_email, bridge_name, bridge_title, bridge_relation, bridge_linkedin,
  former_employer, former_title, start_year, end_year, role_source_url,
  target_account, target_segment, match, buyer_name, buyer_title, buyer_persona,
  buyer_linkedin, buyer_source_url, buyer_joined_year, tenure_overlap,
  overlap_years, slack_channel, slack_ts, thread_ts, verdict, verdict_by,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', verdict_at) AS verdict_at, draft, draft_ts`;

function toPath(r: Record<string, unknown>): ConnectionPath {
  const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    path_id: String(r.path_id),
    client_id: String(r.client_id),
    person_row_id: str(r.person_row_id),
    champion_name: String(r.champion_name ?? ""),
    champion_title: str(r.champion_title),
    champion_company: str(r.champion_company),
    champion_email: str(r.champion_email),
    bridge_name: String(r.bridge_name ?? ""),
    bridge_title: str(r.bridge_title),
    bridge_relation: str(r.bridge_relation),
    bridge_linkedin: str(r.bridge_linkedin),
    former_employer: str(r.former_employer),
    former_title: str(r.former_title),
    start_year: num(r.start_year),
    end_year: num(r.end_year),
    role_source_url: str(r.role_source_url),
    target_account: String(r.target_account ?? ""),
    target_segment: str(r.target_segment),
    match: str(r.match),
    buyer_name: String(r.buyer_name ?? ""),
    buyer_title: str(r.buyer_title),
    buyer_persona: str(r.buyer_persona),
    buyer_linkedin: str(r.buyer_linkedin),
    buyer_source_url: str(r.buyer_source_url),
    buyer_joined_year: num(r.buyer_joined_year),
    tenure_overlap: str(r.tenure_overlap),
    overlap_years: num(r.overlap_years),
    slack_channel: str(r.slack_channel),
    slack_ts: str(r.slack_ts),
    thread_ts: str(r.thread_ts),
    verdict: str(r.verdict) as PathVerdict | null,
    verdict_by: str(r.verdict_by),
    verdict_at: str(r.verdict_at),
    draft: str(r.draft),
    draft_ts: str(r.draft_ts),
  };
}

export async function getPath(pathId: string): Promise<ConnectionPath | null> {
  const { rows } = await bq().executeQuery(
    `SELECT ${PATH_COLUMNS} FROM ${pathsTable()} WHERE path_id = @pathId LIMIT 1`,
    { pathId },
  );
  return rows[0] ? toPath(rows[0]) : null;
}

/** Every path whose block lives in one Slack message, to redraw it. */
export async function pathsInMessage(slackTs: string): Promise<ConnectionPath[]> {
  const { rows } = await bq().executeQuery(
    `SELECT ${PATH_COLUMNS} FROM ${pathsTable()} WHERE slack_ts = @slackTs`,
    { slackTs },
  );
  return rows.map(toPath);
}

/**
 * The local date of this client's last digest, or null if there has never
 * been one. What stops a restart from posting a second digest the same day.
 */
export async function lastDigestDate(clientId: string, timezone: string): Promise<string | null> {
  const { rows } = await bq().executeQuery(
    `SELECT FORMAT_TIMESTAMP('%F', MAX(posted_at), @timezone) AS d
       FROM ${pathsTable()}
      WHERE client_id = @clientId AND slack_ts IS NOT NULL`,
    { clientId, timezone },
  );
  return rows[0]?.d ? String(rows[0].d) : null;
}

/**
 * Claim every path waiting for this client's digest, before anything is
 * posted. Stamped rather than selected, so two runs racing cannot both post
 * the same path.
 */
export async function claimPendingPaths(clientId: string, digestId: string): Promise<ConnectionPath[]> {
  await bq().executeWrite(
    `UPDATE ${pathsTable()}
        SET digest_id = @digestId, posted_at = CURRENT_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP()
      WHERE client_id = @clientId AND posted_at IS NULL`,
    { clientId, digestId },
  );
  const { rows } = await bq().executeQuery(
    `SELECT ${PATH_COLUMNS} FROM ${pathsTable()} WHERE digest_id = @digestId`,
    { digestId },
  );
  return rows.map(toPath);
}

/** Put a digest's paths back, after its post failed, for the next run. */
export async function releaseDigest(digestId: string): Promise<void> {
  await bq().executeWrite(
    `UPDATE ${pathsTable()}
        SET digest_id = NULL, posted_at = NULL, updated_at = CURRENT_TIMESTAMP()
      WHERE digest_id = @digestId AND slack_ts IS NULL`,
    { digestId },
  );
}

/** Record which Slack message each path landed in. */
export async function savePathMessage(params: {
  pathIds: string[];
  channel: string;
  slackTs: string;
  threadTs: string;
}): Promise<void> {
  if (params.pathIds.length === 0) return;
  await bq().executeWrite(
    `UPDATE ${pathsTable()}
        SET slack_channel = @channel, slack_ts = @slackTs, thread_ts = @threadTs,
            updated_at = CURRENT_TIMESTAMP()
      WHERE path_id IN UNNEST(@pathIds)`,
    { pathIds: params.pathIds, channel: params.channel, slackTs: params.slackTs, threadTs: params.threadTs },
  );
}

/**
 * Record a verdict, once. Compare-and-set on verdict IS NULL, so two people
 * clicking at the same moment cannot both win, and the second click cannot
 * produce a second draft.
 */
export async function claimVerdict(params: {
  pathId: string;
  verdict: PathVerdict;
  userId: string;
}): Promise<boolean> {
  const res = await bq().executeWrite(
    `UPDATE ${pathsTable()}
        SET verdict = @verdict, verdict_by = @userId, verdict_at = CURRENT_TIMESTAMP(),
            updated_at = CURRENT_TIMESTAMP()
      WHERE path_id = @pathId AND verdict IS NULL`,
    params,
  );
  const claimed = Number(res.numDmlAffectedRows ?? "0") > 0;
  if (!claimed) logger.info("connections.path.verdict_already_set", { pathId: params.pathId });
  return claimed;
}

/** Save the intro draft and the thread reply that shows it. */
export async function saveDraft(params: {
  pathId: string;
  draft: string;
  draftTs?: string | null;
}): Promise<void> {
  await bq().executeWrite(
    `UPDATE ${pathsTable()}
        SET draft = @draft,
            draft_ts = COALESCE(@draftTs, draft_ts),
            updated_at = CURRENT_TIMESTAMP()
      WHERE path_id = @pathId`,
    { pathId: params.pathId, draft: params.draft, draftTs: params.draftTs ?? null },
  );
}
