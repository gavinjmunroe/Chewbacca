/**
 * voice-ingest.js: Tab 22, voice journaling.
 *
 * Sagar wants to walk and talk: send a voice memo and have it remembered.
 * Today inbound audio is transcribed (ElevenLabs Scribe) only to feed the
 * current turn's reply, then discarded. This module turns every substantive
 * voice memo into a journal entry so a three-minute walk-and-talk is
 * recall-able weeks later, not forgotten the moment the reply ships.
 *
 * ONE capture path for BOTH transports. Loop transcribes in server.js and
 * Slack transcribes in transports/slack/index.js; both flag the turn with a
 * `[voice-in]` prefix on the text. handleWebhookMessage strips that prefix
 * once the tenant is resolved and calls journalVoiceMemo() with the clean
 * transcript, so iMessage and Slack share a single journaling code path and
 * we never double-capture.
 *
 * The write reuses the existing add_journal_entry tool
 * (executePersonalLifeTool -> medha-id POST /v1/personal/journal). That means
 * the memo lands in Firestore AND the personal-life Pinecone namespace through
 * the same indexer every other journal entry already uses, so recall_journal and
 * the Wave 1 dimension-filtered search pick it up for free. The journal
 * endpoint stores kind="journal_entry" with additionalProperties:false, so we
 * cannot pass a top-level kind="voice_memo". Instead we mark voice-sourced
 * memos in the topic ("Voice memo: ...") so recall can tell them apart without
 * a medha-id schema change.
 *
 * Dimension is classified deterministically (no extra LLM call) via the same
 * keyword classifier Tab 16 uses for conversation embeddings, so the journal
 * dimension and the conversation-turn dimension agree for the same memo.
 *
 * Scope: Medha tenant only (this is the medha-platform repo; Togari runs its
 * own deployment). The call is fire-and-forget at the call site, so a journaling
 * failure must never block or delay the user's reply.
 */

import { classifyDimension } from "./conversation-index.js";
import { executePersonalLifeTool } from "./tools/personal-life.js";

// Skip trivial memos ("ok", "thanks", a one-word "yep"). Same 30-char floor
// Tab 16 applies to conversation embeds, so both capture paths agree on what
// counts as substantive and we don't litter the journal with acks.
export const MIN_VOICE_MEMO_CHARS = 30;

// Topic is the one-line essence. The journal schema caps topic at 200 chars;
// "Voice memo: " (12) + 80 stays well under, leaving headroom.
const TOPIC_MAX_CHARS = 80;
const VOICE_TOPIC_PREFIX = "Voice memo";

/**
 * Collapse whitespace and trim. Voice transcripts often arrive with newlines
 * and double spaces from the STT engine.
 *
 * @param {string} [text]
 * @returns {string}
 */
function normalizeTranscript(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive a short, human topic from the transcript: the first sentence, capped
 * at a word boundary, prefixed so recall can distinguish voice memos from
 * typed journal entries.
 *
 * @param {string} transcript
 * @returns {string} e.g. "Voice memo: had a long talk with Shirley about the retreat"
 */
export function deriveVoiceTopic(transcript) {
  const clean = normalizeTranscript(transcript);
  if (!clean) return VOICE_TOPIC_PREFIX;
  // First sentence (split on sentence enders); fall back to the whole string
  // when there is no terminal punctuation.
  const firstSentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  let topic = firstSentence.slice(0, TOPIC_MAX_CHARS).trim();
  if (firstSentence.length > TOPIC_MAX_CHARS) {
    // Don't cut mid-word when we truncated.
    const lastSpace = topic.lastIndexOf(" ");
    if (lastSpace > 40) topic = topic.slice(0, lastSpace).trim();
    topic = `${topic}...`;
  }
  return `${VOICE_TOPIC_PREFIX}: ${topic}`;
}

/**
 * Capture a voice memo transcript as a journal entry.
 *
 * Returns a small result object instead of throwing so the fire-and-forget
 * call site can log without a try/catch and tests can assert on the outcome.
 *
 * @param {object}   args
 * @param {object}   args.tenant       Resolved tenant (must carry phoneNumber).
 * @param {string}   args.transcript   The clean transcript (prefix already stripped).
 * @param {string}   [args.contact]    Inbound sender handle (for logging/attribution).
 * @param {string}   [args.messageId]  Source message id (for logging).
 * @param {Function} [args.executor]   Injection seam for tests; defaults to the real tool.
 * @returns {Promise<{skipped:boolean, success?:boolean, reason?:string, error?:string, topic?:string, dimension?:string, journal_entry?:object|null, length?:number}>}
 */
export async function journalVoiceMemo({
  tenant,
  transcript,
  contact = null,
  messageId = null,
  executor = executePersonalLifeTool,
} = {}) {
  const clean = normalizeTranscript(transcript);
  if (clean.length < MIN_VOICE_MEMO_CHARS) {
    return { skipped: true, reason: "too_short", length: clean.length };
  }
  if (!tenant) {
    return { skipped: true, reason: "no_tenant" };
  }

  const dimension = classifyDimension(clean);
  const topic = deriveVoiceTopic(clean);
  const input = { topic, body: clean, dimension };

  try {
    const result = await executor("add_journal_entry", input, { tenant });
    if (result && result.error) {
      console.warn(
        `[voice-journal] persist failed contact=${contact || "?"} msg=${messageId || "?"}: ${result.error}`,
      );
      return {
        skipped: false,
        success: false,
        error: result.error,
        topic,
        dimension,
      };
    }
    console.log(
      `[voice-journal] captured contact=${contact || "?"} dim=${dimension} topic="${topic.slice(0, 60)}"`,
    );
    return {
      skipped: false,
      success: true,
      topic,
      dimension,
      journal_entry: (result && result.journal_entry) || null,
    };
  } catch (err) {
    console.warn(
      `[voice-journal] threw contact=${contact || "?"} msg=${messageId || "?"}: ${err?.message || err}`,
    );
    return {
      skipped: false,
      success: false,
      error: err?.message || "voice_journal_failed",
      topic,
      dimension,
    };
  }
}
