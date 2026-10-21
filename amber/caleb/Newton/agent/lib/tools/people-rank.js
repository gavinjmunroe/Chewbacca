/**
 * people-rank.js — `people_rank` agent tool (Tab 34).
 *
 * Reads the daily PeopleRank scores + drift alerts that amber-id's jobs accrue
 * (jobs/people-rank.js, jobs/drift-detector.js). Answers questions about the
 * SHAPE of the whole network, which the point-in-time recall and single-contact
 * trajectory tools can't:
 *
 *   - "rank my network" / "who matters most to me"          (top_composite)
 *   - "who are my warmest relationships"                     (top_warmth)
 *   - "who are the hubs in my network"                       (top_centrality)
 *   - "who am I drifting from" / "who's surging"             (drift_alerts)
 *   - "how strong is my relationship with Carlo"             (score_for)
 *
 * Hits amber-id's /knowledge/people-rank-as with the tenant's DID. Everything
 * returned is the user's own first-party data, not the public web.
 *
 * For a single contact's week-by-week direction use relationship_trajectory;
 * for "who do I know" lookups use search_contacts. people_rank is the
 * network-wide ranking + drift surface.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";
import { resolveTargetDid } from "../sender-did.js";

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_DAYS = 30;
const QUERY_TIMEOUT_MS = 8000;

const TOP_INTENTS = new Set([
  "top_composite",
  "top_warmth",
  "top_centrality",
  "top_recency",
  "top_relevance",
]);
const VALID_INTENTS = new Set([...TOP_INTENTS, "drift_alerts", "score_for"]);
const VALID_DRIFT_TYPES = new Set([
  "cooling_alert",
  "warming_surge",
  "going_dark",
]);

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

async function callAmberId(body) {
  const res = await fetch(`${AMBER_ID_API_URL}/knowledge/people-rank-as`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AMBER_ID_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 404) return { rows: [], row: null };
    const errBody = await res.text().catch(() => "");
    console.warn(`[people_rank] ${res.status}: ${errBody.slice(0, 200)}`);
    return { rows: [], row: null };
  }
  const data = await res.json().catch(() => null);
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    row: data?.row || null,
  };
}

function fmt(n, places = 2) {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}

function signed(n) {
  const v = fmt(n);
  return `${v >= 0 ? "+" : ""}${v}`;
}

function metricLabel(intent) {
  return (
    {
      top_composite: "Top relationships (overall)",
      top_warmth: "Warmest relationships",
      top_centrality: "Most central relationships",
      top_recency: "Most recently active relationships",
      top_relevance: "Most relevant to what you're working on",
    }[intent] || "Top relationships"
  );
}

function metricField(intent) {
  return (
    {
      top_composite: "composite_score",
      top_warmth: "warmth_score",
      top_centrality: "centrality_score",
      top_recency: "recency_score",
      top_relevance: "relevance_score",
    }[intent] || "composite_score"
  );
}

function summarizeTop(rows, intent) {
  if (!rows.length) {
    return (
      "No PeopleRank scores yet. Scores accrue daily once relationship " +
      "snapshots and touchpoints exist; ask again after a day or two."
    );
  }
  const field = metricField(intent);
  const lines = rows.map(
    (r, i) =>
      `${i + 1}. ${r.contact_name || r.contact_id}: ${fmt(r[field])} ` +
      `(warmth ${fmt(r.warmth_score)}, recency ${fmt(r.recency_score)}, ` +
      `centrality ${fmt(r.centrality_score)})`,
  );
  return `${metricLabel(intent)}:\n${lines.join("\n")}`;
}

const DRIFT_LABEL = {
  cooling_alert: "cooling",
  warming_surge: "surging",
  going_dark: "going dark",
};

function summarizeDrift(rows) {
  if (!rows.length) {
    return "No drift alerts in that window. Nothing notably warming, cooling, or going dark.";
  }
  const lines = rows.map((r) => {
    const label = DRIFT_LABEL[r.alert_type] || r.alert_type;
    if (r.alert_type === "going_dark") {
      return (
        `${r.contact_name || r.contact_id}: going dark (no touchpoint in ` +
        `${r.silence_days} days, ${r.severity}).`
      );
    }
    return (
      `${r.contact_name || r.contact_id}: ${label} ${signed(r.change_pct)} ` +
      `(${fmt(r.from_score)} -> ${fmt(r.to_score)}, ${r.severity}).`
    );
  });
  return `Relationship drift alerts:\n${lines.join("\n")}`;
}

function summarizeScoreFor(row, label) {
  if (!row) {
    return (
      `No PeopleRank score yet for ${label}. It accrues once there are ` +
      `relationship snapshots or recent touchpoints for them.`
    );
  }
  return (
    `${row.contact_name || label}: composite ${fmt(row.composite_score)} ` +
    `(warmth ${fmt(row.warmth_score)}, centrality ${fmt(row.centrality_score)}, ` +
    `recency ${fmt(row.recency_score)}, relevance ${fmt(row.relevance_score)}).`
  );
}

function summarizeEngine(people) {
  if (!Array.isArray(people) || people.length === 0) return "No matches.";
  return people
    .slice(0, 10)
    .map((p, i) => {
      const co = p.company ? ` (${p.company})` : "";
      const reason = p.reason ? ` · ${p.reason}` : "";
      return `${i + 1}. ${p.name}${co} — ${fmt(p.score)}${reason}`;
    })
    .join("\n");
}

export async function executePeopleRankTool(toolName, input = {}, ctx = {}) {
  if (toolName !== "people_rank") {
    return { error: `Unknown people_rank tool: ${toolName}` };
  }

  // Testing-phase override: if the caller referenced a shared test network by
  // name ("Sagar's network", network_owner="sagar"), rank that DID. Otherwise
  // resolve the HUMAN whose network to rank: on a shared "expert" Medha number
  // the conversation tenant is synthetic (did:expert:*) with no graph of its
  // own, so rank the INBOUND sender's own medha-id graph instead. This is what
  // makes "rank my network" mean the texter's contacts, not Medha's.
  const { did, source } = await resolveTargetDid({
    input,
    tenant: ctx.tenant || null,
    normFrom: ctx.normFrom || null,
  });
  if (!did) {
    return {
      ok: true,
      intent: input.intent,
      query: typeof input.query === "string" ? input.query.trim() : undefined,
      count: 0,
      rows: [],
      people: [],
      summary:
        source === "unresolved"
          ? "You don't have a contacts graph on file yet, so there's nothing to rank. Import your contacts first."
          : "Couldn't identify whose network to rank from this message.",
    };
  }

  // Free-text, query-driven search/rank via the live togari-search engine —
  // the "I just moved to LA, who should I reconnect with to invite to my
  // housewarming" path. Engine-only: hard-fail rather than serving weaker
  // local results, so an engine outage is visible, never silently masked.
  if (typeof input.query === "string" && input.query.trim()) {
    if (!configured()) {
      return {
        error: "people_rank unavailable: AMBER_ID_API_URL / API_KEY not set",
      };
    }
    const limit =
      Number(input.limit) > 0
        ? Math.min(Number(input.limit), 50)
        : DEFAULT_LIMIT;
    let res;
    try {
      res = await fetch(
        `${AMBER_ID_API_URL}/internal/users/${encodeURIComponent(did)}/people-rank`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": AMBER_ID_API_KEY,
          },
          body: JSON.stringify({ query: input.query.trim(), limit }),
          signal: AbortSignal.timeout(35_000),
        },
      );
    } catch (err) {
      return {
        error: "people_rank engine call failed",
        message: err?.message || String(err),
      };
    }
    if (res.status === 404) {
      return {
        ok: true,
        query: input.query.trim(),
        count: 0,
        people: [],
        summary: "No contacts on file yet to rank.",
      };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        error: "people_rank_engine_unavailable",
        message: `PeopleRank engine is unavailable (HTTP ${res.status}). ${detail.slice(0, 160)}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    const people = Array.isArray(data.people) ? data.people : [];
    return {
      ok: true,
      engine: "togari-search",
      query: data.query ?? input.query.trim(),
      count: people.length,
      people,
      // The engine writes a grounded 2-3 sentence answer citing the ranked
      // people; surface it so the model can ground its reply on the engine's
      // own reasoning rather than re-deriving it from the bare list.
      answer: typeof data.answer === "string" ? data.answer : null,
      summary: summarizeEngine(people),
    };
  }

  const intent = typeof input.intent === "string" ? input.intent : "";
  if (!VALID_INTENTS.has(intent)) {
    return { error: `intent must be one of ${[...VALID_INTENTS].join(", ")}` };
  }
  if (!configured()) {
    return {
      error: "people_rank unavailable: AMBER_ID_API_URL / API_KEY not set",
    };
  }

  const body = { target_did: did, intent };
  if (intent === "score_for") {
    if (!input.contact_name && !input.contact_id) {
      return { error: "score_for needs contact_name or contact_id" };
    }
    if (input.contact_name) body.contact_name = String(input.contact_name);
    if (input.contact_id) body.contact_id = String(input.contact_id);
  } else if (intent === "drift_alerts") {
    if (input.drift_type) {
      if (!VALID_DRIFT_TYPES.has(String(input.drift_type))) {
        return {
          error: `drift_type must be one of ${[...VALID_DRIFT_TYPES].join(", ")}`,
        };
      }
      body.drift_type = String(input.drift_type);
    }
    body.window_days =
      Number(input.window_days) > 0
        ? Math.min(Number(input.window_days), 365)
        : DEFAULT_WINDOW_DAYS;
    body.limit =
      Number(input.limit) > 0
        ? Math.min(Number(input.limit), 50)
        : DEFAULT_LIMIT;
  } else {
    // top_* rankings
    body.limit =
      Number(input.limit) > 0
        ? Math.min(Number(input.limit), 50)
        : DEFAULT_LIMIT;
  }

  let result;
  try {
    result = await callAmberId(body);
  } catch (err) {
    return {
      error: "people_rank call failed",
      message: err?.message || String(err),
    };
  }

  if (intent === "score_for") {
    const label = input.contact_name || input.contact_id || "this contact";
    return {
      ok: true,
      intent,
      row: result.row,
      summary: summarizeScoreFor(result.row, label),
    };
  }

  const rows = result.rows;
  const summary =
    intent === "drift_alerts"
      ? summarizeDrift(rows)
      : summarizeTop(rows, intent);
  return { ok: true, intent, count: rows.length, rows, summary };
}

export const PEOPLE_RANK_TOOLS = [
  {
    name: "people_rank",
    description:
      "Rank the user's WHOLE network or surface relationship drift, from daily " +
      "PeopleRank scores of the user's OWN contacts. Each contact has a 0-1 " +
      "composite blended from warmth (recent relationship trajectory), " +
      "centrality (how connected they are in the user's contact graph), recency " +
      "(how recently they were in touch), and relevance (how aligned they are " +
      "with what the user has been working on). Reach for it when the user asks " +
      "to rank or compare the whole network or asks who's drifting / surging: " +
      "'rank my network', 'who matters most to me', 'who are my warmest " +
      "relationships', 'who am I drifting from', 'who's surging', 'how strong is " +
      "my relationship with X'. For ONE contact's week-by-week direction use " +
      "relationship_trajectory; for a plain 'who do I know' lookup use " +
      "search_contacts.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text intent to SEARCH + rank the network by relevance, e.g. 'I just moved to LA, who should I reconnect with to invite to my housewarming'. When set, ranks live via the togari-search engine over the user's contacts and ignores `intent`. Use this for any 'who should I … ' / situational reconnect question.",
        },
        network_owner: {
          type: "string",
          description:
            "Whose network to rank. Omit to use the texter's own contacts. During the testing phase, set this (e.g. 'sagar') when the user references a shared test network by name, such as 'Sagar's network', 'who does Sagar know', or 'rank Sagar's contacts'.",
        },
        intent: {
          type: "string",
          enum: [
            "top_composite",
            "top_warmth",
            "top_centrality",
            "top_recency",
            "top_relevance",
            "drift_alerts",
            "score_for",
          ],
          description:
            "top_composite = overall ranking (default sense of 'rank my " +
            "network'). top_warmth / top_centrality / top_recency / " +
            "top_relevance = ranked by that single component. drift_alerts = " +
            "contacts cooling, surging, or going dark. score_for = one " +
            "contact's full score breakdown (needs contact_name or contact_id).",
        },
        contact_name: {
          type: "string",
          description: "Display name of the contact, for intent=score_for.",
        },
        contact_id: {
          type: "string",
          description: "Stable contact id, if known, for intent=score_for.",
        },
        drift_type: {
          type: "string",
          enum: ["cooling_alert", "warming_surge", "going_dark"],
          description:
            "Optional filter for intent=drift_alerts. Omit to get all types.",
        },
        window_days: {
          type: "integer",
          description: "Lookback window for drift_alerts. Default 30, max 365.",
          minimum: 1,
          maximum: 365,
        },
        limit: {
          type: "integer",
          description:
            "Max results for ranked / drift lists. Default 10, max 50.",
          minimum: 1,
          maximum: 50,
        },
      },
      required: ["intent"],
    },
  },
];
