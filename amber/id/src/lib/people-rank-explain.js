/**
 * Grounded per-person explainability for PeopleRank (spec item 161).
 *
 * The old reasonFor() in the route bucketed component scores into vague phrases
 * ("strong relationship", "in touch lately"). That reads as filler because it
 * is not grounded in the actual numbers that moved the rank. This module builds
 * an explanation from the REAL signals: how many days since the last touch, the
 * actual message cadence, whether the user has confirmed this person, fresh web
 * momentum, and so on. Every clause names a fact, never a generic adjective.
 *
 * Two outputs from one pass:
 *   - reason: a short single-line string for the card subtitle.
 *   - factors: a structured array [{ key, label, detail, weight }] the app can
 *     render as a transparent score breakdown ("why did this person rank?").
 *
 * Pure + deterministic: the only time input is the injected `nowMs`. No I/O.
 */

/** Humanize a day count into "today" / "yesterday" / "N days ago" / "N months ago". */
function humanizeDaysAgo(days) {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 31) return `${Math.round(days)} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * Build the grounded explanation.
 *
 *   explainRank({
 *     components: { warmth, recency, relevance, centrality },
 *     lastContactMs, messageFrequency, relationshipScore,
 *     engagement, signals, nowMs,
 *   }) -> { reason, factors }
 *
 * `signals` is the optional web-signal object from people-rank-signals.js
 * (momentum, recency epoch ms, top_sources). `engagement` is the 0..1 feedback
 * score. Anything absent is simply skipped, the function never invents a fact.
 */
export function explainRank({
  components = {},
  lastContactMs = null,
  messageFrequency = null,
  relationshipScore = null,
  engagement = 0,
  signals = null,
  nowMs = Date.now(),
} = {}) {
  const factors = [];
  const { warmth = 0, recency = 0, relevance = 0, centrality = 0 } = components;

  // Recency, grounded in the real last-touch date.
  if (typeof lastContactMs === "number" && lastContactMs > 0) {
    const days = Math.max(0, (nowMs - lastContactMs) / 86400000);
    factors.push({
      key: "recency",
      label: "Last in touch",
      detail: humanizeDaysAgo(days),
      weight: recency,
    });
  }

  // Warmth, grounded in the actual relationship score or message cadence.
  const relPct =
    typeof relationshipScore === "number" && relationshipScore > 0
      ? relationshipScore > 1
        ? Math.round(relationshipScore)
        : Math.round(relationshipScore * 100)
      : null;
  if (relPct != null) {
    factors.push({
      key: "warmth",
      label: "Relationship strength",
      detail: `${relPct}%`,
      weight: warmth,
    });
  } else if (typeof messageFrequency === "number" && messageFrequency > 0) {
    const perWeek = Math.round(messageFrequency * 10) / 10;
    factors.push({
      key: "warmth",
      label: "Message cadence",
      detail: `~${perWeek}/week`,
      weight: warmth,
    });
  }

  // Engagement, grounded in the user's own feedback.
  if (engagement >= 0.5) {
    factors.push({
      key: "engagement",
      label: "You confirmed",
      detail: "you've engaged with this person",
      weight: engagement,
    });
  }

  // Web momentum, grounded in distinct fresh sources.
  const momentum = Number(signals?.momentum) || 0;
  if (momentum >= 1) {
    factors.push({
      key: "momentum",
      label: "Recent activity",
      detail: `${momentum} fresh source${momentum === 1 ? "" : "s"}`,
      weight: Math.min(momentum / 3, 1),
    });
  }

  // Relevance to the query.
  if (relevance >= 0.5) {
    factors.push({
      key: "relevance",
      label: "Matches your search",
      detail: "relevant to your query",
      weight: relevance,
    });
  }

  // Centrality (network hub), only when the edge graph is live.
  if (centrality >= 0.5) {
    factors.push({
      key: "centrality",
      label: "Well-connected",
      detail: "a hub in your network",
      weight: centrality,
    });
  }

  const reason = buildReason(factors);
  return { reason, factors };
}

/**
 * Compose the one-line reason from the strongest grounded factors. Picks the
 * two highest-weighted facts so the subtitle stays short but specific. Falls
 * back to an honest "limited signal" line when nothing grounded is present.
 */
function buildReason(factors) {
  if (factors.length === 0) return "Limited recent signal";
  const top = factors
    .slice()
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, 2);

  const clauses = top.map((f) => {
    switch (f.key) {
      case "recency":
        return `Last spoke ${f.detail}`;
      case "warmth":
        return f.label === "Message cadence"
          ? `Texting ${f.detail}`
          : `Relationship ${f.detail}`;
      case "engagement":
        return "You keep engaging";
      case "momentum":
        return `${f.detail} of recent activity`;
      case "relevance":
        return "Matches your search";
      case "centrality":
        return "Well-connected in your network";
      default:
        return f.detail;
    }
  });

  const [first, ...rest] = clauses;
  return rest.length ? `${first} · ${rest.join(" · ")}` : first;
}
