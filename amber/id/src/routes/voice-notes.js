/**
 * Voice-note endpoint: POST /v1/me/contacts/:contactId/voice-note
 *
 * Receives a base64 audio recording for one of the caller's contacts, sends it
 * to Google Gemini ONCE to transcribe AND extract a structured, ranking-relevant
 * summary, then:
 *   - appends the verbatim transcript to the contact's `notes` (raw preserved),
 *   - appends the structured summary to the contact's `context` (the highlighted
 *     signal the ranker embeds),
 *   - persists via upsertContact (Postgres) with the FULL contact object so no
 *     other field is clobbered,
 *   - fire-and-forget re-indexes the contact so the new note affects PeopleRank.
 *
 * Fail-safe: if GEMINI_API_KEY is missing or transcription fails, return 502 and
 * DO NOT save an empty note — the note save only happens on a successful
 * transcription.
 *
 * Upload: JSON base64 with a raised per-route bodyLimit (~15 MB); the app has no
 * multipart and a 1 MB global limit, so audio comes in as a base64 string.
 */

import {
  getContactById,
  getContactByExternalId,
  upsertContact as defaultUpsertContact,
} from "../db/user-store.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const GEMINI_TIMEOUT_MS = 30000; // audio takes longer than text
const NOTES_CAP = 32000; // mirror updateContactContext's cap; keep the tail
const ROUTE_BODY_LIMIT = 15 * 1024 * 1024; // 15 MB for base64 audio

const GEMINI_PROMPT = [
  "You are given a voice note a user recorded ABOUT one of their personal",
  "contacts. Do two things and return ONLY a JSON object — no markdown, no",
  "code fences, no preamble:",
  "",
  '{ "transcript": "<verbatim transcription of the audio>",',
  '  "structured": "<concise, ranking-relevant summary highlighting the most',
  "   important facts: who they are, where they work, role, location, how the",
  "   user knows them, relationship/closeness signals, anything notable> }",
  "",
  'Example structured: "Works in finance at Chase, based in LA. Close friend,',
  'talk weekly. Met at YC." Keep structured to 1-3 sentences. If the audio is',
  "unclear, transcribe what you can and summarize conservatively.",
].join("\n");

function requirePrivyDid(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return privyDid;
}

/** Fetch the caller's contact by bigint id, falling back to external_id. */
async function readOwnedContact(ownerId, contactId) {
  const byId = await getContactById(ownerId, contactId).catch(() => null);
  if (byId) return byId;
  return getContactByExternalId(ownerId, contactId).catch(() => null);
}

/** Append `addition` to `prior` as a timestamped block, capped to the tail.
 *  Mirrors updateContactContext's append semantics. Empty addition → prior. */
function appendStamped(prior, addition, cap = NOTES_CAP) {
  const p = prior ? String(prior) : "";
  const add = addition ? `${new Date().toISOString()}: ${addition}` : "";
  const combined = p && add ? `${p}\n\n${add}` : p || add;
  return combined.length > cap ? combined.slice(-cap) : combined;
}

/**
 * Transcribe + extract structured info in ONE Gemini call. Mirrors the chat.js
 * raw-fetch pattern: injectable fetchImpl, env key, AbortSignal.timeout,
 * fail-safe. Returns { transcript, structured } on success, or null on any hard
 * failure (no key / network / non-ok / empty). When Gemini returns text that
 * isn't the expected JSON, falls back to { transcript: <whole text>,
 * structured: "" } rather than null, so a usable transcript still saves.
 */
export async function transcribeAndExtract({
  audioBase64,
  mimeType,
  geminiKey = process.env.GEMINI_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!geminiKey || typeof fetchImpl !== "function" || !audioBase64) return null;
  try {
    const resp = await fetchImpl(`${GEMINI_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType || "audio/m4a",
                  data: audioBase64,
                },
              },
              { text: GEMINI_PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!text) return null;
    // Strip markdown code fences if present.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    let parsed = null;
    try {
      const m = cleaned.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed.transcript === "string") {
      return {
        transcript: parsed.transcript.trim(),
        structured:
          typeof parsed.structured === "string" ? parsed.structured.trim() : "",
      };
    }
    // Fail-safe: couldn't parse JSON → treat the whole reply as the transcript.
    return { transcript: cleaned, structured: "" };
  } catch {
    return null; // never throws; the route maps null → 502
  }
}

export function registerVoiceNoteRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const readContact = deps.readOwnedContact || readOwnedContact;
  const transcribe = deps.transcribeAndExtract || transcribeAndExtract;
  const upsertContact = deps.upsertContact || defaultUpsertContact;

  app.post(
    "/v1/me/contacts/:contactId/voice-note",
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
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;

      const phone = request.privyUser?.phone;
      const ownerId = phone
        ? await resolveAmberIdByPhone(phone).catch(() => null)
        : null;
      if (!ownerId) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      const contactId = String(request.params.contactId || "");
      const body = request.body || {};
      const audio = typeof body.audio === "string" ? body.audio : "";
      if (!contactId || !audio) {
        return reply.code(400).send({
          error: "bad_request",
          message: "contactId (param) and audio (base64) are required",
        });
      }

      if (!process.env.GEMINI_API_KEY) {
        return reply.code(502).send({
          error: "transcription_unavailable",
          message: "GEMINI_API_KEY is not configured.",
        });
      }

      const full = await readContact(ownerId, contactId).catch(() => null);
      if (!full || !full.name) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Contact not found" });
      }

      const result = await transcribe({
        audioBase64: audio,
        mimeType: body.mimeType,
        geminiKey: process.env.GEMINI_API_KEY,
        fetchImpl: globalThis.fetch,
      });
      if (!result || !result.transcript) {
        return reply.code(502).send({
          error: "transcription_failed",
          message: "Could not transcribe the audio. The note was not saved.",
        });
      }

      const mergedNotes = appendStamped(full.notes, result.transcript);
      const mergedContext = result.structured
        ? appendStamped(full.context, result.structured)
        : (full.context ?? null);

      const updated = await upsertContact(ownerId, {
        ...full,
        id: full.id,
        notes: mergedNotes,
        context: mergedContext,
      });
      if (!updated) {
        return reply
          .code(500)
          .send({ error: "save_failed", message: "Could not save the note." });
      }

      // Fire-and-forget re-index (Pinecone namespace is keyed by privyDid).

      return {
        ok: true,
        transcript: result.transcript,
        structured: result.structured,
        contact: updated,
      };
    },
  );
}
