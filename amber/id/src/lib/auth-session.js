/**
 * SESSION AUTH AND THE TENANT INDEX. No Privy.
 *
 * This file was called privy.js and its docstring called Privy "the single source
 * of truth for all Amber identity". That stopped being true a long time before
 * anyone deleted the sentence. What is left, and what was always the real system:
 *
 *   requireAuth   verifies a session token we issued ourselves -- an amber-id
 *                 HMAC JWT from /v1/otp/verify, or a medha-id session JWT from
 *                 /v1/auth/otp/request, which is what the iOS app uses. Both are
 *                 local HMAC verifications against Cloud SQL state. No network
 *                 call, no third party.
 *   tenantIndex   a Cloud SQL lookup over `users`, cached for 30s.
 *   rowToTenant   a `users` row shaped for the ~10 readers that still expect the
 *                 old object shape.
 *   normalizePhone  a pure E.164 string function that was never Privy's.
 *
 * The Privy half -- getPrivyClient, verifyToken, getUserByDid, getUserByEmail,
 * setUserMetadata, listAllUsers, pingPrivy and the circuit breaker around them --
 * is deleted, along with @privy-io/server-auth. requireAuth had a third branch
 * that fell through to a network token verification; it is gone too. A token that
 * is neither an amber-id nor a medha-id session is not a token we issued.
 *
 * `request.privyUser` keeps its name for now because 45 route files read it and
 * renaming it is a separate, mechanical change. It has never meant "a Privy user"
 * -- every branch of requireAuth populates it.
 *
 * users.privy_did SURVIVES as a column. It is indexed and read on hot resolver
 * paths for accounts created before phone OTP existed; it is an identifier we
 * stored, not a dependency we call.
 */

import { query } from "../db/sql.js";
import { WEB_SESSION_FULL_SCOPE, scopeAllows } from "./token-scope.js";

let client = null;

// Lightweight E.164 normalizer used by TenantIndex._byPhone and the
// service-auth ingest path. We don't need libphonenumber accuracy here —
// we only need consistency between writers (tenant seeding) and readers
// (x-amber-phone header on /ingest/*). Strips spaces/dashes/parens, adds
// + if missing, prepends +1 for bare 10-digit US numbers.
export function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) return s;
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  if (/^\d+$/.test(s)) return `+${s}`;
  return s;
}


/**
 * Map a Cloud SQL `users` row to a Privy-user-SHAPED object so the ~10 read
 * consumers (ingest, ingest-imessage, events/reminders/content-seeds/
 * pipelines/personal-life/partnerships resolvePrincipal, profile, numbers,
 * index status) keep reading `.id` / `.did` / `.phone?.number` /
 * `.customMetadata?.loopSenderId` unchanged.
 *
 * `did` is ALWAYS non-null, stable, unique: the backfilled Privy DID when we
 * have one, else a synthetic `did:amber:<amber_id>`.
 */
export function rowToTenant(row) {
  if (!row) return null;
  const did = row.privy_did || `did:amber:${row.amber_id}`;
  const meta =
    row.tenant_metadata && typeof row.tenant_metadata === "object"
      ? row.tenant_metadata
      : {};
  return {
    id: did,
    did,
    amberId: row.amber_id,
    phone: { number: row.phone || null },
    // Top-level phoneNumber string kept ALONGSIDE phone:{number} because
    // reminders.js resolvePrincipal reads `tenant?.phoneNumber` directly off
    // this object (before falling through to the phone object). Without it
    // that consumer would capture the {number} object as the requester phone.
    phoneNumber: row.phone || null,
    customMetadata: {
      ...meta,
      loopSenderId: row.loop_sender_id || null,
      phoneNumber: row.phone || null,
    },
    createdAt: row.created_at || null,
  };
}

const TENANT_CACHE_TTL_MS = 30_000;

/**
 * TenantIndex: Cloud-SQL-backed tenant lookup (Chunk 2b). Replaces the old
 * 3-min Privy `listAllUsers` refresh. Serves reads from a small in-memory
 * snapshot of `users` (all non-deleted rows, mapped through rowToTenant),
 * refreshed lazily (stale-while-revalidate, 30s TTL) so the getters stay
 * SYNCHRONOUS — the read consumers call them without `await`, so they must
 * not become promises.
 */
class TenantIndex {
  constructor() {
    this._bySenderId = new Map();
    this._byPhone = new Map();
    this._byDid = new Map();
    this._byAmberId = new Map();
    this._allUsers = [];
    this._refreshing = null; // in-flight refresh promise (dedupes concurrent)
    this._lastRefresh = 0;
  }

  // Kept for index.js lifecycle (startup warm + shutdown). No background
  // interval — the cache refreshes lazily on read.
  async start() {
    await this._refresh();
  }

