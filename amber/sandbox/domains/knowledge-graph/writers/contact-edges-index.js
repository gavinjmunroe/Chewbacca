/**
 * Contact-edge graph retrieval (Tab 33).
 *
 * jobs/contact-edges.js writes one undirected `contact_edge` vector per pair of
 * the tenant's DID-keyed Pinecone namespace (the same
 * namespace pinecone-client.js serves). This module is the READ side: typed
 * helpers the /knowledge/graph-as route + agent tool call to answer:
 *
 *   - "who do Caleb and Shirley both know?"          (mutual)
 *   - "intro path from me to a Stripe engineer"      (intro_path)
 *   - "show me Carlo's neighborhood in my graph"     (neighborhood)
 *
 * Edges are selected by metadata filter, not semantic similarity, so we embed
 * one stable probe string and let topK + filter do the selection, then walk the
 * graph in pure code (src/lib/contact-edge.js neighborsFromEdges).
 *
 * Every function degrades gracefully: if the vector path is unavailable or an
 * upstream errors, it returns an empty result rather than throwing, matching the
 * other *-index.js modules so the caller keeps serving traffic.
 */

import { query as pineconeQuery } from "../service/lib/pinecone.js";
import { embed } from "../service/lib/embed.js";
import {
  CONTACT_EDGE_KIND,
  neighborsFromEdges,
  resolveFromEdges,
} from "../service/lib/contact-edge.js";

const PROBE_TEXT =
  "contact edge graph mutual connection intro path neighborhood";

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

// Cache the probe embedding for the life of the process; only the filter matters.
let _probePromise = null;
async function probeVector() {
  if (!_probePromise) _probePromise = embed(PROBE_TEXT);
  return _probePromise;
}

/** Flatten a Pinecone match into the flat edge-row shape the graph ops expect. */
function toEdgeRow(match) {
  const md = match?.metadata || {};
  return {
    id: match?.id,
    contact_a_id: md.contact_a_id,
    contact_b_id: md.contact_b_id,
    contact_a_name: md.contact_a_name || "",
    contact_b_name: md.contact_b_name || "",
    edge_type: md.edge_type || "co_mentioned",
    co_mention_count: Number(md.co_mention_count) || 0,
    shared_calendar_count: Number(md.shared_calendar_count) || 0,
    same_org_count: Number(md.same_org_count) || 0,
    evidence_count: Number(md.evidence_count) || 0,
    edge_strength: Number(md.edge_strength) || 0,
  };
}

async function queryEdges(privyDid, filter, topK = 1000) {
  if (!privyDid || !vectorizationAvailable()) return [];
  let vector;
  try {
    vector = await probeVector();
  } catch {
    return [];
  }
  try {
    const matches = await pineconeQuery(privyDid, vector, { topK, filter });
    return (Array.isArray(matches) ? matches : []).map(toEdgeRow);
  } catch {
    return [];
  }
}

/** Every edge that touches `contactId`, undirected. */
async function edgesTouching(privyDid, contactId, topK = 1000) {
  if (!contactId) return [];
  return queryEdges(
    privyDid,
    {
      kind: CONTACT_EDGE_KIND,
      $or: [{ contact_a_id: contactId }, { contact_b_id: contactId }],
    },
    topK,
  );
}

/**
 * Resolve a caller-supplied contact reference (name or id) to the contact_id the
 * job wrote, scanning known edge endpoints first, then the deterministic slug.
 */
export async function resolveContactId(
  privyDid,
  { contactId, contactName } = {},
) {
  if (contactId) return contactId;
  if (!contactName) return null;
  const all = await queryEdges(privyDid, { kind: CONTACT_EDGE_KIND }, 1000);
  return resolveFromEdges(all, { contactName });
}

/**
 * One-hop neighborhood of a contact, neighbors ranked by edge strength.
 * Returns { contact_id, neighbors: [{ id, name, edge_type, edge_strength,
 * evidence_count }] }.
 */
export async function findNeighborhood(
  privyDid,
  { contactId, limit = 20 } = {},
) {
  if (!contactId) return { contact_id: null, neighbors: [] };
  const edges = await edgesTouching(privyDid, contactId);
  const neighbors = neighborsFromEdges(edges, contactId).sort(
    (a, b) => b.edge_strength - a.edge_strength,
  );
  return { contact_id: contactId, neighbors: neighbors.slice(0, limit) };
}

/**
 * Contacts connected to BOTH a and b (the classic "mutual connections"),
 * ranked by combined edge strength to the two anchors.
 */
export async function findMutualConnections(
  privyDid,
  { contactIdA, contactIdB, limit = 20 } = {},
) {
  if (!contactIdA || !contactIdB) return { mutuals: [] };
  const [edgesA, edgesB] = await Promise.all([
    edgesTouching(privyDid, contactIdA),
    edgesTouching(privyDid, contactIdB),
  ]);
  const aNeighbors = new Map(
    neighborsFromEdges(edgesA, contactIdA).map((n) => [n.id, n]),
  );
  const mutuals = [];
  for (const nb of neighborsFromEdges(edgesB, contactIdB)) {
    if (nb.id === contactIdA) continue;
    const viaA = aNeighbors.get(nb.id);
    if (!viaA) continue;
    mutuals.push({
      id: nb.id,
      name: nb.name || viaA.name,
      strength_to_a: viaA.edge_strength,
      strength_to_b: nb.edge_strength,
      combined_strength: round(viaA.edge_strength + nb.edge_strength, 4),
    });
  }
  mutuals.sort((x, y) => y.combined_strength - x.combined_strength);
  return { mutuals: mutuals.slice(0, limit) };
}

/**
 * Shortest introduction path from `fromId` to `toId` over the edge graph, via a
 * bounded breadth-first search. Returns { found, path: [{ id, name }], hops }.
 *
 * BFS expands one frontier node at a time (each expansion is a Pinecone query),
 * so it is bounded by maxHops and maxExpansions to keep the cost predictable.
 */
export async function findIntroPath(
  privyDid,
  { fromId, toId, maxHops = 3, maxExpansions = 40 } = {},
) {
  if (!fromId || !toId) return { found: false, path: [], hops: 0 };
  if (fromId === toId) {
    return { found: true, path: [{ id: fromId, name: fromId }], hops: 0 };
  }

  const visited = new Set([fromId]);
  const nameOf = new Map([[fromId, fromId]]);
  // queue holds { id, path:[ids] }
  const queue = [{ id: fromId, path: [fromId] }];
  let expansions = 0;

  while (queue.length > 0 && expansions < maxExpansions) {
    const node = queue.shift();
    if (node.path.length - 1 >= maxHops) continue; // can't reach within budget
    expansions += 1;
    const edges = await edgesTouching(privyDid, node.id);
    const neighbors = neighborsFromEdges(edges, node.id).sort(
      (a, b) => b.edge_strength - a.edge_strength,
    );
    for (const nb of neighbors) {
      if (nb.name) nameOf.set(nb.id, nb.name);
      if (nb.id === toId) {
        const ids = [...node.path, nb.id];
        return {
          found: true,
          hops: ids.length - 1,
          path: ids.map((id) => ({ id, name: nameOf.get(id) || id })),
        };
      }
      if (visited.has(nb.id)) continue;
      visited.add(nb.id);
      queue.push({ id: nb.id, path: [...node.path, nb.id] });
    }
  }
  return { found: false, path: [], hops: 0 };
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}
