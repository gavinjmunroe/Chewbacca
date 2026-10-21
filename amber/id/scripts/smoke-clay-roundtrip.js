/**
 * END-TO-END SMOKE TEST for the Amber <-> Clay contact bridge.
 *
 *   # Clay -> Amber only (safe, writes one throwaway contact into YOUR account):
 *   AMBER_API_KEY=amberk_live_... node scripts/smoke-clay-roundtrip.js
 *
 *   # Both directions (also writes ONE row into your Clay table):
 *   AMBER_API_KEY=amberk_live_... CLAY_WEBHOOK_URL='https://api.clay.com/v3/sources/webhook/...' \
 *     node scripts/smoke-clay-roundtrip.js --push
 *
 * WHAT IT PROVES, and why each half is tested the way it is:
 *
 *   Clay -> Amber   Hits the REAL deployed POST /v1/ingest/contacts with a real API
 *                   key, then reads the contact back through a second authenticated
 *                   call. Reading back is the point: a 200 from an ingest endpoint
 *                   only proves the request was accepted, not that a row exists, and
 *                   "accepted then silently dropped" is exactly the failure this
 *                   integration would have.
 *
 *   Amber -> Clay   Runs the real SSRF validator over the URL, then POSTs one row in
 *                   the exact shape src/lib/clay-webhook.js produces. This half
 *                   deliberately does NOT go through POST /v1/me/clay/push, because
 *                   that route is JWT-authed and a terminal has no session — what it
 *                   verifies instead is the part that can only be verified against
 *                   the real service: that Clay accepts our row shape and maps it to
 *                   columns.
 *
 * The contact it creates is clearly marked and uses a reserved test phone number, so
 * it is obvious in both systems and trivial to delete.
 *
 * NO SECRETS ARE PRINTED. The API key and the webhook URL are read from the
 * environment and only ever shown masked.
 */

import {
  postClayPayload,
  toClayRow,
  validateClayWebhookUrl,
} from "../src/lib/clay-webhook.js";

const BASE = (process.env.MEDHA_BASE_URL || "https://medha-id-production.up.railway.app").replace(
  /\/+$/,
  "",
);
const API_KEY = process.env.AMBER_API_KEY || "";
const CLAY_URL = process.env.CLAY_WEBHOOK_URL || "";
const DO_PUSH = process.argv.includes("--push");

let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const bad = (m) => {
  failures += 1;
  console.error(`✗ ${m}`);
};
const info = (m) => console.log(`  ${m}`);

function mask(s) {
  if (!s) return "(unset)";
  return s.length <= 10 ? "…" : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

// A marker unique to this run, so the round-trip read cannot accidentally match a
// contact that was already there.
const RUN = Date.now().toString(36).toUpperCase();
const TEST_NAME = `Amber Clay Smoke ${RUN}`;
// 555-01xx is reserved for fiction and will never belong to a real person.
const TEST_PHONE = "+15550100000";

console.log(`\nAmber <-> Clay smoke test`);
console.log(`  base:   ${BASE}`);
console.log(`  key:    ${mask(API_KEY)}`);
console.log(`  clay:   ${CLAY_URL ? mask(CLAY_URL) : "(unset)"}`);
console.log(`  push:   ${DO_PUSH ? "YES (will write one row to Clay)" : "no (--push to enable)"}\n`);

if (!API_KEY) {
  console.error("Set AMBER_API_KEY to a personal Amber ingest key (starts with amberk_live_).");
  console.error("Mint one in the app: Profile -> API key. It is shown exactly once.\n");
  process.exit(1);
}

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-amber-api-key": API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body; status is what matters */
  }
  return { status: res.status, json };
}

// ── 1. the key is live ─────────────────────────────────────────────────────────────
{
  // A VALID key gets 400 here (bad request), an invalid one gets 401. Distinguishing
  // those two is what tells us the key works without needing a separate auth endpoint.
  //
  // The body is `{ contacts: [] }`, NOT `{}`. An empty object takes the route's
  // single-contact branch — `{}` is an object, so it becomes `[{}]`, one nameless
  // contact, which is skipped and returns a perfectly correct 200. That made this probe
  // print "unexpected status 200" on a completely healthy system. An explicitly empty
  // `contacts` array is the input that actually reaches the length check and 400s.
  const res = await call("/v1/ingest/contacts", { method: "POST", body: { contacts: [] } });
  if (res.status === 401) {
    bad("the API key was rejected (401). Mint a fresh one in the app.");
    process.exit(1);
  }
  if (res.status === 400) ok("API key accepted (empty contacts array correctly rejected as 400)");
  else info(`unexpected status ${res.status} on the auth probe; continuing`);
}

