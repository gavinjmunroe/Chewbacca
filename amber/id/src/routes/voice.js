/**
 * Voice backend for the Amber app — one-shot dictation/transcription capture.
 * All voice input is voice-to-TEXT only: the app records a clip, this transcribes
 * it (Groq primary, OpenAI/Gemini fallback), and Claude analyzes the text. Amber
 * gives NO spoken voice response of any kind, and there is no streaming/realtime
 * session — the OpenAI Realtime (WebRTC) stack was removed entirely.
 *
 *   POST /v1/voice/dictate       — base64 audio → transcript → fact capture
 *   POST /v1/voice/transcribe    — base64 audio → transcript only (caller captures)
 *
 * Reuses, doesn't reinvent:
 *   - Fact capture: captureFromMessage (src/lib/fact-capture.js).
 *   - Gemini transcription fallback: transcribeAndExtract (src/routes/voice-notes.js).
 *   - OpenAI calls: the raw-fetch + OPENAI_API_KEY pattern from
 *     src/embeddings/embeddings.js (no OpenAI SDK is installed).
 *   - Upload shape: voice-notes.js's { audio (base64), mimeType, durationMs }
 *     with a raised per-route bodyLimit.
 *   - Auth: requireAuth (src/lib/privy.js), then phone → amber_id via
 *     resolveAmberIdByPhone (src/db/store.js). Every route is owner-scoped;
 *     nothing accepts an owner id from the body.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  resolveAmberIdByPhone as defaultResolveAmberIdByPhone,
  getTopContactNames,
} from "../db/store.js";
import { captureFromMessage as defaultCaptureFromMessage } from "../lib/fact-capture.js";
import { transcribeAndExtract as defaultTranscribeAndExtract } from "./voice-notes.js";
import {
  applyVocabCorrections,
  getVoiceCorrections,
  getVoiceVocab,
  recordVoiceCorrection,
  recordVoiceVocab,
} from "../lib/voice-vocab.js";
import { learnablePairs, learnableTerms } from "../lib/transcript-diff.js";
import { stripTranscriptFiller } from "../lib/transcript-filler.js";

// Same ceiling voice-notes.js uses — the app has no multipart, so audio arrives
// as a base64 string and the 1 MB global bodyLimit would reject it.
const ROUTE_BODY_LIMIT = 15 * 1024 * 1024;

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const TRANSCRIBE_TIMEOUT_MS = 60000; // audio upload + decode takes longer

// Extension matters to the transcription API — it sniffs the filename.
const MIME_EXT = {
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

function extForMime(mimeType) {
  return MIME_EXT[String(mimeType || "").toLowerCase()] || "m4a";
}

async function readJsonSafe(resp) {
  const text = await resp.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Transcribe base64 audio with OpenAI (raw fetch + multipart, no SDK).
 * Returns { transcript, model } or null on ANY failure, so the caller can fall
 * back to Gemini rather than 502-ing the user's recording away.
 */
