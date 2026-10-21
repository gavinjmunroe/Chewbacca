/**
 * The profile voice bio: one clip per person, audible to their connections.
 *
 * SCHEMA: db/migrations/20260908_033_profile_voice_bio.sql. This module creates
 * nothing.
 *
 * The upload is three legs and THE SERVER OWNS TWO OF THEM, exactly as
 * note-media does:
 *
 *   reserve   the server mints the storage key. A client never chooses where
 *             its own bytes land, or it can choose someone else's path.
 *   PUT       the client uploads straight to Cloud Storage. Bytes never pass
 *             through this service.
 *   finalize  the server HEADs the object and records the REAL size. A client
 *             never declares its own upload complete.
 *
 * The random suffix in the key matters: re-recording must land on a NEW object,
 * or a signed URL or CDN entry for the old clip can still serve the old bytes
 * under a path the client now believes holds the new ones.
 */

import crypto from "node:crypto";
import { query } from "./sql.js";
import { queryWithOptionalColumn } from "./optional-column.js";

// Matched to note-media's clip limits, because they are the same recorder.
export const MAX_BIO_DURATION_MS = 60 * 1000;
export const MAX_BIO_BYTES = 4 * 1024 * 1024;
export const BIO_CONTENT_TYPE = "audio/m4a";
export const MAX_BIO_PEAKS = 240;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/** Clamp a client-sent waveform to smallint range and a fixed sample count. */
export function normalizeBioPeaks(peaks) {
  if (!Array.isArray(peaks)) return [];
  return peaks
    .slice(0, MAX_BIO_PEAKS)
    .map((p) => {
      const n = Number(p);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(1000, Math.round(n)));
    });
}

/** Leg one. Mints and persists a key, and returns it. */
export async function reserveBioUpload(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  const storageKey = `voice-bios/${owner}/${crypto.randomUUID()}.m4a`;
  const { rows } = await query(
    `INSERT INTO profile_voice_bios (owner_id, storage_key, content_type, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (owner_id)
       DO UPDATE SET storage_key  = EXCLUDED.storage_key,
                     content_type = EXCLUDED.content_type,
                     status       = 'pending',
                     duration_ms  = 0,
                     byte_size    = 0,
                     peaks        = '{}',
                     updated_at   = now()
     RETURNING storage_key`,
    [owner, storageKey, BIO_CONTENT_TYPE],
  );
  return rows[0]?.storage_key ?? null;
}

/** The row, whatever state it is in, or null. */
export async function getBioRow(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  // `transcript` is additive (036) and the clip plays without it, so a pending
  // migration must cost the caption and nothing else -- see optional-column.js.
  const { rows } = await queryWithOptionalColumn(
    "profile_voice_bios.transcript",
    (has) => `SELECT owner_id, storage_key, content_type, duration_ms, byte_size,
            peaks, status, ${has ? "transcript" : "NULL::text AS transcript"},
            created_at, updated_at
       FROM profile_voice_bios
      WHERE owner_id = $1
      LIMIT 1`,
    [owner],
  );
  return rows[0] ?? null;
}

/**
 * Leg three. Only ever called with a size the server read off the bucket.
 *
 * THE TRANSCRIPT RIDES ALONG HERE, from the same on-device transcription the
 * recorder already produces for every voice note in the app -- so this stores
 * something we already had rather than adding a transcription pass. COALESCE
 * rather than an assignment: a re-finalize that carries no transcript (an older
 * client, or a clip whose transcription failed) must not blank the words off a
 * bio that already has them.
 */
export async function markBioReady(ownerId, { durationMs, byteSize, peaks, transcript }) {
  const owner = asUuid(ownerId);
  if (!owner) return false;
  const text =
    typeof transcript === "string" && transcript.trim()
      ? transcript.trim().slice(0, 4000)
      : null;
  // Without the column the clip still finalizes and still plays; only the words
  // are lost, and $5 stays in the list so the two variants share one param set.
  const { rowCount } = await queryWithOptionalColumn(
    "profile_voice_bios.transcript",
    (has) => `UPDATE profile_voice_bios
        SET status      = 'ready',
            duration_ms = $2,
            byte_size   = $3,
            peaks       = $4::smallint[],
            ${has ? "transcript  = COALESCE($5, transcript)," : ""}
            updated_at  = now()
      WHERE owner_id = $1
        -- $5 is the transcript. The variant that cannot store it still has to
        -- MENTION it, because both variants are run with one parameter list,
        -- and it is cast because an unreferenced parameter has no inferable
        -- type. The predicate is always true; it exists to type the parameter.
        AND ($5::text IS NULL OR true)`,
    [
      owner,
      Math.max(0, Math.min(MAX_BIO_DURATION_MS, Number(durationMs) || 0)),
      Math.max(0, Number(byteSize) || 0),
      normalizeBioPeaks(peaks),
      text,
    ],
  );
  return rowCount > 0;
}

/** Remove the row. The caller deletes the object first. */
export async function deleteBio(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return false;
  await query(`DELETE FROM profile_voice_bios WHERE owner_id = $1`, [owner]);
  return true;
}

/**
 * THE AUDIENCE RULE, and it is one row in `connections`.
 *
 * A voice bio is audible to the people you are connected to, and to nobody
 * else. That is not a share -- there is no share row to create, and none to
 * forget to revoke when a connection is removed, because this reads the live
 * connection every time.
 *
 * `connections` stores each pair ONCE with the smaller uuid as `a` (a CHECK
 * enforces it), so the lookup has to be order-free rather than assuming which
 * side either person is on. Getting that wrong would make the bio audible in
 * one direction and silent in the other, depending on how two uuids happened to
 * sort.
 *
 * Yourself always counts, so the owner can play back what they recorded.
 */
export async function canHearBio(viewerAmberId, ownerAmberId) {
  const viewer = asUuid(viewerAmberId);
  const owner = asUuid(ownerAmberId);
  if (!viewer || !owner) return false;
  if (viewer === owner) return true;
  const { rowCount } = await query(
    `SELECT 1 FROM connections
      WHERE status = 'active'
        AND ((a_amber_id = $1 AND b_amber_id = $2)
          OR (a_amber_id = $2 AND b_amber_id = $1))
      LIMIT 1`,
    [viewer, owner],
  );
  return rowCount > 0;
}
