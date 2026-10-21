/**
 * contacts-search.js — `search_contacts` agent tool.
 *
 * Surfaces the unified people graph (LinkedIn, Apple Contacts, Google,
 * GitHub, Twitter, manually entered) by natural-language query. Retrieves
 * through the Firestore-backed PeopleRank engine (medha-id
 * /internal/users/:did/people-rank), the same source people_rank uses, so
 * imported contacts are actually found. (The older /knowledge/query-as path
 * read the cNFT Pinecone namespace and missed DID-namespace contacts.)
 *
 * Used when the user asks "who in my contacts...", "who do I know
 * who...", "find people who...", "who went to Stanford" — any
 * relational lookup against their own network. Honors the shared
 * test-network override (e.g. "Sagar's network") via resolveTargetDid.
 *
 * Authoritative because the data was scraped from THEIR connected
 * accounts; the result is not hearsay.
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";
import { resolveTargetDid } from "../sender-did.js";

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 50;
const ENGINE_TIMEOUT_MS = 35_000;

function configured() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

// Retrieve the user's contacts by relevance to `text`. Goes through the same
// Firestore-backed PeopleRank engine endpoint people_rank uses — NOT
// /knowledge/query-as, which reads the cNFT Pinecone namespace and does not see
// imported contacts (they live in the DID namespace / Firestore). Returns the
// engine's people[] array.
async function queryAmberIdContacts({ targetDid, text, topK }) {
  if (typeof targetDid === "string" && targetDid.startsWith("did:expert:")) {
    return [];
  }
  const res = await fetch(
    `${AMBER_ID_API_URL}/internal/users/${encodeURIComponent(targetDid)}/people-rank`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": AMBER_ID_API_KEY,
      },
      body: JSON.stringify({ query: text, limit: topK }),
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    if (res.status === 404) return [];
    const body = await res.text().catch(() => "");
    console.warn(
      `[search_contacts] people-rank ${res.status}: ${body.slice(0, 200)}`,
    );
    return [];
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.people) ? data.people : [];
}

function renderMatch(person, index) {
  const name = person?.name || "Unknown";
  const company = person?.company ? ` — ${person.company}` : "";
  const title = person?.title ? `, ${person.title}` : "";
  const score =
    typeof person?.score === "number"
      ? ` (score ${person.score.toFixed(2)})`
      : "";
  const reason = person?.reason ? `\n   ${person.reason}` : "";
  return `${index + 1}. ${name}${company}${title}${score}${reason}`;
}

export async function executeContactsSearchTool(
  toolName,
  input = {},
  ctx = {},
) {
  if (toolName !== "search_contacts") {
    return { error: `Unknown contacts tool: ${toolName}` };
  }

  // Validate the caller's arguments BEFORE the env check so the agent
  // gets a precise error ("query is required") even in unconfigured
  // environments. Easier to debug than the generic "unavailable" error.
  // Resolve whose contacts to search. A named shared test network wins
  // ("Sagar's network", network_owner="sagar"); otherwise the INBOUND sender's
  // own graph (the conversation tenant on a shared Medha number is synthetic).
  const { did, source } = await resolveTargetDid({
    input,
    tenant: ctx.tenant || null,
    normFrom: ctx.normFrom || null,
  });
  if (!did) {
    return {
      ok: true,
      query: typeof input.query === "string" ? input.query.trim() : "",
      matches: [],
      summary:
        source === "unresolved"
          ? "You don't have a contacts graph on file yet. Import your contacts first."
          : "Couldn't identify whose contacts to search from this message.",
    };
  }

  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return { error: "query is required" };
  }

  if (!configured()) {
    return {
      error: "search_contacts unavailable: AMBER_ID_API_URL / API_KEY not set",
    };
  }

  let topK = Number(input.topK || input.top_k || DEFAULT_TOP_K);
  if (!Number.isFinite(topK) || topK < 1) topK = DEFAULT_TOP_K;
  if (topK > MAX_TOP_K) topK = MAX_TOP_K;

  let matches;
  try {
    matches = await queryAmberIdContacts({
      targetDid: did,
      text: query,
      topK,
    });
  } catch (err) {
    return {
      error: "search_contacts call failed",
      message: err?.message || String(err),
    };
  }

  // Optional client-side source filter — when the user asks "who in my
  // LINKEDIN contacts went to Stanford" we should narrow on profile.source.
  const sourceFilter =
    typeof input.source === "string" ? input.source.toLowerCase() : null;
  const filtered = sourceFilter
    ? matches.filter((p) => {
        const src = String(p?.profile?.source || "").toLowerCase();
        return src.includes(sourceFilter);
      })
    : matches;

  if (filtered.length === 0) {
    return {
      ok: true,
      query,
      topK,
      matches: [],
      summary:
        "No matching contacts in this graph. It may be empty for that source, " +
        "or the query was too narrow.",
    };
  }

  const lines = filtered.map((p, i) => renderMatch(p, i));
  return {
    ok: true,
    query,
    topK,
    count: filtered.length,
    matches: filtered.map((p) => ({
      score: p?.score ?? null,
      name: p?.name || null,
      company: p?.company || null,
      title: p?.title || null,
      reason: p?.reason || null,
      source: p?.profile?.source || null,
      contactId: p?.contactId || null,
    })),
    summary: lines.join("\n"),
  };
}

export const CONTACTS_SEARCH_TOOLS = [
  {
    name: "search_contacts",
    description:
      "Search the user's unified contacts graph (LinkedIn connections, " +
      "Apple Contacts, Google Contacts, GitHub network, Twitter following, " +
      "manually added people) by natural language. Returns matching people " +
      "with their name, source, company, role, education, and any notes " +
      "amber-id captured at ingest. ALWAYS call this first whenever the " +
      "user asks 'who in my contacts...', 'who do I know who...', 'find " +
      "people who...', 'do I know anyone at...', 'who went to <school>', " +
      "or any other natural-language people lookup. Authoritative — this " +
      "is the user's own graph, not the public web. Do not paraphrase the " +
      "result as if it were hearsay; cite the source (LinkedIn / Apple / " +
      "etc) when you summarize.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language description of who to find. Include any " +
            "identifying clues the user mentioned (school, company, city, " +
            "role, shared project). E.g. 'engineers at Stanford', " +
            "'people in LA in venture', 'founders I met through Y Combinator'.",
        },
        network_owner: {
          type: "string",
          description:
            "Whose contacts to search. Omit to use the texter's own graph. " +
            "During the testing phase, set this (e.g. 'sagar') when the user " +
            "references a shared test network by name, such as 'USC people in " +
            "Sagar's network' or 'who does Sagar know at Stanford'.",
        },
        topK: {
          type: "integer",
          description:
            "How many matches to return. Default 10. Max 50. Bump up when " +
            "the user wants a broad list ('all my contacts at X').",
          minimum: 1,
          maximum: 50,
        },
        source: {
          type: "string",
          description:
            "Optional case-insensitive substring filter on the contact " +
            "source. Examples: 'linkedin', 'google', 'github', 'apple', " +
            "'twitter'. Omit to search across every connected source.",
        },
      },
      required: ["query"],
    },
  },
];
