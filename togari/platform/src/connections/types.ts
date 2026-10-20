/**
 * Warm-intro connection research — the two payloads.
 *
 * Clay posts a person to POST /connections. Perplexity posts what it found to
 * POST /connections/result. Both are parsed leniently for the same reason the
 * reply payloads are (src/replies/types.ts): a 400 on the intake drops a row
 * on the floor, and a 400 on the result throws away paid work.
 */

import { z } from "zod";

const looseText = (schema: z.ZodString) =>
  z.preprocess(
    (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v),
    schema,
  );

/**
 * A year, from whatever a model or a spreadsheet writes for one: 2019,
 * "2019", "2019-03", "Mar 2019", "present". Anything without a plausible
 * four-digit year is null rather than an error, because a role with an unknown
 * end date is still a role.
 */
const looseYear = z.preprocess((v) => {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string") {
    const m = v.match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : null;
  }
  return null;
}, z.number().int().nullable());

const looseCount = z.preprocess((v) => {
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return typeof v === "number" ? v : null;
}, z.number().nullable());

const looseBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(t)) return true;
    if (["false", "no", "n", "0"].includes(t)) return false;
  }
  return null;
}, z.boolean().nullable());

/** A model sometimes posts a nested array as a JSON string. Accept both. */
const jsonIfString = (v: unknown) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/**
 * What Clay POSTs to /connections: one person at one of the client's existing
 * customers.
 *
 * client_id is required, unlike /replies: there is no older Clay column to be
 * lenient with, and research billed to the wrong client's seat is the one
 * mistake here that costs someone else money.
 *
 * work_history is whatever enrichment already found, as text or as Clay's raw
 * array. It is a head start for the AI, never a substitute for its sources.
 */
export const ConnectionIngestPayload = z.object({
  row_id: looseText(z.string().trim().min(1)),
  client_id: looseText(z.string().trim().min(1)),
  person_name: looseText(z.string().trim().min(1)),
  person_company: looseText(z.string().trim().min(1)),
  person_title: looseText(z.string()).nullish(),
  person_company_domain: looseText(z.string()).nullish(),
  person_linkedin: looseText(z.string()).nullish(),
  person_location: looseText(z.string()).nullish(),
  /**
   * How to reach this person, shown in the Slack digest next to every path
   * that starts with them. Optional: a row_id that is itself an email is used
   * when this is missing.
   */
  person_email: looseText(z.string()).nullish(),
  work_history: z
    .preprocess(
      (v) => (v == null || typeof v === "string" ? v : JSON.stringify(v)),
      z.string(),
    )
    .nullish(),
});

export type ConnectionIngestPayload = z.infer<typeof ConnectionIngestPayload>;

/** One prior job, as Perplexity reports it. */
const ResultRole = z
  .object({
    company: looseText(z.string()).nullish(),
    company_domain: looseText(z.string()).nullish(),
    title: looseText(z.string()).nullish(),
    start_year: looseYear.optional(),
    end_year: looseYear.optional(),
    source_url: looseText(z.string()).nullish(),
    /** The sheet's Account value Perplexity thinks this matches. A hint only. */
    target_account: looseText(z.string()).nullish(),
    match_basis: looseText(z.string()).nullish(),
    // Neighbouring names a model reaches for when handed a field list.
    employer: looseText(z.string()).nullish(),
    company_name: looseText(z.string()).nullish(),
    domain: looseText(z.string()).nullish(),
  })
  .transform((r) => ({
    company: (r.company ?? r.company_name ?? r.employer ?? "").trim(),
    company_domain: r.company_domain ?? r.domain ?? null,
    title: r.title ?? null,
    start_year: r.start_year ?? null,
    end_year: r.end_year ?? null,
    source_url: r.source_url ?? null,
    target_account: r.target_account ?? null,
    match_basis: r.match_basis ?? null,
  }));

export type ResultRole = z.infer<typeof ResultRole>;

/**
 * The person on the row, or one of their colleagues. A missing name is
 * tolerated here and the entry skipped later: rejecting it would reject the
 * whole result, every other person included.
 */
