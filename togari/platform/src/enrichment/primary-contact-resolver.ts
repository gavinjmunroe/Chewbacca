/**
 * @togari/admin — Primary contact resolver (Â§5.1).
 *
 * Picks the single primary_contact for a company based on a rule-based
 * scoring rubric, with a Claude tiebreaker when the top two are within
 * 5 points. The rationale is persisted to `company_contacts.primary_reason`
 * so the UI can show *why* this person was picked — the trust-builder.
 *
 * SCORING RUBRIC (mirrors product spec Â§5.1 exactly):
 *   +40  title match against thesis owner-target titles
 *   +20  has verified email
 *   +15  has mobile phone
 *   +10  LinkedIn profile present
 *   +10  active in last 90 days
 *   +5   decade-plus tenure at company
 *   -20  title contains 'former' / 'ex-'
 *
 * Throws on empty candidates — the caller (orchestrator) decides what to
 * do with a company that returned zero contacts.
 */

import { createLogger } from "../observability/logger";
import { SONNET } from "../config/models";
import {
  buildPrimaryContactTiebreakerPrompt,
  type PrimaryContactTiebreakerPromptInput,
} from "./prompts/primary-contact-tiebreaker";
import type { CompanyContact } from "./types";

const logger = createLogger("enrichment/primary-contact-resolver");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = SONNET;
const ANTHROPIC_VERSION = "2023-06-01";

export const DEFAULT_OWNER_TARGET_TITLES = [
  "CEO",
  "Chief Executive Officer",
  "Founder",
  "Co-Founder",
  "Owner",
  "President",
  "Managing Partner",
];

const FORMER_TITLE_RE = /\b(former|ex-?|interim|advisor)\b/i;

const TIEBREAK_THRESHOLD = 5;

export interface ResolverInput {
  company_id: string;
  candidates: CompanyContact[];
  /**
   * Title keywords to match. Case-insensitive substring match. Defaults
   * to DEFAULT_OWNER_TARGET_TITLES if not provided.
   */
  thesis_signal_keywords?: string[];
  /**
   * Optional company context passed to the Claude tiebreaker. Improves
   * tiebreaker quality but is not required for the rule-based pass.
   */
  company?: { name: string; domain?: string; description?: string };
  /**
   * Optional thesis name passed to the Claude tiebreaker prompt.
   */
  thesis_name?: string;
}

export interface ResolverOutput {
  primary_contact_id: string;
  primary_score: number;
  primary_reason: string;
  alternates: Array<{ contact_id: string; score: number }>;
}

interface ScoredCandidate {
  contact: CompanyContact;
  score: number;
  /** Human-readable bullet trail of which rubric items fired. */
  reasons: string[];
}

/**
 * Apply the rule-based rubric. Pure function, no I/O — the unit-test
 * surface lives here.
 */
export function scoreCandidate(
  contact: CompanyContact,
  ownerTargetTitles: string[],
): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;
  const title = contact.title || "";
  const titleLower = title.toLowerCase();

  // -20: former / ex- penalty (applied first so it's visible even when
  // other bonuses fire).
  if (FORMER_TITLE_RE.test(title)) {
    score -= 20;
    reasons.push("-20 former/ex- title");
  }

  // +40: title match against owner-target keywords.
  const titleMatch = ownerTargetTitles.find((kw) =>
    titleLower.includes(kw.toLowerCase()),
  );
  if (titleMatch) {
    score += 40;
    reasons.push(`+40 title matches ${titleMatch}`);
  }

  // +20: verified email.
  if (contact.email && contact.email_verified === true) {
    score += 20;
    reasons.push("+20 verified email");
  }

  // +15: mobile phone present.
  if (contact.mobile_phone) {
    score += 15;
    reasons.push("+15 mobile phone");
  }

  // +10: LinkedIn profile.
  if (contact.linkedin_url) {
    score += 10;
    reasons.push("+10 LinkedIn profile");
  }

  // +10: active in last 90 days.
  if (contact.last_activity_at) {
    const activity = new Date(contact.last_activity_at);
    if (!Number.isNaN(activity.getTime())) {
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      if (activity.getTime() >= ninetyDaysAgo) {
        score += 10;
        reasons.push("+10 active in last 90 days");
      }
    }
  }

  // +5: decade-plus tenure.
  if (contact.tenure_years != null && contact.tenure_years >= 10) {
    score += 5;
    reasons.push("+5 10+ year tenure");
  }

  return { contact, score, reasons };
}

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return key;
}

interface TiebreakerResponse {
  primary_contact_id: string;
  primary_reason: string;
}

/**
 * Ask Claude to pick between near-tied candidates. Exposed so tests can
 * stub it without the network round-trip.
 */
