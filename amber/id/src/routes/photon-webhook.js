import { loadImessageContext } from '../lib/imessage-context.js';
/**
 * Photon inbound webhook — capture + answer + reply for allowlisted senders.
 *
 *   GET  /webhooks/photon/inbound  → 200 {ok:true}  (URL verification / health)
 *   POST /webhooks/photon/inbound  → log payload, then (for allowlisted senders)
 *                                    run the full chat pipeline and reply.
 *
 * Flow:
 *  1. Interim shared-secret guard (PHOTON_WEBHOOK_SECRET via ?key= or x-photon-key).
 *  2. Full payload capture — logs every header + body for discovery.
 *  3. Dedupe on message.id (in-process Set; bounded to prevent unbounded growth).
 *  4. ACK 200 immediately; all heavy work runs fire-and-forget.
 *  5. Only handle space.type === "dm"; ignore groups.
 *  6. Allowlist guard: ALLOWED_TEST_NUMBERS (comma-separated E.164). Unrecognized
 *     senders log PHOTON_UNAUTHORIZED_SENDER and get no reply.
 *     INTERIM ONLY — per-sender identity verification is the next task.
 *  7. Run the same pipeline as POST /v1/chat:
 *       classifyIntent → [exaSearch if needsWeb] → [loadContactsByOwnerId +
 *       filterRealContacts + dedupeContacts + rankViaTogariSearch if network] →
 *       [streamChat for synthesis or chat answers].
 *     Contact loading uses Cloud SQL keyed by the per-sender resolved ownerId.
 *     If ownerId cannot be resolved, network queries fail closed (no reply).
 *  8. Format for iMessage: strip markdown, resolve [[p:ID]] citation anchors,
 *     drop web-citation brackets, append compact "Name — reason" list for
 *     network answers. Cap at 1 500 chars.
 *  9. Send via spectrum-ts gRPC:
 *       Spectrum({ projectId, projectSecret, providers: [imessage.config()] })
 *       → imessage(app).space.get(spaceId, { phone? })
 *       → space.send(text(replyText))
 *
 * Hard constraints honored:
 *  - Ranking math (filterRealContacts, dedupeContacts, rankViaTogariSearch) is
 *    untouched; only called, not modified.
 *  - No existing route is modified.
 *  - 200 is sent before any engine call; webhook response never blocks on LLM.
 *  - PHOTON_PROJECT_SECRET and PHOTON_WEBHOOK_SECRET live in env only.
 *  - Never throws out of the handler; never crashes the process.
 */

import { timingSafeEqual } from "node:crypto";
import { getSpectrumApp, _resetSpectrumApp, sendPhotonIMessage as sendPhotonDm } from "../lib/photon-sender.js";
import { normalizePhone } from "../lib/auth-session.js";
import { classifyIntent, rewriteQuery, streamChat } from "./chat.js";
import { exaSearch } from "../lib/exa-search.js";
import { rankViaTogariSearch } from "../enrichment/togari-search-rank.js";
import { filterRealContacts } from "../lib/people-rank-realness.js";
import { dedupeContacts } from "../lib/people-rank-dedup.js";
import { getUserByPhone, enrollImessageUser, setUserName, loadRecentMessages, appendMessage, loadContactsByOwnerId, getContactsForResolution, insertContactFact, getPendingFactContext, setPendingFactContext, clearPendingFactContext, updateFactContact, appendFactDetail, createContactForOwner } from "../db/store.js";
import { dmAdmission, LINK_INSTRUCTION } from "../lib/imessage-link.js";
import { extractContactFact, resolveContactByName, runFactCapture } from "../lib/fact-capture.js";
import { AMBER_IDENTITY } from "../lib/amber-identity.js";

// In-process dedupe of Photon message IDs (spc-msg-*).
// Cleared when it exceeds SEEN_IDS_MAX to prevent unbounded growth on
// long-running processes without needing a TTL store.
const seenIds = new Set();
const SEEN_IDS_MAX = 50_000;

// Spaces already told that this account has not turned iMessage on. Once per
// space per process: the instruction is useless the second time and reads as
// harassment by the fifth. In-process is the right grain -- a redeploy re-telling
// somebody who never acted on it is a feature, not a leak.
const linkToldSpaces = new Set();
const LINK_TOLD_MAX = 10_000;

// ── Per-space working memory ───────────────────────────────────────────────
// In-memory only (no persistence yet). Keyed by space.id.
// Capped at MEMORY_MAX_TURNS turns per space and MEMORY_MAX_SPACES spaces
// total; the least-recently-used space is evicted when the map is full.
const MEMORY_MAX_TURNS = 12;
const MEMORY_MAX_SPACES = 500;
const spaceMemory = new Map(); // spaceId → { turns: [{role,sender,text}], lastAccess }

function _getOrCreateMemory(spaceId) {
  const existing = spaceMemory.get(spaceId);
  if (existing) { existing.lastAccess = Date.now(); return existing; }
  if (spaceMemory.size >= MEMORY_MAX_SPACES) {
    let evictKey = null, evictTime = Infinity;
    for (const [k, v] of spaceMemory) {
      if (v.lastAccess < evictTime) { evictTime = v.lastAccess; evictKey = k; }
    }
    if (evictKey) spaceMemory.delete(evictKey);
  }
  const entry = { turns: [], lastAccess: Date.now() };
  spaceMemory.set(spaceId, entry);
  return entry;
}

function pushTurn(spaceId, role, text, sender = null) {
  const mem = _getOrCreateMemory(spaceId);
  mem.turns.push({ role, sender, text });
  if (mem.turns.length > MEMORY_MAX_TURNS) {
    mem.turns.splice(0, mem.turns.length - MEMORY_MAX_TURNS);
  }
}

/** Returns turns as {role, content} for classifyIntent / rewriteQuery. */
function getHistory(spaceId) {
  const mem = spaceMemory.get(spaceId);
  if (!mem || !mem.turns.length) return [];
  return mem.turns.map((t) => ({ role: t.role, content: t.text }));
}

// iMessage-specific system prompts. iMessage does not render markdown, so Claude
// is instructed to use "• " bullets and plain line breaks instead.
const IM_CHAT_SYSTEM =
  // IT USED TO SAY "WRITE LIKE CLAUDE". Verbatim, on the surface the team
  // actually texts. Whatever it produced after that, it was not Amber -- and this
  // is the one prompt where nobody would notice, because nobody reads the
  // iMessage path in a test.
  //
  // Identity comes from lib/amber-identity.js now, the same block every reply in
  // the app carries, so the agent in a text thread is the same thing as the agent
  // in the app. Only the FORMATTING is iMessage-specific, which is all this
  // constant was ever entitled to add.
  `${AMBER_IDENTITY}\n\n` +
  "THIS SURFACE IS iMESSAGE, which renders no markdown. For multi-part answers " +
  'use "• " bullets: put a blank line before the list, then one bullet per ' +
  "line with a line break between each. Give a good amount of useful info but " +
  "do not overload — stop when you've covered the key points. If the user asks " +
  "for a short or quick answer, keep it brief and skip bullets. Never use " +
  "markdown symbols (**bold**, ##headings, _italic_, etc.) — they appear as " +
  "raw characters in iMessage and look broken.";
const IM_BOTH_SYSTEM =
  `${AMBER_IDENTITY}\n\n` +
  "THIS SURFACE IS iMESSAGE, which renders no markdown. " +
  "The user asked about people in their network and wants help " +
  "approaching them. Relevant ranked contacts are provided. Be specific and " +
  'practical. For multi-part advice use "• " bullets: put a blank line before ' +
  "the list, then one bullet per line. Give useful detail but stay concise. " +
  "Never use markdown symbols (**bold**, ##headings, etc.).";
