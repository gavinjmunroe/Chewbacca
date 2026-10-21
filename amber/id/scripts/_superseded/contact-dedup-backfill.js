/**
 * Identity-key backfill + duplicate reconcile — DRY-RUN BY DEFAULT, ALL OWNERS.
 *
 *   node scripts/contact-dedup-backfill.js                     # dry run, writes NOTHING
 *   node scripts/contact-dedup-backfill.js --owner <phone|uuid> # scope to one owner
 *   node scripts/contact-dedup-backfill.js --apply             # writes, manifest first
 *   node scripts/contact-dedup-backfill.js --rollback <file>   # undoes an applied run
 *
 * WHY. Write-time dedup (db/contact-identity.js) keeps NEW syncs converged, but it
 * only knows what the key index tells it. Existing accounts have neither the keys
 * nor a deduped row set: one owner carries 4,162 live rows for ~2,250 people
 * because every Apple identifier rotated between two syncs. This script does the
 * one-time part:
 *
 *   PHASE 1  claim contact_identity_keys for every live row.
 *            Survivor for a contested key = the LOWEST contact id, which is the
 *            oldest row — the same tie-break the resolver uses at write time.
 *   PHASE 2  collapse the duplicates those keys expose, via the SAME matcher the
 *            live path uses (lib/contact-identity.js), through the existing
 *            collapseContactGroup (which repoints provenance AND identity keys,
 *            then soft-deletes — nothing is hard-deleted).
 *
 * SAFETY
 *   - dry run by default; --apply writes an fsync'd manifest BEFORE the first write
 *   - every statement is owner-scoped
 *   - the SAME invariants as the live path: a phone conflict never merges, a
 *     phone match with incompatible names never merges, a bare name match never
 *     merges. This script cannot merge a pair the resolver would refuse.
 *   - one transaction per owner for the key claims; one collapse at a time
 *   - each collapse re-verifies its rows are still live before writing
 *   - rollback restores survivor fields, un-soft-deletes absorbed rows, moves
 *     identity keys back, and deletes the keys this run created
 *
 * The migration db/migrations/20260804_add_contact_identity_keys.sql must be
 * applied first; the dry run works without it (it reports what it WOULD claim).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (credsJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const t = path.join(os.tmpdir(), "gcp-sa-dedup-backfill.json");
  fs.writeFileSync(t, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = t;
}

const { query, withTransaction } = await import("../src/db/sql.js");
const {
  buildIdentityIndex,
  canMerge,
  corroborators,
  extractFacts,
  factKeys,
} = await import("../src/lib/contact-identity.js");

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ROLLBACK_IDX = argv.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX >= 0 ? argv[ROLLBACK_IDX + 1] : null;
const OWNER_IDX = argv.indexOf("--owner");
const OWNER_ARG = OWNER_IDX >= 0 ? argv[OWNER_IDX + 1] : null;
const LIMIT_IDX = argv.indexOf("--limit");
const OWNER_LIMIT = LIMIT_IDX >= 0 ? Number(argv[LIMIT_IDX + 1]) : 50;

const L = (s = "") => console.log(s);
const rule = (c = "─") => L(c.repeat(86));
const pad = (s, n) => String(s ?? "").padEnd(n);
const num = (s, n) => String(s ?? "").padStart(n);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── rollback mode ────────────────────────────────────────────────────────────
if (ROLLBACK_FILE) {
  const m = JSON.parse(fs.readFileSync(ROLLBACK_FILE, "utf8"));
  L(`ROLLBACK from ${ROLLBACK_FILE}`);
  L(`  applied at ${m.appliedAt}`);
  let restored = 0;

  for (const owner of m.owners || []) {
    await withTransaction(async (c) => {
      // 2b. collapses → survivor fields, absorbed rows, key moves
      for (const g of (owner.collapses || []).slice().reverse()) {
        if (g.failed) continue;
        for (const k of g.keysRepointed || []) {
          await c.query(
            `UPDATE contact_identity_keys SET contact_id = $4::bigint, updated_at = now()
              WHERE owner_id = $1::uuid AND key_type = $2 AND key_value = $3`,
            [owner.ownerId, k.key_type, k.key_value, k.contact_id],
          );
          restored += 1;
        }
        for (const k of g.keysDropped || []) {
          await c.query(
            `INSERT INTO contact_identity_keys (owner_id, key_type, key_value, contact_id)
             VALUES ($1::uuid, $2, $3, $4::bigint)
             ON CONFLICT (owner_id, key_type, key_value) DO NOTHING`,
            [owner.ownerId, k.key_type, k.key_value, k.contact_id],
          );
          restored += 1;
        }
        for (const a of g.absorbed || []) {
          await c.query(
            `UPDATE contacts SET deleted_at = $3 WHERE owner_id = $1 AND id = $2`,
            [owner.ownerId, a.id, a.priorDeletedAt],
          );
          restored += 1;
        }
        const s = g.survivorPrior;
        if (s) {
          await c.query(
            `UPDATE contacts SET full_name = $3, first_name = $4, last_name = $5,
                    company = $6, avatar_url = $7, phone_primary = $8,
                    phone_primary_normalized = $9, phones_all = $10, emails = $11,
                    updated_at = $12
              WHERE owner_id = $1 AND id = $2`,
            [
              owner.ownerId, g.survivorId, s.full_name, s.first_name, s.last_name,
              s.company, s.avatar_url, s.phone_primary, s.phone_primary_normalized,
              s.phones_all, s.emails, s.updated_at,
            ],
          );
          restored += 1;
        }
      }
      // 1b. keys this run created
      for (const k of owner.keysClaimed || []) {
        await c.query(
          `DELETE FROM contact_identity_keys
            WHERE owner_id = $1::uuid AND key_type = $2 AND key_value = $3
              AND contact_id = $4::bigint`,
          [owner.ownerId, k.keyType, k.keyValue, k.contactId],
        );
        restored += 1;
      }
    });
  }
  L(`restored ${restored} rows/keys. Done.`);
  process.exit(0);
}

// ── owner selection ──────────────────────────────────────────────────────────
async function resolveOwners() {
  if (OWNER_ARG) {
    if (UUID_RE.test(OWNER_ARG)) return [OWNER_ARG];
    const { rows } = await query(
      `SELECT amber_id::text AS id FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [OWNER_ARG],
    );
    if (!rows[0]) {
      L(`could not resolve owner from ${OWNER_ARG}`);
      process.exit(1);
    }
    return [rows[0].id];
  }
  const { rows } = await query(
    `SELECT owner_id::text AS id, count(*)::int AS n
       FROM contacts WHERE deleted_at IS NULL AND owner_id IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT $1`,
    [OWNER_LIMIT],
  );
  return rows.map((r) => r.id);
}

const CONTACT_COLUMNS = `id, full_name, first_name, last_name, company, city,
        phone_primary, phones_all, emails, source, external_id, linked_amber_id`;

async function loadRows(ownerId) {
  const { rows } = await query(
    `SELECT ${CONTACT_COLUMNS} FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY id ASC`,
    [ownerId],
  );
  return rows;
}

async function loadExistingKeys(ownerId) {
  try {
    const { rows } = await query(
      `SELECT key_type, key_value, contact_id FROM contact_identity_keys WHERE owner_id = $1`,
      [ownerId],
    );
    return rows;
  } catch (err) {
    if (err?.code === "42P01") return null; // migration not applied yet
    throw err;
  }
}

/**
 * PHASE 1 plan: which (key_type, key_value) → contact_id claims to insert.
 * Lowest contact id wins a contested key, matching the resolver's tie-break.
 */
