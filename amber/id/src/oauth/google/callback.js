/**
 * Google OAuth callback: exchange the auth code for tokens and persist
 * them into the per-tenant secrets bag.
 *
 * One Google consent grants Calendar + Gmail + Drive scopes, but we mirror
 * the same tokens under three key prefixes (GCAL_*, GMAIL_*, GDRIVE_*) so
 * downstream tools can flip on per-product without parsing the scope string.
 * The *_OAUTH_SCOPES key for each family is set only when at least one of
 * that family's scopes is actually present in Google's response, so a user
 * who downgrades scopes later has the right family flag flip off.
 */

import { setSecrets } from "../../db/secrets.js";
import { callbackUrl } from "./init.js";
import { GOOGLE_SCOPE_FAMILIES } from "./scopes.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`google_oauth_env_missing:${name}`);
  }
  return v;
}

/**
 * Exchange an authorization code for tokens. Returns the raw token payload
 * from Google: { access_token, refresh_token, expires_in, scope, token_type, id_token? }.
 * Throws with a code-shaped message on failure so the route handler can
 * map to a callback redirect.
 */
export async function exchangeCode(code) {
  if (!code || typeof code !== "string") {
    throw new Error("invalid_code");
  }

  const body = new URLSearchParams({
    code,
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect_uri: callbackUrl(),
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error || `http_${res.status}`;
    const err = new Error(`token_exchange_failed:${reason}`);
    err.googleError = json;
    throw err;
  }
  if (!json.refresh_token) {
    throw new Error("token_exchange_failed:missing_refresh_token");
  }
  return json;
}

function familyKeys(prefix) {
  return {
    refresh: `${prefix}_OAUTH_REFRESH`,
    access: `${prefix}_OAUTH_ACCESS`,
    expires: `${prefix}_OAUTH_EXPIRES_AT`,
    scopes: `${prefix}_OAUTH_SCOPES`,
    connectedAt: `${prefix}_OAUTH_CONNECTED_AT`,
  };
}

function familyGranted(grantedSet, familyScopes) {
  return familyScopes.some((s) => grantedSet.has(s));
}

/**
 * Decode the `email` claim out of a Google id_token without verifying
 * the signature. We just received it from Google's token endpoint over
 * TLS so it's trusted by construction; we only need the payload for
 * display ("Connected as <email>"). Returns null on any parse failure.
 */
function emailFromIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const seg = parts[1];
    const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
    const json = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const claims = JSON.parse(json);
    if (claims.email_verified === false) return null;
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

/**
 * Persist a Google token bundle into the secrets bag for a given DID.
 *
 * The same tokens are written under GCAL_*, GMAIL_*, and GDRIVE_* prefixes.
 * Scopes within each family are checked against Google's actual `scope`
 * response so the right family flags flip on. The id_token is stored as
 * GOOGLE_OAUTH_ID_TOKEN, and the user-facing Google account email is
 * decoded out of it and stored as *_OAUTH_ACCOUNT_EMAIL so /connect can
 * show "Connected as foo@gmail.com" without an extra Google API call.
 */
export async function storeTokens(did, tokens, { updatedBy } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("storeTokens requires a DID string");
  }
  const grantedScopes = (tokens.scope || "").split(/\s+/).filter(Boolean);
  const grantedSet = new Set(grantedScopes);
  const now = Date.now();
  const expiresAt = new Date(
    now + (Number(tokens.expires_in) || 0) * 1000,
  ).toISOString();
  const connectedAt = new Date(now).toISOString();
  const accountEmail = emailFromIdToken(tokens.id_token);

  // Mirror the platform's OAuth client_id/secret into the per-tenant bag
  // so downstream consumers (refresh flows, agent tools) never have to
  // depend on a process.env fallback that may not resolve on every host.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || null;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || null;

  const record = {
    GOOGLE_OAUTH_ID_TOKEN: tokens.id_token || null,
    GOOGLE_OAUTH_TOKEN_TYPE: tokens.token_type || "Bearer",
    GOOGLE_OAUTH_ACCOUNT_EMAIL: accountEmail,
  };

  const prefixes = [
    { prefix: "GCAL", family: GOOGLE_SCOPE_FAMILIES.gcal },
    { prefix: "GMAIL", family: GOOGLE_SCOPE_FAMILIES.gmail },
    { prefix: "GDRIVE", family: GOOGLE_SCOPE_FAMILIES.gdrive },
    { prefix: "GCONTACTS", family: GOOGLE_SCOPE_FAMILIES.gcontacts },
  ];
  for (const { prefix, family } of prefixes) {
    if (!familyGranted(grantedSet, family)) continue;
    const k = familyKeys(prefix);
    record[k.refresh] = tokens.refresh_token;
    record[k.access] = tokens.access_token;
    record[k.expires] = expiresAt;
    record[k.scopes] = family.filter((s) => grantedSet.has(s)).join(" ");
    record[k.connectedAt] = connectedAt;
    record[`${prefix}_OAUTH_ACCOUNT_EMAIL`] = accountEmail;
    record[`${prefix}_OAUTH_CLIENT_ID`] = clientId;
    record[`${prefix}_OAUTH_CLIENT_SECRET`] = clientSecret;
  }

  const result = await setSecrets(did, record, {
    updatedBy: updatedBy || "oauth-google-callback",
  });

  /**
   * AND RECORD IT AS A CALENDAR ACCOUNT, so it can be one of several.
   *
   * The secrets bag above holds exactly ONE Google grant per person, under
   * fixed key names -- so connecting a second Google account overwrites the
   * first with no error, and somebody's work calendar silently replaces their
   * personal one. calendar_accounts (migration 046) is keyed on
   * (owner, provider, account_email), so the two coexist.
   *
   * BOTH ARE WRITTEN, not one instead of the other. Everything else that reads
   * Google -- contacts, Gmail, Drive -- reads the bag, and moving them is a
   * separate change with its own risk. The calendar is the surface that needs a
   * list, so the calendar gets the table.
   *
   * BEST EFFORT, and deliberately after the secrets write: a failure here must
   * not break a connection that otherwise worked.
   */
  if (accountEmail && familyGranted(grantedSet, GOOGLE_SCOPE_FAMILIES.gcal)) {
    try {
      const [{ resolveAmberIdByPrivyDid }, { connectCalendarAccount }] = await Promise.all([
        import("../../db/store.js"),
        import("../../db/calendar-accounts.js"),
      ]);
      const ownerId = await resolveAmberIdByPrivyDid(did);
      if (ownerId) {
        await connectCalendarAccount(ownerId, {
          provider: "google",
          accountEmail,
          refreshToken: tokens.refresh_token ?? null,
          accessToken: tokens.access_token ?? null,
          expiresAt,
          scopes: GOOGLE_SCOPE_FAMILIES.gcal.filter((x) => grantedSet.has(x)).join(" "),
        });
      }
    } catch (err) {
      console.warn(`[oauth-google] calendar account not recorded: ${err?.message || err}`);
    }
  }

  /*
   * THE CONSENT JUST GIVEN IS THE CONSENT, so record it where the company
   * graph looks for it.
   *
   * The org side moves nothing without a grant row, and the only thing that
   * ever wrote one was a manual sync. So somebody could connect Google,
   * approve mail on Google's own screen, and still have a graph that never
   * read a mailbox -- consent given to Google and never heard of here. The
   * grant is written from what Google actually returned: calendar if the
   * calendar scope came back, mail if the mail scope did, neither if
   * neither. It is a transcription of the checkbox they just ticked, not a
   * decision made on their behalf.
   */
  try {
    const { resolveAmberIdByPrivyDid } = await import("../../db/store.js");
    const ownerId = await resolveAmberIdByPrivyDid(did);
    if (ownerId) {
      const { grantSource } = await import("../../db/org-memory-store.js");
      const { query } = await import("../../db/sql.js");
      /*
       * THROUGH THE BOOTSTRAP FUNCTION, because org_members is under row-level
       * security and this code path has no tenant open.
       *
       * A plain SELECT here returned zero rows -- not an error, not a denial
       * anybody could see, just nothing -- so the grant loop ran over an empty
       * list and the mailbox consent was approved on Google's screen and then
       * dropped on the floor. The log line said orgs=0 and that was the whole
       * bug.
       *
       * amber_membership_bootstrap is SECURITY DEFINER and takes one amber_id:
       * it answers "which org is this person in" and cannot be asked anything
       * else. It is the same function resolveActor uses for the same reason.
       */
      const { rows } = await query(
        `SELECT org_id FROM amber_membership_bootstrap($1::uuid)`,
        [ownerId],
      );
      /*
       * EVERY STEP SAYS WHAT HAPPENED.
       *
       * This block failed silently three separate ways -- a symbol that was
       * not in scope, a policy that can refuse a source, a grant that can be
       * a no-op -- and each time the only evidence was a graph that had not
       * changed. Guessing from that costs an hour. The scopes Google actually
       * returned and the verdict on each grant are one line each, and they
       * turn the next failure into a sentence instead of a theory.
       */
      console.log(
        `[oauth-google] member=${ownerId} orgs=${rows.length} ` +
          `scopes=${[...grantedSet].join(",") || "none"}`,
      );

      const { withTenant } = await import("../../db/tenant.js");

      for (const { org_id: orgId } of rows) {
        const wanted = [
          ["calendar", familyGranted(grantedSet, GOOGLE_SCOPE_FAMILIES.gcal)],
          ["mail", familyGranted(grantedSet, GOOGLE_SCOPE_FAMILIES.gmail)],
        ];
        for (const [source, asked] of wanted) {
          if (!asked) {
            console.log(`[oauth-google] grant ${source}: google did not return that scope`);
            continue;
          }
          /*
           * INSIDE THE TENANT, because org_memory_sources and the policy row
           * the grant checks are both under the tenant policy. Outside one,
           * the insert is refused by RLS and reports nothing -- the same
           * silent nothing that org_members gave above.
           */
          const r = await withTenant(orgId, () =>
            grantSource({ orgId, amberId: ownerId, source }),
          ).catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));
          console.log(
            `[oauth-google] grant ${source}: ${r?.ok ? "ok" : `refused (${r?.reason})`}`,
          );
        }
      }
    }
  } catch (err) {
    console.warn(`[oauth-google] org grants not recorded: ${err?.message || err}`);
  }

  /*
   * AND READ IT NOW.
   *
   * The hourly pass is for keeping up; it is not an answer to "did my
   * connection work". Somebody who just approved a mailbox watches the screen
   * for thirty seconds, sees the same graph of email addresses, and concludes
   * it failed -- correctly, as far as they can tell. Fire-and-forget, exactly
   * like the contacts import above: the redirect must not wait on Gmail.
   */
  (async () => {
    try {
      const { resolveAmberIdByPrivyDid } = await import("../../db/store.js");
      const ownerId = await resolveAmberIdByPrivyDid(did);
      if (!ownerId) return;
      const { refreshMemberNow } = await import("../../jobs/graph-refresh-worker.js");
      await refreshMemberNow(ownerId);
    } catch (err) {
      console.warn(`[oauth-google] on-connect refresh failed: ${err?.message || err}`);
    }
  })();

  // Connecting Google triggers a contacts import (best-effort). Fire-and-forget
  // — do NOT await, so the OAuth callback redirect is never blocked or delayed;
  // wrap in try/catch so an import failure can never break the callback. Only
  // when a contacts scope was actually granted.
  if (familyGranted(grantedSet, GOOGLE_SCOPE_FAMILIES.gcontacts)) {
    (async () => {
      try {
        const { importGoogleContactsForOwner } = await import(
          "../../lib/google-contacts.js"
        );
        const counts = await importGoogleContactsForOwner(did);
        console.log(
          `[oauth-google] auto contacts import for ${did}: ${JSON.stringify(counts)}`,
        );
      } catch (err) {
        console.warn(
          `[oauth-google] best-effort contacts import failed: ${err?.message || err}`,
        );
      }
    })();
  }

  return result;
}

/**
 * Best-effort revoke at Google + clear local secrets. Google's revoke
 * endpoint accepts either an access or refresh token and revokes the
 * whole grant. We swallow Google-side errors so a stale token never
 * blocks the user from clearing local state.
 */
export async function revokeAndClear(did, { refreshToken } = {}) {
  if (refreshToken) {
    try {
      await fetch(GOOGLE_REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
    } catch {
      // Local clear still proceeds even if Google is unreachable.
    }
  }

  const cleared = {};
  for (const prefix of ["GCAL", "GMAIL", "GDRIVE", "GCONTACTS"]) {
    const k = familyKeys(prefix);
    cleared[k.refresh] = null;
    cleared[k.access] = null;
    cleared[k.expires] = null;
    cleared[k.scopes] = null;
    cleared[k.connectedAt] = null;
    cleared[`${prefix}_OAUTH_CLIENT_ID`] = null;
    cleared[`${prefix}_OAUTH_CLIENT_SECRET`] = null;
  }
  cleared.GOOGLE_OAUTH_ID_TOKEN = null;
  cleared.GOOGLE_OAUTH_TOKEN_TYPE = null;

  return setSecrets(did, cleared, { updatedBy: "oauth-google-revoke" });
}
