/**
 * Auto-memory capture (Memori-inspired).
 *
 * MemoriLabs/Memori's key insight: agent memory shouldn't require
 * explicit save calls. Every conversational turn gets run through a
 * cheap extractor that pulls {facts, preferences, entities, topics}
 * into structured memory. We keep Amber LLM-agnostic by doing this
 * with callPerplexityLight (Sonar) rather than OpenAI-SDK hooks.
 *
 * Attribution (also borrowed from Memori):
 *   entity_id  = the contact handle the facts are ABOUT
 *   process_id = the channel/context the fact came from (DM / group / checkin)
 *
 * This runs AFTER Amber replies — fire-and-forget, never blocks the
 * hot path. Output lands in:
 *   1. amber-id "agent" pipe (trust=0.6) so Pinecone can retrieve it
 *   2. contact's profile.notes (structured, capped at 25)
 */

import { callPerplexityLight } from "./tiwari/context.js";
import { ingestToAmberID } from "./amber-id-ingest.js";
import { loadContact, saveContact } from "./contacts.js";
import { registerCapability } from "./capabilities.js";

registerCapability(
  "Memory",
  "Auto-memory extraction (Memori-inspired): every turn yields {facts, preferences, entities, topics, dimension} written to contact notes + amber-id agent pipe with entity_id/process_id attribution",
);

const AUTO_MEM_CONFIDENCE = 0.6;
const MAX_NOTES_PER_TURN = 3;

// Skip obvious non-memorable exchanges
function worthExtracting(incoming, reply) {
  if (!incoming || !reply) return false;
  const totalLen = (incoming.length || 0) + (reply.length || 0);
  if (totalLen < 40) return false;
  // Skip greetings + closers
  if (/^(hey|hi|hello|yo|sup|gm|gn|bye|ttyl|night)\b/i.test(incoming.trim()))
    return false;
  return true;
}

/**
 * Extract structured memory from a single conversational turn.
 * Returns { facts[], preferences[], entities[], topics[], dimension }
 * or null.
 */
export async function extractStructuredMemory({
  incoming,
  reply,
  speakerHandle,
  speakerName,
}) {
  if (!worthExtracting(incoming, reply)) return null;
  const prompt = `Speaker: ${speakerName || speakerHandle || "user"}
Speaker said: "${incoming.slice(0, 1200)}"
Amber replied: "${reply.slice(0, 600)}"

Extract persistent memory from this exchange. Return ONLY JSON:
{
  "facts": ["new factual statement about speaker, max ${MAX_NOTES_PER_TURN}"],
  "preferences": ["stated preference of speaker"],
  "entities": ["people/projects/places mentioned that are NOT the speaker"],
  "topics": ["main topic tags, 1-3"],
  "dimension": "<social | financial | intellectual | spiritual | physical | emotional>"
}

Rules:
- Facts must be NEW information — skip generic small-talk.
- Preferences are explicit or strongly implied ("I hate meetings", "I prefer short replies").
- Entities are proper nouns referenced.
- If nothing memorable, return all empty arrays.`;

  try {
    const raw = await callPerplexityLight(prompt, {
      maxTokens: 250,
      timeoutMs: 8_000,
      system:
        "You extract structured persistent memory from conversation turns. Return ONLY JSON.",
    });
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    // Normalize
    const clean = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .map((s) => String(s).trim())
        .filter((s) => s.length > 3 && s.length < 250);
    const facts = clean(parsed.facts).slice(0, MAX_NOTES_PER_TURN);
    const preferences = clean(parsed.preferences).slice(0, MAX_NOTES_PER_TURN);
    const entities = clean(parsed.entities).slice(0, 6);
    const topics = clean(parsed.topics).slice(0, 3);
    const dimension =
      [
        "social",
        "financial",
        "intellectual",
        "spiritual",
        "physical",
        "emotional",
      ].includes(parsed.dimension)
        ? parsed.dimension
        : "social";
    if (
      facts.length === 0 &&
      preferences.length === 0 &&
      entities.length === 0
    )
      return null;
    return { facts, preferences, entities, topics, dimension };
  } catch (err) {
    console.warn("[auto-memory] extract error:", err.message);
    return null;
  }
}

/**
 * Capture + persist. Fire-and-forget.
 *
 * @param {Object} opts
 * @param {string} opts.incoming       - the user's message
 * @param {string} opts.reply          - Amber's reply
 * @param {string} opts.speakerHandle  - contact handle (for profile update + attribution)
 * @param {string} [opts.speakerName]
 * @param {string} [opts.processId]    - channel tag (e.g. "dm:caleb", "group:<id>")
 * @param {Object} opts.tenant
 */
export async function captureTurnMemory({
  incoming,
  reply,
  speakerHandle,
  speakerName,
  processId,
  tenant,
}) {
  try {
    const extracted = await extractStructuredMemory({
      incoming,
      reply,
      speakerHandle,
      speakerName,
    });
    if (!extracted) return null;

    // 1. Update the contact's profile.notes with new facts + preferences
    if (speakerHandle) {
      try {
        const existing = await loadContact(speakerHandle, tenant);
        const profile = existing || {
          handle: speakerHandle,
          displayName: speakerName || speakerHandle,
          notes: [],
        };
        const now = new Date().toISOString();
        const newNotes = [
          ...extracted.facts.map((f) => ({
            fact: f,
            confidence: AUTO_MEM_CONFIDENCE,
            source: "auto_memory",
            category: "fact",
            dimensions: [extracted.dimension],
            timestamp: now,
          })),
          ...extracted.preferences.map((p) => ({
            fact: p,
            confidence: AUTO_MEM_CONFIDENCE + 0.1,
            source: "auto_memory",
            category: "preference",
            dimensions: [extracted.dimension],
            timestamp: now,
          })),
        ];
        if (newNotes.length > 0) {
          profile.notes = [...(profile.notes || []), ...newNotes].slice(-25);
          await saveContact(speakerHandle, profile, tenant);
        }
      } catch (err) {
        console.warn("[auto-memory] contact update failed:", err.message);
      }
    }

    // 2. Push to amber-id Pinecone so semantic retrieval surfaces it
    const items = [];
    for (const f of extracted.facts) {
      items.push({
        text: `${speakerName || speakerHandle}: ${f}`,
        healthDimension: extracted.dimension,
        kind: "auto_fact",
        extra: {
          entity_id: speakerHandle,
          process_id: processId || "dm",
          topics: extracted.topics,
          confidence: AUTO_MEM_CONFIDENCE,
        },
        createdAt: new Date().toISOString(),
      });
    }
    for (const p of extracted.preferences) {
      items.push({
        text: `${speakerName || speakerHandle} preference: ${p}`,
        healthDimension: extracted.dimension,
        kind: "auto_preference",
        extra: {
          entity_id: speakerHandle,
          process_id: processId || "dm",
          topics: extracted.topics,
          confidence: AUTO_MEM_CONFIDENCE + 0.1,
        },
        createdAt: new Date().toISOString(),
      });
    }
    if (items.length > 0) {
      await ingestToAmberID({
        pipe: "agent",
        phone: tenant?.phoneNumber,
        tenant,
        items,
      });
    }

    console.log(
      `[auto-memory] captured ${extracted.facts.length} facts + ${extracted.preferences.length} prefs for ${speakerHandle} (${processId || "dm"})`,
    );
    return extracted;
  } catch (err) {
    console.warn("[auto-memory] capture failed:", err.message);
    return null;
  }
}