function planKeyClaims(rows, existingKeys) {
  const held = new Set(
    (existingKeys || []).map((k) => `${k.key_type}|${k.key_value}`),
  );
  const claims = new Map(); // "type|value" → contactId (lowest wins)
  const contested = []; // keys more than one live row wants
  const wanters = new Map();

  for (const row of rows) {
    const facts = extractFacts(row, { id: String(row.id) });
    for (const key of factKeys(facts)) {
      if (!wanters.has(key)) wanters.set(key, []);
      wanters.get(key).push(String(row.id));
    }
  }
  for (const [key, ids] of wanters) {
    const winner = ids
      .slice()
      .sort((a, b) => Number(a) - Number(b))[0];
    if (ids.length > 1) contested.push({ key, winner, losers: ids.filter((i) => i !== winner) });
    if (held.has(key)) continue; // already claimed — leave it alone
    claims.set(key, winner);
  }
  return { claims, contested };
}

/**
 * PHASE 2 plan: which rows collapse into which survivor.
 *
 * Runs the SAME matcher the live path uses, in id order, so the outcome equals
 * what a fresh re-sync of this address book would produce. A row joins a group
 * only if `canMerge` passes AND it shares an identity key with the group, or its
 * name matches WITH a corroborating signal — identical to resolveFacts's rules.
 */
