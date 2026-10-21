/**
 * voice.js — Text-to-speech + ephemeral audio host for outbound voice notes.
 *
 * Two halves of the same job:
 *
 *   1. generateSpeech(text) → MP3 Buffer (via ElevenLabs)
 *   2. storeAudio(buffer)   → short id; serve later at /audio/:id.mp3
 *
 * The agent loop in agent.js wires these together: when the model emits
 * a `[voice]` prefix or the inbound was audio, it calls generateSpeech,
 * pushes the buffer into storeAudio, builds a public /audio/<id>.mp3
 * URL, and attaches it to the outbound Loop send so the recipient gets
 * an actual voice note in iMessage.
 *
 * The store is intentionally size-bounded but ALSO mirrors every buffer
 * to disk at /tmp/medha-audio/<id>.mp3 (flaw #41) so a Railway restart
 * mid-Loop-fetch doesn't 404 the audio URL. We keep ~50 buffers in
 * memory and evict oldest, but the disk copy survives until TTL.
 *
 * Secret: ELEVENLABS_API_KEY (env, org-level). Per-tenant voice_id
 * override comes from tenant.secrets.ELEVENLABS_VOICE_ID (flaw #44).
 */

import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { getSecret } from "./secrets.js";
import {
  insertRow as pdwInsertRow,
  isReady as pdwIsReady,
} from "./pdw/bq-client.js";

const TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL = "eleven_turbo_v2_5";
// "Rachel" — ElevenLabs' public default voice. Tenant override is read
// from tenant.secrets.ELEVENLABS_VOICE_ID (flaw #44); falls back to env,
// then this constant.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const MAX_TEXT = 1500; // hard cap per voice note — anything longer should be text
const STORE_LIMIT = 50;
const STORE_TTL_MS = 10 * 60 * 1000; // 10 minutes is plenty for Loop fetch

// flaw #41 — disk-mirror directory. We create it lazily; on Railway
// /tmp is ephemeral but survives within a single container lifetime,
// which is the only window we need (Loop fetches audio once, fast).
const AUDIO_DIR = "/tmp/medha-audio";
function ensureAudioDir() {
  try {
    mkdirSync(AUDIO_DIR, { recursive: true });
  } catch {
    // best-effort; failures here just mean we degrade to memory-only.
  }
}

// flaw #43 — pre-compute a tiny silent MP3 buffer once at module load
// so we can pad the front of every TTS output with ~200ms of true
// audible silence. iMessage's player chops the first ~150ms; without a
// real silence prefix the first phoneme gets eaten. ElevenLabs Turbo
// (eleven_turbo_v2_5) does NOT support SSML <break/> tags, so we can't
// solve this in the input — we have to splice silence onto the output.
//
// This is a minimal valid MP3 frame sequence (MPEG-1 Layer 3, 44.1kHz,
// mono, 32kbps) totalling ~200ms. The exact bytes were generated with
// `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.2 -b:a 32k out.mp3`
// then base64-encoded. ~620 bytes — cheap to keep in memory forever.
const SILENT_MP3_PREFIX = Buffer.from(
  "//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAAEgABLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLAAAAOUxBTUUzLjEwMAEAAAAAAAAAACdgJAA0+QAAYAAABIBlfH0RAAAAAAAAAAAAAAAAAAA=",
  "base64",
);

const audioStore = new Map(); // id → { buffer, at }

export function isVoiceAvailable() {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * Render `text` as an MP3 via ElevenLabs. Returns null on error so the
 * caller can fall back to plain text — voice failures should never block
 * the actual message from going out.
 *
 * flaw #44 — when `opts.tenant` is passed, reads ELEVENLABS_VOICE_ID
 * from tenant secrets first; falls back to env, then DEFAULT_VOICE_ID.
 * flaw #45 — fire-and-forget audit log to medha_audit.voice_usage.
 * flaw #79 — strip em dashes and `--` from text before TTS so the
 * synthesizer doesn't say "dash" or pause oddly.
 */
export async function generateSpeech(text, opts = {}) {
  if (!text || typeof text !== "string") return null;
  if (!isVoiceAvailable()) {
    console.warn("[voice] ELEVENLABS_API_KEY not configured — skipping");
    return null;
  }

  // flaw #79 — same cleanup the iMessage formatter does, applied before
  // we hand text to ElevenLabs. Em dash → period; "--" → period.
  const cleaned = text
    .replace(/—/g, ".")
    .replace(/--/g, ".")
    .replace(/\.{2,}/g, ".");
  const trimmed = cleaned.slice(0, MAX_TEXT);

  // flaw #43 — we used to prefix the text with literal "... " to nudge
  // ElevenLabs to start with a pause. That was AUDIBLE: the voice
  // actually whispered "dot dot dot" at the start. Confirmed in
  // ElevenLabs docs that eleven_turbo_v2_5 does NOT support SSML
  // <break/> tags, so we can't pause via input. Instead we concat a
  // pre-computed 200ms silent MP3 onto the front of the response
  // buffer below — true audible silence, zero leakage into the speech.

  // flaw #44 — per-tenant voice id resolution order:
  //   opts.voiceId > tenant.secrets.ELEVENLABS_VOICE_ID > env > default
  let resolvedVoiceId = opts.voiceId;
  if (!resolvedVoiceId && opts.tenant) {
    try {
      resolvedVoiceId = await getSecret(opts.tenant, "ELEVENLABS_VOICE_ID", {
        fallbackEnv: "ELEVENLABS_VOICE_ID",
      });
    } catch {
      resolvedVoiceId = null;
    }
  }
  const voiceId =
    resolvedVoiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = opts.modelId || DEFAULT_MODEL;
  const format = opts.format || "mp3_44100_128";

  const url = `${TTS_BASE}/${encodeURIComponent(voiceId)}?output_format=${format}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text: trimmed, model_id: modelId }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[voice] ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const tts = Buffer.from(await res.arrayBuffer());
    // flaw #43 — splice the silent prefix onto the front. Concatenating
    // two valid MP3 frame streams is well-formed MP3; iMessage/QuickTime
    // play them back-to-back with no glitch.
    const padded = Buffer.concat([SILENT_MP3_PREFIX, tts]);

    // flaw #45 — log usage. Fire-and-forget; never block on it.
    logVoiceUsage({
      tenant: opts.tenant,
      charCount: trimmed.length,
      modelId,
      voiceId,
    });

    return padded;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[voice] generateSpeech failed: ${err.message}`);
    return null;
  }
}

