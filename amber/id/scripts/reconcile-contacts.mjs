/**
 * BRING AN OLD ADDRESS BOOK UP TO THE RESOLVER'S STANDARD.
 *
 * Write-time dedupe keeps NEW syncs converged. It does nothing for rows written
 * before it existed, and an account synced last year carries cards that would
 * never be created today. This is the one-time catch-up.
 *
 * ── WHY THIS IS NOT contact-dedup-backfill.js ───────────────────────────────
 *
 * That script carries its own copy of the identity-key logic, written when keys
 * were a plaintext `key_value` column. Keys became a salted `key_hash`; src/
 * moved and the script did not, and every gate stayed green because the column
 * audit only ever walked src/. The failure surfaced as a 42703 from production
 * credentials pointed at a real address book.
 *
 * So this one has NO logic of its own. It claims keys with claimsForRow and
 * claimIdentityKeys, finds duplicates with duplicateCandidatesFromBook, and
 * merges through collapseContactGroup -- the same three functions the live path
 * uses. It cannot drift from the resolver because it IS the resolver. The
 * column audit now walks scripts/ as well, so the next time it could, it won't.
 *
 * ── ROLLBACK ────────────────────────────────────────────────────────────────
 *
 * The old script wrote a manifest file. This does not need one: every merge
 * through collapseContactGroup records a contact_merges row with a full
 * snapshot and a 30-day undo, which is the same mechanism the product offers a
 * person tapping Merge. Undo one with POST /v1/me/contacts/merge/undo, or all
 * of them by merge id from the table.
 *
 * ── WHAT IT WILL AND WILL NOT MERGE ─────────────────────────────────────────
 *
 * lib/contact-duplicates.js sorts every candidate into three tiers and is
 * explicit about what each one earns:
 *
 *   provable   a shared phone or a shared email. One human owns one mobile
 *              number. "These merge without asking."
 *   likely     the same name plus a corroborator. "Queued for one tap. NEVER
 *              MERGED SILENTLY."
 *   weak       never surfaced at all.
 *
 * The first version of this script merged everything the finder returned,
 * `likely` included, which is exactly what that file forbids. On a real book it
 * would have collapsed two people called Hannah because both live in New York.
 * So: provable merges, likely goes to the review queue for the person to
 * answer, and the counts are reported separately so nobody has to guess which
 * happened.
 *
 *   railway run node scripts/reconcile-contacts.mjs --owner <uuid>
 *   railway run node scripts/reconcile-contacts.mjs --owner <uuid> --confirm
 */

import { query, closePool } from "../src/db/sql.js";
import { resolveAmberIdByPhone } from "../src/db/store.js";
import {
  claimsForRow,
  claimIdentityKeys,
  identityTablesReady,
  recordReviewCandidates,
} from "../src/db/contact-identity.js";
import { duplicateCandidatesFromBook } from "../src/db/contact-merge.js";
import { collapseContactGroup } from "../src/db/store.js";

const argv = process.argv.slice(2);
const argOf = (n) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const OWNER_ARG = argOf("--owner");
const APPLY = argv.includes("--confirm");
const LIMIT = Number(argOf("--limit") ?? 200);

if (!OWNER_ARG) {
  console.error(
    "\n  reconcile-contacts needs an owner.\n\n" +
      "  This merges real contacts. Running it across every account at once is\n" +
      "  not something to do by accident, so the owner is required even for a\n" +
      "  dry run.\n\n" +
      "    railway run node scripts/reconcile-contacts.mjs --owner +15551234567\n" +
      "    railway run node scripts/reconcile-contacts.mjs --owner <uuid>\n",
  );
  process.exit(2);
}

if (
  APPLY &&
  !process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON &&
  !process.env.GOOGLE_APPLICATION_CREDENTIALS
) {
  console.error(
    "\n  No GCP credentials in the environment. Run this through `railway run`.\n",
  );
  process.exit(2);
}