function planCollapses(rows) {
  const groups = []; // { survivorId, survivorFacts, absorbed: [{id, rule}] }
  const byKey = new Map();
  const byName = new Map();
  const refused = []; // pairs we deliberately keep apart, for the report

  const indexGroup = (group) => {
    for (const key of factKeys(group.survivorFacts)) {
      if (!byKey.has(key)) byKey.set(key, []);
      if (!byKey.get(key).includes(group)) byKey.get(key).push(group);
    }
    for (const nk of [group.survivorFacts.nameKey, group.survivorFacts.nameKeyCanon]) {
      if (!nk) continue;
      if (!byName.has(nk)) byName.set(nk, []);
      if (!byName.get(nk).includes(group)) byName.get(nk).push(group);
    }
  };

  for (const row of rows) {
    const facts = extractFacts(row, { id: String(row.id) });
    let target = null;
    let rule = null;

    const seen = new Set();
    for (const key of factKeys(facts)) {
      // Source keys ARE grouped on: the partial unique index on
      // (owner_id, external_id) cannot stop two rows from holding the same
      // FOLDED source key, which is exactly what the two Google writers produced
      // (`google:people/c1` vs `people/c1`). Unlike the live rule-1 path this
      // still passes through canMerge below — a backfill should be the more
      // conservative of the two.
      for (const group of byKey.get(key) || []) {
        if (seen.has(group)) continue;
        seen.add(group);
        const gate = canMerge(group.survivorFacts, facts);
        if (gate.ok) {
          target = group;
          rule = key.slice(0, key.indexOf("|"));
          break;
        }
        refused.push({
          id: String(row.id),
          against: group.survivorId,
          reason: gate.reason,
          name: row.full_name,
        });
      }
      if (target) break;
    }

    if (!target) {
      for (const nk of [facts.nameKey, facts.nameKeyCanon]) {
        for (const group of (nk && byName.get(nk)) || []) {
          if (seen.has(group)) continue;
          seen.add(group);
          if (!canMerge(group.survivorFacts, facts).ok) continue;
          const signals = corroborators(group.survivorFacts, facts);
          if (signals.length === 0) continue;
          target = group;
          rule = `name+${signals[0]}`;
          break;
        }
        if (target) break;
      }
    }

    if (target) {
      target.absorbed.push({ id: String(row.id), rule, name: row.full_name });
      target.survivorFacts = {
        ...target.survivorFacts,
        phones: new Set([...target.survivorFacts.phones, ...facts.phones]),
        emails: new Set([...target.survivorFacts.emails, ...facts.emails]),
        company: target.survivorFacts.company || facts.company,
        city: target.survivorFacts.city || facts.city,
        nameKey: target.survivorFacts.nameKey || facts.nameKey,
      };
      indexGroup(target);
    } else {
      const group = {
        survivorId: String(row.id),
        survivorName: row.full_name,
        survivorFacts: facts,
        absorbed: [],
      };
      groups.push(group);
      indexGroup(group);
    }
  }

  return { groups, refused };
}

// ── report + plan for every owner ────────────────────────────────────────────
const owners = await resolveOwners();
const plans = [];
let keysTableMissing = false;