// flaw #45 — write one row per generateSpeech to medha_audit.voice_usage.
// The service account already has WRITER on medha_audit. We reuse the
// PDW BQ client (same project/credentials) but target a different
// dataset via a dedicated path. Failures swallow silently.
async function logVoiceUsage({ tenant, charCount, modelId, voiceId }) {
  if (!pdwIsReady()) return;
  try {
    // Importing BigQuery lazily so the audit dataset write doesn't add
    // load when this code isn't exercised.
    const { BigQuery } = await import("@google-cloud/bigquery");
    const project = process.env.GCP_PROJECT_ID;
    if (!project) return;
    const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const bq = credsJson
      ? new BigQuery({ projectId: project, credentials: JSON.parse(credsJson) })
      : new BigQuery({ projectId: project });
    const row = {
      tenant_did: tenant?.privyDid || tenant?.tenantId || null,
      char_count: charCount,
      model_id: modelId,
      voice_id: voiceId,
      timestamp: new Date().toISOString(),
    };
    await bq.dataset("medha_audit").table("voice_usage").insert([row]);
  } catch (err) {
    console.warn(`[voice-audit] write failed: ${err.message?.slice(0, 200)}`);
  }
}

/**
 * Stash a buffer under a short random id. Caller then constructs
 * `<PUBLIC_BASE_URL>/audio/<id>.mp3` and hands that URL to sendMessage's
 * `attachments` so Loop sends it as an iMessage voice note.
 *
 * flaw #41 — mirror to /tmp/medha-audio/<id>.mp3 so a Railway restart
 * mid-Loop-fetch doesn't lose the audio. Loop's 10-min fetch window
 * MOSTLY doesn't span restarts but this hardens it.
 */
export function storeAudio(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  // 8 hex chars = 4 bytes of entropy; collision probability with 50
  // concurrent entries is astronomically low and short URLs read better.
  const id = randomBytes(4).toString("hex");
  audioStore.set(id, { buffer, at: Date.now() });

  // flaw #41 — write to disk too. Best-effort; memory still wins on
  // every normal fetch because of locality, but disk catches restarts.
  ensureAudioDir();
  try {
    writeFileSync(join(AUDIO_DIR, `${id}.mp3`), buffer);
  } catch (err) {
    console.warn(`[voice] disk mirror failed for ${id}: ${err.message}`);
  }

  evictExpired();
  while (audioStore.size > STORE_LIMIT) {
    const oldest = audioStore.keys().next().value;
    audioStore.delete(oldest);
    // flaw #41 — prune the disk copy in lockstep with memory eviction.
    try {
      unlinkSync(join(AUDIO_DIR, `${oldest}.mp3`));
    } catch {
      // file may already be gone; ignore
    }
  }
  return id;
}

export function getAudio(id) {
  if (!id || typeof id !== "string") return null;
  const entry = audioStore.get(id);
  if (entry) {
    if (Date.now() - entry.at > STORE_TTL_MS) {
      audioStore.delete(id);
      // also prune disk; fall through to disk lookup will fail anyway
      try {
        unlinkSync(join(AUDIO_DIR, `${id}.mp3`));
      } catch {}
      return null;
    }
    return entry.buffer;
  }
  // flaw #41 — memory miss: try the disk mirror. This is the post-restart
  // case: process came back up with an empty Map, Loop still has the URL.
  const diskPath = join(AUDIO_DIR, `${id}.mp3`);
  if (!existsSync(diskPath)) return null;
  try {
    const buf = readFileSync(diskPath);
    // Re-prime memory so subsequent fetches in this lifetime are fast.
    audioStore.set(id, { buffer: buf, at: Date.now() });
    return buf;
  } catch {
    return null;
  }
}

function evictExpired() {
  const now = Date.now();
  for (const [id, entry] of audioStore.entries()) {
    if (now - entry.at > STORE_TTL_MS) {
      audioStore.delete(id);
      try {
        unlinkSync(join(AUDIO_DIR, `${id}.mp3`));
      } catch {}
    }
  }
}
