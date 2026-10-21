/**
 * Capability registry: auto-generates the CAPABILITIES block for system prompts.
 * Every module registers what it can do. The prompt builder reads from here.
 *
 * Caleb 2026-05-26: 'capabilities.js should not have anything hard coded.
 * We are going to keep changing and adding things over time so it should
 * be more dynamic.' The old hardcoded 'you do NOT have Calendar / GitHub /
 * Beads' lines are gone. OAuth availability is now computed per-request
 * from the live secrets bag via connections-discovery.js and threaded in
 * via the `connections` parameter to buildCapabilitiesBlock.
 */

import { renderConnectionsLines } from "./connections-discovery.js";

// Registry: category -> list of capability descriptions
const registry = new Map();

/**
 * Register a capability. Call this from any module at import time.
 * @param {string} category - Grouping label (e.g., "Search", "Health")
 * @param {string|string[]} descriptions - What this capability does
 */
export function registerCapability(category, descriptions) {
  const existing = registry.get(category) || [];
  const items = Array.isArray(descriptions) ? descriptions : [descriptions];
  registry.set(category, [...existing, ...items]);
}

/**
 * Build the CAPABILITIES block for a system prompt.
 * @param {object} options - { isCaleb, isGroup, hasTools, connections }
 *   connections: array from discoverConnections(tenant). Empty array or
 *   undefined is fine — the connections section just gets skipped.
 * @returns {string} Formatted capabilities text
 */