export async function transcribeWithOpenAI({
  audioBase64,
  mimeType,
  prompt = "",
  model = TRANSCRIBE_MODEL,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || !audioBase64 || typeof fetchImpl !== "function") return null;
  try {
    const bytes = Buffer.from(audioBase64, "base64");
    if (bytes.length === 0) return null;
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: mimeType || "audio/m4a" }),
      `audio.${extForMime(mimeType)}`,
    );
    form.append("model", model);
    form.append("response_format", "json");
    form.append("language", "en");
    // Bias toward the user's contact names so proper nouns transcribe correctly.
    if (prompt) form.append("prompt", prompt);

    const resp = await fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` }, // fetch sets the multipart boundary
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const body = await readJsonSafe(resp);
    const transcript = typeof body?.text === "string" ? body.text.trim() : "";
    return transcript ? { transcript, model } : null;
  } catch {
    return null;
  }
}

// Groq transcription: OpenAI-compatible multipart, Whisper large-v3. Groq is the
// PRIMARY voice-to-text engine (fast + accurate); OpenAI and Gemini remain
// fallbacks. Dormant until GROQ_API_KEY is set, so shipping this changes nothing
// until you configure it. Separating transcription (here) from analysis/retrieval
// (captureFromMessage / PeopleRank downstream) is the whole point: each stage does
// one job well.
const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3";

export async function transcribeWithGroq({
  audioBase64,
  mimeType,
  prompt = "",
  model = GROQ_TRANSCRIBE_MODEL,
  apiKey = process.env.GROQ_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || !audioBase64 || typeof fetchImpl !== "function") return null;
  try {
    const bytes = Buffer.from(audioBase64, "base64");
    if (bytes.length === 0) return null;
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: mimeType || "audio/m4a" }),
      `audio.${extForMime(mimeType)}`,
    );
    form.append("model", model);
    // verbose_json returns per-segment confidence (avg_logprob / no_speech_prob)
    // so we can catch a garbled transcription and escalate instead of trusting it.
    form.append("response_format", "verbose_json");
    // ISO-639-1 language improves both accuracy and latency (per Groq docs).
    form.append("language", "en");
    // temperature 0 is Groq's recommended default for transcription (most literal).
    form.append("temperature", "0");
    // Bias toward the user's contact names so proper nouns transcribe correctly
    // (prompt is capped at 224 tokens; the caller keeps the name list short).
    if (prompt) form.append("prompt", prompt);

    const resp = await fetchImpl(GROQ_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` }, // fetch sets the multipart boundary
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const body = await readJsonSafe(resp);
    const transcript = typeof body?.text === "string" ? body.text.trim() : "";
    if (!transcript) return null;

    // Confidence gate from segment metadata: a very negative mean avg_logprob or
    // a high mean no_speech_prob means the model was unsure (noise, accent,
    // crosstalk). We surface that so the caller can get a second opinion.
    let lowConfidence = false;
    const segs = Array.isArray(body?.segments) ? body.segments : [];
    if (segs.length > 0) {
      const mean = (f) => segs.reduce((a, s) => a + (Number(s?.[f]) || 0), 0) / segs.length;
      lowConfidence = mean("no_speech_prob") > 0.5 || mean("avg_logprob") < -0.7;
    }
    return { transcript, model, lowConfidence };
  } catch {
    return null;
  }
}

/**
 * The two halves of the self-training loop, loaded together.
 *
 *   prompt      — the biasing prompt handed to the decoder, learned spellings
 *                 first, so proper nouns come out right AT THE SOURCE.
 *   corrections — learned heard -> intended pairs, applied to the text after the
 *                 fact for the cases bias cannot win ("AJ" is a perfectly
 *                 ordinary transcription of the sounds in "Ajay").
 *
 * This lived inline in /v1/voice/transcribe and nowhere else, which meant
 * /v1/voice/dictate — the route the app's main record button actually calls —
 * transcribed with NO bias and applied NO corrections. Correcting a name taught
 * a dictionary that the primary path never opened, so the same mishearing came
 * back on the very next note. One helper, both routes, no drift.
 *
 * Fail-soft in every direction: a failed read yields an empty prompt and an
 * empty correction list, i.e. exactly the old behavior.
 */
export async function loadVoiceBias(ownerId) {
  const [names, vocab, corrections] = await Promise.all([
    getTopContactNames(ownerId, 60).catch(() => []),
    getVoiceVocab(ownerId, 20).catch(() => []),
    getVoiceCorrections(ownerId).catch(() => []),
  ]);
  const seenTerm = new Set();
  const biasTerms = [];
  for (const n of [...vocab, ...names]) {
    const k = String(n || "").trim().toLowerCase();
    if (!k || seenTerm.has(k)) continue;
    seenTerm.add(k);
    biasTerms.push(n);
  }
  // Cap so the biasing prompt stays under Groq's 224-token limit. Phrased as
  // authoritative spellings — Groq's docs say the prompt should "denote proper
  // spellings", which steers the model harder than a soft "may be mentioned".
  const prompt =
    biasTerms.length > 0
      ? `This is a personal note about people the speaker knows. Use these exact spellings for any names you hear: ${biasTerms.slice(0, 40).join(", ")}.`
      : "";
  return { prompt, corrections: Array.isArray(corrections) ? corrections : [] };
}

/**
 * ONE LADDER, TRIED IN ORDER, WITH THE BOILERPLATE FILTERED OUT.
 *
 * There were two copies of this: the record button's route and the plain
 * transcribe route each had their own Groq-then-OpenAI-then-Gemini cascade,
 * near-identical and already drifting in their logging. One clip that comes
 * back wrong should be wrong in one place.
 *
 * AND THE FILTER BELONGS INSIDE THE LADDER, not after it. Whisper answers
 * silence with a YouTube outro at ordinary confidence, so a filler-only result
 * is not a transcript and must not end the cascade: it escalates to the next
 * engine exactly like an empty one, and the next engine usually hears the
 * speech that was actually there. Applying the filter after the ladder had
 * finished would leave the user with nothing when a second opinion was
 * available.
 *
 * @returns {{ transcript: string, engine: string|null, filler: string[] }}
 *   `transcript` is "" when nothing usable was heard. `filler` lists what was
 *   removed, for the log -- a clip that transcribed to nothing but boilerplate
 *   is worth being able to see in the logs later.
 */
