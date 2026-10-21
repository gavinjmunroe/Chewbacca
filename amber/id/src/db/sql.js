import pg from "pg";
import { Connector } from "@google-cloud/cloud-sql-connector";
import { ensureGcpCredentials } from "../lib/gcp-credentials.js";
import { currentTenantClient, runOnTenantClient } from "./tenant.js";

const { Pool } = pg;

const REQUIRED = ["AMBER_SQL_CONNECTION_NAME", "AMBER_SQL_DB", "AMBER_SQL_USER", "AMBER_SQL_PASSWORD"];
const missingVars = REQUIRED.filter((k) => !process.env[k]);

let _pool = null;

/**
 * THE CONNECTOR IS A LIVE HANDLE AND SOMETHING HAS TO CLOSE IT.
 *
 * It used to be a `const` inside getPool(), unreachable the moment that function
 * returned. After a successful certificate refresh CloudSQLInstance schedules the
 * next one with a plain, self-rescheduling setTimeout -- see the library's
 * cloud-sql-instance.js, `this.scheduledRefreshID = setTimeout(...)`. It is not
 * unref'd, so that timer holds the event loop open by itself, indefinitely.
 *
 * A SERVER NEVER NOTICES. A SCRIPT HANGS FOREVER. pool.end() closes the sockets
 * and resolves, the script prints its last line, the module falls off the end --
 * and node sits there with one pending timer and no work to do, which from a
 * terminal is indistinguishable from a query that never came back. Only
 * connector.close() clears it, and nothing held a reference with which to call
 * it. That is the whole bug: scripts/backfill-discovery-keys.js is the only
 * real-database script with no explicit process.exit() to paper over it, and it
 * is the one that appeared to hang.
 */
let _connector = null;

// Pool / timeout guardrails. A large contact sync used to hold one connection
// for thousands of serial round-trips; these keep any single request from
// pinning a connection forever or starving the pool.
//   max                     — hard cap on concurrent Cloud SQL connections
//   connectionTimeoutMillis — fail fast when the pool is saturated
//   idleTimeoutMillis       — reap idle connections
//   statement_timeout       — server-side kill switch for a runaway statement
// Each is env-overridable so a long-running job can be tuned without a deploy.
function _envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const POOL_MAX = _envInt("AMBER_SQL_POOL_MAX", 20);
const CONNECTION_TIMEOUT_MS = _envInt("AMBER_SQL_CONNECTION_TIMEOUT_MS", 5000);
const IDLE_TIMEOUT_MS = _envInt("AMBER_SQL_IDLE_TIMEOUT_MS", 30000);
const STATEMENT_TIMEOUT_MS = _envInt("AMBER_SQL_STATEMENT_TIMEOUT_MS", 15000);

/**
 * SMOKE-TEST POOL INJECTION, and the reason it is a function call.
 *
 * Smoke scripts TRUNCATE the tables they exercise, so they must be incapable of
 * reaching production. The tempting shortcut -- have getPool() honor a
 * SMOKE_DATABASE_URL when it is set -- makes a stray environment variable enough
 * to point the whole application at a scratch database, silently. An exported
 * function cannot be set by configuration: something has to import this module
 * and call it, which only scripts/smoke-db.mjs does.
 *
 * Nothing in src/ calls this. If that ever stops being true, that is the bug.
 */
export function __injectPoolForSmokeTests(pool) {
  if (!pool || typeof pool.query !== "function") throw new Error("not a pg pool");
  _pool = pool;
  return _pool;
}

