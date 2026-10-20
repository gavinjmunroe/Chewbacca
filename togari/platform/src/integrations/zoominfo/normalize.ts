/**
 * Normalizers — raw ZoomInfo envelopes → flat Togari shapes.
 *
 * ZoomInfo's enrich endpoints wrap data in
 * `{ data: { result: [{ data: [obj] }] } }`. Search endpoints return a flat
 * array under either `data` or a domain-specific key (`companies`,
 * `contacts`). These helpers strip the envelope, coerce types (string ids,
 * year ints, joined industry arrays), and return `null` for empty results
 * so downstream tools don't have to guard against partial shapes.
 */

import type {
  ZoomInfoCompanyDetail,
  ZoomInfoCompanyEnrichRaw,
  ZoomInfoCompanyEnrichResponse,
  ZoomInfoCompanySearchRaw,
  ZoomInfoCompanySearchResponse,
  ZoomInfoCompanySummary,
  ZoomInfoContactEnrichRaw,
  ZoomInfoContactEnrichResponse,
  ZoomInfoContactSearchRaw,
  ZoomInfoContactSearchResponse,
  ZoomInfoPersonDetail,
  ZoomInfoPersonSummary,
} from "./types";

function parseYear(v: number | string | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = parseInt(v, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function joinIndustry(
  primary: string | string[] | null | undefined,
): string | null {
  if (primary == null) return null;
  if (Array.isArray(primary)) return primary.join(", ");
  return primary;
}

function pickLinkedinUrl(
  externalUrls:
    | Array<{ type?: string | null; url?: string | null }>
    | null
    | undefined,
): string | null {
  if (!externalUrls?.length) return null;
  const linkedin = externalUrls.find(
    (u) => (u.type ?? "").toLowerCase().includes("linkedin") && u.url,
  );
  return linkedin?.url ?? null;
}

// ─── Companies ───────────────────────────────────────────────────────────────

export function normalizeCompanySearchResults(
  response: ZoomInfoCompanySearchResponse,
): ZoomInfoCompanySummary[] {
  const rows: ZoomInfoCompanySearchRaw[] =
    response.data ?? response.companies ?? [];
  return rows
    .map((row) => {
      const id = row.id ?? row.companyId;
      if (id == null) return null;
      return {
        companyId: String(id),
        companyName: row.name ?? row.companyName ?? "(unknown)",
        website: row.website ?? null,
        industry: row.industry ?? null,
        revenueRange: row.revenueRange ?? null,
        employeeRange: row.employeeRange ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        country: row.country ?? null,
      } satisfies ZoomInfoCompanySummary;
    })
    .filter((row): row is ZoomInfoCompanySummary => row !== null);
}

export function normalizeCompanyEnrich(
  response: ZoomInfoCompanyEnrichResponse,
  fallbackName?: string,
): ZoomInfoCompanyDetail | null {
  const raw = extractFirstEnrichRow<ZoomInfoCompanyEnrichRaw>(response);
  if (!raw) return null;

  return {
    companyId: String(raw.id ?? ""),
    companyName: raw.name ?? fallbackName ?? "(unknown)",
    website: raw.website ?? null,
    industry: raw.industry ?? null,
    revenueRange: raw.revenueRange ?? null,
    employeeRange: raw.employeeRange ?? null,
    city: raw.city ?? null,
    state: raw.state ?? null,
    country: raw.country ?? null,
    subIndustry: raw.subIndustry ?? null,
    primaryIndustry: joinIndustry(raw.primaryIndustry),
    yearFounded: parseYear(raw.foundedYear) ?? parseYear(raw.yearFounded),
    phone: raw.phone ?? null,
    street: raw.street ?? null,
    zipCode: raw.zipCode ?? null,
    type: raw.type ?? null,
    numberOfContactsInZoomInfo:
      typeof raw.numberOfContactsInZoomInfo === "number"
        ? raw.numberOfContactsInZoomInfo
        : null,
  } satisfies ZoomInfoCompanyDetail;
}

// ─── People ──────────────────────────────────────────────────────────────────

export function normalizeContactSearchResults(
  response: ZoomInfoContactSearchResponse,
): ZoomInfoPersonSummary[] {
  const rows: ZoomInfoContactSearchRaw[] =
    response.contacts ?? response.data ?? [];
  return rows
    .map((row) => {
      const id = row.id ?? row.personId;
      if (id == null) return null;
      const first = row.firstName ?? null;
      const last = row.lastName ?? null;
      const full =
        (row.fullName ?? [first, last].filter(Boolean).join(" ").trim()) ||
        "(unknown)";
      return {
        personId: String(id),
        fullName: full,
        firstName: first,
        lastName: last,
        jobTitle: row.jobTitle ?? null,
        companyId: row.companyId != null ? String(row.companyId) : null,
        companyName: row.companyName ?? null,
        companyWebsite: row.companyWebsite ?? null,
        hasEmail: Boolean(row.hasEmail),
        hasDirectPhone: Boolean(row.hasDirectPhone),
        hasMobilePhone: Boolean(row.hasMobilePhone),
        contactAccuracyScore:
          typeof row.contactAccuracyScore === "number"
            ? row.contactAccuracyScore
            : null,
      } satisfies ZoomInfoPersonSummary;
    })
    .filter((row): row is ZoomInfoPersonSummary => row !== null);
}

export function normalizeContactEnrich(
  response: ZoomInfoContactEnrichResponse,
): ZoomInfoPersonDetail | null {
  const raw = extractFirstEnrichRow<ZoomInfoContactEnrichRaw>(response);
  if (!raw) return null;

  const first = raw.firstName ?? null;
  const last = raw.lastName ?? null;
  const full = [first, last].filter(Boolean).join(" ").trim() || "(unknown)";

  return {
    personId: String(raw.id ?? ""),
    fullName: full,
    firstName: first,
    lastName: last,
    jobTitle: raw.jobTitle ?? null,
    companyId: raw.companyId != null ? String(raw.companyId) : null,
    companyName: raw.companyName ?? null,
    companyWebsite: raw.companyWebsite ?? null,
    hasEmail: Boolean(raw.email),
    hasDirectPhone: Boolean(raw.phone),
    hasMobilePhone: Boolean(raw.mobilePhone),
    contactAccuracyScore:
      typeof raw.contactAccuracyScore === "number"
        ? raw.contactAccuracyScore
        : null,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    mobilePhone: raw.mobilePhone ?? null,
    linkedinUrl: pickLinkedinUrl(raw.externalUrls),
    city: raw.city ?? null,
    state: raw.state ?? null,
    country: raw.country ?? null,
    street: raw.street ?? null,
    zipCode: raw.zipCode ?? null,
  } satisfies ZoomInfoPersonDetail;
}

// ─── Generic envelope helper ─────────────────────────────────────────────────

function extractFirstEnrichRow<T>(response: {
  data?: { result?: Array<{ data?: T[] }> };
}): T | null {
  const resultArray = response.data?.result;
  if (!resultArray || resultArray.length === 0) return null;
  const firstResult = resultArray[0];
  const dataArray = firstResult?.data;
  if (!dataArray || dataArray.length === 0) return null;
  return dataArray[0] ?? null;
}

/**
 * Normalize a raw website string for use as a ZoomInfo companyWebsite filter.
 * Strips protocol + path, rejects placeholders ("N/A", "tbd", etc.). Returns
 * the bare `http://domain` form ZoomInfo wants, or null when invalid.
 *
 * Ported verbatim from autotier so test fixtures stay compatible.
 */
export function normalizeWebsiteForZoomInfo(rawWebsite: string): string | null {
  const trimmed = rawWebsite.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const placeholders = [
    "n/a",
    "na",
    "none",
    "unknown",
    "not available",
    "not available.",
    "no website",
    "no site",
    "tbd",
    "-",
  ];
  if (placeholders.some((p) => lower === p || lower.startsWith(`${p} `))) {
    return null;
  }

  const domain =
    trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .split("?")[0]
      ?.trim() ?? "";

  if (!domain) return null;

  const hasDot = domain.includes(".");
  const noSpaces = !domain.includes(" ");
  const reasonableLength = domain.length >= 4 && domain.length <= 253;
  if (!hasDot || !noSpaces || !reasonableLength) return null;

  return `http://${domain}`;
}