async function runTranscribeLadder({ audioBase64, mimeType, prompt, engines, log, ownerId }) {
  const removed = [];
  /** Run one engine and keep only what survives the filter. */
  const attempt = async (fn) => {
    const res = await fn().catch(() => null);
    if (!res?.transcript) return null;
    const cleaned = stripTranscriptFiller(res.transcript);
    if (cleaned.removed.length > 0) removed.push(...cleaned.removed);
    return { ...res, transcript: cleaned.text, allFiller: cleaned.allFiller };
  };

  const viaGroq = await attempt(() =>
    engines.groq({ audioBase64, mimeType, prompt }),
  );
  if (viaGroq?.transcript && !viaGroq.lowConfidence) {
    return { transcript: viaGroq.transcript, engine: `groq:${viaGroq.model}`, filler: removed };
  }
  if (viaGroq?.allFiller) {
    log?.warn?.(
      { ownerId, heard: viaGroq === null ? null : "filler" },
      "[voice] Groq heard only boilerplate — getting a second opinion",
    );
  } else if (viaGroq?.lowConfidence) {
    log?.warn?.({ ownerId }, "[voice] Groq low-confidence — getting a second opinion");
  }

  const viaOpenAI = await attempt(() =>
    engines.openai({ audioBase64, mimeType, prompt }),
  );
  if (viaOpenAI?.transcript) {
    return { transcript: viaOpenAI.transcript, engine: `openai:${viaOpenAI.model}`, filler: removed };
  }

  const viaGemini = await attempt(() => engines.gemini({ audioBase64, mimeType }));
  if (viaGemini?.transcript) {
    return { transcript: viaGemini.transcript, engine: "gemini", filler: removed };
  }

  // Last resort: a low-confidence Groq transcript still beats losing the
  // recording entirely. Filler does NOT qualify -- it is not the recording.
  if (viaGroq?.transcript) {
    return {
      transcript: viaGroq.transcript,
      engine: `groq:${viaGroq.model}:lowconf`,
      filler: removed,
    };
  }
  return { transcript: "", engine: null, filler: removed };
}

