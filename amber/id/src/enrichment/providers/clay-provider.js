/**
 * Clay enrichment provider — the REAL client, DORMANT until an API key exists.
 *
 * Clay Public API (people search, filters mode):
 *   POST https://api.clay.com/public/v0/search/filters-mode
 *     { source_type:'people', filters:{ names:[name], location_countries_include? } }
 *     → { search_id }
 *   POST https://api.clay.com/public/v0/search/filters-mode/{search_id}/run
 *     { limit } → { data: [...] }
 * Header: 'clay-api-key: <key>'.
 *
 * BROAD retrieval: name (+ optional country) ONLY — never filter by city/school
 * (that's the ranker's job). With no key it returns { configured:false,
 * candidates:[] } and NEVER throws, so it's a safe no-op until we have a key.
 */

const CLAY_BASE = "https://api.clay.com/public/v0";
const TIMEOUT_MS = 20000;

function _norm(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Map a Clay people row → the common candidate shape; keep the full row in raw.
function normalizeClayRow(row) {
  const loc = row?.structured_location || {};
  return {
    name: _norm(row?.name),
    linkedinUrl: _norm(row?.url),
    title: _norm(row?.latest_experience_title),
    company: _norm(row?.latest_experience_company),
    city: _norm(loc.city),
    state: _norm(loc.state),
    country: _norm(loc.country),
    raw: row,
  };
}

export function makeClayProvider(apiKey) {
  return {
    name: "clay",
    async searchCandidates({ name, country, limit = 30 } = {}) {
      if (!apiKey) return { configured: false, candidates: [] };
      const n = typeof name === "string" ? name.trim() : "";
      if (!n) return { configured: true, candidates: [] };

      const headers = {
        "content-type": "application/json",
        "clay-api-key": apiKey,
      };
      const filters = { names: [n] };
      if (country) filters.location_countries_include = [country];

      try {
        // 1) Create the search.
        const createRes = await fetch(`${CLAY_BASE}/search/filters-mode`, {
          method: "POST",
          headers,
          body: JSON.stringify({ source_type: "people", filters }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!createRes.ok) {
          const body = await createRes.text().catch(() => "");
          console.warn(`[clay] create ${createRes.status}: ${body.slice(0, 300)}`);
          return { configured: true, candidates: [] };
        }
        const created = await createRes.json().catch(() => null);
        const searchId = created?.search_id;
        if (!searchId) return { configured: true, candidates: [] };

        // 2) Run it.
        const runRes = await fetch(
          `${CLAY_BASE}/search/filters-mode/${encodeURIComponent(searchId)}/run`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ limit }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        if (!runRes.ok) {
          const body = await runRes.text().catch(() => "");
          console.warn(`[clay] run ${runRes.status}: ${body.slice(0, 300)}`);
          return { configured: true, candidates: [] };
        }
        const ran = await runRes.json().catch(() => null);
        const data = Array.isArray(ran?.data) ? ran.data : [];
        return { configured: true, candidates: data.map(normalizeClayRow) };
      } catch (err) {
        console.warn(`[clay] searchCandidates failed: ${err?.message || err}`);
        return { configured: true, candidates: [] };
      }
    },
  };
}
