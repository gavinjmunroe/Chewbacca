/**
 * Single-record matching against togari_dnc.contacts (Clay-callable).
 *
 * Owned by WS-1. The batch-mode engine lives elsewhere; this module is the
 * Clay-callable single-record path that fronts POST /api/v1/people/match.
 *
 * Matching priority — first hit wins:
 *   1. Email (lowercased)
 *   2. LinkedIn URL slug
 *   3. Phone (E.164 normalized)
 *   4. Full name (lowercased, whitespace-collapsed)
 *
 * Every query filters by `owner_did` — there is no cross-tenant fallback.
 * Queries are parameterized; no string interpolation of caller input.
 */

import { BigQuery } from "@google-cloud/bigquery";
import { randomUUID } from "crypto";
import type {
  MatchRequest,
  MatchResult,
  UnifiedContact,
} from "../types/index.ts";
import { classifyRealness } from "./realness.ts";

const PROJECT = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";
const DATASET = "togari_dnc";

// ─── Normalizers ─────────────────────────────────────────────────────────────

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.toLowerCase().trim();
  return clean.includes("@") ? clean : null;
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
}

export function linkedInSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/in\/([^/?#]+)/i);
  if (m) return m[1].toLowerCase();
  const bare = url.trim();
  if (/^[a-z0-9-]{3,100}$/i.test(bare)) return bare.toLowerCase();
  return null;
}

export function normalizeName(name: string): string {
  return name
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function scoreFor(matchedOn: "email" | "linkedin" | "phone" | "name"): number {
  return { email: 100, linkedin: 90, phone: 85, name: 60 }[matchedOn];
}

// ─── BQ client abstraction (allows test injection) ───────────────────────────

export interface QueryRunner {
  query<T = Record<string, unknown>>(opts: {
    query: string;
    params?: Record<string, unknown>;
    types?: Record<string, string>;
    useLegacySql?: boolean;
  }): Promise<[T[]]>;
}

export interface RowInserter {
  insert(rows: Record<string, unknown>[]): Promise<unknown>;
}

export interface BQGateway {
  runner: QueryRunner;
  contacts: RowInserter;
}

function defaultGateway(): BQGateway {
  const opts: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: PROJECT,
  };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
  const bq = new BigQuery(opts);
  return {
    runner: bq as unknown as QueryRunner,
    contacts: bq.dataset(DATASET).table("contacts") as unknown as RowInserter,
  };
}

// ─── BQ row → UnifiedContact ──────────────────────────────────────────────────

function bqTs(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "value" in v) {
    return String((v as { value: unknown }).value);
  }
  return null;
}