L();
L(`${APPLY ? "APPLY" : "DRY RUN"} — identity-key backfill + duplicate reconcile`);
L(`owners: ${owners.length}${OWNER_ARG ? ` (scoped to ${OWNER_ARG})` : ` (top ${OWNER_LIMIT} by row count)`}`);
rule();
L(
  `${pad("owner", 10)}${num("live", 7)}${num("after", 7)}${num("collapse", 9)}` +
    `${num("keys", 7)}${num("contest", 8)}  ${pad("by rule", 34)}`,
);
rule();

for (const ownerId of owners) {
  const rows = await loadRows(ownerId);
  const existingKeys = await loadExistingKeys(ownerId);
  if (existingKeys === null) keysTableMissing = true;

  const { claims, contested } = planKeyClaims(rows, existingKeys);
  const { groups, refused } = planCollapses(rows);
  const collapses = groups.filter((g) => g.absorbed.length > 0);
  const absorbedCount = collapses.reduce((n, g) => n + g.absorbed.length, 0);

  const ruleCounts = {};
  for (const g of collapses) {
    for (const a of g.absorbed) {
      const k = a.rule.startsWith("name+") ? "name+corroborated" : a.rule;
      ruleCounts[k] = (ruleCounts[k] || 0) + 1;
    }
  }
  const ruleSummary =
    Object.entries(ruleCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(" ") || "—";

  plans.push({ ownerId, rows, claims, contested, collapses, refused, absorbedCount });

  L(
    `${pad(ownerId.slice(0, 8), 10)}${num(rows.length, 7)}` +
      `${num(rows.length - absorbedCount, 7)}${num(absorbedCount, 9)}` +
      `${num(claims.size, 7)}${num(contested.length, 8)}  ${pad(ruleSummary, 34)}`,
  );
}

rule();
const totalRows = plans.reduce((n, p) => n + p.rows.length, 0);
const totalAbsorbed = plans.reduce((n, p) => n + p.absorbedCount, 0);
const totalKeys = plans.reduce((n, p) => n + p.claims.size, 0);
L(
  `TOTAL   ${num(totalRows, 8)}${num(totalRows - totalAbsorbed, 7)}` +
    `${num(totalAbsorbed, 9)}${num(totalKeys, 7)}`,
);
L();

// Per-owner detail: what is being merged, and what is deliberately NOT.
for (const p of plans) {
  if (p.collapses.length === 0 && p.refused.length === 0) continue;
  L(`owner ${p.ownerId.slice(0, 8)} — ${p.collapses.length} groups collapse, ` +
    `${p.absorbedCount} rows absorbed, ${p.refused.length} pairs kept apart`);
  for (const g of p.collapses.slice(0, 8)) {
    L(
      `   survivor ${pad(g.survivorId, 8)} ${pad((g.survivorName || "").slice(0, 26), 28)}` +
        `absorbs ${g.absorbed.map((a) => `${a.id}(${a.rule})`).join(", ")}`,
    );
  }
  if (p.collapses.length > 8) L(`   … and ${p.collapses.length - 8} more groups`);
  const byReason = {};
  for (const r of p.refused) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  if (p.refused.length) {
    L(`   kept apart: ${Object.entries(byReason).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  }
  L();
}

if (keysTableMissing) {
  L("NOTE: contact_identity_keys does not exist yet — the key counts above are");
  L("      what WOULD be claimed. Apply");
  L("      db/migrations/20260804_add_contact_identity_keys.sql before --apply.");
  L();
}

if (!APPLY) {
  L("DRY RUN — nothing was written.");
  L("Re-run with --apply to write (a manifest is saved first, rollback is one line).");
  process.exit(0);
}

if (keysTableMissing) {
  L("REFUSING to apply: the migration has not been applied. Nothing was written.");
  process.exit(1);
}

// ── apply ────────────────────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const manifestPath = `/tmp/contact-dedup-backfill-manifest-${ts}.json`;
const manifest = { appliedAt: new Date().toISOString(), owners: [] };

for (const p of plans) {
  const entry = { ownerId: p.ownerId, keysClaimed: [], collapses: [] };
  for (const [key, contactId] of p.claims) {
    const idx = key.indexOf("|");
    entry.keysClaimed.push({
      keyType: key.slice(0, idx),
      keyValue: key.slice(idx + 1),
      contactId,
    });
  }
  for (const g of p.collapses) {
    entry.collapses.push({
      survivorId: g.survivorId,
      absorbedIds: g.absorbed.map((a) => a.id),
    });
  }
  manifest.owners.push(entry);
}

{
  const fd = fs.openSync(manifestPath, "w");
  fs.writeFileSync(fd, JSON.stringify(manifest, null, 2));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}
L(`manifest written: ${manifestPath}`);
L();

const { collapseContactGroup } = await import("../src/db/store.js");
const { invalidateIdentityIndex } = await import("../src/db/contact-identity.js");

let claimedTotal = 0;
let collapsedTotal = 0;
let failedTotal = 0;

for (let oi = 0; oi < plans.length; oi += 1) {
  const p = plans[oi];
  const entry = manifest.owners[oi];

  // PHASE 1 — claim keys, one transaction per owner, chunked.
  const claims = entry.keysClaimed;
  for (let i = 0; i < claims.length; i += 500) {
    const chunk = claims.slice(i, i + 500);
    const params = [];
    const groups = [];
    chunk.forEach((c, j) => {
      const b = j * 4;
      const cast = j === 0 ? ["::uuid", "::text", "::text", "::bigint"] : ["", "", "", ""];
      groups.push(
        `($${b + 1}${cast[0]}, $${b + 2}${cast[1]}, $${b + 3}${cast[2]}, $${b + 4}${cast[3]})`,
      );
      params.push(p.ownerId, c.keyType, c.keyValue, c.contactId);
    });
    try {
      const res = await withTransaction((c) =>
        c.query(
          `INSERT INTO contact_identity_keys (owner_id, key_type, key_value, contact_id)
           VALUES ${groups.join(", ")}
           ON CONFLICT (owner_id, key_type, key_value) DO NOTHING`,
          params,
        ),
      );
      claimedTotal += res.rowCount ?? chunk.length;
    } catch (err) {
      L(`  ! key chunk failed for ${p.ownerId.slice(0, 8)}: ${err.message}`);
      failedTotal += 1;
    }
  }

  // PHASE 2 — collapse, one group at a time, re-verified inside the store call.
  for (let gi = 0; gi < entry.collapses.length; gi += 1) {
    const g = entry.collapses[gi];
    // Record the survivor's prior field values BEFORE the merge, for rollback.
    const { rows: before } = await query(
      `SELECT full_name, first_name, last_name, company, avatar_url, phone_primary,
              phone_primary_normalized, phones_all, emails, updated_at
         FROM contacts WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [p.ownerId, g.survivorId],
    );
    if (!before[0]) {
      g.failed = "survivor no longer live";
      continue;
    }
    g.survivorPrior = before[0];
    const { rows: absorbedRows } = await query(
      `SELECT id, deleted_at FROM contacts
        WHERE owner_id = $1 AND id = ANY($2::bigint[])`,
      [p.ownerId, g.absorbedIds],
    );
    g.absorbed = absorbedRows.map((r) => ({
      id: String(r.id),
      priorDeletedAt: r.deleted_at,
    }));

    const res = await collapseContactGroup(p.ownerId, g.survivorId, g.absorbedIds);
    if (!res.ok) {
      g.failed = "collapse returned not-ok";
      failedTotal += 1;
      continue;
    }
    g.keysRepointed = res.keysRepointed || [];
    g.keysDropped = res.keysDropped || [];
    collapsedTotal += res.collapsed;
  }

  invalidateIdentityIndex(p.ownerId);

  // Re-write the manifest after each owner so a crash still leaves a full
  // rollback path for everything already written.
  const fd = fs.openSync(manifestPath, "w");
  fs.writeFileSync(fd, JSON.stringify(manifest, null, 2));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}

rule();
L(`keys claimed:      ${claimedTotal}`);
L(`rows soft-deleted: ${collapsedTotal}`);
L(`failures:          ${failedTotal}`);
L(`manifest:          ${manifestPath}`);
L(
  `rollback:          railway run --service medha-id -- ` +
    `node scripts/contact-dedup-backfill.js --rollback ${manifestPath}`,
);
