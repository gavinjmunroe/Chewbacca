/**
 * Amber: Cloud-Based Always-On Personal AI Agent via Loop Message
 *
 * This is the orchestrator. All reusable logic lives in lib/ modules.
 * This file handles: HTTP server, webhook routing, message queue,
 * AI call chain, tool loop, system prompts, and proactive checks.
 */

import { getPlatformStatus } from "./lib/transports/index.js";
import { startServer } from "./lib/server.js";
import {
  resolveTenant,
  listActiveTenants,
  getAgentName,
  getPublicAgentName,
} from "./lib/tenant.js";

// ── Lib modules ──────────────────────────────────────────────────────────
import {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  OLLAMA_API_KEY,
  PERPLEXITY_API_KEY,
  TRANSPORT,
  LOOP_SENDER_PHONE,
  CALEB_PHONE,
  CALEB_FOCUSED_WINDOW_MS,
  BMA_SLACK_WEBHOOK,
  HEALTH_DIMS,
  HEALTH_DIM_DESCRIPTIONS,
} from "./lib/constants.js";

import {
  isSafeReply,
  getSafeFallback,
  isPreFiltered,
  renderForIMessage,
  CRISIS_PATTERNS,
  OPT_OUT_PATTERN,
  EMOTIONAL_DISTRESS,
} from "./lib/safety.js";
import { sendMessage, sendTapback } from "./lib/transport.js";
import { runWithReplyCapture } from "./lib/reply-capture.js";
import {
  detectTapbackShortcut,
  parseReactionTokens,
  buildRecentMessageIdsBlock,
  VALID_REACTIONS,
} from "./lib/tapback.js";
import { normalizeHandle } from "./lib/permissions.js";
import {
  sbGet,
  sbUpsert,
  sbInsert,
  logInteractionToSupabase,
} from "./lib/data.js";
import {
  healthResponseGuidance,
  buildHealthLensBlock,
  loadHealthProfile,
  saveHealthCheckin,
  inferHealthSignals,
  buildDailyCheckinPrompt,
  parseCheckinReply,
  maybeSendDailyCheckin,
} from "./lib/health.js";
import {
  startCheckinScheduler,
  maybeHandleCheckinReply,
} from "./lib/checkins.js";
import { maybeIndexConversation } from "./lib/conversation-index.js";
import {
  contactMemoryCache,
  conversationMemoryCache,
  loadContact,
  saveContact,
  loadConversationHistory,
  saveConversationHistory,
  extractAndUpdateContactProfile,
  buildStalenessWarning,
} from "./lib/contacts.js";
import {
  syncContextToSupabase,
  loadAmberContext,
  fetchRelevantContext,
} from "./lib/context.js";
import {
  mightNeedSearch,
  planSearch,
  executeSearchPlan,
} from "./lib/search.js";
import {
  enrichContactFromSearch,
  extractSubjectName,
} from "./lib/search-enrichment.js";
import {
  classifyEmotion,
  emotionToHealthDelta,
  emotionToPromptHint,
  shouldClassify as shouldClassifyEmotion,
} from "./lib/emotion.js";
import { recordOutboundMessage, captureReaction } from "./lib/feedback-loop.js";
import { captureTurnMemory } from "./lib/auto-memory.js";
import { searchMemories, saveMemory } from "./lib/memory.js";
// Tool dispatch + keyword selection extracted into their own modules to
// honor the <800-line rule (see AGENTS.md). The dispatcher owns all
// name → executor routing; the selector owns the keyword→tool mapping.
import { dispatchToolCall } from "./lib/tool-dispatcher.js";
import { discoverConnections } from "./lib/connections-discovery.js";
import { getSession as getSlackSession } from "./lib/transports/slack/session.js";
import { sanitizeToolOutput } from "./lib/tool-output-sanitizer.js";
import { processInboundAttachments } from "./lib/attachment-ingest.js";
import {
  extractNamesFromHistory,
  isDuplicateMessage,
} from "./lib/message-utils.js";
import {
  runProactiveCheck,
  startDlqReplayer,
  startContactFactsBatch,
  startMemoryDecay,
} from "./lib/proactive-runner.js";
// Calendar-first pre-pass (CALENDAR-RUNTIME-INTEGRATION.md). Gated by the
// AMBER_CALENDAR_RUNTIME_ENABLED env flag or tenant.preferences.calendar.
import { maybeHandleCalendarMessage } from "./lib/calendar/runtime.js";
// todoist.js replaced by Beads (task_* tools).
import { getComposioTools } from "./lib/tools/composio.js";
import {
  isBmaProspect,
  postSlack,
  getClayProfile,
  logInteraction,
} from "./lib/crm.js";
import {
  callClaudeRaw,
  callOllamaDirect,
  anthropicToOpenAIMessages,
} from "./lib/ai.js";
import { classifyComplexity, resolveModel } from "./lib/router.js";
import {
  loadUserSession,
  saveUserSession,
  clearPendingAction,
  parseIntent,
} from "./lib/sessions.js";
import {
  shouldAmberReplyInGroup,
  loadGroupContextForContact,
} from "./lib/groups.js";
import { getAllTools } from "./lib/tools/index.js";
import { armTools } from "./lib/tool-arming.js";
import { buildSystemPromptForSender } from "./lib/prompts.js";
import {
  compressConversation,
  buildCompressedMessages,
} from "./lib/compression.js";
import { startReflectionEngine } from "./lib/reflection.js";
import {
  checkGroupMessageSafety,
  wrapGroupMessageAsConversation,
} from "./lib/safety.js";
import {
  loadGroupMemory,
  updateGroupMemoryFromConversation,
  buildGroupMemoryBlock,
} from "./lib/group-memory.js";
import {
  loadSkills,
  findRelevantSkills,
  buildSkillBlock,
} from "./lib/skills.js";
import { buildWritingDoctrineBlock } from "./lib/writing-doctrine.js";
import {
  recordReply,
  recordOutreach,
  isDND,
  shouldProactivelyReach,
  getProactiveTargets,
  generateProactiveMessage,
} from "./lib/proactive.js";
import {
  inferPersonalityMode,
  getPersonalityStyleGuide,
} from "./lib/personality.js";
import { segmentReply } from "./lib/segmented-reply.js";
import {
  matchesSafeKeyword,
  mentionsSubstance,
  isUrgentSubstanceSignal,
  buildSafeKeywordReply,
  buildSubstanceRedirectReply,
  shouldSendFirstContactGreeting,
  buildFirstContactGreeting,
  extractFirstNameFromReply,
  wantsVcardShare,
  buildVcardShareReply,
} from "./lib/festival.js";
import { handleRaveInbound } from "./lib/rave-master/index.js";

// Build the public vCard URL for a tenant. Falls through to null if
// there's no sender to key the URL by — the caller should treat null
// as "no contact card to share" and skip the send rather than guess.
/**
 * Detect inbound transport from the slack session table. If a session
 * exists for this `from` handle, the message arrived via the Slack
 * webhook (envelope.js stamps the session before enqueue). Otherwise
 * treat as iMessage/SMS via Loop.
 */
function detectTransport(from) {
  if (!from) return "imessage";
  try {
    const session = getSlackSession(from);
    if (session) return "slack";
  } catch {
    /* no-op */
  }
  return "imessage";
}

/**
 * Build the connect-link tool_result the model should relay verbatim.
 * Three states drive the copy:
 *
 *   1. User has ZERO active connections in their bag -> they probably
 *      haven't onboarded to medha-id yet. Pitch the link as "set up
 *      your medha-id by connecting your [transport] here" so the
 *      first thing they do matches where they messaged from.
 *
 *   2. User has at least one connection but not the one the tool
 *      needed -> pitch the link as "connect [service] here" (the
 *      original behavior, just lifted into the helper).
 *
 *   3. Connections data missing entirely (lookup failed upstream)
 *      -> fall back to the service-name copy so the user still gets
 *      a working link.
 *
 * Caleb 2026-05-26: 'It shouldn't assume I already have a medha-id.'
 * That's case (1).
 */
function buildConnectLinkResult({
  toolName,
  connections,
  from,
  detail,
  existingConnectUrl = null,
}) {
  // Canonical user-facing domain. The Railway URL still serves the same
  // app but justarock.ai is what we put in the user's mouth.
  const base =
    process.env.MEDHA_FRONTEND_URL?.replace(/\/+$/, "") ||
    "https://www.justarock.ai";
  const connectUrl = existingConnectUrl || `${base}/connect`;
  const serviceName = guessServiceName(toolName) || "that service";
  const transport = detectTransport(from);
  const transportLabel = transport === "slack" ? "Slack" : "iMessage";

  const hasAnyConnection =
    Array.isArray(connections) && connections.some((c) => c?.connected);

  let replyTemplate;
  if (Array.isArray(connections) && !hasAnyConnection) {
    // No connections at all -> treat as not-onboarded.
    replyTemplate =
      `You haven't connected ${transportLabel} to your medha-id yet. ` +
      `Set it up here and then ask me again: ${connectUrl}`;
  } else {
    // Has medha-id + at least one connection; just missing this service.
    replyTemplate =
      `Your ${serviceName} isn't connected to your medha-id yet. ` +
      `Connect it here and then ask me again: ${connectUrl}`;
  }

  return {
    user_action_required: "connect_oauth",
    service: serviceName,
    transport,
    connect_url: connectUrl,
    reply_template: replyTemplate,
    detail,
  };
}

/**
 * Map a tool name to the user-facing service name shown in the
 * connect-link reply. Tool names like "gcal_list_events" or
 * "gmail_send" map back to "Google Calendar" / "Gmail" so the
 * user sees a sentence that names the right thing rather than
 * the internal tool slug.
 */
function guessServiceName(toolName) {
  if (!toolName || typeof toolName !== "string") return null;
  const t = toolName.toLowerCase();
  if (t.startsWith("gcal") || t.includes("calendar")) return "Google Calendar";
  if (t.startsWith("gmail") || t.includes("gmail")) return "Gmail";
  if (t.startsWith("gdrive") || t.startsWith("drive_") || t === "drive")
    return "Google Drive";
  if (t.startsWith("gdocs") || t.startsWith("docs_") || t === "docs")
    return "Google Docs";
  if (t.startsWith("gsheets") || t.startsWith("sheets_") || t === "sheets")
    return "Google Sheets";
  if (t.startsWith("slack")) return "Slack";
  if (t.startsWith("linkedin")) return "LinkedIn";
  if (t.startsWith("notion")) return "Notion";
  if (t.startsWith("github")) return "GitHub";
  if (t.startsWith("twitter") || t.startsWith("x_")) return "X / Twitter";
  if (t.startsWith("ms_") || t.includes("microsoft") || t.includes("outlook"))
    return "Microsoft";
  if (t.startsWith("railway")) return "Railway";
  return null;
}

function buildVcardUrl(tenant) {
  if (!tenant?.loopSenderId) return null;
  const base =
    process.env.PUBLIC_BASE_URL ||
    `https://${
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      "amber-agent-production.up.railway.app"
    }`;
  return `${base}/v1/vcard/${encodeURIComponent(tenant.loopSenderId)}.vcf`;
}

// ── Agent state ──────────────────────────────────────────────────────────
let lastProcessedHash = null;
let isProcessing = false;
// Proactive counters moved into lib/proactive-runner.js module singleton.
let lastError = null;
let lastProcessTime = null;
let processCount = 0;
let lastCalebActivityMs = 0;

const groupReplyCooldown = new Map(); // groupId -> lastReplyTimestamp (ms)
// flaw #80 — effect rate-limiting. Track per-group: last effect timestamp
// plus a small recent-message count window. Cap to 1 effect per ~10
// outbound messages per group so "loud"/"balloons" doesn't feel spammy.
const groupEffectTracker = new Map(); // groupId -> { lastEffectAt, msgsSince }
const EFFECT_WINDOW_MIN_MSGS = 10;
const CONTACTS_DIR = "amber-contacts"; // for cleanupCorruptedContacts

const messageQueue = [];
let queueRunning = false;

// ── Burst batching ────────────────────────────────────────────────────
// When someone fires multiple iMessages in quick succession (classic
// iMessage rhythm: "hey" / "quick question" / "about the thing we
// talked about yesterday"), Amber should wait a beat, collapse the
// burst into one input, and reply once with context for the whole
// sequence — instead of racing out three separate replies that each
// see only partial context.
//
// Keying is (from|groupId|loopSenderId) so bursts are isolated per
// sender per chat. Voice-in messages and reactions bypass batching.
const BURST_WINDOW_MS = 2500; // reset on each new message within this window
const BURST_MAX_WAIT_MS = 8000; // hard cap — never hold a message longer than this
const BURST_MAX_COUNT = 6; // flush when buffer hits this many messages
const burstBuffers = new Map(); // key -> { items: [args], timer, firstAt }

function burstKey(args) {
  const [from, , , groupId, , , , loopSenderId] = args;
  return `${loopSenderId || "?"}|${groupId || "dm"}|${from || "?"}`;
}

// Voice-in messages use a special prefix we add in server.js; those
// should NOT be batched because transcription latency is variable and
// the user's own sense of timing already includes that gap.
function isBatchable(args) {
  const text = args[1] || "";
  if (typeof text !== "string") return false;
  if (text.startsWith("[voice-in]")) return false;
  return true;
}

// Out-of-band per-args metadata that the agent loop needs but that doesn't
// fit the historical 9-element positional shape (from, text, messageId, ...).
// Today the only inhabitant is Slack's senderHints: envelope.js resolves the
// inbound human's display name + source email via lookupSenderByEmail, and
// handleWebhookMessage reads them back here to prefix the user turn so Medha
// can address Caleb-the-contact by name instead of inheriting the channel
// owner's identity. WeakMap so a queued args array that gets GC'd doesn't
// leak its hint blob.
const argsMeta = new WeakMap();

// Flush a burst buffer into the real queue as ONE enqueue. The joined
// args preserve the LAST message's id/replyToId (which is what Loop's
// "reply to the latest" thread expects) but the text is a newline-
// separated concatenation of every message in the burst. The handler
// downstream sees a multi-line inbound and can reason about it as a
// single turn.
function flushBurst(key) {
  const buf = burstBuffers.get(key);
  if (!buf) return;
  if (buf.timer) clearTimeout(buf.timer);
  if (buf.hardTimer) clearTimeout(buf.hardTimer);
  burstBuffers.delete(key);
  if (!buf.items.length) return;

  if (buf.items.length === 1) {
    messageQueue.push(buf.items[0]);
  } else {
    // Collapse: last-message scaffold (ids, group metadata), text joined.
    const last = buf.items[buf.items.length - 1];
    const joinedText = buf.items.map((it) => it[1]).join("\n");
    console.log(
      `[burst] collapsed ${buf.items.length} msgs from ${key.split("|").pop()} into one turn`,
    );
    const collapsed = [...last];
    collapsed[1] = joinedText;
    // Preserve out-of-band meta (e.g. Slack senderHints). If multiple items
    // in the burst carry hints, the latest wins because the latest message
    // is the freshest read of who the inbound sender is.
    for (const item of buf.items) {
      const meta = argsMeta.get(item);
      if (meta) argsMeta.set(collapsed, meta);
    }
    messageQueue.push(collapsed);
  }
  runQueue();
}

