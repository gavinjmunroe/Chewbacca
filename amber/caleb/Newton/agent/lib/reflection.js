/**
 * Periodic reflection engine: consolidates what Amber has learned about each contact.
 * Inspired by CyberGroupmate's reflection engine pattern.
 *
 * Runs on a schedule (every 4 hours). For each active contact:
 * - Reviews recent conversation history
 * - Extracts personality traits, communication style, interests
 * - Updates contact profile with consolidated insights
 * - Decays stale facts and boosts confirmed ones
 */

import { callPerplexityLight } from "./tiwari/context.js";
import {
  PERPLEXITY_API_KEY,
  AMBER_ID_API_URL,
  AMBER_ID_API_KEY,
  HEALTH_DIMS,
} from "./constants.js";
import { sbQuery } from "./data.js";
import { saveHealthCheckin } from "./health.js";
import {
  loadContact,
  saveContact,
  loadConversationHistory,
} from "./contacts.js";

const REFLECTION_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const MIN_MESSAGES_FOR_REFLECTION = 5;

/**
 * Run reflection across all recently active contacts.
 */
export async function runReflectionCycle(tenant = null) {
  if (!PERPLEXITY_API_KEY || !AMBER_ID_API_URL || !AMBER_ID_API_KEY) {
    console.log("[reflection] Skipping: missing Perplexity or amber-id config");
    return;
  }

  console.log("[reflection] Starting reflection cycle...");
  const startTime = Date.now();

  try {
    // Get recently active contacts (interacted in last 24h)
    const recentInteractions = await sbQuery(
      "interactions",
      "created_at=gte." +
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      { limit: 50, order: "created_at.desc", tenant },
    );

    // Deduplicate by handle
    const uniqueHandles = [
      ...new Set(recentInteractions.map((i) => i.from_handle).filter(Boolean)),
    ];

    console.log(
      `[reflection] ${uniqueHandles.length} active contact(s) to reflect on`,
    );

    let updated = 0;
    for (const handle of uniqueHandles.slice(0, 10)) {
      try {
        const didUpdate = await reflectOnContact(handle, tenant);
        if (didUpdate) updated++;
      } catch (err) {
        console.warn(`[reflection] Failed for ${handle}:`, err.message);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[reflection] Done: ${updated} profiles updated in ${elapsed}s`,
    );
  } catch (err) {
    console.error("[reflection] Cycle failed:", err.message);
  }
}

/**
 * Reflect on a single contact: review their conversations and consolidate insights.
 */
async function reflectOnContact(handle, tenant = null) {
  const contact = await loadContact(handle, tenant);
  if (!contact || contact.isCaleb) return false;

  // Load their DM history
  const dmHistory = await loadConversationHistory(`dm:${handle}`, tenant);
  if (dmHistory.length < MIN_MESSAGES_FOR_REFLECTION) return false;

  // Build a conversation summary for reflection
  const recentMessages = dmHistory.slice(-20);
  const transcript = recentMessages
    .map((m) => {
      const label =
        m.role === "assistant" ? "Amber" : contact.displayName || handle;
      return `${label}: ${m.content}`;
    })
    .join("\n");

  const existingNotes = (contact.notes || [])
    .map((n) => (typeof n === "object" ? n.fact : n))
    .join("; ");

  try {
    // Perplexity Sonar (via callPerplexityLight) for background reflection
    const raw = await callPerplexityLight(
      `You are reflecting on what Amber (an AI agent) has learned about a contact from their recent conversations.

CONTACT: ${contact.displayName || handle}
RELATIONSHIP: ${contact.relationship || "unknown"}
EXISTING NOTES: ${existingNotes || "none"}
TRUST SCORE: ${contact.trustScore || 0.5}

RECENT CONVERSATION:
${transcript}

Analyze this person across the 6 DIMENSIONS OF HEALTH (social, financial, intellectual, spiritual, physical, emotional):
1. Communication style (formal/casual, emoji usage, verbosity, humor)
2. Personality traits (extrovert/introvert, optimistic/pragmatic, etc.)
3. Current life situation mapped to health dimensions (which are strong/weak?)
4. Relationship with Caleb (how close, what they bond over)
5. Any facts that should be updated or removed (outdated info)

Return JSON:
{
  "personality_summary": "2-3 sentence personality snapshot",
  "communication_style": "how they text (brief description)",
  "current_mood": "their general emotional state lately",
  "interests": ["list", "of", "interests"],
  "health_signals": {"social": 7, "emotional": 5},
  "updated_notes": [
    {"fact": "consolidated fact", "confidence": 0.9, "dimensions": ["social"], "source": "reflection"}
  ],
  "stale_notes": ["facts from existing notes that seem outdated or wrong"],
  "trust_adjustment": 0.0
}`,
      { maxTokens: 600, timeoutMs: 20_000 },
    );

    if (!raw) return false;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return false;

    const reflection = JSON.parse(jsonMatch[0]);

    // Apply reflection to contact profile
    let changed = false;

    if (reflection.personality_summary) {
      contact.personality_summary = reflection.personality_summary;
      changed = true;
    }

    if (reflection.communication_style) {
      contact.communication_style = reflection.communication_style;
      changed = true;
    }

    if (reflection.current_mood) {
      contact.current_mood = reflection.current_mood;
      changed = true;
    }

    if (
      Array.isArray(reflection.interests) &&
      reflection.interests.length > 0
    ) {
      contact.interests = reflection.interests.slice(0, 10);
      changed = true;
    }

    // Remove stale notes
    if (
      Array.isArray(reflection.stale_notes) &&
      reflection.stale_notes.length > 0
    ) {
      const staleSet = new Set(
        reflection.stale_notes.map((s) => s.toLowerCase()),
      );
      const before = (contact.notes || []).length;
      contact.notes = (contact.notes || []).filter((n) => {
        const fact = (typeof n === "object" ? n.fact : n).toLowerCase();
        return !staleSet.has(fact);
      });
      if (contact.notes.length < before) {
        console.log(
          `   [reflection] Removed ${before - contact.notes.length} stale note(s) for ${handle}`,
        );
        changed = true;
      }
    }

    // Add consolidated notes
    if (Array.isArray(reflection.updated_notes)) {
      const existingFacts = new Set(
        (contact.notes || []).map((n) =>
          (typeof n === "object" ? n.fact : n).toLowerCase(),
        ),
      );
      const newNotes = reflection.updated_notes
        .filter((n) => n.fact && !existingFacts.has(n.fact.toLowerCase()))
        .map((n) => ({
          ...n,
          timestamp: new Date().toISOString(),
        }));
      if (newNotes.length > 0) {
        contact.notes = [...(contact.notes || []), ...newNotes].slice(0, 20);
        console.log(
          `   [reflection] Added ${newNotes.length} consolidated note(s) for ${handle}`,
        );
        changed = true;
      }
    }

    // Trust adjustment
    if (
      typeof reflection.trust_adjustment === "number" &&
      reflection.trust_adjustment !== 0
    ) {
      contact.trustScore = Math.min(
        1,
        Math.max(0, (contact.trustScore || 0.5) + reflection.trust_adjustment),
      );
      changed = true;
    }

    // Health dimension signals: save as a check-in from reflection
    if (
      reflection.health_signals &&
      typeof reflection.health_signals === "object"
    ) {
      const validScores = {};
      for (const dim of HEALTH_DIMS) {
        const val = reflection.health_signals[dim];
        if (typeof val === "number" && val >= 0 && val <= 10) {
          validScores[dim] = val;
        }
      }
      if (Object.keys(validScores).length > 0) {
        saveHealthCheckin(
          handle,
          validScores,
          "reflection",
          "periodic reflection",
        ).catch(() => {});
        console.log(
          `   [reflection] Health signals for ${contact.displayName || handle}: ${JSON.stringify(validScores)}`,
        );
      }
    }

    if (changed) {
      contact._lastReflectionAt = Date.now();
      await saveContact(handle, contact, tenant);
      console.log(
        `   [reflection] Updated profile for ${contact.displayName || handle}`,
      );
    }

    return changed;
  } catch (err) {
    console.warn(`[reflection] Reflect failed for ${handle}:`, err.message);
    return false;
  }
}

/**
 * Start the reflection engine on a timer.
 */
export function startReflectionEngine() {
  console.log(
    `[reflection] Engine started (interval: ${REFLECTION_INTERVAL / 1000 / 60}min)`,
  );
  // Run first reflection after 5 minutes (let the agent warm up)
  setTimeout(
    () => {
      runReflectionCycle();
      setInterval(runReflectionCycle, REFLECTION_INTERVAL);
    },
    5 * 60 * 1000,
  );
}
