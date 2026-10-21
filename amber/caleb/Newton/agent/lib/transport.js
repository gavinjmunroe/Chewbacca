/**
 * Transport layer: Loop Message (iMessage) and Twilio (SMS).
 * Handles sending messages, tapbacks, progress updates, typing indicators,
 * read receipts, delivery status polling, voice notes, and vCard attachments.
 *
 * Loop Message API reference: https://docs.loopmessage.com/
 */

import { createHash } from "crypto";
import { TRANSPORT, LOOP_API_KEY, LOOP_SECRET_KEY } from "./constants.js";
import { tryCaptureReply } from "./reply-capture.js";
import { renderForIMessage } from "./safety.js";
import { guardOutbound } from "./voice-guard.js";
import { markSeen } from "./idempotency.js";
import { sendSlackReply } from "./transports/slack/responder.js";
import { getSession as getSlackSession } from "./transports/slack/session.js";
import { decideSlackThreadTs } from "./transports/slack/threading.js";
import { ingestMessageEvent } from "./amber-id-ingest.js";

// ── Outbound cross-tenant audit ───────────────────────────────────────────
//
// PR-I belt-and-suspenders. Every sendMessage logs a structured
// `[outbound-audit]` line; sends whose recipient matches neither the
// resolved tenant owner phone nor the inbound webhook contact for the
// current turn escalate to a `[outbound-audit][cross-tenant]` WARN. A
// per-minute counter on cross-tenant sends fires a single
// `[outbound-audit][alert]` ERROR if 5+ trip in any rolling 60 s window.
//
// Origin tagging is opportunistic: callers stamp `opts.auditOrigin` with
// one of "webhook" | "scheduled" | "reminder" | "rave-master" | "admin"
// | "reflection". An untagged send logs as `origin=unknown` and is the
// canary for any code path that bypassed the conventional tagging.
//
// `opts.webhookContact` is the optional inbound `from` phone for the
// turn that triggered this send. agent.js stamps it so the audit can
// distinguish "we replied to the same human who texted us" from "we
// sent a message to a phone unrelated to the current tenant context".
const outboundAuditState = {
  crossTenantTimestamps: [],
  lastAlertAt: 0,
};

function normalizeForCompare(value) {
  if (!value) return "";
  return String(value)
    .replace(/[^\d+]/g, "")
    .trim();
}

export function _resetOutboundAuditState() {
  outboundAuditState.crossTenantTimestamps = [];
  outboundAuditState.lastAlertAt = 0;
}

function recordOutboundAudit({ to, opts }) {
  const now = Date.now();
  const tenant = opts?.tenant || null;
  const tenantPhone = tenant?.phoneNumber || null;
  const tenantDid = tenant?.id || tenant?.privyDid || tenant?.did || null;
  const senderId = tenant?.loopSenderId || null;
  const webhookContact = opts?.webhookContact || null;
  const origin = opts?.auditOrigin || "unknown";

  const normTo = normalizeForCompare(to);
  const normTenant = normalizeForCompare(tenantPhone);
  const normWebhook = normalizeForCompare(webhookContact);

  const matchOwner = !!normTo && normTo === normTenant;
  const matchWebhookContact =
    !!normTo && !!normWebhook && normTo === normWebhook;

  const line = [
    "[outbound-audit]",
    `ts=${new Date(now).toISOString()}`,
    `sender=${senderId || "-"}`,
    `to=${to || "-"}`,
    `tenant_phone=${tenantPhone || "-"}`,
    `tenant_did=${tenantDid || "-"}`,
    `origin=${origin}`,
    `match_owner=${matchOwner}`,
    `match_webhook_contact=${matchWebhookContact}`,
  ].join(" ");

  if (!matchOwner && !matchWebhookContact) {
    console.warn(`[outbound-audit][cross-tenant] ${line}`);
    // Trim the rolling 60 s window before pushing the new timestamp.
    outboundAuditState.crossTenantTimestamps =
      outboundAuditState.crossTenantTimestamps.filter((t) => now - t < 60_000);
    outboundAuditState.crossTenantTimestamps.push(now);
    const count = outboundAuditState.crossTenantTimestamps.length;
    if (count >= 5 && now - outboundAuditState.lastAlertAt > 60_000) {
      outboundAuditState.lastAlertAt = now;
      console.error(
        `[outbound-audit][alert] cross-tenant send rate elevated: ${count} in last minute`,
      );
    }
  } else {
    console.log(line);
  }

  return { matchOwner, matchWebhookContact, origin };
}