export function buildCapabilitiesBlock({
  isCaleb = false,
  isGroup = false,
  hasTools = false,
  connections = null,
} = {}) {
  void isGroup;
  if (registry.size === 0 && (!connections || connections.length === 0)) {
    return "";
  }

  const lines = ["CAPABILITIES (auto-discovered):"];

  for (const [category, items] of registry) {
    if (category.startsWith("_caleb_") && !isCaleb) continue;
    if (category.startsWith("_tools_") && !hasTools) continue;

    const label = category.replace(/^_caleb_|^_tools_/, "");
    for (const item of items) {
      lines.push(`- ${label}: ${item}`);
    }
  }

  // Per-tenant OAuth connection state. Live lookup; not cached at the
  // module level so newly-connected services show up immediately.
  for (const line of renderConnectionsLines(connections)) {
    lines.push(line);
  }

  // Honesty clamp — only the rules that DON'T depend on per-user state.
  // Anything platform-specific lives in the dynamic block above.
  lines.push("");
  lines.push("CAPABILITY HONESTY:");
  lines.push(
    "When a user asks what you can do, list ONLY items from CAPABILITIES above (and YOUR OWN TOOLS AND SYSTEMS if that block is also present). Never invent.",
  );
  lines.push(
    "For OAuth services in USER OAUTH CONNECTIONS above: if connected, use the tool with the real data; if not connected, attempt the tool and relay its connect-link 'message' verbatim. Never claim you can't do calendars / email / Slack in general — the user just hasn't linked the account yet.",
  );

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

/**
 * Medha / Togari ownership table. Sagar's canonical boundary spec
 * (Tab 14 dispatch, 2026-05-28; supersedes Tab 1 from 2026-05-27).
 * Rendered into every system-prompt context (expert, owner-DM, group)
 * so the model has the same rule wherever Medha replies.
 *
 * Failure-mode history that motivated this block:
 *   1. Sagar: "@Medha show me my active content pipeline"
 *      Medha: "That's Togari's lane. BMA content pipeline lives in
 *      their CRM. Text +1 (555) 010-0003..."  ← WRONG
 *      Sagar's correction: content is creative work; the delivery of
 *      creative work belongs in Medha. Only BMA-agency-CLIENT
 *      deliverables would route to Togari.
 *
 *   2. Sagar: "@Medha please add a planning session by Wednesday to
 *      review how to talk with potential Rytual investor Jared Jamin"
 *      Medha: "That's solidly in Togari's lane, investor prep,
 *      pipeline strategy..."  ← WRONG
 *      Sagar's one-liner: "customer = toges, investor = medha."
 *
 * The single rule to memorize: customer = Togari, everything else
 * relational (creative, events, community, investor, journal,
 * partnership, health) = Medha.
 */
const MEDHA_OWNS = [
  "Creative work in any form: content, art, music, design, brand voice (Rytual brand, BMA brand voice, the 'rave' newsletter, personal posts, anyone's creative output)",
  "Events and community building, end-to-end conversation: booking talk, invite drafts, attendee coordination, logistics, food, transport, activities, facilitators, art, content prep, payment talk, post-event reflection",
  "Investor outreach and relationships: founder narrative, brand-and-trust dynamics, pitch-meeting prep, donor management, investor follow-ups (the human side of fundraising, not the deal-flow CRM)",
  "Personal journal: free-form reflection, creative conversations Sagar has with the girls, ideas-in-other-people's-heads, dreams, friendships",
  "Health and personal life (S/E/P + community-as-embodied-logistics): spiritual, emotional, physical dimensions, plus retreats, weddings, raves, festivals that serve those dimensions",
  "Partnerships of any non-customer kind: enterprise partners (Perplexity / Alex Tsai), advisors, anyone the user wants in their orbit who isn't a sales target",
  "Teammates' creative pursuits: what Shirley / Alinna / Emily / anyone in the user's life is making, how the user can support them",
  "Brand identity decisions: names, taglines, voice, color (Rytual, Medha, personal brand)",
  "Auto-identify a known person across channels (Slack sender by email -> contact / DID match)",
];

const TOGARI_OWNS = [
  "Customer pipeline / sales CRM: prospect tracking, deal pipeline, sales contracts, BMA customer activity",
  "Professional / transactional B2B with sales targets: contract negotiation, vendor management, billing",
  "PeopleRank for sales targets: the ranked outreach lists for BMA sales",
  "BMA agency-CLIENT deliverables (work delivered to a paying agency client). NOTE: BMA's own internal brand voice / content stays with Medha; only the work delivered to a third-party client routes here.",
];

const LANE_RULE_ONE_LINER =
  'Sagar\'s one-liner rule: "customer = Togari, investor = Medha." Generalize from there: if the question is about a RELATIONSHIP (with anyone: friend, founder, investor, advisor, contractor, family, teammate), it is Medha. If it is about a TRANSACTION with a SALES TARGET, it is Togari.';

const ANTI_FAILURE_MODES = [
  '"show me my active content pipeline" -> Medha. Content default is creative/personal/Rytual unless the user explicitly names a BMA agency client. Do NOT reflexively route "content" to Togari.',
  '"add a planning session to talk with potential investor X" -> Medha. Investor prep is the human side of fundraising; that is Medha\'s lane. Do NOT route to Togari.',
  '"track that we are building enterprise partnership with Perplexity" -> Medha. Partnerships that are not customer-pipeline are relational, not transactional. Do NOT route to Togari.',
  '"track teammates\' creative work" / "what is Shirley working on" -> Medha. Teammates\' personal creative pursuits live here, never Togari.',
  '"show my BMA customer pipeline" -> Togari. This is the only shape that routes off. The user must explicitly name customers / sales / CRM / outbound to trigger handoff.',
];

export function buildOwnershipBlock() {
  const medhaLines = MEDHA_OWNS.map((s) => `- ${s}`).join("\n");
  const togariLines = TOGARI_OWNS.map((s) => `- ${s}`).join("\n");
  const antiLines = ANTI_FAILURE_MODES.map((s) => `- ${s}`).join("\n");
  return `OWNERSHIP TABLE (Sagar's canonical boundary spec). Use this to decide whether to engage or defer.

${LANE_RULE_ONE_LINER}

MEDHA OWNS (engage on the merits, do NOT deflect to Togari):
${medhaLines}

TOGARI OWNS (and ONLY these. Defer to Togari at +1 (555) 010-0003 when the ask clearly matches):
${togariLines}

DEFAULT WHEN AMBIGUOUS: Medha. The bar for routing to Togari is "the user explicitly named a sales / customer / CRM / outbound / agency-client surface." Words like "content", "pipeline", "investor", "partnership", "events", "journal", "creative" default to Medha, never Togari, unless the BMA-customer framing is explicit.

ANTI-FAILURE-MODE EXAMPLES (these have all happened in production. Do not repeat them.):
${antiLines}

CANONICAL SOURCE (Sagar, paraphrased): "The delivery of events and creative work (human-centric, not AI) is documented through Medha. Tracking teammates' own creative pursuits and how to best support them lives here. Ideas that exist in the heads of other people are what Medha comments on. Medha is the canvas for yapping about creative conversations, like a journal. Events and community building are where the creative conversations bear collective fruit. Customer = Togari, investor = Medha."

When a request touches a MEDHA OWNS category, engage. Do NOT redirect to Togari just because the topic brushes against money, content, or strategy. Only redirect when the ask unambiguously names BMA's sales pipeline, BMA's CRM, BMA's outbound, or a deliverable for a third-party BMA agency client.`;
}

// ── Core capabilities (Tiwari architecture) ─────────────────────────────
registerCapability(
  "Search",
  "Exa web search (real-time data, entity lookup, similar pages)",
);
registerCapability(
  "Context",
  "Perplexity AI (sonar-pro for conversation, sonar for background, deep research, embeddings)",
);
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