const tag = (id) => String(id).slice(0, 8);
const short = (s, n = 26) => {
  const v = String(s ?? "").trim();
  return v.length <= n ? v : `${v.slice(0, n - 1)}…`;
};

/**
 * A phone number or a uuid, because nobody has their own amber_id to hand and
 * the friction of looking it up is the reason a maintenance script goes unrun.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveOwner(arg) {
  const raw = String(arg).trim();
  if (UUID_RE.test(raw)) return raw.toLowerCase();

  // ORDER MATTERS, AND GETTING IT WRONG POINTED THIS SCRIPT AT A STRANGER.
  //
  // The first version tried the phone resolver first and fell back to an id
  // prefix. Handed "ca78cc4d" -- an id prefix, not a phone -- the phone
  // resolver normalized it into something, matched a row, and this script
  // cheerfully reported on a completely different account. On a dry run that
  // is a wasted minute. With --confirm it would have merged somebody else's
  // contacts.
  //
  // So each form is recognized by its own shape, and anything matching neither
  // is refused rather than guessed at.
  if (/^[0-9a-f]{6,32}$/i.test(raw)) {
    const { rows } = await query(
      `SELECT amber_id FROM users WHERE amber_id::text LIKE $1 LIMIT 2`,
      [`${raw.toLowerCase()}%`],
    ).catch(() => ({ rows: [] }));
    if (rows.length === 1) return String(rows[0].amber_id);
    if (rows.length > 1) {
      console.error(`\n  "${raw}" matches more than one account. Use the full id.\n`);
      return null;
    }
    console.error(`\n  No account whose id starts with "${raw}".\n`);
    return null;
  }

  // A phone: digits, optionally with +, spaces, dashes and brackets.
  if (/^\+?[\d\s().-]{7,}$/.test(raw)) {
    const id = await resolveAmberIdByPhone(raw).catch(() => null);
    if (id) return String(id);
    console.error(`\n  No account on the phone number "${raw}".\n`);
    return null;
  }

  return null;
}

async function main() {
  const OWNER = await resolveOwner(OWNER_ARG);
  if (!OWNER) {
    console.error(
      `\n  Could not resolve "${OWNER_ARG}" to an account.\n\n` +
        `  Pass the phone number on the account, its amber_id, or the id prefix\n` +
        `  the benchmark prints.\n`,
    );
    process.exitCode = 2;
    return;
  }
  console.log(`\n  reconcile — owner ${tag(OWNER)} — ${APPLY ? "APPLYING" : "dry run, writes nothing"}\n`);

  const { rows: contacts } = await query(
    `SELECT * FROM contacts
      WHERE owner_id = $1::uuid AND deleted_at IS NULL ORDER BY id ASC`,
    [OWNER],
  );
  console.log(`  ${contacts.length} live contacts`);
  if (contacts.length === 0) return;

  // ── PHASE 1: every live card claims its identity keys ────────────────────
  //
  // Without keys, the resolver cannot see a duplicate at all: matching is a
  // lookup against this table, not a scan. An old book has none, which is why
  // its duplicates have survived every sync since.
  if (!identityTablesReady()) {
    // Reading any contact warms the flag; if it is still false the table is
    // genuinely absent and phase 2 would silently do nothing.
    console.log(`  identity key tables not ready — run the migrations first\n`);
    return;
  }

  const claims = contacts.flatMap((row) => claimsForRow(row));
  console.log(`  ${claims.length} identity keys to claim across those cards`);

  let claimed = 0;
  let conflicts = [];
  if (APPLY) {
    const r = await claimIdentityKeys(OWNER, claims);
    claimed = r.claimed;
    conflicts = r.conflicts ?? [];
    console.log(`  claimed ${claimed}, ${conflicts.length} contested`);
  } else {
    console.log(`  (dry run: nothing claimed)`);
  }

  // ── PHASE 2: the duplicates those keys expose ────────────────────────────
  const pairs = await duplicateCandidatesFromBook(OWNER, { limit: LIMIT }).catch((err) => {
    console.error(`  duplicate scan failed: ${err?.message || err}`);
    return [];
  });

  console.log(`\n  ${pairs.length} duplicate candidate(s)\n`);
  if (pairs.length === 0) {
    console.log("  Nothing to merge.\n");
    return;
  }

  const byId = new Map(contacts.map((c) => [String(c.id), c]));
  const nameOf = (id) => short(byId.get(String(id))?.full_name ?? "?");

  const provable = pairs.filter((p) => p.tier === "provable");
  const likely = pairs.filter((p) => p.tier !== "provable");

  console.log(`  ${provable.length} provable (merge), ${likely.length} likely (ask the person)\n`);

  let merged = 0;
  let failed = 0;
  let skipped = 0;
  for (const p of provable) {
    // The field names duplicateCandidatesFromBook actually returns. The first
    // version guessed at four other spellings, matched none of them, and the
    // `continue` below skipped all eight pairs in silence -- so it printed "8
    // candidates" and then nothing, which is the worst way for this to fail.
    const keep = p.keepContactId ? String(p.keepContactId) : null;
    const drop = p.dropContactId ? String(p.dropContactId) : null;
    if (!keep || !drop || keep === drop) {
      console.log(`    ! unusable pair shape: ${JSON.stringify(Object.keys(p))}`);
      skipped += 1;
      continue;
    }

    const line =
      `    ${tag(keep)} <- ${tag(drop)}   ` +
      `${short(p.keep?.name ?? nameOf(keep))}  <-  ${short(p.drop?.name ?? nameOf(drop))}` +
      (p.reason ? `   [${p.reason}${p.tier ? `/${p.tier}` : ""}]` : "");

    if (!APPLY) {
      console.log(line);
      continue;
    }
    const res = await collapseContactGroup(OWNER, keep, [drop], {
      origin: "backfill",
      rule: p.reason ?? "reconcile",
    }).catch((err) => ({ ok: false, reason: String(err?.message || err) }));
    if (res.ok) {
      merged += 1;
      console.log(`${line}   ✓ merge ${res.mergeId ?? "?"}`);
    } else {
      failed += 1;
      console.log(`${line}   ✗ ${res.reason}`);
    }
  }

  // ── the likely tier: offered, never merged ───────────────────────────────
  if (likely.length > 0) {
    console.log(`\n  LIKELY — these go to the review queue, not to a merge:\n`);
    for (const p of likely) {
      console.log(
        `    ${tag(p.keepContactId)} ~ ${tag(p.dropContactId)}   ` +
          `${short(p.keep?.name ?? "?")}  ~  ${short(p.drop?.name ?? "?")}   [${p.reason}]`,
      );
    }
    if (APPLY) {
      const queued = await recordReviewCandidates(
        OWNER,
        likely.map((p) => ({
          contactId: p.keepContactId,
          candidateContactId: p.dropContactId,
          reason: p.reason ?? "likely duplicate",
        })),
      ).catch(() => 0);
      console.log(`\n  queued ${queued} for review`);
    } else {
      console.log(`\n  (dry run: nothing queued)`);
    }
  }

  if (APPLY) {
    console.log(`\n  merged ${merged}, failed ${failed}${skipped ? `, skipped ${skipped}` : ""}\n`);
    console.log(
      `  Every merge is recorded in contact_merges with a snapshot and a\n` +
        `  30-day undo. To reverse one:\n` +
        `    POST /v1/me/contacts/merge/undo  { mergeId }\n`,
    );
  } else {
    console.log(
      `\n  ${provable.length} pair(s) would be merged, ${likely.length} queued for\n` +
        `  you to answer. Nothing was written.\n`,
    );
  }
}

let failed = 0;
try {
  await main();
} catch (e) {
  failed = 1;
  console.error("\n  FAILED:", e?.stack || e);
} finally {
  await closePool();
}
process.exit(failed);
