/**
 * Realness heuristics — cheap, synchronous pattern matching that runs first.
 *
 * Returns a score on [0, 100] plus a short reason string. The orchestrator
 * (realness.ts) decides whether the score is clear-cut or ambiguous; ambiguous
 * cases (score in [30, 70]) escalate to Claude Haiku.
 *
 * No network calls here. No async. Heuristics are pure functions of the input
 * fields so they're cheap to run on every new contact.
 */

import type { UnifiedContact } from "../types/index.js";

export interface HeuristicResult {
  score: number;
  reason: string;
}

/**
 * Tokens that strongly suggest a name belongs to an organization, role, or bot
 * rather than a real individual. Matched as whole words, case-insensitive.
 */
const ORG_NAME_TOKENS = [
  "Inc",
  "LLC",
  "L\\.L\\.C",
  "Corp",
  "Corporation",
  "Ltd",
  "Limited",
  "GmbH",
  "Co",
  "Company",
  "Group",
  "Holdings",
  "Partners",
  "Capital",
  "Ventures",
  "Foundation",
  "Team",
  "Sales",
  "Support",
  "Marketing",
  "Recruiting",
  "HR",
  "Bot",
  "Admin",
  "Official",
  "Service",
  "Services",
  "Customer",
  "Press",
  "Media",
  "PR",
  "Info",
];

const ORG_NAME_REGEX = new RegExp(`\\b(${ORG_NAME_TOKENS.join("|")})\\b`, "i");

/**
 * Generic email local-parts that almost never belong to a real individual.
 * The local-part is the bit before the @.
 */
const GENERIC_LOCAL_PARTS = new Set([
  "info",
  "admin",
  "support",
  "noreply",
  "no-reply",
  "team",
  "sales",
  "billing",
  "hello",
  "hi",
  "contact",
  "help",
  "press",
  "media",
  "marketing",
  "recruiting",
  "careers",
  "jobs",
  "hr",
  "office",
  "accounts",
  "accounting",
  "finance",
  "service",
  "services",
  "feedback",
  "abuse",
  "postmaster",
  "webmaster",
  "root",
  "test",
  "demo",
  "example",
]);

/**
 * Check whether a name string matches an organization-style pattern.
 * Exported so callers can reuse it without running the full heuristic pass.
 */
export function isOrgName(name: string | null | undefined): boolean {
  if (!name) return false;
  return ORG_NAME_REGEX.test(name);
}

/**
 * Check whether an email's local-part is a generic role address.
 */
export function isGenericEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.indexOf("@");
  if (at <= 0) return false;
  const local = email.slice(0, at).toLowerCase().trim();
  if (!local) return false;
  return GENERIC_LOCAL_PARTS.has(local);
}

/**
 * Heuristic for handles/usernames that look like role accounts rather than
 * real people. Examples: support_team, sales_official, bot_user.
 */
export function isGenericHandle(handle: string | null | undefined): boolean {
  if (!handle) return false;
  const lower = handle.toLowerCase();
  const tokens = lower.split(/[._\-\s]/).filter(Boolean);
  for (const t of tokens) {
    if (GENERIC_LOCAL_PARTS.has(t)) return true;
    if (/^(bot|official|press|media)\d*$/.test(t)) return true;
  }
  return false;
}

/**
 * Suspicious follower-to-following ratio. Above 1000:1 typically signals
 * a brand, celebrity, or bot rather than a peer contact.
 *
 * Returns true only when both counts are present and ratio exceeds the cap.
 */
export function hasSuspiciousFollowerRatio(
  followers: number | null | undefined,
  following: number | null | undefined,
): boolean {
  if (followers == null || following == null) return false;
  if (following <= 0) return followers >= 1000;
  return followers / following > 1000;
}

/**
 * Run the heuristic pass against a UnifiedContact. Returns a score plus a
 * short human-readable reason. The orchestrator uses the score to decide
 * whether to escalate to Haiku.
 *
 * Score interpretation:
 *   0-29   confidently not-real (org, bot, generic role)
 *   30-70  ambiguous — escalate to Haiku
 *   71-100 confidently real person
 */
export function runHeuristics(contact: UnifiedContact): HeuristicResult {
  const orgName = isOrgName(contact.full_name);
  const genericEmail = isGenericEmail(contact.email);
  const genericLinkedIn = isGenericHandle(contact.linkedin_username);
  const genericInstagram = isGenericHandle(contact.instagram_username);
  const genericTwitter = isGenericHandle(contact.twitter_username);

  if (orgName) {
    return {
      score: 20,
      reason: `name matches organization pattern (${contact.full_name})`,
    };
  }

  if (genericEmail) {
    return {
      score: 15,
      reason: `email local-part is a generic role address (${contact.email})`,
    };
  }

  if (genericLinkedIn || genericInstagram || genericTwitter) {
    const handle =
      (genericLinkedIn && contact.linkedin_username) ||
      (genericInstagram && contact.instagram_username) ||
      (genericTwitter && contact.twitter_username) ||
      "";
    return {
      score: 25,
      reason: `social handle looks like a role account (${handle})`,
    };
  }

  const hasName = !!(contact.full_name && contact.full_name.trim().length > 0);
  const hasFirstAndLast = !!(contact.first_name && contact.last_name);
  const hasIdentifyingChannel = !!(
    contact.email ||
    contact.phone ||
    contact.linkedin_url ||
    contact.linkedin_username
  );
  const hasJobContext = !!(contact.current_title || contact.current_company);

  if (!hasName) {
    return {
      score: 40,
      reason: "no name supplied",
    };
  }

  if (hasFirstAndLast && hasIdentifyingChannel && hasJobContext) {
    return {
      score: 90,
      reason:
        "full name plus an identifying channel plus job context — strong real-person signal",
    };
  }

  if (hasFirstAndLast && hasIdentifyingChannel) {
    return {
      score: 80,
      reason: "first and last name plus an identifying channel",
    };
  }

  if (hasFirstAndLast) {
    return {
      score: 65,
      reason: "first and last name but no verifying channel",
    };
  }

  return {
    score: 50,
    reason: "single-token name with no strong signal either way",
  };
}

/**
 * True when the heuristic score is outside the ambiguous band and the
 * orchestrator can skip the Haiku call. The band is [30, 70] inclusive.
 */
export function isClearCut(score: number): boolean {
  return score < 30 || score > 70;
}
