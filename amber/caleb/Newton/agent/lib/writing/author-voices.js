/**
 * writing/author-voices.js — author voice loader for the newsletter / ghost-
 * writing path.
 *
 * Resolution order (used by draft_in_author_voice in tools/personal-life.js):
 *   1. amber-id `/v1/personal/author-voice/:slug` — the canonical Firestore
 *      record written by `track_author_voice`. This is the path Caleb should
 *      drive once he runs `track_author_voice` for the team.
 *   2. The hardcoded SEED below — kept as a fallback so the first newsletter
 *      draft has a real Sagar voice profile even before any Firestore row
 *      exists. The seed mirrors what `track_author_voice` would write so the
 *      shape is stable across the two paths.
 *
 * The hardcoded seed is also what Tab 4 (section-templates) reaches for. Once
 * that PR lands it imports `AUTHOR_VOICE_SEED` from here so we don't fork the
 * Sagar profile across two files.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

// Slug rule must match medha-id `slugifyForId`: lowercase, hyphenated,
// stripped of non-alphanumerics, capped at 48 chars.
function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// Bundled seed for the authors Medha already knows. Extracted from Sagar's
// "Ignoring the Hype Is Its Own Kind of Edge" draft #2 (the version Shirley
// signed off on after the editorial review).
export const AUTHOR_VOICE_SEED = {
  "sagar-tiwari": {
    author_slug: "sagar-tiwari",
    display_name: "Sagar Tiwari",
    role_at_org: "BMA partner",
    org: "bma",
    voice_tells: {
      sentence_rhythm: "conviction without hedging, specific verbs, no jargon",
      vocabulary_tells:
        "specific verbs over abstract nouns; names places and people",
      // `openers` / `closers` are what writing/doctrine.js reads when
      // assembling the prompt block. `opener_patterns` / `closer_patterns`
      // are kept as aliases so Tab 11's draft tool (which reads either) keeps
      // working until the loader unifies on one name.
      openers:
        "scene-first openers ('This past March, I met Juan...'). Walks the reader into a moment before naming the argument.",
      closers:
        "personal bet ('My bet is...'). Stakes a claim instead of summarizing.",
      opener_patterns:
        "scene-first openers ('This past March, I met Juan...'). Walks the reader into a moment before naming the argument.",
      closer_patterns:
        "personal bet ('My bet is...'). Stakes a claim instead of summarizing.",
      jargon_blacklist: [
        "leverage",
        "synergy",
        "AI-powered",
        "transform",
        "unlock",
        "seamless",
        "cutting-edge",
        "state-of-the-art",
      ],
      signature_phrases: ["my bet is", "the edge is", "ignoring the hype"],
    },
    what_they_dont_say: [
      "I think maybe",
      "It could be argued",
      "in today's fast-paced world",
      "at the end of the day",
    ],
    sample_pieces: [
      {
        title: "Ignoring the Hype Is Its Own Kind of Edge",
        url: null,
        body: "",
      },
    ],
    substack_handle: null,
    linkedin_handle: null,
    source: "bundled_seed",
  },
  // Placeholder slots so callers can iterate over expected authors without
  // hitting undefined. Will be populated once Caleb / Shirley / Emily
  // contribute sample pieces.
  "caleb-newton": null,
  "shirley-park": null,
  emily: null,
};

async function fetchAuthorVoiceFromAmberId({ phone, slug }) {
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return null;
  if (!phone) return null;
  const url = `${AMBER_ID_API_URL}/v1/personal/author-voice/${encodeURIComponent(slug)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": AMBER_ID_API_KEY,
        "x-amber-phone": phone,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.author_voice || null;
  } catch {
    return null;
  }
}

/**
 * Load an author voice profile. Returns the canonical Firestore row when
 * present, otherwise the bundled seed, otherwise null. The returned object
 * carries a `source` field so the caller can disambiguate ("firestore" vs
 * "bundled_seed"). Bundled-seed responses are flagged so the agent can
 * mention that the profile is a default seed and offer to capture more
 * samples.
 */
export async function loadAuthorVoice({ phone, authorSlug }) {
  const slug = slugify(authorSlug);
  if (!slug) return null;
  const remote = await fetchAuthorVoiceFromAmberId({ phone, slug });
  if (remote) return { ...remote, source: remote.source || "firestore" };
  const seeded = AUTHOR_VOICE_SEED[slug];
  if (seeded) return { ...seeded, source: "bundled_seed" };
  return null;
}

export { slugify };

// Synchronous API used by Tab 4's writing/index.js + tools/newsletter.js.
// Returns the bundled seed profile (or null) without an amber-id round trip.
// Async Firestore-aware loader is `loadAuthorVoice` above. Both names exist
// to keep Tab 4's section-templates path and Tab 11's draft tool both green.
export const AUTHOR_VOICES = AUTHOR_VOICE_SEED;

export function getAuthorVoice(_tenant, authorSlug) {
  const slug = slugify(authorSlug);
  if (!slug) return null;
  return AUTHOR_VOICE_SEED[slug] || null;
}
