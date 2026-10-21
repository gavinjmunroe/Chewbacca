/**
 * Deterministic stub enrichment provider — drives all F2 tests while the real
 * Clay call stays dormant (no API key). Candidates are derived from the input
 * name so results are reproducible. Always `configured: true`.
 */

// Small deterministic hash → stable pseudo-variation per name.
function _hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function makeStubProvider() {
  return {
    name: "stub",
    async searchCandidates({ name, limit = 30 } = {}) {
      const n = typeof name === "string" ? name.trim() : "";
      if (!n) return { configured: true, candidates: [] };
      const h = _hash(n.toLowerCase());
      // Two plausible same-name candidates in different cities + one abroad,
      // so the ranker has something to rank (RANK, DON'T FILTER).
      const candidates = [
        {
          name: n,
          linkedinUrl: `https://linkedin.com/in/${n.toLowerCase().replace(/\s+/g, "-")}-${h % 1000}`,
          title: "Software Engineer",
          company: "Acme Corp",
          city: "Chicago",
          state: "IL",
          country: "US",
          school: "University of Chicago",
          raw: { source: "stub", seed: h },
        },
        {
          name: n,
          linkedinUrl: `https://linkedin.com/in/${n.toLowerCase().replace(/\s+/g, "-")}-${(h + 1) % 1000}`,
          title: "Product Manager",
          company: "Globex",
          city: "New York",
          state: "NY",
          country: "US",
          school: "NYU",
          raw: { source: "stub", seed: h + 1 },
        },
        {
          name: n,
          linkedinUrl: `https://linkedin.com/in/${n.toLowerCase().replace(/\s+/g, "-")}-intl`,
          title: "Analyst",
          company: "Kowalski LLC",
          city: "Warsaw",
          state: null,
          country: "PL",
          school: null,
          raw: { source: "stub", intl: true },
        },
      ];
      return { configured: true, candidates: candidates.slice(0, limit) };
    },
  };
}