const IM_WEB_GROUNDING =
  "Current web results are provided. Ground your answer in them and mention " +
  "the source title when relevant. Never use markdown symbols.";
// Sent in a group thread when a network/contact query is detected — contact
// details are never exposed in a group; the user must DM Amber directly.
const PRIVATE_NETWORK_REPLY =
  "That's private to your network — DM me and I'll pull it up.";

// ── Daily-question follow-up taxonomy ────────────────────────────────────
// EDITABLE — replace with team taxonomy. Each {key, description} is injected
// verbatim into the Haiku prompt; editing this array changes behavior with no
// logic change required.
const FOLLOWUP_CATEGORIES = [
  { key: "who",         description: "who they saw or who is involved in their life" },
  { key: "feeling",     description: "their emotional state or how something affected them" },
  { key: "activity",    description: "what they did or are doing" },
  { key: "identity",    description: "who they are, their values, what matters to them" },
  { key: "personality", description: "objective personality-science / MBTI-style training data" },
];

// ── Poll action engine ────────────────────────────────────────────────────
const _ANTHRO_URL = "https://api.anthropic.com/v1/messages";
const _HAIKU = "claude-haiku-4-5-20251001";
const POLL_TTL_MS = 45 * 60 * 1000;
// pollMessageGuid → { optionTextMap, requesterPhone, spaceId, spacePhone, createdAt, resolved }
const pendingPolls = new Map();
let _pollSubStarted = false;
// Sweep expired entries every 5 min so the map doesn't grow unboundedly.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingPolls) if (now - v.createdAt > POLL_TTL_MS) pendingPolls.delete(k);
}, 5 * 60 * 1000).unref?.();

/**
 * Classify whether the message is an explicit "send/text/draft to <person>" request.
 * Returns {isAction:bool, recipientName:string|null, gist:string|null}.
 * Fail-safe: any error → {isAction:false}.
 */
async function extractAction(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { isAction: false };
  try {
    const resp = await fetch(_ANTHRO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: _HAIKU,
        max_tokens: 120,
        system: 'Return ONLY valid JSON: {"isAction":bool,"recipientName":string|null,"gist":string|null}. isAction is true ONLY when the user explicitly asks to send/text/message/draft a message TO a named person.',
        messages: [{ role: "user", content: `Message: "${text}"\nJSON:` }],
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return { isAction: false };
    const raw = (await resp.json()).content?.[0]?.text?.trim() || "{}";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const jsonStr = cleaned.startsWith("{") ? cleaned : cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1) || "{}";
    const parsed = JSON.parse(jsonStr);
    return { isAction: !!parsed.isAction, recipientName: parsed.recipientName || null, gist: parsed.gist || null };
  } catch { return { isAction: false }; }
}

/**
 * Draft a warm ≤2-sentence plain-text outreach message to toName.
 * Fail-safe: returns gist or a bare greeting on error.
 */
async function draftOutreach(toName, gist) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return gist || `Hi ${toName}!`;
  try {
    const resp = await fetch(_ANTHRO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: _HAIKU,
        max_tokens: 150,
        system: `Draft a warm, plain iMessage (no markdown, ≤2 sentences) to ${toName}.${gist ? ` Cover: ${gist}.` : ""} Speak directly; don't mention Amber or that this is a draft.`,
        messages: [{ role: "user", content: "Draft:" }],
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return gist || `Hi ${toName}!`;
    return (await resp.json()).content?.[0]?.text?.trim() || gist || `Hi ${toName}!`;
  } catch { return gist || `Hi ${toName}!`; }
}

// NOTE: chooseFollowup (the daily-question follow-up chooser) was removed with
// the daily-question feature — see the Q&A Phase 1 collision fix
// (db/migrations/20260727_fix_questions_collision.sql). The new Q&A model lives
// in db/questions-store.js + routes/questions.js.

/**
 * Classify an inbound message against an open pending question (which_contact /
 * enrich_detail / new_person_details). Returns { route, extracted }.
 * route is always one of: "answer" | "correction" | "new_topic".
 * Fail-safe to { route: "new_topic" } on any error or API unavailability.
 */
