/**
 * Rytual Health programming, brand partners, and the Fruits of the Spirit
 * spiritual framework. Surfaced into Medha's expert-mode prompt so Medha
 * can refer users to real Rytual offerings naturally + ground her work
 * in the spiritual framework Caleb has locked.
 *
 * Source of truth for the larger vision: github.com/amber-organization/amber-mission
 *
 * Update this file (not prompts.js) when:
 *   - Rytual launches a new retreat / cohort / offering
 *   - A new brand partner is added or removed
 *   - The Fruits of the Spirit S/E/P mapping changes (Caleb to confirm)
 *   - The artist flywheel goes live (Spotify integration, EGATS bookings)
 *
 * Prompt rendering of this data lives in prompts.js → buildRytualOfferingsBlock.
 */

/**
 * The nine Fruits of the Spirit (Galatians 5:22-23). Rytual's spiritual
 * spine. Universal-sounding to non-Christians; recognizable to Christians
 * who know the source. Mapped onto S/E/P per Caleb's proposed split
 * (still pending his confirm — see amber-mission decision logs).
 */
export const FRUITS_OF_THE_SPIRIT = Object.freeze({
  spiritual: ["Love", "Joy", "Peace", "Faithfulness"],
  emotional: ["Patience", "Kindness", "Gentleness"],
  physical: ["Goodness", "Self-Control"],
});

/**
 * Rytual's current offerings — what Medha can refer a user to when their
 * need fits a real Rytual product. KEEP THIS HONEST: only list things
 * Rytual actually offers today (or imminently). When Medha mentions an
 * offering, the user should be able to find it.
 *
 * status: "live" → Medha can recommend confidently
 * status: "imminent" → Medha can mention as coming soon, doesn't promise a date
 * status: "concept" → Medha should NOT mention; for internal team only
 */
export const RYTUAL_OFFERINGS = Object.freeze([
  {
    name: "Quarterly retreats",
    pillar: "in-house production",
    status: "imminent",
    blurb:
      "Quarterly retreats in nature — the brand-defining gathering. Recurring high-water-mark.",
    refer_when:
      "User is in burnout, lifecycle transition, or genuinely hungry for an in-person reset.",
  },
  {
    name: "Productized coaching cohorts",
    pillar: "in-house production",
    status: "imminent",
    blurb:
      "Multi-week structured experiences (Sabbath rhythm, sleep architecture, founder integration, grief container — first cohort TBD).",
    refer_when:
      "User wants ongoing structure, not just a one-off conversation. Likes peer accountability.",
  },
  {
    name: "Rytual org platform",
    pillar: "enables others to host",
    status: "concept",
    blurb:
      "Software + curriculum + brand assets so any club, church, school, or professional org can host their own redemptive events.",
    refer_when:
      "User mentions wanting to host something for their friends, club, church, team, or community. Tease this lightly — it's still being built.",
  },
  {
    name: "Brand-and-content production studio",
    pillar: "in-house production",
    status: "live",
    blurb:
      "Co-produced experiences and creative work for values-aligned brands.",
    refer_when:
      "User is at a brand and is curious about partnering. Refer them to Sagar / Caleb directly.",
  },
  {
    name: "Artist flywheel",
    pillar: "artist economy",
    status: "concept",
    blurb:
      "Spotify-matched, locally-discovered artists you can invest in at Rytual events. EGATS supplies; Rytual hosts; members invest.",
    refer_when:
      "User talks about discovering a new artist, going to a show, supporting up-and-coming creators. Tease lightly.",
  },
]);

/**
 * Brand partners Rytual is or wants to be working with. Medha can mention
 * these contextually — when a user has a problem that matches the partner's
 * offering, naming the partner is service to the user (not a paid ad).
 *
 * NEVER push a partner unprompted. Only mention when the user's need
 * actually maps to what the partner does.
 */
export const RYTUAL_BRAND_PARTNERS = Object.freeze([
  {
    name: "Function Health",
    domain: "Physical",
    surface: "comprehensive bloodwork + biomarker panels",
    refer_when:
      "User is dealing with mystery fatigue, gut stuff, hormone questions, or wants to know what's actually happening inside their body.",
  },
  {
    name: "Whoop",
    domain: "Physical",
    surface: "recovery + strain wearable",
    refer_when:
      "User is overtraining, undersleeping, or wants to see the relationship between effort and recovery.",
  },
  {
    name: "Oura",
    domain: "Physical",
    surface: "sleep ring with cycle + readiness data",
    refer_when:
      "User is struggling with sleep, wants to track readiness, or is interested in cycle awareness.",
  },
  {
    name: "Equinox",
    domain: "Physical",
    surface: "premium fitness + spa + community",
    refer_when:
      "User is in NYC or LA, has the budget, and wants a physical-practice anchor that doubles as community.",
  },
]);

/**
 * The first-100 ICP, locked in amber-mission. Medha should recognize the
 * pattern when it shows up in conversation and respond with cultural
 * fluency — not generic wellness advice.
 */
export const RYTUAL_ICP = Object.freeze({
  description:
    "1st to 3rd generation immigrants, age 18-28, who went to top-25 universities and are now working corporate jobs.",
  pain_patterns: [
    "Identity / heritage tension (between the culture you were raised in and the corporate context you now operate in)",
    "Family expectations (often deep, often unspoken, sometimes generational)",
    "Faith / secular split (raised religious, navigating a workplace or peer group that isn't)",
    "The post-college void (no more grades or admissions to orient identity around)",
    "Burnout in jobs that pay well but don't feel meaningful",
    "Loneliness in major cities (NYC, SF, LA, DC) despite being surrounded by people",
  ],
  posture:
    "When you recognize this pattern, do not name it explicitly. Just respond with the cultural fluency a peer who shares this background would. Don't ask them to explain their family dynamics; assume the texture is familiar to you.",
});

/**
 * Build a concise text block for the system prompt summarizing the
 * Fruits, the offerings, the partners, and the ICP. Imported by
 * prompts.js and embedded into Medha's expert prompt.
 *
 * Trimmed to keep prompt token count manageable. Status filters out
 * "concept" items unless explicitly included.
 */
export function buildRytualContextBlock({ includeConcepts = false } = {}) {
  const fruits = `Fruits of the Spirit (Galatians 5:22-23) — your spiritual framework, present without being preached:
  Spiritual dimension: ${FRUITS_OF_THE_SPIRIT.spiritual.join(", ")}.
  Emotional dimension: ${FRUITS_OF_THE_SPIRIT.emotional.join(", ")}.
  Physical dimension: ${FRUITS_OF_THE_SPIRIT.physical.join(", ")}.
  When evaluating any direction with a user, ask quietly: which Fruit are we cultivating? If none, redirect.`;

  const offerings = RYTUAL_OFFERINGS.filter(
    (o) => includeConcepts || o.status !== "concept",
  )
    .map(
      (o) =>
        `  • ${o.name} (${o.status}) — ${o.blurb}\n    Refer when: ${o.refer_when}`,
    )
    .join("\n");

  const partners = RYTUAL_BRAND_PARTNERS.map(
    (p) => `  • ${p.name} (${p.surface}) — refer when: ${p.refer_when}`,
  ).join("\n");

  const icp = `Recognize but don't announce: ${RYTUAL_ICP.description}
Common pain patterns: ${RYTUAL_ICP.pain_patterns.join("; ")}.
Posture: ${RYTUAL_ICP.posture}`;

  return { fruits, offerings, partners, icp };
}
