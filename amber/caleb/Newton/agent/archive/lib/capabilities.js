/**
 * Capability registry: auto-generates the CAPABILITIES block for system prompts.
 * Every module registers what it can do. The prompt builder reads from here.
 * No more manually updating prompts.js when capabilities change.
 */

// Registry: category -> list of capability descriptions
const registry = new Map();

/**
 * Register a capability. Call this from any module at import time.
 * @param {string} category - Grouping label (e.g., "Search", "Gmail", "Health")
 * @param {string|string[]} descriptions - What this capability does
 */
export function registerCapability(category, descriptions) {
  const existing = registry.get(category) || [];
  const items = Array.isArray(descriptions) ? descriptions : [descriptions];
  registry.set(category, [...existing, ...items]);
}

/**
 * Build the CAPABILITIES block for a system prompt.
 * @param {object} options - { isCaleb, isGroup, hasTools }
 * @returns {string} Formatted capabilities text
 */
export function buildCapabilitiesBlock({
  isCaleb = false,
  isGroup = false,
  hasTools = false,
} = {}) {
  if (registry.size === 0) return "";

  const lines = ["CAPABILITIES (auto-discovered):"];

  for (const [category, items] of registry) {
    // Some capabilities are Caleb-only
    if (category.startsWith("_caleb_") && !isCaleb) continue;
    if (category.startsWith("_tools_") && !hasTools) continue;

    const label = category.replace(/^_caleb_|^_tools_/, "");
    for (const item of items) {
      lines.push(`- ${label}: ${item}`);
    }
  }

  return lines.join("\n");
}

/**
 * Get all registered capabilities for the status endpoint.
 */
export function getRegisteredCapabilities() {
  const result = {};
  for (const [category, items] of registry) {
    result[category] = items;
  }
  return result;
}

// ── Core capabilities (always available) ─────────────────────────────────
registerCapability(
  "Health",
  "Track 6 dimensions of health for every contact (Social, Financial, Intellectual, Spiritual, Physical, Emotional)",
);
registerCapability(
  "Health",
  "Daily check-ins, trend analysis, proactive nudges for low dimensions",
);
registerCapability(
  "Health",
  "Reflection engine consolidates personality, mood, interests every 4 hours",
);
registerCapability(
  "Relationships",
  "Per-contact profiles with trust scores, personality, communication style",
);
registerCapability(
  "Relationships",
  "Proactive reconnection for contacts gone silent (with unanswered tracking)",
);
registerCapability(
  "Relationships",
  "Group-level persistent memory (topics, decisions, vibe)",
);
registerCapability(
  "Memory",
  "Conversation compression for long chats (80%+ token savings)",
);
registerCapability("Memory", "Semantic search via Perplexity embeddings");
registerCapability("Memory", "Contact learning from every conversation");
registerCapability(
  "Personality",
  "Adaptive modes: professional, casual, spiritual, supportive",
);
registerCapability(
  "iMessage",
  "Effects: balloons, confetti, fireworks, love, echo, spotlight, lasers, slam, loud, gentle, invisibleInk, celebration",
);
registerCapability(
  "iMessage",
  "Tapback reactions (heart, thumbs up, laugh, exclamation, question)",
);
registerCapability(
  "iMessage",
  "Segmented replies for long messages (multiple bubbles)",
);
registerCapability("Security", "Prompt injection defense for group chats");
registerCapability(
  "Security",
  "Message safety filtering (AI identity leak prevention)",
);
