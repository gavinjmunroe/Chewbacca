// Chunk 2a backfill: walk all Privy users and mirror their identity into the
// Cloud SQL `users` table (privy_did, loop_sender_id, tenant_metadata).
//
// Run AFTER applying db/migrations/20260725_add_users_tenant_fields.sql:
//   railway run node scripts/backfill-tenants.js
//
// Idempotent: safe to re-run. Existing rows are updated in place; a re-run
// only overwrites privy_did, loop_sender_id (if currently null), and
// tenant_metadata with the latest Privy values.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Materialize GCP service-account JSON to a temp file before importing sql.js
// (mirrors scripts/run-migration.js credential materialization).
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-backfill.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { listAllUsers, normalizePhone } = await import("../src/lib/auth-session.js");
const { resolveAmberIdByPhone } = await import("../src/db/store.js");

// Privy customMetadata values may be prefixed with "__json__:" for non-scalar
// types. Mirrors fromMetaValue in src/routes/tenants.js (not exported).
const JSON_MARKER = "__json__:";
function decodeMetadata(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (typeof v === "string" && v.startsWith(JSON_MARKER)) {
      try {
        out[k] = JSON.parse(v.slice(JSON_MARKER.length));
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Resolve the best E.164 phone for a Privy user — mirrors TenantIndex logic.
// Prefers customMetadata.phoneNumber, falls back to a linked phone account.
function resolvePhone(user) {
  const metaRaw = normalizePhone(user.customMetadata?.phoneNumber);
  if (metaRaw) return metaRaw;
  const linked = user.linkedAccounts || [];
  for (const acct of linked) {
    if (acct?.type === "phone" && acct.number) {
      const p = normalizePhone(acct.number);
      if (p) return p;
    }
  }
  return null;
}

async function main() {
  console.log("[backfill-tenants] fetching all Privy users…");
  let users;
  try {
    users = await listAllUsers();
  } catch (err) {
    console.error("[backfill-tenants] listAllUsers failed:", err.message);
    process.exit(1);
  }
  console.log(`[backfill-tenants] ${users.length} Privy users fetched`);

  let matched = 0;
  let createdNew = 0;
  let skippedNoPhone = 0;
  let errors = 0;

  for (const user of users) {
    const privyDid = user.id;
    if (!privyDid) {
      skippedNoPhone++;
      continue;
    }

    const e164 = resolvePhone(user);
    if (!e164) {
      skippedNoPhone++;
      continue;
    }

    try {
      // resolveAmberIdByPhone get-or-creates the row keyed by phone.
      // We track whether the row already existed to report created-new counts.
      const { rows: pre } = await query(
        `SELECT amber_id FROM users WHERE phone = $1 AND deleted_at IS NULL`,
        [e164],
      );
      const wasNew = pre.length === 0;

      const amberId = await resolveAmberIdByPhone(e164);
      if (!amberId) {
        console.error(
          `[backfill-tenants] could not resolve amber_id for ${e164} (${privyDid})`,
        );
        errors++;
        continue;
      }

      const meta = decodeMetadata(user.customMetadata);
      const loopSenderId = meta.loopSenderId ?? null;

      // UPDATE the new columns. Never overwrite a non-null loop_sender_id
      // with null — a re-run must not clobber an already-set sender wiring.
      await query(
        `UPDATE users
         SET privy_did        = $2,
             loop_sender_id   = CASE
               WHEN $3::text IS NOT NULL THEN $3
               ELSE loop_sender_id
             END,
             tenant_metadata  = $4::jsonb,
             updated_at       = now()
         WHERE amber_id = $1`,
        [amberId, privyDid, loopSenderId, JSON.stringify(meta)],
      );

      if (wasNew) {
        createdNew++;
      } else {
        matched++;
      }
    } catch (err) {
      console.error(
        `[backfill-tenants] error for ${privyDid} (${e164}): ${err.message}`,
      );
      errors++;
    }
  }

  console.log(
    `[backfill-tenants] done — total=${users.length} ` +
      `matched/updated=${matched} created-new=${createdNew} ` +
      `skipped(no-phone)=${skippedNoPhone} errors=${errors}`,
  );
  process.exit(errors > 0 ? 1 : 0);
}

main();
