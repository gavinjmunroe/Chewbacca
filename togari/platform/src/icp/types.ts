/**
 * Website ICP list funnel — shared types and payload schemas.
 *
 * The funnel is the self-serve demo behind the BMA website's "Generate my
 * ICP list" CTA: a short one-question-per-screen wizard describes who the
 * visitor wants to reach, Clay sources matching accounts and enriches the
 * right people's work emails, and the finished list (at most 10 people) is
 * emailed back automatically as a CSV. One list per requester, ever.
 */

import { z } from "zod";

export const JOB_STATUSES = [
  "pending", // job row created, not yet pushed to Clay
  "building", // pushed to Clay, list being sourced
  "stalled", // still building past the alert window (Slack flagged); a late callback still sends the list
  "done", // callback processed, list CSV emailed
  "done_unsent", // callback processed, autosend kill-switch off
  "no_matches", // Clay found no one with a verified email (Slack: reach out personally)
  "failed", // push or send failure (see error column)
  "timed_out", // no callback by the give-up deadline (Slack: reach out personally); a late list is still sent
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "done_unsent",
  "no_matches",
  "failed",
]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Strip protocol/www/path so "https://www.acme.com/about" → "acme.com". */
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

export const IcpRequestPayload = z.object({
  full_name: z.string().trim().min(1).max(300),
  email: z.string().trim().email().max(320),
  company: z.string().trim().min(1).max(300),
  /** The requester's own domain — used to enrich and qualify them. */
  company_domain: z
    .string()
    .trim()
    .max(300)
    .transform(normalizeDomain)
    .refine((v) => DOMAIN_RE.test(v), { message: "invalid company_domain" }),
  /** Optional one-liner on what they sell, to ground the sourcing. */
  company_description: z.string().trim().max(500).default(""),
  /** The industry the requester sells FROM. */
  industry: z.string().trim().min(1).max(100),
  /** Free-text description of the accounts they want to reach. */
  icp_description: z.string().trim().min(3).max(2000),
  company_size: z.string().trim().max(40).nullish(),
  target_titles: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  client_ip: z.string().trim().max(100).optional(),
});

export type IcpRequest = z.infer<typeof IcpRequestPayload>;

/**
 * The identity we check repeat requests against: lowercased, with any
 * +tag dropped, so jane+2@acme.com and Jane@acme.com are one requester.
 */
export function normalizeRequesterEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  const local = lower.slice(0, at).split("+")[0];
  return `${local}${lower.slice(at)}`;
}

export const ContactMessagePayload = z.object({
  full_name: z.string().trim().min(1).max(300),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(1).max(5000),
  client_ip: z.string().trim().max(100).optional(),
});

export type ContactMessage = z.infer<typeof ContactMessagePayload>;

/**
 * One sourced person (plus their company) as Clay returns it. Every field is
 * nullish: Clay's code steps serialize a missing value as null, and a null
 * employee count must not make the whole callback a 400.
 */
export const IcpListRow = z
  .object({
    company_name: z.string().nullish(),
    company_domain: z.string().nullish(),
    employee_count: z.union([z.string(), z.number()]).nullish(),
    location: z.string().nullish(),
    contact_name: z.string().nullish(),
    contact_title: z.string().nullish(),
    /** Enriched work email. Rows without one never reach the requester. */
    contact_email: z.string().nullish(),
    contact_linkedin: z.string().nullish(),
    signal: z.string().nullish(),
  })
  .passthrough();

/**
 * What Clay's HTTP API column POSTs back once the list is built. Clay can
 * send the rows either as an array or as a JSON string, so accept both.
 */
export const ClayCallbackPayload = z
  .object({
    job_id: z.string().trim().min(1),
    row_id: z.string().trim().min(1),
    clay_status: z.enum(["found", "not_found", "error"]),
    rows: z.union([z.array(IcpListRow), z.string()]).optional(),
  })
  .passthrough();

export type ClayCallback = z.infer<typeof ClayCallbackPayload>;

/** Normalize the `rows` field into a plain array regardless of transport. */
export function parseListRows(rows: unknown): Record<string, unknown>[] {
  if (!rows) return [];
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  if (typeof rows === "string") {
    try {
      const parsed = JSON.parse(rows);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface IcpJob {
  job_id: string;
  created_at?: string;
  status: JobStatus;
  full_name: string | null;
  email: string;
  company: string | null;
  company_domain: string | null;
  company_description: string | null;
  industry: string | null;
  icp_description: string;
  company_size: string | null;
  target_titles: string[];
  dnc_suppressed: boolean | null;
  work_email: boolean | null;
  lead_score: number | null;
  list_data: Record<string, unknown>[] | null;
  list_size: number | null;
  clay_status: string | null;
}