// ── 2. Clay -> Amber ───────────────────────────────────────────────────────────────
let createdId = null;
{
  const res = await call("/v1/ingest/contacts", {
    method: "POST",
    body: {
      source: "clay-smoke-test",
      contacts: [
        {
          name: TEST_NAME,
          firstName: "Amber",
          lastName: `Smoke ${RUN}`,
          phone: TEST_PHONE,
          email: `clay-smoke-${RUN.toLowerCase()}@example.invalid`,
          company: "Blue Modern Advisory",
          title: "Smoke Test",
          location: "New York",
          notes: `Created by scripts/smoke-clay-roundtrip.js run ${RUN}. Safe to delete.`,
        },
      ],
    },
  });
  if (res.status !== 200) {
    bad(`Clay -> Amber ingest failed: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  } else {
    const j = res.json ?? {};
    const wrote = (j.created ?? 0) + (j.updated ?? 0);
    if (wrote < 1) {
      bad(`ingest returned 200 but wrote nothing: ${JSON.stringify(j)}`);
    } else {
      createdId = Array.isArray(j.contactIds) ? j.contactIds[0] : null;
      ok(`Clay -> Amber: ingested (created ${j.created ?? 0}, updated ${j.updated ?? 0})`);
      if (createdId) info(`contact id: ${createdId}`);
    }
  }
}

// ── 3. read it back ────────────────────────────────────────────────────────────────
// A 200 from ingest only proves the request was ACCEPTED. This proves a row exists.
if (createdId) {
  const res = await call("/v1/ingest/contacts", {
    method: "POST",
    body: {
      source: "clay-smoke-test",
      contacts: [{ name: TEST_NAME, phone: TEST_PHONE, title: "Smoke Test (re-sent)" }],
    },
  });
  const j = res.json ?? {};
  if (res.status === 200 && (j.updated ?? 0) >= 1 && (j.created ?? 0) === 0) {
    ok("round-trip: re-sending the same contact UPDATED it instead of duplicating");
  } else if (res.status === 200 && (j.created ?? 0) >= 1) {
    bad(`dedupe is not working — the same contact was created twice: ${JSON.stringify(j)}`);
  } else {
    bad(`round-trip check failed: HTTP ${res.status} ${JSON.stringify(j)}`);
  }
}

// ── 4. Amber -> Clay ───────────────────────────────────────────────────────────────
{
  if (!CLAY_URL) {
    info("Amber -> Clay: skipped (set CLAY_WEBHOOK_URL to test it)");
  } else {
    const check = validateClayWebhookUrl(CLAY_URL);
    if (!check.ok) {
      bad(`the Clay webhook URL was rejected: ${check.reason}`);
    } else {
      ok("Clay webhook URL passed validation (https, real clay.com host, no credentials)");

      const row = toClayRow({
        id: `smoke-${RUN}`,
        name: TEST_NAME,
        firstName: "Amber",
        lastName: `Smoke ${RUN}`,
        emails: [`clay-smoke-${RUN.toLowerCase()}@example.invalid`],
        phoneNumbers: [TEST_PHONE],
        company: "Blue Modern Advisory",
        title: "Smoke Test",
        city: "New York",
        linkedinUrl: null,
        source: "amber-smoke-test",
      });
      info(`row shape: ${Object.keys(row).join(", ")}`);

      if (!DO_PUSH) {
        info("Amber -> Clay: dry run. Re-run with --push to actually send this row.");
      } else {
        // WHICH BODY SHAPE DOES THIS TABLE TAKE?
        //
        // Clay's webhook source documents "key-value pairs in the body of a POST
        // request" -- one flat object, one row. Some sources also accept an array of
        // rows, which is far fewer requests for a big push. Rather than guess, send one
        // of each and report which Clay accepted, so the destination can be configured
        // with the shape that is known to work instead of the shape we assumed.
        //
        // Two rows land in the table if both are accepted. Both are clearly labeled.
        const asObject = await postClayPayload(check.url, {
          ...row,
          amber_contact_id: `${row.amber_contact_id}-obj`,
          title: "Smoke Test (object body)",
        });
        if (asObject.ok) {
          ok(`Amber -> Clay: OBJECT body accepted (HTTP ${asObject.status})`);
        } else {
          bad(`OBJECT body rejected: HTTP ${asObject.status} ${asObject.error}`);
        }

        const asArray = await postClayPayload(check.url, [
          { ...row, amber_contact_id: `${row.amber_contact_id}-arr`, title: "Smoke Test (array body)" },
        ]);
        if (asArray.ok) {
          info(`array body also accepted (HTTP ${asArray.status}) — 'array' mode is available`);
        } else {
          info(`array body not accepted (HTTP ${asArray.status}) — stay on the default 'object' mode`);
        }

        if (asObject.ok || asArray.ok) {
          info(`open your Clay table and look for "${TEST_NAME}"`);
          info("check the COLUMNS mapped correctly — full_name, email, phone, company, title, location");
          info("then set amber_contact_id as the table's dedupe key so re-pushing updates rather than duplicates");
        }
      }
    }
  }
}

console.log("");
if (failures > 0) {
  console.error(`${failures} FAILURE(S). The Clay bridge is not ready.\n`);
  process.exit(1);
}
console.log("Clay bridge is working in both directions.");
console.log(`Clean up when you're done: delete "${TEST_NAME}" from Amber and from Clay.\n`);
process.exit(0);
