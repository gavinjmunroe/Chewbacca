/**
 * tts.js — Text-to-speech via ElevenLabs.
 *
 * Returns an MP3 uploaded to amber's temporary file host, so the caller
 * gets a URL that can be attached to a Loop message or iMessage.
 *
 * Per-user secrets:
 *   ELEVENLABS_API_KEY (required)
 *   ELEVENLABS_VOICE_ID (optional; per-user default voice)
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_TTS", [
  "Generate spoken audio from text (tts_generate)",
]);

const TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL = "eleven_turbo_v2_5";
// Fallback voice = "Rachel" (public default) if user hasn't picked one.
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

async function getKey(tenant) {
  return getSecret(tenant, "ELEVENLABS_API_KEY", {
    fallbackEnv: "ELEVENLABS_API_KEY",
  });
}

async function getDefaultVoice(tenant) {
  return (
    (await getSecret(tenant, "ELEVENLABS_VOICE_ID")) || DEFAULT_VOICE
  );
}

async function ttsGenerate(input, tenant) {
  const { text, voice_id, model_id, format } = input || {};
  if (!text || typeof text !== "string") {
    return { error: "text is required" };
  }
  if (text.length > 5000) {
    return { error: "text too long (max 5000 chars)" };
  }

  const key = await getKey(tenant);
  if (!key) return { error: "ELEVENLABS_API_KEY not configured for tenant" };

  const voice = voice_id || (await getDefaultVoice(tenant));
  const model = model_id || DEFAULT_MODEL;
  const outputFormat = format || "mp3_44100_128";

  try {
    const res = await fetch(
      `${TTS_BASE}/${encodeURIComponent(voice)}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: model }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `elevenlabs tts ${res.status}: ${body.slice(0, 300)}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString("base64");
    return {
      audio_base64: base64,
      mime_type: "audio/mpeg",
      bytes: buf.length,
      voice_id: voice,
      model_id: model,
    };
  } catch (err) {
    return { error: `tts failed: ${String(err).slice(0, 200)}` };
  }
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const TTS_TOOLS = [
  {
    name: "tts_generate",
    description:
      "Generate spoken audio (MP3) from text using ElevenLabs. Returns base64-encoded audio that can be attached to a message or saved. Use for voice responses, voice memos, or audio reminders.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to speak (≤5000 characters).",
        },
        voice_id: {
          type: "string",
          description:
            "Optional ElevenLabs voice ID. Falls back to user's ELEVENLABS_VOICE_ID secret or Rachel.",
        },
        model_id: {
          type: "string",
          description:
            "Optional model. Default 'eleven_turbo_v2_5' (fast). Use 'eleven_multilingual_v2' for non-English.",
        },
        format: {
          type: "string",
          description:
            "Output format. Default 'mp3_44100_128'. Alternatives: 'mp3_22050_32', 'pcm_16000'.",
        },
      },
      required: ["text"],
    },
  },
];

export async function executeTtsTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  switch (toolName) {
    case "tts_generate":
      return ttsGenerate(input, tenant);
    default:
      return { error: `unknown tts tool: ${toolName}` };
  }
}