// Outbound senders that are tooling / control-plane, not user-facing
// content. We skip ingest for these so Pinecone stays full of REAL
// conversation, not typing pings / status taps / system notices.
function shouldIngestOutbound(text, opts) {
  if (!text || typeof text !== "string" || !text.trim()) return false;
  if (opts?.skipIngest) return false;
  if (opts?.isProgressUpdate) return false;
  if (opts?.isTypingFiller) return false;
  return true;
}

// True if `text` already contains rendered Unicode formatting glyphs (sans
// bold/italic/monospace from the Mathematical Alphanumeric block). Cheap
// check by sampling the first ~80 chars. Used to skip double-formatting.
function looksAlreadyRendered(text) {
  if (!text) return false;
  for (let i = 0; i < Math.min(text.length, 240); i++) {
    const cp = text.codePointAt(i);
    if (cp && cp >= 0x1d400 && cp <= 0x1d7ff) return true;
  }
  return false;
}

const LOOP_SEND_URL = "https://a.loopmessage.com/api/v1/message/send/";
const LOOP_TYPING_URL = "https://a.loopmessage.com/api/v1/message/show-typing/";
const LOOP_STATUS_URL = "https://a.loopmessage.com/v1/message/status/"; // + {message_id}/

/**
 * Universal send: routes to Loop or Twilio depending on TRANSPORT env var.
 *
 * Every outbound goes through renderForIMessage so markdown like *italic*
 * and **bold** ALWAYS lands as Unicode glyphs on the device. This used to
 * only happen on model replies (agent.js) — cron-built messages like the
 * morning check-in were sent raw, so users saw literal asterisks. Now
 * centralized here so no future code path can leak markdown again.
 *
 * opts.tenant      - per-tenant Loop sender ID override
 * opts.replyToId   - thread a reply to a specific inbound message.
 *                    flaw #84 RULE: set replyToId ONLY when this send
 *                    is a direct semantic reply to the inbound. DO NOT
 *                    set it for:
 *                      • thinking-indicator / "one sec…" filler bubbles
 *                      • dm_each_in_group fan-out DMs (those start
 *                        NEW DM threads with people who weren't the
 *                        ones who triggered the fan-out — replyToId
 *                        would target a message id from a different
 *                        chat, which Loop rejects or stitches wrong)
 *                      • proactive / scheduled messages (no inbound
 *                        to reply to)
 *                    DO set it for: the main reply to a user-tapped
 *                    "Reply" inbound, multi-bubble segmented replies
 *                    (first bubble only — subsequent bubbles inherit
 *                    thread context automatically), inline-reply
 *                    [reply:<id>] tokens emitted by the model.
 * opts.effect      - iMessage bubble/screen effect
 * opts.attachments - up to 3 media URLs
 * opts.passthrough - arbitrary metadata echoed back in delivery webhooks
 * opts.subject     - iMessage subject line (email-like, shows above body)
 * opts.channel     - force a delivery channel: imessage | sms | rcs | whatsapp
 * opts.contactFile - vCard URL to attach as an iMessage contact card
 * opts.mediaUrl    - audio file URL (mp3/wav/m4a/caf/aac) to send as voice note
 * opts.service     - "sms" to send as green-bubble SMS instead of iMessage
 * opts.skipFormatting - explicitly opt out of renderForIMessage (rare)
 */
