// Contact dedup sweep. DRY-RUN by default; --apply collapses only the
// 100%-positive groups (shared normalized phone OR shared email, transitive).
// The name-only "possible duplicates" list is REVIEW-ONLY and never merged.
//
// Usage:
//   railway run node scripts/dedup-sweep.js <did-or-phone-or-amber_id>          (dry-run)
//   railway run node scripts/dedup-sweep.js <did-or-phone-or-amber_id> --apply  (collapse 100% groups)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Materialize the service-account JSON to a temp file. ESM hoists the imports
// below above this block, but that's fine: the Cloud SQL pool is lazy (no query
// runs at import), so creds are in place before main() issues any query.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-dedup-sweep.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

import { query } from "../src/db/sql.js";
import { collapseContactGroup, resolveAmberIdByPrivyDid, resolveAmberIdByPhone } from "../src/db/store.js";
import { normalizePhone } from "../src/lib/auth-session.js";

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _PERSON_ID_RE = /^[0-9a-f]{32}$/i;

function _idNum(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}
function _normName(s) {
  return typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

/**
 * Pure grouping. `contacts` = [{ id (string), fullName, phones:[raw], emails:[raw] }].
 * Returns:
 *   groups:   [{ survivorId, absorbedIds[], members:[{id,name}] }]  (100%-positive:
 *             connected components over shared normalized phone OR email; survivor=lowest id)
 *   nameOnly: [{ name, ids[], display[] }]  multi-token full names on >1 contact that are
 *             NOT already unified by a phone/email component (REVIEW ONLY)
 */
export function buildGroups(contacts) {
  // Union-find over contact ids.
  const parent = new Map();
  contacts.forEach((c) => parent.set(c.id, c.id));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Key extraction: normalized (E.164) phones + lowercased emails.
  const keysOf = (c) => {
    const ks = new Set();
    for (const p of c.phones || []) {
      const e164 = normalizePhone(p);
      if (e164) ks.add("p:" + e164);
    }
    for (const em of c.emails || []) {
      const lc = String(em).trim().toLowerCase();
      if (lc) ks.add("e:" + lc);
    }
    return ks;
  };
  const keyOwner = new Map(); // key → first contact id seen
  for (const c of contacts) {
    for (const k of keysOf(c)) {
      if (keyOwner.has(k)) union(c.id, keyOwner.get(k));
      else keyOwner.set(k, c.id);
    }
  }

  const componentOf = new Map();
  const comps = new Map();
  for (const c of contacts) {
    const r = find(c.id);
    componentOf.set(c.id, r);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(c);
  }

  const groups = [];
  for (const members of comps.values()) {
    if (members.length <= 1) continue;
    const sorted = [...members].sort((a, b) => _idNum(a.id) - _idNum(b.id));
    groups.push({
      survivorId: sorted[0].id,
      absorbedIds: sorted.slice(1).map((m) => m.id),
      members: sorted.map((m) => ({ id: m.id, name: m.fullName || null })),
    });
  }

  // Name-only possible dups: multi-token normalized names on >1 contact that
  // span more than one phone/email component (i.e. NOT already unified).
  const byName = new Map();
  for (const c of contacts) {
    const norm = _normName(c.fullName);
    if (!norm || norm.split(" ").length < 2) continue; // multi-token only
    if (!byName.has(norm)) byName.set(norm, []);
    byName.get(norm).push(c);
  }
  const nameOnly = [];
  for (const [norm, list] of byName) {
    if (list.length < 2) continue;
    const roots = new Set(list.map((c) => componentOf.get(c.id)));
    if (roots.size <= 1) continue; // already unified by phone/email → not a new signal
    nameOnly.push({
      name: norm,
      ids: list.map((c) => c.id),
      display: list.map((c) => c.fullName),
    });
  }

  return { groups, nameOnly };
}

async function resolveOwner(arg) {
  if (!arg) return null;
  const s = String(arg);
  if (s.startsWith("did:") || _UUID_RE.test(s) || _PERSON_ID_RE.test(s)) {
    return resolveAmberIdByPrivyDid(s).catch(() => null);
  }
  const phone = normalizePhone(s);
  return phone ? resolveAmberIdByPhone(phone).catch(() => null) : null;
}

// Load the owner's live contacts as buildGroups input.
export async function loadOwnerContacts(ownerId) {
  const { rows } = await query(
    `SELECT id, full_name, phone_primary, phones_all, emails
       FROM contacts
      WHERE owner_id = $1 AND deleted_at IS NULL
      ORDER BY id`,
    [ownerId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    fullName: r.full_name,
    phones: (r.phones_all
      ? r.phones_all.split(",")
      : r.phone_primary
        ? [r.phone_primary]
        : []
    ).map((s) => s.trim()).filter(Boolean),
    emails: (r.emails ? r.emails.split(",") : []).map((s) => s.trim()).filter(Boolean),
  }));
}

async function main() {
  const arg = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!arg) {
    console.log("usage: node scripts/dedup-sweep.js <did-or-phone-or-amber_id> [--apply]");
    process.exit(1);
  }
  const ownerId = await resolveOwner(arg);
  if (!ownerId) {
    console.log(`❌ could not resolve "${arg}" to an amber_id`);
    process.exit(1);
  }

  const contacts = await loadOwnerContacts(ownerId);
  const { groups, nameOnly } = buildGroups(contacts);

  console.log(`\n=== 100% groups (shared phone/email, transitive): ${groups.length} ===`);
  for (const g of groups) {
    const names = g.members.map((m) => `${m.id}:${m.name || "(no name)"}`).join("  |  ");
    console.log(`survivor ${g.survivorId} ← absorb [${g.absorbedIds.join(", ")}]   ${names}`);
  }

  console.log(`\n=== name-only POSSIBLE duplicates — REVIEW ONLY, NOT merged: ${nameOnly.length} ===`);
  for (const n of nameOnly) {
    console.log(`"${n.name}"  ids [${n.ids.join(", ")}]   (${n.display.join(" | ")})`);
  }

  let rowsCollapsed = 0;
  if (apply) {
    for (const g of groups) {
      const res = await collapseContactGroup(ownerId, g.survivorId, g.absorbedIds);
      if (res?.ok) rowsCollapsed += res.collapsed;
    }
    console.log(`\nAPPLIED: collapsed ${groups.length} group(s), ${rowsCollapsed} row(s) absorbed. Name-only list untouched.`);
  } else {
    console.log(`\nDRY-RUN: nothing changed. Re-run with --apply to collapse the ${groups.length} 100% group(s). Name-only list is never merged.`);
  }

  console.log(
    `\nTotals: contacts=${contacts.length} groups=${groups.length} ` +
      `rowsCollapsed=${apply ? rowsCollapsed : 0} nameOnlyPossible=${nameOnly.length}`,
  );
  process.exit(0);
}

// Only run the CLI when invoked directly (so importing buildGroups from the
// smoke test does NOT execute main()).
let invokedDirectly = false;
try {
  invokedDirectly = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) {
  main().catch((e) => {
    console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
    process.exit(1);
  });
}
