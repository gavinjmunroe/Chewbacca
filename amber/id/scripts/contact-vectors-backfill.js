/**
 * BACKFILL contact_embedding.
 *
 *   railway run node scripts/contact-vectors-backfill.js --status   coverage only
 *   railway run node scripts/contact-vectors-backfill.js --dry-run  cost, no calls
 *   railway run node scripts/contact-vectors-backfill.js            do it
 *   railway run node scripts/contact-vectors-backfill.js --owner=<uuid>
 *
 * WHY THIS EXISTS. contact-vectors.js embedded at 2560 dimensions into a
 * halfvec(1536) column, so Postgres rejected every insert and the module is
 * fail-open -- the table has been empty since it shipped, retrieveTopK() has
 * always returned null, and chat has been re-ranking the entire address book on
 * every turn. The writer is fixed. Nothing backfills the rows that never landed:
 * reembedContactSoon() only fires for a contact somebody WRITES to, so existing
 * contacts would stay invisible to the pre-filter indefinitely.
 *
 * There is already POST /internal/contacts/backfill-vectors, but it needs an API
 * key, takes one ownerId per call, and reports only into the logs. This walks
 * every owner, prints what it did, and can tell you the cost before spending it.
 *
 * COSTS MONEY. One OpenAI text-embedding-3-small call per BATCH of contacts.
 * --dry-run prints the estimate and makes no API calls. The real figure is tiny
 * (see the estimate it prints) but it is a real charge and you should see it
 * before it happens, not after.
 *
 * SAFE TO RE-RUN. embedContacts() skips any contact whose composed text hashes
 * to what is already stored, so a second run costs nothing and changes nothing.
 * Interrupting it loses only the batch in flight.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Railway hands the service account as JSON in an env var; the Cloud SQL
// connector wants a file path. Same shim as the other scripts.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-contact-vectors.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");
const { getContactsForResolution } = await import("../src/db/store.js");
const { getContactContentForContacts } = await import("../src/db/observations-compat.js");
const { embedContacts, composeContactText } = await import("../src/lib/contact-vectors.js");
const { EMBEDDING_MODEL } = await import("../src/db/embedding-queue.js");

const argv = process.argv.slice(2);
const statusOnly = argv.includes("--status");
const dryRun = argv.includes("--dry-run");
const ownerArg = argv.find((a) => a.startsWith("--owner="));
const ONLY_OWNER = ownerArg ? ownerArg.split("=")[1] : null;
const BATCH = 200;

// text-embedding-3-small list price, per 1M input tokens. Only used to print an
// estimate -- nothing branches on it.
const USD_PER_MTOK = 0.02;

function estimateUsd(totalChars) {
  // ~4 chars per token is the usual rule of thumb for English prose.
  return (totalChars / 4 / 1_000_000) * USD_PER_MTOK;
}

async function ownersWithContacts() {
  if (ONLY_OWNER) return [ONLY_OWNER];
  const { rows } = await query(
    `SELECT DISTINCT c.owner_id
       FROM contacts c
       JOIN users u ON u.amber_id = c.owner_id AND u.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
      ORDER BY c.owner_id`,
  );
  return rows.map((r) => String(r.owner_id));
}

async function coverage() {
  const { rows } = await query(
    `SELECT c.owner_id,
            count(*)::int AS contacts,
            (SELECT count(*)::int FROM contact_embedding e
              WHERE e.owner_id = c.owner_id) AS embedded
       FROM contacts c
       JOIN users u ON u.amber_id = c.owner_id AND u.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
      GROUP BY c.owner_id
      ORDER BY contacts DESC`,
  );
  return rows;
}

async function main() {
  const cov = await coverage();
  const totalContacts = cov.reduce((a, r) => a + r.contacts, 0);
  const totalEmbedded = cov.reduce((a, r) => a + r.embedded, 0);
  console.log(
    `  coverage: ${totalEmbedded}/${totalContacts} contacts have a vector, ` +
      `across ${cov.length} owner(s)  [model ${EMBEDDING_MODEL}]`,
  );
  for (const r of cov.slice(0, 10)) {
    console.log(`    ${r.owner_id}  ${r.embedded}/${r.contacts}`);
  }
  if (cov.length > 10) console.log(`    ... and ${cov.length - 10} more owner(s)`);
  if (statusOnly) return;

  const owners = await ownersWithContacts();
  let grandEmbedded = 0;
  let grandSkipped = 0;
  let grandErrored = 0;
  let dryChars = 0;
  let dryCount = 0;

  for (const ownerId of owners) {
    const contacts = await getContactsForResolution(ownerId);
    if (!Array.isArray(contacts) || contacts.length === 0) continue;
    const ids = contacts.map((c) => String(c.id));
    const factsMap = await getContactContentForContacts(ownerId, ids).catch(() => ({}));

    if (dryRun) {
      // Measure exactly what WOULD be sent, using the same composer the real
      // path uses, so the estimate is not a guess about prompt shape.
      for (const c of contacts) {
        const text = composeContactText(c, factsMap[String(c.id)] || []);
        if (!text) continue;
        dryChars += text.length;
        dryCount += 1;
      }
      continue;
    }

    let embedded = 0;
    let skipped = 0;
    let errored = 0;
    for (let i = 0; i < contacts.length; i += BATCH) {
      const r = await embedContacts(ownerId, contacts.slice(i, i + BATCH), factsMap);
      embedded += r.embedded;
      skipped += r.skipped;
      errored += r.errored;
      console.log(
        `  ${ownerId}  ${Math.min(i + BATCH, contacts.length)}/${contacts.length}  ` +
          `embedded=${embedded} unchanged=${skipped} errored=${errored}`,
      );
    }
    grandEmbedded += embedded;
    grandSkipped += skipped;
    grandErrored += errored;
  }

  if (dryRun) {
    console.log(
      `  dry run: would embed ${dryCount} contact document(s), ` +
        `~${Math.round(dryChars / 4).toLocaleString()} tokens, ` +
        `~$${estimateUsd(dryChars).toFixed(4)} at $${USD_PER_MTOK}/Mtok. No calls made.`,
    );
    return;
  }

  console.log(
    `  done — embedded ${grandEmbedded}, unchanged ${grandSkipped}, errored ${grandErrored}`,
  );
  if (grandErrored > 0) {
    console.error(
      `  ${grandErrored} contact(s) errored. A WIDTH mismatch logs "REFUSING to write" ` +
        `and means the model and the column disagree -- that is configuration, not ` +
        `transient, and re-running will not fix it.`,
    );
  }
}

try {
  await main();
} catch (err) {
  console.error(`  FAILED: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  // The Cloud SQL connector schedules a non-unref'd cert refresh, so the process
  // hangs forever without this. pool.end() alone is not enough.
  await closePool();
}