export async function sendMessage(contact, message, opts = {}) {
  // Item 194: the single outbound persona guard. Strip botty filler, em
  // dashes, and emoji from EVERY send (LLM replies, deterministic copy, and
  // captured in-app stream segments) at the one chokepoint they all pass
  // through. Idempotent, so paths that already humanize stay correct. Runs
  // first so the captured stream reply is guarded too, not just iMessage.
  // `opts.allowEmoji` is the rare escape hatch for an explicit echo request.
  if (typeof message === "string" && message.length > 0) {
    message = guardOutbound(message, { allowEmoji: opts.allowEmoji });
  }

  // In-app reply capture: when an /api/v1/quick-call/stream request is running
  // the agent for this caller, divert the reply to its SSE response instead of
  // delivering over Loop. No-op for every normal iMessage send (no active
  // capture context). Runs before audit/formatting/idempotency so a captured
  // reply has no Loop-side effects. Returns a synthetic id so segmented callers
  // (`sent?.message_id`) keep working.
  if (tryCaptureReply(contact, message, opts)) {
    return {
      ok: true,
      captured: true,
      message_id: `captured-${createHash("sha1")
        .update(String(message || ""))
        .digest("hex")
        .slice(0, 12)}`,
    };
  }

  // PR-I: tag and audit every outbound. Logs a structured
  // [outbound-audit] line; emits WARN on cross-tenant; ERROR alert
  // when cross-tenant rate spikes. Skipped for group sends (where
  // `contact` is null and the destination is `opts.group`) — groups
  // are inherently multi-tenant and audit semantics apply per-DM.
  if (!opts.group) {
    try {
      recordOutboundAudit({ to: contact, opts });
    } catch (auditErr) {
      console.warn(
        `[outbound-audit] record failed (non-fatal): ${auditErr.message}`,
      );
    }
  }

  let outgoing = message;
  if (
    typeof outgoing === "string" &&
    outgoing.length > 0 &&
    !opts.skipFormatting &&
    !looksAlreadyRendered(outgoing)
  ) {
    try {
      outgoing = renderForIMessage(outgoing);
    } catch (e) {
      console.warn("[transport] renderForIMessage failed:", e.message);
    }
  }

  // Idempotency: same recipient + same body + same tenant within the
  // dedupe window is dropped. Catches retried scheduled jobs and the
  // "two webhooks fired the same response" race that produced the
  // duplicate-greeting regression. Callers who genuinely need to send
  // the same text twice can pass `opts.idempotencyKey` (a fresh UUID)
  // or `opts.allowDuplicate: true` to opt out.
  if (!opts.allowDuplicate) {
    const senderId = opts.tenant?.loopSenderId || "no-tenant";
    const target = opts.group ? `g:${opts.group}` : `c:${contact}`;
    const idempotencyKey =
      opts.idempotencyKey ||
      `send:${senderId}:${target}:${cheapHash(outgoing || "")}`;
    if (!markSeen(idempotencyKey, 60_000)) {
      console.log(
        `[transport] duplicate send suppressed: target=${target}, sender=${senderId}`,
      );
      return { duplicate: true, suppressed: true };
    }
  }

  // ── Slack outbound branch ──────────────────────────────────────────
  // Two ways a reply can be routed to Slack:
  //   1. Caller explicitly passes opts.transport === "slack" plus
  //      opts.channel (and ideally opts.thread_ts). Direct path —
  //      used by future code that wants to post one-shot Slack
  //      messages without going through the agent loop.
  //   2. `contact` matches an active Slack session in session.js. This
  //      is the agent-loop path: server.js's Slack handler stamped a
  //      session entry when the inbound landed; agent.js eventually
  //      calls sendMessage(synthContact, text, sendOpts) with a Loop-
  //      shaped sendOpts (tenant, replyToId) — we intercept here and
  //      re-route to Slack so the reply threads correctly. Loop is
  //      bypassed entirely; no Loop API call is made.
  const explicitSlack =
    opts.transport === "slack" && (opts.channel || opts.slackChannel);
  const slackSession = explicitSlack ? null : getSlackSession(contact);
  if (explicitSlack || slackSession) {
    const channel = opts.channel || opts.slackChannel || slackSession?.channel;
    // Reply-placement (Tab 29). An explicit thread_ts from the caller always
    // wins (one-shot system sends). Otherwise, for the agent-loop path, run
    // the length-aware decision: stay in an existing thread, keep DMs flat,
    // and for a top-level channel @mention open a thread only when the reply
    // is long. Falls back to the session's legacy thread_ts if the session
    // predates Tab 29 (no threading signals stamped).
    let thread_ts = opts.thread_ts || opts.slackThreadTs;
    if (!thread_ts && slackSession) {
      if (
        slackSession.messageTs ||
        slackSession.channelType ||
        slackSession.inThread
      ) {
        thread_ts = decideSlackThreadTs({
          inThread: slackSession.inThread,
          threadTs: slackSession.realThreadTs,
          messageTs: slackSession.messageTs,
          channelType: slackSession.channelType,
          textLength: (outgoing || "").length,
        });
      } else {
        thread_ts = slackSession.thread_ts;
      }
    }
    // Transport parity: when the agent loop has staged own-domain
    // attachments (generate_pdf / generate_image / generate_docx etc),
    // forward them so responder.js routes through files.uploadV2 instead
    // of pasting URL-only text via chat.postMessage.
    const attachments =
      Array.isArray(opts.attachments) && opts.attachments.length > 0
        ? opts.attachments
        : null;
    const result = await sendSlackReply({
      channel,
      thread_ts,
      text: outgoing,
      attachments: attachments || undefined,
    });
    if (!result.ok) {
      console.warn(
        `[transport] slack send failed: ${result.error} target=${contact}`,
      );
    } else if (shouldIngestOutbound(outgoing, opts) && opts.tenant) {
      // Fire-and-forget: capture every successful outbound Slack reply
      // as an "agent / outbound" Pinecone vector so Medha can recall
      // what she said later.
      ingestMessageEvent({
        text: outgoing,
        role: "agent",
        direction: "outbound",
        phone: opts.tenant.phoneNumber || null,
        tenant: opts.tenant,
        channel: "slack",
        peerHandle: channel || null,
      });
    }
    // Do NOT clear the session on failure. A failed Slack send (e.g.
    // chat.postMessage invalid_auth from a stale bot token) used to
    // clear the session here — but that meant bubbles 2..N of a
    // segmented reply found no session, fell through to Loop with
    // `slack:T…:U…` as the contact, and racked up Loop code 180
    // "invalid contact phone number" errors. Keep the session intact
    // so retries continue to target Slack and fail loudly with the
    // real Slack error; the 5-minute session TTL purges stranded
    // entries on its own.
    return result;
  }

  let result;
  if (TRANSPORT === "twilio") {
    result = await sendViaTwilio(contact, outgoing);
  } else {
    result = await sendToLoop(contact, outgoing, opts);
  }

  // Fire-and-forget outbound ingest. We only ingest on a successful send
  // (no `error` field) and we never let an ingest failure affect the
  // send result. The dedup window inside ingestToAmberID handles the
  // segmented-reply case where the same body is sent twice.
  if (
    result &&
    !result.error &&
    !result.duplicate &&
    shouldIngestOutbound(outgoing, opts) &&
    opts.tenant
  ) {
    ingestMessageEvent({
      text: outgoing,
      role: "agent",
      direction: "outbound",
      phone: opts.tenant.phoneNumber || null,
      tenant: opts.tenant,
      channel: TRANSPORT === "twilio" ? "sms" : "imessage",
      peerHandle: contact || null,
    });
  }
  return result;
}