function runQueue() {
  if (queueRunning) return;
  queueRunning = true;
  (async () => {
    while (messageQueue.length > 0) {
      const next = messageQueue.shift();
      const meta = argsMeta.get(next) || null;
      // CRIT-1: bind reply-capture to THIS queue item, not to the shared
      // async context the IIFE drains in. The /quick-call/stream route used
      // to wrap dispatchLoopEvent in runWithReplyCapture, but the real agent
      // run happens here, detached, and a second item entering the queue
      // while the first drains would run under the FIRST request's capture
      // context — bleeding a same-user iMessage reply (or a second in-app
      // stream) into the wrong SSE stream. By making capture a property of
      // the dequeued item, each run captures only its own sends regardless of
      // which IIFE invocation drains the queue.
      const capture = meta?.capture || null;
      try {
        const runOnce = () =>
          Promise.race([
            handleWebhookMessage(...next, { senderHints: meta?.senderHints }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Message processing timeout (120s)")),
                120_000,
              ),
            ),
          ]);
        if (capture) {
          await runWithReplyCapture(capture, runOnce);
        } else {
          await runOnce();
        }
      } catch (e) {
        console.error("Queue item crashed:", e.message);
        isProcessing = false;
        // H1: surface the failure to whoever owns this item's capture
        // context (the SSE route) so the stream emits an error frame and
        // finishes instead of hanging until its 45s hard cap. The route's
        // own `.catch` on the dispatch promise only fires for synchronous /
        // dispatch-time errors; errors thrown inside the detached run land
        // here, so this is the only place that can notify the stream.
        if (capture && typeof capture.onError === "function") {
          try {
            capture.onError(e);
          } catch (cbErr) {
            console.error("Queue item onError callback threw:", cbErr.message);
          }
        }
      }
    }
    queueRunning = false;
  })();
}

/**
 * Scan conversation history for self-introductions like "I'm Charles",
 * "My name is Charles", "This is Charles" and return a phone -> firstName map.
 * Used to replace raw phone-number senderLabels with actual names in group chats.
 */
// extractNamesFromHistory extracted to lib/message-utils.js

async function enqueueMessage(args, opts = {}) {
  // Out-of-band per-item metadata stored on the args array via the WeakMap.
  // senderHints (Slack display-name resolution) and capture (CRIT-1: the
  // /quick-call/stream reply-capture context { contact, onMessage, onError })
  // both ride here so runQueue can read them back for THIS specific item,
  // even though the actual agent run happens later in the detached IIFE.
  if (
    opts &&
    (opts.senderHints || opts.capture) &&
    args &&
    typeof args === "object"
  ) {
    const meta = {};
    if (opts.senderHints) meta.senderHints = opts.senderHints;
    if (opts.capture) meta.capture = opts.capture;
    argsMeta.set(args, meta);
  }
  // Non-batchable messages (voice transcripts, anything we don't want
  // delayed) go straight to the real queue.
  if (!isBatchable(args)) {
    messageQueue.push(args);
    runQueue();
    return;
  }

  const key = burstKey(args);
  const now = Date.now();
  let buf = burstBuffers.get(key);

  if (!buf) {
    buf = { items: [], timer: null, hardTimer: null, firstAt: now };
    burstBuffers.set(key, buf);
    // Hard cap: never hold a burst longer than BURST_MAX_WAIT_MS from
    // the first message, even if new messages keep arriving.
    buf.hardTimer = setTimeout(() => flushBurst(key), BURST_MAX_WAIT_MS);
  }

  buf.items.push(args);

  // Flush immediately if we hit the count cap.
  if (buf.items.length >= BURST_MAX_COUNT) {
    flushBurst(key);
    return;
  }

  // Reset the rolling window timer — each new message extends the wait
  // up to BURST_WINDOW_MS. The hard cap above bounds the total hold.
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushBurst(key), BURST_WINDOW_MS);
}

// isDuplicateMessage extracted to lib/message-utils.js

// checkForProactiveUpdates extracted to lib/proactive-runner.js

import {
  handleRetreatMessage,
  loadRetreatConfig,
  loadRetreatResponses,
  buildRetreatSummary,
  isRetreatOrganizer,
} from "./lib/retreat.js";

// ============================================================================
// MESSAGE ENQUEUE & QUEUE PROCESSING
// ============================================================================

// ============================================================================
// LOOP MESSAGE WEBHOOK HANDLER — real-time incoming messages (any contact)
// ============================================================================

