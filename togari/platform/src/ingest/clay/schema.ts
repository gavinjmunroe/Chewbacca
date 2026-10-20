/**
 * @togari/admin — Clay webhook payload schema
 *
 * Approximate shape based on Clay's typical webhook export contract. Most
 * fields are optional because Clay tables vary widely; we accept what's
 * present and let downstream tooling fill the rest. Sagar will lock the
 * exact column names when wiring his Clay table; relax/tighten here.
 *
 * Empty strings and "N/A" are normalized to null at parse time so the BQ
 * persister never has to special-case them.
 */

import { z } from "zod";

const nullishString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const trimmed = v.trim();
    if (!trimmed) return null;
    if (/^(n\/a|na|null|undefined|-)$/i.test(trimmed)) return null;
    return trimmed;
  });

const nullishUrl = nullishString.transform((v) => {
  if (!v) return null;
  // Tolerate Clay rows that have "linkedin.com/in/foo" with no protocol
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  return v;
});

const nullishEmail = nullishString.transform((v) => {
  if (!v) return null;
  // Don't fail on malformed emails; downstream code can decide whether to keep
  return v.toLowerCase();
});

const nullishNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n =
      typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  });

const nullishBool = z
  .union([z.boolean(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return false;
    return /^(true|yes|y|1)$/i.test(String(v).trim());
  });

export const ClayContactSchema = z
  .object({
    full_name: nullishString,
    first_name: nullishString,
    last_name: nullishString,
    title: nullishString,
    email: nullishEmail,
    email_verified: nullishBool,
    mobile_phone: nullishString,
    business_phone: nullishString,
    linkedin_url: nullishUrl,
  })
  .passthrough();

export const ClayCompanySchema = z
  .object({
    name: z.string().min(1, "company.name is required"),
    website: nullishUrl,
    domain: nullishString,
    address: nullishString,
    city: nullishString,
    state: nullishString,
    country: nullishString,
    industry: nullishString,
    revenue_estimate: nullishNumber,
    headcount_estimate: nullishNumber,
    description: nullishString,
  })
  .passthrough();

export const ClayRowSchema = z.object({
  company: ClayCompanySchema,
  contacts: z.array(ClayContactSchema).default([]),
});

export const ClayWebhookPayloadSchema = z.object({
  clay_run_id: z.string().min(1, "clay_run_id is required"),
  clay_table_id: z.string().optional().nullable(),
  mandate_id: z.string().optional().nullable(),
  tenant_id: z.string().default("bma"),
  completed_at: z.string().datetime({ offset: true }).optional(),
  total_records: z.number().int().nonnegative().optional(),
  rows: z.array(ClayRowSchema).min(1, "rows must contain at least one entry"),
});

export type ClayContact = z.infer<typeof ClayContactSchema>;
export type ClayCompany = z.infer<typeof ClayCompanySchema>;
export type ClayRow = z.infer<typeof ClayRowSchema>;
export type ClayWebhookPayload = z.infer<typeof ClayWebhookPayloadSchema>;
