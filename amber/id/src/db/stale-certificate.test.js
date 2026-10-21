/**
 * THE HOUR-LONG OUTAGE, AND WHY IT LOOKED LIKE A LOGIN BUG.
 *
 * Cloud SQL's connector authenticates with an ephemeral client certificate
 * valid for about an hour. When its background refresh does not happen, the
 * server starts rejecting NEW connections with an OpenSSL alert while the
 * connections already in the pool keep working — so the service looks healthy,
 * most requests succeed, and a scattered minority fail, starting exactly one
 * hour after a deploy.
 *
 * What a person saw was "Account not found", on a console that had already
 * loaded with their company's name on it. Two separate pieces of code turned
 * a database that did not answer into a confident statement about who they
 * were; both are tested here and in resolve-actor.test.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isStaleCertificate } from "./sql.js";

const sqlSrc = readFileSync(new URL("./sql.js", import.meta.url), "utf8");

/** The exact text Railway logged, in full. */
const REAL =
  "8083BF6DFA7F0000:error:0A000412:SSL routines:ssl3_read_bytes:ssl/tls alert bad certificate:ssl/record/rec_layer_s3.c:916:SSL alert number 42";

test("the real production error is recognized as a stale certificate", () => {
  assert.equal(isStaleCertificate(new Error(REAL)), true);
});

test("alert 45, certificate_expired, is the same problem", () => {
  assert.equal(isStaleCertificate(new Error("tlsv1 alert certificate expired ... SSL alert number 45")), true);
});

/**
 * THE IMPORTANT HALF. A matcher this broad is one bad regex away from
 * rebuilding the pool on every ordinary failure, which would turn one slow
 * query into a reconnect storm.
 */
test("ordinary database failures are NOT treated as certificate problems", () => {
  for (const message of [
    "duplicate key value violates unique constraint",
    "canceling statement due to statement timeout",
    "connection terminated unexpectedly",
    "relation org_audiences does not exist",
    "password authentication failed for user",
    "too many connections for role",
    "self signed certificate in certificate chain", // a CA problem; reconnecting does not fix it
  ]) {
    assert.equal(
      isStaleCertificate(new Error(message)),
      false,
      `"${message}" must not trigger a pool rebuild`,
    );
  }
});

test("a missing or shapeless error does not throw and does not match", () => {
  assert.equal(isStaleCertificate(undefined), false);
  assert.equal(isStaleCertificate(null), false);
  assert.equal(isStaleCertificate({}), false);
});

/**
 * EVERY PATH TO THE POOL RECOVERS, NOT JUST query().
 *
 * The first version of the fix guarded query() alone — and missed the path
 * that actually mattered. Every /v1/org route opens a tenant scope, a tenant
 * scope calls acquireClient(), and acquireClient was a bare pool.connect()
 * that query() never sees. The one failure this was written to fix would
 * still have happened on the one screen it was reported from.
 *
 * Structural rather than behavioral because the failure is a path somebody
 * adds later that forgets, and only a test that reads the file catches that.
 */
test("EVERY POOL ACCESS GOES THROUGH THE CERTIFICATE RECOVERY", () => {
  // getPool() is module-private and legitimately used by the recovery helper
  // itself and by resetPool's bookkeeping; what must never appear is a raw
  // connect or query on a pool obtained outside withCertRecovery.
  const offenders = [];
  for (const m of sqlSrc.matchAll(/^(?!.*withCertRecovery).*\bconst pool = await getPool\(\);/gm)) {
    const after = sqlSrc.slice(m.index, m.index + 400);
    if (/pool\.(connect|query)\(/.test(after)) offenders.push(m[0].trim());
  }
  assert.deepEqual(
    offenders,
    [],
    `these reach the pool without certificate recovery:\n  ${offenders.join("\n  ")}`,
  );
});

test("the pool's idle-error handler rebuilds on a stale certificate", () => {
  // pg reports a dying idle connection on the pool, not to any caller, so
  // without this the first anybody knows is the next request that fails.
  const handler = sqlSrc.slice(sqlSrc.indexOf('_pool.on("error"'), sqlSrc.indexOf('_pool.on("error"') + 900);
  assert.match(handler, /isStaleCertificate\(err\)/);
  assert.match(handler, /resetPool\(\)/);
});
