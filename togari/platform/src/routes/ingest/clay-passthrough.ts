import crypto from "crypto";
import express, { Request, Response, Router, NextFunction } from "express";
import { BigQuery } from "@google-cloud/bigquery";
import { z } from "zod";
import { createFixedWindowRateLimit } from "../../middleware/ingest-rate-limit";

// ============================================================
// Tag → destination routing
// ------------------------------------------------------------
// Clay sends a `tag` field. We look up the destination
// dataset/table from this map. To onboard a new client, add
// one line here — no other code changes needed.
// ============================================================
const GCP_PROJECT_ID =
  process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

const TAG_ROUTING: Record<string, { dataset: string; table: string }> = {
  bma: { dataset: "togari_data_lake", table: "companies" },
};

// Contacts routing — same shape as TAG_ROUTING but targets the
// `contacts` table. Kept separate so the two ingest paths can
// diverge (different tables, different allowlists) without
// stepping on each other.
const CONTACTS_TAG_ROUTING: Record<string, { dataset: string; table: string }> =
  {
    bma: { dataset: "togari_data_lake", table: "contacts" },
  };

// Column allowlist for contacts — columns that Clay may write.
// Same exclusion principle as COMPANIES_PAYLOAD_COLUMNS: no lineage
// columns, no _parsed_*, no _resolved_id (those are derived by a
// separate ETL pass).
const CONTACTS_PAYLOAD_COLUMNS = new Set<string>([
  "full_name",
  "activity_sync",
  "auto_updated_by_dqa",
  "bounce_count",
  "company",
  "bounce_rate",
  "job_title",
  "bounced",
  "contact_type",
  "email",
  "click_rate",
  "business_phone",
  "click_rate_score",
  "mobile_phone",
  "combined_score",
  "contact_owner",
  "sync_to_outlook",
  "contact_frequency",
  "country",
  "future_contact_date",
  "country_sub_region",
  "last_contact_date",
  "created_source",
  "last_contact_method",
  "created_source_dqa",
  "last_activity",
  "date_time_of_last_campaign_attempted",
  "address",
  "date_time_of_last_campaign_delivered",
  "city",
  "date_time_of_last_click",
  "date_time_of_last_interaction",
  "state",
  "date_time_of_last_open",
  "zpostal_code",
  "dc_import_id",
  "metro_area",
  "postal_code",
  "country_text",
  "enformion_mobile",
  "engagement_score",
  "firm_relationship_score",
  "flagged_by_list_cleanup_tool",
  "sectors",
  "sub_sectors",
  "global_region",
  "global_sub_region",
  "globally_unsubscribed",
  "grata_email",
  "linkedin_url",
  "grata_id",
  "legacy_system_id",
  "grata_job_title",
  "grata_linkedin",
  "grata_source",
  "groups_unsubscribed_from",
  "interactions_past_qtr",
  "key_contact",
  "last_6_mos_trend",
  "last_qtr_trend",
  "last_year_trend",
  "legacy_source_file",
  "machine_opens",
  "machine_opens_rate",
  "marketing_health",
  "modified_source",
  "modified_source_dqa",
  "no_contacts_last_30_days",
  "no_meetings_last_30_days",
  "no_of_emails_last_30_days",
  "no_of_interaction_last_30_days",
  "no_phone_calls_last_30_days",
  "open_rate",
  "open_rate_score",
  "pending_update",
  "photo",
  "postal_code_lookup",
  "postal_code_reference",
  "regional_language",
  "relationship_status",
  "signature_block",
  "signature_collected_date",
  "signature_updated_date",
  "signature_verified_date",
  "state_reference",
  "total_clicks",
  "total_emails_attempted",
  "total_emails_received",
  "total_opens",
  "true_people_search",
  "unique_clicks",
  "unique_conventional_open_rate",
  "unique_conventional_opens",
  "unique_machine_opens",
  "unique_opens",
  "unsubscribe_count",
  "unsubscribe_rate",
  "zoominfo_mobile",
]);

const DEFAULT_TAG = "bma";

