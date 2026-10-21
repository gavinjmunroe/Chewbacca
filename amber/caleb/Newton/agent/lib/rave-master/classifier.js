/**
 * Deterministic, pre-LLM classifier for inbound rave/event messages.
 *
 * Maps a free-form text to one of the canonical event slots so the
 * event-card update logic doesn't have to re-parse natural language.
 * Returns `null` when nothing event-relevant is detected — callers
 * should fall through to default handling.
 *
 * Slot taxonomy (matches the event-card object from the build brief):
 *   - ticket
 *   - payment
 *   - meetup
 *   - transport
 *   - lodging
 *   - supply
 *   - safety
 *   - music    (set times / lineup choices)
 *
 * Substance mentions are NOT classified as event slots. They are flagged
 * separately (`isSubstanceContext`) so callers can route them into the
 * existing harm-reduction path in lib/festival.js. The classifier never
 * helps with sourcing, dosing, or procurement — see guardrails.js.
 */

const PATTERNS = [
  { slot: "ticket",   re: /\b(ticket|wristband|gate|stub(?:hub)?|will[-\s]?call|3-day|ga\b|vip|seller|extra ticket|need a ticket|sold (it )?to)/i },
  { slot: "payment",  re: /\b(venmo|zelle|cash\s*app|paypal|split (the )?bill|owe|owes|pay (me|you|him|her|us|them)|\$\s?\d{2,5}|paid|payment|reimburs)/i },
  { slot: "meetup",   re: /\b(meet (?:up|at|by|near)|meeting (?:at|by|near)|rally point|pin (?:dropped|drop)|where (?:are|r) (?:you|u|y'?all)|find (?:us|me)|come to (?:my|the)|same place|north brown|south brown|nb\d|circuit grounds|kinetic field|main stage|water station|stage pole|pole at|yellow star|sky vodka|daisy lane)/i },
  { slot: "transport", re: /\b(uber|lyft|rideshare|driving|drove|car (?:meet|pickup|pool)|car ?pool|shuttle|airport|parking|hotel shuttle|leaving (?:at|in)|pickup at|drop (?:me|us) off|ride home|driver)/i },
  { slot: "lodging",  re: /\b(airbnb|hotel|room|check[\s-]?in|check[\s-]?out|address is|the host|key code|knock(?:ing)? at the door|do not answer|stay over|crash(?:ing)? (?:at|here)|air ?mattress)/i },
  { slot: "supply",   re: /\b(kandi|earplugs?|sunscreen|water bottle|hydration|backpack|fanny pack|hand fan|totem|outfit|energy drink|red ?bull|gum\b|advil|tylenol|charger|battery pack|portable charger)/i },
  { slot: "safety",   re: /\b(lost (?:her|him|them|the group)|can'?t find|separated|left (?:my|the) phone|no service|wi-?fi|battery (?:dead|died)|emergency|got hurt|injured|bleeding|panic attack|need help|stuck at|cops|security|stranger|sketchy|do not answer|tell (?:the )?host)/i },
  { slot: "music",    re: /\b(set time|set times|lineup|line[-\s]?up|excision|gryffin|fisher|illenium|deadmau5|kaskade|tiesto|going to see|playing at|b2b|aftershow|afters|stage swap|head to (?:the )?(?:main|kinetic|circuit|neon))/i },
];

// Substance / drug context. We do NOT treat this as an event slot — it
// is only useful as safety context. Procurement / dosing intent is a
// separate guardrail check in guardrails.js.
const SUBSTANCE_RE = /\b(mdma|molly|ecstasy|rolling|rolled|lsd|acid|tabs?|shrooms?|mushies|psilocybin|ket(?:amine)?|special k|coke|cocaine|blow|ghb|gbl|2c-?[bicd]|dmt|adderall|addy|xan(?:s|ax)?|benzos?|meth|dose|dosing|micro-?dose|re-?dose|popped a (?:tab|cap|pill))\b/i;

export function classifyEventMessage(text) {
  if (!text || typeof text !== "string") return null;
  const matches = [];
  for (const { slot, re } of PATTERNS) {
    if (re.test(text)) matches.push(slot);
  }
  const isSubstance = SUBSTANCE_RE.test(text);
  if (matches.length === 0 && !isSubstance) return null;

  return {
    slots: matches,           // ordered by PATTERNS declaration
    primary: matches[0] || null,
    isSubstanceContext: isSubstance,
    text: text.slice(0, 500), // bounded evidence snippet
  };
}

// Exported so reconciliation can use the same slot vocabulary.
export const EVENT_SLOTS = [
  "ticket",
  "payment",
  "meetup",
  "transport",
  "lodging",
  "supply",
  "safety",
  "music",
];
