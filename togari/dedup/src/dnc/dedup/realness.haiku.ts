/**
 * Claude Haiku realness classifier.
 *
 * Called by the orchestrator (realness.ts) only when the heuristic score is
 * inside the ambiguous band [30, 70]. The cost guard lives in the orchestrator
 * so this module just owns the network call and prompt.
 *
 * Model: claude-haiku-4-5-20251001 (cheap, fast — fine for a one-shot yes/no
 * with a short rationale).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { UnifiedContact, RealnessVerdict } from "../types/index.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/**
 * Function signature used by the orchestrator. Exporting the type lets tests
 * inject a fake classifier without touching the network.
 */
export type HaikuClassifier = (
  contact: UnifiedContact,
) => Promise<RealnessVerdict>;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cachedClient;
}

/**
 * Build a minimal description of the contact for the model. Only ships the
 * fields the prompt asks for — name, title, company, sources — so the call
 * is cheap and predictable.
 */
function describeContact(contact: UnifiedContact): string {
  const lines: string[] = [];
  if (contact.full_name) lines.push(`Name: ${contact.full_name}`);
  if (contact.current_title) lines.push(`Title: ${contact.current_title}`);
  if (contact.current_company)
    lines.push(`Company: ${contact.current_company}`);
  if (contact.email) lines.push(`Email: ${contact.email}`);
  if (contact.linkedin_url) lines.push(`LinkedIn: ${contact.linkedin_url}`);
  if (contact.instagram_username)
    lines.push(`Instagram: @${contact.instagram_username}`);
  if (contact.twitter_username)
    lines.push(`Twitter: @${contact.twitter_username}`);
  if (contact.sources) lines.push(`Sources: ${contact.sources}`);
  return lines.join("\n");
}

const SYSTEM_PROMPT = [
  "You classify whether a contact record describes a real individual person",
  "(returns true) or an organization, brand, role account, bot, or throwaway",
  "(returns false).",
  "",
  "Reply with strict JSON only, no prose, no markdown. Schema:",
  '{"is_real": boolean, "score": number, "reason": string}',
  "",
  "Rules:",
  "- score is on [0, 100]. 0 means definitely not a real person, 100 means",
  "  definitely a real individual.",
  "- is_real must be true when score is at least 60, false otherwise.",
  "- reason is a short single-sentence justification grounded in the input,",
  "  fewer than 200 characters, no quotes, no newlines.",
].join("\n");

/**
 * Parse Claude's reply. The system prompt forces JSON; if the model emits
 * extra prose or fences anyway, strip them before parsing.
 */
function parseVerdict(raw: string): RealnessVerdict {
  let text = raw.trim();
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(text) as {
    is_real?: unknown;
    score?: unknown;
    reason?: unknown;
  };

  const score =
    typeof parsed.score === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : 50;
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 240)
      : "haiku did not provide a reason";
  const isReal =
    typeof parsed.is_real === "boolean" ? parsed.is_real : score >= 60;

  return { is_real: isReal, score, reason };
}

/**
 * Default Haiku classifier. Calls the live model. The orchestrator passes
 * this in by default but tests can inject a fake.
 */
export const classifyWithHaiku: HaikuClassifier = async (contact) => {
  const client = getClient();
  const userContent = describeContact(contact);

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Classify this contact:\n\n${userContent}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Haiku returned no text content");
  }

  return parseVerdict(textBlock.text);
};