// ============================================================
// Column allowlist — the source columns that Clay is permitted
// to write. Deliberately EXCLUDES:
//   - lineage columns (row_id, _import_run_id, _imported_at,
//     _source_file) — always generated server-side
//   - _parsed_* columns — derived by a separate ETL pass
//   - _resolved_id columns — derived by a separate ETL pass
// Any payload key not in this set is dropped (and reported
// back in `columns_dropped`).
// ============================================================
const COMPANIES_PAYLOAD_COLUMNS = new Set<string>([
  "company_name",
  "business_notes",
  "relationship_managers",
  "contacts_at_company",
  "contact_status",
  "backup_buyer",
  "contact_notes",
  "industry",
  "vertical",
  "counterparty_type",
  "last_activity_date",
  "last_activity",
  "days_since_contact_number",
  "address",
  "city",
  "state",
  "country_sub_region",
  "country",
  "days_since_contact",
  "zpostal_code",
  "postal_code",
  "dc_import_id",
  "metro_area",
  "employee_count",
  "engagement",
  "enterprise_value",
  "ownership_structure",
  "ev_to_ebitda_multiple",
  "website",
  "ev_to_revenue_multiple",
  "financials_as_of_date",
  "parent_sponsor_company",
  "firm_relationship_score",
  "ticker",
  "first_interaction_date",
  "revenue",
  "ebitda",
  "global_region",
  "global_region_preferences",
  "global_sub_region",
  "grata_1mo_growth_pct",
  "transaction_size_preferences",
  "grata_1yr_growth_pct",
  "grata_3mo_growth_pct",
  "min_revenue",
  "grata_6mo_growth_pct",
  "max_revenue",
  "grata_business_description",
  "min_ebitda",
  "grata_company_name",
  "max_ebitda",
  "grata_country",
  "preference_notes",
  "grata_employees_estimates",
  "no_ma_engagements_shown",
  "grata_employees_on_professional_networks",
  "grata_funding",
  "grata_funding_type",
  "grata_hq_address",
  "grata_hq_city",
  "grata_hq_state",
  "grata_id",
  "grata_industries_naics_2",
  "grata_industries_naics_4",
  "grata_industries_naics_6",
  "grata_linkedin",
  "grata_list",
  "grata_notes",
  "grata_ownership",
  "grata_phone_number",
  "grata_postal_code",
  "grata_source",
  "grata_type",
  "grata_ultimate_parent",
  "grata_website",
  "grata_year_founded",
  "groups",
  "has_counterparty_target",
  "interactions_past_qtr",
  "key_contact",
  "last_6_mos_trend",
  "last_engagement",
  "last_engagement_as_competitor",
  "last_engagement_furthest_milestone",
  "last_engagement_shown",
  "last_qtr_trend",
  "last_task_completed",
  "last_task_completed_date",
  "last_year_trend",
  "legacy_source_file",
  "legacy_system_id",
  "msa",
  "no_debt_deals_closed",
  "no_debt_engagements_shown",
  "no_engagements_as_client",
  "no_engagements_as_competitor",
  "no_engagements_as_winning_competitor",
  "no_engagements_closed",
  "no_engagements_nobody_won",
  "no_engagements_referred",
  "no_indicative_terms_received",
  "no_iois_submitted",
  "no_lois_submitted",
  "no_ndas_signed",
  "no_of_touchpoints",
  "sub_vertical",
  "no_teasers_sent",
  "pipeline_estimated_fees",
  "postal_code_lookup",
  "postal_code_reference",
  "primary_coverage_person",
  "relationship_status",
  "industry_preferences",
  "state_reference",
  "sub_type",
  "task",
  "tier",
  "vertical_preferences",
  "total_fees_received",
  "total_fees_received_as_client",
  "total_fees_received_as_parent_sponsor",
  "total_referred_fees",
  "type",
  "watchlist",
  "win_ratio",
]);

// ============================================================
// Payload schema — company_name is required, tag is an
// optional routing key. Everything else is preserved via
// .passthrough() and filtered against COMPANIES_PAYLOAD_COLUMNS
// at row-build time (not at the Zod layer).
// ============================================================
const ClayCompanyPayload = z
  .object({
    tag: z.string().trim().min(1).optional().default(DEFAULT_TAG),
    company_name: z.string().trim().min(1, "company_name is required"),
  })
  .passthrough();

// Contacts payload — full_name is the only required field
// (email and phone are inconsistent across contacts). Same
// passthrough/filter pattern as ClayCompanyPayload.
const ClayContactPayload = z
  .object({
    tag: z.string().trim().min(1).optional().default(DEFAULT_TAG),
    full_name: z.string().trim().min(1, "full_name is required"),
  })
  .passthrough();

