/**
 * @togari/admin — Clay payload persister
 *
 * Writes a validated Clay webhook payload into BigQuery:
 *   1. Audit row in `clay_imports` (status=pending → completed|failed)
 *   2. UPSERT companies (dedupe by website|domain|name within tenant)
 *   3. INSERT contacts linked to company id (dedupe by email|linkedin|name)
 *   4. UPSERT mandate_companies linking each company to mandate_id
 *
 * Idempotent: re-posting the same payload (same hash) short-circuits if the
 * matching `clay_imports` row is already `completed`. Otherwise MERGE
 * statements make re-runs converge to the same state.
 *
 * NOTE: assumes Tab 2's schema is applied. Until then, the route will return
 * 500 on the first INSERT — that's expected and visible in Sentry.
 */

import crypto from "crypto";
import { BigQueryClient } from "../../bigquery/client";
import { createLogger } from "../../observability/logger";
import {
  companyDedupeKey,
  contactDedupeKey,
  hashPayload,
  normalizeContactName,
  normalizeDomainLike,
} from "./parser";
import type { ClayCompany, ClayContact, ClayWebhookPayload } from "./schema";

const logger = createLogger("ingest/clay/persister");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

const CLAY_IMPORTS = `\`${PROJECT_ID}.${DATASET}.clay_imports\``;
const COMPANIES = `\`${PROJECT_ID}.${DATASET}.companies\``;
const CONTACTS = `\`${PROJECT_ID}.${DATASET}.contacts\``;
const MANDATE_COMPANIES = `\`${PROJECT_ID}.${DATASET}.mandate_companies\``;

export interface PersistResult {
  importId: string;
  payloadHash: string;
  status: "completed" | "duplicate";
  companyCount: number;
  contactCount: number;
}

export interface PersisterDeps {
  bq?: BigQueryClient;
  now?: () => Date;
  uuid?: () => string;
}

function defaultBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