  stop() {
    this._bySenderId.clear();
    this._byPhone.clear();
    this._byDid.clear();
    this._byAmberId.clear();
    this._allUsers = [];
    this._lastRefresh = 0;
  }

  async _refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      try {
        const { rows } = await query(
          `SELECT * FROM users WHERE deleted_at IS NULL`,
        );
        const bySender = new Map();
        const byPhone = new Map();
        const byDid = new Map();
        const byAmber = new Map();
        const all = [];
        for (const row of rows) {
          const tenant = rowToTenant(row);
          all.push(tenant);
          if (row.loop_sender_id) bySender.set(row.loop_sender_id, tenant);
          const p = normalizePhone(row.phone);
          if (p) byPhone.set(p, tenant);
          byAmber.set(row.amber_id, tenant);
          if (row.privy_did) byDid.set(row.privy_did, tenant);
        }
        this._bySenderId = bySender;
        this._byPhone = byPhone;
        this._byDid = byDid;
        this._byAmberId = byAmber;
        this._allUsers = all;
        this._lastRefresh = Date.now();
      } catch (err) {
        console.error("[TenantIndex] Cloud SQL refresh failed:", err.message);
      } finally {
        this._refreshing = null;
      }
    })();
    return this._refreshing;
  }

  // Fire a background refresh when the snapshot is stale. Never awaited by the
  // synchronous getters — they return the current snapshot immediately.
  _maybeRefresh() {
    if (
      !this._refreshing &&
      Date.now() - this._lastRefresh > TENANT_CACHE_TTL_MS
    ) {
      this._refresh();
    }
  }

  getByLoopSenderId(id) {
    this._maybeRefresh();
    return id ? this._bySenderId.get(id) || null : null;
  }

  getByPhone(phone) {
    this._maybeRefresh();
    const p = normalizePhone(phone);
    return p ? this._byPhone.get(p) || null : null;
  }

  // Accepts a Privy DID, a `did:amber:<uuid>`, or a bare amber_id uuid.
  getByDid(did) {
    this._maybeRefresh();
    if (!did) return null;
    const direct = this._byDid.get(did);
    if (direct) return direct;
    const bare = String(did).replace(/^did:amber:/, "");
    return this._byAmberId.get(bare) || null;
  }

  getAll() {
    this._maybeRefresh();
    return this._allUsers;
  }

  async forceRefresh() {
    await this._refresh();
  }

  stats() {
    return {
      size: this._bySenderId.size,
      totalUsers: this._allUsers.length,
      lastRefresh: this._lastRefresh
        ? new Date(this._lastRefresh).toISOString()
        : null,
      lastRefreshMsAgo: this._lastRefresh
        ? Date.now() - this._lastRefresh
        : null,
    };
  }
}

export const tenantIndex = new TenantIndex();

/**
 * Fastify preHandler: accepts EITHER an amber-id native session JWT (issued
 * by /v1/otp/verify) OR a legacy Privy bearer token. The amber-id JWT path
 * is checked first because it's faster (HMAC verify, no network) and is
 * the path every new client uses.
 *
 * On success sets `request.privyUser = { userId, phone, source }` where
 * `userId` is the canonical DID for amber-id native users (`did:amber:...`)
 * or the Privy DID for legacy users. Existing routes don't need to know
 * which path the request came in on — they just consume `userId`.
 */
/**
 * Verify a bearer token OUT OF BAND -- for the two endpoints that are handed a
 * token in a request body rather than an Authorization header.
 *
 * Same two token types requireAuth accepts, same order, same local HMAC checks.
 * It replaces a Privy verifyToken() network call at those two call sites; a token
 * we did not issue is not valid, which is the whole rule now.
 *
 * Returns { userId, phone, source } or null.
 */
export async function verifySessionTokenAny(token) {
  if (typeof token !== "string" || !token) return null;
  const { verifySessionToken } = await import("./amber-jwt.js");
  const amber = verifySessionToken(token);
  if (amber) return { userId: amber.did, phone: amber.phone ?? null, source: "amber-id" };
  const { verifyMedhaSession } = await import("./medha-jwt.js");
  const medha = verifyMedhaSession(token);
  if (medha) {
    if (medha.sid) {
      const { isSessionDenied } = await import("./session-denylist.js");
      if (isSessionDenied(medha.sid)) return null;
    }
    return { userId: medha.personId, phone: medha.phone ?? null, sid: medha.sid, source: "medha-id" };
  }
  return null;
}

/**
 * A SCOPED TOKEN ON A ROUTE ITS SCOPE DOES NOT COVER.
 *
 * Enforced here, inside requireAuth, rather than route by route. Every
 * user-authenticated route in this service already goes through requireAuth, so
 * this is the one place that cannot be forgotten -- and forgetting, for an
 * authorization check, means a new endpoint that quietly accepts a browser
 * token it was never meant to see.
 *
 * Returns the reply when it refused, so the caller can `return` it, and
 * undefined when the request may proceed.
 */
