/**
 * Network persistence (migration 0049). Owns every write to togari_core.network_*.
 *
 * Each table is written with one MERGE on its derived key, so recording the
 * same research twice — Perplexity retrying a callback, the backfill re-run —
 * changes nothing but last_seen_at. Rows go in as one JSON array parameter
 * (the pattern src/replies/store.ts uses), deduplicated by key first: a MERGE
 * whose source matches one target row twice is an error, not a no-op.
 *
 * recordNetwork never throws. It runs after a result is already saved for the
 * client, and the client's paths must not depend on the shared database.
 */

import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import type { ConnectionItemRow } from "../connections/store";
import type { ConnectionResultPayload } from "../connections/types";
import type { TargetAccount } from "../connections/targets";
import {
  buildNetworkRecords,
  RESEARCH_METHOD,
  type NetworkRecords,
  type RecordOptions,
} from "./records";

const logger = createLogger("network/store");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.NETWORK_DATASET || "togari_core";

const table = (name: string) => `\`${PROJECT_ID}.${DATASET}.${name}\``;

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

/**
 * Pooled data is licensable unless switched off. NETWORK_LICENSABLE_DEFAULT=false
 * makes new people internal-only until someone marks them otherwise.
 */
function licensableDefault(): boolean {
  return (process.env.NETWORK_LICENSABLE_DEFAULT ?? "true").trim().toLowerCase() !== "false";
}

const v = (field: string) => `JSON_VALUE(r, '$.${field}')`;
const int = (field: string) => `SAFE_CAST(${v(field)} AS INT64)`;
const bool = (field: string) => `SAFE_CAST(${v(field)} AS BOOL)`;
const arr = (field: string) => `JSON_VALUE_ARRAY(r, '$.${field}')`;