function cheapHash(s) {
  if (!s) return "0";
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

async function sendViaTwilio(to, message) {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE = process.env.TWILIO_PHONE;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE) {
    throw new Error("Twilio credentials missing.");
  }
  const MAX_LENGTH = 1600;
  const truncated =
    message.length > MAX_LENGTH
      ? message.substring(0, MAX_LENGTH - 30) + "\n\n[Message truncated]"
      : message;
  const auth = Buffer.from(
    `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
  ).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: TWILIO_PHONE,
        To: to,
        Body: truncated,
      }).toString(),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio error: ${res.status} - ${err}`);
  }
  return res.json();
}

function buildLoopHeaders() {
  const headers = {
    Authorization: LOOP_API_KEY,
    "Content-Type": "application/json",
  };
  if (LOOP_SECRET_KEY) headers["Loop-Secret-Key"] = LOOP_SECRET_KEY;
  return headers;
}

async function sendToLoop(contact, message, opts = {}) {
  const MAX_LENGTH = 2000;
  const truncated =
    message.length > MAX_LENGTH
      ? message.substring(0, MAX_LENGTH - 30) + "\n\n[Message truncated]"
      : message;

  // Per-tenant sender ID is REQUIRED. amber-agent no longer holds a
  // LOOP_SENDER_ID env var — sender identity is owned by the tenant
  // record in amber-id. If we got here without a tenant, it's a bug
  // upstream (webhook unresolved, missed resolveTenant call, etc.)
  // and we refuse to send rather than impersonate the wrong agent.
  const senderId = opts.tenant?.loopSenderId;
  if (!senderId) {
    throw new Error(
      "[transport] sendMessage called without opts.tenant.loopSenderId. " +
        "Every send must be scoped to a resolved tenant now that per-tenant " +
        "env vars are gone. opts.tenant=" +
        JSON.stringify(opts.tenant || null),
    );
  }

  // Current Loop API (docs.loopmessage.com): request body uses `contact`
  // + `sender` for direct sends, or `group` + `sender` for group sends.
  // `sender` is the UUID of the dedicated sender name. The legacy field
  // `sender_name` (and `recipient`) was from the old docs-legacy shape
  // and is rejected by the new endpoint for some senders.
  const body = { text: truncated, sender: senderId };
  if (opts.group) {
    body.group = opts.group;
  } else {
    body.contact = contact;
  }

  // Optional fields — only set when present so we don't accidentally
  // clobber server-side defaults with undefined/null.
  if (opts.replyToId) body.reply_to_id = opts.replyToId;
  if (opts.effect) body.effect = opts.effect;
  if (Array.isArray(opts.attachments) && opts.attachments.length > 0) {
    body.attachments = opts.attachments.slice(0, 3);
  }
  if (opts.subject) body.subject = String(opts.subject).slice(0, 120);
  if (opts.passthrough !== undefined && opts.passthrough !== null) {
    body.passthrough =
      typeof opts.passthrough === "string"
        ? opts.passthrough.slice(0, 1000)
        : JSON.stringify(opts.passthrough).slice(0, 1000);
  }
  if (opts.channel) body.service = mapChannel(opts.channel);
  if (!body.service && opts.service) body.service = opts.service;
  if (opts.contactFile) body.contact_file = opts.contactFile;
  if (opts.mediaUrl) body.media_url = opts.mediaUrl;

  if (opts.group) {
    console.log(
      `[loop-send] GROUP send: group=${opts.group}, text="${truncated.slice(0, 60)}...", sender=${senderId}`,
    );
  }

  const response = await fetch(LOOP_SEND_URL, {
    method: "POST",
    headers: buildLoopHeaders(),
    body: JSON.stringify(body),
  });

  const responseBody = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    parsed = { raw: responseBody };
  }

  if (opts.group) {
    console.log(
      `[loop-send] GROUP response: status=${response.status}, body=${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }

  if (!response.ok) {
    throw new Error(`Loop Message error: ${response.status} - ${responseBody}`);
  }
  return parsed;
}

function mapChannel(channel) {
  const c = String(channel).toLowerCase();
  // Loop's `service` field uses these values for forced routing.
  if (c === "imessage" || c === "i" || c === "blue") return "imessage";
  if (c === "sms" || c === "green") return "sms";
  if (c === "rcs") return "rcs";
  if (c === "whatsapp" || c === "wa") return "whatsapp";
  return undefined;
}

/**
 * Send an iMessage tapback reaction. Per Loop Message docs, this uses the
 * same /api/v1/message/send/ endpoint — the presence of a `reaction`
 * field (without `text`) tells Loop to emit a tapback instead of a new
 * bubble. Valid reactions: love, like, dislike, laugh, emphasize,
 * question. Prefix with `-` (e.g. `-love`) to remove.
 */
export async function sendTapback(contact, messageId, reaction, opts = {}) {
  const body = { message_id: messageId, reaction };
  if (opts?.tenant?.loopSenderId) body.sender = opts.tenant.loopSenderId;
  if (opts && opts.group) {
    body.group = opts.group;
  } else {
    body.contact = contact;
  }
  const response = await fetch(LOOP_SEND_URL, {
    method: "POST",
    headers: buildLoopHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    const target = body.group ? `group=${body.group}` : `contact=${contact}`;
    console.warn(
      `Tapback failed: ${response.status} ${target} msg=${messageId} reaction=${reaction} body=${err.slice(0, 300)}`,
    );
    return null;
  }
  return await response.json();
}

/**
 * Show a typing indicator in the recipient's chat, and optionally mark
 * an inbound message as read.
 *
 * Loop's API does NOT support typing indicators or read receipts in
 * group chats — calls on group messages return 400 with code 100
 * ("Group chats don't supports typing indicators or read status.").
 * Callers should pass `isGroup: true` for group inbound messages to
 * skip the call cleanly instead of spamming log warnings.
 *
 * @param {Object} args
 * @param {string} args.messageId - The message_id of the inbound that triggered
 *        this reply. Loop scopes typing indicators to a specific message_id.
 * @param {number} [args.seconds=5] - How long to show typing (max 60).
 * @param {boolean} [args.read=false] - If true, also sends a read receipt.
 * @param {boolean} [args.isGroup=false] - If true, skip (Loop doesn't support).
 * @returns {Promise<Object|null>} Loop response, or null on failure/skip.
 */
export async function showTyping({
  messageId,
  seconds = 5,
  read = false,
  isGroup = false,
} = {}) {
  if (TRANSPORT !== "loop") return null;
  if (!messageId) return null;
  if (isGroup) return null; // Loop doesn't support typing/read in groups
  const body = {
    message_id: messageId,
    typing: Math.max(1, Math.min(60, Math.floor(seconds))),
  };
  if (read) body.read = true;
  try {
    const response = await fetch(LOOP_TYPING_URL, {
      method: "POST",
      headers: buildLoopHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      const errTxt = await response.text().catch(() => "");
      console.warn(
        `[loop-typing] failed: status=${response.status} msg=${messageId} body=${errTxt.slice(0, 200)}`,
      );
      return null;
    }
    return await response.json().catch(() => ({}));
  } catch (err) {
    console.warn(`[loop-typing] error msg=${messageId}: ${err.message}`);
    return null;
  }
}

/**
 * Mark an inbound message as read without showing a typing indicator.
 */
export async function markRead(messageId, { isGroup = false } = {}) {
  return showTyping({ messageId, seconds: 1, read: true, isGroup });
}

/**
 * Poll the delivery status of a previously sent message.
 * Useful for retry logic after a send.
 *
 * @param {string} messageId - Loop's message_id returned from sendMessage.
 * @returns {Promise<Object|null>} { status, error_code, ... } or null.
 */
export async function getMessageStatus(messageId) {
  if (TRANSPORT !== "loop") return null;
  if (!messageId) return null;
  try {
    const response = await fetch(`${LOOP_STATUS_URL}${messageId}/`, {
      method: "GET",
      headers: buildLoopHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch (err) {
    console.warn(`[loop-status] error msg=${messageId}: ${err.message}`);
    return null;
  }
}

/**
 * Send a progress update to the tenant owner. Requires a resolved
 * tenant — without one we have no idea whose phone to text or which
 * sender UUID to use.
 */
export async function sendProgressUpdate(message, tenant = null) {
  try {
    console.log(`Progress: ${message}`);
    if (!tenant?.phoneNumber || !tenant?.loopSenderId) {
      console.warn(
        "[transport] sendProgressUpdate skipped: no tenant owner phone or senderId",
      );
      return;
    }
    await sendMessage(tenant.phoneNumber, message, {
      tenant,
      auditOrigin: "scheduled",
    });
  } catch (error) {
    console.error("Failed to send progress update:", error.message);
  }
}
