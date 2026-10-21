/**
 * WHICH COMPANY THIS REQUEST IS ACTING FOR, carried without being passed.
 *
 * Migration 070 put a row-level policy on every org table that compares the
 * row's org_id to a transaction-local setting. Something has to set it, on the
 * same connection, before anything reads -- and the obvious way to do that is
 * to thread a client through every store function, which would mean touching
 * every signature in four files and would be forgotten by the first function
 * added afterwards.
 *
 * AsyncLocalStorage carries it instead. A request enters withTenant once, at
 * the route boundary; everything it awaits -- however deep, however many
 * promises down -- sees the same store, and query() picks the client out of it
 * without a single store function knowing this exists.
 *
 * IT IS A TRANSACTION, NOT A CONNECTION SETTING. `SET LOCAL` is scoped to the
 * transaction and unwinds with it, which is the property that matters on a
 * pooled connection: a request that throws cannot leave its tenant set on a
 * connection the next request picks up. A plain SET would do exactly that, and
 * the bug would be one company's data served to the next caller in the pool --
 * the precise failure this whole mechanism exists to prevent, reintroduced by
 * the mechanism.
 *
 * NOT EVERY QUERY IS IN A TENANT. Signing in, accepting an invite and
 * resolving who the caller is all happen BEFORE there is a company to act for,
 * and they read tables that have no policy on them. Those run outside, on the
 * ordinary pool, exactly as before.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

/** The client the current tenant transaction is running on, if any. */
export function currentTenantClient() {
  return store.getStore()?.client ?? null;
}

/**
 * ONE QUERY AT A TIME ON A SHARED CONNECTION.
 *
 * A pg client is a single connection and a single wire protocol: it can carry
 * exactly one query at a time. Before the tenant scope existed, every store
 * call took its own connection from the pool, so a handler could fire four at
 * once and mean it. Now they all run on the scope's one client -- and a
 * handler doing
 *
 *     await Promise.all([knowledgeStats(), listPages(), listFeed(), listGroups()])
 *
 * hands that client four overlapping queries. pg currently serializes them and
 * warns; in pg@9 it stops warning and starts being an error.
 *
 * So the client gets a queue. Each query waits for the one before it on the
 * same connection and nowhere else -- unscoped queries still go to the pool
 * and still run in parallel. The handler's Promise.all is unchanged and still
 * correct; it just no longer means what it used to, and this is the one place
 * that has to know that.
 *
 * The chain is held per scope rather than on the client, because the client
 * goes back to the pool at the end of the request and a promise chained to a
 * finished transaction is a leak that outlives it.
 */
