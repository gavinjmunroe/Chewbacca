/**
 * ZoomInfo Legacy Enterprise API client.
 *
 * Endpoints used (legacy v1 — required for the credential tier most 48N-style
 * tenants are on; the new `/data/v1` API needs a separate seat):
 *
 *   /search/company   — find a company id by name + optional website
 *   /enrich/company   — pull firmographic detail
 *   /search/contact   — find people at a company
 *   /enrich/contact   — pull a person's full profile
 *
 * Each public method:
 *   - Reads the active tenant via `currentTraceContext()` (set by MCP auth
 *     middleware before tool handlers run; defaults to `'dev'` for scripts).
 *   - Resolves credentials per tenant via `getZoomInfoAccessToken`.
 *   - Wraps the HTTP call in retry + tracing + cost logging.
 *   - Returns normalized Togari shapes (see `./types`), never the raw envelope.
 */

import { withRetryAndCircuitBreaker } from "../../lib/retry";
import { traceCall, currentTraceContext } from "../../lib/tracing";
import { logExternalAPICost } from "../../lib/costTracking";
import { createLogger } from "../../observability/logger";
import {
  getZoomInfoAccessToken,
  getZoomInfoCredentials,
  invalidateZoomInfoToken,
} from "./auth";
import {
  normalizeCompanyEnrich,
  normalizeCompanySearchResults,
  normalizeContactEnrich,
  normalizeContactSearchResults,
  normalizeWebsiteForZoomInfo,
} from "./normalize";
import type {
  ZoomInfoCompanyDetail,
  ZoomInfoCompanyEnrichResponse,
  ZoomInfoCompanySearchResponse,
  ZoomInfoCompanySummary,
  ZoomInfoContactEnrichResponse,
  ZoomInfoContactSearchResponse,
  ZoomInfoPersonDetail,
  ZoomInfoPersonSummary,
} from "./types";

const logger = createLogger("integrations/zoominfo");

const ZOOMINFO_BASE_URL = "https://api.zoominfo.com";
const RATE_LIMIT_RETRY_DELAY_MS = 5000;
const RATE_LIMIT_MAX_RETRIES = 2;

const COMPANY_ENRICH_OUTPUT_FIELDS = [
  "id",
  "name",
  "website",
  "revenueRange",
  "employeeRange",
  "city",
  "state",
  "country",
  "phone",
  "street",
  "zipCode",
  "primaryIndustry",
  "type",
  "numberOfContactsInZoomInfo",
  "foundedYear",
];

const CONTACT_ENRICH_OUTPUT_FIELDS = [
  "id",
  "firstName",
  "lastName",
  "jobTitle",
  "companyName",
  "companyId",
  "companyWebsite",
  "contactAccuracyScore",
  "email",
  "phone",
  "mobilePhone",
  "externalUrls",
  "street",
  "city",
  "state",
  "zipCode",
  "country",
];

function resolveTenantId(): string {
  return currentTraceContext()?.tenantId ?? process.env.TENANT_ID ?? "dev";
}

/**
 * Quick configuration check used by tool handlers to surface a friendly
 * "not configured" message instead of throwing inside the auth flow.
 */
export async function isZoomInfoConfiguredForTenant(
  tenantId: string,
): Promise<boolean> {
  const creds = await getZoomInfoCredentials(tenantId);
  return creds !== null;
}

// ─── Core HTTP shim ──────────────────────────────────────────────────────────

interface CallOptions {
  path: string;
  body: Record<string, unknown>;
  operation: string;
}