export async function callClaudeTiebreaker(
  input: PrimaryContactTiebreakerPromptInput,
): Promise<TiebreakerResponse> {
  const apiKey = getApiKey();
  const userMessage = buildPrimaryContactTiebreakerPrompt(input);

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 256,
      system:
        "You are a sales operations decision engine. Always return the requested JSON, nothing else.",
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic tiebreaker ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("")
    .trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Tiebreaker returned no JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(
    raw.slice(start, end + 1),
  ) as Partial<TiebreakerResponse>;
  if (
    !parsed.primary_contact_id ||
    typeof parsed.primary_contact_id !== "string"
  ) {
    throw new Error(
      `Tiebreaker missing primary_contact_id. Raw: ${raw.slice(0, 200)}`,
    );
  }
  return {
    primary_contact_id: parsed.primary_contact_id,
    primary_reason:
      typeof parsed.primary_reason === "string" &&
      parsed.primary_reason.trim().length > 0
        ? parsed.primary_reason.trim()
        : "Selected by Claude tiebreaker",
  };
}

/** Injection seam used by tests to avoid real Anthropic calls. */
type Tiebreaker = typeof callClaudeTiebreaker;

export interface ResolverDeps {
  tiebreaker?: Tiebreaker;
}

export async function resolvePrimaryContact(
  input: ResolverInput,
  deps: ResolverDeps = {},
): Promise<ResolverOutput> {
  if (!input.candidates || input.candidates.length === 0) {
    throw new Error(
      `resolvePrimaryContact: no candidates supplied for company_id=${input.company_id}`,
    );
  }

  const ownerTitles =
    input.thesis_signal_keywords && input.thesis_signal_keywords.length > 0
      ? input.thesis_signal_keywords
      : DEFAULT_OWNER_TARGET_TITLES;

  const scored: ScoredCandidate[] = input.candidates.map((c) =>
    scoreCandidate(c, ownerTitles),
  );
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];

  // Single candidate or comfortable lead â pick the rule-based winner.
  if (!second || top.score - second.score > TIEBREAK_THRESHOLD) {
    const reason =
      top.reasons.length > 0
        ? top.reasons.join(", ")
        : "highest rule-based score";
    logger.info("Primary contact resolved (rule-based)", {
      company_id: input.company_id,
      primary_contact_id: top.contact.contact_id,
      score: top.score,
      candidate_count: scored.length,
    });
    return {
      primary_contact_id: top.contact.contact_id,
      primary_score: top.score,
      primary_reason: reason,
      alternates: scored
        .slice(1)
        .map((s) => ({ contact_id: s.contact.contact_id, score: s.score })),
    };
  }

  // Top-two within 5 points â tiebreaker.
  // Pull every candidate within the threshold of #1 so Claude sees the
  // full near-tie set, not just the top two.
  const tied = scored.filter((s) => top.score - s.score <= TIEBREAK_THRESHOLD);
  const tiebreaker = deps.tiebreaker ?? callClaudeTiebreaker;
  const tbInput: PrimaryContactTiebreakerPromptInput = {
    thesis: {
      name: input.thesis_name || "Sourcing target",
      owner_target_titles: ownerTitles,
    },
    company: input.company || { name: "Unknown company" },
    top_candidates: tied.map((s) => ({
      ...s.contact,
      rule_based_score: s.score,
    })),
  };

  let tbResult: TiebreakerResponse;
  try {
    tbResult = await tiebreaker(tbInput);
  } catch (err) {
    logger.error(
      "Tiebreaker failed â falling back to rule-based winner",
      err instanceof Error ? err : new Error(String(err)),
      { company_id: input.company_id },
    );
    return {
      primary_contact_id: top.contact.contact_id,
      primary_score: top.score,
      primary_reason: `${top.reasons.join(", ") || "tied"} (tiebreaker failed, fell back to rule-based)`,
      alternates: scored
        .slice(1)
        .map((s) => ({ contact_id: s.contact.contact_id, score: s.score })),
    };
  }

  // Verify Claude picked a real contact_id; otherwise fall back to top.
  const winner =
    scored.find((s) => s.contact.contact_id === tbResult.primary_contact_id) ??
    top;
  if (
    winner === top &&
    tbResult.primary_contact_id !== top.contact.contact_id
  ) {
    logger.warn(
      "Tiebreaker returned unknown contact_id, falling back to rule-based winner",
      {
        returned: tbResult.primary_contact_id,
        candidates: scored.map((s) => s.contact.contact_id),
      },
    );
  }

  logger.info("Primary contact resolved (tiebreaker)", {
    company_id: input.company_id,
    primary_contact_id: winner.contact.contact_id,
    score: winner.score,
    tied_count: tied.length,
  });

  return {
    primary_contact_id: winner.contact.contact_id,
    primary_score: winner.score,
    primary_reason: tbResult.primary_reason,
    alternates: scored
      .filter((s) => s.contact.contact_id !== winner.contact.contact_id)
      .map((s) => ({ contact_id: s.contact.contact_id, score: s.score })),
  };
}
