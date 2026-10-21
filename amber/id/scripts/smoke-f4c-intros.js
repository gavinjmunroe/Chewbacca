// Throwaway integration smoke for F4c intro requests, against live Cloud SQL
// amber DB with synthetic users. Exercises the real store + viewer-context
// composition the routes sit on. No HTTP boot — the routes are thin wrappers
// over these functions plus the same authorization checks reproduced here.
//
// Run: railway run node scripts/smoke-f4c-intros.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-f4c.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { getViewerContext } = await import("../src/privacy/viewer-context.js");
const { getContactById } = await import("../src/db/store.js");
const { createIntroRequest, listIntros, getIntroById, setIntroStatus } = await import(
  "../src/db/intros-store.js"
);

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

// Reproduces the route's create authorization (POST /v1/me/intros): a sharing
// mutual of the owner, and the contact belongs to the owner.
async function canCreate(requester, owner, contactId) {
  const ctx = await getViewerContext(requester, owner);
  if (!(ctx.connected && ctx.ownerShares)) return false;
  const contact = await getContactById(owner, contactId);
  return !!contact;
}

// Reproduces the route's contact-release gate (GET /v1/me/intros/:id/contact):
// requester only, approved only. Returns the contact methods or null.
async function releaseContact(intro, caller) {
  if (!intro) return null;
  if (intro.requesterAmberId !== caller) return null;
  if (intro.status !== "approved") return null;
  const contact = await getContactById(intro.ownerAmberId, intro.contactId);
  if (!contact) return null;
  return { phone: contact.phone ?? null, email: contact.email ?? null, emails: contact.emails ?? [] };
}

const A = randomUUID(); // requester (connected mutual of B)
const B = randomUUID(); // owner (full_social) — holds contact X
const C = randomUUID(); // non-mutual requester (connected to nobody)
const rnd = () => String(Math.floor(1000000 + Math.random() * 8999999));
const suffix = rnd();
let contactX = null;

try {
  // Owner B: full_social.
  await query(
    `INSERT INTO users (amber_id, phone, status, full_name, username, privacy_tier)
     VALUES ($1, $2, 'active', 'Bella Owner', $3, 'full_social')`,
    [B, "+1999" + suffix, "bella_" + suffix],
  );
  // Requester A (connected mutual).
  await query(
    `INSERT INTO users (amber_id, phone, status, full_name, username) VALUES ($1, $2, 'active', 'Al Viewer', $3)`,
    [A, "+1998" + suffix, "al_" + suffix],
  );
  // Non-mutual requester C.
  await query(
    `INSERT INTO users (amber_id, phone, status, full_name, username) VALUES ($1, $2, 'active', 'Cy Stranger', $3)`,
    [C, "+1997" + suffix, "cy_" + suffix],
  );
  // Connection A<->B only (canonical a_amber_id < b_amber_id). C stays unconnected.
  const ua = A < B ? A : B;
  const ub = A < B ? B : A;
  await query(`INSERT INTO connections (a_amber_id, b_amber_id) VALUES ($1, $2)`, [ua, ub]);
  // B's contact X with phone + email.
  const { rows } = await query(
    `INSERT INTO contacts (owner_id, full_name, company, phone_primary, phone_primary_normalized, emails, source)
     VALUES ($1, 'Xavier Contact', 'Acme', '+13125559999', '13125559999', 'xavier@acme.com', 'smoke')
     RETURNING id`,
    [B],
  );
  contactX = Number(rows[0].id);

  // ── 1) A may create an intro for X (connected + B shares + X is B's) ──
  check("A authorized to create intro for X", await canCreate(A, B, contactX));
  const intro = await createIntroRequest({
    requesterAmberId: A,
    ownerAmberId: B,
    contactId: contactX,
    message: "Would love an intro to Xavier",
  });
  check("intro created, status pending", intro?.status === "pending", JSON.stringify(intro));

  // ── 2) Idempotent: A asks again → same pending row, no duplicate ──
  const introDup = await createIntroRequest({ requesterAmberId: A, ownerAmberId: B, contactId: contactX });
  check("duplicate create returns same intro (idempotent)", introDup?.id === intro?.id, JSON.stringify(introDup));

  // ── 3) While pending, A cannot see contact methods ──
  const denied = await releaseContact(intro, A);
  check("A denied contact while pending", denied === null, JSON.stringify(denied));

  // ── 4) Non-mutual C cannot create an intro for X ──
  check("C NOT authorized to create intro (not connected)", !(await canCreate(C, B, contactX)));

  // ── 5) B approves → A can now see phone + email ──
  const approved = setIntroStatus ? await setIntroStatus(intro.id, B, "approved") : null;
  check("B approved the intro", approved?.status === "approved" && !!approved?.respondedAt, JSON.stringify(approved));
  // Only the owner may act: A cannot approve.
  const aTriesApprove = await setIntroStatus(intro.id, A, "approved");
  check("A cannot act on intro (owner-only)", aTriesApprove === null, JSON.stringify(aTriesApprove));

  const afterApprove = await getIntroById(intro.id);
  const released = await releaseContact(afterApprove, A);
  check("A sees phone after approve", released?.phone === "+13125559999", JSON.stringify(released));
  check("A sees email after approve", released?.email === "xavier@acme.com" || (released?.emails || []).includes("xavier@acme.com"), JSON.stringify(released));

  // ── 6) A sees the intro in outgoing; B sees it in incoming ──
  const outgoing = await listIntros(A, "outgoing");
  check("A lists intro as outgoing", outgoing.some((i) => i.id === intro.id));
  const incoming = await listIntros(B, "incoming");
  check("B lists intro as incoming", incoming.some((i) => i.id === intro.id));

  // ── 7) A second intro (different contact) that B declines → A still denied ──
  const { rows: rows2 } = await query(
    `INSERT INTO contacts (owner_id, full_name, phone_primary, phone_primary_normalized, emails, source)
     VALUES ($1, 'Yara Contact', '+13125558888', '13125558888', 'yara@acme.com', 'smoke')
     RETURNING id`,
    [B],
  );
  const contactY = Number(rows2[0].id);
  const intro2 = await createIntroRequest({ requesterAmberId: A, ownerAmberId: B, contactId: contactY });
  const declined = await setIntroStatus(intro2.id, B, "declined");
  check("B declined the second intro", declined?.status === "declined", JSON.stringify(declined));
  const declinedRelease = await releaseContact(await getIntroById(intro2.id), A);
  check("A denied contact after decline", declinedRelease === null, JSON.stringify(declinedRelease));
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  try {
    await query(`DELETE FROM intro_requests WHERE requester_amber_id = ANY($1::uuid[]) OR owner_amber_id = ANY($1::uuid[])`, [[A, B, C]]);
    await query(`DELETE FROM contacts WHERE owner_id = $1`, [B]);
    await query(`DELETE FROM connections WHERE a_amber_id = ANY($1::uuid[]) OR b_amber_id = ANY($1::uuid[])`, [[A, B, C]]);
    await query(`DELETE FROM users WHERE amber_id = ANY($1::uuid[])`, [[A, B, C]]);
    console.log("✅ cleanup done");
  } catch (e) {
    console.log(`❌ cleanup failed: ${e?.message || e}`);
    failed = true;
  }
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
