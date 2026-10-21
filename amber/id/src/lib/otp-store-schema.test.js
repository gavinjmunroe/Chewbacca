/**
 * THE OTP STORE MUST MATCH THE TABLE IT WRITES TO.
 *
 * The web sign-in path was dead from the day it shipped and nothing caught it,
 * because every test of the OTP flow faked the database. The store issued
 *
 *   INSERT INTO otp_codes (...) ON CONFLICT (phone) DO UPDATE ...
 *
 * and otp_codes has PRIMARY KEY (id) with only a NON-UNIQUE partial index on
 * phone. Postgres refuses that with 42P10, every single time. A fake that
 * answers "ok" to any SQL string will never notice.
 *
 * So these assert the store's SQL against db/schema-columns.json -- the real
 * shape, regenerated from the real database -- rather than against a fake.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const store = readFileSync(join(root, "src/lib/medha-otp-store.js"), "utf8");
const schema = JSON.parse(readFileSync(join(root, "db/schema-columns.json"), "utf8"));
const otpColumns = Object.keys(schema.otp_codes ?? {});

test("the table this store targets exists, with the columns it names", () => {
  assert.ok(otpColumns.length > 0, "otp_codes missing from the schema snapshot");
  for (const col of ["id", "phone", "code_hash", "code_only_hash", "attempts", "expires_at", "last_sent_at", "requester_ip", "created_at", "deleted_at"]) {
    assert.ok(otpColumns.includes(col), `otp_codes has no ${col}`);
  }
});

test("EVERY NOT-NULL COLUMN WITHOUT A DEFAULT IS SUPPLIED BY THE INSERT", () => {
  // code_only_hash is NOT NULL with no default. The superseded store never
  // wrote it, so even with a working conflict target the insert would fail.
  const insert = store.slice(store.indexOf("INSERT INTO otp_codes"));
  for (const required of ["phone", "code_hash", "code_only_hash", "expires_at"]) {
    assert.ok(
      new RegExp(`\\b${required}\\b`).test(insert.slice(0, 200)),
      `INSERT does not supply ${required}`,
    );
  }
});

test("NO ON CONFLICT (phone) -- there is no unique index on phone to match it", () => {
  assert.doesNotMatch(
    store,
    /ON\s+CONFLICT\s*\(\s*phone\s*\)/i,
    "ON CONFLICT (phone) requires a unique index on phone; otp_codes has a non-unique partial one",
  );
});

test("the store respects the soft-delete column rather than hard-deleting", () => {
  assert.doesNotMatch(store, /DELETE\s+FROM\s+otp_codes/i, "otp_codes is soft-deleted, not deleted");
  assert.match(store, /deleted_at IS NULL/, "reads must exclude soft-deleted rows");
});

test("reads pick ONE row deterministically, because a phone can have several", () => {
  // Without an ORDER BY, "the code for this phone" is whichever row Postgres
  // felt like returning, which is a login that works intermittently.
  const selects = store.match(/SELECT[\s\S]*?FROM\s+otp_codes[\s\S]*?(?=`)/gi) ?? [];
  assert.ok(selects.length > 0, "no SELECT against otp_codes found");
  for (const sql of selects) {
    assert.match(sql, /ORDER BY[\s\S]*LIMIT 1/i, `SELECT is not deterministic:\n${sql}`);
  }
});

test("THE SUPERSEDED STORE IS NOT IMPORTED ANYWHERE", () => {
  const otpRoute = readFileSync(join(root, "src/routes/otp.js"), "utf8");
  // The route may NAME the superseded store in a comment explaining the swap.
  // What must not exist is an import of it.
  assert.doesNotMatch(
    otpRoute,
    /^\s*import[\s\S]{0,200}?from\s+["'][^"']*csql-otp-store/m,
    "the OTP route is back on the broken store",
  );
  assert.match(otpRoute, /medha-otp-store/);
});

test("the code's stated lifetime is the store's actual lifetime", () => {
  // The message said 10 minutes while the store expired at 5.
  const otpRoute = readFileSync(join(root, "src/routes/otp.js"), "utf8");
  assert.doesNotMatch(otpRoute, /expires in \d+ minutes/, "the TTL is hardcoded in the message again");
  assert.match(otpRoute, /OTP_TTL_MINUTES/);
});
