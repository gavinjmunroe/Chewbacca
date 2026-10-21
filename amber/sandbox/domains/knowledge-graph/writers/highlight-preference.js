/**
 * Highlight-preference reranking for knowledge recall.
 *
 * The daily memory consolidator (src/jobs/memory-consolidator.js) reads each
 * day's raw chunks (conversation, file_content, generated_image), writes a
 * small set of `daily_highlight` summary vectors, and stamps every source
 * chunk it folded in with `consolidated_into: <highlight_id>`.
 *
 * When a recall query passes `prefer_highlights=true`, we keep every match
 * (old chunks stay queryable) but push the already-consolidated source
 * chunks below everything else, so the concise highlight a question like
 * "what did I do yesterday?" wants surfaces first instead of 200 raw turns.
 *
 * This is a pure function over the `query` result shape so both
 * /knowledge/query and /knowledge/query-as can share it and it is trivially
 * testable without Pinecone.
 */

// Multiplier applied to a consolidated source chunk's score. Small enough to
// sink it beneath any non-consolidated match, large enough to preserve the
// relative order among consolidated chunks themselves.
const DERANK_FACTOR = 0.1;

/**
 * Rerank matches so consolidated source chunks sink below highlights and
 * un-consolidated chunks. Stable for matches that are not deranked.
 *
 * @param {Array<{ id: string, score?: number, metadata?: object }>} matches
 * @returns {Array} the same matches, rescored and reordered (new array)
 */
export function applyHighlightPreference(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return matches || [];
  const adjusted = matches.map((m, i) => {
    const md = m?.metadata || {};
    const isConsolidatedSource = Boolean(md.consolidated_into);
    const baseScore = typeof m?.score === "number" ? m.score : 0;
    return {
      match: m,
      order: i,
      deranked: isConsolidatedSource,
      rankScore: isConsolidatedSource ? baseScore * DERANK_FACTOR : baseScore,
    };
  });
  adjusted.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return a.order - b.order; // stable within equal scores
  });
  return adjusted.map((a) =>
    a.deranked ? { ...a.match, deranked: true } : a.match,
  );
}

export const HIGHLIGHT_PREFERENCE_DERANK_FACTOR = DERANK_FACTOR;
