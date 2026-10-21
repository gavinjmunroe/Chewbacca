/**
 * raw-archive.js — archive every Loop webhook payload to GCS for
 * forensic replay + audit, mirroring Togari's `togari-pdw` GCS bucket
 * pattern (see /Users/joelnewton/togari-platform/src/pdw/ingest-orchestrator).
 *
 * Why we want this:
 *   - BigQuery has the parsed/normalized rows. GCS has the raw bytes.
 *     If we ever discover a parser bug six weeks later, we can re-process
 *     historical webhooks from the bucket instead of waiting for them to
 *     happen again.
 *   - /debug/recent-webhooks is a ring buffer (last ~20). GCS is forever
 *     (with lifecycle rules, see below).
 *   - Loop has no "resend me the last hour of webhooks" API. We are the
 *     source of truth for raw inbound history.
 *
 * Layout:
 *   gs://medha-pdw-raw/<tenant>/<event>/<YYYY>/<MM>/<DD>/<id>.json
 *
 * `tenant` defaults to MEDHA_TENANT (env, "medha"). `event` is the
 * webhook event type ("message_inbound" / "message_delivered" / etc).
 * `id` is the Loop webhook_id when present, else "<timestamp>-<random>".
 *
 * Auth picks up the same GOOGLE_APPLICATION_CREDENTIALS_JSON env var
 * the BQ client uses — single SA covers both surfaces.
 *
 * Fire-and-forget: every error is warned + swallowed. The reply path
 * MUST NOT block on archival. If the bucket doesn't exist yet, calls
 * silently no-op (so this lands safely before bucket creation).
 *
 * Setup commands (run once from your shell with BMA gcloud auth):
 *   gcloud storage buckets create gs://medha-pdw-raw \
 *     --project=midyear-glazing-485303-u3 \
 *     --location=us-central1 \
 *     --uniform-bucket-level-access
 *
 *   gcloud storage buckets add-iam-policy-binding gs://medha-pdw-raw \
 *     --member="serviceAccount:medha-agent@midyear-glazing-485303-u3.iam.gserviceaccount.com" \
 *     --role="roles/storage.objectAdmin"
 *
 *   gcloud storage buckets update gs://medha-pdw-raw \
 *     --lifecycle-file=infra/medha-pdw-raw-lifecycle.json
 *
 * Once the bucket exists, no env vars need to change — archiver picks
 * it up automatically and starts writing on the next inbound.
 */

import { randomBytes } from "node:crypto";

const PROJECT = process.env.GCP_PROJECT_ID || null;
const BUCKET = process.env.MEDHA_RAW_BUCKET || "medha-pdw-raw";
const TENANT = process.env.MEDHA_TENANT || "medha";

let storageClient = null;
let bucketRef = null;

async function getBucket() {
  if (bucketRef) return bucketRef;
  if (!PROJECT) return null;
  try {
    // ESM dynamic import — keeps @google-cloud/storage out of the
    // boot path so a missing install only bites if archival is
    // actually called (it isn't in dev).
    const { Storage } = await import("@google-cloud/storage");
    const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (credsJson) {
      const credentials = JSON.parse(credsJson);
      storageClient = new Storage({ projectId: PROJECT, credentials });
    } else {
      storageClient = new Storage({ projectId: PROJECT });
    }
    bucketRef = storageClient.bucket(BUCKET);
    return bucketRef;
  } catch (err) {
    console.warn(`[raw-archive] init failed: ${err.message}`);
    return null;
  }
}

export function isArchiveReady() {
  return !!(
    PROJECT &&
    (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS)
  );
}

/**
 * Archive one webhook payload to GCS. Fire-and-forget — caller never
 * awaits, errors warn and don't propagate.
 *
 * Returns the gcs:// URI on success, null on skip/failure.
 */
export async function archiveRawWebhook(payload, { tenant = TENANT } = {}) {
  if (!isArchiveReady()) return null;
  if (!payload || typeof payload !== "object") return null;
  const bucket = await getBucket();
  if (!bucket) return null;

  try {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const event = sanitizeSegment(payload.event || "unknown");
    const id =
      sanitizeSegment(payload.webhook_id || payload.message_id) ||
      `${now.getTime()}-${randomBytes(4).toString("hex")}`;
    const objectName = `${sanitizeSegment(tenant)}/${event}/${yyyy}/${mm}/${dd}/${id}.json`;

    const file = bucket.file(objectName);
    // resumable: false → single small POST (these payloads are < 100KB).
    // metadata.contentType keeps gsutil cat / browser preview happy.
    await file.save(JSON.stringify(payload), {
      resumable: false,
      contentType: "application/json",
      metadata: {
        contentType: "application/json",
        cacheControl: "private, max-age=0",
        metadata: {
          tenant,
          event,
          archived_at: now.toISOString(),
        },
      },
    });
    return `gs://${BUCKET}/${objectName}`;
  } catch (err) {
    // 404 NoSuchBucket on first deploy before Caleb creates the bucket
    // is the expected case — silently no-op. Everything else warns.
    const msg = err?.message || String(err);
    if (/NoSuchBucket|No such bucket|Not Found/i.test(msg)) {
      // Don't spam: warn once per process about the missing bucket.
      if (!warnedAboutMissingBucket) {
        console.warn(
          `[raw-archive] bucket gs://${BUCKET} does not exist yet — see lib/pdw/raw-archive.js header for the setup commands`,
        );
        warnedAboutMissingBucket = true;
      }
      return null;
    }
    console.warn(`[raw-archive] write failed: ${msg.slice(0, 200)}`);
    return null;
  }
}

let warnedAboutMissingBucket = false;

// Disallow path traversal in user-controlled segments. Loop sometimes
// puts colons / slashes in event names; collapse them to underscores
// so the object key stays clean.
function sanitizeSegment(s) {
  if (!s || typeof s !== "string") return "";
  return s.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
}