async function getPool() {
  // An already-built pool short-circuits the config check. Order matters: a smoke
  // run injects its own pool and has no AMBER_SQL_* variables at all, and the
  // check firing first made the injection unreachable.
  if (_pool) return _pool;
  if (missingVars.length > 0) {
    throw new Error(`Cloud SQL not configured — missing env vars: ${missingVars.join(", ")}`);
  }
  // CREDENTIALS BEFORE THE CONNECTOR, and here rather than only at boot, so the
  // server, the workers and every script get them from one implementation.
  // This conversion used to happen as a SIDE EFFECT of initialising Firestore;
  // deleting Firestore silently removed Cloud SQL authentication and produced a
  // total production outage that looked like lost data. See lib/gcp-credentials.js.
  const creds = ensureGcpCredentials();
  if (!creds.ok) {
    throw new Error(
      `Cloud SQL cannot authenticate: ${creds.reason}. Set ` +
        `GOOGLE_APPLICATION_CREDENTIALS_JSON (Railway) or point ` +
        `GOOGLE_APPLICATION_CREDENTIALS at a key file.`,
    );
  }
  _connector = new Connector();
  const clientOpts = await _connector.getOptions({
    instanceConnectionName: process.env.AMBER_SQL_CONNECTION_NAME,
    ipType: "PUBLIC",
  });
  _pool = new pg.Pool({
    ...clientOpts,
    database: process.env.AMBER_SQL_DB,
    user: process.env.AMBER_SQL_USER,
    password: process.env.AMBER_SQL_PASSWORD,
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
  // An idle-client error (server restart, connector re-auth) must not crash the
  // process — pg emits it on the pool, and an unhandled 'error' event is fatal.
  _pool.on("error", (err) => {
    console.error("[sql] idle client error:", err?.message || err);
    /*
     * AN IDLE CONNECTION DYING OF A BAD CERTIFICATE IS THE WARNING SHOT.
     *
     * pg reports these on the pool rather than to any caller, so without this
     * the first anybody knows is the next request that fails. Rebuilding here
     * means the stale connector is usually gone before a person meets it,
     * which is the difference between "nobody noticed" and an hour of
     * scattered errors.
     */
    if (isStaleCertificate(err)) {
      console.error("[sql] idle client certificate rejected -- rebuilding ahead of the next request");
      resetPool().catch(() => {});
    }
  });
  return _pool;
}

/**
 * EVERY TABLE THIS PROCESS HAS TOUCHED, when asked.
 *
 * Off unless AMBER_TABLE_TRACE is set, so it costs a branch in production and
 * nothing else. It exists because "which tables does the enterprise motion
 * write to" is a question somebody should be able to ANSWER rather than
 * reason about from the source, and reasoning about it from the source is
 * exactly how a stray write to the wrong schema goes unnoticed for a year.
 */
const TRACE = new Map();

const TRACE_RE =
  /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TABLE)\s+(?:ONLY\s+)?(?:public\.)?("?[a-z_][a-z0-9_]*"?)/gi;

/**
 * Names that are SQL, not tables.
 *
 * `set` arrives from ON CONFLICT ... DO UPDATE SET, which looks exactly like
 * an UPDATE of a table called set. The first run of the audit flagged it
 * alongside two CTE names as being outside the expected surface, and three
 * false flags in a security report is how somebody learns to skim the flags
 * -- which costs far more than the noise.
 */
const NOT_TABLES = new Set([
  "set", "select", "lateral", "unnest", "generate_series", "values", "only",
]);

function trace(text) {
  if (!process.env.AMBER_TABLE_TRACE) return;
  const sql = String(text ?? "");
  const write = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);

  // CTEs are named like tables and referenced like tables. Collected first so
  // a WITH block's own names are not reported as storage.
  const ctes = new Set();
  for (const m of sql.matchAll(/(?:WITH|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) {
    ctes.add(m[1].toLowerCase());
  }

  for (const m of sql.matchAll(TRACE_RE)) {
    const name = m[1].replace(/"/g, "").toLowerCase();
    if (NOT_TABLES.has(name) || ctes.has(name)) continue;
    if (/^(jsonb_|json_|pg_)/.test(name)) continue;
    const seen = TRACE.get(name) ?? { reads: 0, writes: 0 };
    if (write) seen.writes += 1;
    else seen.reads += 1;
    TRACE.set(name, seen);
  }
}

/** What has been touched since the process started. For audits and scripts. */
export function tableTrace() {
  return [...TRACE.entries()]
    .map(([table, n]) => ({ table, ...n }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

export function resetTableTrace() {
  TRACE.clear();
}

export async function query(text, params) {
  trace(text);
  /*
   * A QUERY INSIDE A TENANT SCOPE RUNS ON THAT SCOPE'S CONNECTION.
   *
   * This is the whole integration point for row-level tenant isolation. The
   * transaction that set `amber.org_id` is held on one specific client, and a
   * query that went to the pool instead would land on a different connection
   * where the setting is absent -- which, once enforcement is on, returns zero
   * rows. Silently. So the check is here, in the one function every store in
   * this service calls, rather than in any of them.
   */
  /*
   * A query inside a tenant scope runs on that scope's one connection, in
   * order -- see runOnTenantClient. A pg client carries one query at a time,
   * and a handler that fires four with Promise.all would otherwise hand the
   * same connection four overlapping queries.
   */
  const queued = runOnTenantClient(text, params);
  if (queued) return queued;

  return withCertRecovery((pool) => pool.query(text, params));
}

/**
 * RUN SOMETHING AGAINST THE POOL, AND SURVIVE A STALE CERTIFICATE.
 *
 * Every path that reaches the pool goes through here, and that is the point.
 * The first version of this guarded query() only -- which missed the path
 * that actually matters: EVERY /v1/org route opens a tenant scope, and a
 * tenant scope calls acquireClient(), which is pool.connect() and never
 * touches query() at all. The one failure this was written to fix would still
 * have happened on the one screen it was reported from.
 */
async function withCertRecovery(run) {
  const pool = await getPool();
  try {
    return await run(pool);
  } catch (err) {
    /*
     * AN EXPIRED CLIENT CERTIFICATE IS NOT A FAILED QUERY.
     *
     * Cloud SQL's connector authenticates with an EPHEMERAL client
     * certificate, good for about an hour, which it is supposed to refresh in
     * the background. When that refresh does not happen the certificate goes
     * stale and the SERVER starts rejecting new connections:
     *
     *   error:0A000412:SSL routines:ssl3_read_bytes:
     *   ssl/tls alert bad certificate ... SSL alert number 42
     *
     * The shape of the outage is the giveaway and it is nasty: connections
     * already in the pool keep working, so the service looks healthy and most
     * requests succeed, while every NEW connection fails. Pooled connections
     * are recycled on an idle timeout, so the failures arrive gradually,
     * scattered, and look random. Exactly one hour after a deploy, parts of
     * the product start failing and nothing in the logs says why.
     *
     * The only cure is a new certificate, which means a new connector and a
     * new pool. Rebuilding is cheap next to being half-down until somebody
     * notices and redeploys, so this does it once, in-line, and retries the
     * query. Anything else rethrows untouched.
     */
    if (!isStaleCertificate(err)) throw err;
    console.error("[sql] client certificate rejected -- rebuilding the Cloud SQL connector");
    await resetPool();
    const fresh = await getPool();
    // One retry. If the rebuilt connector is ALSO refused, the certificate is
    // not the problem -- the credentials or the instance are -- and retrying
    // forever would turn an outage into a reconnect storm on top of it.
    return run(fresh);
  }
}

/**
 * Does this error mean "your certificate is no longer acceptable"?
 *
 * Matched on the text because that is what pg surfaces: the alert arrives from
 * OpenSSL rather than from Postgres, so there is no SQLSTATE to key on. Alert
 * 42 is `bad_certificate` and 45 is `certificate_expired`; both mean the same
 * thing here and both are fixed the same way.
 */
export function isStaleCertificate(err) {
  const text = `${err?.message ?? ""} ${err?.code ?? ""}`;
  return (
    /bad certificate|certificate expired|certificate has expired|alert number (42|45)/i.test(text)
  );
}

/**
 * Throw away the pool and the connector so the next getPool() builds both.
 *
 * Deliberately NOT closePool(): that is the shutdown path and it waits for
 * in-flight connections to drain. Here the connections are the problem, and
 * waiting on sockets the server is refusing is waiting for a timeout.
 */
let _resetting = null;
async function resetPool() {
  // Concurrent requests all hit the same dead pool at once; they should queue
  // behind one rebuild rather than start twenty.
  if (_resetting) return _resetting;
  const pool = _pool;
  const connector = _connector;
  _pool = null;
  _connector = null;

  _resetting = (async () => {
    try {
      if (connector) connector.close();
    } catch {
      /* tearing down a connector that is already broken is not news */
    }
    try {
      if (pool) await pool.end();
    } catch {
      /* same */
    }
  })().finally(() => {
    _resetting = null;
  });

  return _resetting;
}

/**
 * Close the pool during graceful shutdown so in-flight connections drain and
 * the process can exit cleanly instead of being force-killed. Safe to call when
 * the pool was never created (no-op) and idempotent — a second call after the
 * pool is nulled out simply does nothing.
 */
export async function closePool() {
  const pool = _pool;
  const connector = _connector;
  if (!pool && !connector) return;
  _pool = null;
  _connector = null;
  // Sockets first: they are routed through the connector, and tearing the
  // connector down underneath an open connection turns a clean drain into a
  // reset.
  if (pool) {
    try {
      await pool.end();
    } catch (err) {
      console.error("[sql] pool.end() during shutdown failed:", err?.message || err);
    }
  }
  // Then the refresh timer. Without this the process never exits -- see the
  // comment on _connector.
  if (connector) {
    try {
      connector.close();
    } catch (err) {
      console.error("[sql] connector.close() during shutdown failed:", err?.message || err);
    }
  }
}

/**
 * ONE POOLED CONNECTION, HELD BY THE CALLER.
 *
 * withTransaction() is the right primitive for a transaction that begins and
 * ends inside one function, and the wrong one for a transaction that has to
 * span a request: the tenant scope opens in a preHandler and settles in
 * onSend, and there is no single callback to wrap around that. So this hands
 * out the client and makes releasing it the caller's problem -- which is only
 * acceptable because there is exactly one caller, in tenant.js, with the
 * release in a finally.
 *
 * getPool stays module-private. Exporting the pool itself would invite
 * exactly the pattern this file exists to prevent: a store reaching past
 * query() and running outside whatever transaction is open.
 */
export async function acquireClient() {
  // Through withCertRecovery, NOT pool.connect() directly: this is the path
  // every org route takes, so a stale certificate here is the whole
  // enterprise console failing while the logs say "bad certificate".
  return withCertRecovery((pool) => pool.connect());
}

/**
 * Run `fn` inside a single-connection transaction. BEGIN/COMMIT on success,
 * ROLLBACK on throw, and the client is always released back to the pool.
 *
 * `fn` receives a pg client — use `client.query(...)` for every statement in
 * the transaction. Calling the module-level `query()` inside `fn` would grab a
 * DIFFERENT pooled connection and run outside the transaction.
 */
export async function withTransaction(fn) {
  /*
   * A TRANSACTION INSIDE A TENANT SCOPE JOINS IT RATHER THAN OPENING A RIVAL.
   *
   * The tenant scope is already a transaction, on one specific connection,
   * with amber.org_id set on it. Opening a second one here takes a DIFFERENT
   * connection out of the pool -- which has no tenant set, so once enforcement
   * is on every write inside it fails the policy's WITH CHECK. createInvite,
   * acceptInvite and createOrganization all run this way.
   *
   * A nested BEGIN is also not a transaction: Postgres warns and the inner
   * COMMIT would commit the OUTER one, so a failure after it could not roll
   * back. Joining is both the correct isolation and the correct nesting --
   * the caller's atomicity still holds, because the outer transaction is what
   * settles, and it settles all-or-nothing.
   */
  const joined = currentTenantClient();
  if (joined) {
    /*
     * The caller is handed a FACADE, not the raw client. fn() does its own
     * client.query() calls, and those have to go through the same queue as
     * everything else on this connection or they overlap with whatever the
     * handler is doing around them.
     */
    return fn({ query: (text, params) => runOnTenantClient(text, params) });
  }

  // Same recovery as every other path: a transaction that cannot get a
  // connection because the certificate expired is not a failed transaction.
  const client = await withCertRecovery((pool) => pool.connect());
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