async function callZoomInfo<T>({
  path,
  body,
  operation,
}: CallOptions): Promise<T> {
  const tenantId = resolveTenantId();
  const url = `${ZOOMINFO_BASE_URL}${path}`;

  return traceCall(`zoominfo.${operation}`, async () =>
    withRetryAndCircuitBreaker(
      async () => {
        let token = await getZoomInfoAccessToken(tenantId);
        let response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        // Stale token → refresh once and retry.
        if (response.status === 401) {
          invalidateZoomInfoToken(tenantId);
          token = await getZoomInfoAccessToken(tenantId);
          response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        }

        // ZoomInfo enforces ~1 RPS; honor 429 with a fixed backoff (the retry
        // wrapper above handles 5xx + gateway markers but not 429).
        let attempt = 0;
        while (response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
          attempt++;
          logger.warn("zoominfo 429", { tenantId, operation, attempt });
          await new Promise((r) => setTimeout(r, RATE_LIMIT_RETRY_DELAY_MS));
          response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `ZoomInfo ${operation} failed: ${response.status} ${response.statusText} ${text}`.trim(),
          );
        }

        const json = (await response.json()) as T;

        await logExternalAPICost({
          serviceType: "zoominfo",
          operation,
          tenantId,
          metadata: { path },
        }).catch((err) => {
          logger.warn("zoominfo cost log failed", err);
        });

        return json;
      },
      {
        operationName: `zoominfo.${operation}`,
        maxRetries: 3,
        baseDelayMs: 750,
      },
    ),
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ZoomInfoCompanySearchInput {
  companyName: string;
  companyWebsite?: string;
  maxResults?: number;
}

/**
 * Free company search. No credits consumed. Returns a thin summary per match.
 */
export async function zoomInfoCompanySearch(
  input: ZoomInfoCompanySearchInput,
): Promise<ZoomInfoCompanySummary[]> {
  const body: Record<string, unknown> = {
    companyName: input.companyName,
    rpp: Math.max(1, Math.min(input.maxResults ?? 5, 25)),
    page: 1,
  };
  const normalizedWebsite = input.companyWebsite
    ? normalizeWebsiteForZoomInfo(input.companyWebsite)
    : null;
  if (normalizedWebsite) body.companyWebsite = normalizedWebsite;

  const json = await callZoomInfo<ZoomInfoCompanySearchResponse>({
    path: "/search/company",
    body,
    operation: "company_search",
  });
  return normalizeCompanySearchResults(json);
}

export interface ZoomInfoCompanyEnrichInput {
  companyId?: string;
  companyWebsite?: string;
  companyName?: string;
}

/**
 * Enrich a single company by id or website. 1 credit per call.
 *
 * `companyId` takes precedence when provided. Otherwise the normalized
 * `companyWebsite` is used as the match input. The `companyName` parameter
 * is informational only — used to label the result when the API doesn't
 * echo back a name.
 */
export async function zoomInfoCompanyEnrich(
  input: ZoomInfoCompanyEnrichInput,
): Promise<ZoomInfoCompanyDetail | null> {
  const matchInput: Record<string, unknown> = {};
  if (input.companyId) {
    matchInput.companyId = Number(input.companyId);
  } else if (input.companyWebsite) {
    const normalized = normalizeWebsiteForZoomInfo(input.companyWebsite);
    if (!normalized) {
      throw new Error(
        `zoomInfoCompanyEnrich: companyWebsite '${input.companyWebsite}' is not a usable domain`,
      );
    }
    matchInput.companyWebsite = normalized;
  } else {
    throw new Error(
      "zoomInfoCompanyEnrich requires either companyId or companyWebsite",
    );
  }

  const body = {
    matchCompanyInput: [matchInput],
    outputFields: COMPANY_ENRICH_OUTPUT_FIELDS,
  };

  const json = await callZoomInfo<ZoomInfoCompanyEnrichResponse>({
    path: "/enrich/company",
    body,
    operation: "company_enrich",
  });
  return normalizeCompanyEnrich(json, input.companyName);
}

export interface ZoomInfoPersonSearchInput {
  companyName?: string;
  companyWebsite?: string;
  /** ZoomInfo internal company id from a prior enrich. Pins matches to exact company. */
  zoominfoCompanyId?: string;
  personName?: string;
  titleKeywords?: string[];
  /** Inclusive 70..99; ZoomInfo rejects values outside this range. */
  minimumConfidence?: number;
  maxResults?: number;
}

/**
 * Free people search at a company. Returns up to `maxResults` summary rows
 * (no PII). Combine with `zoomInfoPersonEnrich` to spend credits on the
 * specific people you want full details for.
 */
export async function zoomInfoPersonSearch(
  input: ZoomInfoPersonSearchInput,
): Promise<ZoomInfoPersonSummary[]> {
  const payload: Record<string, unknown> = {
    page: 1,
    rpp: Math.max(1, Math.min(input.maxResults ?? 10, 25)),
  };
  if (input.companyName) payload.companyName = input.companyName;
  if (input.companyWebsite) {
    const normalized = normalizeWebsiteForZoomInfo(input.companyWebsite);
    if (normalized) payload.companyWebsite = normalized;
  }
  if (input.zoominfoCompanyId) payload.companyId = input.zoominfoCompanyId;
  if (input.personName) payload.fullName = input.personName;
  if (input.titleKeywords?.length) {
    payload.jobTitle = input.titleKeywords.join(" OR ");
  }
  if (typeof input.minimumConfidence === "number") {
    if (input.minimumConfidence >= 70 && input.minimumConfidence <= 99) {
      payload.contactAccuracyScoreMin = String(input.minimumConfidence);
    } else {
      logger.warn("ignoring out-of-range minimumConfidence", {
        value: input.minimumConfidence,
      });
    }
  }

  const json = await callZoomInfo<ZoomInfoContactSearchResponse>({
    path: "/search/contact",
    body: payload,
    operation: "person_search",
  });
  return normalizeContactSearchResults(json);
}

export interface ZoomInfoPersonEnrichInput {
  personId: string;
}

/**
 * Enrich a single person by ZoomInfo personId. 1 credit per call.
 * Returns full PII (email, phones, LinkedIn) when available.
 */
export async function zoomInfoPersonEnrich(
  input: ZoomInfoPersonEnrichInput,
): Promise<ZoomInfoPersonDetail | null> {
  const body = {
    matchPersonInput: [{ personId: input.personId }],
    outputFields: CONTACT_ENRICH_OUTPUT_FIELDS,
  };

  const json = await callZoomInfo<ZoomInfoContactEnrichResponse>({
    path: "/enrich/contact",
    body,
    operation: "person_enrich",
  });
  return normalizeContactEnrich(json);
}

export interface ZoomInfoSimilarCompaniesInput {
  companyId?: string;
  companyWebsite?: string;
  maxResults?: number;
}

/**
 * Find companies similar to a seed. ZoomInfo's legacy API exposes this as a
 * filtered `/search/company` against the seed's primaryIndustry + size bucket.
 *
 * The flow:
 *   1. Resolve seed firmographics via `/enrich/company` (1 credit).
 *   2. Run `/search/company` with the seed's primary industry + revenue range.
 *   3. Drop the seed itself from the result set.
 *
 * Caller pays 1 credit for the seed enrich; the search step is free.
 */
export async function zoomInfoSimilarCompanies(
  input: ZoomInfoSimilarCompaniesInput,
): Promise<ZoomInfoCompanySummary[]> {
  const seed = await zoomInfoCompanyEnrich({
    companyId: input.companyId,
    companyWebsite: input.companyWebsite,
  });
  if (!seed) return [];

  const filterIndustry = seed.primaryIndustry ?? seed.industry;
  if (!filterIndustry) {
    logger.warn("similarCompanies: seed has no industry — skipping", {
      seedId: seed.companyId,
    });
    return [];
  }

  const body: Record<string, unknown> = {
    industryKeywords: filterIndustry,
    rpp: Math.max(1, Math.min(input.maxResults ?? 10, 25)),
    page: 1,
  };
  if (seed.revenueRange) body.revenue = seed.revenueRange;

  const json = await callZoomInfo<ZoomInfoCompanySearchResponse>({
    path: "/search/company",
    body,
    operation: "similar_companies",
  });
  const all = normalizeCompanySearchResults(json);
  return all.filter((row) => row.companyId !== seed.companyId);
}