export async function writeNetworkRecords(
  records: NetworkRecords,
  bq: BigQueryClient = moduleBq(),
): Promise<void> {
  const common = {
    at: records.observedAt,
    clientId: records.clientId,
    researchId: records.researchId,
    method: RESEARCH_METHOD,
  };

  if (records.orgs.length > 0) {
    await bq.executeWrite(
      `MERGE ${table("network_organizations")} T
       USING (
         SELECT ${v("org_id")} AS org_id, ${v("name")} AS name,
                ${v("name_normalized")} AS name_normalized, ${v("domain")} AS domain,
                ${v("org_type")} AS org_type, ${v("segment")} AS segment
           FROM UNNEST(JSON_QUERY_ARRAY(@rows)) r
       ) S
       ON T.org_id = S.org_id
       WHEN MATCHED THEN UPDATE SET
         domain = COALESCE(T.domain, S.domain),
         org_type = COALESCE(T.org_type, S.org_type),
         segment = COALESCE(T.segment, S.segment),
         aliases = IF(S.name = T.name OR S.name IN UNNEST(IFNULL(T.aliases, [])),
                      T.aliases, ARRAY_CONCAT(IFNULL(T.aliases, []), [S.name])),
         last_seen_at = GREATEST(T.last_seen_at, TIMESTAMP(@at))
       WHEN NOT MATCHED THEN INSERT
         (org_id, name, name_normalized, domain, aliases, parent_org_id, org_type, segment,
          first_seen_at, last_seen_at)
       VALUES
         (S.org_id, S.name, S.name_normalized, S.domain, [], NULL, S.org_type, S.segment,
          TIMESTAMP(@at), TIMESTAMP(@at))`,
      { ...common, rows: JSON.stringify(records.orgs) },
    );
  }

  if (records.people.length > 0) {
    // A newer observation of someone's current seat wins; anything else only
    // fills a gap. Suppression is never touched here: once a person opts out,
    // research seeing them again must not bring them back.
    await bq.executeWrite(
      `MERGE ${table("network_people")} T
       USING (
         SELECT ${v("person_id")} AS person_id, ${v("full_name")} AS full_name,
                ${v("linkedin_url")} AS linkedin_url, ${v("linkedin_slug")} AS linkedin_slug,
                ${v("email")} AS email, ${v("email_source")} AS email_source,
                ${v("current_title")} AS current_title, ${v("current_org_id")} AS current_org_id,
                ${v("current_org_name")} AS current_org_name, ${v("location")} AS location,
                ${v("persona")} AS persona,
                IFNULL(${bool("history_complete")}, FALSE) AS history_complete,
                ${bool("identity_confirmed")} AS identity_confirmed,
                IFNULL(${bool("researched")}, FALSE) AS researched
           FROM UNNEST(JSON_QUERY_ARRAY(@rows)) r
       ) S
       ON T.person_id = S.person_id
       WHEN MATCHED THEN UPDATE SET
         linkedin_url = COALESCE(T.linkedin_url, S.linkedin_url),
         linkedin_slug = COALESCE(T.linkedin_slug, S.linkedin_slug),
         email = COALESCE(T.email, S.email),
         email_source = IF(T.email IS NULL, S.email_source, T.email_source),
         current_title = IF(TIMESTAMP(@at) >= T.last_seen_at, COALESCE(S.current_title, T.current_title), T.current_title),
         current_org_id = IF(TIMESTAMP(@at) >= T.last_seen_at, COALESCE(S.current_org_id, T.current_org_id), T.current_org_id),
         current_org_name = IF(TIMESTAMP(@at) >= T.last_seen_at, COALESCE(S.current_org_name, T.current_org_name), T.current_org_name),
         location = COALESCE(S.location, T.location),
         persona = COALESCE(S.persona, T.persona),
         history_complete = T.history_complete OR S.history_complete,
         identity_confirmed = COALESCE(S.identity_confirmed, T.identity_confirmed),
         last_researched_at = IF(S.researched,
                                 GREATEST(IFNULL(T.last_researched_at, TIMESTAMP(@at)), TIMESTAMP(@at)),
                                 T.last_researched_at),
         last_seen_at = GREATEST(T.last_seen_at, TIMESTAMP(@at)),
         source_client_ids = IF(@clientId IS NULL OR @clientId IN UNNEST(IFNULL(T.source_client_ids, [])),
                                T.source_client_ids,
                                ARRAY_CONCAT(IFNULL(T.source_client_ids, []), [@clientId]))
       WHEN NOT MATCHED THEN INSERT
         (person_id, full_name, linkedin_url, linkedin_slug, email, email_source,
          current_title, current_org_id, current_org_name, location, persona,
          history_complete, identity_confirmed, last_researched_at,
          first_seen_at, last_seen_at, source_client_ids,
          licensable, suppressed, suppressed_reason, suppressed_at)
       VALUES
         (S.person_id, S.full_name, S.linkedin_url, S.linkedin_slug, S.email, S.email_source,
          S.current_title, S.current_org_id, S.current_org_name, S.location, S.persona,
          S.history_complete, S.identity_confirmed, IF(S.researched, TIMESTAMP(@at), NULL),
          TIMESTAMP(@at), TIMESTAMP(@at), IF(@clientId IS NULL, [], [@clientId]),
          @licensable, FALSE, NULL, NULL)`,
      { ...common, licensable: licensableDefault(), rows: JSON.stringify(records.people) },
    );
  }

  if (records.jobs.length > 0) {
    await bq.executeWrite(
      `MERGE ${table("network_employment")} T
       USING (
         SELECT ${v("employment_id")} AS employment_id, ${v("person_id")} AS person_id,
                ${v("org_id")} AS org_id, ${v("org_name_as_sourced")} AS org_name_as_sourced,
                ${v("org_domain")} AS org_domain, ${v("title")} AS title,
                ${int("start_year")} AS start_year, ${int("end_year")} AS end_year,
                ${bool("is_current")} AS is_current, ${v("source_url")} AS source_url,
                ${v("evidence")} AS evidence
           FROM UNNEST(JSON_QUERY_ARRAY(@rows)) r
       ) S
       ON T.employment_id = S.employment_id
       WHEN MATCHED THEN UPDATE SET
         end_year = COALESCE(S.end_year, T.end_year),
         is_current = COALESCE(S.is_current, T.is_current),
         source_url = COALESCE(T.source_url, S.source_url),
         research_id = @researchId,
         client_id = @clientId,
         last_seen_at = GREATEST(T.last_seen_at, TIMESTAMP(@at))
       WHEN NOT MATCHED THEN INSERT
         (employment_id, person_id, org_id, org_name_as_sourced, org_domain, title,
          start_year, end_year, is_current, source_url, evidence, method,
          research_id, client_id, first_seen_at, last_seen_at)
       VALUES
         (S.employment_id, S.person_id, S.org_id, S.org_name_as_sourced, S.org_domain, S.title,
          S.start_year, S.end_year, S.is_current, S.source_url, S.evidence, @method,
          @researchId, @clientId, TIMESTAMP(@at), TIMESTAMP(@at))`,
      { ...common, rows: JSON.stringify(records.jobs) },
    );
  }

  await bq.executeWrite(
    `MERGE ${table("network_research_runs")} T
     USING (
       SELECT ${v("research_id")} AS research_id, ${v("row_id")} AS row_id,
              ${v("client_id")} AS client_id, ${v("subject_person_id")} AS subject_person_id,
              ${v("subject_org_id")} AS subject_org_id,
              ${arr("colleague_ids")} AS colleague_ids, ${arr("buyer_ids")} AS buyer_ids,
              ${arr("buyer_org_ids")} AS buyer_org_ids,
              ${bool("identity_confirmed")} AS identity_confirmed,
              ${int("people_found")} AS people_found, ${int("jobs_found")} AS jobs_found
         FROM UNNEST(JSON_QUERY_ARRAY(@rows)) r
     ) S
     ON T.research_id = S.research_id
     WHEN NOT MATCHED THEN INSERT
       (research_id, row_id, client_id, subject_person_id, subject_org_id,
        colleague_ids, buyer_ids, buyer_org_ids, identity_confirmed,
        people_found, jobs_found, method, researched_at, recorded_at)
     VALUES
       (S.research_id, S.row_id, S.client_id, S.subject_person_id, S.subject_org_id,
        S.colleague_ids, S.buyer_ids, S.buyer_org_ids, S.identity_confirmed,
        S.people_found, S.jobs_found, @method, TIMESTAMP(@at), CURRENT_TIMESTAMP())`,
    { ...common, rows: JSON.stringify([records.run]) },
  );
}

/**
 * Add one research result to the network. Logs and returns false on any
 * failure; the client's result is already safe in connection_items, and the
 * backfill script can replay it from there.
 */
export async function recordNetwork(
  row: ConnectionItemRow,
  result: ConnectionResultPayload,
  targets: TargetAccount[] | null,
  observedAt: Date = new Date(),
  opts: RecordOptions = {},
): Promise<boolean> {
  try {
    const records = buildNetworkRecords(row, result, targets, observedAt, opts);
    await writeNetworkRecords(records);
    logger.info("network.recorded", {
      rowId: row.row_id,
      clientId: row.client_id,
      people: records.people.length,
      orgs: records.orgs.length,
      jobs: records.jobs.length,
    });
    return true;
  } catch (err) {
    logger.error("network.record_failed", err instanceof Error ? err : new Error(String(err)), {
      rowId: row.row_id,
      clientId: row.client_id,
    });
    return false;
  }
}
