/**
 * BACKFILL contacts.linked_amber_id — so the people already in your circles
 * actually become the people they are.
 *
 *   railway run node scripts/backfill-contact-links.js              DRY RUN
 *   railway run node scripts/backfill-contact-links.js --apply      write
 *
 * DRY RUN BY DEFAULT, like its sibling: it writes to the column every social
 * feature in the app resolves through.
 *
 * WHY IT IS NEEDED, AND WHY IT IS A SEPARATE SCRIPT FROM
 * backfill-discovery-keys. That one populates discovery_keys: the account side,
 * "which account proved it owns this number". It ends by reporting the number of
 * "contact card(s) [that] now resolve to an account through a key without being
 * linked yet" — and on the live database that number came back as 26 with all
 * ten accounts already holding keys and nothing to claim.
 *
 * That report is the whole problem in one line. The keys were right, the join
 * matched, and nothing performed the UPDATE. Three code paths were supposed to:
 * a signup sweep that only ever ran at the instant an account was created, a
 * circle-add hook that re-derived hashes from text columns instead of reading
 * the keys table, and a correct cross-owner linker with zero callers. See
 * src/db/identity-link.js for the full account.
 *
 * Those paths are fixed, so new links happen live from now on — on signup, on
 * connection accept, on contact sync and on adding a circle member. This is the
 * one-off for everything that accumulated before them. Running it is what makes
 * an existing circle member stop being a contact card and start being a person:
 * their circles resolve, notes shared with them reach them, and a share
 * notification finally has a recipient.
 *
 * IT USES THE SAME CODE PATH AS THE LIVE WRITERS. linkResolvableContacts, not a
 * second implementation — a backfill that matches differently from the live
 * writer produces links the app disagrees with, which is worse than no
 * backfill. In particular it inherits the refusal: a card resolving to two
 * different accounts is left alone rather than pointed at whichever one the
 * query happened to return first.
 *
 * SAFE TO RUN AGAIN. The statement only touches rows whose link would change.
 */

/**
 * THE SAME DSN ESCAPE HATCH ITS SIBLING HAS, and copied deliberately rather than
 * simplified away. SMOKE_DATABASE_URL must be set AND the target must carry a
 * smoke_marker table, so production cannot be reached this way by accident.
 *
 * The injection hook matters as much as the pool does: identity-link.js imports
 * sql.js directly, so pointing only this file at a scratch DSN would send this
 * script's own reads to the scratch database and linkResolvableContacts's WRITES
 * to the real one — a backfill that reports against one database and mutates
 * another. Same two locks as scripts/smoke-db.mjs.
 */
let query, closePool;
const dsn = process.env.SMOKE_DATABASE_URL || null;
if (dsn) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: dsn, max: 2 });
  const { rows } = await pool.query(
    `SELECT current_database() AS db,
            to_regclass('public.smoke_marker') IS NOT NULL AS marked`,
  );
  if (!rows[0].marked) {
    console.error(`\n  Refusing SMOKE_DATABASE_URL "${rows[0].db}": no smoke_marker table.\n`);
    await pool.end();
    process.exit(2);
  }
  const { __injectPoolForSmokeTests } = await import("../src/db/sql.js");
  __injectPoolForSmokeTests(pool);
  query = (t, p) => pool.query(t, p);
  closePool = () => pool.end();
} else {
  ({ query, closePool } = await import("../src/db/sql.js"));
}

const { linkResolvableContacts, ambiguousContactLinks } = await import(
  "../src/db/identity-link.js"
);

const APPLY = process.argv.includes("--apply");
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

let exitCode = 0;
const t0 = Date.now();

