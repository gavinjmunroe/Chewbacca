/**
 * MAKE GOOGLE CLOUD CREDENTIALS AVAILABLE TO THIS PROCESS.
 *
 * Railway stores the service account as JSON TEXT in
 * GOOGLE_APPLICATION_CREDENTIALS_JSON. Every Google library reads
 * GOOGLE_APPLICATION_CREDENTIALS, which is a FILE PATH. Something has to write
 * one to the other, once, before anything opens a connection.
 *
 * HOW THIS WENT WRONG, because the shape of the bug is the reason this file
 * exists at all. That conversion used to live inside src/db/firestore.js as
 * loadCredentials(), and index.js called firestoreReady() at boot. So writing
 * the credentials file was a SIDE EFFECT of initialising Firestore -- and the
 * thing that actually depended on it was the Cloud SQL connector, which has
 * nothing to do with Firestore. Deleting Firestore therefore took Cloud SQL
 * authentication with it, in a commit that touched neither.
 *
 * The production symptom was total and silent:
 *
 *     [TenantIndex] Cloud SQL refresh failed: Could not load the default credentials
 *     MetadataLookupWarning: received unexpected error = All promises were rejected
 *
 * The connector, with no credentials path, falls back to the GCE metadata
 * server. On Railway there isn't one. Every request that needs to resolve a
 * tenant then 401s, and the app renders as though the account were empty --
 * "Your name", zero connections, "Couldn't load your network" -- which reads
 * like lost data rather than a failed login.
 *
 * WHY IT SURVIVED EVERY CHECK I RAN. Each script under scripts/ carries its own
 * private copy of this shim, so every diagnostic connected fine and reported
 * healthy data. And a local boot has no GOOGLE_APPLICATION_CREDENTIALS_JSON at
 * all, so it says "Cloud SQL not configured" -- which looks like normal local
 * behavior and is, in production, the entire outage.
 *
 * So: ONE implementation, called from db/sql.js before the Connector is
 * constructed, which covers the server, the workers and every script; and
 * called again explicitly at boot so a misconfigured deploy says so on the first
 * line of its logs instead of on every subsequent request.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let _resolved = null;

/**
 * Idempotent. Returns { ok, path, source } or { ok: false, reason }.
 *
 * An EXISTING GOOGLE_APPLICATION_CREDENTIALS file always wins -- a deployment
 * that mounts a real key file must not have it replaced by an env var, and a
 * developer with `gcloud auth application-default login` keeps working.
 */
export function ensureGcpCredentials() {
  if (_resolved) return _resolved;

  const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (existing && fs.existsSync(existing)) {
    _resolved = { ok: true, path: existing, source: "GOOGLE_APPLICATION_CREDENTIALS" };
    return _resolved;
  }

  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) {
    // NOT cached: a process that starts before the variable is available should
    // be able to succeed on a later attempt rather than being poisoned by the
    // first one.
    return {
      ok: false,
      reason:
        "neither GOOGLE_APPLICATION_CREDENTIALS (existing file) nor " +
        "GOOGLE_APPLICATION_CREDENTIALS_JSON is set",
    };
  }

  // Fail on malformed JSON HERE, with a clear message, rather than letting a
  // Google library report "could not load the default credentials" ten frames
  // away from the actual problem.
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || !parsed.client_email) {
      return {
        ok: false,
        reason: "GOOGLE_APPLICATION_CREDENTIALS_JSON parsed but has no client_email",
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON: ${err.message}`,
    };
  }

  try {
    const tmp = path.join(os.tmpdir(), "amber-id-gcp.json");
    fs.writeFileSync(tmp, json, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
    _resolved = { ok: true, path: tmp, source: "GOOGLE_APPLICATION_CREDENTIALS_JSON" };
    return _resolved;
  } catch (err) {
    return { ok: false, reason: `could not write the credentials file: ${err.message}` };
  }
}

/**
 * Boot-time check. Logs one line either way and returns the result.
 *
 * LOUD WHEN IT MATTERS: if AMBER_SQL_* is configured, this process intends to
 * reach Cloud SQL, and missing credentials mean every authenticated request
 * will fail. That is an error, not a warning. With no Cloud SQL configured at
 * all it is ordinary local development and says so quietly.
 */
export function reportGcpCredentials(log = console) {
  const res = ensureGcpCredentials();
  const wantsCloudSql = Boolean(
    process.env.AMBER_SQL_CONNECTION_NAME || process.env.AMBER_SQL_DB,
  );
  if (res.ok) {
    log.log?.(`[gcp] credentials ready via ${res.source}`);
    return res;
  }
  const msg =
    `[gcp] NO CREDENTIALS: ${res.reason}. ` +
    `The Cloud SQL connector will fall back to the GCE metadata server, which ` +
    `does not exist outside GCP, and EVERY authenticated request will 401.`;
  if (wantsCloudSql) log.error?.(msg);
  else log.warn?.(`[gcp] no credentials (${res.reason}) — no Cloud SQL configured either, so this is expected locally`);
  return res;
}
