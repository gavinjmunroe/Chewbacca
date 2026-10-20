/**
 * @togari/admin — Primary-contact tiebreaker prompt template.
 *
 * Used when the rule-based scoring rubric (§5.1) leaves the top two
 * candidates within 5 points. Claude reads the candidate set + thesis
 * context and picks one, returning a short rationale that we persist as
 * `company_contacts.primary_reason` for trust/explainability in the UI.
 */

import type { CompanyContact } from "../types";

export interface PrimaryContactTiebreakerPromptInput {
  thesis: { name: string; owner_target_titles: string[] };
  company: { name: string; domain?: string; description?: string };
  /**
   * Two or more candidates that the rule-based rubric scored within 5
   * points of each other. Order is highest-rule-based-score first.
   */
  top_candidates: Array<CompanyContact & { rule_based_score: number }>;
}

function describeContact(
  c: CompanyContact & { rule_based_score: number },
): string {
  const parts: string[] = [];
  parts.push(`id=${c.contact_id}`);
  parts.push(
    `name=${c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "unknown"}`,
  );
  parts.push(`title=${c.title || "unknown"}`);
  if (c.seniority) parts.push(`seniority=${c.seniority}`);
  if (c.email)
    parts.push(`email=${c.email_verified ? "verified" : "unverified"}`);
  if (c.mobile_phone) parts.push("mobile=yes");
  if (c.business_phone) parts.push("biz_phone=yes");
  if (c.linkedin_url) parts.push("linkedin=yes");
  if (c.tenure_years != null) parts.push(`tenure=${c.tenure_years}y`);
  if (c.last_activity_at)
    parts.push(`last_active=${c.last_activity_at.slice(0, 10)}`);
  parts.push(`rule_score=${c.rule_based_score}`);
  return parts.join(" | ");
}

export function buildPrimaryContactTiebreakerPrompt(
  input: PrimaryContactTiebreakerPromptInput,
): string {
  const { thesis, company, top_candidates } = input;
  const titlesLine = thesis.owner_target_titles.join(", ");

  const candidatesBlock = top_candidates
    .map((c, i) => `Candidate ${i + 1}: ${describeContact(c)}`)
    .join("\n");

  return `You are picking the single best primary contact for an outbound PE-sourcing call. The rule-based rubric returned a near-tie; your job is to break it.

THESIS
${thesis.name}
Owner-target titles for this thesis: ${titlesLine}

COMPANY
${company.name}${company.domain ? ` (${company.domain})` : ""}
${company.description ? `Context: ${company.description}\n` : ""}
TIE-BREAKING CANDIDATES
${candidatesBlock}

DECISION RULES
- Prefer the contact whose title most closely matches the thesis owner-target titles.
- A reachable contact (mobile phone OR verified email) outranks an unreachable one even if title is slightly weaker.
- Penalize any candidate whose title contains "former", "ex-", "interim", or "advisor".
- If two candidates are still tied, prefer the longer tenure at the company.

OUTPUT FORMAT — return ONLY a single JSON object referencing the contact_id of the chosen candidate:
{ "primary_contact_id": "<contact_id>", "primary_reason": "<one sentence, names the decisive signal>" }`;
}
