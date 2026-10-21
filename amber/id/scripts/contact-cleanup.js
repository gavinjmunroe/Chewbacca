/**
 * One-owner contact cleanup — DRY-RUN BY DEFAULT.
 *
 *   node scripts/contact-cleanup.js                      # dry run, writes NOTHING
 *   node scripts/contact-cleanup.js --apply              # writes, after saving a manifest
 *   node scripts/contact-cleanup.js --rollback <file>    # undoes an applied run
 *
 * Four steps, each independently reversible:
 *   1. soft-delete nameless Google otherContacts junk (no name AND no phone)
 *   2. soft-delete phone-less Google otherContacts whose NAME is an org/support
 *      pattern (review-gated: the dry run prints the full matched list)
 *   3. merge 14 pinned Apple↔Google twins (survivor = the Apple row)
 *   4. move 17 label-ish `company` values into `tags`
 *
 * Safety properties:
 *   - every statement is scoped by owner_id
 *   - the pinned merge ids are RE-VERIFIED against live rows before each write;
 *     any drift skips that merge instead of guessing
 *   - each merge runs in its own transaction, so one failure can't half-apply
 *   - nothing is hard-deleted: rows get deleted_at, fields keep prior values in
 *     the manifest, provenance re-points are logged with their original
 *     contact_id
 *   - the manifest is written and fsync'd BEFORE the first write
 *
 * Not in scope (deliberately): Globex, the 6 ambiguous company values, the
 * Hinge down-weight (no recency data exists — see the dry-run report).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (credsJson) {
  const t = path.join(os.tmpdir(), "gcp-sa-contact-cleanup.json");
  fs.writeFileSync(t, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = t;
}
const { query, withTransaction } = await import("../src/db/sql.js");

// ── config ───────────────────────────────────────────────────────────────────
const OWNER_PHONE = "+15550100001";
const EXPECT_OWNER = "35a94acc-5d39-488b-9b01-a239c8255076";

// Pinned from the dry-run report. survivor = apple row, absorb = google row(s).
const MERGES = [
  { name: "ritvik manda", survivor: 2235, absorb: [17160] },
  { name: "varsha chari", survivor: 2241, absorb: [16990] },
  { name: "sagar tiwari", survivor: 2249, absorb: [17263] },
  { name: "sam movish", survivor: 2273, absorb: [17024] },
  { name: "akshay mohan", survivor: 2321, absorb: [17159] },
  { name: "adil rahman", survivor: 2369, absorb: [16969] },
  { name: "meet patel", survivor: 2422, absorb: [16986, 16987], flagged: true },
  { name: "karthik devarakonda", survivor: 2432, absorb: [16978, 17301], flagged: true },
  { name: "josh bernson", survivor: 2493, absorb: [17219] },
  { name: "caden mcmann", survivor: 2500, absorb: [17116] },
  { name: "andrew olson", survivor: 2735, absorb: [17107] },
  { name: "kevin cong", survivor: 2862, absorb: [17283] },
  { name: "aman cheema", survivor: 2918, absorb: [17274] },
  { name: "decharie wong", survivor: 2950, absorb: [17294] },
];

// company value → tag to write. Globex and the 6 ambiguous values are absent
// on purpose.
const TAG_MAP = {
  "Hinge": "hinge",
  "USC Intern": "usc-intern",
  "Amber Intern": "amber-intern",
  "Neighbor": "neighbor",
  "Parking": "parking",
  "Uber driver": "uber-driver",
  "Chicago Driver": "chicago-driver",
  "Met At Deuces": "met-at-deuces",
  "3751 Unit 2": "3751-unit-2",
  "Pickleball": "pickleball",
  "IU Guy": "iu-guy",
  "Front Desk": "front-desk",
  "Sheetal Bday": "sheetal-bday",
  "Dispensary Cute Girl": "dispensary-cute-girl",
  "Drews Friend (cool As Shit Mixed Bitch)": "drews-friend",
  "AKPSi Shria’s Friend": "akpsi-shrias-friend",
  "your actor": "your-actor",
};

// Reviewed and spared by the owner (2026-08-03 dry-run review):
//   17223 LA Phil Audience Services — a venue the owner may actually want
//   17279 Corp (corp@pasricha.com)  — same domain as a real contact (aman@),
//                                     so more likely a person's alias than an org
const ORG_EXCLUDE_IDS = new Set(["17223", "17279"]);

// Org / support names. Anchored on word boundaries so "Corporate Cathy" or a
// person named "Ford" never matches.
const ORG_PATTERNS = [
  /\binc\.?$/i, /\bl\.?l\.?c\.?$/i, /\bltd\.?$/i, /\bcorp(oration)?\.?$/i,
  /\brealty\b/i, /\bequities\b/i, /\bcapital\b/i, /\bpartners\b/i,
  /\bgroup\b/i, /\bmanagement\b/i, /\bservices\b/i,
  /\bsupport\b/i, /\baudience services\b/i, /\bcustomer support\b/i,
];

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ROLLBACK_IDX = argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX >= 0 ? argv[ROLLBACK_IDX + 1] : null;

const L = (s = "") => console.log(s);
const rule = (c = "─") => L(c.repeat(78));
const normName = (s) => (s || "").toLowerCase().trim().replace(/\s+/g, " ");
const digits = (s) => String(s || "").replace(/\D/g, "");
function normPhone(row) {
  let d = digits(row.phone_primary_normalized || row.phone_primary);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}
const emailList = (s) =>
  (s || "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));

// ── rollback mode ────────────────────────────────────────────────────────────
if (ROLLBACK_FILE) {
  const m = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
  L(`ROLLBACK from ${ROLLBACK_FILE}`);
  L(`  applied at ${m.appliedAt} for owner ${m.owner}`);
  let restored = 0;

  await withTransaction(async (c) => {
    // 4. tags → restore prior tags + company
    for (const t of m.tags || []) {
      await c.query(
        `UPDATE contacts SET tags = $3, company = $4, updated_at = $5
          WHERE owner_id = $1 AND id = $2`,
        [m.owner, t.id, t.priorTags, t.priorCompany, t.priorUpdatedAt],
      );
      restored += 1;
    }
    // 3. merges → un-delete absorbed, re-point provenance back, restore survivor
    for (const mg of m.merges || []) {
      for (const p of mg.provenanceRepointed || []) {
        await c.query(
          `UPDATE contact_sources SET contact_id = $3 WHERE owner_id = $1::text AND id = $2`,
          [m.owner, p.provenanceId, p.priorContactId],
        );
        restored += 1;
      }
      for (const p of mg.provenanceCreated || []) {
        await c.query(`DELETE FROM contact_sources WHERE owner_id = $1::text AND id = $2`, [
          m.owner,
          p.provenanceId,
        ]);
        restored += 1;
      }
      for (const a of mg.absorbed || []) {
        await c.query(
          `UPDATE contacts SET deleted_at = $3 WHERE owner_id = $1 AND id = $2`,
          [m.owner, a.id, a.priorDeletedAt],
        );
        restored += 1;
      }
      await c.query(
        `UPDATE contacts SET emails = $3, company = $4, updated_at = $5
          WHERE owner_id = $1 AND id = $2`,
        [m.owner, mg.survivorId, mg.priorEmails, mg.priorCompany, mg.priorUpdatedAt],
      );
      restored += 1;
    }
    // 1+2. soft-deletes → restore prior deleted_at (null)
    for (const d of m.softDeleted || []) {
      await c.query(`UPDATE contacts SET deleted_at = $3 WHERE owner_id = $1 AND id = $2`, [
        m.owner,
        d.id,
        d.priorDeletedAt,
      ]);
      restored += 1;
    }
  });

  const { rows: after } = await query(
    `SELECT count(*) n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`,
    [m.owner],
  );
  L(`  ${restored} statements applied. live contacts now: ${after[0].n}`);
  process.exit(0);
}

// ── load ─────────────────────────────────────────────────────────────────────
const { rows: owners } = await query(
  `SELECT amber_id, full_name FROM users WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
  [OWNER_PHONE],
);
if (!owners[0]) throw new Error(`no owner for ${OWNER_PHONE}`);
const OWNER = owners[0].amber_id;
if (OWNER !== EXPECT_OWNER) {
  throw new Error(`owner mismatch: resolved ${OWNER}, expected ${EXPECT_OWNER} — refusing to run`);
}

const { rows: contacts } = await query(
  `SELECT id, external_id, source, full_name, company, phone_primary,
          phone_primary_normalized, emails, tags, linked_amber_id, updated_at
     FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY id`,
  [OWNER],
);
const byId = new Map(contacts.map((c) => [String(c.id), c]));
const { rows: provenance } = await query(
  `SELECT id, contact_id, source, external_id FROM contact_sources
    WHERE owner_id = $1::text AND deleted_at IS NULL`,
  [OWNER],
);
const provByContact = new Map();
for (const p of provenance) {
  const k = String(p.contact_id);
  if (!provByContact.has(k)) provByContact.set(k, []);
  provByContact.get(k).push(p);
}

const isOtherContacts = (r) =>
  String(r.source) === "google" && /^otherContacts\//.test(String(r.external_id || ""));

L();
rule("═");
L(`CONTACT CLEANUP — ${APPLY ? "APPLY" : "DRY RUN (no writes)"}`);
L(`owner ${owners[0].full_name} / ${OWNER}`);
L(`live contacts before: ${contacts.length}`);
rule("═");

// ── step 1: nameless junk ────────────────────────────────────────────────────
const junk = contacts.filter((r) => !normName(r.full_name) && !normPhone(r) && isOtherContacts(r));
L();
L(`STEP 1 — soft-delete nameless Google otherContacts: ${junk.length} rows`);
L(`  guard: rows with a name  ${junk.filter((r) => normName(r.full_name)).length} (must be 0)`);
L(`  guard: rows with a phone ${junk.filter((r) => normPhone(r)).length} (must be 0)`);
L(`  guard: linked to a user  ${junk.filter((r) => r.linked_amber_id).length} (must be 0)`);
if (junk.some((r) => normName(r.full_name) || normPhone(r) || r.linked_amber_id)) {
  throw new Error("step 1 guard failed — refusing to run");
}

// ── step 2: narrow org rule (review-gated) ───────────────────────────────────
const orgRuleHits = contacts.filter(
  (r) =>
    isOtherContacts(r) &&
    !normPhone(r) &&
    !r.linked_amber_id &&
    normName(r.full_name) &&
    ORG_PATTERNS.some((re) => re.test(r.full_name)),
);
const orgExcluded = orgRuleHits.filter((r) => ORG_EXCLUDE_IDS.has(String(r.id)));
const orgMatches = orgRuleHits.filter((r) => !ORG_EXCLUDE_IDS.has(String(r.id)));
L();
L(`STEP 2 — NARROW ORG RULE — REVIEW LIST (${orgMatches.length} rows; ${orgExcluded.length} spared by review)`);
rule();
for (const r of orgMatches) {
  L(`  id=${String(r.id).padEnd(6)} ${String(r.full_name).padEnd(30)} ${(emailList(r.emails)[0] || "-").slice(0, 44)}`);
}
rule();
for (const r of orgExcluded) {
  L(`  SPARED (excluded by review)  id=${r.id}  ${r.full_name}`);
}
L(`  guard: any with a phone      ${orgMatches.filter((r) => normPhone(r)).length} (must be 0)`);
L(`  guard: any linked to a user  ${orgMatches.filter((r) => r.linked_amber_id).length} (must be 0)`);
L(`  guard: any also in step 1    ${orgMatches.filter((r) => junk.some((j) => j.id === r.id)).length} (must be 0)`);
L(`  guard: excluded ids present  ${orgMatches.filter((r) => ORG_EXCLUDE_IDS.has(String(r.id))).length} (must be 0)`);
if (orgMatches.some((r) => normPhone(r) || r.linked_amber_id || ORG_EXCLUDE_IDS.has(String(r.id)))) {
  throw new Error("step 2 guard failed — refusing to run");
}

// ── step 3: merges (verify pinned ids against live rows) ─────────────────────
L();
L(`STEP 3 — cross-source merges: ${MERGES.length} pinned`);
const mergePlan = [];
for (const m of MERGES) {
  const survivor = byId.get(String(m.survivor));
  const absorbed = m.absorb.map((id) => byId.get(String(id)));
  const problems = [];
  if (!survivor) problems.push(`survivor ${m.survivor} not live`);
  else {
    if (survivor.source !== "apple") problems.push(`survivor ${m.survivor} source=${survivor.source}, expected apple`);
    if (normName(survivor.full_name) !== m.name) problems.push(`survivor name drifted: "${survivor.full_name}"`);
  }
  absorbed.forEach((a, i) => {
    const id = m.absorb[i];
    if (!a) problems.push(`absorb ${id} not live`);
    else {
      if (a.source !== "google") problems.push(`absorb ${id} source=${a.source}, expected google`);
      if (normName(a.full_name) !== m.name) problems.push(`absorb ${id} name drifted: "${a.full_name}"`);
      if (normPhone(a) && survivor && normPhone(survivor) && normPhone(a) !== normPhone(survivor)) {
        problems.push(`absorb ${id} has a CONFLICTING phone`);
      }
    }
  });
  if (problems.length) {
    L(`  ⚠ SKIP ${m.name}: ${problems.join("; ")}`);
    continue;
  }
  const mergedEmails = [
    ...new Set([...emailList(survivor.emails), ...absorbed.flatMap((a) => emailList(a.emails))]),
  ];
  const newCompany = survivor.company ?? absorbed.map((a) => a.company).find(Boolean) ?? null;
  // Provenance: absorbed rows' rows get re-pointed; the survivor needs one
  // created when the Apple bulk import never wrote it.
  const survivorProv = provByContact.get(String(survivor.id)) || [];
  const needsOwnProv =
    survivor.external_id &&
    !survivorProv.some((p) => p.source === survivor.source && p.external_id === survivor.external_id);
  mergePlan.push({ ...m, survivor, absorbed, mergedEmails, newCompany, needsOwnProv });
  L(
    `  ${m.flagged ? "⚑" : " "} ${m.name.padEnd(22)} keep ${String(survivor.id).padEnd(6)} ` +
      `absorb ${m.absorb.join(",").padEnd(13)} emails→${mergedEmails.length} ` +
      `company→${newCompany ?? "-"}${needsOwnProv ? "  +create survivor provenance" : ""}`,
  );
}
L(`  executable: ${mergePlan.length} / ${MERGES.length}`);

// ── step 4: tags ─────────────────────────────────────────────────────────────
const tagPlan = [];
for (const r of contacts) {
  const company = (r.company || "").trim();
  const tag = TAG_MAP[company];
  if (!tag) continue;
  tagPlan.push({ row: r, tag, priorCompany: r.company, priorTags: r.tags ?? null });
}
L();
L(`STEP 4 — company → tag: ${tagPlan.length} rows across ${new Set(tagPlan.map((t) => t.tag)).size} values`);
const perTag = new Map();
for (const t of tagPlan) perTag.set(t.tag, (perTag.get(t.tag) || 0) + 1);
L(`  ${[...perTag.entries()].map(([t, n]) => `${t}×${n}`).join("  ")}`);
L(`  guard: any Globex row in the plan: ${tagPlan.filter((t) => t.priorCompany === "Globex").length} (must be 0)`);
if (tagPlan.some((t) => t.priorCompany === "Globex")) throw new Error("step 4 guard failed — Globex must not be touched");

// ── totals ───────────────────────────────────────────────────────────────────
const totalDeleted = junk.length + orgMatches.length + mergePlan.reduce((n, m) => n + m.absorbed.length, 0);
L();
rule("═");
L("TOTALS");
L(`  soft-deleted: ${junk.length} (junk) + ${orgMatches.length} (org) + ${mergePlan.reduce((n, m) => n + m.absorbed.length, 0)} (absorbed) = ${totalDeleted}`);
L(`  merges executed: ${mergePlan.length}   tag rows updated: ${tagPlan.length}`);
L(`  live contacts: ${contacts.length} → ${contacts.length - totalDeleted}`);
rule("═");

if (!APPLY) {
  L();
  L("DRY RUN — nothing was written. Re-run with --apply to execute.");
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const manifestPath = `/tmp/contact-cleanup-manifest-${ts}.json`;
const manifest = {
  appliedAt: new Date().toISOString(),
  owner: OWNER,
  ownerPhone: OWNER_PHONE,
  liveBefore: contacts.length,
  softDeleted: [],
  merges: [],
  tags: [],
};

// Pre-write the manifest with everything we intend to do, so a crash mid-run
// still leaves a rollback path for the rows already touched.
for (const r of [...junk, ...orgMatches]) {
  manifest.softDeleted.push({
    id: String(r.id),
    reason: junk.includes(r) ? "junk_nameless" : "org_rule",
    priorDeletedAt: null,
    name: r.full_name,
    email: emailList(r.emails)[0] ?? null,
  });
}
for (const m of mergePlan) {
  manifest.merges.push({
    name: m.name,
    survivorId: String(m.survivor.id),
    priorEmails: m.survivor.emails,
    priorCompany: m.survivor.company,
    priorUpdatedAt: m.survivor.updated_at,
    newEmails: m.mergedEmails.join(", "),
    newCompany: m.newCompany,
    absorbed: m.absorbed.map((a) => ({ id: String(a.id), priorDeletedAt: null })),
    provenanceRepointed: m.absorbed.flatMap((a) =>
      (provByContact.get(String(a.id)) || []).map((p) => ({
        provenanceId: String(p.id),
        priorContactId: String(p.contact_id),
        source: p.source,
        externalId: p.external_id,
      })),
    ),
    provenanceCreated: [], // filled in after the INSERT returns an id
  });
}
for (const t of tagPlan) {
  manifest.tags.push({
    id: String(t.row.id),
    tag: t.tag,
    priorTags: t.priorTags,
    priorCompany: t.priorCompany,
    priorUpdatedAt: t.row.updated_at,
  });
}

function saveManifest() {
  const fd = fs.openSync(manifestPath, "w");
  fs.writeFileSync(fd, JSON.stringify(manifest, null, 2));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}
saveManifest();
L();
L(`manifest written: ${manifestPath}`);

// 1+2: soft-deletes, one transaction (they are pure deleted_at flips).
const deleteIds = [...junk, ...orgMatches].map((r) => String(r.id));
await withTransaction(async (c) => {
  await c.query(
    `UPDATE contacts SET deleted_at = now()
      WHERE owner_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
    [OWNER, deleteIds],
  );
});
L(`step 1+2: soft-deleted ${deleteIds.length} rows`);

// 3: merges, one transaction each.
let merged = 0;
for (const [i, m] of mergePlan.entries()) {
  try {
    await withTransaction(async (c) => {
      // Re-verify inside the transaction: the rows must still be live.
      const { rows: live } = await c.query(
        `SELECT id FROM contacts WHERE owner_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
        [OWNER, [m.survivor.id, ...m.absorbed.map((a) => a.id)].map(String)],
      );
      if (live.length !== 1 + m.absorbed.length) throw new Error("rows changed since planning");

      if (m.needsOwnProv) {
        const { rows } = await c.query(
          `INSERT INTO contact_sources (owner_id, contact_id, source, external_id, raw_full_name)
           VALUES ($1::text, $2, $3, $4, $5)
           ON CONFLICT (owner_id, source, external_id) WHERE deleted_at IS NULL
           DO UPDATE SET contact_id = EXCLUDED.contact_id
           RETURNING id`,
          [OWNER, m.survivor.id, m.survivor.source, m.survivor.external_id, m.survivor.full_name],
        );
        if (rows[0]?.id) {
          manifest.merges[i].provenanceCreated.push({ provenanceId: String(rows[0].id) });
        }
      }
      for (const p of manifest.merges[i].provenanceRepointed) {
        await c.query(
          `UPDATE contact_sources SET contact_id = $3, updated_at = now()
            WHERE owner_id = $1::text AND id = $2`,
          [OWNER, p.provenanceId, m.survivor.id],
        );
      }
      await c.query(
        `UPDATE contacts SET emails = $3, company = $4, updated_at = now()
          WHERE owner_id = $1 AND id = $2`,
        [OWNER, m.survivor.id, m.mergedEmails.join(", ") || null, m.newCompany],
      );
      await c.query(
        `UPDATE contacts SET deleted_at = now()
          WHERE owner_id = $1 AND id = ANY($2::bigint[])`,
        [OWNER, m.absorbed.map((a) => String(a.id))],
      );
    });
    merged += 1;
    saveManifest(); // capture any provenanceCreated id as soon as it exists
  } catch (err) {
    L(`  ⚠ merge ${m.name} FAILED and rolled back: ${err.message}`);
    manifest.merges[i].failed = err.message;
    saveManifest();
  }
}
L(`step 3: merged ${merged} / ${mergePlan.length}`);

// 4: tags, one transaction.
await withTransaction(async (c) => {
  for (const t of tagPlan) {
    await c.query(
      `UPDATE contacts
          SET tags = (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(tags, '{}') || $3::text[]) AS x),
              company = NULL,
              updated_at = now()
        WHERE owner_id = $1 AND id = $2`,
      [OWNER, t.row.id, [t.tag]],
    );
  }
});
L(`step 4: retagged ${tagPlan.length} rows`);

saveManifest();

const { rows: after } = await query(
  `SELECT count(*) n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`,
  [OWNER],
);
L();
rule("═");
L(`APPLIED. live contacts: ${contacts.length} → ${after[0].n}`);
L(`manifest: ${manifestPath}`);
L(`rollback: railway run --service medha-id -- node scripts/contact-cleanup.js --rollback ${manifestPath}`);
rule("═");
process.exit(0);
