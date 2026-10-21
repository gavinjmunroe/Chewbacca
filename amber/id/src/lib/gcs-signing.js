/**
 * Google Cloud Storage V4 signed URLs, with no SDK.
 *
 * WHY NOT @google-cloud/storage: it pulls ~40 transitive packages to do what is
 * below in ~120 lines of node:crypto, and this service's whole use of GCS is
 * "sign a PUT, sign a GET, sign a HEAD". Fewer dependencies on the path that
 * handles user audio is a security property, not just a size one.
 *
 * THE SECURITY MODEL. We never make a bucket or an object public. Every read is
 * a URL signed at request time, valid for minutes, and issued only AFTER the
 * caller's circle membership has been verified. The URL is the capability, its
 * lifetime is the blast radius, and nothing about the object name is guessable
 * (a v4 uuid per clip). Uploads are signed with the content type PINNED into the
 * signature, so a signed PUT for audio/m4a cannot be reused to plant an HTML
 * file in the bucket and get it served back from a googleapis.com origin.
 *
 * Configuration (Railway env; no key material ever appears in the repo):
 *   GCS_NOTE_AUDIO_BUCKET   the bucket name, e.g. amber-note-audio   [required]
 *
 * The signing identity is resolved in this order:
 *   1. GCS_SA_CLIENT_EMAIL + GCS_SA_PRIVATE_KEY, if you want a dedicated
 *      storage-only service account. Literal \n sequences in the PEM are
 *      unescaped, so it can be pasted as a single-line env var.
 *   2. GOOGLE_APPLICATION_CREDENTIALS_JSON — ALREADY set in Railway for Cloud
 *      SQL and Firestore. Reusing it means adding one env var instead of three,
 *      and one fewer private key to rotate. That account just needs
 *      objectAdmin on this one bucket.
 */

import crypto from "node:crypto";

const HOST = "storage.googleapis.com";
const ALGORITHM = "GOOG4-RSA-SHA256";
// GCS accepts the literal "auto" as the signing region for signed URLs, so the
// bucket can be moved or made multi-region without re-deploying a region string.
const LOCATION = "auto";

export function gcsConfig() {
  const bucket = (process.env.GCS_NOTE_AUDIO_BUCKET || "").trim();
  // Railway stores multi-line values fine, but pasting a PEM often lands with
  // escaped newlines. Accept both rather than failing with an opaque crypto error.
  let clientEmail = (process.env.GCS_SA_CLIENT_EMAIL || "").trim();
  let privateKey = (process.env.GCS_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();

  // Fall back to the service account this service already runs as. Deliberate:
  // every extra secret is another thing to rotate, leak or mis-paste, and the
  // Cloud SQL account is already trusted by this process.
  if (!clientEmail || !privateKey) {
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (raw) {
      try {
        const sa = JSON.parse(raw);
        if (!clientEmail) clientEmail = String(sa.client_email || "").trim();
        if (!privateKey) privateKey = String(sa.private_key || "").replace(/\\n/g, "\n").trim();
      } catch {
        // A malformed JSON blob must not take the process down at import time;
        // gcsConfigured() below reports it as unconfigured instead.
      }
    }
  }
  return { bucket, clientEmail, privateKey };
}

/** True when this deployment can sign URLs at all. */
export function gcsConfigured() {
  const { bucket, clientEmail, privateKey } = gcsConfig();
  return !!(bucket && clientEmail && privateKey.includes("PRIVATE KEY"));
}

/** RFC 3986 percent-encoding. encodeURIComponent leaves !'()* alone; GCS does not. */
function encodeRfc3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Object names keep their slashes but every segment is encoded. */
export function encodeObjectPath(objectName) {
  return String(objectName)
    .split("/")
    .map(encodeRfc3986)
    .join("/");
}

function stamps(now) {
  // YYYYMMDD'T'HHMMSS'Z' and YYYYMMDD, both UTC.
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { datetime: iso, date: iso.slice(0, 8) };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Sign one GCS request as a URL.
 *
 * @param {object}  opts
 * @param {string}  opts.objectName    the key inside the bucket
 * @param {'GET'|'PUT'|'HEAD'|'DELETE'} opts.method
 * @param {number}  opts.expiresSeconds max 604800 (7 days) per GCS; we use minutes
 * @param {string} [opts.contentType]  when set, content-type is a SIGNED header,
 *                                     so the client must send exactly this value
 * @param {Date}   [opts.now]          injectable for tests
 * @returns {string} the signed URL
 */
export function signGcsUrl({
  objectName,
  method = "GET",
  expiresSeconds = 300,
  contentType = null,
  now = new Date(),
}) {
  const { bucket, clientEmail, privateKey } = gcsConfig();
  if (!bucket || !clientEmail || !privateKey) {
    throw new Error("gcs_not_configured");
  }
  if (!objectName || typeof objectName !== "string") {
    throw new Error("gcs_object_required");
  }
  const expires = Math.min(Math.max(Math.floor(expiresSeconds) || 0, 1), 604800);
  const { datetime, date } = stamps(now);
  const credentialScope = `${date}/${LOCATION}/storage/goog4_request`;

  // Signed headers must be lowercase, sorted, and appear in the canonical
  // headers block in the same order.
  const headers = { host: HOST };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const queryParams = {
    "X-Goog-Algorithm": ALGORITHM,
    "X-Goog-Credential": `${clientEmail}/${credentialScope}`,
    "X-Goog-Date": datetime,
    "X-Goog-Expires": String(expires),
    "X-Goog-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k])}`)
    .join("&");

  const canonicalResource = `/${bucket}/${encodeObjectPath(objectName)}`;
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalResource,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [ALGORITHM, datetime, credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(stringToSign)
    .sign(privateKey, "hex");

  return `https://${HOST}${canonicalResource}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

/**
 * What is actually in the bucket at this key?
 *
 * Called on finalize so the server never takes the client's word for the size or
 * type of what it uploaded. Uses a signed HEAD rather than the JSON API, which
 * keeps this file free of OAuth token minting entirely.
 *
 * @returns {Promise<{exists: boolean, size: number, contentType: string|null}>}
 */
export async function statGcsObject(objectName, { fetchImpl = fetch } = {}) {
  const url = signGcsUrl({ objectName, method: "HEAD", expiresSeconds: 60 });
  const res = await fetchImpl(url, { method: "HEAD" });
  if (res.status === 404 || res.status === 403) {
    return { exists: false, size: 0, contentType: null };
  }
  if (!res.ok) throw new Error(`gcs_head_failed_${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  return {
    exists: true,
    size: Number.isFinite(len) ? len : 0,
    contentType: res.headers.get("content-type"),
  };
}

/** Best-effort delete. Used to clean up an upload that failed verification. */
export async function deleteGcsObject(objectName, { fetchImpl = fetch } = {}) {
  try {
    const url = signGcsUrl({ objectName, method: "DELETE", expiresSeconds: 60 });
    const res = await fetchImpl(url, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
