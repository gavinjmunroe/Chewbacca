/**
 * relationship-trajectory.js — `relationship_trajectory` agent tool (Tab 32).
 *
 * Reads the time-series relationship state that amber-id's weekly snapshot job
 * accrues (jobs/relationship-snapshot.js). Answers questions about how a
 * relationship is TRENDING, which the point-in-time recall tools can't:
 *
 *   - "is my relationship with Shirley warming or cooling?"  (trajectory)
 *   - "show me my trajectory with Sagar"                     (trajectory)
 *   - "who are my warming relationships this month?"         (warming)
 *   - "who am I drifting from?" / "who haven't I talked to?" (cooling)
 *
 * Hits amber-id's /knowledge/relationship-trajectory-as with the tenant's DID.
 * Everything returned is the user's own first-party data, not the public web.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

const DEFAULT_WEEKS = 12;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 10;
const QUERY_TIMEOUT_MS = 8000;

const VALID_INTENTS = new Set(["trajectory", "warming", "cooling"]);

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function callAmberId(body) {
  const res = await fetch(
    `${AMBER_ID_API_URL}/knowledge/relationship-trajectory-as`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": AMBER_ID_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    if (res.status === 404) return { rows: [] };
    const errBody = await res.text().catch(() => "");
    console.warn(
      `[relationship_trajectory] ${res.status}: ${errBody.slice(0, 200)}`,
    );
    return { rows: [] };
  }
  const data = await res.json().catch(() => null);
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    contact_id: data?.contact_id,
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

function summarizeTrajectory(rows, label) {
  if (!rows.length) {
    return (
      `No relationship snapshots recorded yet for ${label}. Snapshots accrue ` +
      `weekly; ask again once a couple of weeks of history exist.`
    );
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const overall = fmt(
    (last.composite_score ?? 0) - (first.composite_score ?? 0),
  );
  const dir =
    overall > 0.02 ? "warming" : overall < -0.02 ? "cooling" : "steady";
  const lines = rows.map(
    (r) =>
      `${r.week_key || r.week_start}: score ${fmt(r.composite_score)} ` +
      `(talks ${r.talk_frequency ?? 0}, sentiment ${signed(r.sentiment_score)}, ` +
      `wk delta ${signed(r.score_delta)})`,
  );
  return `${label} is ${dir} (${signed(overall)} over ${rows.length} week${rows.length === 1 ? "" : "s"}).\n${lines.join("\n")}`;
}

function summarizeList(rows, intent) {
  if (!rows.length) {
    return intent === "warming"
      ? "No warming relationships detected in that window yet."
      : "No cooling / drifting relationships detected in that window yet.";
  }
  const header =
    intent === "warming"
      ? "Warming relationships"
      : "Cooling / drifting relationships";
  const lines = rows.map(
    (r, i) =>
      `${i + 1}. ${r.contact_name || r.contact_id}: ${signed(r.score_delta)} ` +
      `(now ${fmt(r.composite_score)}, ${r.talk_frequency ?? 0} talks last week)`,
  );
  return `${header}:\n${lines.join("\n")}`;
}

export async function executeRelationshipTrajectoryTool(
  toolName,
  input = {},
  ctx = {},
) {
  if (toolName !== "relationship_trajectory") {
    return { error: `Unknown trajectory tool: ${toolName}` };
  }

  const did = tenantDidOf(ctx.tenant || null);
  if (!did) {
    return {
      error:
        "relationship_trajectory requires a resolved tenant (privyDid). " +
        "Inbound likely lacked a recognized loopSenderId.",
    };
  }
  if (typeof did === "string" && did.startsWith("did:expert:")) {
    return {
      ok: true,
      intent: input.intent,
      rows: [],
      summary: "No relationship history for synthetic expert tenants.",
    };
  }

  const intent = typeof input.intent === "string" ? input.intent : "";
  if (!VALID_INTENTS.has(intent)) {
    return { error: `intent must be one of ${[...VALID_INTENTS].join(", ")}` };
  }
  if (!configured()) {
    return {
      error:
        "relationship_trajectory unavailable: AMBER_ID_API_URL / API_KEY not set",
    };
  }

  const body = { target_did: did, intent };
  if (intent === "trajectory") {
    if (!input.contact_name && !input.contact_id) {
      return { error: "trajectory needs contact_name or contact_id" };
    }
    if (input.contact_name) body.contact_name = String(input.contact_name);
    if (input.contact_id) body.contact_id = String(input.contact_id);
    body.weeks =
      Number(input.weeks) > 0
        ? Math.min(Number(input.weeks), 104)
        : DEFAULT_WEEKS;
  } else {
    body.window_days =
      Number(input.window_days) > 0
        ? Math.min(Number(input.window_days), 365)
        : DEFAULT_WINDOW_DAYS;
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
      error: "relationship_trajectory call failed",
      message: err?.message || String(err),
    };
  }

  const rows = result.rows;
  const summary =
    intent === "trajectory"
      ? summarizeTrajectory(
          rows,
          input.contact_name || input.contact_id || "this contact",
        )
      : summarizeList(rows, intent);

  return { ok: true, intent, count: rows.length, rows, summary };
}

export const RELATIONSHIP_TRAJECTORY_TOOLS = [
  {
    name: "relationship_trajectory",
    description:
      "Show how a relationship is TRENDING over time, or list relationships " +
      "that are warming or cooling. This reads weekly relationship snapshots " +
      "(talk frequency, sentiment, touchpoint breadth, a 0-1 warmth score, and " +
      "the week-over-week delta) of the user's OWN contacts. Reach for it when " +
      "the user asks about direction or drift, not a one-time recall: 'is my " +
      "relationship with Shirley warming or cooling', 'show my trajectory with " +
      "Sagar', 'who are my warming relationships this month', 'who am I drifting " +
      "from', 'who haven't I talked to lately'. For a general 'who do I know' " +
      "lookup use search_contacts; for ranking the whole network use people_rank.",
    input_schema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["trajectory", "warming", "cooling"],
          description:
            "trajectory = one contact's week-by-week history (needs " +
            "contact_name or contact_id). warming = ranked list trending up. " +
            "cooling = ranked list trending down / drifting.",
        },
        contact_name: {
          type: "string",
          description: "Display name of the contact, for intent=trajectory.",
        },
        contact_id: {
          type: "string",
          description: "Stable contact id, if known, for intent=trajectory.",
        },
        weeks: {
          type: "integer",
          description:
            "Weeks of history for a trajectory. Default 12, max 104.",
          minimum: 1,
          maximum: 104,
        },
        window_days: {
          type: "integer",
          description:
            "Lookback window for warming/cooling. Default 30, max 365.",
          minimum: 1,
          maximum: 365,
        },
        limit: {
          type: "integer",
          description:
            "Max results for warming/cooling lists. Default 10, max 50.",
          minimum: 1,
          maximum: 50,
        },
      },
      required: ["intent"],
    },
  },
];
