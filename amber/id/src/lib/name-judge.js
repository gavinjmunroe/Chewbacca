/**
 * Claude phonetic judge for name reconciliation.
 *
 * The algorithmic matcher (Soundex + skeleton + edit distance) casts a wide net;
 * this judge does the "trained, not hardcoded" part: it uses a model already
 * trained on the world's names to decide which candidates could be the SAME
 * spoken name across accents and cultural spellings (soft G = J, PH = F, C = K/S,
 * dropped/added vowels, nicknames, and how Indian, East Asian, African, Latin
 * American, Middle Eastern, and European names sound aloud). It generalizes to
 * names nobody wrote a rule for.
 *
 * FAIL-OPEN: on any error / no key, returns the candidate ids unchanged, so the
 * card still shows the algorithmic matches. Results are cached (15 min) keyed by
 * the spoken name + candidate set, so the polled feed endpoint doesn't re-call.
 */

const _ANTHRO_URL = "https://api.anthropic.com/v1/messages";
const _JUDGE_MODEL = process.env.NAME_JUDGE_MODEL || "claude-haiku-4-5-20251001";
const _TTL_MS = 15 * 60 * 1000;
// Bounded. A Map that only ever gets `set` is a slow leak in a long-lived
// process, and this one is keyed by (spoken name + candidate set), which is
// effectively unbounded across a multi-tenant server. Insertion order is FIFO in
// a JS Map, so evicting from the front drops the oldest key.
const _CACHE_MAX = 2000;
const _cache = new Map(); // key -> { ids: string[], exp: number }

function _cacheSet(key, value) {
  // Re-inserting must move the key to the back, or a hot key ages out first.
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > _CACHE_MAX) {
    const oldest = _cache.keys().next();
    if (oldest.done) break;
    _cache.delete(oldest.value);
  }
}

const _SYSTEM = [
  "You match a NAME the user said aloud (transcribed from voice, so the spelling may be wrong) to their saved contacts.",
  "Decide which contacts could plausibly be the SAME name, judging by SOUND, not spelling.",
  "Account for phonetic equivalents (soft G = J like Angelica/Anjelica, PH = F, C = K or S, X = Z, K = Q, silent letters, doubled letters),",
  "dropped or added vowels (Maya/Mya), common nicknames, and ESPECIALLY how names from different cultures",
  "(Indian, East Asian, African, Latin American, Middle Eastern, European) sound when spoken in different accents.",
  "Include genuine sound-alikes generously, but exclude names that only share a first letter and clearly sound different.",
  "Return ONLY a JSON array of the matching contact ids, most-likely first. Return [] if none plausibly match.",
].join(" ");

/**
 * @param {object} a
 * @param {string} a.spoken            the transcribed spoken name
 * @param {Array<{id:string,name:string}>} a.candidates  the algorithmic pool
 * @returns {Promise<string[]>} ranked subset of candidate ids (fail-open: all ids)
 */
export async function judgeNameMatches({ spoken, candidates, fetchImpl = globalThis.fetch } = {}) {
  const list = Array.isArray(candidates)
    ? candidates.filter((c) => c && c.id != null && c.name)
    : [];
  const fallback = list.map((c) => String(c.id));
  // Nothing to disambiguate.
  if (!spoken || list.length < 2) return fallback;

  const key = String(spoken).toLowerCase().trim() + "|" + fallback.slice().sort().join(",");
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.exp > now) return hit.ids;
  if (hit) _cache.delete(key);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || typeof fetchImpl !== "function") return fallback;

  try {
    const user =
      `Spoken name: "${spoken}"\nContacts:\n` +
      list.map((c) => `${c.id}: ${c.name}`).join("\n") +
      `\nJSON array of matching ids:`;
    const resp = await fetchImpl(_ANTHRO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: _JUDGE_MODEL,
        max_tokens: 200,
        temperature: 0,
        system: _SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return fallback;
    const raw = (await resp.json())?.content?.[0]?.text?.trim() || "";
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return fallback;
    let ids;
    try {
      ids = JSON.parse(m[0]);
    } catch {
      return fallback;
    }
    if (!Array.isArray(ids)) return fallback;
    // Never invent ids: keep only ones from the candidate set, as strings.
    const allow = new Set(fallback);
    const ranked = ids.map(String).filter((id) => allow.has(id));
    // A successful, valid response is authoritative even if it pruned everything
    // (that means the pool was all noise) — cache and return it.
    _cacheSet(key, { ids: ranked, exp: now + _TTL_MS });
    return ranked;
  } catch {
    return fallback;
  }
}
