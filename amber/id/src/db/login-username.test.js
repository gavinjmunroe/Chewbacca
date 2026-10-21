/**
 * A SIGN-IN NAME IS NOT A PROFILE HANDLE.
 *
 * users.username existed before any of this: a consumer profile field,
 * free-form, baseline-visible, shown to people in your network. Migration
 * 069's `ADD COLUMN IF NOT EXISTS username` was a silent no-op that adopted
 * it as a credential, and the first symptom was the same human's two accounts
 * colliding -- a personal handle making that name unavailable to that same
 * person's work account.
 *
 * Structural, because the failure is a column name being one character
 * different from the right one, in SQL, which no type checker reads.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const store = readFileSync(new URL("./org-invite-store.js", import.meta.url), "utf8");

/** Just the credential functions; the file also holds invites and passwords. */
function credentialSection() {
  const start = store.indexOf("/* -------------------------------------------------------------- usernames */");
  assert.ok(start > 0, "the usernames section is missing");
  return store.slice(start);
}

test("the credential reads and writes login_username, never username", () => {
  const section = credentialSection();
  const offenders = [];
  for (const m of section.matchAll(/`([^`]*\b(?:SELECT|UPDATE|INSERT)\b[^`]*)`/gi)) {
    const sql = m[1];
    if (!/\busername\b/.test(sql)) continue;
    // `u.login_username AS username` is the alias the API shape uses and is
    // fine; a bare `username` column reference is the bug.
    const bare = sql.replace(/login_username/g, "").match(/\busername\b/g) ?? [];
    const aliasOnly = /AS\s+username/i.test(sql) && bare.length === 1;
    if (bare.length && !aliasOnly) {
      offenders.push(sql.replace(/\s+/g, " ").trim().slice(0, 80));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these touch the profile handle instead of the credential:\n  ${offenders.join("\n  ")}`,
  );
});

/**
 * THE PROFILE FIELD IS NOT CONSTRAINED BY THE CREDENTIAL'S RULES.
 *
 * 069 put a lowercase-only CHECK on a column the consumer app has always let
 * people type freely into. The first person to set a profile handle with a
 * capital letter would have hit a constraint violation from a feature they
 * were not using.
 */
test("no constraint on users.username survives", () => {
  const dir = new URL("../../db/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const sql = files.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");

  // The shape constraint and the unique index must both be dropped after
  // being added, and the drop must come later in migration order.
  const addedAt = sql.indexOf("users_username_shape");
  const droppedAt = sql.lastIndexOf("DROP CONSTRAINT IF EXISTS users_username_shape");
  assert.ok(droppedAt > addedAt, "the CHECK on the profile handle is still in force");

  const indexAt = sql.indexOf("users_username_unique");
  const indexDropped = sql.lastIndexOf("DROP INDEX IF EXISTS users_username_unique");
  assert.ok(indexDropped > indexAt, "the unique index on the profile handle is still in force");
});

/** A credential must not be a published profile field. */
test("login_username is not in the profile field policy", () => {
  const policy = readFileSync(new URL("../privacy/field-policy.js", import.meta.url), "utf8");
  assert.ok(
    !policy.includes("login_username"),
    "a sign-in name became a visible profile field",
  );
});
