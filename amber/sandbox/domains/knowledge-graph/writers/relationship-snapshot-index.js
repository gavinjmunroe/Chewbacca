/**
 * Relationship-snapshot vector retrieval (Tab 32).
 *
 * jobs/relationship-snapshot.js writes one `relationship_snapshot` vector per
 * (contact, ISO week) into the tenant's DID-keyed Pinecone namespace (the same
 * namespace pinecone-client.js serves and the Tab 19 consolidator uses). This
 * module is the READ side: typed helpers the trajectory route + agent tool call
 * to answer "is my relationship with X warming or cooling", "who am I drifting
 * from", and "show my trajectory with X".
 *
 * Snapshots are selected by metadata filter, not semantic similarity, so we
 * embed one stable probe string and let topK + filter do the selection, then
 * sort/derive in pure code (src/lib/relationship-score.js).
 *
 * Every function degrades gracefully: if the vector path is unavailable or an
 * upstream errors, it returns [] rather than throwing, matching the other
 * *-index.js modules so the caller keeps serving traffic.
 */

import { query as pineconeQuery, fetchRecords } from "../service/lib/pinecone.js";
import { embed } from "../service/lib/embed.js";
import {
  RELATIONSHIP_SNAPSHOT_KIND,
  snapshotId,
  contactIdFromName,
  latestPerContact,
  rankByDelta,
} from "../service/lib/relationship-score.js";

const PROBE_TEXT =
  "relationship snapshot trajectory warming cooling talk frequency sentiment";

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

// Cache the probe embedding for the life of the process so repeated reads don't
// re-hit Perplexity. The vector is content-free; only the filter matters.
let _probePromise = null;
async function probeVector() {
  if (!_probePromise) _probePromise = embed(PROBE_TEXT);
  return _probePromise;
}

/**
 * Flatten a Pinecone match into the snapshot row shape the score helpers and
 * callers expect. Numbers stay numbers (the upsert layer preserves them).
 */
function toRow(match) {
  const md = match?.metadata || {};
  return {
    id: match?.id,
    contact_id: md.contact_id,
    contact_name: md.contact_name || "",
    week_key: md.week_key,
    week_start:
      typeof md.week_start === "number"
        ? md.week_start
        : Number(md.week_start) || 0,
    talk_frequency: Number(md.talk_frequency) || 0,
    sentiment_score: Number(md.sentiment_score) || 0,
    touchpoint_diversity: Number(md.touchpoint_diversity) || 0,
    composite_score: Number(md.composite_score) || 0,
    previous_score: Number(md.previous_score) || 0,
    score_delta: Number(md.score_delta) || 0,
    text: md.text || "",
  };
}

async function querySnapshots(privyDid, filter, topK = 1000) {
  if (!privyDid || !vectorizationAvailable()) return [];
  let vector;
  try {
    vector = await probeVector();
  } catch {
    return [];
  }
  try {
    const matches = await pineconeQuery(privyDid, vector, { topK, filter });
    return (Array.isArray(matches) ? matches : []).map(toRow);
  } catch {
    return [];
  }
}

/**
 * Full week-by-week trajectory for one contact, oldest -> newest, capped to the
 * most recent `weeks` snapshots.
 */
export async function findContactTrajectory(
  privyDid,
  { contactId, weeks = 12 } = {},
) {
  if (!contactId) return [];
  const rows = await querySnapshots(
    privyDid,
    { kind: RELATIONSHIP_SNAPSHOT_KIND, contact_id: contactId },
    Math.max(weeks * 2, 60),
  );
  rows.sort((a, b) => (a.week_start || 0) - (b.week_start || 0));
  return rows.slice(-weeks);
}

/**
 * The snapshot for a contact at a specific ISO week key, or null.
 */
export async function findContactSnapshotAtWeek(privyDid, contactId, weekKey) {
  if (!privyDid || !contactId || !weekKey || !vectorizationAvailable())
    return null;
  const id = snapshotId(contactId, weekKey);
  try {
    const recs = await fetchRecords(privyDid, [id]);
    const hit = recs.find((r) => r.id === id);
    return hit ? toRow({ id: hit.id, metadata: hit.metadata }) : null;
  } catch {
    return null;
  }
}

/**
 * Contacts trending up over the trailing window, ranked by latest score_delta.
 */
export async function findWarmingRelationships(
  privyDid,
  { windowDays = 30, limit = 10, now = new Date() } = {},
) {
  return rankWindow(privyDid, { windowDays, limit, direction: "warming", now });
}

/**
 * Contacts trending down / drifting over the window, ranked by latest score_delta.
 */
export async function findCoolingRelationships(
  privyDid,
  { windowDays = 30, limit = 10, now = new Date() } = {},
) {
  return rankWindow(privyDid, { windowDays, limit, direction: "cooling", now });
}

async function rankWindow(privyDid, { windowDays, limit, direction, now }) {
  const sinceMs = now.getTime() - windowDays * 86400000;
  const rows = await querySnapshots(
    privyDid,
    { kind: RELATIONSHIP_SNAPSHOT_KIND, week_start: { $gte: sinceMs } },
    1000,
  );
  return rankByDelta(latestPerContact(rows), { direction, limit });
}

/**
 * Resolve a caller-supplied contact reference to the contact_id the job wrote.
 * An explicit contact_id wins. Otherwise we scan existing snapshots for a
 * contact_name match (case-insensitive, exact then substring) so person_id-keyed
 * contacts resolve too, and fall back to the deterministic name slug when no
 * snapshot exists yet. Returns null when nothing usable was supplied.
 */
export async function resolveContactId(
  privyDid,
  { contactId, contactName } = {},
) {
  if (contactId) return contactId;
  if (!contactName) return null;
  const needle = String(contactName).toLowerCase().trim();
  const rows = await querySnapshots(
    privyDid,
    { kind: RELATIONSHIP_SNAPSHOT_KIND },
    1000,
  );
  const exact = rows.find(
    (r) => (r.contact_name || "").toLowerCase() === needle,
  );
  if (exact) return exact.contact_id;
  const partial = rows.find((r) =>
    (r.contact_name || "").toLowerCase().includes(needle),
  );
  if (partial) return partial.contact_id;
  return contactIdFromName(contactName);
}
