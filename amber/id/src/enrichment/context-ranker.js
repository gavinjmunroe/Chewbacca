/**
 * Context ranker — PURE (no DB, no network), so it unit-tests offline.
 *
 * Design principle: RANK, DON'T FILTER. scoreCandidate produces a soft overlap
 * score with explainable signals; rankCandidates returns the FULL ranked array
 * (never truncated) and only decides auto/ambiguous/none. Low-overlap people
 * are ranked last, never dropped.
 */

// Tunable weights (named consts).
export const WEIGHTS = {
  SAME_CITY: 2,
  SAME_STATE: 1,
  SAME_SCHOOL: 1.5,
  EMPLOYER_OVERLAP: 1.5,
  AREA_CODE_REGION: 0.5,
};
// Auto-resolve thresholds.
export const MIN_AUTO = 2;
export const GAP = 1.5;

// Best-effort, extensible hint maps (lowercased keys → 2-letter state).
const CITY_STATE = {
  chicago: "il",
  "new york": "ny",
  brooklyn: "ny",
  "san francisco": "ca",
  "los angeles": "ca",
  "san diego": "ca",
  seattle: "wa",
  boston: "ma",
  austin: "tx",
  dallas: "tx",
  houston: "tx",
  denver: "co",
  miami: "fl",
  atlanta: "ga",
  philadelphia: "pa",
};
const AREA_CODE_STATE = {
  // Chicago / IL
  "312": "il", "773": "il", "872": "il", "847": "il", "630": "il", "708": "il",
  // NYC / NY
  "212": "ny", "646": "ny", "917": "ny", "718": "ny", "347": "ny",
  // CA
  "415": "ca", "628": "ca", "310": "ca", "213": "ca", "619": "ca", "408": "ca",
  // WA / MA / TX / others
  "206": "wa", "617": "ma", "512": "tx", "214": "tx", "713": "tx",
  "303": "co", "305": "fl", "404": "ga", "215": "pa",
};
const STATE_NAME_TO_ABBR = {
  illinois: "il", "new york": "ny", california: "ca", washington: "wa",
  massachusetts: "ma", texas: "tx", colorado: "co", florida: "fl",
  georgia: "ga", pennsylvania: "pa",
};

function _norm(s) {
  return typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : "";
}
function _addToken(set, v) {
  const n = _norm(v);
  if (n) set.add(n);
}
function _addMany(set, arr) {
  if (Array.isArray(arr)) for (const v of arr) _addToken(set, v);
}
// Normalize a state to a 2-letter abbrev where possible.
function _stateAbbr(s) {
  const n = _norm(s);
  if (!n) return "";
  if (n.length === 2) return n;
  return STATE_NAME_TO_ABBR[n] || n;
}

/**
 * Build the owner's context prior from their profile. Accepts the merged
 * users-columns object (currentCity/hometown/school/occupation) and profile
 * overflow — either nested under profileExtra/profile_extra or flattened onto
 * the same object (placesLived[], schools[], almaMater, employers[]).
 * Returns { cities:Set, schools:Set, employers:Set } (all lowercased).
 */
export function buildUserPrior(profile = {}) {
  const p = profile || {};
  const ex = p.profileExtra || p.profile_extra || p;
  const cities = new Set();
  const schools = new Set();
  const employers = new Set();

  _addToken(cities, p.currentCity ?? p.current_city);
  _addToken(cities, p.hometown);
  _addMany(cities, ex.placesLived);

  _addToken(schools, p.school);
  _addToken(schools, ex.almaMater ?? ex.alma_mater);
  _addMany(schools, ex.schools);

  _addToken(employers, p.occupation);
  _addMany(employers, ex.employers);

  return { cities, schools, employers };
}

/**
 * Best-effort US region (2-letter state) from a contact's phone area code.
 * Reads contact.phone and contact.phoneNumbers[]. Returns null when unknown.
 */
export function contactRegionHint(contact = {}) {
  const phones = [];
  if (contact.phone) phones.push(contact.phone);
  if (Array.isArray(contact.phoneNumbers)) phones.push(...contact.phoneNumbers);
  for (const ph of phones) {
    let d = String(ph).replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (d.length === 10) {
      const ac = d.slice(0, 3);
      if (AREA_CODE_STATE[ac]) return AREA_CODE_STATE[ac];
    }
  }
  return null;
}

/**
 * Soft overlap score for one candidate against the prior + contact.
 * Returns { score:number, signals:[{signal, weight}] }.
 */
export function scoreCandidate(candidate, prior, contact = {}) {
  const signals = [];
  let score = 0;
  const add = (signal, weight) => {
    signals.push({ signal, weight });
    score += weight;
  };

  const cities = prior?.cities ?? new Set();
  const schools = prior?.schools ?? new Set();
  const employers = prior?.employers ?? new Set();

  const city = _norm(candidate?.city);
  const state = _stateAbbr(candidate?.state);
  const company = _norm(candidate?.company);
  const school = _norm(candidate?.school ?? candidate?.raw?.school);

  if (city && cities.has(city)) add("same_city", WEIGHTS.SAME_CITY);

  // User states derived from prior cities (soft hint).
  const userStates = new Set();
  for (const c of cities) if (CITY_STATE[c]) userStates.add(CITY_STATE[c]);
  if (state && userStates.has(state)) add("same_state", WEIGHTS.SAME_STATE);

  if (school && schools.has(school)) add("same_school", WEIGHTS.SAME_SCHOOL);
  if (company && employers.has(company)) add("employer_overlap", WEIGHTS.EMPLOYER_OVERLAP);

  const region = contactRegionHint(contact);
  if (region && state && state === region) add("area_code_region", WEIGHTS.AREA_CODE_REGION);

  return { score, signals };
}

/**
 * Rank all candidates (desc by score; stable tiebreak on input order) and
 * decide resolution. ALWAYS returns the full `ranked` array (never truncated —
 * it is the stored candidate list on 'ambiguous').
 *   auto      : top.score >= minAuto AND (top.score - second.score) >= gap
 *   ambiguous : >= 1 candidate but not auto
 *   none      : 0 candidates
 * Returns { resolution, chosen?, ranked:[{candidate, score, signals}] }.
 */
export function rankCandidates(candidates, prior, contact = {}, opts = {}) {
  const minAuto = opts.minAuto ?? MIN_AUTO;
  const gap = opts.gap ?? GAP;
  const list = Array.isArray(candidates) ? candidates : [];

  const ranked = list.map((candidate, i) => {
    const { score, signals } = scoreCandidate(candidate, prior, contact);
    return { candidate, score, signals, _i: i };
  });
  ranked.sort((a, b) => b.score - a.score || a._i - b._i);
  for (const r of ranked) delete r._i;

  if (ranked.length === 0) return { resolution: "none", ranked: [] };

  const top = ranked[0];
  const second = ranked[1];
  const auto =
    top.score >= minAuto && top.score - (second?.score ?? 0) >= gap;
  if (auto) return { resolution: "auto", chosen: top.candidate, ranked };
  return { resolution: "ambiguous", ranked };
}
