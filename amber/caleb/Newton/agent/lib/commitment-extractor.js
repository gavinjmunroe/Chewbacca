/**
 * commitment-extractor.js — extract "I'll bring/handle/do X" from group
 * chat (spec Phase 5, decision 9).
 *
 * On every inbound group message during an active event, run a cheap
 * model pass. If the message contains a commitment, persist it via
 * addCommitment(). Conflicts (two people committing to the same
 * normalized item) get surfaced to the group by the caller — this
 * module only does the extraction.
 *
 * Model: Claude Haiku (or whatever ANTHROPIC_FAST_MODEL points at).
 * Cost: ~$0.0001 per inbound. Gated by ENABLE_COMMITMENT_EXTRACTOR to
 * make it easy to flip off if the spend ever surprises us.
 *
 * Idempotency (flaw #25): addCommitment now consults BQ for an existing
 * open commitment on the same (event_id, person_id, normalized_item)
 * within the last 30 days BEFORE inserting, so dual-pass extraction
 * (e.g. the model fires once and the user re-asks Medha to confirm)
 * resolves to the same commitment_id with deduped=true.
 *
 * Conflict surfacing (flaw #26): addCommitment also returns
 * `conflict: { conflicting_person_id, conflicting_commitment_id }` when
 * a DIFFERENT person already has an open commitment with the same
 * normalized item. We pass that back to the caller so the agent can
 * post a one-line heads up in the group.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const FAST_MODEL =
  process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5-20251001";

const EXTRACTION_SYSTEM = [
  "You extract commitments from group chat messages.",
  "A commitment is when one person tells the group they will handle, bring,",
  "book, pay for, or otherwise take responsibility for a specific thing.",
  "",
  "Output strict JSON, no prose. Schema:",
  "  { commitment: true, item: <string>, certainty: 'concrete' | 'vague' }",
  "  OR { commitment: false }",
  "",
  "Rules:",
  "- Only extract first-person commitments ('I'll bring', 'I got the', 'my responsibility').",
  "- Concrete = specific noun ('speakers', 'hotel booking', 'the keg').",
  "- Vague = abstract verb ('I'll handle drinks', 'I'll figure out food').",
  "- Hypotheticals are NOT commitments ('I could bring', 'maybe I'll').",
  "- Questions are NOT commitments ('should I bring speakers?').",
  "- Past tense is NOT a commitment ('I brought speakers last time').",
  "- Negations are NOT commitments ('I won't bring', 'I can't make it').",
  "- Item should be the shortest noun phrase a human would highlight.",
].join("\n");

/**
 * Returns one of:
 *   { commitment: true, item, certainty }
 *   { commitment: false }
 *   null  (extractor disabled, no api key, or call failed)
 *
 * `recentMessages` (optional) is a short window of the last few group
 * messages, used as context so things like "yeah I'll get that" resolve
 * to the actual prior referent.
 */
export async function extractCommitment({ text, recentMessages = [] } = {}) {
  if (!isExtractorEnabled()) return null;
  if (!text || typeof text !== "string" || text.length > 1000) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const contextLines = (recentMessages || [])
    .slice(-6)
    .map((m) => {
      const from = m.from || m.senderLabel || "someone";
      const body = (m.content || m.text || "").slice(0, 200);
      return `${from}: ${body}`;
    })
    .join("\n");

  const userPrompt = contextLines
    ? `Recent group context:\n${contextLines}\n\nNew message:\n${text}\n\nExtract any commitment.`
    : `New group message:\n${text}\n\nExtract any commitment.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FAST_MODEL,
        max_tokens: 200,
        system: EXTRACTION_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      // Cheap fail — log once at debug level, don't spam every message.
      return null;
    }
    const data = await res.json();
    const textOut = data?.content?.[0]?.text || "";
    // Try to find a JSON object in the response (model sometimes wraps in code fences).
    const m = textOut.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
    if (parsed?.commitment !== true) return { commitment: false };
    if (!parsed.item || typeof parsed.item !== "string") return null;
    return {
      commitment: true,
      item: parsed.item.trim().slice(0, 200),
      certainty: parsed.certainty === "concrete" ? "concrete" : "vague",
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function isExtractorEnabled() {
  // Default ON when ANTHROPIC_API_KEY is set; explicit env var overrides.
  if (process.env.ENABLE_COMMITMENT_EXTRACTOR === "false") return false;
  if (process.env.ENABLE_COMMITMENT_EXTRACTOR === "true") return true;
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Convenience: given a fresh group message + the current event_id,
 * run the extractor and (if positive) call addCommitment to persist.
 * Fire-and-forget — never blocks the agent's reply.
 */
export async function maybeRecordCommitment({
  text,
  eventId,
  personHandle,
  recentMessages = [],
}) {
  if (!eventId || !personHandle) return null;
  const result = await extractCommitment({ text, recentMessages });
  if (!result?.commitment) return null;
  try {
    const { addCommitment } = await import("./events.js");
    const saved = await addCommitment({
      eventId,
      personHandle,
      item: result.item,
      source: result.certainty === "vague" ? "vague_chat" : "chat",
    });
    // flaw #26: saved.conflict (if present) bubbles up so the agent
    // loop in agent.js can post a "heads up: X and Y both said Z" line.
    // saved.deduped (flaw #25) also bubbles up so we don't log a fresh
    // "[commitment]" line when we've reused an existing row.
    return { ...saved, certainty: result.certainty };
  } catch (err) {
    console.warn(`[commitment-extractor] addCommitment failed: ${err.message}`);
    return null;
  }
}
