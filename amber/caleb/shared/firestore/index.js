/**
 * GCP Firestore adapter — the trust-worthy home for Amber operational data.
 *
 * Lives at repo root (/shared/firestore/) because it's infrastructure, not
 * a Newton feature. Any service in this monorepo can import it:
 *
 *   import { firestoreUpsert, logInteractionToFirestore } from "@amber/firestore";
 *
 * Collections (first pass, evolve as needed):
 *   interactions/{tenant_did}/events   one doc per in/out message pair
 *   contacts/{tenant_did}/{handle}     per-contact profile
 *   sessions/{tenant_did}/{handle}     per-user session state
 *   health_checkins/{tenant_did}/...   daily scores
 *   memories/{tenant_did}/...          facts (semantic memory is in Pinecone,
 *                                       but raw writes also land here for audit)
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS_JSON carries the service account key
 * as a JSON string. We write it to a temp file on first use so the library's
 * default credential chain picks it up.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let firestore = null;
let ready = false;

function loadCredentials() {
  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) return null;
  if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  ) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  const tmp = path.join(os.tmpdir(), "amber-gcp.json");
  fs.writeFileSync(tmp, json, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
  return tmp;
}

async function getClient() {
  if (ready) return firestore;
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) return null;
  const credPath = loadCredentials();
  if (!credPath) return null;
  try {
    const mod = await import("@google-cloud/firestore");
    const Firestore = mod.Firestore;
    firestore = new Firestore({ projectId });
    ready = true;
    return firestore;
  } catch (err) {
    console.warn("[firestore] init failed:", err.message);
    return null;
  }
}

/**
 * Append one interaction log row. Best-effort: failures are logged, never
 * thrown — GCP outages must never block user-facing replies.
 */
export async function logInteractionToFirestore({
  tenantDid,
  fromHandle,
  messageIn,
  messageOut,
  model,
  extra,
} = {}) {
  if (!tenantDid) return;
  try {
    const db = await getClient();
    if (!db) return;
    const now = new Date();
    const doc = {
      tenant_did: tenantDid,
      from_handle: fromHandle || null,
      message_in: messageIn || null,
      message_out: messageOut || null,
      model: model || null,
      created_at: now,
      created_ts: now.getTime(),
      ...(extra || {}),
    };
    await db
      .collection("interactions")
      .doc(tenantDid)
      .collection("events")
      .add(doc);
  } catch (err) {
    console.warn("[firestore] logInteraction failed:", err.message);
  }
}

/** Upsert (merge) a doc at an explicit path. */
export async function firestoreUpsert(docPath, data) {
  try {
    const db = await getClient();
    if (!db) return;
    await db
      .doc(docPath)
      .set({ ...data, updated_at: new Date() }, { merge: true });
  } catch (err) {
    console.warn(`[firestore] upsert ${docPath} failed:`, err.message);
  }
}

/** Get a doc by path. Returns null on miss or error. */
export async function firestoreGet(docPath) {
  try {
    const db = await getClient();
    if (!db) return null;
    const snap = await db.doc(docPath).get();
    return snap.exists ? snap.data() : null;
  } catch (err) {
    console.warn(`[firestore] get ${docPath} failed:`, err.message);
    return null;
  }
}

/** Simple readiness probe. */
export async function firestoreReady() {
  const db = await getClient();
  return !!db;
}