// ============================================================
// Auth — dedicated key, separate from TOGARI_API_KEY so it
// can be rotated independently.
// ============================================================
function safeEqual(a: string, b: string): boolean {
  // Constant-time comparison to avoid leaking the key via timing. Length is
  // compared first because timingSafeEqual throws on unequal-length buffers;
  // that length check is not itself a meaningful side channel for a random key.
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireClayIngestAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expected = process.env.CLAY_INGEST_API_KEY;
  if (!expected) {
    res.status(500).json({ error: "CLAY_INGEST_API_KEY not configured" });
    return;
  }
  const provided = (req.header("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

// ============================================================
// BigQuery singleton using GCP_CREDENTIALS_BASE64 — matches
// the existing pattern used elsewhere in this repo.
// ============================================================
let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;
  const credsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  if (!credsBase64) throw new Error("GCP_CREDENTIALS_BASE64 not set");
  const credentials = JSON.parse(
    Buffer.from(credsBase64, "base64").toString("utf-8"),
  );
  bigqueryClient = new BigQuery({ projectId: GCP_PROJECT_ID, credentials });
  return bigqueryClient;
}

// ============================================================
// Normalize website — strip protocol, www., trailing slash,
// lowercase. Keeps stored values consistent for future dedup.
// ============================================================
function normalizeWebsite(raw: string): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

// ============================================================
// Router — mount under /webhooks/clay
// ============================================================
export function createClayPassthroughIngestRouter(): Router {
  const router = express.Router();
  // Rate limit before body parsing so throttled requests are cheap. Bounds
  // BigQuery insert cost if the ingest key leaks; tune per-minute via env.
  const perMin = Number(process.env.CLAY_INGEST_RATE_LIMIT_PER_MIN) || 600;
  router.use(createFixedWindowRateLimit(perMin));
  router.use(express.json({ limit: "256kb" }));

  router.post(
    "/companies",
    requireClayIngestAuth,
    async (req: Request, res: Response) => {
      const parsed = ClayCompanyPayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const payload = parsed.data;

      const dest = TAG_ROUTING[payload.tag];
      if (!dest) {
        return res.status(400).json({
          error: "unknown_tag",
          message: `Tag "${payload.tag}" has no routing rule. Add it to TAG_ROUTING.`,
          known_tags: Object.keys(TAG_ROUTING),
        });
      }

      // Separate the routing key from the column payload — `tag`
      // decides the destination, it is not a column.
      const { tag, ...rest } = payload;

      // Filter the remaining keys against the allowlist. Drop
      // anything not in COMPANIES_PAYLOAD_COLUMNS, plus any
      // null/undefined/empty-string values. Track drops for the
      // response so the caller can see what didn't make it.
      const filteredPayload: Record<string, unknown> = {};
      const columnsDropped: string[] = [];
      for (const [key, value] of Object.entries(rest)) {
        if (
          COMPANIES_PAYLOAD_COLUMNS.has(key) &&
          value !== null &&
          value !== undefined &&
          value !== ""
        ) {
          filteredPayload[key] = value;
        } else {
          columnsDropped.push(key);
        }
      }

      // Normalize website in place if the caller supplied one;
      // otherwise treat it as empty for row_id derivation.
      const normalizedWebsite =
        "website" in filteredPayload
          ? normalizeWebsite(String(filteredPayload.website))
          : "";
      if ("website" in filteredPayload) {
        filteredPayload.website = normalizedWebsite;
      }

      // row_id derivation is unchanged — keep it stable so
      // re-imports stay idempotent.
      const rowIdSource = `${tag}:${payload.company_name.toLowerCase().trim()}:${normalizedWebsite}`;
      const rowId = crypto
        .createHash("sha256")
        .update(rowIdSource)
        .digest("hex");

      // Spread the filtered payload first, then stamp the lineage
      // columns LAST so a caller can never override them.
      const row: Record<string, unknown> = {
        ...filteredPayload,
        row_id: rowId,
        _import_run_id: crypto.randomUUID(),
        _imported_at: new Date().toISOString(),
        _source_file: "clay-passthrough-ingest",
      };

      try {
        // Pass row_id as the streaming insertId so BigQuery best-effort
        // dedupes retries / accidental double-sends within its dedup window.
        // For durable long-window dedup, downstream consumers should read
        // through a `QUALIFY ROW_NUMBER() OVER (PARTITION BY row_id ...)`
        // view rather than the raw table.
        await getBigQueryClient()
          .dataset(dest.dataset)
          .table(dest.table)
          .insert([{ insertId: rowId, json: row }], { raw: true });

        console.log(
          `[clay-ingest] "${row.company_name}" → ${dest.dataset}.${dest.table}`,
        );

        return res.status(200).json({
          status: "ingested",
          tag: payload.tag,
          destination: `${GCP_PROJECT_ID}.${dest.dataset}.${dest.table}`,
          row,
          columns_persisted: Object.keys(row).sort(),
          columns_dropped: columnsDropped.sort(),
        });
      } catch (err: any) {
        const insertErrors = err?.errors || err?.response?.insertErrors || null;
        console.error(
          "[clay-ingest] BigQuery insert failed:",
          JSON.stringify(insertErrors || { message: err?.message }, null, 2),
        );
        return res.status(500).json({
          error: "bigquery_insert_failed",
          message: err?.message || "unknown error",
          details: insertErrors,
        });
      }
    },
  );

  router.post(
    "/contacts",
    requireClayIngestAuth,
    async (req: Request, res: Response) => {
      const parsed = ClayContactPayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const payload = parsed.data;

      const dest = CONTACTS_TAG_ROUTING[payload.tag];
      if (!dest) {
        return res.status(400).json({
          error: "unknown_tag",
          message: `Tag "${payload.tag}" has no routing rule. Add it to CONTACTS_TAG_ROUTING.`,
          known_tags: Object.keys(CONTACTS_TAG_ROUTING),
        });
      }

      // Separate the routing key from the column payload — `tag`
      // decides the destination, it is not a column.
      const { tag, ...rest } = payload;

      // Filter the remaining keys against the allowlist. Drop
      // anything not in CONTACTS_PAYLOAD_COLUMNS, plus any
      // null/undefined/empty-string values. Track drops for the
      // response so the caller can see what didn't make it.
      const filteredPayload: Record<string, unknown> = {};
      const columnsDropped: string[] = [];
      for (const [key, value] of Object.entries(rest)) {
        if (
          CONTACTS_PAYLOAD_COLUMNS.has(key) &&
          value !== null &&
          value !== undefined &&
          value !== ""
        ) {
          filteredPayload[key] = value;
        } else {
          columnsDropped.push(key);
        }
      }

      // row_id uses a 4-part natural key (tag + name + email +
      // company) so the same person re-imported is idempotent,
      // while same-named people at different companies don't
      // collide. Missing email/company still yield a stable hash.
      const fullNameKey = payload.full_name.trim().toLowerCase();
      const emailKey = String(filteredPayload.email ?? "")
        .trim()
        .toLowerCase();
      const companyKey = String(filteredPayload.company ?? "")
        .trim()
        .toLowerCase();
      const rowIdSource = `${tag}:${fullNameKey}:${emailKey}:${companyKey}`;
      const rowId = crypto
        .createHash("sha256")
        .update(rowIdSource)
        .digest("hex");

      // Spread the filtered payload first, then stamp the lineage
      // columns LAST so a caller can never override them.
      const row: Record<string, unknown> = {
        ...filteredPayload,
        row_id: rowId,
        _import_run_id: crypto.randomUUID(),
        _imported_at: new Date().toISOString(),
        _source_file: "clay-passthrough-ingest",
      };

      try {
        // Pass row_id as the streaming insertId so BigQuery best-effort
        // dedupes retries / accidental double-sends within its dedup window.
        // For durable long-window dedup, downstream consumers should read
        // through a `QUALIFY ROW_NUMBER() OVER (PARTITION BY row_id ...)`
        // view rather than the raw table.
        await getBigQueryClient()
          .dataset(dest.dataset)
          .table(dest.table)
          .insert([{ insertId: rowId, json: row }], { raw: true });

        console.log(
          `[clay-ingest] "${row.full_name}" → ${dest.dataset}.${dest.table}`,
        );

        return res.status(200).json({
          status: "ingested",
          tag: payload.tag,
          destination: `${GCP_PROJECT_ID}.${dest.dataset}.${dest.table}`,
          row,
          columns_persisted: Object.keys(row).sort(),
          columns_dropped: columnsDropped.sort(),
        });
      } catch (err: any) {
        const insertErrors = err?.errors || err?.response?.insertErrors || null;
        console.error(
          "[clay-ingest] BigQuery insert failed:",
          JSON.stringify(insertErrors || { message: err?.message }, null, 2),
        );
        return res.status(500).json({
          error: "bigquery_insert_failed",
          message: err?.message || "unknown error",
          details: insertErrors,
        });
      }
    },
  );

  router.get(
    "/health",
    requireClayIngestAuth,
    async (_req: Request, res: Response) => {
      try {
        await getBigQueryClient().getDatasets({ maxResults: 1 });
        return res.status(200).json({
          status: "ok",
          gcp_project: GCP_PROJECT_ID,
          known_tags: Object.keys(TAG_ROUTING),
        });
      } catch (err: any) {
        return res.status(500).json({ status: "error", message: err?.message });
      }
    },
  );

  return router;
}
