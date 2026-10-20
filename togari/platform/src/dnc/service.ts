/**
 * DncService — the do-not-contact read/write layer over BigQuery.
 *
 * Lives against the LITERAL dataset `togari_dnc` (not resolveDataset()), table
 * `contacts`. All access is scoped by `org_id` (the canonical tenancy key).
 * Because every production row is currently org_id = "bma", the scope filter is
 * written as `(org_id = @orgId OR @orgId = "")` so an empty tenant matches all.
 *
 * There is no expiry column yet; DncSuppressionInput.expiresAt is encoded into
 * dnc_reason as a " [expires:<iso>]" suffix so nothing references a column that
 * does not exist.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import type {
  DncCheckInput,
  DncDecision,
  DncMatch,
  DncSuppressionInput,
} from "./types";

const logger = createLogger("dnc/service");

const DEFAULT_PROJECT_ID =
  process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DEFAULT_DATASET = "togari_dnc";

export interface DncServiceOptions {
  bq: BigQueryClient;
  projectId?: string;
  /** Defaults to the literal "togari_dnc" dataset. */
  dataset?: string;
}

export interface DncTenantOpts {
  tenantId: string;
}

/** Lowercase + trim; returns "" for null/undefined/blank. */
function normEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

/** Lowercase + trim + strip a leading "www."; returns "" for blank. */
function normDomain(domain?: string | null): string {
  return (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

/** Derive the domain portion of an email ("a@b.com" -> "b.com"). */
function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "";
  return normDomain(email.slice(at + 1));
}

/** Coerce a BigQuery timestamp/string into an ISO string when possible. */
function asIso(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in (v as any)) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

export class DncService {
  private readonly bq: BigQueryClient;
  private readonly projectId: string;
  private readonly dataset: string;

  constructor(opts: DncServiceOptions) {
    this.bq = opts.bq;
    this.projectId = opts.projectId || DEFAULT_PROJECT_ID;
    this.dataset = opts.dataset || DEFAULT_DATASET;
  }

  private table(): string {
    return `\`${this.projectId}.${this.dataset}.contacts\``;
  }

  /**
   * Check whether an email, domain, or contact-id is suppressed.
   *
   * When only an email is given, its domain is also derived and matched, so
   * suppressing a whole domain blocks its individual emails too.
   */
  async check(input: DncCheckInput, opts: DncTenantOpts): Promise<DncDecision> {
    const email = normEmail(input.email);
    const explicitDomain = normDomain(input.domain);
    const derivedDomain = email ? domainFromEmail(email) : "";
    const domain = explicitDomain || derivedDomain;
    const contactId = (input.contactId ?? "").trim();

    // Nothing to check — treat as allowed.
    if (!email && !domain && !contactId) {
      return { suppressed: false, matches: [] };
    }

    const orgId = opts.tenantId || "";
    const sql = `
      SELECT id, email, company_domain, dnc_reason, dnc_added_at
        FROM ${this.table()}
       WHERE is_dnc = TRUE
         AND (
           (@email != "" AND LOWER(email) = @email)
           OR (@domain != "" AND LOWER(company_domain) = @domain)
           OR (@contactId != "" AND id = @contactId)
         )
         AND (org_id = @orgId OR @orgId = "")
    `.trim();

    const params = {
      email,
      domain,
      contactId,
      orgId,
    };

    const { rows } = await this.bq.executeQuery(sql, params);

    const matches: DncMatch[] = rows.map((r) => {
      const rowEmail = normEmail(r.email as string | null | undefined);
      const rowDomain = normDomain(
        r.company_domain as string | null | undefined,
      );
      let matchedOn: DncMatch["matchedOn"];
      let value: string;
      if (contactId && (r.id as string) === contactId) {
        matchedOn = "contact_id";
        value = r.id as string;
      } else if (email && rowEmail === email) {
        matchedOn = "email";
        value = rowEmail;
      } else {
        matchedOn = "domain";
        value = rowDomain || domain;
      }
      return {
        matchedOn,
        value,
        reason: (r.dnc_reason as string | null | undefined) ?? undefined,
        addedAt: asIso(r.dnc_added_at),
        contactId: (r.id as string | undefined) ?? undefined,
      };
    });

    return {
      suppressed: matches.length > 0,
      matches,
      reason: matches[0]?.reason,
    };
  }

  /**
   * Add an email or domain to the do-not-contact list.
   *
   * Email suppression is an idempotent MERGE keyed on LOWER(email). Domain-only
   * suppression inserts a domain-level row (email NULL, company_domain set).
   * expiresAt, if present, is encoded into dnc_reason.
   */
  async suppress(
    input: DncSuppressionInput,
    opts: DncTenantOpts,
  ): Promise<{ suppressed: boolean; id: string }> {
    const email = normEmail(input.email);
    const domain =
      normDomain(input.domain) || (email ? domainFromEmail(email) : "");
    const orgId = opts.tenantId || "";
    const id = crypto.randomUUID();

    let reason = input.reason;
    if (input.expiresAt) {
      reason = `${reason} [expires:${input.expiresAt}]`;
    }

    if (email) {
      // Idempotent upsert keyed on the lowercased email.
      const sql = `
        MERGE ${this.table()} AS target
        USING (
          SELECT
            @id AS id,
            @orgId AS org_id,
            @email AS email,
            @domain AS company_domain,
            @reason AS dnc_reason
        ) AS source
        ON LOWER(target.email) = source.email
           AND (target.org_id = source.org_id OR source.org_id = "")
        WHEN MATCHED THEN UPDATE SET
          is_dnc = TRUE,
          dnc_reason = source.dnc_reason,
          dnc_added_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT
          (id, org_id, email, company_domain, is_dnc, dnc_reason, dnc_added_at, source_platform)
          VALUES (source.id, source.org_id, source.email, source.company_domain, TRUE, source.dnc_reason, CURRENT_TIMESTAMP(), "togari_dnc_portal")
      `.trim();

      await this.bq.executeWrite(sql, {
        id,
        orgId,
        email,
        domain,
        reason,
      });
      return { suppressed: true, id };
    }

    if (domain) {
      // Domain-level suppression: insert a row with email NULL, company_domain set.
      const sql = `
        INSERT INTO ${this.table()}
          (id, org_id, email, company_domain, is_dnc, dnc_reason, dnc_added_at, source_platform)
        VALUES
          (@id, @orgId, NULL, @domain, TRUE, @reason, CURRENT_TIMESTAMP(), "togari_dnc_portal")
      `.trim();

      await this.bq.executeWrite(sql, {
        id,
        orgId,
        domain,
        reason,
      });
      return { suppressed: true, id };
    }

    // No email and no domain — nothing to write.
    logger.warn("suppress called with neither email nor domain", {
      tenantId: orgId,
    });
    return { suppressed: false, id };
  }

  /**
   * Remove a suppression: clear the is_dnc flag for a matching email or domain.
   * Reversible counterpart to suppress(). Returns how many rows were cleared.
   */
  async unsuppress(
    input: { email?: string; domain?: string },
    opts: DncTenantOpts,
  ): Promise<{ removed: number }> {
    const email = normEmail(input.email);
    const domain =
      normDomain(input.domain) || (email ? domainFromEmail(email) : "");
    const orgId = opts.tenantId || "";
    if (!email && !domain) return { removed: 0 };

    const sql = `
      UPDATE ${this.table()}
         SET is_dnc = FALSE,
             dnc_reason = CONCAT(IFNULL(dnc_reason, ""), " [removed]"),
             dnc_added_at = CURRENT_TIMESTAMP()
       WHERE is_dnc = TRUE
         AND (org_id = @orgId OR @orgId = "")
         AND (
           (@email != "" AND LOWER(email) = @email)
           OR (@domain != "" AND LOWER(company_domain) = @domain)
         )
    `.trim();
    const res = await this.bq.executeWrite(sql, {
      orgId,
      email: email || "",
      domain: domain || "",
    });
    return { removed: Number(res.numDmlAffectedRows ?? "0") };
  }

  /** List recent suppressions for a tenant, newest first. */
  async list(opts: DncTenantOpts & { limit?: number }): Promise<DncMatch[]> {
    const orgId = opts.tenantId || "";
    const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 50)));

    const sql = `
      SELECT id, email, company_domain, dnc_reason, dnc_added_at
        FROM ${this.table()}
       WHERE is_dnc = TRUE
         AND (org_id = @orgId OR @orgId = "")
       ORDER BY dnc_added_at DESC
       LIMIT @limit
    `.trim();

    const { rows } = await this.bq.executeQuery(sql, { orgId, limit });

    return rows.map((r) => {
      const rowEmail = normEmail(r.email as string | null | undefined);
      const rowDomain = normDomain(
        r.company_domain as string | null | undefined,
      );
      return {
        matchedOn: rowEmail ? "email" : "domain",
        value: rowEmail || rowDomain,
        reason: (r.dnc_reason as string | null | undefined) ?? undefined,
        addedAt: asIso(r.dnc_added_at),
        contactId: (r.id as string | undefined) ?? undefined,
      } as DncMatch;
    });
  }
}
