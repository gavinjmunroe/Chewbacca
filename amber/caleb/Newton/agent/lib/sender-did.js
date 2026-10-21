/**
 * sender-did.js — resolve the HUMAN whose graph a tool should act on.
 *
 * Medha runs as a multi-sender "expert" agent: many different people text the
 * same Medha number. The conversation tenant is resolved by LOOP SENDER (the
 * outbound number), so for an expert number that tenant is a SYNTHETIC owner
 * (`did:expert:<slug>`) with no first-party contact graph of its own.
 *
 * For first-party tools — people_rank, search_contacts — "rank MY network"
 * means the INBOUND human's network, not the synthetic expert's. Each human
 * has their own medha-id tenant keyed by their phone, with their own contacts /
 * Pinecone namespace. This helper bridges that: prefer a real tenant DID when
 * the conversation already is a real person, otherwise resolve the inbound
 * sender's phone to THEIR own tenant DID via medha-id `/tenants/resolve`.
 *
 * Returns { did, source }:
 *   - source "tenant"     — the conversation tenant is itself a real user
 *   - source "sender"     — resolved the inbound sender's phone to their DID
 *   - source "none"       — no phone to resolve (can't identify the human)
 *   - source "unresolved" — sender has no medha-id tenant yet (not registered)
 */

import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";

const RESOLVE_TIMEOUT_MS = 6000;

export function tenantDidOf(tenant) {
  if (!tenant) return null;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

// A real first-party user DID — anything except the synthetic expert owner the
// multi-sender model mints for a shared agent number.
export function isRealUserDid(did) {
  return (
    typeof did === "string" && did.length > 0 && !did.startsWith("did:expert:")
  );
}

/**
 * @param {object} args
 * @param {object|null} args.tenant   resolved conversation tenant
 * @param {string|null} args.normFrom inbound sender phone (E.164), if any
 * @returns {Promise<{did: string|null, source: string}>}
 */
export async function resolveSenderDid({ tenant, normFrom } = {}) {
  const tDid = tenantDidOf(tenant);
  if (isRealUserDid(tDid)) return { did: tDid, source: "tenant" };

  // Synthetic / missing tenant — rank the inbound human's own graph instead.
  if (!normFrom) return { did: null, source: "none" };
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) {
    return { did: null, source: "none" };
  }

  try {
    const res = await fetch(
      `${AMBER_ID_API_URL}/tenants/resolve?phone=${encodeURIComponent(normFrom)}`,
      {
        headers: { "x-api-key": AMBER_ID_API_KEY },
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      },
    );
    if (!res.ok) return { did: null, source: "unresolved" };
    const data = await res.json().catch(() => null);
    const did = data?.data?.privyDid || data?.data?.id || null;
    if (!isRealUserDid(did)) return { did: null, source: "unresolved" };
    return { did, source: "sender" };
  } catch {
    return { did: null, source: "unresolved" };
  }
}

// ── Shared test networks (testing phase) ──────────────────────────────────
// Sagar has opened his large warm network as the team's fixture: any tester can
// rank/search it by naming it ("Sagar's network", network_owner="sagar")
// instead of their own graph. Override/extend via PEOPLERANK_TEST_NETWORKS, a
// JSON map of name -> DID. This lives here so EVERY first-party tool
// (people_rank, search_contacts, ...) honors the same override consistently.
const DEFAULT_TEST_NETWORKS = {
  sagar: "did:privy:cmobxrpvr00ml0cjp5gq5mdyd",
};

function testNetworks() {
  let extra = {};
  try {
    extra = JSON.parse(process.env.PEOPLERANK_TEST_NETWORKS || "{}") || {};
  } catch {
    extra = {};
  }
  const merged = { ...DEFAULT_TEST_NETWORKS };
  for (const [k, v] of Object.entries(extra)) {
    if (typeof k === "string" && typeof v === "string") {
      merged[k.toLowerCase()] = v;
    }
  }
  return merged;
}

// If the caller named a shared test network (explicit network_owner, or the
// name appears in the free-text query/text like "Sagar's network"), return its
// DID. Whole-word match so "sagar" hits but "saga" does not. Returns
// { did, name } or null.
export function resolveTestNetworkDid(input = {}) {
  const networks = testNetworks();
  const explicit =
    typeof input.network_owner === "string"
      ? input.network_owner.trim().toLowerCase()
      : "";
  if (explicit && networks[explicit]) {
    return { did: networks[explicit], name: explicit };
  }
  const haystack =
    `${input.network_owner || ""} ${input.query || ""}`.toLowerCase();
  for (const name of Object.keys(networks)) {
    if (new RegExp(`\\b${name}\\b`).test(haystack)) {
      return { did: networks[name], name };
    }
  }
  return null;
}

/**
 * Resolve the target DID for a first-party tool: a named shared test network
 * wins (testing phase), otherwise fall back to the inbound sender's own graph.
 * One resolver so people_rank and search_contacts behave identically.
 *
 * @returns {Promise<{did: string|null, source: string, owner?: string}>}
 */
export async function resolveTargetDid({ input = {}, tenant, normFrom } = {}) {
  const testNet = resolveTestNetworkDid(input);
  if (testNet) {
    return { did: testNet.did, source: "test_network", owner: testNet.name };
  }
  return resolveSenderDid({ tenant, normFrom });
}
