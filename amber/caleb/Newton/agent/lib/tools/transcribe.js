/**
 * transcribe.js — Speech-to-text via ElevenLabs Scribe.
 *
 * Scribe is ElevenLabs' STT model; superior to Whisper on non-English and
 * speaker diarization. Accepts either a file URL (pass-through fetch) or
 * raw base64 audio. Returns transcript text + optional word-level timestamps.
 *
 * Per-user secret: ELEVENLABS_API_KEY via lib/secrets.js.
 * Fallback: process.env.ELEVENLABS_API_KEY during migration.
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Transcribe", [
  "Transcribe audio or video URL to text (transcribe_audio)",
]);

const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const DEFAULT_TIMEOUT_MS = 300_000; // up to 5 min for long audio

async function getKey(tenant) {
  return getSecret(tenant, "ELEVENLABS_API_KEY", {
    fallbackEnv: "ELEVENLABS_API_KEY",
  });
}

async function fetchAudio(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = url.split("/").pop()?.split("?")[0] || "audio.mp3";
  return { buf, filename };
}

async function transcribeAudio(input, tenant) {
  const { url, language, diarize } = input || {};
  if (!url) return { error: "url is required" };

  const key = await getKey(tenant);
  if (!key) return { error: "ELEVENLABS_API_KEY not configured for tenant" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const { buf, filename } = await fetchAudio(url);
    const form = new FormData();
    form.append(
      "file",
      new Blob([buf], { type: "application/octet-stream" }),
      filename,
    );
    form.append("model_id", "scribe_v1");
    if (language) form.append("language_code", language);
    if (diarize) form.append("diarize", "true");

    const res = await fetch(STT_URL, {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `elevenlabs stt ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    return {
      text: data.text || "",
      language: data.language_code || null,
      language_probability: data.language_probability || null,
      duration_seconds: data.duration || null,
      words: Array.isArray(data.words)
        ? data.words.slice(0, 2000) // cap huge transcripts
        : null,
    };
  } catch (err) {
    clearTimeout(timer);
    return { error: `transcribe failed: ${String(err).slice(0, 200)}` };
  }
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const TRANSCRIBE_TOOLS = [
  {
    name: "transcribe_audio",
    description:
      "Transcribe an audio or video file (given by URL) to text using ElevenLabs Scribe. Supports MP3/WAV/M4A/MP4/MOV and more. Returns transcript text plus optional speaker labels and word-level timestamps.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Publicly reachable audio/video URL.",
        },
        language: {
          type: "string",
          description:
            "Optional ISO-639-1 code (e.g. 'en', 'es'). Auto-detected if omitted.",
        },
        diarize: {
          type: "boolean",
          description:
            "If true, tag each word with a speaker label. Slower but useful for multi-person recordings.",
        },
      },
      required: ["url"],
    },
  },
];

export async function executeTranscribeTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  switch (toolName) {
    case "transcribe_audio":
      return transcribeAudio(input, tenant);
    default:
      return { error: `unknown transcribe tool: ${toolName}` };
  }
}
