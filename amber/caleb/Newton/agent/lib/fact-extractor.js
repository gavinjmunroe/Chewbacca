/**
 * fact-extractor.js — extracts "X about Y" facts from messages and posts
 * them to medha-id's /v1/embeddings/contact-fact.
 *
 * Flaw #31: every outbound Medha reply, and every inbound that mentions
 * someone other than the sender, gets a cheap Claude Haiku pass to pull
 * 0..3 facts. Each fact is { contact, fact, dimension?, confidence? }.
 *
 * The extractor is fire-and-forget — the reply path never blocks on it.
 * If Claude is unavailable or returns garbage, we skip and log.
 *
 * Heuristic gating to keep cost down:
 *   - skip if text is empty or < 8 chars
 *   - skip if no proper-noun-ish tokens (no capital letter past pos 0
 *     in any word longer than 2 chars) AND no @mention
 *   - skip outbound texts that are pure acknowledgements (yes/ok/got it)
 *
 * The Haiku response is parsed as JSON; on parse failure we skip.
 */

import { callClaudeRaw } from "./ai.js";
import { recordContactFact } from "./embeddings.js";
import { classify, isDimension } from "./ontology/index.js";

const ACK_REGEX =
  /^\s*(ok+|sure+|yes+|yep+|nope?|got it|sounds good|thanks?|np|k)\W*$/i;

function hasMentionableNoun(text) {
  if (!text || text.length < 8) return false;
  if (/@\w+/.test(text)) return true;
  // Look for any capitalized word past the first position that isn't a
  // sentence-start common word.
  const words = text.split(/\s+/);
  for (let i = 1; i < words.length; i += 1) {
    const w = words[i];
    if (w.length > 2 && /^[A-Z][a-z]+/.test(w)) return true;
  }
  return false;
}

function shouldExtract(text) {
  if (!text) return false;
  if (text.length < 8) return false;
  if (ACK_REGEX.test(text)) return false;
  return hasMentionableNoun(text);
}

const SYSTEM_PROMPT = `You extract concise factual statements about people from a single message.

Output ONLY valid JSON of shape:
{"facts": [{"contact": "name or handle", "fact": "short statement", "dimension": "social|financial|intellectual|spiritual|physical|emotional|null", "confidence": 0.0-1.0}]}

Rules:
- Only extract facts ABOUT specific named people (not the speaker themselves).
- Each fact must be one sentence, under 120 chars.
- If no extractable facts, return {"facts": []}.
- Do not invent details. If unsure, omit.
- Do not output any prose, only the JSON.`;

/**
 * Extract facts from `text` and write them to medha-id.
 *
 * @param {object} opts
 * @param {string} opts.text          The message body.
 * @param {string} opts.tenantDid     Tenant DID to attribute facts to.
 * @param {string} opts.sourceContact The handle of the message author
 *                                    (used to skip facts about the
 *                                    speaker themselves).
 * @param {string} [opts.sourceMessageId]
 */
export async function extractAndStoreFacts({
  text,
  tenantDid,
  sourceContact,
  sourceMessageId = null,
}) {
  if (!tenantDid || !text) return { skipped: true, reason: "missing_args" };
  if (!shouldExtract(text)) return { skipped: true, reason: "gated_out" };

  let raw;
  try {
    raw = await callClaudeRaw({
      model: "claude-haiku-4-6",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });
  } catch (err) {
    console.warn(`[fact-extractor] Claude call failed: ${err.message}`);
    return { skipped: true, reason: "llm_error" };
  }

  // callClaudeRaw shape: { content: [{type:'text', text:'…'}] }
  const body =
    raw?.content?.find?.((c) => c?.type === "text")?.text ||
    raw?.completion ||
    "";
  if (!body) return { skipped: true, reason: "empty_response" };

  let parsed;
  try {
    // Sometimes Haiku wraps JSON in ```json blocks; strip.
    const cleaned = body
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { skipped: true, reason: "parse_error" };
  }

  const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
  if (facts.length === 0) return { written: 0 };

  // Resolve each fact's dimension via the ontology classifier (only when
  // the upstream extractor didn't already supply a valid one) and write
  // it to medha-id. Fan out in parallel so the per-fact Haiku classify
  // call doesn't serialize the extractor.
  const results = await Promise.all(
    facts.map(async (f) => {
      if (!f?.contact || !f?.fact) return 0;
      // Don't store facts about the speaker themselves: that's just
      // their own state, not a contact_facts row.
      if (
        sourceContact &&
        typeof f.contact === "string" &&
        f.contact.toLowerCase() === sourceContact.toLowerCase()
      ) {
        return 0;
      }

      const factText = String(f.fact).slice(0, 500);

      // Trust the upstream value only when it's one of the six load-
      // bearing dimension strings; otherwise classify from the fact text.
      let dimension = isDimension(f.dimension) ? f.dimension : null;
      if (!dimension) {
        try {
          dimension = await classify(factText);
        } catch (err) {
          console.warn(`[fact-extractor] classify failed: ${err.message}`);
          dimension = null;
        }
      }

      try {
        await recordContactFact({
          tenantDid,
          contact: String(f.contact),
          contactName: f.contact_name || null,
          fact: factText,
          dimension: dimension || null,
          confidence: typeof f.confidence === "number" ? f.confidence : 0.7,
          sourceMessageId,
        });
        return 1;
      } catch (err) {
        console.warn(`[fact-extractor] write failed: ${err.message}`);
        return 0;
      }
    }),
  );

  const written = results.reduce((sum, n) => sum + n, 0);
  return { written };
}
