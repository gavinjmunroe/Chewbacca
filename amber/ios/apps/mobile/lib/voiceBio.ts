import { callMedhaId, type MedhaIdResult } from './medhaId';
import { transcribeVoice } from './voiceTranscribe';

// THE PROFILE VOICE BIO — your profile in your own voice, audible to the people
// you are connected to.
//
// The upload is the same three legs as a note's audio (lib/noteMedia.ts), for
// the same reason: the bytes must not travel through medha-id, and the server
// must not take the client's word for where they landed or how big they are.
// The two are deliberately NOT merged -- a bio is not a note, its audience is a
// live connection rather than a share, and there is exactly one per person -- so
// they share the shape rather than the code.

export type VoiceBio = {
  /** Short-lived signed URL. DO NOT CACHE IT; re-fetch when you need to play. */
  url: string;
  expiresIn: number;
  durationMs: number;
  /** The OWNER's waveform, so every listener sees the same shape. */
  peaks: number[];
  /**
   * WHAT IT SAYS, shown under the mic.
   *
   * "A nice mic icon that transcribes what it says underneath." Without it a
   * profile offered a waveform and no way to tell whether it was worth forty
   * seconds of listening -- and a bio nobody plays is a bio nobody has. Null on
   * a clip recorded before this existed, or one whose transcription failed:
   * absent is not the same statement as empty.
   */
  transcript: string | null;
  updatedAt: string | null;
};

type UploadTicket = {
  uploadUrl: string;
  contentType: string;
  expiresIn: number;
  maxBytes: number;
  maxDurationMs: number;
};

/** Your own bio, or null when you have not recorded one. */
export async function getMyVoiceBio(): Promise<VoiceBio | null> {
  const res = await callMedhaId<{ bio: VoiceBio | null }>({
    path: '/v1/me/voice-bio',
    method: 'GET',
    requireAuth: true,
    tag: 'GET my voice bio',
  });
  return res.ok ? (res.data?.bio ?? null) : null;
}

/**
 * Somebody else's, if you are connected to them.
 *
 * A 404 is the answer for "not connected", "has not recorded one" and "that is
 * not a real id" alike -- the server makes them byte-identical on purpose -- so
 * there is nothing to branch on here beyond null.
 */
export async function getVoiceBioFor(amberId: string): Promise<VoiceBio | null> {
  const res = await callMedhaId<{ bio: VoiceBio | null }>({
    path: `/v1/profiles/${encodeURIComponent(amberId)}/voice-bio`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET voice bio',
  });
  return res.ok ? (res.data?.bio ?? null) : null;
}

/**
 * Record over your bio. Three legs, and it returns true only if all three
 * succeeded — a failure anywhere leaves the row 'pending', which is never
 * served, rather than leaving a half-uploaded clip on your profile.
 */
export async function uploadVoiceBio(
  fileUri: string,
  { durationMs, peaks }: { durationMs: number; peaks: number[] },
): Promise<boolean> {
  const ticket = await callMedhaId<UploadTicket>({
    path: '/v1/me/voice-bio/upload-url',
    method: 'POST',
    requireAuth: true,
    tag: 'POST voice bio upload-url',
  });
  if (!ticket.ok) return false;

  let body: Blob;
  try {
    const res = await fetch(fileUri);
    const raw = await res.blob();
    // Re-type the blob rather than only setting the header. React Native sends a
    // Blob's own `type` as Content-Type, which would override the header — and
    // the server pins content-type INTO the signature, so a mismatch is a 403
    // rather than a silent wrong-type upload.
    body = raw.slice(0, raw.size, ticket.data.contentType);
  } catch {
    return false;
  }
  if (body.size > ticket.data.maxBytes) return false;

  try {
    const put = await fetch(ticket.data.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': ticket.data.contentType },
      body,
    });
    if (!put.ok) return false;
  } catch {
    return false;
  }

  // ── AND WHAT IT SAYS ────────────────────────────────────────────────────
  //
  // Transcribed from the SAME blob that was just uploaded, so this costs one
  // extra request and no second read of the file. Done here rather than in the
  // recorder because every caller of this function wants it, and a bio recorded
  // from a future surface would otherwise arrive silent.
  //
  // BEST-EFFORT, AND DELIBERATELY AFTER THE PUT. A transcription that fails
  // must not cost the user their recording: the clip is already in the bucket
  // and the finalize below is what makes it playable, with or without words.
  let transcript: string | null = null;
  try {
    const base64 = await blobToBase64(body);
    if (base64) {
      const res = await transcribeVoice(base64, ticket.data.contentType);
      const text = res.ok ? (res.data?.transcript ?? '').trim() : '';
      if (text) transcript = text.slice(0, 4000);
    }
  } catch {
    // No words. The bio still plays.
  }

  const done = await callMedhaId<{ ok: boolean; byteSize: number }>({
    path: '/v1/me/voice-bio',
    method: 'POST',
    requireAuth: true,
    body: {
      durationMs: Math.max(0, Math.min(ticket.data.maxDurationMs, Math.round(durationMs))),
      peaks,
      ...(transcript ? { transcript } : {}),
    },
    tag: 'POST voice bio finalize',
  });
  return done.ok;
}

/**
 * The uploaded blob as base64, for the transcription request.
 *
 * FileReader rather than a second fetch of the file URI: the bytes are already
 * in memory here, and reading the file twice on a phone is the kind of thing
 * that only shows up as a hitch on a long clip.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onloadend = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

export function deleteVoiceBio(): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: '/v1/me/voice-bio',
    method: 'DELETE',
    requireAuth: true,
    tag: 'DELETE voice bio',
  });
}