const ResultPerson = z.object({
  name: looseText(z.string()).nullish(),
  title: looseText(z.string()).nullish(),
  relation: looseText(z.string()).nullish(),
  linkedin_url: looseText(z.string()).nullish(),
  source_url: looseText(z.string()).nullish(),
  roles: z.preprocess(jsonIfString, z.array(ResultRole)).nullish(),
});

export type ResultPerson = z.infer<typeof ResultPerson>;

/**
 * Someone in a buyer seat at a matched target account today — the person the
 * introduction would end at. Same tolerance as ResultPerson: a bad entry is
 * skipped later rather than rejecting the whole result.
 */
const ResultTargetContact = z
  .object({
    /** The sheet's Account value this person works at. */
    target_account: looseText(z.string()).nullish(),
    /**
     * That organization's website domain. Lets Togari place the person on the
     * sheet even when the model writes "Tenet Healthcare" for the row "Tenet".
     */
    target_domain: looseText(z.string()).nullish(),
    name: looseText(z.string()).nullish(),
    title: looseText(z.string()).nullish(),
    persona: looseText(z.string()).nullish(),
    linkedin_url: looseText(z.string()).nullish(),
    /** What places them at the target now. */
    source_url: looseText(z.string()).nullish(),
    /** The year they joined the organization, not their current role. */
    joined_year: looseYear.optional(),
    // Neighbouring names a model reaches for.
    account: looseText(z.string()).nullish(),
    company: looseText(z.string()).nullish(),
    start_year: looseYear.optional(),
  })
  .transform((c) => ({
    target_account: c.target_account ?? c.account ?? c.company ?? null,
    target_domain: c.target_domain ?? null,
    name: c.name?.trim() || null,
    title: c.title ?? null,
    persona: c.persona ?? null,
    linkedin_url: c.linkedin_url ?? null,
    source_url: c.source_url ?? null,
    joined_year: c.joined_year ?? c.start_year ?? null,
  }));

export type ResultTargetContact = z.infer<typeof ResultTargetContact>;

/**
 * What Perplexity POSTs back to /connections/result.
 *
 * Only row_id is required. A result naming nobody is a real answer — a small
 * customer with no public leadership page — and is recorded as zero
 * connections, not refused.
 */
export const ConnectionResultPayload = z.object({
  row_id: looseText(z.string().trim().min(1)),
  target_rows_read: looseCount.optional(),
  identity_confirmed: looseBool.optional(),
  people: z.preprocess(jsonIfString, z.array(ResultPerson)).nullish(),
  target_contacts: z.preprocess(jsonIfString, z.array(ResultTargetContact)).nullish(),
  notes: looseText(z.string()).nullish(),
});

export type ConnectionResultPayload = z.infer<typeof ConnectionResultPayload>;

/** Clay sends an empty cell as "", which means absent, not an empty name. */
const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  looseText(z.string()).nullish(),
);

/**
 * What Clay's results table POSTs to /connections/paths: one row as Togari
 * sent it there (src/connections/results.ts), field names unchanged, so the
 * Clay column body is the row's own columns.
 *
 * The path must reach a named buyer — that is the only kind the digest shows —
 * so the four people-and-place fields are required. Which matches qualify is
 * decided by the route, not here, so a refused row says why.
 */
export const ConnectionPathPayload = z.object({
  client_id: looseText(z.string().trim().min(1)),
  person_row_id: optionalText,
  person_name: looseText(z.string().trim().min(1)),
  person_title: optionalText,
  person_company: optionalText,
  person_email: optionalText,
  bridge_name: looseText(z.string().trim().min(1)),
  bridge_title: optionalText,
  bridge_relation: optionalText,
  bridge_linkedin: optionalText,
  former_employer: optionalText,
  former_title: optionalText,
  start_year: looseYear.optional(),
  end_year: looseYear.optional(),
  role_source_url: optionalText,
  target_account: looseText(z.string().trim().min(1)),
  target_segment: optionalText,
  match: optionalText,
  target_contact_name: looseText(z.string().trim().min(1)),
  target_contact_title: optionalText,
  target_contact_persona: optionalText,
  target_contact_linkedin: optionalText,
  target_contact_source_url: optionalText,
  target_contact_joined_year: looseYear.optional(),
  tenure_overlap: optionalText,
  overlap_years: looseCount.optional(),
});

export type ConnectionPathPayload = z.infer<typeof ConnectionPathPayload>;