function denyOutOfScope(request, reply) {
  const scope = request.tokenScope;
  if (!Array.isArray(scope)) return undefined; // unrestricted token

  // Fastify 5 puts the matched route pattern on routeOptions.url. routerPath is
  // the older spelling and is kept as a fallback rather than assumed absent:
  // scopeAllows treats "no pattern" as a refusal, so getting this wrong fails
  // closed and loudly instead of open and silently.
  const pattern = request.routeOptions?.url ?? request.routerPath ?? null;
  if (scopeAllows(scope, request.method, pattern)) return undefined;

  request.log?.warn?.(
    { scope, method: request.method, route: pattern },
    "[auth] scoped token refused out-of-scope route",
  );
  return reply.code(403).send({
    error: "out_of_scope",
    code: "out_of_scope",
    /*
     * THE OLD SENTENCE HERE TOLD PEOPLE TO SIGN IN FROM THE APP, which is
     * wrong and was wrong in a way that mattered. Nobody administering a
     * company has the app; the website is the whole product for them. Telling
     * an admin that the fix for a scope error is an iPhone is telling them
     * their purchase does not work.
     *
     * It is also almost never the right advice any more: the common cause of
     * this is a session older than a capability, and that now repairs itself
     * a few lines below. What is left is genuinely "this token may not do
     * that", so that is what it says.
     */
    message: "This session is not allowed to do that. Sign out and back in, and if it keeps happening the account does not have permission.",
    scope,
  });
}

/**
 * A BROWSER SESSION OLDER THAN A CAPABILITY REPAIRS ITSELF.
 *
 * Scope is baked into a token when it is minted and the facts behind it are
 * not. Ship a feature with a new scope name and every session signed in before
 * the deploy -- up to eight hours of them -- gets a 403 on the new screens,
 * with no way out but signing out and back in, and no sign that that is the
 * cure. We shipped exactly that twice: once when org:admin was computed from a
 * membership that changed a millisecond later, and again when org:knowledge
 * arrived and every open console started refusing to save a profile.
 *
 * So: a token whose scope is a PROPER SUBSET of what a browser session is
 * minted with today, and every entry of which is a browser scope, is a stale
 * browser session rather than a deliberately narrow credential. It is widened
 * for this request and a replacement token goes back on a response header for
 * the client to keep.
 *
 * WHAT MAKES THIS SAFE RATHER THAN A WAY TO WIDEN ANY TOKEN. Every path that
 * mints a browser token calls webSessionScopeFor(), which returns one static
 * list; nothing in this service deliberately issues a narrower scoped token.
 * An unrestricted token (the app's, scope null) is not touched because it is
 * not an array. An API key is not an amber-id session token and never reaches
 * here. And the widening grants nothing the same person would not be given by
 * signing out and back in one second later -- which is the alternative, and
 * the only thing this removes is their having to know that.
 */
function refreshStaleWebScope(request, reply, claims) {
  const scope = request.tokenScope;
  if (!Array.isArray(scope) || scope.length === 0) return;
  const full = WEB_SESSION_FULL_SCOPE;
  const known = new Set(full);
  if (!scope.every((s) => known.has(s))) return;

  const staleScope = scope.length < full.length;

  /*
   * PAST HALFWAY, IT IS REPLACED. This is what "stay signed in" actually is:
   * somebody using the product every day never reaches an expiry, and
   * somebody who stops using it is signed out on the original clock.
   */
  const iat = Number(claims?.iat) || 0;
  const exp = Number(claims?.exp) || 0;
  const aging =
    iat > 0 && exp > iat && Date.now() / 1000 > iat + (exp - iat) * RENEW_AFTER_FRACTION;

  if (!staleScope && !aging) return;

  request.tokenScope = [...full];
  try {
    const { token, expiresAt } = signSessionTokenRef({
      did: claims.did,
      phone: claims.phone ?? null,
      scope: [...full],
      ttlSeconds: WEB_SESSION_REFRESH_TTL_SECONDS,
    });
    // A header rather than a body field, because this has to reach every route
    // at once and not one of them should have to know it happened.
    reply.header("x-amber-session", token);
    reply.header("x-amber-session-reason", staleScope ? "scope" : "renewed");
    reply.header("x-amber-session-expires", String(expiresAt ?? ""));
    reply.header(
      "access-control-expose-headers",
      "x-amber-session, x-amber-session-expires, x-amber-session-reason",
    );
  } catch (err) {
    // A token that could not be re-minted is not a reason to refuse a request
    // the widened scope already permits. The session simply stays stale.
    request.log?.warn?.({ err: String(err) }, "[auth] could not refresh a stale web session");
  }
}