export function registerVoiceRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone = deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const capture = deps.captureFromMessage || defaultCaptureFromMessage;
  const transcribeGroq = deps.transcribeWithGroq || transcribeWithGroq;
  const transcribeOpenAI = deps.transcribeWithOpenAI || transcribeWithOpenAI;
  const transcribeGemini = deps.transcribeAndExtract || defaultTranscribeAndExtract;

  /**
   * Resolve the caller to a Cloud SQL amber_id. 401 if the token carries no
   * subject, 400 if it carries no phone or the phone maps to no owner. Returns
   * null after replying, so callers just `if (!ownerId) return;`.
   */
  async function resolveOwner(request, reply) {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return null;
    }
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({
        error: "no_phone_on_session",
        message: "Session carries no phone — cannot resolve owner.",
      });
      return null;
    }
    const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
    if (!amberId) {
      request.log?.error?.({ phone }, "[voice] resolveAmberIdByPhone returned null");
      reply.code(400).send({
        error: "could_not_resolve_owner",
        message: "Could not resolve Cloud SQL owner for this session.",
      });
      return null;
    }
    return amberId;
  }

  /**
   * POST /v1/voice/dictate
   * Body { audio (base64), mimeType, durationMs } — voice-notes.js's upload
   * shape. Transcribes with Groq (primary), falls back to OpenAI then the
   * existing Gemini transcribeAndExtract path, then runs the transcript through
   * fact capture.
   *
   * 502 only when ALL engines fail — a recording is never silently dropped.
   */
  app.post(
    "/v1/voice/dictate",
    {
      preHandler: [requireAuth],
      bodyLimit: ROUTE_BODY_LIMIT, // raised for base64 audio (global is 1 MB)
      schema: {
        body: {
          type: "object",
          required: ["audio"],
          properties: {
            audio: { type: "string", minLength: 1 },
            mimeType: { type: "string", maxLength: 100 },
            durationMs: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;

      const body = request.body || {};
      const audio = typeof body.audio === "string" ? body.audio : "";
      if (!audio) {
        return reply.code(400).send({ error: "audio_required", message: "audio (base64) is required" });
      }
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/m4a";

      // THE SELF-TRAINING LOOP RUNS HERE TOO, AND IT DID NOT.
      //
      // This is the route the record button calls, and it was the one route that
      // transcribed with no bias prompt and applied no learned corrections. So
      // every name the user painstakingly corrected was written into a dictionary
      // that the main path never read — the mishearing came straight back on the
      // next note, and the fix looked like it had done nothing.
      //
      // Loaded BEFORE transcription (the prompt has to reach the decoder) and
      // fail-soft: on any read failure the prompt is empty and this behaves
      // exactly as it did before.
      const { prompt, corrections } = await loadVoiceBias(ownerId);

      const heard = await runTranscribeLadder({
        audioBase64: audio,
        mimeType,
        prompt,
        engines: { groq: transcribeGroq, openai: transcribeOpenAI, gemini: transcribeGemini },
        log: request.log,
        ownerId,
      });
      let transcript = heard.transcript;
      const engine = heard.engine;
      if (heard.filler.length > 0) {
        request.log?.warn?.(
          { ownerId, removed: heard.filler.length },
          "[voice] dropped transcription boilerplate from a quiet clip",
        );
      }

      if (!transcript) {
        // Silence and failure look identical from here unless the ladder says
        // which it was. See the same split on /v1/voice/transcribe.
        const quiet = heard.filler.length > 0;
        request.log?.error?.(
          { ownerId, mimeType, quiet },
          quiet
            ? "[voice] dictation heard no speech, only boilerplate"
            : "[voice] dictation failed on ALL engines",
        );
        return reply.code(502).send({
          error: quiet ? "no_speech" : "transcription_failed",
          message: quiet
            ? "That recording came through silent."
            : "Could not transcribe the audio.",
        });
      }

      // Applied BEFORE capture, not after — capture is what resolves names to
      // contacts, so a corrected transcript is the difference between tagging the
      // right person and opening another "who did you mean" card for a name the
      // user already fixed once.
      const fixed = applyVocabCorrections(transcript, corrections);
      transcript = fixed.text;

      const cap = await capture({
        ownerId,
        messageText: transcript,
        source: "app_voice",
        log: request.log,
      }).catch((err) => {
        request.log?.warn?.({ err: err?.message }, "[voice] dictate capture failed");
        return { status: "error", outcomes: [] };
      });

      request.log?.info?.(
        {
          ownerId,
          engine,
          chars: transcript.length,
          // COUNT ONLY. The corrected terms are real people's names lifted out of
          // a private voice note and this goes to a hosted log stream.
          corrected: fixed.applied.length,
          durationMs: body.durationMs ?? null,
          outcomes: Array.isArray(cap?.outcomes) ? cap.outcomes.length : 0,
        },
        "[voice] dictation captured",
      );

      return {
        transcript,
        status: cap?.status ?? "error",
        outcomes: Array.isArray(cap?.outcomes) ? cap.outcomes : [],
        engine,
      };
    },
  );

  /**
   * POST /v1/voice/transcribe
   * Body { audio (base64), mimeType } — the whole clip, transcribed with the
   * batch model (more accurate than streaming). Returns { transcript } ONLY, no
   * capture, so the caller runs its own capture (home note, contact note, Ask).
   */
  app.post(
    "/v1/voice/transcribe",
    {
      preHandler: [requireAuth],
      bodyLimit: ROUTE_BODY_LIMIT,
      schema: {
        body: {
          type: "object",
          required: ["audio"],
          properties: {
            audio: { type: "string", minLength: 1 },
            mimeType: { type: "string", maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      const body = request.body || {};
      const audio = typeof body.audio === "string" ? body.audio : "";
      if (!audio) {
        return reply.code(400).send({ error: "audio_required", message: "audio (base64) is required" });
      }
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/m4a";

      // Bias with the user's contact names so proper nouns spell right, learned
      // spellings first, plus the learned heard -> intended pairs for after.
      const { prompt, corrections } = await loadVoiceBias(ownerId);

      const heard = await runTranscribeLadder({
        audioBase64: audio,
        mimeType,
        prompt,
        engines: { groq: transcribeGroq, openai: transcribeOpenAI, gemini: transcribeGemini },
        log: request.log,
        ownerId,
      });
      let transcript = heard.transcript;
      const engine = heard.engine;

      if (!transcript) {
        /**
         * NOTHING WAS SAID IS NOT THE SAME AS TRANSCRIPTION BROKE, and the
         * client shows a different thing for each. A clip that came back as
         * nothing but "Thank you for watching!" is a quiet recording, not a
         * failed request, and telling somebody their transcription failed when
         * their microphone was muted sends them to the wrong problem.
         */
        const quiet = heard.filler.length > 0;
        request.log?.warn?.(
          { ownerId, quiet, removed: heard.filler.length },
          quiet ? "[voice] clip held no speech, only boilerplate" : "[voice] transcription failed",
        );
        return reply.code(502).send({
          error: quiet ? "no_speech" : "transcription_failed",
          message: quiet
            ? "That recording came through silent."
            : "Could not transcribe the audio.",
        });
      }
      // LEARNED CORRECTIONS, APPLIED AFTER THE FACT.
      //
      // The bias prompt above already pushed the decoder toward this user's
      // spellings, and when it lands that is the better outcome: the transcript is
      // right at the source and nothing has to be rewritten. But bias is a
      // suggestion to a decoder, not a guarantee — "AJ" keeps coming out as "AJ" no
      // matter how many times "Ajay" is in the prompt, because "AJ" is a perfectly
      // ordinary transcription of those sounds. So a learned heard -> intended pair
      // gets applied to the text as well. Whole words only; see the note on
      // applyVocabCorrections about what substring replacement does to "major".
      const fixed = applyVocabCorrections(transcript, corrections);
      transcript = fixed.text;

      // So you can confirm in the logs which engine actually served the transcript.
      // COUNT ONLY for the corrections — the terms are real people's names lifted out
      // of a private voice note, and this goes to a hosted log stream.
      request.log?.info?.(
        `VOICE_TRANSCRIBE owner=${ownerId} engine=${engine} chars=${transcript.length} corrected=${fixed.applied.length}`,
      );
      return { transcript, engine };
    },
  );

  /**
   * POST /v1/voice/correction — teach the dictionary from an edited transcript.
   *
   * The other half of the loop that /v1/voice/transcribe already reads from. The user
   * hears "AJ" come back, edits it to "Ajay", and expects every future transcript to
   * say "Ajay"; this is what makes that true.
   *
   * Body: { original, corrected, contactId? }
   *
   * Deliberately FIRE-AND-FORGET from the client's point of view: it always returns 200
   * with what it learned (often nothing), and never blocks or fails a save. A dropped
   * correction costs one repeated mistake; a failed save costs the user's words.
   *
   * The filtering lives in lib/transcript-diff.js and is intentionally strict — a
   * wrongly learned term is worse than no term, because it is fed into the biasing
   * prompt and competes with the user's real contact names for a 224-token budget.
   */
  app.post(
    "/v1/voice/correction",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["original", "corrected"],
          properties: {
            // 4000, not 20000. Defense in depth with the token ceiling in
            // lib/transcript-diff.js: the schema stops an oversized body at the edge so
            // the diff never sees it, and the ceiling stops it again if this is ever
            // relaxed. A correction is a word or two in a note, never 20KB of prose.
            original: { type: "string", maxLength: 4000 },
            corrected: { type: "string", maxLength: 4000 },
            contactId: { type: "string", maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      const { original = "", corrected = "" } = request.body || {};
      // contactId is DELIBERATELY IGNORED, not forwarded.
      //
      // It arrived from the request body and was written to voice_vocabulary.contact_id
      // with no check that it belongs to the caller. Nothing reads that column today, so
      // there is no cross-tenant leak right now — but it is a latent one, primed to
      // activate the first time anything joins it to `contacts` for display, which is
      // exactly what the column was added for. Storing an unverified foreign key is
      // storing a bug with a delay on it. The term itself is all the dictionary needs,
      // and it is owner-scoped by the primary key. Re-introduce the association only
      // alongside an ownership check.
      const contactId = null;
      if (original.trim() === corrected.trim()) return reply.send({ ok: true, learned: [] });

      const terms = learnableTerms(original, corrected);
      if (terms.length === 0) return reply.send({ ok: true, learned: [] });

      await recordVoiceVocab(ownerId, terms, contactId).catch(() => {});
      // AND the pair, so the same misrecognition can be repaired deterministically
      // next time instead of only being nudged against. learnablePairs aligns the two
      // strings token by token; a rewrite that is not a word swap yields nothing,
      // which is correct — "I said it wrong" is not a pronunciation.
      for (const [heard, intended] of learnablePairs(original, corrected)) {
        await recordVoiceCorrection(ownerId, heard, intended, contactId).catch(() => {});
      }
      // COUNT ONLY -- never the terms. They are proper nouns lifted straight out of a
      // private voice note, i.e. real people's names, and this line goes to a hosted log
      // stream that outlives the request and is readable by anyone with deploy access.
      request.log?.info?.(`VOICE_CORRECTION owner=${ownerId} learned=${terms.length}`);
      return reply.send({ ok: true, learned: terms });
    },
  );
}
