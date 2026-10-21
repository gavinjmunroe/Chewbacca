// Throwaway latency probe for the REAL /v1/me/people-rank contact-query path.
// Resolves a real owner (arg: phone | DID | amber_id; default env
// LATENCY_PROBE_OWNER), then runs the SAME sequence the route runs — load
// contacts → realness+dedup → fact attach → buildMe → rankViaTogariSearch —
// timing each step, for a representative text query AND an empty-query
// proximity run. Prints the full nested timings_ms breakdown + contact_count.
// READ-ONLY: no writes (owner is resolved via a plain SELECT, never the
// insert-on-miss resolver).
//
// Run: railway run node scripts/latency-probe.js "+15551234567"
//      railway run node scripts/latency-probe.js            (uses LATENCY_PROBE_OWNER)

import { performance } from "node:perf_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-latency-probe.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { loadContactsByOwnerId, getResolvedFactsForContacts, getUserFacts, resolveAmberIdByPrivyDid } =
  await import("../src/db/store.js");
const { getProfile } = await import("../src/db/user-store.js");
const { buildMe, rankViaTogariSearch } = await import("../src/enrichment/togari-search-rank.js");
const { filterRealContacts } = await import("../src/lib/people-rank-realness.js");
const { dedupeContacts } = await import("../src/lib/people-rank-dedup.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round = (n) => Math.round(n * 10) / 10;

// Resolve arg → amber_id, READ-ONLY (never resolveAmberIdByPhone, which inserts
// on miss). Accepts a phone (+E.164 / digits), a DID (did:amber:… / privy did),
// or a bare amber_id uuid.
async function resolveOwner(arg) {
  const raw = String(arg || "").trim();
  if (!raw) return null;
  // Phone-ish → SELECT by phone.
  if (/^\+?\d[\d\s\-()]*$/.test(raw)) {
    const { rows } = await query(
      `SELECT amber_id FROM users WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
      [raw],
    );
    return rows[0]?.amber_id ?? null;
  }
  // DID / uuid / person_id / privy_did → the same read-only resolver the route
  // uses for token subjects.
  return await resolveAmberIdByPrivyDid(raw).catch(() => null);
}

// Mirror of the route's timed core for one query (null = empty proximity run).
async function runOnce(amberId, q, limit) {
  const tStart = performance.now();

  const tLoad0 = performance.now();
  const rawContacts = (await loadContactsByOwnerId(amberId).catch(() => [])) || [];
  const load_contacts = performance.now() - tLoad0;

  const tRD0 = performance.now();
  const { kept } = filterRealContacts(rawContacts);
  const realContacts = kept.length > 0 ? kept : rawContacts;
  const { contacts } = dedupeContacts(realContacts);
  const realness_dedup = performance.now() - tRD0;

  const tFA0 = performance.now();
  const factIds = contacts.map((c) => c.id);
  const factsMap = await getResolvedFactsForContacts(amberId, factIds).catch(() => ({}));
  const contactsWithFacts = contacts.map((c) => ({ ...c, facts: factsMap[String(c.id)] ?? [] }));
  const fact_attach = performance.now() - tFA0;

  // buildMe (+ owner facts), same as the route's query branch.
  const ownerProfile = await getProfile(amberId).catch(() => null);
  const me = buildMe(ownerProfile);
  if (me) {
    const rawMeFacts = await getUserFacts(amberId).catch(() => []);
    const meFacts = rawMeFacts
      .filter((f) => f.factText && f.factText.trim())
      .slice(0, 20)
      .map((f) => ({ text: f.factText, category: f.category ?? null }));
    if (meFacts.length > 0) me.facts = meFacts;
  }

  const tRH0 = performance.now();
  const togari = await rankViaTogariSearch({ query: q, limit, contacts: contactsWithFacts, me });
  const rank_http = performance.now() - tRH0;

  return {
    engineReturned: !!togari,
    peopleCount: togari?.people?.length ?? null,
    timings_ms: {
      load_contacts: round(load_contacts),
      realness_dedup: round(realness_dedup),
      fact_attach: round(fact_attach),
      rank_http: round(rank_http),
      total: round(performance.now() - tStart),
      contact_count: contactsWithFacts.length,
      ranker: togari?.timings_ms ?? null,
    },
  };
}

async function main() {
  const arg = process.argv[2] || process.env.LATENCY_PROBE_OWNER || "";
  if (!arg) {
    console.error("Usage: railway run node scripts/latency-probe.js <phone|DID|amber_id>");
    console.error("   or set LATENCY_PROBE_OWNER in env.");
    process.exit(2);
  }

  const amberId = await resolveOwner(arg);
  if (!amberId) {
    console.error(`❌ could not resolve a real owner from: ${arg}`);
    process.exit(1);
  }
  console.log(`owner amber_id: ${amberId}`);
  console.log(`engine: PEOPLERANK_ENGINE=${process.env.PEOPLERANK_ENGINE || "(unset)"} url=${process.env.TOGARI_SEARCH_URL ? "set" : "unset"} key=${process.env.TOGARI_SEARCH_KEY ? "set" : "unset"}`);

  const runs = [
    { label: 'query "who should I get dinner with"', q: "who should I get dinner with", limit: 10 },
    { label: "empty-query proximity run", q: null, limit: 10 },
  ];

  for (const r of runs) {
    console.log(`\n──────── ${r.label} ────────`);
    const out = await runOnce(amberId, r.q, r.limit);
    console.log(`engine returned: ${out.engineReturned}${out.engineReturned ? ` (people=${out.peopleCount})` : " — rankViaTogariSearch returned null (engine off / not configured / error)"}`);
    console.log(`contact_count: ${out.timings_ms.contact_count}`);
    console.log("timings_ms:");
    console.log(JSON.stringify(out.timings_ms, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`❌ probe error: ${e?.stack || e?.message || e}`);
    process.exit(1);
  });