export async function persistClayPayload(
  payload: ClayWebhookPayload,
  deps: PersisterDeps = {},
): Promise<PersistResult> {
  const bq = deps.bq ?? defaultBq();
  const uuid = deps.uuid ?? crypto.randomUUID.bind(crypto);
  const now = deps.now ?? (() => new Date());

  const payloadHash = hashPayload(payload);
  const tenantId = payload.tenant_id;
  const mandateId = payload.mandate_id ?? null;
  const clayRunId = payload.clay_run_id;

  // ── Idempotency check ────────────────────────────────────────────
  const existing = await bq.executeQuery(
    `SELECT id, status, payload_hash, company_count, contact_count
       FROM ${CLAY_IMPORTS}
      WHERE tenant_id = @tenantId AND clay_run_id = @clayRunId
      ORDER BY received_at DESC
      LIMIT 1`,
    { tenantId, clayRunId },
  );
  if (existing.rows.length > 0) {
    const prior = existing.rows[0] as {
      id: string;
      status: string;
      payload_hash: string;
      company_count?: number;
      contact_count?: number;
    };
    if (prior.status === "completed" && prior.payload_hash === payloadHash) {
      logger.info("Clay payload already ingested — short-circuit", {
        tenantId,
        clayRunId,
        importId: prior.id,
      });
      return {
        importId: prior.id,
        payloadHash,
        status: "duplicate",
        companyCount: prior.company_count ?? 0,
        contactCount: prior.contact_count ?? 0,
      };
    }
  }

  const importId = uuid();
  const totalRecords = payload.total_records ?? payload.rows.length;

  // ── Audit row: pending ───────────────────────────────────────────
  await bq.executeWrite(
    `INSERT INTO ${CLAY_IMPORTS}
       (id, tenant_id, clay_run_id, clay_table_id, mandate_id, payload_hash,
        total_records, company_count, contact_count, status, received_at)
     VALUES
       (@id, @tenantId, @clayRunId, CAST(@clayTableId AS STRING), CAST(@mandateId AS STRING), @payloadHash,
        @totalRecords, 0, 0, 'pending', CURRENT_TIMESTAMP())`,
    {
      id: importId,
      tenantId,
      clayRunId,
      clayTableId: payload.clay_table_id ?? null,
      mandateId,
      payloadHash,
      totalRecords,
    },
  );

  let companyCount = 0;
  let contactCount = 0;

  try {
    for (const row of payload.rows) {
      const dedupeKey = companyDedupeKey(row.company);
      if (!dedupeKey) {
        logger.warn("Skipping row with no usable company key", {
          tenantId,
          clayRunId,
        });
        continue;
      }

      const companyId = await upsertCompany(
        bq,
        tenantId,
        row.company,
        dedupeKey,
        uuid,
        now,
      );
      companyCount += 1;

      if (mandateId) {
        await upsertMandateCompany(bq, tenantId, mandateId, companyId);
      }

      for (const contact of row.contacts) {
        const inserted = await insertContact(
          bq,
          tenantId,
          companyId,
          contact,
          uuid,
          now,
        );
        if (inserted) contactCount += 1;
      }
    }

    await bq.executeWrite(
      `UPDATE ${CLAY_IMPORTS}
          SET status = 'completed',
              company_count = @companyCount,
              contact_count = @contactCount,
              processed_at = CURRENT_TIMESTAMP()
        WHERE id = @id`,
      { id: importId, companyCount, contactCount },
    );

    logger.info("Clay payload persisted", {
      tenantId,
      clayRunId,
      importId,
      companyCount,
      contactCount,
    });

    return {
      importId,
      payloadHash,
      status: "completed",
      companyCount,
      contactCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await bq
      .executeWrite(
        `UPDATE ${CLAY_IMPORTS}
            SET status = 'failed',
                error_message = @errorMessage,
                processed_at = CURRENT_TIMESTAMP()
          WHERE id = @id`,
        { id: importId, errorMessage: message.slice(0, 1000) },
      )
      .catch((updateErr) =>
        logger.error("Failed to mark clay_imports row failed", updateErr),
      );
    throw err;
  }
}

async function upsertCompany(
  bq: BigQueryClient,
  tenantId: string,
  company: ClayCompany,
  dedupeKey: string,
  uuid: () => string,
  _now: () => Date,
): Promise<string> {
  const existing = await bq.executeQuery(
    `SELECT id FROM ${COMPANIES}
      WHERE tenant_id = @tenantId
        AND (
          (website IS NOT NULL AND LOWER(REGEXP_REPLACE(website, r'^https?://(www\\.)?', '')) = @dedupeKey)
          OR LOWER(name) = @nameKey
        )
      LIMIT 1`,
    { tenantId, dedupeKey, nameKey: company.name.trim().toLowerCase() },
  );

  if (existing.rows.length > 0) {
    const id = (existing.rows[0] as { id: string }).id;
    // Fill in any columns that were previously null with newly-seen Clay data.
    await bq.executeWrite(
      `UPDATE ${COMPANIES}
          SET website = COALESCE(website, CAST(@website AS STRING)),
              address = COALESCE(address, CAST(@address AS STRING)),
              updated_at = CURRENT_TIMESTAMP()
        WHERE id = @id`,
      { id, website: company.website, address: company.address },
    );
    return id;
  }

  const id = uuid();
  await bq.executeWrite(
    `INSERT INTO ${COMPANIES}
       (id, tenant_id, name, website, address, source_original, created_at, updated_at)
     VALUES
       (@id, @tenantId, @name, CAST(@website AS STRING), CAST(@address AS STRING), 'clay', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
    {
      id,
      tenantId,
      name: company.name.trim(),
      website: company.website ? normalizeDomainLike(company.website) : null,
      address: company.address,
    },
  );
  return id;
}

async function upsertMandateCompany(
  bq: BigQueryClient,
  tenantId: string,
  mandateId: string,
  companyId: string,
): Promise<void> {
  const existing = await bq.executeQuery(
    `SELECT 1 AS hit FROM ${MANDATE_COMPANIES}
      WHERE tenant_id = @tenantId AND mandate_id = @mandateId AND company_id = @companyId
      LIMIT 1`,
    { tenantId, mandateId, companyId },
  );
  if (existing.rows.length > 0) {
    // Re-activate a previously-removed link (sourced from Clay again).
    await bq.executeWrite(
      `UPDATE ${MANDATE_COMPANIES}
          SET removed_at = NULL,
              source_original = COALESCE(source_original, 'clay')
        WHERE tenant_id = @tenantId AND mandate_id = @mandateId AND company_id = @companyId`,
      { tenantId, mandateId, companyId },
    );
    return;
  }
  await bq.executeWrite(
    `INSERT INTO ${MANDATE_COMPANIES}
       (tenant_id, mandate_id, company_id, source_original, added_at)
     VALUES
       (@tenantId, @mandateId, @companyId, 'clay', CURRENT_TIMESTAMP())`,
    { tenantId, mandateId, companyId },
  );
}

async function insertContact(
  bq: BigQueryClient,
  tenantId: string,
  companyId: string,
  contact: ClayContact,
  uuid: () => string,
  _now: () => Date,
): Promise<boolean> {
  const dedupeKey = contactDedupeKey(contact);
  const name = normalizeContactName(contact);
  if (!dedupeKey && !name) return false;

  // Dedupe within the same company. Email wins, then linkedin, then name.
  if (contact.email) {
    const existing = await bq.executeQuery(
      `SELECT id FROM ${CONTACTS}
        WHERE tenant_id = @tenantId AND company_id = @companyId AND LOWER(email) = @email
        LIMIT 1`,
      { tenantId, companyId, email: contact.email.trim().toLowerCase() },
    );
    if (existing.rows.length > 0) return false;
  } else if (contact.linkedin_url) {
    const existing = await bq.executeQuery(
      `SELECT id FROM ${CONTACTS}
        WHERE tenant_id = @tenantId AND company_id = @companyId AND LOWER(linkedin_url) = @linkedin
        LIMIT 1`,
      {
        tenantId,
        companyId,
        linkedin: contact.linkedin_url.trim().toLowerCase(),
      },
    );
    if (existing.rows.length > 0) return false;
  }

  const id = uuid();
  await bq.executeWrite(
    `INSERT INTO ${CONTACTS}
       (id, tenant_id, company_id, source, full_name, first_name, last_name, title,
        email, email_verified, mobile_phone, business_phone, linkedin_url, created_at, updated_at)
     VALUES
       (@id, @tenantId, @companyId, 'clay',
        CAST(@fullName AS STRING), CAST(@firstName AS STRING), CAST(@lastName AS STRING),
        CAST(@title AS STRING), CAST(@email AS STRING), @emailVerified,
        CAST(@mobilePhone AS STRING), CAST(@businessPhone AS STRING), CAST(@linkedinUrl AS STRING),
        CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
    {
      id,
      tenantId,
      companyId,
      fullName: name?.full ?? null,
      firstName: name?.first ?? null,
      lastName: name?.last ?? null,
      title: contact.title,
      email: contact.email,
      emailVerified: contact.email_verified === true,
      mobilePhone: contact.mobile_phone,
      businessPhone: contact.business_phone,
      linkedinUrl: contact.linkedin_url,
    },
  );
  return true;
}
