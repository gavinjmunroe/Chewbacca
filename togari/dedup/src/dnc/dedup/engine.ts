/**
 * Dynamic Deduplication Engine
 * togari_dnc.social_connections → unified, source-tagged contact records
 *
 * Built on top of Caleb Newton's merge logic from D1-Networking-Automation.
 * Extended for BigQuery + multi-platform social sources.
 *
 * Matching priority (same as D1):
 *   1. Email (lowercase normalized)
 *   2. LinkedIn URL slug
 *   3. Phone (E.164 normalized)
 *   4. First + Last name (cross-source only, with conflict guards)
 *
 * On every new social_connection_added event OR on-demand:
 *   - Pull new rows from togari_dnc.social_connections
 *   - Merge against togari_dnc.contacts (the master deduped table)
 *   - Upsert: new contacts INSERT, existing contacts UPDATE (merge sources[])
 *   - Tag each contact with sources[] e.g. ['linkedin', 'instagram', 'email']
 *
 * Result lives in togari_dnc.contacts — the 1-pager Karthik described:
 *   "singular database with source tags for where we got them from"
 */

import { BigQuery } from "@google-cloud/bigquery";
import { randomUUID } from "crypto";

const PROJECT = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";
const DATASET = "togari_dnc";

function makeBQ(): BigQuery {
  const opts: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: PROJECT,
  };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
  return new BigQuery(opts);
}

// ─── Normalized contact record (unified schema) ───────────────────────────────

export interface UnifiedContact {
  contact_id: string; // stable UUID
  owner_id: string; // Togari/Auth0 tenant key — required for isolation
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null; // lowercase normalized
  phone: string | null; // E.164
  linkedin_url: string | null;
  linkedin_username: string | null;
  instagram_username: string | null;
  twitter_username: string | null;
  current_title: string | null;
  current_company: string | null;
  company_domain: string | null;
  sources: string[]; // ['linkedin', 'instagram', 'email', ...]
  source_detail: Record<
    string,
    {
      platform_user_id?: string;
      connected_at?: string;
      connection_type?: string;
    }
  >;
  is_dnc: boolean;
  dnc_reason: string | null;
  confidence_score: number; // 0-100: how confident we are this is one person
  merge_count: number; // how many raw records were merged
  first_seen_at: string;
  last_updated_at: string;
}

// ─── Normalization helpers (from D1-Networking-Automation/src/core/merge.ts) ──

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.toLowerCase().trim();
  return clean.includes("@") ? clean : null;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
}

function linkedInSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/in\/([^/?#]+)/);
  return m ? m[1].toLowerCase() : null;
}

function normalizeName(name: string): string {
  return name
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function nameKey(
  first: string | null,
  last: string | null,
  full: string,
): string {
  if (first && last) {
    const f = normalizeName(first);
    const l = normalizeName(last);
    if (f && l) return `${f} ${l}`;
  }
  return normalizeName(full);
}

// ─── Confidence score ─────────────────────────────────────────────────────────
// Higher = more confident this is one person.
// Email match → 100, LinkedIn match → 90, Phone → 85, Name-only → 60

function scoreMatch(
  matchedOn: "email" | "linkedin" | "phone" | "name",
): number {
  return { email: 100, linkedin: 90, phone: 85, name: 60 }[matchedOn];
}

// ─── Raw social connection row (from BQ) ─────────────────────────────────────

interface SocialRow {
  connection_id: string;
  platform: string;
  platform_user_id: string;
  username: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  work_email: string | null;
  current_title: string | null;
  current_company: string | null;
  company_domain: string | null;
  connection_type: string;
  connected_at: { value: string } | string | null;
  profile_url: string;
  is_dnc: boolean;
  dnc_reason: string | null;
  synced_at: { value: string } | string | null;
}

function isoFrom(ts: { value: string } | string | null): string | null {
  if (!ts) return null;
  return typeof ts === "string" ? ts : ts.value;
}

// ─── Dedup engine ─────────────────────────────────────────────────────────────

export class DedupEngine {
  private bq = makeBQ();

  /**
   * Run dedup against all social_connections rows that haven't been
   * processed yet (or all rows if force=true).
   *
   * Returns count of new contacts created and existing ones updated.
   */
  async run(
    ownerId: string,
    opts: {
      force?: boolean;
      since?: string;
      onProgress?: (msg: string) => void;
    } = {},
  ): Promise<{
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    durationMs: number;
  }> {
    if (!ownerId) throw new Error("DedupEngine.run: ownerId is required");
    const log = opts.onProgress ?? ((m: string) => console.log(m));
    const t0 = Date.now();

    log(
      `[Dedup] Loading social connections from BigQuery for owner ${ownerId}…`,
    );

    // Fetch raw rows — filter by owner_id (tenant isolation) + optional synced_at
    const [rawRows] = await this.bq.query({
      query: `
        SELECT
          connection_id, platform, platform_user_id, username, full_name,
          first_name, last_name, work_email, current_title, current_company,
          company_domain, connection_type, connected_at, profile_url,
          is_dnc, dnc_reason, synced_at
        FROM \`${PROJECT}.${DATASET}.social_connections\`
        WHERE owner_id = @owner_id
          AND (@since IS NULL OR @force OR synced_at > TIMESTAMP(@since))
        ORDER BY connected_at DESC
      `,
      params: {
        owner_id: ownerId,
        since: opts.since ?? null,
        force: opts.force ?? false,
      },
      types: { owner_id: "STRING", since: "STRING", force: "BOOL" },
      useLegacySql: false,
    });

    const rows = rawRows as SocialRow[];
    log(`[Dedup] ${rows.length} social connection rows to process`);

    if (rows.length === 0)
      return {
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        durationMs: Date.now() - t0,
      };

    // Load existing contacts for in-memory matching — scoped to this owner only
    log("[Dedup] Loading existing contacts…");
    const [existingRows] = await this.bq.query({
      query: `
        SELECT * FROM \`${PROJECT}.${DATASET}.contacts\`
        WHERE owner_id = @owner_id
      `,
      params: { owner_id: ownerId },
      types: { owner_id: "STRING" },
      useLegacySql: false,
    });

    // Build lookup indexes
    const byEmail = new Map<string, UnifiedContact>();
    const byLinkedIn = new Map<string, UnifiedContact>();
    const byPhone = new Map<string, UnifiedContact>();
    const byName = new Map<string, UnifiedContact>();
    const contactMap = new Map<string, UnifiedContact>(); // contact_id → record

    for (const row of existingRows as UnifiedContact[]) {
      contactMap.set(row.contact_id, row);
      if (row.email) byEmail.set(row.email, row);
      if (row.linkedin_url) {
        const s = linkedInSlug(row.linkedin_url);
        if (s) byLinkedIn.set(s, row);
      }
      if (row.phone) byPhone.set(row.phone, row);
      const nk = nameKey(row.first_name, row.last_name, row.full_name);
      if (nk.length >= 3) byName.set(nk, row);
    }

    log(`[Dedup] ${contactMap.size} existing contacts loaded`);

    const toInsert: UnifiedContact[] = [];
    const toUpdate: UnifiedContact[] = [];
    let skipped = 0;

    // ── Match each social row against existing contacts ──────────────────────

    for (const row of rows) {
      const email = normalizeEmail(row.work_email);
      const phone = normalizePhone(null); // social rows rarely have phone
      const liSlug = row.platform === "linkedin" ? row.username : null;
      const nk = nameKey(row.first_name, row.last_name, row.full_name);

      let existing: UnifiedContact | undefined;
      let matchedOn: "email" | "linkedin" | "phone" | "name" | null = null;

      if (email) {
        existing = byEmail.get(email);
        if (existing) matchedOn = "email";
      }
      if (!existing && liSlug) {
        existing = byLinkedIn.get(liSlug);
        if (existing) matchedOn = "linkedin";
      }

      // Name fallback — only across different sources, no conflicting identifiers
      if (!existing && nk.length >= 3) {
        const candidate = byName.get(nk);
        if (candidate) {
          const candidateLiSlug = linkedInSlug(candidate.linkedin_url);
          const liConflict =
            liSlug && candidateLiSlug && liSlug !== candidateLiSlug;
          const differentSource = !candidate.sources.includes(row.platform);
          if (differentSource && !liConflict) {
            existing = candidate;
            matchedOn = "name";
          }
        }
      }

      const sourceDetail = {
        platform_user_id: row.platform_user_id,
        connected_at: isoFrom(row.connected_at) ?? undefined,
        connection_type: row.connection_type,
      };

      if (existing) {
        // ── Merge into existing contact ────────────────────────────────────
        let changed = false;

        // Add source tag if new
        if (!existing.sources.includes(row.platform)) {
          existing.sources = [...existing.sources, row.platform];
          changed = true;
        }

        // Update source detail
        const prevDetail = existing.source_detail ?? {};
        existing.source_detail = {
          ...prevDetail,
          [row.platform]: sourceDetail,
        };
        changed = true;

        // Fill missing fields
        if (!existing.email && email) {
          existing.email = email;
          changed = true;
        }
        if (!existing.linkedin_url && row.platform === "linkedin") {
          existing.linkedin_url = row.profile_url;
          changed = true;
        }
        if (!existing.linkedin_username && row.platform === "linkedin") {
          existing.linkedin_username = row.username;
          changed = true;
        }
        if (!existing.instagram_username && row.platform === "instagram") {
          existing.instagram_username = row.username;
          changed = true;
        }
        if (!existing.twitter_username && row.platform === "twitter") {
          existing.twitter_username = row.username;
          changed = true;
        }
        if (!existing.current_title && row.current_title) {
          existing.current_title = row.current_title;
          changed = true;
        }
        if (!existing.current_company && row.current_company) {
          existing.current_company = row.current_company;
          changed = true;
        }
        if (!existing.company_domain && row.company_domain) {
          existing.company_domain = row.company_domain;
          changed = true;
        }
        if (row.is_dnc && !existing.is_dnc) {
          existing.is_dnc = true;
          existing.dnc_reason = row.dnc_reason;
          changed = true;
        }

        // Update confidence
        if (matchedOn) {
          const newScore = scoreMatch(matchedOn);
          existing.confidence_score = Math.max(
            existing.confidence_score,
            newScore,
          );
        }

        if (changed) {
          existing.merge_count += 1;
          existing.last_updated_at = new Date().toISOString();
          toUpdate.push(existing);

          // Update indexes with any new keys
          if (existing.email) byEmail.set(existing.email, existing);
          if (existing.linkedin_url) {
            const s = linkedInSlug(existing.linkedin_url);
            if (s) byLinkedIn.set(s, existing);
          }
          const updatedNk = nameKey(
            existing.first_name,
            existing.last_name,
            existing.full_name,
          );
          if (updatedNk.length >= 3) byName.set(updatedNk, existing);
        } else {
          skipped++;
        }
      } else {
        // ── Create new contact ─────────────────────────────────────────────
        const now = new Date().toISOString();
        const contact: UnifiedContact = {
          contact_id: randomUUID(),
          owner_id: ownerId,
          full_name: row.full_name,
          first_name: row.first_name,
          last_name: row.last_name,
          email,
          phone: null,
          linkedin_url: row.platform === "linkedin" ? row.profile_url : null,
          linkedin_username: row.platform === "linkedin" ? row.username : null,
          instagram_username:
            row.platform === "instagram" ? row.username : null,
          twitter_username: row.platform === "twitter" ? row.username : null,
          current_title: row.current_title,
          current_company: row.current_company,
          company_domain: row.company_domain,
          sources: [row.platform],
          source_detail: { [row.platform]: sourceDetail },
          is_dnc: row.is_dnc,
          dnc_reason: row.dnc_reason,
          confidence_score: email ? 100 : liSlug ? 90 : 60,
          merge_count: 1,
          first_seen_at: now,
          last_updated_at: now,
        };

        toInsert.push(contact);
        contactMap.set(contact.contact_id, contact);

        // Update indexes
        if (contact.email) byEmail.set(contact.email, contact);
        if (contact.linkedin_url) {
          const s = linkedInSlug(contact.linkedin_url);
          if (s) byLinkedIn.set(s, contact);
        }
        if (nk.length >= 3) byName.set(nk, contact);
      }
    }

    log(
      `[Dedup] ${toInsert.length} new contacts, ${toUpdate.length} updates, ${skipped} skipped`,
    );

    // ── Write to BigQuery ────────────────────────────────────────────────────

    if (toInsert.length > 0) {
      log(`[Dedup] Inserting ${toInsert.length} new contacts…`);
      const table = this.bq.dataset(DATASET).table("contacts");
      for (let i = 0; i < toInsert.length; i += 500) {
        await table.insert(
          toInsert.slice(i, i + 500).map((c) => ({
            ...c,
            sources: c.sources.join(","), // BQ doesn't support arrays via streaming easily
            source_detail: JSON.stringify(c.source_detail),
          })),
          { skipInvalidRows: true, ignoreUnknownValues: true },
        );
      }
    }

    if (toUpdate.length > 0) {
      log(`[Dedup] Updating ${toUpdate.length} existing contacts…`);
      // BQ doesn't support row-level streaming updates — use MERGE via SQL
      // We batch the updates into a temp table and MERGE
      await this.batchUpdateContacts(ownerId, toUpdate);
    }

    const durationMs = Date.now() - t0;
    log(
      `[Dedup] ✅ Done in ${durationMs}ms — ${toInsert.length} created, ${toUpdate.length} updated`,
    );

    return {
      processed: rows.length,
      created: toInsert.length,
      updated: toUpdate.length,
      skipped,
      durationMs,
    };
  }

  /** Batch update contacts using BigQuery MERGE via temp table */
  private async batchUpdateContacts(
    ownerId: string,
    contacts: UnifiedContact[],
  ): Promise<void> {
    if (contacts.length === 0) return;
    if (!ownerId) throw new Error("batchUpdateContacts: ownerId is required");

    // Build parameter arrays — one entry per contact, keyed by index. Using
    // parameterized arrays + UNNEST avoids SQL-injection risk on contact fields.
    const params: Record<string, unknown> = { owner_id: ownerId };
    const types: Record<string, unknown> = { owner_id: "STRING" };
    const tuples: string[] = [];

    contacts.forEach((c, i) => {
      if (c.owner_id !== ownerId) {
        // Defensive: refuse to merge a contact that doesn't belong to this owner
        throw new Error(
          `batchUpdateContacts: contact ${c.contact_id} owner_id=${c.owner_id} does not match query owner_id=${ownerId}`,
        );
      }
      params[`id_${i}`] = c.contact_id;
      params[`name_${i}`] = c.full_name ?? null;
      params[`email_${i}`] = c.email;
      params[`phone_${i}`] = c.phone;
      params[`liurl_${i}`] = c.linkedin_url;
      params[`liuser_${i}`] = c.linkedin_username;
      params[`iguser_${i}`] = c.instagram_username;
      params[`twuser_${i}`] = c.twitter_username;
      params[`title_${i}`] = c.current_title;
      params[`company_${i}`] = c.current_company;
      params[`sources_${i}`] = c.sources.join(",");
      params[`detail_${i}`] = JSON.stringify(c.source_detail);
      params[`isdnc_${i}`] = c.is_dnc;
      params[`dncr_${i}`] = c.dnc_reason;
      params[`conf_${i}`] = c.confidence_score;
      params[`mc_${i}`] = c.merge_count;
      params[`ts_${i}`] = c.last_updated_at;

      types[`id_${i}`] = "STRING";
      types[`name_${i}`] = "STRING";
      types[`email_${i}`] = "STRING";
      types[`phone_${i}`] = "STRING";
      types[`liurl_${i}`] = "STRING";
      types[`liuser_${i}`] = "STRING";
      types[`iguser_${i}`] = "STRING";
      types[`twuser_${i}`] = "STRING";
      types[`title_${i}`] = "STRING";
      types[`company_${i}`] = "STRING";
      types[`sources_${i}`] = "STRING";
      types[`detail_${i}`] = "STRING";
      types[`isdnc_${i}`] = "BOOL";
      types[`dncr_${i}`] = "STRING";
      types[`conf_${i}`] = "INT64";
      types[`mc_${i}`] = "INT64";
      types[`ts_${i}`] = "TIMESTAMP";

      tuples.push(
        `(@id_${i}, @name_${i}, @email_${i}, @phone_${i}, @liurl_${i}, @liuser_${i}, @iguser_${i}, @twuser_${i}, @title_${i}, @company_${i}, @sources_${i}, @detail_${i}, @isdnc_${i}, @dncr_${i}, @conf_${i}, @mc_${i}, @ts_${i})`,
      );
    });

    await this.bq.query({
      query: `
        MERGE \`${PROJECT}.${DATASET}.contacts\` T
        USING (
          SELECT * FROM UNNEST([
            STRUCT<
              contact_id STRING, full_name STRING, email STRING, phone STRING,
              linkedin_url STRING, linkedin_username STRING, instagram_username STRING,
              twitter_username STRING, current_title STRING, current_company STRING,
              sources STRING, source_detail STRING,
              is_dnc BOOL, dnc_reason STRING, confidence_score INT64,
              merge_count INT64, last_updated_at TIMESTAMP
            >
            ${tuples.join(",\n")}
          ])
        ) S ON T.contact_id = S.contact_id AND T.owner_id = @owner_id
        WHEN MATCHED THEN UPDATE SET
          T.email              = COALESCE(S.email, T.email),
          T.phone              = COALESCE(S.phone, T.phone),
          T.linkedin_url       = COALESCE(S.linkedin_url, T.linkedin_url),
          T.linkedin_username  = COALESCE(S.linkedin_username, T.linkedin_username),
          T.instagram_username = COALESCE(S.instagram_username, T.instagram_username),
          T.twitter_username   = COALESCE(S.twitter_username, T.twitter_username),
          T.current_title      = COALESCE(S.current_title, T.current_title),
          T.current_company    = COALESCE(S.current_company, T.current_company),
          T.sources            = S.sources,
          T.source_detail      = S.source_detail,
          T.is_dnc             = S.is_dnc,
          T.dnc_reason         = COALESCE(S.dnc_reason, T.dnc_reason),
          T.confidence_score   = S.confidence_score,
          T.merge_count        = S.merge_count,
          T.last_updated_at    = S.last_updated_at
      `,
      params,
      types,
      useLegacySql: false,
    });
  }

  /** Get dedup stats for a quick status check — scoped to a single owner */
  async getStats(ownerId: string): Promise<{
    totalContacts: number;
    bySource: Record<string, number>;
    multiSourceContacts: number;
    dncCount: number;
    avgConfidence: number;
  }> {
    if (!ownerId) throw new Error("DedupEngine.getStats: ownerId is required");
    const [rows] = await this.bq.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNTIF(ARRAY_LENGTH(SPLIT(sources, ',')) > 1) as multi_source,
          COUNTIF(is_dnc) as dnc_count,
          AVG(confidence_score) as avg_confidence
        FROM \`${PROJECT}.${DATASET}.contacts\`
        WHERE owner_id = @owner_id
      `,
      params: { owner_id: ownerId },
      types: { owner_id: "STRING" },
      useLegacySql: false,
    });

    const [sourceRows] = await this.bq.query({
      query: `
        SELECT src, COUNT(*) as cnt
        FROM \`${PROJECT}.${DATASET}.contacts\`,
        UNNEST(SPLIT(sources, ',')) as src
        WHERE owner_id = @owner_id
        GROUP BY src ORDER BY cnt DESC
      `,
      params: { owner_id: ownerId },
      types: { owner_id: "STRING" },
      useLegacySql: false,
    });

    const r = (rows as any[])[0];
    return {
      totalContacts: Number(r.total),
      multiSourceContacts: Number(r.multi_source),
      dncCount: Number(r.dnc_count),
      avgConfidence: Math.round(Number(r.avg_confidence)),
      bySource: Object.fromEntries(
        (sourceRows as any[]).map((s) => [s.src, Number(s.cnt)]),
      ),
    };
  }
}