/*
 * FOURTEEN DAYS, RENEWED ON USE.
 *
 * Eight hours is right for a bank and wrong for a tool somebody has open all
 * day: it meant signing in again every morning, and on a deployment where the
 * only other door is an emailed link that nobody can send, it meant signing in
 * again with the one credential that might not exist yet.
 *
 * Renewal is what makes a long life safe rather than merely long. A token
 * past the halfway mark is replaced on the next request, so a session that is
 * being used never expires and a session that is abandoned dies on schedule.
 * A stolen token still expires on its own clock; it does not inherit the
 * victim's renewals, because renewal replaces the token the holder has rather
 * than extending the one they had.
 */
const WEB_SESSION_REFRESH_TTL_SECONDS = 14 * 24 * 60 * 60;
const RENEW_AFTER_FRACTION = 0.5;
let signSessionTokenRef = null;

export async function requireAuth(request, reply) {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return reply.code(401).send({
      // `error` is the machine-readable code -- the mobile transport
      // (lib/medhaId.ts) reads THIS field to pick user-facing copy, and every
      // other route in this service follows the same convention. Putting a
      // human sentence here made all 401s degrade to a generic error toast.
      error: "missing_token",
      message: "Missing authorization token",
      code: "missing_token",
      reason: "no_bearer",
      hint: "proxy did not forward Authorization: Bearer <jwt>; user likely not signed in",
    });
  }
  const token = auth.replace("Bearer ", "");

  // Try amber-id first. Capture WHY it failed so the 401 can tell us if
  // it's a secret mismatch vs an expired token vs a non-amber-id token.
  const { verifySessionToken, debugVerify } = await import("./amber-jwt.js");
  const amberClaims = verifySessionToken(token);
  if (amberClaims) {
    request.privyUser = {
      userId: amberClaims.did,
      phone: amberClaims.phone,
      source: "amber-id",
    };
    // null for every token iOS holds and every token minted before scopes
    // existed, which is what keeps this from changing their behavior at all.
    request.tokenScope = amberClaims.scope ?? null;
    if (!signSessionTokenRef) {
      ({ signSessionToken: signSessionTokenRef } = await import("./amber-jwt.js"));
    }
    refreshStaleWebScope(request, reply, amberClaims);
    const denied = denyOutOfScope(request, reply);
    if (denied) return denied;
    return;
  }

  // Try medha-id session next. The medha-frontend OTP login (/v1/auth/verify
  // in src/routes/medha-dashboard.js) signs with MEDHA_JWT_SECRET and issues
  // sub=person_id (sha256 of E.164 phone), iss="medha-id". Earlier code only
  // tried amber-jwt + Privy, which guaranteed 401 for every phone-OTP user.
  // userId is the person_id; the OAuth secrets bag and api-keys owner field
  // both key off whatever requireAuth populates, so consistency holds.
  const { verifyMedhaSession } = await import("./medha-jwt.js");
  const medhaClaims = verifyMedhaSession(token);
  if (medhaClaims) {
    // Revocation. Access tokens are stateless, so a signed-out token stays
    // cryptographically valid until it expires. The denylist closes that window
    // immediately on this replica; elsewhere the short access TTL bounds it, and
    // the refresh row is already dead so the session cannot be extended.
    // Legacy tokens (minted before device sessions) carry no sid and are simply
    // not revocable -- exactly the behavior they had before, and they age out.
    if (medhaClaims.sid) {
      const { isSessionDenied } = await import("./session-denylist.js");
      if (isSessionDenied(medhaClaims.sid)) {
        return reply.code(401).send({
          error: "session_revoked",
          message: "You have been signed out. Please sign in again.",
        });
      }
    }
    request.privyUser = {
      userId: medhaClaims.personId,
      phone: medhaClaims.phone,
      sid: medhaClaims.sid,
      source: "medha-id",
    };
    return;
  }

  // Why did amber-id reject? Useful for diagnosing AMBER_JWT_SECRET drift
  // between deploys. debugVerify never throws and never echoes the token.
  let amberReason = "unknown";
  try {
    amberReason = debugVerify ? debugVerify(token) : "no_debugVerify";
  } catch {
    amberReason = "debugVerify_threw";
  }


  // NO THIRD BRANCH. There used to be one: fall through to Privy and verify the
  // token over the network. Privy is gone -- no login flow ever used it, the iOS
  // app has always authenticated through /v1/auth/otp/request against Cloud SQL,
  // and the dependency is out of package.json. A token that is neither an
  // amber-id nor a medha-id session is simply not a token we issued.
  return reply.code(401).send({
    error: "invalid_token",
    message: "Session token is not valid or has expired",
  });
}