async function handleWebhookMessage(
  from,
  text,
  messageId,
  groupId,
  groupName,
  participants,
  replyToId = null, // reply_to_id from Loop if the sender tapped Reply To
  loopSenderId = null, // sender UUID from Loop payload, used for tenant resolution
  attachments = [], // Tab 8: non-audio Loop attachments (PDFs, images, docs) — OCR'd before the model sees the turn
  opts = {}, // out-of-band: { senderHints?: { senderKind, senderDid, senderDisplayName, sourceEmail, matchedVia } }
) {
  const senderHints = opts && opts.senderHints ? opts.senderHints : null;
  if (isDuplicateMessage(from, text, messageId)) {
    console.log(
      `⏭️ [DEDUP] Ignoring duplicate: ${from} "${(text || "").slice(0, 40)}"`,
    );
    return;
  }

  isProcessing = true;
  processCount++;
  lastProcessTime = new Date().toISOString();

  // ── Entry-point trace ─────────────────────────────────────────────────
  // Single log line at the top of every webhook so silent-drop bugs (Slack
  // /v1/me/connections / group / DM all eventually land here) have a
  // breadcrumb. Caleb 2026-05-27: '@Medha Wake up in slack didn't
  // respond.' Without this we have to guess which short-circuit ate it.
  console.log(
    `[webhook] entry from=${from} groupId=${groupId || "-"} loopSenderId=${loopSenderId || "-"} text="${(text || "").slice(0, 80)}"`,
  );

  // ── Tenant resolution (multi-tenant entry point) ──────────────────────
  const tenant = await resolveTenant(loopSenderId);
  if (!tenant) {
    console.warn(
      `[queue] no tenant for sender=${loopSenderId} from=${from} — dropping`,
    );
    isProcessing = false;
    return;
  }
  console.log(
    `[webhook] tenant resolved kind=${tenant.kind || "?"} expertMode=${!!tenant.expertMode} phone=${tenant.phoneNumber || "?"}`,
  );

  // Expert-mode tenants (e.g., did:expert:medha when someone texts the
  // Medha Loop sender) carry the AGENT's phone (+15550100005) in
  // phoneNumber, not the inbound sender's. That breaks the identity
  // bridge: secrets like GCAL_OAUTH_REFRESH are stored under
  // sha256(E.164(actual user's phone)), not the agent's phone. Re-point
  // the tenant's phoneNumber at the inbound `from` so getSecret derives
  // the right person_id and finds the right Google tokens.
  if (tenant.kind === "expert" || tenant.expertMode === true) {
    if (from && from !== tenant.phoneNumber) {
      tenant.phoneNumber = from;
    }
  }

  // Voice message: server.js (Loop) / transports/slack (Slack) prefixes the
  // transcript with [voice-in]. Strip the prefix before the AI sees it;
  // remember the flag so we can reply with voice.
  const userSentVoice =
    typeof text === "string" && /^\[voice-in\]\s*/i.test(text);
  if (userSentVoice) {
    text = text.replace(/^\[voice-in\]\s*/i, "");
  }

  // Tab 22: voice journaling. A voice memo is a journal moment by default
  // (Sagar walking and talking), so capture the transcript as a journal entry
  // the instant it lands, deterministically, not relying on the model to
  // remember. This is the SINGLE capture path for both transports: Loop and
  // Slack both arrive here flagged [voice-in] with the tenant already
  // resolved. Fire-and-forget so a journaling failure never blocks or delays
  // the reply. Scoped to DMs: a voice note dropped into a group chat is
  // conversation, not the owner's private journal. The prompt tells the model
  // the memo is already captured so it won't double-write via add_journal_entry.
  if (userSentVoice && !groupId && typeof text === "string" && text.trim()) {
    const voiceTranscript = text;
    import("./lib/voice-ingest.js")
      .then(({ journalVoiceMemo }) =>
        journalVoiceMemo({
          tenant,
          transcript: voiceTranscript,
          contact: from,
          messageId: messageId || null,
        }),
      )
      .catch((err) =>
        console.warn(`[voice-journal] dispatch skipped: ${err.message}`),
      );
  }

  // Tab 8: OCR inbound attachments (PDFs, images, docs) and inline the
  // extracted text so the model sees the file content in the same turn
  // instead of an empty bubble. attachment-ingest.js routes through the
  // existing ocr_extract_text tool (Mistral OCR handles both image and
  // PDF URLs); errors are isolated per attachment.
  if (Array.isArray(attachments) && attachments.length > 0) {
    try {
      const { extractedText } = await processInboundAttachments({
        tenant,
        urls: attachments,
        contact: from,
        messageId: messageId || null,
      });
      if (extractedText) {
        const isPlaceholder = text === "[attachment-only message]";
        text = isPlaceholder ? extractedText : `${extractedText}\n\n${text}`;
      }
    } catch (err) {
      console.warn(`[attachments] processing failed: ${err.message}`);
    }
  }

  // ── Inbound sender identity (Slack) ──────────────────────────────
  // envelope.js (lookupSenderByEmail) resolves the Slack profile email to a
  // contact in the tenant's address book. Without surfacing that to the model
  // here, every Slack inbound looked like the channel owner — Medha greeted
  // Caleb-the-contact as "Sagar". The prefix is a synthetic system line at
  // the very top of the user turn. The corresponding prompts.js INBOUND
  // SENDER IDENTITY block tells the model to read it and address the named
  // sender by their first name rather than as the channel owner.
  if (
    senderHints &&
    typeof senderHints.senderDisplayName === "string" &&
    senderHints.senderDisplayName
  ) {
    const email = senderHints.sourceEmail
      ? ` <${senderHints.sourceEmail}>`
      : "";
    const senderPrefix = `[Inbound sender: ${senderHints.senderDisplayName}${email}, known to you as a contact of the tenant owner. Address them by first name, not as the channel owner.]`;
    text =
      typeof text === "string" && text.length > 0
        ? `${senderPrefix}\n${text}`
        : senderPrefix;
  }

  const normFrom = normalizeHandle(from);
  const isCaleb = tenant
    ? normalizeHandle(from) === normalizeHandle(tenant.phoneNumber)
    : normFrom === normalizeHandle(CALEB_PHONE);

  // Transport parity (Caleb 2026-05-28): the human typing this turn is the
  // tenant owner when the inbound matches the tenant phone (Loop) or when
  // Slack sender-hints identify them as the linked tenant owner (kind
  // "tenant_owner" populated by Option B auto-link in slack/envelope.js).
  // We thread senderIsOwner through to armTools + buildSystemPromptForSender
  // so owner-in-group and owner-on-Slack get the same surface as owner-DM.
  const slackSenderIsOwner =
    senderHints && senderHints.senderKind === "tenant_owner";
  const senderIsOwner = isCaleb || !!slackSenderIsOwner;
  const isSlackInbound = typeof from === "string" && from.startsWith("slack:");
  const transportKind = isSlackInbound
    ? "slack"
    : groupId
      ? "imessage-group"
      : "imessage-dm";

  // ── INBOUND INGEST (fire-and-forget) ───────────────────────────────
  // Capture every inbound message as its own Pinecone vector BEFORE any
  // short-circuit (sign-in fast path, SAFE keyword, vCard, etc.) so
  // recall works on conversations that never reach the full agent loop.
  // Complements the combined ingestConversation call later in the
  // happy path; dedup-by-key prevents double-ingest of the same content.
  if (text && typeof text === "string") {
    try {
      const { ingestMessageEvent } = await import("./lib/amber-id-ingest.js");
      const channel =
        typeof from === "string" && from.startsWith("slack:")
          ? "slack"
          : "imessage";
      ingestMessageEvent({
        text,
        role: "user",
        direction: "inbound",
        phone: isCaleb ? tenant?.phoneNumber || CALEB_PHONE : normFrom,
        tenant,
        channel,
        peerHandle: isCaleb ? null : normFrom,
        messageId: messageId || null,
      });
    } catch (_) {}
  }

  // ── FAST PATH: sign-in opt-in 'What's my login code?' ─────────────
  // Hoisted to the TOP of the handler (right after isCaleb resolves)
  // so the OTP reply skips every downstream pre-check. Caleb
  // 2026-05-28: 'It worked, but it took too long to respond with the
  // code.' The original location at line ~890 ran AFTER tapback
  // detection, bootstrap pre-pass (Firestore round-trip), group
  // safety, pre-filter, SAFE keyword, and crisis pattern — all of
  // which take real time for a turn that's about to short-circuit
  // anyway.
  //
  // Bypasses Loop's cold-send 540/520 (we never make a cold call;
  // the user initiated, we reply in-thread). DM-only. Fires for
  // tenant owners too (#202).
  if (
    !!tenant &&
    !groupId &&
    typeof text === "string" &&
    /^\s*(what.{0,3}s my login code\??|hi medha[\s!.]*|login code|sign[ -]?in code)\s*$/i.test(
      text,
    )
  ) {
    try {
      const apiUrl = (process.env.AMBER_ID_API_URL || "").replace(/\/+$/, "");
      const apiKey = process.env.AMBER_ID_API_KEY || "";
      if (apiUrl && apiKey) {
        const issueRes = await fetch(`${apiUrl}/v1/auth/issue-code`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({ phone: normFrom }),
          signal: AbortSignal.timeout(3000),
        });
        const issueBody = await issueRes.json().catch(() => ({}));
        if (issueRes.ok && issueBody?.code) {
          // No verify URL in the body. Caleb 2026-05-28: 'When Medha
          // gives me the code it shouldn't also give me the link.'
          // The user is already on /sign-in with the code-entry input
          // visible — pasting the 6 digits is the next action. A
          // tappable link in the iMessage thread would just be visual
          // noise + a competing CTA they don't need.
          const sendOptsFast = {
            replyToId: replyToId || undefined,
            tenant,
            allowDuplicate: true,
            auditOrigin: "webhook",
            webhookContact: normFrom,
          };
          await sendMessage(
            normFrom,
            `Your Medha sign-in code: ${issueBody.code}\n\nExpires in 5 minutes.`,
            sendOptsFast,
          );
          console.log(
            `[signin-fast] issued code to ${normFrom} expires=${issueBody.expires_in_seconds}s`,
          );
          isProcessing = false;
          return;
        }
        if (issueRes.status === 429) {
          await sendMessage(
            normFrom,
            "I just sent you a code a moment ago. Check the most recent message above.",
            {
              tenant,
              allowDuplicate: true,
              auditOrigin: "webhook",
              webhookContact: normFrom,
            },
          );
          isProcessing = false;
          return;
        }
        console.warn(
          `[signin-fast] issue-code failed status=${issueRes.status}`,
        );
      } else {
        console.warn(
          "[signin-fast] AMBER_ID_API_URL/AMBER_ID_API_KEY missing — falling through",
        );
      }
    } catch (err) {
      console.warn(`[signin-fast] threw: ${err?.message || err}`);
    }
    // Fall through to LLM on any failure so the user sees something.
  }

  // ── Explicit single-message tapback shortcut ──────────────────────────
  // For terse, unambiguous single-message reaction commands ("Heart this
  // message", "React with ? to this", etc.), fire the tapback deterministically
  // without going through the AI. Models don't reliably emit [react:TYPE] for
  // these terse commands — they type "Liked!" as text instead. Multi-message
  // reaction asks ("like these 2 messages", "love this and the last one") fall
  // through to the AI path, which uses the RECENT MESSAGE IDS prompt block to
  // emit one [react:TYPE:messageId] token per target.
  if (isCaleb && messageId && typeof text === "string") {
    const shortcutReaction = detectTapbackShortcut(text);
    if (shortcutReaction) {
      const target = groupId ? `group ${groupId}` : `DM ${normFrom}`;
      console.log(
        `[tapback-shortcut] "${text}" -> [react:${shortcutReaction}] on ${messageId} (${target})`,
      );
      let ok = null;
      try {
        ok = await sendTapback(normFrom, messageId, shortcutReaction, {
          tenant,
          group: groupId || undefined,
        });
      } catch (err) {
        console.warn(`[tapback-shortcut] threw: ${err.message}`);
      }
      if (ok) {
        logInteractionToSupabase(
          normFrom,
          text,
          `[react:${shortcutReaction}]`,
          "tapback-shortcut",
          tenant,
        ).catch(() => {});
        isProcessing = false;
        return;
      }
      // Loop rejected the tapback (unsupported group type, stale msg id,
      // green-bubble participant, etc.) — sendTapback returned null after
      // logging the status. Fall through to the AI path so Amber still
      // says *something* instead of going silent. The AI can try
      // [react:TYPE] again or just reply with text.
      console.warn(`[tapback-shortcut] fell through to AI path for ${target}`);
    }
  }
  if (isCaleb) lastCalebActivityMs = Date.now(); // KAIROS focus tracking
  const isGroup = !!groupId;
  const chatKey = groupId || normFrom;
  // send opts for all outbound replies — includes tenant for per-tenant sender ID.
  // PR-I outbound audit: stamp auditOrigin + webhookContact so transport.js
  // can verify the destination matches the inbound contact for this turn.
  const sendOpts = isGroup
    ? {
        group: groupId,
        replyToId: replyToId || undefined,
        tenant,
        auditOrigin: "webhook",
        webhookContact: normFrom,
      }
    : {
        replyToId: replyToId || undefined,
        tenant,
        auditOrigin: "webhook",
        webhookContact: normFrom,
      };

  // flaw #78 — deterministic "what can you do?" short-circuit. The model
  // tends to either dump its tool list (overwhelming) or wave vaguely
  // ("oh I help with stuff!"). Neither is useful. A 5-line hand-curated
  // capability list beats both. Only fires in DM and only on the exact
  // shape — we don't want to intercept "menu for dinner?" etc.
  if (!isGroup && typeof text === "string") {
    const menuMatch = text.match(
      /^\s*(what can you do|what do you do|what can u do|help|menu)\??\s*$/i,
    );
    if (menuMatch) {
      const menu = [
        "here's what i'm good for:",
        "• plan trips and events (group coordination, RSVPs, logistics)",
        "• remind you or anyone in a thread about stuff",
        "• search the web and read pages you send me",
        "• send voice notes when text feels flat",
        "• fan-out DMs to a group after they 👍 the handshake",
      ].join("\n");
      try {
        await sendMessage(normFrom, menu, sendOpts);
      } catch (err) {
        console.warn(`[help-shortcut] send failed: ${err.message}`);
      }
      logInteractionToSupabase(
        normFrom,
        text,
        menu,
        "help-shortcut",
        tenant,
      ).catch(() => {});
      isProcessing = false;
      return;
    }
  }

  // Pre-filter: skip OTP codes, hard spam, LinkedIn cold outreach (uses lib/safety.js)
  if (!isCaleb) {
    const filterResult = isPreFiltered(text || "");
    if (filterResult) {
      console.log(`[filter] Skipping ${filterResult} message from ${normFrom}`);
      isProcessing = false;
      return;
    }
  }

  // Group message security: check for prompt injection from non-Caleb contacts
  if (isGroup && !isCaleb) {
    const safety = checkGroupMessageSafety(text, isCaleb);
    if (!safety.safe) {
      console.warn(
        `[security] Blocked injection attempt from ${normFrom}: ${safety.reason}`,
      );
      // Still save to history for context, but don't respond
      const cachedConvo = conversationMemoryCache.get(chatKey);
      if (cachedConvo) {
        cachedConvo.data = [
          ...cachedConvo.data,
          {
            role: "user",
            from: normFrom,
            senderLabel: normFrom,
            content: "[message blocked by safety filter]",
            timestamp: new Date().toISOString(),
          },
        ].slice(-50);
        cachedConvo.fetchedAt = Date.now();
      }
      isProcessing = false;
      return;
    }
  }

  // ── Trip-planning v2: handshake + opt-in detection (decision 14) ──────
  // flaw #97 — extracted to lib/bootstrap-prepass.js. The extracted
  // module returns { handled, text } so we can short-circuit the turn
  // when it posts the handshake / alias confirmation, and pick up any
  // text mutation (pending-ask replay after opt-in).
  //
  // flaw #103 — Loop assigns a groupId to ANY multi-recipient thread,
  // including the 2-person threads iMessage sometimes identifies as
  // "groups" but that humans experience as DMs. The handshake + opt-in
  // flow is for REAL groups (3+ humans) where we need consent before
  // DMing individuals. For a 1:1 — even one Loop calls a group — the
  // welcome message and the awaitingAlias capture just block the user's
  // actual question. If there's Medha + exactly one other participant,
  // treat the chat as 1:1 and skip the prepass entirely.
  const otherParticipantCount = Array.isArray(participants)
    ? participants.filter(
        (p) =>
          normalizeHandle(typeof p === "string" ? p : p?.handle) !==
          normalizeHandle(tenant?.loopSenderPhone || ""),
      ).length
    : null;
  const isTrueGroup =
    isGroup && (otherParticipantCount === null || otherParticipantCount >= 2);

  // flaw #104 — LLM owns the response. The bootstrap-prepass used to
  // short-circuit on first-touch and post a hardcoded welcome template,
  // which intercepted the user's actual question. That UX was wrong:
  // Medha is an LLM agent, not a canned-text dispenser. The handshake
  // and opt-in info now flow through the system prompt instead, so the
  // model can introduce itself naturally AND answer the user's question
  // in the same turn.
  //
  // We still RUN the prepass for state tracking (record opt-in/opt-out
  // signals on 👍 / "no", capture pendingAsks, mirror group rows to BQ
  // for the admin dashboard) — we just don't let it send the canned
  // welcome and we don't let it short-circuit the turn.
  if (isTrueGroup) {
    try {
      const { runBootstrapPrePass } =
        await import("./lib/bootstrap-prepass.js");
      // No-op sendMessage: prevent the prepass from posting the
      // hardcoded handshake. Internal state writes still happen.
      const noopSend = async () => {};
      const bpResult = await runBootstrapPrePass({
        groupId,
        normFrom,
        tenant,
        text,
        sendMessage: noopSend,
        sendOpts,
        messageId,
      });
      if (bpResult?.text) text = bpResult.text;
    } catch (err) {
      console.warn("[prepass] non-fatal:", err?.message || err);
    }

    // ── Phase 5: commitment extractor (decision 9, decision 21) ──────────
    // Fire-and-forget LLM pass on every group inbound. If the speaker
    // committed to something ("I'll bring speakers"), we write a row to
    // event_messages with direction='commitment'. Caller (or the
    // dashboard) can read this and surface conflicts. Skipped when the
    // group has no active event id we know about — Phase 2/3 still needs
    // to wire current_event_id into group memory; for now we run the
    // extractor anyway and tag with the most recent event id from BQ
    // (look-up done inside maybeRecordCommitment via group → events).
    try {
      const { isExtractorEnabled, maybeRecordCommitment } =
        await import("./lib/commitment-extractor.js");
      if (isExtractorEnabled() && text && normFrom) {
        // The "active event" lookup is the missing piece — until Phase
        // 5b lands a group → current_event resolver, we treat groups
        // with no recent event_create as "no event active" and skip.
        // The eventId is read from groupMem.currentEventId if the
        // bootstrap pre-pass set it; otherwise null skips the call.
        const { loadGroupMemory } = await import("./lib/group-memory.js");
        const groupMemForCommit = await loadGroupMemory(groupId, tenant).catch(
          () => null,
        );
        const activeEventId = groupMemForCommit?.currentEventId || null;
        if (activeEventId) {
          maybeRecordCommitment({
            text,
            eventId: activeEventId,
            personHandle: normFrom,
            recentMessages: (
              conversationMemoryCache.get(chatKey)?.data || []
            ).slice(-6),
          })
            .then((res) => {
              if (res?.commitmentId) {
                console.log(
                  `[commitment] ${normFrom} → ${res.item} (${res.certainty}) ${res.commitmentId} on ${activeEventId}`,
                );
              }
            })
            .catch(() => {});
        }
      }
    } catch {}
  }

  // Group routing: deterministic social governor + AI "reading the room"
  // router decide whether THIS agent should reply. The governor handles
  // the failure modes that hurt most in 2-agent (Camber + Samber) chats:
  // shutdown cues, the other agent already answered, and so on.
  let groupResponseStyle = null;
  let groupFocusClause = null;
  if (isGroup) {
    const agentName = getAgentName(tenant);
    const recentHistory = (
      conversationMemoryCache.get(chatKey)?.data || []
    ).slice(-10);
    const routerResult = await shouldAmberReplyInGroup(
      text,
      normFrom,
      recentHistory,
      isCaleb,
      agentName,
    );
    const shouldReply = routerResult?.shouldReply === true;
    groupResponseStyle = routerResult?.responseStyle || null;
    groupFocusClause = routerResult?.focusClause || null;

    if (!shouldReply) {
      console.log(
        `⏭️ [GROUP ${groupId}] AI router: skip — "${text.substring(0, 50)}"`,
      );
      // Still save to cache so context is preserved for future messages
      const cachedConvo = conversationMemoryCache.get(chatKey);
      if (cachedConvo) {
        cachedConvo.data = [
          ...cachedConvo.data,
          {
            role: "user",
            from: normFrom,
            senderLabel: normFrom,
            content: text,
            timestamp: new Date().toISOString(),
          },
        ].slice(-50);
        cachedConvo.fetchedAt = Date.now();
      }
      isProcessing = false;
      return;
    }
    console.log(
      `✅ [GROUP ${groupId}] AI router: reply — "${text.substring(0, 50)}"`,
    );
  }

  // ── Opt-out: "stop", "leave me alone", "don't text me" (#84) ───────────────
  // Decision 14: STOP is universal mute. We add the sender to the
  // global suppression list so dm_each_in_group skips them across
  // ALL groups going forward, not just this DM thread. They can opt
  // back in by typing YES (handled in the bootstrapping pre-pass for
  // group DMs, or by texting YES directly here).
  if (
    !isCaleb &&
    /^\s*(stop|unsubscribe|leave me alone|don'?t (text|message|contact) me|remove me|opt.?out)\s*\.?$/i.test(
      text,
    )
  ) {
    try {
      const { addSuppression } = await import("./lib/suppressions.js");
      addSuppression(normFrom);
      console.log(`[suppression] ${normFrom} added to global STOP list`);
    } catch {}
    await sendMessage(
      normFrom,
      "Got it, I won't reach out. If you ever want to chat just text me.",
      sendOpts,
    );
    isProcessing = false;
    return;
  }

  // YES from a previously-STOPped contact lifts the suppression so
  // dm_each can DM them again.
  if (!isCaleb && /^\s*(yes|y|opt[\s-]?in)\s*[!.]*\s*$/i.test(text)) {
    try {
      const { isSuppressed, removeSuppression } =
        await import("./lib/suppressions.js");
      if (isSuppressed(normFrom)) {
        removeSuppression(normFrom);
        console.log(`[suppression] ${normFrom} opted back in`);
        // Don't return — let the AI loop run normally so Medha can
        // acknowledge. The opt-back-in is a side effect of the YES,
        // not the whole turn.
      }
    } catch {}
  }

  // ── SAFE keyword: harm-reduction support (festival / event MVP) ─────────
  // Standalone "SAFE" is the safety pull-cord. We always respond with the
  // same calm harm-reduction script, never drug sourcing, dosing, or
  // medical advice. Fires before the LLM so the response is fast and
  // deterministic. Caleb 2026-05-27: must fire in groups too. Skipping
  // only the tenant owner so safety messages don't echo back to ourselves
  // during testing.
  if (!isCaleb && matchesSafeKeyword(text)) {
    console.log(`[SAFE] keyword from ${normFrom} group=${isGroup}`);
    await sendMessage(normFrom, buildSafeKeywordReply(), sendOpts);
    isProcessing = false;
    return;
  }

  // Sign-in opt-in fast path was hoisted to the top of this handler
  // (right after isCaleb computed). If it fired, we already returned.
  // Removing the duplicate slow-path here.

  // ── Substance mention: redirect to safety (festival / event MVP) ────────
  // Whenever someone mentions a substance, we deflect to harm-reduction
  // instead of letting the LLM extemporize. Urgent signals get the
  // shorter "go to medical / call 911 now" variant. Never sources, doses,
  // or endorses use. Caleb 2026-05-27: fires in groups too.
  if (!isCaleb && mentionsSubstance(text)) {
    const urgent = isUrgentSubstanceSignal(text);
    console.log(
      `🛟 [SUBSTANCE] redirect from ${normFrom}${urgent ? " (urgent)" : ""}`,
    );
    await sendMessage(
      normFrom,
      buildSubstanceRedirectReply({ urgent }),
      sendOpts,
    );
    isProcessing = false;
    return;
  }

  // ── Share Amber's contact card (vCard) ──────────────────────────────────
  // EDC / event scenario: people meet Amber's owner, get told to text the
  // Amber number, and want the contact saved with one tap. Deterministic
  // pre-LLM match so the LLM can't paraphrase the request into prose.
  // DMs only; skip the owner. If no vCard URL can be built (missing
  // tenant.loopSenderId), fall through to the LLM rather than promise
  // a card we can't deliver.
  if (!isCaleb && !isGroup && wantsVcardShare(text)) {
    const vcardUrl = buildVcardUrl(tenant);
    if (vcardUrl) {
      console.log(`[vcard] share intent from ${normFrom} -> ${vcardUrl}`);
      await sendMessage(normFrom, buildVcardShareReply(), {
        ...sendOpts,
        contactFile: vcardUrl,
      });
      isProcessing = false;
      return;
    }
    console.warn(
      `[vcard] share intent from ${normFrom} but no loopSenderId on tenant — falling through`,
    );
  }

  // ── First-contact greeting + first-name gate (festival / event MVP) ─────
  // For brand-new contacts (no displayName yet, <=1 message in), send a
  // warm, consent-aware opener that asks for the first name before going
  // deeper. We persist `festivalGreetedAt` on the contact so we only do
  // this once. If the next reply looks like a name, we store it as
  // displayName. DMs only; not for the tenant owner.
  //
  // Medha expert mode SKIPS this gate entirely: Medha is a public-facing
  // agent, every texter is a "stranger" by definition, and the festival
  // SAFE-keyword copy is tenant-specific. The expert-mode prompt handles
  // greetings itself.
  if (!isCaleb && !isGroup && !tenant?.expertMode) {
    try {
      const earlyContact = await loadContact(normFrom, tenant).catch(
        () => null,
      );
      const isOwner = !!earlyContact?.isCaleb;
      if (
        shouldSendFirstContactGreeting({
          contact: earlyContact,
          isGroup,
          isOwner,
        })
      ) {
        // First-contact greeting goes to a STRANGER who has no idea who
        // Camber/Samber even are. Brand it with the public product name
        // (Medha) unless the tenant explicitly opts in to the internal
        // persona name for dev testing.
        const agentName = getPublicAgentName(tenant);
        // Attach the Amber vCard on the very first contact so EDC /
        // event recipients can save the number with one tap before they
        // even reply with their name. Skip cleanly when no URL can be
        // built so we never promise a card we can't deliver.
        const vcardUrl = buildVcardUrl(tenant);
        const greetOpts = vcardUrl
          ? { ...sendOpts, contactFile: vcardUrl }
          : sendOpts;
        await sendMessage(
          normFrom,
          buildFirstContactGreeting({ agentName }),
          greetOpts,
        );
        const stamped = {
          ...(earlyContact || { handle: normFrom }),
          festivalGreetedAt: new Date().toISOString(),
          messageCount: (earlyContact?.messageCount || 0) + 1,
        };
        await saveContact(normFrom, stamped, tenant).catch(() => {});
        isProcessing = false;
        return;
      }
      // If we greeted previously and still don't know their name, try to
      // extract one from this reply before falling through to the LLM.
      if (
        earlyContact &&
        earlyContact.festivalGreetedAt &&
        !earlyContact.displayName
      ) {
        const maybeName = extractFirstNameFromReply(text);
        if (maybeName) {
          await saveContact(
            normFrom,
            { ...earlyContact, displayName: maybeName },
            tenant,
          ).catch(() => {});
          console.log(
            `[first-contact] learned name "${maybeName}" for ${normFrom}`,
          );
        }
      }
    } catch (err) {
      console.warn(`[first-contact] threw: ${err.message}`);
    }
  }

  // ── Crisis detection: mental health emergency (#21, #25, #30) ───────────────
  // Fires BEFORE the main Claude call so response is immediate and Caleb is alerted
  // CRISIS_PATTERNS is imported from lib/safety.js. DO NOT redefine inline
  // here — a loose inline version matched 'help me' as a naked token and
  // fired the 988 response on 'help me manage my sales pipeline'. The
  // imported pattern only matches real self-harm / emergency phrasing.
  //
  // Additional guards:
  //   - Skip if sender is the tenant owner (Caleb / Sagar testing).
  //   - Skip if sender is another active tenant owner (partner testing).
  // Caleb 2026-05-27: fires in groups too. The "false positives embarrass"
  // worry is real but mute: CRISIS_PATTERNS is tight enough (real
  // self-harm / emergency phrasing only) that a group false-positive is
  // worth the cost of catching a real one in a public thread.
  if (!isCaleb && CRISIS_PATTERNS.test(text)) {
    let senderIsTenantOwner = false;
    try {
      const allTenants = await listActiveTenants(null).catch(() => []);
      const fromNorm = normalizeHandle(normFrom);
      senderIsTenantOwner = (allTenants || []).some(
        (t) => t?.phoneNumber && normalizeHandle(t.phoneNumber) === fromNorm,
      );
    } catch {
      senderIsTenantOwner = false;
    }
    if (senderIsTenantOwner) {
      console.log(
        `[CRISIS] skipped — ${normFrom} is another tenant owner, treating as normal traffic`,
      );
    } else {
      console.log(`🚨 [CRISIS] Detected crisis signal from ${normFrom}`);
      // Alert owner immediately
      const crisisAlertPhone = tenant?.phoneNumber || CALEB_PHONE;
      sendMessage(
        crisisAlertPhone,
        `🚨 Someone may need help. ${normFrom} just texted: "${text.slice(0, 200)}"`,
        sendOpts,
      ).catch(() => {});
      // Respond with human warmth + real resources — NOT a task list
      await sendMessage(
        normFrom,
        "Hey, I hear you. That sounds really hard. Please reach out to someone who can actually be there with you — the 988 Suicide & Crisis Lifeline (call or text 988) is available 24/7. You don't have to figure this out alone.",
        sendOpts,
      );
      isProcessing = false;
      return;
    }
  }

  // ── Rave Master v1 (Sagar-only, EDC 2026) ──────────────────────────────
  // Gated by RAVE_MASTER_ENABLED + tenant.phoneNumber === Sagar's. Runs
  // after every safety filter above. For trusted friends, returns the
  // latest plan and notifies Sagar. For unknowns, asks who they are and
  // notifies Sagar. For group messages, drafts an approval message to
  // Sagar's DM and never auto-sends. Returns {handled:true} when it
  // owns the turn; the caller short-circuits the LLM path in that case.
  try {
    const raveResult = await handleRaveInbound({
      tenant,
      fromHandle: normFrom,
      text,
      isOwner: isCaleb,
      isGroup,
      groupId,
      sendOpts,
    });
    if (raveResult?.handled) {
      isProcessing = false;
      return;
    }
  } catch (err) {
    console.warn(`[rave-master] handler threw: ${err.message}`);
  }

  // ── "Tell Caleb X" relay (#34) ───────────────────────────────────────────────
  if (!isCaleb && !isGroup) {
    const relayMatch = text.match(
      /^(tell|let|can you tell|please tell)\s+caleb\s+(.+)$/i,
    );
    if (relayMatch) {
      const senderLabel =
        (
          await loadContact(normFrom, tenant).catch(() => ({
            handle: normFrom,
          }))
        ).displayName || normFrom;
      const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;
      // Owner-alert send must carry the tenant — transport throws if
      // loopSenderId is missing. Strip the inbound replyToId so the
      // relay to the owner isn't threaded into the stranger's bubble.
      const ownerOpts = {
        tenant,
        auditOrigin: "webhook",
        webhookContact: normFrom,
      };
      await Promise.all([
        sendMessage(
          ownerPhone,
          `📩 Message from ${senderLabel} (${normFrom}): "${relayMatch[2].trim()}"`,
          ownerOpts,
        ),
        sendMessage(normFrom, "Passed it along to Caleb!", sendOpts),
      ]);
      isProcessing = false;
      return;
    }
  }

  // Retreat mode: DMs only, non-organizer. Organizer gets a summary on demand.
  // This runs before the main Claude call so retreat questions take priority.
  if (!isGroup) {
    // Organizer summary request
    if (
      isRetreatOrganizer(normFrom) &&
      /retreat\s*summary|give me.*summary|summary.*retreat/i.test(text)
    ) {
      const summary = buildRetreatSummary();
      await sendMessage(normFrom, summary, sendOpts);
      isProcessing = false;
      return;
    }
    // Organizer activate/deactivate
    if (
      isRetreatOrganizer(normFrom) &&
      /activate retreat|retreat on/i.test(text)
    ) {
      const retreatConfig = await loadRetreatConfig().catch(() => null);
      if (retreatConfig) {
        retreatConfig.active = true;
      }
      await sendMessage(
        normFrom,
        "Retreat mode activated. Everyone who DMs Amber will get the question sequence.",
        sendOpts,
      );
      isProcessing = false;
      return;
    }
    if (
      isRetreatOrganizer(normFrom) &&
      /deactivate retreat|retreat off/i.test(text)
    ) {
      const retreatConfigOff = await loadRetreatConfig().catch(() => null);
      if (retreatConfigOff) {
        retreatConfigOff.active = false;
      }
      await sendMessage(
        normFrom,
        "Retreat mode deactivated. Amber is back to normal.",
        sendOpts,
      );
      isProcessing = false;
      return;
    }
    // Non-organizer participant sequencing
    const retreatResult = await handleRetreatMessage(normFrom, text);
    if (retreatResult.handled) {
      let retreatReply = retreatResult.reply
        .replace(/\u2014/g, ",")
        .replace(/ -- /g, ", ");
      await sendMessage(normFrom, retreatReply, sendOpts);
      isProcessing = false;
      return;
    }
  }

  // ── Calendar runtime pre-pass (CALENDAR-FIRST-SAMBER.md) ─────────────
  // When AMBER_CALENDAR_RUNTIME_ENABLED is on (or the tenant has an
  // override), classify the inbound for calendar intent before invoking
  // the AI loop. Reads are answered via the provider seam; mutations are
  // stopped at the confirmation gate. Unknown / low-confidence falls
  // through to the existing assistant path unchanged.
  try {
    const calendarOutcome = await maybeHandleCalendarMessage({
      tenant,
      text,
      isOwner: !!isCaleb,
      reply: (msg) => sendMessage(normFrom, msg, sendOpts),
    });
    if (calendarOutcome.handled) {
      logInteractionToSupabase(
        normFrom,
        text,
        `[calendar:${calendarOutcome.intent}:${calendarOutcome.tier}]`,
        "calendar-runtime",
        tenant,
      ).catch(() => {});
      isProcessing = false;
      return;
    }
  } catch (err) {
    // Never let the pre-pass take down the message loop. Log and fall
    // through to the normal AI path so the user still gets a reply.
    console.warn(`[calendar-runtime] pre-pass failed: ${err.message}`);
  }

  try {
    const _startMs = Date.now(); // track response latency
    const isComplex = text.length > 200 || text.split(/\band\b|,/).length > 3;
    // Only send the thinking indicator in DMs — in group chats it feels spammy
    if (isComplex && !isGroup) {
      // Must pass sendOpts (tenant), not {} — transport throws without
      // a resolved tenant. Empty opts here was nuking complex inbounds
      // (anything 200+ chars OR containing 3+ commas) with "Something
      // went wrong" because the catch below catches the transport throw.
      //
      // flaw #84 — the thinking indicator is NOT a reply to the inbound,
      // it's a standalone status bubble. Strip replyToId so iMessage
      // doesn't render the "↳ in reply to X" tag on a "one sec…" filler.
      const thinkingOpts = { ...sendOpts, replyToId: undefined };
      await sendMessage(normFrom, "⏳ One sec, on it...", thinkingOpts);
    }

    // Load everything in parallel — contact, history, context, session, and
    // Perplexity-embedding semantic memory recall, all at once. Every loader
    // that touches Supabase must receive `tenant` so rows are scoped to the
    // right identity. Without tenant, reads/writes drift across tenant_ids.
    const [
      contact,
      history,
      calebContext,
      relevantRecall,
      clayProfile,
      userSession,
      healthProfile,
      senderMemory,
      groupMemoryRecall,
    ] = await Promise.all([
      loadContact(normFrom, tenant),
      loadConversationHistory(chatKey, tenant),
      isCaleb || isGroup ? loadAmberContext(tenant) : Promise.resolve(""),
      isCaleb || isGroup
        ? fetchRelevantContext({ tenant, query: text, topK: 8 })
        : Promise.resolve(""),
      !isCaleb ? getClayProfile(normFrom) : Promise.resolve(null),
      !isCaleb ? loadUserSession(normFrom, tenant) : Promise.resolve(null),
      loadHealthProfile(normFrom, tenant),
      searchMemories(text, normFrom, 5, tenant).catch(() => []),
      // In group chats also pull tenant-wide memories (handle=null) so
      // Amber can recall facts about any participant or prior group topic,
      // not just the current speaker.
      isGroup
        ? searchMemories(text, null, 5, tenant).catch(() => [])
        : Promise.resolve([]),
    ]);
    // Merge sender-scoped and group-scoped memories, dedup by id or content.
    const seenMem = new Set();
    const memorySnippets = [...senderMemory, ...groupMemoryRecall].filter(
      (m) => {
        const key = m.id || m.content;
        if (!key || seenMem.has(key)) return false;
        seenMem.add(key);
        return true;
      },
    );
    contact.messageCount = (contact.messageCount || 0) + 1;

    // Intent parsing — resolve yes/no to pending actions, detect commands
    let detectedIntent = null;
    if (!isCaleb && !isGroup && userSession) {
      detectedIntent = parseIntent(text, userSession.pending_action);
      if (
        detectedIntent.type === "confirm" ||
        detectedIntent.type === "deny" ||
        detectedIntent.type === "maybe"
      ) {
        await clearPendingAction(normFrom, tenant);
      }
    }

    // Check-in parsing: focused scheduler replies take priority over generic parser
    if (isCaleb && !isGroup) {
      const checkinPhone = tenant?.phoneNumber || CALEB_PHONE;
      const handledByScheduler = await maybeHandleCheckinReply(
        checkinPhone,
        text,
        tenant,
      ).catch(() => false);

      if (!handledByScheduler) {
        // Fallback: legacy all-dimensions parser still works
        const checkinScores = parseCheckinReply(text);
        if (checkinScores) {
          saveHealthCheckin(
            checkinPhone,
            checkinScores,
            "self_report",
            text,
          ).catch(() => {});
        }
      }
    }

    contact.isCaleb = isCaleb;

    // Record reply for proactive outreach tracking (resets unanswered count)
    if (!isCaleb && !isGroup) {
      recordReply(normFrom, tenant);
    }

    // BMA prospect routing: notify deal team Slack when a prospect replies
    if (BMA_SLACK_WEBHOOK && isBmaProspect(contact) && !isCaleb && !isGroup) {
      postSlack(
        BMA_SLACK_WEBHOOK,
        `BMA Prospect replied: ${contact.displayName || normFrom} (${normFrom})\nMessage: "${text.slice(0, 500)}"`,
      ).catch(() => {});
    }

    // Track which groups this contact has appeared in (#7 — group↔DM memory bridge)
    if (isGroup && groupId) {
      const knownGroups = contact.seenInGroups || [];
      if (!knownGroups.includes(groupId)) {
        contact.seenInGroups = [...knownGroups, groupId].slice(-10); // keep last 10 groups
      }
    }

    // Detect brand-new groups (no history yet) before pushing the incoming message
    // Guard: if the sender has a high messageCount they've talked to Amber before
    // — history may have just been cleared, don't spam a re-intro
    const isNewGroup =
      isGroup && history.length === 0 && (contact.messageCount || 0) <= 1;

    // Append incoming message
    const senderLabel = contact.displayName || normFrom;
    const incomingEntry = {
      role: "user",
      from: normFrom,
      senderLabel,
      content: text,
      timestamp: new Date().toISOString(),
      messageId: messageId || null,
    };
    history.push(incomingEntry);

    // ── EMOTION CLASSIFICATION (fire-and-forget, awaited before model call) ──
    // Tag every non-Caleb substantive message with an emotion label. The
    // classifier is Sonar-based and context-aware, so we pass a slice of
    // recent history. Result is stored on the message + used to (a) nudge
    // the Emotional health dim and (b) inject a calibration hint into
    // Camber's system prompt. We DON'T block on it — Promise is awaited
    // later, just before the model is called.
    let emotionPromise = null;
    if (!isCaleb && shouldClassifyEmotion(text)) {
      emotionPromise = classifyEmotion(text, {
        speaker: senderLabel,
        recentMessages: history.slice(-5, -1),
      }).catch((e) => {
        console.warn("[emotion] bg error:", e.message);
        return null;
      });
    }

    // ── FEEDBACK LOOP (fire-and-forget) ──
    // If this incoming message looks like a reaction to Amber's last
    // reply in this chat (praise/criticism/tapback), log it to amber-id.
    try {
      captureReaction({
        chatKey,
        from: normFrom,
        text,
        tapbackType: null, // text webhook — reactions arrive as a separate event
        replyToId,
        tenant,
      }).catch((e) => console.warn("[feedback] bg error:", e.message));
    } catch (e) {
      console.warn("[feedback] trigger error:", e.message);
    }

    // Build Claude conversation with compression for long histories
    // For groups: extract self-introductions from FULL history so the model sees
    // real names (e.g. "[Charles said]:") instead of raw phone numbers everywhere
    const extractedNames = isGroup
      ? extractNamesFromHistory(history)
      : new Map();

    const { summary: conversationSummary, recentMessages } =
      await compressConversation(chatKey, history);
    let claudeMessages;
    if (conversationSummary) {
      // Use compressed format: summary + recent verbatim, with extracted names applied
      claudeMessages = buildCompressedMessages(
        conversationSummary,
        recentMessages.map((m) => ({
          ...m,
          isGroup,
          // Override senderLabel with extracted name if available
          senderLabel:
            (isGroup && extractedNames.get(m.from)) || m.senderLabel || m.from,
        })),
      );
      console.log(
        `[compression] ${history.length} msgs -> summary + ${recentMessages.length} recent`,
      );
    } else {
      // Short history: use as-is, with security wrapping for non-Caleb group messages
      claudeMessages = history.slice(-20).map((m) => ({
        role: m.role,
        content:
          isGroup && m.role === "user"
            ? wrapGroupMessageAsConversation(
                m.content,
                extractedNames.get(m.from) || m.senderLabel || m.from,
                m.from === normalizeHandle(tenant?.phoneNumber || CALEB_PHONE),
              )
            : m.content,
      }));
    }

    // For group chats: load contact profiles for all participants so Amber knows their names
    let groupParticipantProfiles = [];
    if (isGroup && participants.length > 0) {
      const otherParticipants = participants
        .map((p) => normalizeHandle(String(p)))
        .filter(
          (p) => p !== normalizeHandle(tenant?.phoneNumber || CALEB_PHONE),
        ); // exclude bot's own number
      groupParticipantProfiles = await Promise.all(
        otherParticipants.map((p) =>
          loadContact(p, tenant).catch(() => ({ handle: p })),
        ),
      );
    }

    // Group↔DM memory bridge: if this is a DM and we've seen them in groups before,
    // pull their recent messages from those group threads and inject as prior context (#7)
    let groupMemoryContext = "";
    if (!isGroup && !isCaleb && contact.seenInGroups?.length > 0) {
      groupMemoryContext = await loadGroupContextForContact(
        normFrom,
        contact.seenInGroups,
        tenant,
      );
    }

    // Load group-level persistent memory for group chats
    let groupMemBlock = "";
    if (isGroup && groupId) {
      const groupMem = await loadGroupMemory(groupId, tenant);
      groupMemBlock = buildGroupMemoryBlock(groupMem);
      // Async: update group memory from conversation (runs in background every 10 msgs)
      updateGroupMemoryFromConversation(
        groupId,
        history.slice(-15),
        groupName,
        participants.map((p) => normalizeHandle(String(p))),
        tenant,
      ).catch(() => {});
    }

    // Build system prompt (Caleb gets full Amber, others get helpful assistant)
    // Layered context: global Amber -> query-relevant recall from Pinecone
    // -> group memory -> per-contact (with reflection + compression).
    const mergedContext = relevantRecall
      ? `${calebContext}\n\n# RELEVANT TO THIS MESSAGE\n\n${relevantRecall}`
      : calebContext;
    // Per-tenant OAuth connection state. discoverConnections reads the
    // same secrets bag the tools authenticate against, so the capability
    // block is always in sync with what the tools can actually do. Best-
    // effort: if amber-id is degraded, every service reports disconnected
    // and the agent falls back to "attempt the tool, surface its link" —
    // never lies about not having calendars / email / etc.
    const userConnections = await discoverConnections(tenant).catch((err) => {
      console.warn(
        "[agent] discoverConnections failed:",
        err && err.message ? err.message : err,
      );
      return null;
    });

    let systemPrompt = buildSystemPromptForSender(
      mergedContext,
      contact,
      isCaleb,
      isGroup,
      groupName,
      groupParticipantProfiles,
      isNewGroup,
      groupMemoryContext,
      lastCalebActivityMs,
      conversationSummary || "",
      tenant,
      userConnections,
      { senderIsOwner, transportKind },
    );

    // Inject group-level memory into system prompt
    if (groupMemBlock) {
      systemPrompt += `\n${groupMemBlock}`;
    }

    // Greeting-reset directive: when the deterministic governor flags this
    // turn as a casual greeting / "what's good" / "wyd" addressed to us in
    // a group, force a topic reset. We MUST NOT continue stale plans,
    // venues, weather, or earlier recommendations, and MUST NOT end with a
    // substantive planning question. Output is a tiny matched-tone greeting.
    if (isGroup && groupResponseStyle === "greeting-reset") {
      systemPrompt += `\n\n[GREETING RESET — HIGHEST PRIORITY, OVERRIDES EVERYTHING ABOVE]
The newest human message is a casual greeting / check-in (e.g. "yo what's good", "wyd", "how are you"). Treat the topic as RESET. Earlier conversation context is STALE and MUST be ignored when composing this reply.

Reply with at most ONE short, casual greeting (e.g. "yo" / "ayy what's good" / "hey hey"). Match the human's tone and length. Do NOT:
- bring up venues, neighborhoods, rooftops, bars, restaurants, or any prior plan or recommendation (Altitude, Gaslamp, bay cruise, artisan market, rooftop, etc.)
- mention the weather, day of week, or time-of-day suggestions
- propose plans or ask "y'all pulling the trigger / down for / wanna" style planning questions
- end the message with a substantive question (a tiny "you?" or "wbu?" is fine)
- reference, address, or build on the other AI agent's prior message
- include web facts, recommendations, or local info
Just greet warmly and stop. The human will steer the conversation if they want one.`;
    }

    // Multi-addressed message: the human directed a distinct ask at each
    // named agent (e.g. "Camber what about cows? Samber what about pigs?").
    // Force this agent to answer ONLY its own clause and ignore the peer's.
    if (
      isGroup &&
      groupResponseStyle === "multi-addressed" &&
      groupFocusClause
    ) {
      const agentName = getAgentName(tenant);
      systemPrompt += `\n\n[MULTI-ADDRESSED MESSAGE — HIGHEST PRIORITY, OVERRIDES EVERYTHING ABOVE]
The human's newest message addresses MULTIPLE agents in a single text, with a SEPARATE ask for each. Your clause is the ONLY part you answer. The peer agent will handle their own clause separately.

YOUR CLAUSE (this is the only ask you answer):
"${groupFocusClause.replace(/"/g, '\\"')}"

Rules:
- Answer ONLY the question/ask in YOUR clause above.
- Do NOT answer, repeat, paraphrase, or build on the OTHER agent's clause.
- Do NOT mention the other agent or their topic by name.
- Do NOT acknowledge that the message also addressed someone else.
- Reply directly and substantively to your own clause as ${agentName} would normally answer it. The peer agent ALWAYS replies to their clause too — it is not your job to cover for them.`;
    }

    // Inject Perplexity-embedding semantic memory: facts, prior exchanges,
    // and relationship notes that match this incoming message. Gives Amber
    // long-term recall beyond the last N messages in history.
    if (Array.isArray(memorySnippets) && memorySnippets.length > 0) {
      const lines = memorySnippets
        .slice(0, 5)
        .map((m) => {
          const who = m.handle ? `[${m.handle}] ` : "";
          const cat = m.category ? `(${m.category}) ` : "";
          return `- ${who}${cat}${m.content}`;
        })
        .join("\n");
      systemPrompt += `\n\nSEMANTIC MEMORY (long-term recall, ranked by relevance):\n${lines}\nUse these when relevant. They are authoritative, not hearsay.`;
    }

    // Inject personality mode (professional/casual/spiritual/supportive)
    if (!isCaleb) {
      const mode = inferPersonalityMode(contact, text, isGroup, groupName);
      const styleGuide = getPersonalityStyleGuide(mode);
      if (styleGuide) {
        systemPrompt += styleGuide;
        console.log(
          `[personality] Mode: ${mode} for ${contact.displayName || normFrom}`,
        );
      }
    }

    // Inject matched skills based on message content
    const matchedSkills = findRelevantSkills(text);
    if (matchedSkills.length > 0) {
      systemPrompt += buildSkillBlock(matchedSkills);
      console.log(
        `[skills] Activated: ${matchedSkills.map((s) => s.name).join(", ")}`,
      );
    }

    // Inject per-tenant writing doctrine (Shirley's 4 rules + per-org
    // overrides) when the inbound text reads as a long-form writing task.
    // Gated by isWritingTask so iMessage chitchat does not pin BMA voice.
    const writingDoctrineBlock = buildWritingDoctrineBlock(tenant, text);
    if (writingDoctrineBlock) {
      systemPrompt += writingDoctrineBlock;
      console.log(
        `[writing-doctrine] Injected for tenant=${tenant?.id || "unknown"}`,
      );
    }

    // Inject recent message IDs so Amber can:
    //   - tapback specific past messages ([react:TYPE:id])
    //   - thread-reply inline to specific messages ([reply:id])
    // Inject for Caleb's DMs AND for group chats (Caleb or others can ask
    // Amber to thread in the group — without the IDs block, she knows the
    // [reply:id] syntax from the prompt but has no IDs to plug in).
    // Other non-Caleb DMs: skip to keep the prompt lean and because those
    // contacts don't issue targeted reply commands.
    if (isCaleb || isGroup) {
      const recentIdsBlock = buildRecentMessageIdsBlock(history, 10);
      if (recentIdsBlock) systemPrompt += recentIdsBlock;
    }

    // Inject Clay CRM, session state, intent context, staleness for non-Caleb contacts
    if (!isCaleb) {
      const extraContext = [];
      // Staleness check on contact notes
      const staleWarning = buildStalenessWarning(contact);
      if (staleWarning) extraContext.push(staleWarning);
      if (clayProfile) extraContext.push(`Clay CRM: ${clayProfile}`);
      if (contact.howCalebtexts)
        extraContext.push(
          `How Caleb typically texts this person: ${contact.howCalebtexts}`,
        );
      if (contact.trustScore > 0.7)
        extraContext.push("Trusted contact, auto-reply approved.");
      if (
        userSession?.personality_profile &&
        Object.keys(userSession.personality_profile).length > 0
      ) {
        extraContext.push(
          `Learned personality profile: ${JSON.stringify(userSession.personality_profile)}`,
        );
      }
      if (
        userSession?.conversation_state &&
        Object.keys(userSession.conversation_state).length > 0
      ) {
        extraContext.push(
          `Current conversation state: ${JSON.stringify(userSession.conversation_state)}`,
        );
      }
      if (detectedIntent && detectedIntent.type !== "chat") {
        extraContext.push(
          `Detected intent: ${detectedIntent.type}${detectedIntent.action ? ` (resolving pending: ${JSON.stringify(detectedIntent.action)})` : ""}`,
        );
      }
      // Inject health profile with calibrated response guidance
      if (healthProfile) {
        const scores = HEALTH_DIMS.filter((d) => healthProfile[d] !== null)
          .map((d) => `${d} ${healthProfile[d]}/10`)
          .join(", ");
        if (scores) {
          extraContext.push(
            `HEALTH PROFILE: ${scores}. Overall: ${healthProfile.overall_score || "?"}/10.`,
          );
          const guidance = healthResponseGuidance(healthProfile);
          if (guidance)
            extraContext.push(`HEALTH RESPONSE CALIBRATION:\n${guidance}`);
        }
      }
      if (extraContext.length) systemPrompt += `\n\n${extraContext.join("\n")}`;
    }

    // Tool-result contract for missing OAuth credentials. When a tool
    // returns { user_action_required: 'connect_oauth', reply_template, ... }
    // it means the user has NOT yet linked the underlying service (Google
    // Calendar, Gmail, Slack, etc) to their medha-id. The right behavior
    // is to tell the user the reply_template verbatim — never retry, never
    // apologize abstractly, never pretend you tried something else.
    systemPrompt += `\n\nCONNECTION-AWARE TOOL USE:
- Before reasoning about whether a service is available, just try the tool. The dispatcher knows whether the user has connected it.
- If a tool result is { user_action_required: 'connect_oauth', reply_template: '<link>', ... }, your reply MUST be the reply_template string verbatim. Do not paraphrase it, do not add 'Sorry,' or 'I tried but', do not ask the user a follow-up. Send the connect link and stop.
- Never make up calendar events, emails, or Slack messages. If the tool said you're not connected, surface the link; otherwise use the real data the tool returned.`;

    // For Caleb: inject his own health profile with guidance
    if (isCaleb && healthProfile) {
      const scores = HEALTH_DIMS.filter((d) => healthProfile[d] !== null)
        .map((d) => `${d}: ${healthProfile[d]}/10`)
        .join(", ");
      if (scores) {
        const guidance = healthResponseGuidance(healthProfile);
        systemPrompt += `\n\nCALEB'S HEALTH (6 dimensions): ${scores}. Overall: ${healthProfile.overall_score}/10. Lowest: ${healthProfile.lowest_dimension || "unknown"}. Highest: ${healthProfile.highest_dimension || "unknown"}. Last check-in: ${healthProfile.last_checkin_date || "never"}.${guidance ? `\n${guidance}` : ""}\nEncourage check-in if it's been more than 1 day.`;
      }
    }

    // Tools enabled for Caleb (full set), AND for any Slack expert-mode
    // inbound (so Sagar/Shirley/etc. can actually trigger schedule_event,
    // reminders, etc. instead of getting "I have no tools" responses).
    // The system prompt + per-tool auth still gate destructive operations;
    // this just makes the tool surface visible to the LLM in the first place.
    //
    // No-owner model (2026-06-04): Medha has no owner. Every registered
    // medha-id (resolved tenant) gets the full functional surface, not just
    // Caleb or expert-mode tenants. Tools are enabled whenever we have a
    // resolved tenant; arming (lib/tool-arming.js) then exposes the full tool
    // set. Per-tenant secret/identity scoping still governs WHICH accounts a
    // tool acts on.
    const toolsEnabled = !!tenant;
    const allTools = toolsEnabled ? await getAllTools() : [];

    // Smart model routing: everything flows through callClaudeRaw, which
    // is Perplexity-only (Agent API for tools, Sonar for chat). Ollama is
    // a dev-only last resort handled downstream.
    const complexity = isCaleb
      ? "caleb"
      : classifyComplexity(text, contact, detectedIntent);
    const { model, maxTokens, useOllama } = resolveModel(
      complexity,
      isCaleb,
      isGroup,
    );
    console.log(
      `[model] ${normFrom} complexity=${complexity} model=${useOllama ? "ollama" : model}`,
    );

    const requestBody = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: claudeMessages,
      // Medha expert mode: force routing to Perplexity Agent (Claude) instead
      // of Sonar's web-grounded chat. Sonar otherwise web-searches "Medha"
      // and answers from search results, ignoring the system prompt's
      // "this is your name, not a topic" instruction.
      // Route to the Perplexity Agent (Claude) path whenever tools are armed,
      // so every tenant (no-owner model) gets real tool use instead of Sonar's
      // web-grounded chat answering "Medha" as a search topic.
      routeToAgent: toolsEnabled,
    };
    // Tool strategy (no-owner model, 2026-06-04): expose the FULL tool surface
    // to every enabled tenant. The old keyword-selected "~8 tools per turn"
    // sliver is gone — it routinely left tools dark when the selector missed a
    // phrasing ("I don't have that tool"). Arming runs through
    // lib/tool-arming.js so DM and group surfaces stay identical by
    // construction; anything that must vary by group/DM belongs in the prompt
    // layer or the tool handler's own ctx, not here.
    const isExpert = tenant?.expertMode === true;
    const armed = armTools({
      allTools,
      text,
      toolsEnabled,
      isExpert,
      // Transport parity: light up the always-armed banks (calendar +
      // partnership + personal-life) for any owner-sender, regardless of
      // window. Backward-compat: tool-arming.js still honors isExpert when
      // senderIsOwner is undefined.
      senderIsOwner,
      tenant,
      detectedIntent,
    });
    requestBody.tools = armed.tools;
    if (toolsEnabled) {
      console.log(`[tools] ${armed.summary}`);
    }

    // Prime the system prompt with the exact tools armed this turn so the
    // model sees them explicitly and actually invokes them instead of
    // hallucinating answers.
    if (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
      const toolList = requestBody.tools
        .filter((t) => t.name)
        .map((t) => {
          const desc = (t.description || "").slice(0, 140);
          return `- ${t.name}${desc ? ": " + desc : ""}`;
        })
        .join("\n");
      systemPrompt += `\n\nTOOLS YOU CAN CALL RIGHT NOW (invoke via function calling, do not describe them, just use them when the user asks something they'd help with):\n${toolList}\n\nIf the user asks about their calendar, email, tasks, files, GitHub, or anything stored outside this conversation, CALL the relevant tool. Do not guess, do not say "let me check", do not make up times or events. Call the tool, wait for the result, then answer from real data.`;

      // Hallucination guard: when calendar/email/files tools fire, the LLM
      // has BOTH the tool output AND the user's bio profile + Pinecone
      // recall + recent conversation context in its prompt. It will
      // sometimes glue extra events / threads / files into the answer
      // that came from memory, not from the tool. Caleb 2026-05-27 in a
      // group: list_events returned 4 real items, the LLM added a 5th
      // ('class 6-8am') invented from his Spring 2026 class list in the
      // bio profile. Add an explicit anti-fabrication clause so the
      // answer mirrors tool output and nothing else.
      const armedToolNames = new Set(
        requestBody.tools.filter((t) => t?.name).map((t) => t.name),
      );
      const externalReadTools = [
        "list_events",
        "get_availability",
        "gmail_search",
        "gmail_list",
        "drive_search",
        "drive_list_files",
      ];
      if (externalReadTools.some((name) => armedToolNames.has(name))) {
        systemPrompt += `\n\nDATA AUTHORITY:\nWhen a read tool (list_events, gmail_search, drive_search, etc.) returns a result, that result is the ONLY source for your answer about that data. Do NOT add events, emails, files, or facts from the bio profile, Pinecone recall, or earlier conversation. Do NOT invent times for items mentioned by name elsewhere in context (e.g. a class listed in the bio is not a calendar event unless list_events returned it). If the tool returns N items, answer with exactly those N items. If it returns 0, say the period is clear.`;
      }

      // Group regression band-aid: in group chats the LLM gets distracted by
      // the surrounding conversation and frequently narrates ("looks like
      // today is clear") instead of calling list_events even when the tool
      // is armed and the current speaker is the tenant owner. When the
      // CURRENT user turn matches a tool keyword and the matching tool is
      // armed, append a hard nudge naming the tool. This is targeted at
      // the calendar regression (Caleb 2026-05-27: "calendar works in DM,
      // not group") but applies to any tool surface so future regressions
      // of the same shape self-heal.
      if (isGroup) {
        const lowered = (text || "").toLowerCase();
        const toolNudges = [];
        const armedNames = new Set(
          requestBody.tools.filter((t) => t?.name).map((t) => t.name),
        );
        if (
          /\b(calendar|schedule|agenda|events?)\b/.test(lowered) &&
          armedNames.has("list_events")
        ) {
          toolNudges.push(
            "Most recent user turn asks about the calendar. CALL list_events NOW. Do not say 'looks clear' from memory. Wait for the real result and answer from it.",
          );
        }
        if (
          /\b(emails?|inbox|gmail)\b/.test(lowered) &&
          (armedNames.has("gmail_search") || armedNames.has("gmail_list"))
        ) {
          toolNudges.push(
            "Most recent user turn asks about email. CALL gmail_search or gmail_list NOW.",
          );
        }
        if (toolNudges.length > 0) {
          systemPrompt += `\n\nGROUPCHAT TOOL OVERRIDE:\n${toolNudges.join("\n")}`;
        }
      }

      requestBody.system = systemPrompt;
    }

    // ── SEARCH BRAIN: AI-powered search planning ──────────────────────────
    // Haiku analyzes the message, checks context, and decides what to search.
    // Replaces dumb regex with actual reasoning about intent + context.
    if (mightNeedSearch(text)) {
      const contextSnippet =
        isCaleb || isGroup
          ? calebContext
          : `${contact.displayName || contact.handle} (${contact.relationship || "unknown"})\nNotes: ${(contact.notes || []).map((n) => (typeof n === "object" ? n.fact : n)).join(", ")}`;

      // PROGRAMMATIC CONTEXT SCAN: extract lines mentioning key terms from the message.
      // This is the safety net. Even if the search brain and the model both fail to
      // notice someone in context, this hard-extracts the relevant lines and injects them.
      const contextMatches = [];
      if ((isCaleb || isGroup) && calebContext) {
        // Extract proper nouns (capitalized) AND multi-word phrases (handles lowercase names)
        const capitalizedNames =
          text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
        // Also extract 2+ word sequences that might be names even if lowercase
        const lowercaseNames = text.match(/\b([a-z]+\s+[a-z]+)\b/gi) || [];
        const allCandidates = [...capitalizedNames, ...lowercaseNames];
        const searchTerms = [
          ...new Set(allCandidates.filter((n) => n.length > 3)),
        ];
        if (searchTerms.length > 0) {
          const ctxLines = calebContext.split("\n");
          for (const term of searchTerms) {
            const termLower = term.toLowerCase();
            const matches = ctxLines.filter((line) =>
              line.toLowerCase().includes(termLower),
            );
            if (matches.length > 0) {
              contextMatches.push({ term, lines: matches.slice(0, 5) });
            }
          }
        }
      }

      const searchPlan = await planSearch(text, contextSnippet, history);

      // If we found context matches, inject them BEFORE any search results
      if (contextMatches.length > 0) {
        const matchBlock = contextMatches
          .map((m) => `CONTEXT MATCH for "${m.term}":\n${m.lines.join("\n")}`)
          .join("\n\n");
        requestBody.system += `\n\n=== YOU ALREADY KNOW THIS (from your loaded context) ===\n${matchBlock}\n=== END CONTEXT MATCHES ===\nLead with this information. This person/topic is part of Caleb's world. Do NOT treat them as a stranger.`;
        console.log(
          `[context-scan] Found ${contextMatches.length} match(es): ${contextMatches.map((m) => m.term).join(", ")}`,
        );

        // QUERY ENRICHMENT: pull high-signal proper nouns and org/project
        // names from the matched context lines and append them to every
        // planned search query. This keeps the Perplexity query specific
        // ("Sagar Tiwari Stanford Blue Modern Advisory") instead of
        // generic ("Sagar Tiwari") which returns the wrong person.
        try {
          const clueSet = new Set();
          for (const m of contextMatches) {
            for (const line of m.lines) {
              // Proper nouns: capitalized multi-word or single-word > 3 chars
              const props =
                line.match(
                  /\b[A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]+){0,3}\b/g,
                ) || [];
              for (const p of props) {
                // Skip the term itself and very common words
                if (p.toLowerCase() === m.term.toLowerCase()) continue;
                if (/^(The|And|For|With|From|This|That|Caleb)$/i.test(p))
                  continue;
                clueSet.add(p);
              }
            }
          }
          const clues = [...clueSet].slice(0, 6).join(" ");
          if (clues && Array.isArray(searchPlan.queries)) {
            searchPlan.queries = searchPlan.queries.map((q) => {
              // Only append clues if the query mentions the matched term
              const needsEnrichment = contextMatches.some((m) =>
                q.toLowerCase().includes(m.term.toLowerCase()),
              );
              return needsEnrichment ? `${q} ${clues}` : q;
            });
            console.log(
              `[query-enrich] Added clues "${clues}" to queries: ${JSON.stringify(searchPlan.queries)}`,
            );
          }
        } catch (e) {
          console.warn("[query-enrich] failed:", e.message);
        }
      }

      // Live-data override: if the user is asking about something that
      // CHANGES outside this conversation (calendar events, today's emails,
      // contacts, scheduled reminders, partnerships), the prior answer in
      // context is stale by definition. Skip the "context-only" hint so
      // Claude is not nudged to repeat the cached answer instead of
      // re-invoking the live tool.
      //
      // The bug this guards against: yesterday Medha said "May 28 is empty"
      // (before the list_events PT-offset fix shipped). Today Caleb asked
      // the same question. search-brain decided "context_only — already
      // answered," Claude regurgitated "still clear" from history, and
      // list_events was never called. Same pattern would hit any live-data
      // tool — gmail, contacts, reminders, etc.
      const LIVE_DATA_INTENT =
        /\b(calendar|schedule|on (my|the)|events?|meetings?|appointments?|today|tomorrow|tonight|this (morning|afternoon|evening|week|weekend)|next (week|weekend)|may|june|july|august|september|october|november|december|email|emails|inbox|gmail|message|messages|texts?|reminder|reminders|due|todo|tasks?|contacts?|who do i know|partnerships?|investors?|network|connections?|reconnect|alumni|people (in|at|to|i|who|from)|who (should i|do i|in)|rank|intro(s|duce|duction)?|warm)\b/i.test(
          text,
        );
      const liveDataOverride =
        searchPlan.action === "context_only" && LIVE_DATA_INTENT;
      if (liveDataOverride) {
        console.log(
          `[search-brain] OVERRIDE context_only -> live-data intent detected, forcing tool re-invocation for "${text.slice(0, 60)}"`,
        );
        requestBody.system += `\n\nLIVE-DATA OVERRIDE: the user is asking about live data (calendar / email / contacts / network / people / reminders / partnerships / events). Even if a similar question was answered earlier in this conversation, the underlying data MAY HAVE CHANGED. You MUST call the appropriate live-data tool (search_contacts, people_rank, list_events, list_recent_emails, list_my_reminders, recall_partnership, plan_event_list, etc.) and answer from the tool's response — do not regurgitate the prior cached answer from conversation history. For people/network lookups, call search_contacts or people_rank; if the user references someone else's network by name (e.g. "Sagar's network"), pass network_owner with that name (e.g. "sagar").`;
      } else if (searchPlan.action === "context_only") {
        if (searchPlan.context_summary) {
          requestBody.system += `\n\nSEARCH NOTE: ${searchPlan.context_summary}. Lead with this.`;
        }
        console.log(`[search-brain] Context-only: "${text.slice(0, 50)}"`);
      } else if (
        searchPlan.action === "search" ||
        searchPlan.action === "multi_search"
      ) {
        const searchResults = await executeSearchPlan(searchPlan);
        if (searchResults) {
          console.log(
            `[search-brain] Injecting ${searchPlan.queries.length} result(s) (${isCaleb ? "Caleb" : normFrom}, ${isGroup ? "group" : "DM"})`,
          );
          requestBody.system += `\n\n---\nWEB SEARCH RESULTS (supplementary, your context above takes priority):\n${searchResults}\n---\nIf anyone in these results also appears in the CONTEXT MATCHES above, lead with your personal knowledge. Web results add detail but your context is the primary source.`;

          // ── AMBER-ID ENRICHMENT ──────────────────────────────────────
          // If the search was about a person, distill the results into
          // structured facts and write them to that contact's profile +
          // amber-id Pinecone. Fire-and-forget — never block the reply.
          // Prefers a context-matched term (highest signal); falls back
          // to capitalized-name extraction from the message text.
          try {
            const subject =
              contextMatches.find((m) => /[A-Z]/.test(m.term))?.term ||
              extractSubjectName(text);
            if (subject) {
              enrichContactFromSearch({
                subject,
                searchResults,
                calebContext: isCaleb || isGroup ? calebContext : null,
                tenant,
              }).catch((e) =>
                console.warn("[search-enrichment] bg error:", e.message),
              );
            }
          } catch (e) {
            console.warn("[search-enrichment] trigger error:", e.message);
          }
        } else {
          console.log(
            `[search-brain] No results for: ${JSON.stringify(searchPlan.queries)}`,
          );
        }
      }
      // action === "skip" means no search needed
    }

    // ── Emotion hint injection (blocks <=6s worst case, fire-and-forget if slow) ──
    // Awaits the classifier promise we kicked off earlier. If it comes back
    // with a non-neutral label, prepend a calibration hint so Camber tunes
    // warmth/pacing. Also attach the label to the history entry so future
    // turns have it. Tiny nudge to Emotional dim handled in background.
    let emotionClassification = null;
    if (emotionPromise) {
      try {
        emotionClassification = await Promise.race([
          emotionPromise,
          new Promise((res) => setTimeout(() => res(null), 3500)),
        ]);
      } catch (_) {
        emotionClassification = null;
      }
      if (emotionClassification) {
        incomingEntry.emotion = emotionClassification;
        const hint = emotionToPromptHint(emotionClassification);
        if (hint) {
          requestBody.system += hint;
          systemPrompt += hint;
        }
      }
    }

    let claudeResponse;
    if (useOllama) {
      try {
        claudeResponse = await callOllamaDirect(
          systemPrompt,
          claudeMessages,
          maxTokens,
        );
      } catch (err) {
        console.warn("[ollama] failed, falling back to Haiku:", err.message);
        claudeResponse = await callClaudeRaw({
          ...requestBody,
          model: "claude-haiku-4-5-20251001",
        });
      }
    } else {
      claudeResponse = await callClaudeRaw(requestBody);
    }

    // Handle tool use loop. Cap exists to stop runaway/infinite loops but
    // 10 was too tight for legitimate multi-system prompts. Caleb's full
    // end-to-end self-test hit it at exactly 10 after the read path alone
    // (calendar + gmail + drive + slack + notion x 3 queries + twitter +
    // github + railway), bailed without ever reaching the writes, and
    // returned a tapback-only reply (no text). Raised to 30 — enough for
    // the longest realistic prompt (read all platforms + 10 idempotent
    // writes) but still finite. Anything over 30 in one turn is almost
    // certainly a loop worth interrupting.
    let toolLoopCount = 0;
    const MAX_TOOL_LOOPS = 30;
    // Track the most recent connect-link tool_result of this turn.
    // After the loop, we post-process the model's text reply: if it
    // tells the user to set up / connect / open a link but doesn't
    // include the URL, append it. The model sometimes paraphrases the
    // reply_template and drops the URL despite the system prompt
    // telling it not to.
    let lastConnectLink = null;
    // Accumulate image URLs returned by generate_image across all tool
    // loop iterations of this turn. The agent loop scans each raw tool
    // result (pre-sanitize) for `image_url` and stashes the URL here;
    // after the loop we hand the list to sendOpts.attachments so Loop
    // sends them as real iMessage image attachments. Same safety-net
    // shape as lastConnectLink above.
    const pendingImageUrls = [];
    while (
      claudeResponse.stopReason === "tool_use" &&
      toolLoopCount < MAX_TOOL_LOOPS
    ) {
      toolLoopCount++;
      const toolUseBlocks = claudeResponse.content.filter(
        (b) => b.type === "tool_use",
      );
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        let result;
        try {
          result = await dispatchToolCall(toolUse, {
            tenant,
            normFrom,
            isGroup,
            groupId,
            // messageId is the trigger Loop message_id — threaded so
            // event_create can use it as dedupeKey (covers webhook
            // retries that escape the in-process 10-min cache).
            messageId,
          });
        } catch (e) {
          if (e && e.code === "missing-credentials") {
            result = buildConnectLinkResult({
              toolName: toolUse?.name,
              connections: userConnections,
              from: normFrom,
              detail: e.message,
            });
          } else {
            result = { error: e.message };
          }
        }

        // Post-process: tool returned a structured not-connected payload
        // (gcal/tools.js NOT_CONNECTED, oauthRequiredResponse, the slack/
        // linkedin/etc analogues). Translate those into the same
        // transport-aware connect-link template so the user sees one
        // consistent voice regardless of which tool tripped the gate.
        if (
          result &&
          typeof result === "object" &&
          (result.error === "calendar_not_connected" ||
            result.error === "calendar_oauth_required" ||
            /not_connected$|_oauth_required$/.test(result.error || "") ||
            result.suggestConnect === true)
        ) {
          result = buildConnectLinkResult({
            toolName: toolUse?.name,
            connections: userConnections,
            from: normFrom,
            detail: result.error || result.message,
            existingConnectUrl: result.connect_url,
          });
        }

        // Remember the connect link payload so the post-reply pass can
        // append the URL if the model paraphrases away from the
        // reply_template.
        if (
          result &&
          typeof result === "object" &&
          result.user_action_required === "connect_oauth" &&
          typeof result.connect_url === "string"
        ) {
          lastConnectLink = result.connect_url;
        }
        // Scan the RAW (pre-sanitize) tool result for an image_url
        // emitted by generate_image. Cap at 3 per turn so a runaway
        // image-gen loop can't blow up the outbound iMessage. We don't
        // gate on tool name — any tool that opts into the image-host
        // contract gets attached.
        if (
          result &&
          typeof result === "object" &&
          typeof result.image_url === "string" &&
          pendingImageUrls.length < 3
        ) {
          pendingImageUrls.push(result.image_url);
        }
        // Tab 28 — generate_carousel returns multiple coordinated slides as
        // image_urls[]. Accumulate up to 6 so a full LinkedIn carousel lands;
        // the send path below spills anything past Loop's 3-per-send cap
        // across follow-up bubbles. Scalar generators keep their 3-cap above.
        if (
          result &&
          typeof result === "object" &&
          Array.isArray(result.image_urls)
        ) {
          for (const u of result.image_urls) {
            if (typeof u === "string" && pendingImageUrls.length < 6) {
              pendingImageUrls.push(u);
            }
          }
        }
        // Same contract for generate_pdf: any tool result that exposes
        // a pdf_url gets auto-attached to the outbound iMessage. Loop
        // accepts application/pdf URLs in the same attachments array as
        // image/png; share the 3-attachment cap with image_url so a
        // single turn can't blow up the outbound payload.
        if (
          result &&
          typeof result === "object" &&
          typeof result.pdf_url === "string" &&
          pendingImageUrls.length < 3
        ) {
          pendingImageUrls.push(result.pdf_url);
        }
        // PR-G — file-gen family. Same shared 3-attachment cap so a single
        // turn that returns multiple files spills across bubbles instead of
        // blowing up the outbound payload. Loop accepts arbitrary file URLs
        // in the attachments array; the public /image/<id>.<ext> route
        // serves them with the right Content-Type so the recipient sees a
        // real attached file in iMessage.
        if (result && typeof result === "object") {
          for (const key of [
            "docx_url",
            "xlsx_url",
            "csv_url",
            "md_url",
            "txt_url",
            "json_url",
            "file_url",
          ]) {
            if (
              typeof result[key] === "string" &&
              pendingImageUrls.length < 3
            ) {
              pendingImageUrls.push(result[key]);
            }
          }
        }
        // Cap, neutralize, and fence-wrap tool output before it
        // re-enters the model. Third-party services (web search,
        // Gmail, Notion, etc) can return attacker-controlled prompt
        // payloads; the sanitizer marks these as untrusted data so
        // the model is less likely to act on embedded instructions.
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: sanitizeToolOutput(result, toolUse?.name),
        });
      }
      claudeMessages.push({
        role: "assistant",
        content: claudeResponse.content,
      });
      claudeMessages.push({ role: "user", content: toolResults });
      // Feed tool results back through the same path. The Perplexity Agent
      // API uses Claude which doesn't hallucinate over tool results, so we
      // can pass the full system prompt. Keep tools armed so the model can
      // make follow-up tool calls if needed.
      claudeResponse = await callClaudeRaw({
        ...requestBody,
        messages: claudeMessages,
      });
    }
    const hitToolLoopCap = toolLoopCount >= MAX_TOOL_LOOPS;
    if (hitToolLoopCap) {
      console.warn(`[tools] Hit max tool loop iterations (${MAX_TOOL_LOOPS})`);
    }

    let reply = claudeResponse.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Safety net for the cap-hit case. When the loop terminates because we
    // ran out of iterations (not because the model finished), claudeResponse
    // is the LAST tool_use turn, which has no .text blocks. Reply becomes
    // empty, which downstream turns into a tapback-only outcome and the
    // user sees nothing after their request. Surface what we got done so
    // the user knows the agent didn't ghost them. They can re-ask for the
    // remaining piece.
    if (hitToolLoopCap && !reply.trim()) {
      reply =
        `I ran ${toolLoopCount} tool calls on that and hit my per-turn limit ` +
        `before finishing. The work that did run completed, but I didn't get ` +
        `to everything you asked for. Re-send the rest as a follow-up and ` +
        `I'll pick up from where I stopped.`;
    }

    // Safety net: if any tool this turn returned a connect-link payload
    // and the model dropped the URL out of its reply, append it. The
    // model is told to relay reply_template verbatim, but it sometimes
    // paraphrases ("Set it up here and then ask me again:" with no URL
    // after the colon, which Caleb hit on Slack). One-character append
    // would be clearer than a re-prompt; users always need a clickable
    // link.
    if (lastConnectLink && reply && !reply.includes(lastConnectLink)) {
      const trimmed = reply.trimEnd().replace(/[:—–-]\s*$/, "");
      reply = `${trimmed}\n\n${lastConnectLink}`;
    }

    // If generate_image fired this turn, attach the resulting URLs to
    // the outbound iMessage. Loop's `attachments` field renders each as
    // a real image bubble. We strip any URL the model accidentally
    // pasted into the reply text — the description tells it not to,
    // but reinforcement here keeps the reply clean if the model slips.
    if (pendingImageUrls.length) {
      sendOpts.attachments = pendingImageUrls.slice(0, 3);
      for (const url of pendingImageUrls) {
        if (reply && reply.includes(url)) {
          reply = reply
            .replaceAll(url, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        }
      }
      console.log(
        `[image] Attaching ${sendOpts.attachments.length} image(s) to outbound`,
      );
    }

    // Parse iMessage visual effects from reply prefix
    // Supports: [effect:balloons], [balloons], or just the effect name at the start
    // Valid effects: balloons, confetti, fireworks, love, echo, spotlight, lasers, slam, loud, gentle, invisibleInk, celebration
    const VALID_EFFECTS = new Set([
      "balloons",
      "confetti",
      "fireworks",
      "love",
      "echo",
      "spotlight",
      "lasers",
      "slam",
      "loud",
      "gentle",
      "invisibleink",
      "celebration",
    ]);

    // Strip hallucinated AI metadata prefixes like [ContactName], [Name] before effect parsing.
    // The AI sometimes prepends [Kaitlyn] or [Name] as addressing, which is not a valid effect
    // and leaks into the message body if not removed.
    const metaPrefixMatch = reply.match(/^\[(?:effect:)?(\w+)\]\s*/i);
    if (
      metaPrefixMatch &&
      !VALID_EFFECTS.has(metaPrefixMatch[1].toLowerCase())
    ) {
      console.log(
        `[effect-strip] Removing hallucinated prefix: ${metaPrefixMatch[0].trim()}`,
      );
      reply = reply.slice(metaPrefixMatch[0].length).trim();
    }

    // Try bracketed format first: [balloons] or [effect:balloons]
    let effectMatch = reply.match(/^\[(?:effect:)?(\w+)\]\s*/i);
    if (effectMatch && VALID_EFFECTS.has(effectMatch[1].toLowerCase())) {
      sendOpts.effect = effectMatch[1].toLowerCase();
      reply = reply.slice(effectMatch[0].length).trim();
    }
    // Also catch bare effect name at start of reply: "lasers Here we go!"
    if (!sendOpts.effect) {
      const bareMatch = reply.match(
        /^(balloons|confetti|fireworks|love|echo|spotlight|lasers|slam|loud|gentle|invisibleInk|celebration)\b\s*/i,
      );
      if (bareMatch) {
        sendOpts.effect = bareMatch[1].toLowerCase();
        reply = reply.slice(bareMatch[0].length).trim();
      }
    }
    if (sendOpts.effect) {
      // flaw #80 — rate-limit gate. At most one effect per 10-message
      // window per group. We track msgsSince and reset the counter when
      // we actually let an effect through. DMs are unaffected (no spam
      // dynamic — effects in 1:1 are fine more often).
      if (isGroup && groupId) {
        const tracker = groupEffectTracker.get(groupId) || {
          lastEffectAt: 0,
          msgsSince: Infinity,
        };
        if (tracker.msgsSince < EFFECT_WINDOW_MIN_MSGS) {
          console.log(
            `[effect] rate-limited (${tracker.msgsSince} msgs since last effect in ${groupId}); dropping ${sendOpts.effect}`,
          );
          delete sendOpts.effect;
        } else {
          groupEffectTracker.set(groupId, {
            lastEffectAt: Date.now(),
            msgsSince: 0,
          });
          console.log(`[effect] Sending with effect: ${sendOpts.effect}`);
        }
      } else {
        console.log(`[effect] Sending with effect: ${sendOpts.effect}`);
      }
    }
    // Always advance the per-group counter so effects get to fire again
    // after enough quiet messages.
    if (isGroup && groupId) {
      const tracker = groupEffectTracker.get(groupId) || {
        lastEffectAt: 0,
        msgsSince: 0,
      };
      tracker.msgsSince = (tracker.msgsSince || 0) + 1;
      groupEffectTracker.set(groupId, tracker);
    }

    // Parse one-or-many tapback tokens at the start of the reply:
    //   [react:love]                 — reacts to the triggering incoming message
    //   [react:love:<messageId>]     — reacts to a specific past message (ID
    //                                  comes from the RECENT MESSAGE IDS prompt
    //                                  block; lets Amber hit non-latest messages)
    // Multiple tokens may stack, so she can react to several messages in one
    // turn (e.g. "like these 3 messages"). Remaining text after the tokens is
    // sent as a normal message bubble.
    const { cleaned: replyAfterReacts, reactions } = parseReactionTokens(reply);
    reply = replyAfterReacts;
    for (const { reaction, targetId } of reactions) {
      const base = reaction.startsWith("-") ? reaction.slice(1) : reaction;
      if (!VALID_REACTIONS.has(base)) continue;
      const landOn = targetId || messageId;
      if (!landOn) continue;
      console.log(`[tapback] ${reaction} -> ${landOn}`);
      sendTapback(normFrom, landOn, reaction, {
        tenant,
        group: isGroup ? groupId : undefined,
      }).catch((err) =>
        console.warn(
          `[tapback] failed (${reaction} on ${landOn}): ${err.message}`,
        ),
      );
      // flaw #82 — audit log every reaction Medha sends so the dashboard
      // transcript can replay them alongside text bubbles. Fire-and-forget
      // so a BQ blip never blocks the chat path.
      try {
        const [{ insertRow, tenantId: pdwTenantId }, { personIdFromHandle }] =
          await Promise.all([
            import("./lib/pdw/bq-client.js"),
            import("./lib/pdw/person-resolver.js"),
          ]);
        insertRow("event_messages", {
          tenant_id: pdwTenantId(),
          message_id: `react_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          group_id: isGroup ? groupId : null,
          from_person_id: personIdFromHandle(normFrom) || null,
          direction: "reaction",
          body: reaction,
          in_reply_to_message_id: landOn,
          sent_at: new Date().toISOString(),
        }).catch(() => {});
      } catch {}
    }

    // Voice reply: if user sent audio OR agent chose [voice], generate speech and attach.
    // userSentVoice flag is set at webhook entry from message_type === "audio".
    //
    // flaw #81 — text/voice cleanliness audit. After we strip the [voice]
    // prefix here, `reply` is the SAME string we both (a) hand to
    // ElevenLabs to synthesize and (b) hand to sendMessage as the text
    // body. No [voice] prefix leaks to Loop, no "... " padding leaks
    // either (voice.js no longer prefixes text — it splices a silent
    // MP3 onto the audio buffer instead, per flaw #43). The text body
    // Loop sees IS the user-facing transcript.
    const voiceMatch = reply.match(/^\[voice\]\s*/i);
    const shouldSpeakReply = !!voiceMatch || userSentVoice;
    if (voiceMatch) {
      reply = reply.slice(voiceMatch[0].length).trim();
    }
    if (shouldSpeakReply && reply) {
      try {
        const { generateSpeech, storeAudio, isVoiceAvailable } =
          await import("./lib/voice.js");
        if (isVoiceAvailable()) {
          // flaw #44 — pass tenant so generateSpeech can resolve a
          // per-tenant voice id from tenant.secrets.ELEVENLABS_VOICE_ID.
          const audioBuffer = await generateSpeech(reply, { tenant });
          if (audioBuffer) {
            const id = storeAudio(audioBuffer);
            // flaw #42 — base URL resolution order:
            //   MEDHA_PUBLIC_AUDIO_BASE_URL (explicit, preferred — set
            //     in Railway when you want a specific custom domain)
            //   PUBLIC_BASE_URL (legacy fallback)
            //   https://${RAILWAY_PUBLIC_DOMAIN} (last-ditch auto)
            // We no longer hardcode the Railway domain string anywhere.
            const publicBase =
              process.env.MEDHA_PUBLIC_AUDIO_BASE_URL ||
              process.env.PUBLIC_BASE_URL ||
              (process.env.RAILWAY_PUBLIC_DOMAIN
                ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                : null);
            if (publicBase && id) {
              const audioUrl = `${publicBase}/audio/${id}.mp3`;
              // Loop's mediaUrl renders as a true iMessage voice note
              // (waveform bubble + transcript), which is what we want
              // when the user sent audio or asked for a spoken reply.
              // attachments[] would render as a plain audio attachment.
              sendOpts.mediaUrl = audioUrl;
              console.log(
                `[voice] Generated ${audioBuffer.length} bytes, attaching ${audioUrl}`,
              );
            } else {
              console.warn(
                "[voice] No MEDHA_PUBLIC_AUDIO_BASE_URL / PUBLIC_BASE_URL / RAILWAY_PUBLIC_DOMAIN — falling back to text",
              );
            }
          }
        }
      } catch (err) {
        console.warn("[voice] Generation failed:", err.message);
      }
    }

    // Parse [reply:messageId] prefix: inline reply to a specific message.
    // Tolerant of optional 'msg:' prefix that Claude sometimes copies from
    // the RECENT MESSAGE IDS block where lines render as `[msg:<id>] ...`.
    // Accepts Loop UUIDs (hex + dashes) AND Slack IDs (mixed-case
    // alphanumeric like `Ev0B6TGNTE9K` or `C0B55ESJS1L`). The previous
    // hex-only regex missed Slack IDs and the raw `[reply:Ev0B...]` token
    // leaked into the outbound Slack text. The token is stripped from the
    // visible reply regardless of whether the downstream transport
    // supports threaded replies.
    const replyMatch = reply.match(/^\[reply:(?:msg:)?([A-Za-z0-9-]+)\]\s*/);
    if (replyMatch) {
      sendOpts.replyToId = replyMatch[1];
      reply = reply.slice(replyMatch[0].length).trim();
      console.log(`[inline-reply] Replying to message ${sendOpts.replyToId}`);
    }

    // Convert markdown to iMessage-native formatting (Unicode bold, bullet points, etc.)
    // Also strips em dashes, collapses extra newlines, cleans up leftover syntax
    reply = renderForIMessage(reply);

    // Safety filter: if reply reveals AI identity, pick a random neutral fallback
    if (!isSafeReply(reply) && !isCaleb) {
      console.warn(
        `[safety] Reply for ${normFrom} failed safety filter, using fallback`,
      );
      const SAFE_FALLBACKS = [
        "ya for sure",
        "got it",
        "bet",
        "word",
        "heard",
        "sounds good",
        "noted",
        "i feel that",
      ];
      reply = SAFE_FALLBACKS[Math.floor(Math.random() * SAFE_FALLBACKS.length)];
    }

    // If Amber only sent a tapback (reply is empty after stripping
    // [react:TYPE]), skip the message-send path entirely. Loop rejects
    // empty-text sends with "No 'text' parameter in request".
    //
    // Capture the outbound message_id from Loop so future turns can target
    // it with [react:TYPE:id] (e.g. "like the last message you sent"). For
    // segmented sends we keep the LAST bubble's id — that's what "your last
    // message" naturally refers to.
    const replyHasContent = reply && reply.trim().length > 0;
    let outgoingMessageId = null;
    if (!replyHasContent) {
      console.log("[reply] tapback-only turn — no text message to send");
    } else {
      // Segmented reply: split long messages into multiple iMessage bubbles
      const segments = segmentReply(reply);
      if (segments.length > 1) {
        console.log(
          `[segmented] Splitting reply into ${segments.length} bubbles`,
        );
        for (let i = 0; i < segments.length; i++) {
          try {
            // Every bubble needs tenant in opts. The transport layer requires
            // opts.tenant.loopSenderId on every send (the per-tenant Loop
            // sender lookup that replaced env-based sender ids). The old
            // version dropped tenant on bubbles 2+ by overwriting opts with
            // either {} or { group: ... }, which made bubbles 2+ fail with
            // "sendMessage called without opts.tenant.loopSenderId" and the
            // user only saw the first bubble. Hid behind the old 400-char
            // floor; surfaced once [NEW] markers made splits common.
            const opts =
              i === 0
                ? sendOpts
                : {
                    tenant: sendOpts.tenant,
                    auditOrigin: sendOpts.auditOrigin,
                    webhookContact: sendOpts.webhookContact,
                    ...(isGroup && sendOpts.group
                      ? { group: sendOpts.group }
                      : {}),
                  };
            const sent = await sendMessage(normFrom, segments[i], opts);
            if (sent?.message_id) outgoingMessageId = sent.message_id;
          } catch (segErr) {
            console.warn(
              `[segmented] Bubble ${i + 1}/${segments.length} failed: ${segErr.message}`,
            );
          }
        }
      } else {
        const sent = await sendMessage(normFrom, reply, sendOpts);
        if (sent?.message_id) outgoingMessageId = sent.message_id;
      }

      // Tab 28 — carousel overflow. Loop caps a single send at 3
      // attachments, but generate_carousel can stage up to 6 slides. The
      // first 3 rode the reply bubble above via sendOpts.attachments; send
      // the remaining slides as follow-up attachment bubbles so the whole
      // deck lands. Each follow-up carries a short caption (Loop rejects
      // empty-text sends) and the same tenant/group opts as bubble 1.
      if (pendingImageUrls.length > 3) {
        const overflow = pendingImageUrls.slice(3, 6);
        for (let start = 0; start < overflow.length; start += 3) {
          const batch = overflow.slice(start, start + 3);
          const firstSlide = 3 + start + 1;
          const lastSlide = 3 + start + batch.length;
          const caption =
            batch.length > 1
              ? `slides ${firstSlide}-${lastSlide}`
              : `slide ${firstSlide}`;
          try {
            const sent = await sendMessage(normFrom, caption, {
              tenant: sendOpts.tenant,
              auditOrigin: sendOpts.auditOrigin,
              webhookContact: sendOpts.webhookContact,
              attachments: batch,
              allowDuplicate: true,
              ...(isGroup && sendOpts.group ? { group: sendOpts.group } : {}),
            });
            if (sent?.message_id) outgoingMessageId = sent.message_id;
          } catch (carErr) {
            console.warn(
              `[carousel] overflow batch (${caption}) failed: ${carErr.message}`,
            );
          }
        }
      }
    }
    logInteraction(normFrom, contact.displayName, text, "inbound", "received");
    logInteraction(normFrom, contact.displayName, reply, "outbound", "replied");
    logInteractionToSupabase(
      normFrom,
      text,
      reply,
      useOllama ? "ollama" : model,
      tenant,
    ).catch(() => {});

    // Flaw #33: fire-and-forget HTTP POST to medha-id /v1/embeddings/outbound.
    // medha-id owns the OpenAI call + the BQ write now; the agent just
    // hands over the envelope. Skipped if no reply text or no tenant DID.
    if (replyHasContent && tenant?.privyDid) {
      import("./lib/embeddings.js")
        .then(({ recordOutbound, isAvailable }) => {
          if (!isAvailable()) return;
          return recordOutbound({
            messageId: outgoingMessageId,
            tenantDid: tenant.privyDid,
            contact: normFrom,
            groupId: isGroup ? groupId : null,
            inReplyToMessageId: messageId || null,
            text: reply,
            isVoice: !!sendOpts.mediaUrl,
            audioUrl: sendOpts.mediaUrl || null,
            effect: sendOpts.effect || null,
            model: useOllama ? "ollama" : model,
            latencyMs: Date.now() - _startMs,
          });
        })
        .catch((err) =>
          console.warn(`[embeddings] outbound write skipped: ${err.message}`),
        );

      // Flaw #31: extract "X about Y" facts from the outbound reply,
      // fire-and-forget. Cheap Haiku call; gated heuristically inside
      // shouldExtract so most short replies skip the LLM entirely.
      import("./lib/fact-extractor.js")
        .then(({ extractAndStoreFacts }) =>
          extractAndStoreFacts({
            text: reply,
            tenantDid: tenant.privyDid,
            sourceContact: "amber",
            sourceMessageId: outgoingMessageId,
          }),
        )
        .catch((err) =>
          console.warn(`[fact-extractor] outbound skipped: ${err.message}`),
        );
    }

    // Persist conversation. IMPORTANT: if this was a tapback-only turn (no
    // text body), we still need a non-empty `content` string. Perplexity's
    // Agent API rejects any history entry with empty content (400:
    // "validation failed: input[N]: content cannot be empty"), which kills
    // the NEXT turn. Record a human-readable placeholder describing which
    // reaction(s) we fired so Claude also understands what happened and
    // doesn't redo it.
    let historyContent = reply;
    if (!historyContent || historyContent.trim().length === 0) {
      if (reactions && reactions.length > 0) {
        const reactionSummary = reactions
          .map(({ reaction, targetId }) =>
            targetId
              ? `[reacted ${reaction} to ${targetId}]`
              : `[reacted ${reaction}]`,
          )
          .join(" ");
        historyContent = reactionSummary;
      } else {
        historyContent = "[no reply sent]";
      }
    }
    history.push({
      role: "assistant",
      from: "amber",
      senderLabel: "Amber",
      content: historyContent,
      timestamp: new Date().toISOString(),
      messageId: outgoingMessageId,
    });
    // Set group cooldown — she just replied, stay quiet for 90s unless addressed
    if (isGroup && groupId) {
      groupReplyCooldown.set(groupId, Date.now());
    }

    // ── FEEDBACK LOOP: record this outbound so future inbounds can be ──
    // classified as praise/criticism/tapback reactions toward it.
    if (outgoingMessageId && replyHasContent) {
      try {
        recordOutboundMessage(chatKey, outgoingMessageId, reply);
      } catch (e) {
        console.warn("[feedback] record error:", e.message);
      }
    }

    // Fire saves + background learning — none of this blocks UX (fire and forget)
    const sessionUpdates = [];
    if (!isCaleb && userSession) {
      // Update conversation state for contacts in both DMs and groups
      const updatedSession = {
        ...userSession,
        conversation_state: {
          ...userSession.conversation_state,
          last_seen: new Date().toISOString(),
          message_count:
            (userSession.conversation_state.message_count || 0) + 1,
          last_context: isGroup ? `group:${chatKey}` : "dm",
        },
      };
      sessionUpdates.push(saveUserSession(normFrom, updatedSession, tenant));
    }
    // Infer health signals from every message (DM or group, background, no UX cost)
    const healthInferences = [];
    healthInferences.push(inferHealthSignals(normFrom, text, reply, tenant));

    // ── Emotion-driven Emotional dim nudge ──
    // Tiny ±0.5 pt delta based on the classified emotion. This is a fast
    // signal that lands per-message, complementing the slower Sonar-based
    // inferHealthSignals (rate-limited to once per 15min per contact).
    if (emotionClassification && !isCaleb) {
      const delta = emotionToHealthDelta(emotionClassification);
      if (Math.abs(delta) >= 0.05) {
        try {
          const { ingestInferredSignal } =
            await import("./lib/amber-id-ingest.js");
          ingestInferredSignal(
            normFrom,
            `Emotion signal: ${emotionClassification.label} (intensity ${emotionClassification.intensity.toFixed(2)})`,
            { emotional: delta },
            tenant,
          ).catch(() => {});
        } catch (_) {}
      }
    }

    // Push conversation to amber-id Pinecone (fire-and-forget)
    maybeIndexConversation({
      userText: text,
      finalText: reply,
      contact: normFrom,
      channel: isGroup ? "imessage-group" : "imessage",
      phone: isCaleb ? tenant?.phoneNumber || CALEB_PHONE : normFrom,
      tenant,
    }).catch(() => {});

    // ── AUTO-MEMORY (Memori-inspired, fire-and-forget) ──
    // Extract {facts, preferences, entities, topics, dimension} from the
    // turn and persist to contact.notes + amber-id agent pipe. Uses
    // Sonar so we stay LLM-agnostic. Attribution: entity_id=contact handle,
    // process_id=DM or group id.
    if (replyHasContent && text) {
      const processId = isGroup ? `group:${groupId || chatKey}` : "dm";
      captureTurnMemory({
        incoming: text,
        reply,
        speakerHandle: isCaleb ? tenant?.phoneNumber || CALEB_PHONE : normFrom,
        speakerName: isCaleb ? "Caleb" : contact.displayName || senderLabel,
        processId,
        tenant,
      }).catch((e) => console.warn("[auto-memory] bg error:", e.message));
    }

    // Persist a memory of this exchange so future messages can recall it
    // via Perplexity embeddings. Keep it minimal and let the embedding do
    // the work: the user's message + a hint of Amber's reply.
    const exchangeMemory = saveMemory(
      {
        handle: normFrom,
        scope: isGroup ? "group" : "dm",
        category: "conversation",
        content: `${isCaleb ? "Caleb" : contact.displayName || normFrom} said: "${text.slice(0, 400)}" | Amber replied: "${(reply || "").slice(0, 240)}"`,
        confidence: 0.7,
        source: "conversation",
        tags: isGroup && groupId ? [`group:${groupId}`] : [],
      },
      tenant,
    ).catch((e) => console.warn("[saveMemory] skipped:", e.message));

    Promise.all([
      saveConversationHistory(chatKey, history, tenant),
      saveContact(normFrom, contact, tenant),
      extractAndUpdateContactProfile(contact, text, reply, isGroup, tenant),
      exchangeMemory,
      ...sessionUpdates,
      ...healthInferences,
    ]).catch((e) => console.warn("Post-reply tasks error:", e.message));

    const latencyMs = Date.now() - _startMs;
    console.log(
      `Replied to ${isGroup ? `group ${chatKey}` : normFrom} (${isCaleb ? "Caleb" : "contact"}) in ${latencyMs}ms\n`,
    );
  } catch (err) {
    console.error("❌ Webhook handler error:", err.message);
    lastError = { message: err.message, time: new Date().toISOString() };
    const isAIDown = err.message.includes("All AI providers failed");
    try {
      if (isAIDown) {
        await sendMessage(
          normFrom,
          "I'm having trouble connecting right now, give me a few minutes and try again.",
          sendOpts,
        );
        // Alert owner — but throttle to once per 30 min so we don't spam them
        const alertPhone = tenant?.phoneNumber || CALEB_PHONE;
        const now = Date.now();
        if (!global.__amberLastAIDownAlert) global.__amberLastAIDownAlert = {};
        const last = global.__amberLastAIDownAlert[alertPhone] || 0;
        if (now - last > 30 * 60 * 1000) {
          global.__amberLastAIDownAlert[alertPhone] = now;
          await sendMessage(
            alertPhone,
            "⚠️ All AI providers are down. Amber can't respond until one comes back online.",
            { tenant, auditOrigin: "webhook", webhookContact: normFrom },
          );
        }
      } else {
        await sendMessage(
          normFrom,
          "Something went wrong on my end, try again in a sec.",
          sendOpts,
        );
      }
    } catch (notifyErr) {
      console.error(
        "[error-notify] Failed to send error message to user:",
        notifyErr.message,
      );
    }
  } finally {
    isProcessing = false;
  }
}

// Helper: convert Anthropic message format → OpenAI-style chat format
// maxSystemChars trims the system prompt for providers with token limits

// runProactiveCheck extracted to lib/proactive-runner.js

// Scan amber-contacts/ directory on GitHub and clear any corrupted displayName === "Amber"
// entries left over from the pre-blacklist auto-extractor bug

import { cleanupCorruptedContacts } from "./lib/contacts-util.js";

async function start() {
  console.log("🚀 Amber-Agent: Multi-Tenant AI Agent via Loop Message");
  console.log(`🌍 Running 24/7 in the cloud`);
  console.log(`🧠 Per-contact memory + group chat support enabled`);
  console.log(`📨 Webhook-driven + proactive messaging`);
  console.log("---\n");

  // Sync context files from GitHub to Supabase (background, non-blocking)
  syncContextToSupabase().catch((e) =>
    console.warn("[startup] context sync error:", e.message),
  );

  // Warm all caches in parallel at startup so first message is instant.
  // Pull every active tenant from amber-id and warm each one's context,
  // contact profile, and conversation history. No per-tenant env vars.
  let startupTenant = null;
  console.log("Warming caches...");
  try {
    const activeTenants = await listActiveTenants(null).catch(() => []);
    startupTenant = activeTenants[0] || null; // legacy: some call sites still expect a single tenant
    await Promise.all([
      getComposioTools().catch(() => null),
      loadRetreatConfig().catch(() => null),
      loadRetreatResponses().catch(() => null),
      ...activeTenants.flatMap((tenant) => [
        loadAmberContext(tenant).catch(() => null),
        tenant.phoneNumber
          ? loadContact(tenant.phoneNumber, tenant).catch(() => null)
          : Promise.resolve(null),
        tenant.phoneNumber
          ? loadConversationHistory(tenant.phoneNumber, tenant).catch(
              () => null,
            )
          : Promise.resolve(null),
      ]),
    ]);
    console.log(
      `✓ Warmed caches for ${activeTenants.length} tenant(s): ${activeTenants.map((t) => t.displayName || t.id).join(", ") || "(none)"}`,
    );
    console.log(
      `✓ AI chain: ${PERPLEXITY_API_KEY ? "Perplexity Agent (Claude) for tools + Sonar for chat" : "⚠️ no Perplexity key"}${OLLAMA_BASE_URL ? " → Ollama" : ""}\n`,
    );
  } catch (e) {
    console.warn("⚠️  Cache warm failed (non-fatal):", e.message);
  }

  // Background: scan amber-contacts for any corrupted entries where displayName === "Amber"
  // These were saved incorrectly by the auto-extractor before the blacklist fix
  cleanupCorruptedContacts().catch((e) =>
    console.warn("⚠️  Contact cleanup (non-fatal):", e.message),
  );

  const PORT = process.env.PORT || 10000;
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  const MAX_BODY_BYTES = 1024 * 1024; // 1MB

  const getState = () => ({
    isProcessing,
    processCount,
    lastProcessTime,
    lastError,
  });

  await startServer({
    enqueueMessage,
    sendMessage,
    sendTapback,
    getPlatformStatus,
    getState,
  });

  // Proactive updates to Caleb every 2 hours
  const PROACTIVE_INTERVAL = 2 * 60 * 60 * 1000;
  setInterval(() => runProactiveCheck({ isProcessing }), PROACTIVE_INTERVAL);

  // Start the reflection engine (consolidates contact learning every 4 hours)
  startReflectionEngine();

  // Start focused check-in scheduler (morning 7am / evening 9pm / Sunday 7pm PT)
  // Pulls the live tenant roster from amber-id every tick (2-min cached) so
  // Camber (Caleb) and Samber (Sagar) — and any future tenant — get their
  // own independent schedule without redeploying.
  startCheckinScheduler(() => listActiveTenants(startupTenant));

  // Flaw #37: drain the BQ dead-letter queue every 60s. Failed BQ writes
  // from any path (events, persons, suppressions) get retried until they
  // succeed or hit MAX_ATTEMPTS.
  startDlqReplayer();

  // Flaw #52: every 6h pull the last ~100 outbound messages from medha-id
  // and run them through the fact extractor. Catches anything the
  // per-reply extractor (#31) missed.
  startContactFactsBatch();

  // Flaw #54: daily contact_facts TTL decay. Halves decay_score for facts
  // not referenced in the last 30d so stale memories naturally fade.
  startMemoryDecay();

  // Load extensible skills from skills/ directory
  await loadSkills();
}

process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down agent...");
  process.exit(0);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRASH GUARD] Unhandled Promise rejection:", reason);
  // Don't exit — let the agent keep running
});

process.on("uncaughtException", (err) => {
  console.error("[CRASH GUARD] Uncaught exception:", err);
  // Don't exit — let the agent keep running
});

start();