async function routePendingMessage({ questionAsked, awaiting, candidates, userMessage }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { route: "new_topic" };
  try {
    const candidateHint = candidates ? ` The choices presented were: ${candidates}.` : "";
    const resp = await fetch(_ANTHRO_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: _HAIKU,
        max_tokens: 120,
        system:
          `Amber previously asked the user this question: "${questionAsked}".${candidateHint} ` +
          `Classify the user's new message as exactly one of: ` +
          `"answer" (it directly responds to the question — names which person, gives the detail asked), ` +
          `"correction" (it corrects a prior assumption — says no I meant..., or similar), ` +
          `"new_topic" (unrelated to the question). ` +
          `Return ONLY valid JSON: {"route":"answer|correction|new_topic","extracted":"<the salient value if answer or correction, otherwise null>"}.`,
        messages: [{ role: "user", content: `User message: "${userMessage}"\nJSON:` }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { route: "new_topic" };
    const raw = (await resp.json()).content?.[0]?.text?.trim() || "{}";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const jsonStr = cleaned.startsWith("{") ? cleaned : cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1) || "{}";
    const parsed = JSON.parse(jsonStr);
    const validRoutes = new Set(["answer", "correction", "new_topic"]);
    return {
      route: validRoutes.has(parsed.route) ? parsed.route : "new_topic",
      extracted: typeof parsed.extracted === "string" && parsed.extracted ? parsed.extracted.trim() : null,
    };
  } catch { return { route: "new_topic" }; }
}

/** Extract and E.164-normalize a phone number from free text. Returns null if none found. */
function parsePhoneFromText(text) {
  const m = (text || "").match(/[+]?[0-9][0-9\s\-.(]{5,}[0-9]/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return m[0].trim();
}

function isAffirmative(text) {
  return /\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|add|do it|please|absolutely|of course)\b/i.test(text || "");
}

function isNegative(text) {
  return /\b(no|nope|nah|skip|don'?t|never mind|nevermind|forget it|forget that|cancel|stop|pass)\b/i.test(text || "");
}

/** Parse ALLOWED_TEST_NUMBERS="..." → Set of normalized E.164 strings. */
function parseAllowedNumbers() {
  const raw = process.env.ALLOWED_TEST_NUMBERS || "";
  const out = new Set();
  for (const part of raw.split(",")) {
    const e = normalizePhone(part.trim());
    if (e) out.add(e);
  }
  return out;
}

/**
 * Build a compact people context block for the "both" Claude synthesis prompt.
 * Mirrors chat.js's peopleContextBlock without importing it (not exported).
 */
function buildNetworkContext(people, answer) {
  const lines = (people || [])
    .slice(0, 10)
    .map((p, i) => {
      const bits = [`${i + 1}. ${p.name || "Unknown"}`];
      if (p.title) bits.push(p.title);
      if (p.company) bits.push(`@ ${p.company}`);
      const head = bits.join(" ");
      return p.reason ? `${head} — ${p.reason}` : head;
    });
  return (
    (answer ? `Context: ${answer}\n\n` : "") +
    (lines.length ? lines.join("\n") : "(none found)")
  );
}

/**
 * Format the pipeline answer for iMessage:
 *  - Resolve [[p:ID]] citation anchors → contact names
 *  - Drop [1][2] web-citation index brackets
 *  - Strip markdown markers as a safety net (**bold**, *italic*, ## Heading, ---)
 *  - Convert any stray - / * list markers to • (Claude should already use •)
 *  - Ensure a blank line separates an intro sentence from the first bullet
 *  - Preserve intentional line breaks and • bullets the model produces
 *  - Collapse 3+ consecutive newlines to 2 (structure without large gaps)
 *  - For network_query: append compact "Name — reason" list (top 5), each on
 *    its own line with a blank line before the block
 *  - Cap at 1 500 chars
 */
function formatImessageReply(answerText, people, intent) {
  const nameById = new Map(
    (people || [])
      .filter((p) => p?.contactId)
      .map((p) => [String(p.contactId), p.name || "this person"]),
  );

  let text = (answerText || "")
    .replace(/\[\[p:([^\]]+)\]\]/g, (_, id) => nameById.get(id) || "this person")
    .replace(/\[\d+\]/g, "")           // drop [1][2] web-citation indices
    .replace(/\*\*(.+?)\*\*/gs, "$1")  // **bold** → plain (safety net)
    .replace(/\*(.+?)\*/gs, "$1")      // *italic* → plain (safety net)
    .replace(/^#{1,6}\s+/gm, "")       // ## Heading → plain (safety net)
    .replace(/^-{3,}\s*$/gm, "")       // horizontal rules → removed
    .replace(/^[*-]\s+/gm, "• ")       // stray - / * bullets → • (safety net)
    // Ensure a blank line before the first bullet when intro runs straight in.
    .replace(/([^\n])\n(• )/g, "$1\n\n$2")
    // Collapse 3+ newlines to 2 — preserve structure without giant gaps.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) return "";

  // For network_query answers: append a compact "Name — reason" list, each
  // entry on its own line, separated from the answer by a blank line.
  if (intent === "network_query" && (people || []).length > 0) {
    const list = (people || [])
      .slice(0, 5)
      .map((p, i) => {
        const who = [
          p.name || "Unknown",
          p.title,
          p.company ? `@ ${p.company}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return p.reason ? `${i + 1}. ${who} — ${p.reason}` : `${i + 1}. ${who}`;
      })
      .join("\n");
    text = text ? `${text}\n\n${list}` : list;
  }

  // Keep it readable inside an iMessage bubble.
  if (text.length > 1500) text = text.slice(0, 1499).trimEnd() + "…";
  return text;
}

// ── Spectrum singleton ─────────────────────────────────────────────────────
// getSpectrumApp / _resetSpectrumApp / sendPhotonDm are imported from
// ../lib/photon-sender.js so mobile-auth.js can share the same live
// gRPC connection without importing the full webhook router.

/**
 * Send a plain-text reply to a Photon/Spectrum space via the spectrum-ts SDK.
 * Uses the module-level singleton — gRPC connects once and stays alive.
 * On any send error the singleton is reset so the next message re-initializes
 * rather than retrying on a potentially dead connection.
 *
 * Outbound call chain:
 *   getSpectrumApp() → cached Spectrum instance
 *   imessage(app).space.get(spaceId, { phone? })  — im.space is an object, not a function
 *   space.send(text(replyText))
 */
async function sendPhotonReply(spaceId, spacePhone, replyText) {
  const sanitized = (replyText || "").replace(/\s*[—–]\s*/g, ", ");
  const { text: mkText } = await import("spectrum-ts");
  const { imessage } = await import("spectrum-ts/providers/imessage");
  const app = await getSpectrumApp();
  try {
    const im = imessage(app);
    const space = await im.space.get(spaceId, spacePhone ? { phone: spacePhone } : undefined);
    await space.send(mkText(sanitized));
  } catch (err) {
    // Reset on any send error — gRPC may be dead (UNAVAILABLE, CANCELLED,
    // DEADLINE_EXCEEDED, etc.); nulling the cache lets the next message
    // re-initialize rather than repeatedly failing on a dead connection.
    _resetSpectrumApp();
    throw err;
  }
}

/**
 * Send a poll into a space and return {pollMessageGuid, optionTextMap}.
 * optionDefs: [{title:string, role:string, params?:any}]
 * optionTextMap: Map<title, {role, params}> — vote resolution uses option.text
 * because optionIdentifier is server-assigned and not returned by space.send().
 * Resets the singleton on error (same contract as sendPhotonReply/sendPhotonDm).
 */
async function sendPoll(spaceId, spacePhone, title, optionDefs) {
  const { poll: mkPoll } = await import("spectrum-ts");
  const { imessage } = await import("spectrum-ts/providers/imessage");
  const app = await getSpectrumApp();
  try {
    const im = imessage(app);
    const space = await im.space.get(spaceId, spacePhone ? { phone: spacePhone } : undefined);
    const sent = await space.send(mkPoll(title, optionDefs.map((o) => o.title)));
    const pollMessageGuid = sent?.id;
    const optionTextMap = new Map(optionDefs.map((o) => [o.title, { role: o.role, params: o.params }]));
    return { pollMessageGuid, optionTextMap };
  } catch (err) {
    _resetSpectrumApp();
    throw err;
  }
}

/** Store a poll pending action. All paths call this immediately after sendPoll. */
function storePendingPoll(pollMessageGuid, data) {
  if (!pollMessageGuid) return;
  pendingPolls.set(pollMessageGuid, { ...data, createdAt: Date.now(), resolved: false });
}

/**
 * Execute a resolved poll action by role. Every branch is fail-safe.
 */
async function executePollAction(stored, roleInfo, log) {
  const { role, params } = roleInfo;
  const { requesterPhone } = stored;
  const dmSpaceId = `any;-;${requesterPhone}`;

  if (role === "send") {
    let ok = false;
    try {
      await sendPhotonDm(params.toPhone, params.body);
      ok = true;
      await sendPhotonDm(requesterPhone, `Sent to ${params.toName} ✅`).catch(() => {});
      log.info(`PHOTON_ACTION_SEND to=${params.toPhone} ok=true`);
    } catch (err) {
      log.warn(`PHOTON_ACTION_SEND to=${params.toPhone} ok=false err=${err?.message || err}`);
      await sendPhotonDm(requesterPhone,
        `Couldn't reach ${params.toName} on iMessage — here's the draft so you can send it:\n\n${params.body}`,
      ).catch(() => {});
    }
  } else if (role === "edit") {
    await sendPhotonDm(requesterPhone, "What should I change?").catch(() => {});
  } else if (role === "cancel" || role === "dismiss") {
    await sendPhotonDm(requesterPhone, "Okay, scrapped that.").catch(() => {});
  } else if (role === "dm_list") {
    try {
      await sendPhotonDm(requesterPhone, params.fullAnswer);
      pushTurn(dmSpaceId, "assistant", params.fullAnswer);
      log.info(`PHOTON_ACTION_DM_LIST requester=${requesterPhone}`);
    } catch (err) {
      log.warn(`PHOTON_ACTION_DM_LIST err=${err?.message || err}`);
    }
  } else if (role === "draft_intro") {
    try {
      const draft = await draftOutreach(params.name, params.gist || null);
      await sendPhotonDm(requesterPhone, `Draft for ${params.name}:\n"${draft}"`);
      const optionDefs = [
        { title: "Send it", role: "send", params: { toPhone: params.phone, toName: params.name, body: draft } },
        { title: "Edit", role: "edit" },
        { title: "Cancel", role: "cancel" },
      ];
      const pollResult = await sendPoll(dmSpaceId, null, "What would you like to do?", optionDefs);
      if (pollResult?.pollMessageGuid) {
        storePendingPoll(pollResult.pollMessageGuid, {
          optionTextMap: pollResult.optionTextMap,
          requesterPhone,
          spaceId: dmSpaceId,
          spacePhone: null,
        });
        log.info(`PHOTON_POLL_SENT poll=${pollResult.pollMessageGuid} kind=intro space=${dmSpaceId}`);
      }
    } catch (err) {
      log.warn(`PHOTON_ACTION_DRAFT_INTRO err=${err?.message || err}`);
      await sendPhotonDm(requesterPhone, "Couldn't draft the message right now. Try again?").catch(() => {});
    }
  }
}

/**
 * Process an incoming poll vote from the messages subscription.
 * Only the original requester's vote counts (first-wins, no double-fire).
 */
async function handlePollVote({ pollMessageGuid, optionText, actorPhone }, log) {
  const stored = pendingPolls.get(pollMessageGuid);
  if (!stored) return;
  if (Date.now() - stored.createdAt > POLL_TTL_MS || stored.resolved) {
    pendingPolls.delete(pollMessageGuid);
    return;
  }
  const normalized = normalizePhone(actorPhone);
  if (normalized !== stored.requesterPhone) {
    log.info(`PHOTON_POLL_VOTE_FOREIGN poll=${pollMessageGuid} actor=${normalized} expected=${stored.requesterPhone}`);
    return;
  }
  stored.resolved = true;
  pendingPolls.delete(pollMessageGuid);
  const roleInfo = stored.optionTextMap?.get(optionText);
  if (!roleInfo) {
    log.warn(`PHOTON_POLL_VOTE_UNKNOWN_OPTION poll=${pollMessageGuid} option="${optionText}"`);
    return;
  }
  log.info(`PHOTON_POLL_RESOLVED poll=${pollMessageGuid} role=${roleInfo.role}`);
  await executePollAction(stored, roleInfo, log).catch((e) => {
    log.warn(`PHOTON_POLL_EXEC_ERR ${e?.message || e}`);
  });
}

/**
 * Long-lived subscription to the iMessage messages stream, filtering for
 * poll_option votes. Reconnects with exponential backoff (cap 30 s).
 * Poll events arrive on im.messages as {content.type:"poll_option", content.selected,
 * content.poll.pollMessageGuid, content.option.text, sender.id}.
 * Started exactly once at route registration via void startPollSubscription(log).
 */
async function startPollSubscription(log) {
  if (_pollSubStarted) return;
  _pollSubStarted = true;
  const projectId = process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.PHOTON_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    log.info("PHOTON_POLL_SUB_DISABLED — PHOTON_PROJECT_ID/SECRET not set");
    _pollSubStarted = false;
    return;
  }
  void (async () => {
    let backoff = 1000;
    while (true) {
      try {
        const { imessage } = await import("spectrum-ts/providers/imessage");
        const app = await getSpectrumApp();
        const im = imessage(app);
        log.info("PHOTON_POLL_SUB_STARTED");
        for await (const msg of im.messages) {
          try {
            const content = msg?.content;
            if (content?.type !== "poll_option" || !content?.selected) continue;
            const pollMessageGuid = content?.poll?.pollMessageGuid;
            const optionText = content?.option?.text;
            const actorPhone = msg?.sender?.id;
            log.info(`PHOTON_POLL_EVENT type=voted poll=${pollMessageGuid} actor=${actorPhone}`);
            if (!pollMessageGuid || !optionText || !actorPhone) continue;
            await handlePollVote({ pollMessageGuid, optionText, actorPhone }, log);
          } catch (evErr) {
            log.warn(`PHOTON_POLL_EVENT_ERR ${evErr?.message || evErr}`);
          }
        }
        backoff = 1000;
      } catch (err) {
        log.warn(`PHOTON_POLL_SUB_ERR ${err?.message || err} — reconnect in ${backoff}ms`);
        _resetSpectrumApp();
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  })();
}

/**
 * Build an Anthropic messages array that prepends recent history turns before
 * the current user message. Ensures the array starts with a "user" role as
 * Anthropic requires.
 */
function buildMsgsWithHistory(history, userContent) {
  const msgs = (history || []).map((h) => ({ role: h.role, content: h.content }));
  msgs.push({ role: "user", content: userContent });
  while (msgs.length > 1 && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

/**
 * DOES THIS NUMBER GET TO BE THIS ACCOUNT?
 *
 * Lifted out of handleInbound and exported so it can be tested, because it is
 * the one decision in this file where being wrong is not a bug report -- it is
 * somebody reading a stranger's contacts. The pure half lives in
 * lib/imessage-link.js; this is the half that touches the store and the wire,
 * and the two failure modes worth pinning are both here rather than there:
 * a store outage must not read as "admitted", and a refusal must not be
 * repeated on every message forever.
 *
 * @returns {Promise<{user: object|null}|null>} null means stop; do not handle.
 */
export async function admitDmSender({ senderE164, spaceId, spacePhone, log }, deps = {}) {
  const lookup = deps.getUserByPhone || getUserByPhone;
  const enroll = deps.enrollImessageUser || enrollImessageUser;
  const reply = deps.sendReply || sendPhotonReply;
  const told = deps.told || linkToldSpaces;

  // The lookup runs BEFORE the verdict because the verdict depends on the row.
  // A store that is down yields no row, which reads as a new number and
  // enrolls -- so an outage costs a duplicate account, never an open door.
  let user = await lookup(senderE164).catch(() => null);
  const verdict = dmAdmission({
    user,
    senderE164,
    dmOpen: deps.dmOpen ?? process.env.DM_ENROLLMENT_OPEN === "true",
    allowlist: deps.allowlist || parseAllowedNumbers(),
  });

  if (verdict.action === "reject") {
    log?.info?.(`PHOTON_UNAUTHORIZED_SENDER sender=${senderE164} space=${spaceId} reason=${verdict.reason}`);
    return null;
  }

  if (verdict.action === "link") {
    // Told once per space per process. Silence here would be a broken product
    // -- they signed up, were shown this number, and texted it -- but repeating
    // it on every message turns a security gate into a spammer.
    log?.info?.(`PHOTON_LINK_REQUIRED sender=${senderE164} space=${spaceId} reason=${verdict.reason}`);
    if (!told.has(spaceId)) {
      if (told.size >= LINK_TOLD_MAX) told.clear();
      told.add(spaceId);
      await reply(spaceId, spacePhone, LINK_INSTRUCTION).catch(() => {});
    }
    return null;
  }

  if (verdict.action === "enroll") {
    user = await enroll({ phone: senderE164 }).catch(() => null);
    if (user?.amber_id) log?.info?.(`PHOTON_ENROLL_NEW phone=${senderE164} ownerId=${user.amber_id}`);
  }

  return { user };
}

/** Test seam: the told-once set is process state and a test must be able to clear it. */
export function _resetLinkToldForTests() {
  linkToldSpaces.clear();
}

/**
 * Fire-and-forget handler: runs AFTER the 200 ACK is already sent.
 * Receives the parsed request body and a pino logger (request.log). Never throws.
 */
async function handleInbound(body, log) {
  try {
    const spaceType = body?.space?.type;
    // Handle DMs and group chats; drop anything else (e.g. unknown future types).
    if (spaceType !== "dm" && spaceType !== "group") return;

    const spaceId = body?.space?.id;
    const spacePhone = body?.space?.phone || null;
    const senderPhone = body?.message?.sender?.id;
    const messageText =
      typeof body?.message?.content?.text === "string"
        ? body.message.content.text.trim()
        : null;
    if (!spaceId || !senderPhone || !messageText) return;

    const senderE164 = normalizePhone(senderPhone);

    if (spaceType === "group") {
      // Always capture group messages into working memory — even if Amber is
      // not mentioned — so context is available when she is invoked later.
      pushTurn(spaceId, "user", messageText, senderE164);

      // Groups require a wake-word to respond.
      const invoked = /\bamber\b/i.test(messageText);
      if (!invoked) {
        log.info(`PHOTON_GROUP_CAPTURE_ONLY space=${spaceId} sender=${senderE164}`);
        return;
      }
      log.info(`PHOTON_GROUP_INVOKED space=${spaceId} sender=${senderE164}`);

      // Allowlist still gates who gets a reply in group chats.
      const allowedNumbers = parseAllowedNumbers();
      if (!allowedNumbers.has(senderE164)) {
        log.info(`PHOTON_UNAUTHORIZED_SENDER sender=${senderE164} space=${spaceId}`);
        return;
      }
    }

    // ── DM: does this number get to be this account? ──────────────────────
    //
    // A PHONE NUMBER ON AN INBOUND TEXT IS A CLAIM. Everything below keys off
    // ownerId -- the contact graph, the notes, the research, the write paths --
    // and before this gate the only thing standing between a string in a
    // webhook body and all of it was DM_ENROLLMENT_OPEN being false. The
    // account owner now has to have armed this channel from a signed-in app
    // session before an inbound text can drive their account. See
    // lib/imessage-link.js for why that is consent rather than verification,
    // and why it is the part we can actually establish. admitDmSender is where
    // the store lookup, the verdict and the told-once reply live.
    let ownerId = null;
    let user = null;
    if (spaceType === "dm") {
      const admitted = await admitDmSender({ senderE164, spaceId, spacePhone, log });
      if (!admitted) return;
      user = admitted.user;

      // Admitted: only now does the message enter working memory. Turning this
      // around -- capturing first, deciding after -- would put a rejected
      // sender's words into a space transcript that a later, admitted message
      // in the same space reads back as context.
      pushTurn(spaceId, "user", messageText, senderE164);

      ownerId = user?.amber_id || null;
      log.info(`PHOTON_USER_RESOLVED ownerId=${ownerId || "none"} status=${user?.status || "none"}`);
      if (ownerId) {
        appendMessage({ ownerId, spaceId, role: "user", sender: senderE164, text: messageText });
      }

      // ── Enrollment state machine (awaiting_name users) ───────────────────
      // State is derived from persisted DB history so it survives redeploys.
      // State 1 (no prior assistant turn): ask for name.
      // State 2 (assistant turn exists): treat this message as their name.
      if (ownerId && user?.status === "awaiting_name") {
        const enrollHistory = await loadRecentMessages(ownerId, spaceId, 4).catch(() => []);
        const alreadyAsked = enrollHistory.some((t) => t.role === "assistant");

        if (!alreadyAsked) {
          const ask = "Hey! I'm Amber 😊 What's your name?";
          await sendPhotonReply(spaceId, spacePhone, ask).catch(() => {});
          pushTurn(spaceId, "assistant", ask);
          appendMessage({ ownerId, spaceId, role: "assistant", sender: null, text: ask });
          log.info(`PHOTON_ENROLL_ASKED space=${spaceId} ownerId=${ownerId}`);
          return;
        }

        // Treat this message as the user's name.
        let name = messageText.trim();
        name = name.replace(/^(i'm|my name is|this is)\s+/i, "").trim();
        if (!name || name.length > 50) name = messageText.trim();
        await setUserName(ownerId, name).catch(() => {});
        const welcome =
          `Love it — so nice to meet you, ${name}! I'm Amber, here whenever you want to talk, ` +
          `ask anything, or think something through. What's on your mind?`;
        await sendPhotonReply(spaceId, spacePhone, welcome).catch(() => {});
        pushTurn(spaceId, "assistant", welcome);
        appendMessage({ ownerId, spaceId, role: "assistant", sender: null, text: welcome });
        log.info(`PHOTON_ENROLL_ACTIVATED ownerId=${ownerId} name="${name}"`);
        return;
      }
    }

    // ── TESTPOLL scaffold (throwaway) ──────────────────────────────────────
    // DM only: send a poll so we can capture the tap-response payload format.
    // Remove once the poll event shape is confirmed from logs.
    if (spaceType === "dm" && messageText.trim().toLowerCase() === "testpoll") {
      const { poll: mkPoll } = await import("spectrum-ts");
      const { imessage } = await import("spectrum-ts/providers/imessage");
      const app = await getSpectrumApp();
      const im = imessage(app);
      const space = await im.space.get(spaceId, spacePhone ? { phone: spacePhone } : undefined);
      await space.send(mkPoll("Pick one", ["Send it", "Edit", "Cancel"]));
      log.info(`PHOTON_TESTPOLL_SENT space=${spaceId}`);
      return;
    }

    // ── Explicit send/draft action detection (DM only) ────────────────────
    // Intercept "send/text/draft to <person>" requests before the normal pipeline.
    if (spaceType === "dm") {
      if (ownerId) {
        const action = await extractAction(messageText).catch(() => ({ isAction: false }));
        if (action.isAction && action.recipientName) {
          const allContacts = await loadContactsByOwnerId(ownerId);
          const q = action.recipientName.toLowerCase();
          const matches = allContacts.filter((c) =>
            (c.name || "").toLowerCase().includes(q) ||
            (c.name || "").toLowerCase().split(" ")[0] === q,
          );
          if (matches.length === 0) {
            const rep = `I don't have a contact for "${action.recipientName}".`;
            await sendPhotonReply(spaceId, spacePhone, rep).catch(() => {});
            pushTurn(spaceId, "assistant", rep);
            return;
          }
          if (matches.length >= 2) {
            const list = matches.slice(0, 5).map((m, i) => `${i + 1}. ${m.name}`).join("\n");
            const rep = `I found a few matches for "${action.recipientName}":\n${list}\n\nWhich one?`;
            await sendPhotonReply(spaceId, spacePhone, rep).catch(() => {});
            pushTurn(spaceId, "assistant", rep);
            return;
          }
          const contact = matches[0];
          if (!contact.phone) {
            const rep = `I have ${contact.name} in your contacts but no phone number for them.`;
            await sendPhotonReply(spaceId, spacePhone, rep).catch(() => {});
            pushTurn(spaceId, "assistant", rep);
            return;
          }
          const draft = await draftOutreach(contact.name, action.gist)
            .catch(() => action.gist || `Hi ${contact.name}!`);
          const preview = `Draft for ${contact.name}:\n"${draft}"`;
          await sendPhotonReply(spaceId, spacePhone, preview).catch(() => {});
          pushTurn(spaceId, "assistant", preview);
          const optionDefs = [
            { title: "Send it", role: "send", params: { toPhone: contact.phone, toName: contact.name, body: draft } },
            { title: "Edit", role: "edit" },
            { title: "Cancel", role: "cancel" },
          ];
          const pollResult = await sendPoll(spaceId, spacePhone, "What would you like to do?", optionDefs)
            .catch((e) => { log.warn(`PHOTON_POLL_ERR ${e?.message || e}`); return null; });
          if (pollResult?.pollMessageGuid) {
            storePendingPoll(pollResult.pollMessageGuid, {
              optionTextMap: pollResult.optionTextMap,
              requesterPhone: senderE164,
              spaceId,
              spacePhone,
            });
            log.info(`PHOTON_POLL_SENT poll=${pollResult.pollMessageGuid} kind=send space=${spaceId}`);
          }
          return; // skip normal pipeline
        }
      }
    }

    // Recent turns give the pipeline context for follow-up references.
    // DMs use DB-backed history when the owner is resolved; groups stay in-memory.
    const history = (spaceType === "dm" && ownerId)
      ? await loadRecentMessages(ownerId, spaceId, 12).catch(() => [])
      : getHistory(spaceId);

    // ── Daily-question answer capture REMOVED (Q&A Phase 1 collision fix) ──
    // The daily-question feature (legacy `questions`/`question_deliveries`
    // tables) was stripped. Inbound DMs now fall straight through to the
    // pending-fact routing + chat pipeline below — core handling unchanged.

    // ── Pending-fact context routing (BEFORE chat pipeline) ───────────────
    // Must run before classifyIntent so a pending-answer is never also answered
    // by the chat LLM. Owner-scoped on per-message ownerId. Fail-safe.
    // _resurfaceQuestion: if set (2a), this is appended inline to the single
    // outbound reply so the dodged question resurfaces naturally.
    let _resurfaceQuestion = null;
    if (spaceType === "dm" && ownerId) {
      let pendingCtx = null;
      try { pendingCtx = await getPendingFactContext(ownerId); } catch { /* fail-safe */ }
      if (pendingCtx) {

        // ── await_new_phone: parse phone directly — no Haiku classification ──
        if (pendingCtx.awaiting === "await_new_phone") {
          const parsedPhone = parsePhoneFromText(messageText);
          const phoneSkip = !parsedPhone && isNegative(messageText);
          if (parsedPhone || phoneSkip) {
            try {
              const newContact = await createContactForOwner({
                ownerId,
                ownerPhone: senderE164,
                fullName: pendingCtx.raw_name,
                phonePrimary: parsedPhone ?? null,
                source: "imessage_addcontact",
              });
              if (newContact?.id && pendingCtx.fact_id) {
                await updateFactContact({ factId: pendingCtx.fact_id, contactId: newContact.id, status: "resolved", ownerId });
              }
              await clearPendingFactContext(ownerId);
              const ack = parsedPhone
                ? `Added ${pendingCtx.raw_name} with their number, and I'll remember that about them.`
                : `No problem, added ${pendingCtx.raw_name} without a number for now, and I'll remember that about them.`;
              log.info(`PHOTON_FACT_NEWCONTACT owner=${ownerId} contact=${newContact?.id || "null"} phone=${parsedPhone ? "yes" : "no"}`);
              await sendPhotonReply(spaceId, spacePhone, ack).catch(() => {});
            } catch (e) {
              log.error(`PHOTON_FACT_ROUTE_ERR owner=${ownerId} ${e?.stack || e?.message || e}`);
            }
            return;
          }
          // Neither phone nor clear skip → 2a resurface for await_new_phone too
          const rn0 = pendingCtx.reask_count ?? 0;
          if (rn0 >= 1) {
            try { await clearPendingFactContext(ownerId); } catch { /* fail-safe */ }
            log.info(`PHOTON_FACT_RESURFACE_DROPPED owner=${ownerId} awaiting=await_new_phone`);
          } else {
            await setPendingFactContext({
              ownerId, awaiting: "await_new_phone", factId: pendingCtx.fact_id,
              rawName: pendingCtx.raw_name, questionAsked: pendingCtx.question_asked,
              candidates: pendingCtx.candidates ?? "", reaskCount: 1,
            }).catch(() => {});
            _resurfaceQuestion = pendingCtx.question_asked;
            log.info(`PHOTON_FACT_RESURFACE owner=${ownerId} awaiting=await_new_phone reask=1`);
          }

        } else {
          // ── which_contact / new_person_details / enrich_detail ──────────────
          const route = await routePendingMessage({
            questionAsked: pendingCtx.question_asked,
            awaiting: pendingCtx.awaiting,
            candidates: pendingCtx.candidates,
            userMessage: messageText,
          });
          log.info(`PHOTON_FACT_ROUTE owner=${ownerId} awaiting=${pendingCtx.awaiting} route=${route.route}`);

          if (route.route === "answer" || route.route === "correction") {
            try {
              if (pendingCtx.awaiting === "which_contact") {
                const factContacts = await getContactsForResolution(ownerId);
                const resolution = resolveContactByName(route.extracted || pendingCtx.raw_name, factContacts);
                if (resolution.status === "resolved") {
                  await updateFactContact({ factId: pendingCtx.fact_id, contactId: resolution.contactId, status: "resolved", ownerId });
                  await clearPendingFactContext(ownerId);
                  log.info(`PHOTON_FACT_RESOLVED owner=${ownerId} contact=${resolution.contactId} factId=${pendingCtx.fact_id}`);
                  await sendPhotonReply(spaceId, spacePhone,
                    `Got it, that's ${resolution.matchedName || route.extracted}. I'll remember that about them.`
                  ).catch(() => {});
                } else {
                  const top = (pendingCtx.candidates || "").split(",").filter(Boolean).slice(0, 2);
                  const reAsk = top.length >= 2
                    ? `Which ${pendingCtx.raw_name} do you mean, ${top[0]} or ${top[1]}?`
                    : `Which ${pendingCtx.raw_name} did you mean?`;
                  await setPendingFactContext({
                    ownerId, awaiting: "which_contact", factId: pendingCtx.fact_id,
                    rawName: pendingCtx.raw_name, questionAsked: reAsk,
                    candidates: pendingCtx.candidates, reaskCount: 0,
                  });
                  log.info(`PHOTON_FACT_STILL_AMBIGUOUS owner=${ownerId} name=${pendingCtx.raw_name}`);
                  await sendPhotonReply(spaceId, spacePhone, reAsk).catch(() => {});
                }
              } else if (pendingCtx.awaiting === "new_person_details") {
                const txt = route.extracted || messageText;
                if (isAffirmative(txt)) {
                  const q = `What's their number? (Or say skip and I'll add ${pendingCtx.raw_name} without one.)`;
                  await setPendingFactContext({
                    ownerId, awaiting: "await_new_phone", factId: pendingCtx.fact_id,
                    rawName: pendingCtx.raw_name, questionAsked: q, candidates: "", reaskCount: 0,
                  });
                  log.info(`PHOTON_FACT_AWAIT_PHONE owner=${ownerId} name=${pendingCtx.raw_name}`);
                  await sendPhotonReply(spaceId, spacePhone, q).catch(() => {});
                } else {
                  // Negative or unclear — clear pending; fact stays pending_contact
                  await clearPendingFactContext(ownerId);
                  log.info(`PHOTON_FACT_ADDCONTACT_DECLINED owner=${ownerId} name=${pendingCtx.raw_name}`);
                  await sendPhotonReply(spaceId, spacePhone, "Got it, no worries.").catch(() => {});
                }
              } else if (pendingCtx.awaiting === "enrich_detail") {
                await appendFactDetail({ factId: pendingCtx.fact_id, extraText: route.extracted || messageText, ownerId });
                await clearPendingFactContext(ownerId);
                log.info(`PHOTON_FACT_ENRICHED owner=${ownerId} factId=${pendingCtx.fact_id}`);
                await sendPhotonReply(spaceId, spacePhone, "Got it, noted!").catch(() => {});
              }
            } catch (e) {
              log.error(`PHOTON_FACT_ROUTE_ERR owner=${ownerId} ${e?.stack || e?.message || e}`);
            }
            return; // message fully consumed — do not run chat pipeline
          }

          // new_topic → 2a resurface for which_contact and new_person_details
          const _resurfStates = new Set(["which_contact", "new_person_details"]);
          if (_resurfStates.has(pendingCtx.awaiting)) {
            const rn1 = pendingCtx.reask_count ?? 0;
            if (rn1 >= 1) {
              try { await clearPendingFactContext(ownerId); } catch { /* fail-safe */ }
              log.info(`PHOTON_FACT_RESURFACE_DROPPED owner=${ownerId} awaiting=${pendingCtx.awaiting}`);
            } else {
              await setPendingFactContext({
                ownerId, awaiting: pendingCtx.awaiting, factId: pendingCtx.fact_id,
                rawName: pendingCtx.raw_name, questionAsked: pendingCtx.question_asked,
                candidates: pendingCtx.candidates ?? "", reaskCount: 1,
              }).catch(() => {});
              _resurfaceQuestion = pendingCtx.question_asked;
              log.info(`PHOTON_FACT_RESURFACE owner=${ownerId} awaiting=${pendingCtx.awaiting} reask=1`);
            }
          } else {
            // enrich_detail: clear on new_topic, no resurface
            try { await clearPendingFactContext(ownerId); } catch { /* fail-safe */ }
            log.info(`PHOTON_FACT_CONTEXT_DROPPED owner=${ownerId} reason=new_topic`);
          }
        }
      }
    }

    // ── Full chat pipeline ─────────────────────────────────────────────────
    // For DMs: intent classification and fact extraction run in parallel.
    // Ambiguous/no-match facts send ONLY the clarifying question and skip the
    // chat reply. Confident facts are written silently after the chat reply.
    const contextPromise = spaceType === "dm" && ownerId
      ? loadImessageContext(ownerId, messageText).catch(() => ({profile:null,block:"Account context is temporarily unavailable. Say so rather than inventing details."}))
      : Promise.resolve({profile:null,block:""});
    let _freshFact = null;
    let _freshResolution = null;
    const [{ intent, needsWeb }] = await Promise.all([
      classifyIntent({ message: messageText, history })
        .catch(() => ({ intent: "chat", needsWeb: false })),
      (spaceType === "dm" && ownerId)
        ? extractContactFact({ message: messageText })
            .then(async (r) => {
              if (!r?.fact) return;
              _freshFact = r;
              const fc = await getContactsForResolution(ownerId);
              _freshResolution = resolveContactByName(r.name, fc);
            })
            .catch(() => {})
        : Promise.resolve(),
    ]);
    log.info(`PHOTON_INTENT intent=${intent} needsWeb=${needsWeb}`);
    if (_freshFact) log.info(`PHOTON_FACT_EXTRACTED owner=${ownerId} hasFact=true name=${_freshFact.name || "none"}`);

    // ── Fresh-fact routing: ambiguous / no-match → ONE reply (fact question) ─
    if (_freshFact && _freshResolution) {
      if (_freshResolution.status === "ambiguous") {
        const _frow = await insertContactFact({
          ownerId, contactId: null, rawName: _freshFact.name,
          factText: _freshFact.fact, category: _freshFact.category,
          source: "imessage_dm", sourceRef: spaceId, status: "pending",
        });
        const _fid = _frow?.id ?? null;
        const _top = _freshResolution.candidates.slice(0, 2);
        const _ask = `Which ${_freshFact.name} do you mean, ${_top.join(" or ")}?`;
        log.info(`PHOTON_FACT_PENDING owner=${ownerId} name=${_freshFact.name} reason=ambiguous factId=${_fid}`);
        if (_fid) {
          await setPendingFactContext({
            ownerId, awaiting: "which_contact", factId: _fid,
            rawName: _freshFact.name, questionAsked: _ask,
            candidates: _freshResolution.candidates.join(","),
          });
        }
        await sendPhotonReply(spaceId, spacePhone, _resurfaceQuestion ? `${_ask}\n\nBefore we forget, ${_resurfaceQuestion}` : _ask).catch(() => {});
        return;
      } else if (_freshResolution.status === "none") {
        const _frow = await insertContactFact({
          ownerId, contactId: null, rawName: _freshFact.name,
          factText: _freshFact.fact, category: _freshFact.category,
          source: "imessage_dm", sourceRef: spaceId, status: "pending",
        });
        const _fid = _frow?.id ?? null;
        const _ask = `I don't think I have ${_freshFact.name} yet. Want me to add them as a contact?`;
        log.info(`PHOTON_FACT_PENDING owner=${ownerId} name=${_freshFact.name} reason=nomatch factId=${_fid}`);
        if (_fid) {
          await setPendingFactContext({
            ownerId, awaiting: "new_person_details", factId: _fid,
            rawName: _freshFact.name, questionAsked: _ask, candidates: "",
          });
        }
        await sendPhotonReply(spaceId, spacePhone, _resurfaceQuestion ? `${_ask}\n\nBefore we forget, ${_resurfaceQuestion}` : _ask).catch(() => {});
        return;
      }
      // status "resolved": write after the chat reply below, no outbound ack
    }

    const accountContext = await contextPromise;
    let answerText = "";
    let answerPeople = [];

    // ── Network branch (network_query or both) ──────────────────────────────
    if (intent === "network_query" || intent === "both") {
      if (!ownerId) {
        log.warn(`PHOTON_NET_NO_OWNER space=${spaceId} — cannot load contacts without a resolved owner`);
        await sendPhotonReply(spaceId, spacePhone, "I'm still getting set up for you, try again in a moment.").catch(() => {});
        return;
      }
      const refinedQuery = await rewriteQuery({ message: messageText, history }).catch(() => messageText);
      const raw = await loadContactsByOwnerId(ownerId);
      log.info(`PHOTON_NET raw=${raw.length}`);
      if (raw.length > 0) {
        const { kept } = filterRealContacts(raw);
        const realContacts = kept.length > 0 ? kept : raw;
        const { contacts } = dedupeContacts(realContacts);
        log.info(`PHOTON_NET deduped=${contacts.length}`);
        const rank = await rankViaTogariSearch({ query: refinedQuery, limit: 15, contacts, me: accountContext.profile }).catch((e) => { log.warn(`PHOTON_RANK_ERR ${e?.message||e}`); return null; });
        log.info(`PHOTON_NET ranked=${rank?.people?.length || 0}`);
        if (rank?.people?.length > 0) {
          answerPeople = rank.people;
          if (intent === "network_query") {
            answerText = rank.answer || "";
          } else {
            answerText = await streamChat({
              system: IM_BOTH_SYSTEM + "\n\n" + accountContext.block,
              messages: buildMsgsWithHistory(history,
                `${buildNetworkContext(answerPeople, rank.answer)}\n\n` +
                `My request: ${messageText}\n\n` +
                `Help with both who to contact and how to approach them.`,
              ),
              onToken: () => {},
            }).catch((e) => { log.warn(`PHOTON_STREAM_ERR ${e?.message || e}`); return ""; });
          }
        }
      }
    }

    // ── Chat branch (chat intent, or fallback when network returned nothing) ─
    if (intent === "chat" || !answerText) {
      let webBlock = "";
      if (needsWeb) {
        const results = await exaSearch({ query: messageText }).catch(() => []);
        if (results.length > 0) {
          webBlock = results
            .slice(0, 5)
            .map((r, i) => `[${i + 1}] ${r.title || ""}: ${(r.text || "").slice(0, 500)}`)
            .join("\n");
        }
      }
      const userMsg = webBlock ? `${webBlock}\n\n${messageText}` : messageText;
      answerText = await streamChat({
        system: (webBlock ? `${IM_CHAT_SYSTEM} ${IM_WEB_GROUNDING}` : IM_CHAT_SYSTEM) + "\n\n" + accountContext.block,
        messages: buildMsgsWithHistory(history, userMsg),
        onToken: () => {},
      }).catch((e) => { log.warn(`PHOTON_STREAM_ERR ${e?.message || e}`); return ""; });
    }

    // ── Format for iMessage and send ──────────────────────────────────────
    const replyText =
      formatImessageReply(answerText, answerPeople, intent) ||
      "I couldn't get an answer right now. Please try again.";

    if (spaceType === "group" && (intent === "network_query" || intent === "both")) {
      // Post a poll in the group offering to DM the list — no contact data exposed in group.
      const optionDefs = [
        { title: "DM me the list", role: "dm_list", params: { fullAnswer: replyText } },
        { title: "No", role: "dismiss" },
      ];
      try {
        const pollResult = await sendPoll(spaceId, spacePhone, "Want these? I'll DM them to you.", optionDefs);
        if (pollResult?.pollMessageGuid) {
          storePendingPoll(pollResult.pollMessageGuid, {
            optionTextMap: pollResult.optionTextMap,
            requesterPhone: senderE164,
            spaceId,
            spacePhone,
          });
          pushTurn(spaceId, "assistant", "[contact poll sent]");
          log.info(`PHOTON_POLL_SENT poll=${pollResult.pollMessageGuid} kind=dmlist space=${spaceId}`);
        }
      } catch (pollErr) {
        log.warn(`PHOTON_GROUP_POLL_FAILED err=${pollErr?.message || pollErr}`);
        // Fall back: DM directly, then nudge in group.
        try {
          const dmSpaceId = await sendPhotonDm(senderE164, replyText);
          pushTurn(dmSpaceId, "user", messageText, senderE164);
          pushTurn(dmSpaceId, "assistant", replyText);
          const groupNudge = "Sent you a DM 👍";
          await sendPhotonReply(spaceId, spacePhone, groupNudge).catch(() => {});
          pushTurn(spaceId, "assistant", groupNudge);
          log.info(`PHOTON_GROUP_PRIVATE_DM_FALLBACK space=${spaceId} dm=${dmSpaceId}`);
        } catch (dmErr) {
          log.warn(`PHOTON_GROUP_DM_FALLBACK_FAILED err=${dmErr?.message || dmErr}`);
          await sendPhotonReply(spaceId, spacePhone, PRIVATE_NETWORK_REPLY).catch(() => {});
          pushTurn(spaceId, "assistant", PRIVATE_NETWORK_REPLY);
        }
      }
    } else {
      const _outReply = _resurfaceQuestion ? `${replyText}\n\nBefore we forget, ${_resurfaceQuestion}` : replyText;
      await sendPhotonReply(spaceId, spacePhone, _outReply);
      pushTurn(spaceId, "assistant", _outReply);
      if (spaceType === "dm" && ownerId) {
        appendMessage({ ownerId, spaceId, role: "assistant", sender: null, text: _outReply });
      }
      log.info(`PHOTON_REPLY_SENT space=${spaceId} intent=${intent} chars=${_outReply.length}`);

      // ── Silently write a confident fact (no outbound ack) ─────────────────
      if (_freshFact && _freshResolution?.status === "resolved") {
        await insertContactFact({
          ownerId, contactId: _freshResolution.contactId,
          factText: _freshFact.fact, category: _freshFact.category,
          source: "imessage_dm", sourceRef: spaceId,
          rawName: _freshFact.name, status: "resolved",
        }).catch(() => {});
        log.info(`PHOTON_FACT_WRITE owner=${ownerId} contact=${_freshResolution.contactId} category=${_freshFact.category}`);
      }

      // ── DM suggestion poll: offer to draft an intro to top ranked contacts ──
      if (spaceType === "dm" && (intent === "network_query" || intent === "both") && answerPeople.length > 0) {
        const pollablePeople = answerPeople.filter((p) => p.phone).slice(0, 3);
        if (pollablePeople.length > 0) {
          const optionDefs = [
            ...pollablePeople.map((p) => ({
              title: `Draft a note to ${(p.name || "this person").split(" ")[0]}`,
              role: "draft_intro",
              params: { name: p.name || "this person", phone: p.phone },
            })),
            { title: "No thanks", role: "dismiss" },
          ];
          const pollResult = await sendPoll(spaceId, spacePhone, "Want me to reach out to anyone?", optionDefs)
            .catch((e) => { log.warn(`PHOTON_POLL_ERR ${e?.message || e}`); return null; });
          if (pollResult?.pollMessageGuid) {
            storePendingPoll(pollResult.pollMessageGuid, {
              optionTextMap: pollResult.optionTextMap,
              requesterPhone: senderE164,
              spaceId,
              spacePhone,
            });
            log.info(`PHOTON_POLL_SENT poll=${pollResult.pollMessageGuid} kind=intro space=${spaceId}`);
          }
        }
      }
    }
  } catch (err) {
    // Silent — we already ACKed 200. Log the error but never surface to the caller.
    log.warn(`PHOTON_ASYNC_ERROR: ${err?.message || err}`);
  }
}

export function registerPhotonWebhookRoutes(app) {
  // GET: Photon URL verification / health check. Always 200.
  app.get("/webhooks/photon/inbound", async (_request, reply) => {
    reply.send({ ok: true });
  });

  // POST: capture + (for allowlisted senders) answer + reply. Never throws; always 200 fast.
  app.post("/webhooks/photon/inbound", async (request, reply) => {
    try {
      // ── Interim shared-secret guard ───────────────────────────────────────
      const expected = process.env.PHOTON_WEBHOOK_SECRET;
      const provided =
        request.query?.key || request.headers["x-photon-key"] || null;
      if (!expected || typeof provided !== "string" || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      // Never log headers, callback URLs, or message bodies: they include
      // webhook credentials and private relationship data.
      request.log.info({event:"photon_inbound",spaceType:request.body?.space?.type === "dm" ? "dm" : "other"});

      // ── Dedupe on message.id ──────────────────────────────────────────────
      const msgId = request.body?.message?.id;
      if (msgId) {
        if (seenIds.has(msgId)) {
          return reply.send({ ok: true }); // already processing this message
        }
        if (seenIds.size >= SEEN_IDS_MAX) seenIds.clear(); // simple rotation
        seenIds.add(msgId);
      }

      // ── Fire-and-forget: answer + reply runs AFTER the 200 ACK ───────────
      void handleInbound(request.body, request.log);
    } catch (err) {
      // Never let capture or setup errors break the 200 path.
      try {
        request.log.warn(
          `PHOTON_INBOUND_CAPTURE error: ${err?.message || err}`,
        );
      } catch {
        // ignore
      }
    }
    return reply.send({ ok: true });
  });

  // DISABLED: the daily-question feature was stripped in the Q&A Phase 1
  // collision fix (its legacy `questions`/`question_deliveries` tables were
  // dropped). The route stays registered but returns 410 so any scheduler
  // still calling it fails loud + harmlessly instead of hitting dropped tables.
  app.post("/internal/daily-question/send", async (request, reply) => {
    return reply.code(410).send({ error: "daily_questions_disabled" });
  });

  // Start long-lived poll-vote subscription. Safe to call multiple times — guarded by _pollSubStarted.
  void startPollSubscription(app.log);
}