function enqueue(holder, work) {
  const next = holder.chain.then(work, work);
  // Swallow on the CHAIN only. The caller still gets the real rejection from
  // `next`; this keeps one failed query from poisoning every later one on the
  // same connection, and keeps Node from reporting an unhandled rejection for
  // a promise nothing is awaiting.
  holder.chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Run one query on the current tenant's connection, in order. Null if none. */
export function runOnTenantClient(text, params) {
  const holder = store.getStore();
  if (!holder?.client) return null;
  return enqueue(holder, () => holder.client.query(text, params));
}

/**
 * The scope runner, exported for tests only.
 *
 * The queue is the kind of thing that is correct today and quietly regresses
 * the next time somebody "simplifies" it, and the regression is a warning in
 * a log that becomes an error two pg majors later. A test needs a way in.
 */
export const __testScope = (value, fn) => store.run(value, fn);

/** The organization the current context is acting for, for assertions and logs. */
export function currentTenantOrg() {
  return store.getStore()?.orgId ?? null;
}

/**
 * Run `fn` with every query inside it scoped to one organization.
 *
 * Used by jobs and scripts, which have no Fastify lifecycle to hang the scope
 * on. Requests use registerTenantScope() below instead.
 *
 * @param {string} orgId
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function withTenant(orgId, fn) {
  if (!orgId) throw new Error("withTenant requires an orgId");
  const { acquireClient } = await import("./sql.js");
  const client = await acquireClient();
  try {
    await client.query("BEGIN");
    // set_config rather than string-interpolating into SET LOCAL: the org id
    // comes from a membership row and not from a request, but a security
    // boundary is not where you rely on that staying true.
    await client.query("SELECT set_config('amber.org_id', $1, true)", [String(orgId)]);
    const out = await store.run({ client, orgId: String(orgId), chain: Promise.resolve() }, fn);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A Fastify preHandler: put the rest of the request inside its tenant.
 *
 * Fastify's hook chain is not one continuous async scope -- the handler runs
 * after the preHandler's promise has already settled -- so a preHandler cannot
 * open an AsyncLocalStorage scope that the handler is inside. The wrapping
 * therefore happens around the HANDLER, in tenantRoute() below, and this is
 * only here so the actor is resolved first.
 */
export function tenantOf(request) {
  return request?.actor?.orgId ?? null;
}

/**
 * THE FASTIFY SIDE.
 *
 * Fastify's hook chain is a chain of callbacks, and AsyncLocalStorage.run()
 * keeps its store for everything inside the callback it is given -- so an
 * onRequest hook written in the done-callback style wraps the whole rest of
 * the lifecycle, handler included. This is the same mechanism
 * @fastify/request-context uses, for the same reason.
 *
 * THE TRANSACTION IS OPENED LATE AND CLOSED EARLY. It cannot start in
 * onRequest, because which company this is for is not known until the actor
 * has been resolved from the token; and it must not still be open while a
 * response serializes, or a slow client holds a database connection. So the
 * scope is created empty in onRequest, filled in a preHandler once the actor
 * exists, and settled in onSend.
 *
 * A ROUTE THAT NEVER RESOLVES AN ACTOR NEVER OPENS ONE. Signing in and
 * accepting an invite read tables with no policy on them and run exactly as
 * they did before.
 */
export function registerTenantScope(app) {
  /*
   * The scope OBJECT is created for every request, empty. It has to exist
   * before anything can fill it in, and onRequest in the done-callback style
   * is the one hook that wraps the whole rest of the lifecycle.
   */
  app.addHook("onRequest", (request, reply, done) => {
    store.run({ client: null, orgId: null, chain: Promise.resolve() }, done);
  });

  /*
   * SETTLING THE TRANSACTION IS GLOBAL, because a request that opened one must
   * close it whatever happened afterwards -- including a 500 thrown out of a
   * handler that never reached its own hooks.
   */
  app.addHook("onSend", async (request, reply, payload) => {
    const holder = store.getStore();
    if (!holder?.client) return payload;
    const client = holder.client;
    holder.client = null;
    try {
      // A 4xx or 5xx rolls back. Nothing in these routes depends on a partial
      // write surviving an error response, and committing one would mean a
      // failed request that changed something.
      await client.query(reply.statusCode >= 400 ? "ROLLBACK" : "COMMIT");
    } catch (err) {
      request.log?.error?.({ err: String(err) }, "[tenant] could not settle the tenant transaction");
      await client.query("ROLLBACK").catch(() => {});
    } finally {
      client.release();
    }
    return payload;
  });
}

/**
 * OPEN THE TENANT SCOPE. A ROUTE-LEVEL preHandler, AND THE ORDER IS THE POINT.
 *
 * This was a global preHandler, and that was wrong in a way nothing could
 * catch while enforcement was off: Fastify runs global hooks BEFORE
 * route-level ones, so it fired before resolveActor had found which company
 * the caller is in. request.actor was undefined every single time, the scope
 * never opened, and every query went to the pool unscoped -- invisible with
 * the owner bypassing policies, and a console that returns nothing for
 * everybody the moment FORCE lands.
 *
 * So it goes in the route's own preHandler array, immediately after
 * resolveActor, where the thing it depends on already exists. There is a test
 * that it stays there.
 */
export async function openTenantScope(request) {
  const orgId = tenantOf(request);
  const holder = store.getStore();
  if (!orgId || !holder || holder.client) return;

  /*
   * A FAILURE TO OPEN THE SCOPE IS NOT A FAILURE OF THE REQUEST -- yet.
   *
   * While enforcement is off, a request without a scope behaves exactly as it
   * always has, so a transient pool error here should not turn a working
   * console into a 500. Once amber_tenant_enforce() has run, the same request
   * returns no rows and the problem is loud rather than silent, which is the
   * correct failure for a security control.
   */
  try {
    const { acquireClient } = await import("./sql.js");
    const client = await acquireClient();
    await client.query("BEGIN");
    await client.query("SELECT set_config('amber.org_id', $1, true)", [String(orgId)]);
    /*
     * AND WHO, not only which company.
     *
     * No policy reads this today -- the private-by-default split on the
     * relationship ledger is enforced in the store, where it belongs, because
     * that rule has designed exceptions and a policy with exceptions is one
     * every aggregate has to fight. This is set anyway so that the day a
     * member-scoped policy IS the right answer, the security context is
     * already on the connection and nobody is editing the tenant boundary
     * under deadline.
     *
     * Jobs running through withTenant() leave it unset on purpose: a job acts
     * for the company, not as a person, and a job that silently inherited
     * somebody's identity would be the worst kind of bug to find.
     */
    const memberId = request?.actor?.amberId ?? null;
    if (memberId) {
      await client.query("SELECT set_config('amber.amber_id', $1, true)", [String(memberId)]);
    }
    holder.client = client;
    holder.orgId = String(orgId);
    request.tenantScoped = true;
  } catch (err) {
    request.log?.warn?.({ err: String(err) }, "[tenant] could not open a tenant scope");
  }
}