try {
  // PRINT BEFORE WORKING. A slow connector with no output looks hung, which is
  // the failure its sibling script was reported for.
  console.log(`\n  ${APPLY ? "APPLY" : "DRY RUN"} — contacts.linked_amber_id\n`);

  // ── what is resolvable, and what is already resolved ──────────────────────
  const t1 = Date.now();
  const { rows: before } = await query(
    `SELECT
       count(*) FILTER (WHERE c.linked_amber_id IS NOT NULL)::int AS already_linked,
       count(*) FILTER (WHERE c.linked_amber_id IS NULL AND k.resolvable)::int AS linkable
     FROM contacts c
     LEFT JOIN LATERAL (
       SELECT true AS resolvable
         FROM contact_identity_keys k
         JOIN discovery_keys d ON d.key_hash = k.key_hash
        WHERE k.owner_id = c.owner_id AND k.contact_id = c.id
          AND c.owner_id <> d.amber_id
        LIMIT 1
     ) k ON TRUE
     WHERE c.deleted_at IS NULL`,
  );
  console.log(`  already linked....  ${String(before[0].already_linked).padStart(6)}`);
  console.log(`  linkable now......  ${String(before[0].linkable).padStart(6)}   (${secs(Date.now() - t1)})\n`);

  // ── the ones that resolve to more than one account ────────────────────────
  //
  // Reported rather than guessed at. Two accounts holding keys on one card is
  // real — a shared handset, a recycled number, a card merged from two sources —
  // and picking one would hand that card's circles and notes to whichever the
  // query returned first. These need the owner to say which person it is.
  const t2 = Date.now();
  const { rows: owners } = await query(
    `SELECT DISTINCT owner_id FROM contacts WHERE deleted_at IS NULL`,
  );
  let ambiguous = 0;
  for (const { owner_id: ownerId } of owners) {
    const rows = await ambiguousContactLinks(ownerId);
    for (const r of rows) {
      ambiguous += 1;
      console.log(`  AMBIGUOUS  ${r.name || "(unnamed)"}  →  ${r.amberIds.length} accounts`);
      console.log(`             owner ${ownerId}  contact ${r.contactId}`);
    }
  }
  console.log(
    `  ambiguous.........  ${String(ambiguous).padStart(6)}   ` +
      `left unlinked on purpose; the owner has to choose   (${secs(Date.now() - t2)})\n`,
  );

  // ── the write ─────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`  Nothing was written. Re-run with --apply.\n`);
  } else {
    const t3 = Date.now();
    // Unscoped: this is the one caller allowed to pass no scope at all. It is a
    // single statement driven off the keys index, not a per-row loop, so there
    // is no progress to print — it either returns or it does not.
    const { linked, pairs } = await linkResolvableContacts({});
    console.log(`  linked............  ${String(linked).padStart(6)}   (${secs(Date.now() - t3)})\n`);

    // WHO CAN SUDDENLY SEE SOMETHING. Every pair here is a person who was in a
    // circle, or had a note shared with them, and could not be told. Printed so
    // the run is auditable rather than a number.
    const byOwner = new Map();
    for (const p of pairs) {
      if (!byOwner.has(p.ownerId)) byOwner.set(p.ownerId, []);
      byOwner.get(p.ownerId).push(p);
    }
    for (const [ownerId, list] of byOwner) {
      console.log(`  owner ${ownerId}: ${list.length} card(s) resolved`);
    }
    if (byOwner.size > 0) console.log("");

    const { rows: after } = await query(
      `SELECT count(*)::int AS n FROM contacts c
        WHERE c.deleted_at IS NULL AND c.linked_amber_id IS NULL
          AND EXISTS (
            SELECT 1 FROM contact_identity_keys k
              JOIN discovery_keys d ON d.key_hash = k.key_hash
             WHERE k.owner_id = c.owner_id AND k.contact_id = c.id
               AND c.owner_id <> d.amber_id)`,
    );
    // Anything left should be exactly the ambiguous set. If it is not, the two
    // queries disagree about what "resolvable" means and that is worth knowing.
    console.log(`  still unlinked but resolvable: ${after[0].n}`);
    if (after[0].n !== ambiguous) {
      console.log(
        `  ⚠ expected ${ambiguous} (the ambiguous ones). A difference means the\n` +
          `    reporting query and linkResolvableContacts disagree — worth a look.`,
      );
    }
    console.log("");
  }

  console.log(`  done in ${secs(Date.now() - t0)}\n`);
} catch (err) {
  console.error("\n  ✗ backfill-contact-links failed:", err?.stack || err?.message || err, "\n");
  exitCode = 1;
} finally {
  await closePool().catch(() => {});
}

// EXIT EXPLICITLY. Same reason as backfill-discovery-keys: a reporting job whose
// last line has printed has nothing left to wait for, and "finished, then sat
// there" is a failure mode this directory has already been bitten by.
process.exit(exitCode);