function rowToContact(row: Record<string, unknown>): UnifiedContact {
  const sourceDetailRaw = row.source_detail;
  let sourceDetail: Record<string, unknown> = {};
  if (typeof sourceDetailRaw === "string" && sourceDetailRaw.length > 0) {
    try {
      sourceDetail = JSON.parse(sourceDetailRaw);
    } catch {
      sourceDetail = {};
    }
  } else if (sourceDetailRaw && typeof sourceDetailRaw === "object") {
    sourceDetail = sourceDetailRaw as Record<string, unknown>;
  }

  return {
    contact_id: (row.contact_id as string) ?? "",
    full_name: (row.full_name as string | null) ?? null,
    first_name: (row.first_name as string | null) ?? null,
    last_name: (row.last_name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    linkedin_url: (row.linkedin_url as string | null) ?? null,
    linkedin_username: (row.linkedin_username as string | null) ?? null,
    instagram_username: (row.instagram_username as string | null) ?? null,
    twitter_username: (row.twitter_username as string | null) ?? null,
    facebook_username: (row.facebook_username as string | null) ?? null,
    tiktok_username: (row.tiktok_username as string | null) ?? null,
    current_title: (row.current_title as string | null) ?? null,
    current_company: (row.current_company as string | null) ?? null,
    company_domain: (row.company_domain as string | null) ?? null,
    sources: (row.sources as string | null) ?? "",
    source_detail: sourceDetail,
    is_dnc: Boolean(row.is_dnc),
    dnc_reason: (row.dnc_reason as string | null) ?? null,
    dnc_added_at: bqTs(row.dnc_added_at),
    confidence_score: Number(row.confidence_score ?? 0),
    merge_count: Number(row.merge_count ?? 1),
    first_seen_at: bqTs(row.first_seen_at) ?? new Date().toISOString(),
    last_updated_at: bqTs(row.last_updated_at) ?? new Date().toISOString(),
    is_real_person:
      row.is_real_person === null || row.is_real_person === undefined
        ? null
        : Boolean(row.is_real_person),
    realness_score:
      row.realness_score === null || row.realness_score === undefined
        ? null
        : Number(row.realness_score),
    realness_reason: (row.realness_reason as string | null) ?? null,
    apple_contact_id: (row.apple_contact_id as string | null) ?? null,
    apple_etag: (row.apple_etag as string | null) ?? null,
    owner_did: (row.owner_did as string | null) ?? null,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export class Matcher {
  /**
   * WRITTEN LONGHAND BECAUSE NODE CANNOT STRIP A PARAMETER PROPERTY.
   *
   * `constructor(private gateway: BQGateway = ...)` is a TypeScript parameter
   * property: it declares a field AND assigns it, which means erasing the types
   * would change the runtime behavior. Node's --experimental-strip-types only
   * removes annotations, so it refuses, and the whole module fails to load.
   *
   * The cost of that was not a build error anybody saw. It was this, in
   * production, on every boot:
   *
   *   [dedup] people routes (WS-3) not registered: TypeScript parameter
   *           property is not supported in strip-only mode
   *   [dedup] registration complete: 5/6 groups online
   *
   * A whole route group down -- POST /api/v1/people/match, POST /api/v1/people,
   * PATCH /api/v1/people/:contact_id -- and the server started anyway and said
   * "5/6" as if that were a status rather than an outage. Every Clay call into
   * those endpoints has been getting a 404 from a healthy-looking service.
   *
   * The field and the default both survive; only the sugar is gone.
   */
  private gateway: BQGateway;

  constructor(gateway: BQGateway = defaultGateway()) {
    this.gateway = gateway;
  }

  /**
   * Find the single best match for a request, owned by `ownerDid`.
   * Returns `{ matched: false }` if no candidate clears the priority chain.
   */
  async match(ownerDid: string, request: MatchRequest): Promise<MatchResult> {
    const email = normalizeEmail(request.email);
    const liSlug = linkedInSlug(request.linkedin);
    const phone = normalizePhone(request.phone);
    const name = request.name ? normalizeName(request.name) : null;

    if (!email && !liSlug && !phone && !name) {
      return { matched: false, confidence: 0 };
    }

    const sql = `
      SELECT
        contact_id, owner_did, full_name, first_name, last_name,
        email, phone, linkedin_url, linkedin_username,
        instagram_username, twitter_username, facebook_username, tiktok_username,
        current_title, current_company, company_domain,
        sources, source_detail,
        is_dnc, dnc_reason, dnc_added_at,
        confidence_score, merge_count, first_seen_at, last_updated_at,
        is_real_person, realness_score, realness_reason,
        apple_contact_id, apple_etag,
        CASE
          WHEN @email IS NOT NULL AND LOWER(email) = @email THEN 1
          WHEN @linkedin IS NOT NULL AND LOWER(linkedin_username) = @linkedin THEN 2
          WHEN @phone IS NOT NULL AND phone = @phone THEN 3
          WHEN @name IS NOT NULL AND LOWER(full_name) = @name THEN 4
          ELSE 99
        END AS match_rank
      FROM \`${PROJECT}.${DATASET}.contacts\`
      WHERE owner_did = @owner_did
        AND (
          (@email IS NOT NULL AND LOWER(email) = @email)
          OR (@linkedin IS NOT NULL AND LOWER(linkedin_username) = @linkedin)
          OR (@phone IS NOT NULL AND phone = @phone)
          OR (@name IS NOT NULL AND LOWER(full_name) = @name)
        )
      ORDER BY match_rank ASC, last_updated_at DESC
      LIMIT 1
    `;

    const [rows] = await this.gateway.runner.query<
      Record<string, unknown> & { match_rank: number }
    >({
      query: sql,
      params: {
        owner_did: ownerDid,
        email,
        linkedin: liSlug,
        phone,
        name,
      },
      types: {
        owner_did: "STRING",
        email: "STRING",
        linkedin: "STRING",
        phone: "STRING",
        name: "STRING",
      },
      useLegacySql: false,
    });

    if (rows.length === 0) {
      return { matched: false, confidence: 0 };
    }

    const row = rows[0];
    const rank = Number(row.match_rank);
    const matchedOn: MatchResult["matched_on"] =
      rank === 1
        ? "email"
        : rank === 2
          ? "linkedin"
          : rank === 3
            ? "phone"
            : "name";

    return {
      matched: true,
      contact: rowToContact(row),
      confidence: scoreFor(matchedOn),
      matched_on: matchedOn,
    };
  }

  /**
   * Fetch a single contact by id, owned by `ownerDid`.
   * Returns null if not found or owned by a different tenant.
   */
  async getById(
    ownerDid: string,
    contactId: string,
  ): Promise<UnifiedContact | null> {
    const [rows] = await this.gateway.runner.query<Record<string, unknown>>({
      query: `
        SELECT
          contact_id, owner_did, full_name, first_name, last_name,
          email, phone, linkedin_url, linkedin_username,
          instagram_username, twitter_username, facebook_username, tiktok_username,
          current_title, current_company, company_domain,
          sources, source_detail,
          is_dnc, dnc_reason, dnc_added_at,
          confidence_score, merge_count, first_seen_at, last_updated_at,
          is_real_person, realness_score, realness_reason,
          apple_contact_id, apple_etag
        FROM \`${PROJECT}.${DATASET}.contacts\`
        WHERE owner_did = @owner_did AND contact_id = @contact_id
        LIMIT 1
      `,
      params: { owner_did: ownerDid, contact_id: contactId },
      types: { owner_did: "STRING", contact_id: "STRING" },
      useLegacySql: false,
    });

    if (rows.length === 0) return null;
    return rowToContact(rows[0]);
  }

  /**
   * Create a new contact owned by `ownerDid`. Generates a contact_id and runs
   * the realness classifier. Does not dedupe — call match() first if needed.
   */
  async create(
    ownerDid: string,
    partial: Partial<UnifiedContact>,
  ): Promise<UnifiedContact> {
    const now = new Date().toISOString();
    const contactId = partial.contact_id ?? randomUUID();

    const email = normalizeEmail(partial.email);
    const phone = normalizePhone(partial.phone);
    const linkedinUrl = partial.linkedin_url ?? null;
    const linkedinUsername =
      partial.linkedin_username ?? linkedInSlug(linkedinUrl);

    const contact: UnifiedContact = {
      contact_id: contactId,
      owner_did: ownerDid,
      full_name: partial.full_name ?? null,
      first_name: partial.first_name ?? null,
      last_name: partial.last_name ?? null,
      email,
      phone,
      linkedin_url: linkedinUrl,
      linkedin_username: linkedinUsername,
      instagram_username: partial.instagram_username ?? null,
      twitter_username: partial.twitter_username ?? null,
      facebook_username: partial.facebook_username ?? null,
      tiktok_username: partial.tiktok_username ?? null,
      current_title: partial.current_title ?? null,
      current_company: partial.current_company ?? null,
      company_domain: partial.company_domain ?? null,
      sources: partial.sources ?? "manual",
      source_detail: partial.source_detail ?? {},
      is_dnc: partial.is_dnc ?? false,
      dnc_reason: partial.dnc_reason ?? null,
      dnc_added_at: partial.dnc_added_at ?? null,
      confidence_score: partial.confidence_score ?? 100,
      merge_count: partial.merge_count ?? 1,
      first_seen_at: partial.first_seen_at ?? now,
      last_updated_at: now,
      is_real_person: null,
      realness_score: null,
      realness_reason: null,
      apple_contact_id: partial.apple_contact_id ?? null,
      apple_etag: partial.apple_etag ?? null,
    };

    const verdict = await classifyRealness(contact);
    contact.is_real_person = verdict.is_real;
    contact.realness_score = verdict.score;
    contact.realness_reason = verdict.reason;

    await this.gateway.contacts.insert([
      {
        ...contact,
        source_detail: JSON.stringify(contact.source_detail),
      },
    ]);

    return contact;
  }

  /**
   * Patch an existing contact. Only fields present in `patch` are written;
   * existing values are preserved when `patch` omits them.
   */
  async update(
    ownerDid: string,
    contactId: string,
    patch: Partial<UnifiedContact>,
  ): Promise<UnifiedContact> {
    const existing = await this.getById(ownerDid, contactId);
    if (!existing) {
      throw new MatcherError(
        "not_found",
        `Contact ${contactId} not found for owner`,
      );
    }

    const writable: Array<keyof UnifiedContact> = [
      "full_name",
      "first_name",
      "last_name",
      "email",
      "phone",
      "linkedin_url",
      "linkedin_username",
      "instagram_username",
      "twitter_username",
      "facebook_username",
      "tiktok_username",
      "current_title",
      "current_company",
      "company_domain",
      "sources",
      "is_dnc",
      "dnc_reason",
      "dnc_added_at",
      "confidence_score",
      "merge_count",
      "is_real_person",
      "realness_score",
      "realness_reason",
      "apple_contact_id",
      "apple_etag",
    ];

    const sets: string[] = [];
    const params: Record<string, unknown> = {
      owner_did: ownerDid,
      contact_id: contactId,
    };
    const types: Record<string, string> = {
      owner_did: "STRING",
      contact_id: "STRING",
    };

    for (const key of writable) {
      if (!(key in patch)) continue;
      const value = patch[key];
      let normalized: unknown = value;
      if (key === "email") normalized = normalizeEmail(value as string | null);
      else if (key === "phone")
        normalized = normalizePhone(value as string | null);

      sets.push(`${String(key)} = @${String(key)}`);
      params[String(key)] = normalized;
      types[String(key)] = bqTypeFor(key);
    }

    if (patch.source_detail !== undefined) {
      sets.push("source_detail = PARSE_JSON(@source_detail)");
      params.source_detail = JSON.stringify(patch.source_detail);
      types.source_detail = "STRING";
    }

    sets.push("last_updated_at = CURRENT_TIMESTAMP()");

    if (sets.length === 1) {
      return existing;
    }

    await this.gateway.runner.query({
      query: `
        UPDATE \`${PROJECT}.${DATASET}.contacts\`
        SET ${sets.join(", ")}
        WHERE owner_did = @owner_did AND contact_id = @contact_id
      `,
      params,
      types,
      useLegacySql: false,
    });

    const updated = await this.getById(ownerDid, contactId);
    if (!updated) {
      throw new MatcherError(
        "internal",
        `Contact ${contactId} disappeared after update`,
      );
    }
    return updated;
  }
}

function bqTypeFor(key: keyof UnifiedContact): string {
  switch (key) {
    case "is_dnc":
    case "is_real_person":
      return "BOOL";
    case "confidence_score":
    case "merge_count":
    case "realness_score":
      return "INT64";
    case "first_seen_at":
    case "last_updated_at":
    case "dnc_added_at":
      return "TIMESTAMP";
    default:
      return "STRING";
  }
}

export class MatcherError extends Error {
  // Longhand for the same reason as Matcher.gateway above: `public code` in a
  // constructor signature is a parameter property, and strip-only mode refuses
  // the whole module over it.
  code: "not_found" | "internal";

  constructor(code: "not_found" | "internal", message: string) {
    super(message);
    this.code = code;
    this.name = "MatcherError";
  }
}
