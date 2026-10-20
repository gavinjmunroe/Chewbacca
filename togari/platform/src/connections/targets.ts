/**
 * The client's target account list, and deciding whether an employer is on it.
 *
 * Perplexity reads the same published sheet and flags what it thinks matches,
 * but a model matching names against a list fails silently in both directions:
 * it misses "Brown & Toland" because the list says "Altais", and it matches
 * Baptist Health South Florida to a Baptist in Kentucky. Neither failure
 * announces itself. So Togari reads the sheet too, and every employer
 * Perplexity reports is matched here, deterministically. The model's flag is
 * kept as a hint and labelled as one.
 */

import { createLogger } from "../observability/logger";

const logger = createLogger("connections/targets");

export interface TargetAccount {
  segment: string | null;
  type: string | null;
  account: string;
  /** The Company Domain cell as written, which is sometimes a full URL. */
  domainRaw: string | null;
  /** Registrable domain, e.g. "hss.edu" from "https://www.hss.edu/about". */
  domain: string | null;
  /**
   * The cell pointed below the domain ("cognizant.com/us/en/trizetto"). A
   * domain match on such a row only proves the parent organization, so it is
   * reported as parent_domain rather than domain.
   */
  domainHasPath: boolean;
}

/** Minimal RFC 4180: quoted fields, doubled quotes, commas and newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Two-label suffixes that need a third label to name an organization. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "nhs"]);

/** "https://www.hss.edu/about/" -> { domain: "hss.edu", hasPath: true }. */
export function registrableDomain(value: string | null | undefined): {
  domain: string | null;
  hasPath: boolean;
} {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return { domain: null, hasPath: false };
  const noScheme = raw.replace(/^[a-z]+:\/\//, "");
  const slash = noScheme.indexOf("/");
  const host = (slash === -1 ? noScheme : noScheme.slice(0, slash))
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  const path = slash === -1 ? "" : noScheme.slice(slash).replace(/[?#].*$/, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return { domain: null, hasPath: false };
  const keep =
    labels.length >= 3 &&
    labels[labels.length - 1].length === 2 &&
    SECOND_LEVEL.has(labels[labels.length - 2])
      ? 3
      : 2;
  return {
    domain: labels.slice(-keep).join("."),
    hasPath: path.replace(/\/+$/, "") !== "",
  };
}

/**
 * Lowercase, "&" as "and", punctuation gone, legal suffixes dropped, and a
 * parenthetical removed — Serif's sheet writes "Hospital for Special Surgery
 * (HSS)", and a history saying "Hospital for Special Surgery" is the same place.
 *
 * Deliberately NOT dropping words like "health", "system" or "hospital": they
 * are what tells two Baptists apart, and a false match becomes an AE asking a
 * customer for an introduction that does not exist. For the same reason the
 * abbreviation in the parenthetical is not matched on its own: "UHS" is
 * Universal Health Services on the sheet and United Health Services in New
 * York. Aliases, abbreviations and acquisitions are left to Perplexity's flag,
 * which is reported as a hint.
 */
export function normalizeOrgName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|lp|llp|corp|corporation|co|ltd|pllc|pc|plc)\b/g, " ")
    .replace(/^\s*the\s+/, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The column holding each field, by header name, so column order can change. */
function columnIndex(header: string[], ...names: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

export function parseTargets(csv: string): TargetAccount[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error("target sheet is empty");
  const [header, ...body] = rows;
  const iAccount = columnIndex(header, "account", "account name", "company", "name");
  if (iAccount === -1) {
    throw new Error(`target sheet has no Account column (header: ${header.join(", ")})`);
  }
  const iSegment = columnIndex(header, "segment");
  const iType = columnIndex(header, "type");
  const iDomain = columnIndex(header, "company domain", "domain", "company url", "website", "url");

  const cell = (r: string[], i: number) => (i === -1 ? null : (r[i] ?? "").trim() || null);
  const out: TargetAccount[] = [];
  for (const r of body) {
    const account = cell(r, iAccount);
    if (!account) continue;
    const domainRaw = cell(r, iDomain);
    const { domain, hasPath } = registrableDomain(domainRaw);
    out.push({
      segment: cell(r, iSegment),
      type: cell(r, iType),
      account,
      domainRaw,
      domain,
      domainHasPath: hasPath,
    });
  }
  if (out.length === 0) throw new Error("target sheet has a header but no accounts");
  return out;
}

/**
 * Half an hour. The sheet changes when a person edits it, not minute to
 * minute, and it is read twice per person: at dispatch for the row count, and
 * again when the result comes back to match against — which can be most of an
 * hour later on a slow day.
 */
const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; targets: TargetAccount[] }>();

/** Test hook. */
export function clearTargetsCache(): void {
  cache.clear();
}

/**
 * Read the published sheet. A failed read falls back to the last good copy
 * rather than throwing, because the list moving under a result is far less
 * harmful than a result that cannot be matched at all.
 */
export async function loadTargets(url: string): Promise<TargetAccount[]> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.targets;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`target sheet answered ${res.status}`);
    const text = await res.text();
    // Google answers an unpublished sheet with a sign-in page, not a 403.
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new Error("target sheet returned a web page, not CSV — is it published to the web as CSV?");
    }
    const targets = parseTargets(text);
    cache.set(url, { at: Date.now(), targets });
    return targets;
  } catch (err) {
    if (hit) {
      logger.warn("connections.targets.stale_copy_used", {
        reason: err instanceof Error ? err.message : String(err),
      });
      return hit.targets;
    }
    throw err;
  }
}

export type MatchBasis = "domain" | "parent_domain" | "name";

/** Is this employer on the list? Domain first, then exact normalized name. */
export function matchEmployer(
  employer: { company: string; company_domain?: string | null },
  targets: TargetAccount[],
): { target: TargetAccount; basis: MatchBasis } | null {
  const { domain } = registrableDomain(employer.company_domain);
  if (domain) {
    const byDomain = targets.find((t) => t.domain === domain);
    if (byDomain) {
      return { target: byDomain, basis: byDomain.domainHasPath ? "parent_domain" : "domain" };
    }
  }
  const name = normalizeOrgName(employer.company);
  if (name) {
    const byName = targets.find((t) => normalizeOrgName(t.account) === name);
    if (byName) return { target: byName, basis: "name" };
  }
  return null;
}

/** The row Perplexity named, if it named one that exists. */
export function findTargetByAccount(
  account: string | null | undefined,
  targets: TargetAccount[],
): TargetAccount | null {
  const name = normalizeOrgName(account);
  if (!name) return null;
  return targets.find((t) => normalizeOrgName(t.account) === name) ?? null;
}

/** Is this target the organization the person works at today? */
export function isSameOrganization(
  target: TargetAccount,
  company: string | null | undefined,
  companyDomain: string | null | undefined,
): boolean {
  const { domain } = registrableDomain(companyDomain);
  if (domain && target.domain === domain) return true;
  const name = normalizeOrgName(company);
  return !!name && normalizeOrgName(target.account) === name;
}
