/**
 * Slack /events handler — entry point from server.js.
 *
 * Mirrors the structure of Togari's slackEventsHandler
 * (togari-platform/src/transports/slack/index.ts):
 *
 *   1. Handle url_verification challenge inline (no signature yet).
 *   2. Verify x-slack-signature against the raw body.
 *   3. Dedupe by event_id (Slack retries on slow ack).
 *   4. Ack 200 < 3s.
 *   5. Convert the Slack event into Medha's internal envelope and
 *      dispatch through the same enqueueMessage path that the Loop
 *      webhook uses.
 *   6. Stamp a session entry so subsequent outbound sendMessage calls
 *      from agent.js route via Slack instead of Loop.
 *
 * Required env vars (the handler 503s when any are missing):
 *   SLACK_SIGNING_SECRET — verify inbound
 *   SLACK_BOT_TOKEN      — xoxb-... for chat.postMessage
 *   SLACK_BOT_USER_ID    — strip own mentions / drop self-events
 *
 * Also expects MEDHA_EXPERT_SENDER_ID so the synthetic envelope
 * resolves to the public Medha-expert tenant. Without it the agent
 * loop will drop the message in handleWebhookMessage as "no tenant".
 */

import { verifySlackSignature } from "./verify.js";
import { markProcessed, wasProcessed } from "./dedup.js";
import { slackEventToInternal, deriveSlackFrom } from "./envelope.js";
import { sendSlackReply } from "./responder.js";
import { setSession, clearSession } from "./session.js";
import { markPrompted } from "./identity.js";
import { JUSTAROCK_SIGNUP_URL } from "../../constants.js";
import { storeImage } from "../../image-host.js";
import { storeAudio } from "../../voice.js";

// Slack url_private downloads require Bearer auth (the bot token); the same
// URL hit anonymously returns the HTML signed-in shell, not the file bytes.
// We download server-side, stash via image-host (reused from Tab 2 graphic-gen
// — same 10-min TTL, same disk mirror), and hand back a plain public URL so
// processInboundAttachments can feed it straight into Mistral OCR the same
// way Loop attachments are fed. Per-file failures degrade silently so one bad
// upload never blocks the rest of the turn.
const MAX_SLACK_FILE_BYTES = 25 * 1024 * 1024; // 25 MB matches Slack's own free-tier ceiling
const MAX_SLACK_FILES_PER_TURN = 5;

function mimeForSlackFile(file) {
  if (!file) return "application/octet-stream";
  if (typeof file.mimetype === "string" && file.mimetype) return file.mimetype;
  // Slack also sends filetype short codes (e.g. "pdf", "png").
  const ft = (file.filetype || "").toLowerCase();
  if (ft === "pdf") return "application/pdf";
  if (ft === "png") return "image/png";
  if (ft === "jpg" || ft === "jpeg") return "image/jpeg";
  if (ft === "webp") return "image/webp";
  if (ft === "gif") return "image/gif";
  return "application/octet-stream";
}

// The agent's attachment pipeline (attachment-ingest.js) already reads images,
// PDFs, Office docs (docx/xlsx/pptx + legacy), and text/code via the file
// extractor. The only thing that ever blocked them on Slack was this gate,
// which previously allow-listed just pdf/png/jpg/webp. We now accept every kind
// the pipeline understands and host each at /image/<id>.<ext> so the URL
// extension drives the correct downstream classification. (2026-06-03)
const EXT_BY_MIME = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
};

// Slack `filetype` short codes we accept directly (it is the most reliable
// signal). Includes common source-code languages, which the extractor reads as
// text. Audio is handled by the voice-note path below; video is unsupported.
const SUPPORTED_FILETYPES = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "ppt",
  "csv",
  "tsv",
  "text",
  "txt",
  "markdown",
  "md",
  "json",
  "rtf",
  "javascript",
  "js",
  "typescript",
  "ts",
  "python",
  "py",
  "java",
  "go",
  "ruby",
  "rb",
  "rust",
  "rs",
  "c",
  "cpp",
  "csharp",
  "cs",
  "php",
  "shell",
  "sh",
  "bash",
  "sql",
  "yaml",
  "yml",
  "html",
  "css",
  "xml",
]);

const FILETYPE_EXT = {
  jpeg: "jpg",
  text: "txt",
  markdown: "md",
  javascript: "js",
  typescript: "ts",
  python: "py",
  ruby: "rb",
  rust: "rs",
  csharp: "cs",
  shell: "sh",
  bash: "sh",
  yaml: "yml",
};

function extForSlackFile(file) {
  const ft = (file?.filetype || "").toLowerCase();
  if (ft && SUPPORTED_FILETYPES.has(ft)) return FILETYPE_EXT[ft] || ft;
  const mime = mimeForSlackFile(file);
  return EXT_BY_MIME[mime] || null;
}

async function ingestSlackFiles(slackFiles, opts = {}) {
  if (!Array.isArray(slackFiles) || slackFiles.length === 0) return [];
  const botToken = opts.botToken || process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.warn(
      `[slack] file ingest skipped: SLACK_BOT_TOKEN not set (cannot download url_private)`,
    );
    return [];
  }
  const publicBase =
    opts.publicBase || process.env.PUBLIC_BASE_URL || process.env.BASE_URL;
  if (!publicBase) {
    console.warn(
      `[slack] file ingest skipped: PUBLIC_BASE_URL not set (cannot build OCR-reachable URL)`,
    );
    return [];
  }
  const fetchImpl = opts.fetch || globalThis.fetch;
  const store = opts.storeImage || storeImage;
  const subset = slackFiles.slice(0, MAX_SLACK_FILES_PER_TURN);
  const urls = [];
  for (const file of subset) {
    const src = file?.url_private_download || file?.url_private;
    if (!src) continue;
    const mime = mimeForSlackFile(file);
    const ext = extForSlackFile(file);
    if (!ext) {
      console.warn(
        `[slack] skipping unsupported file mime=${mime} filetype=${file?.filetype || "?"} name=${file?.name || "?"}`,
      );
      continue;
    }
    try {
      const resp = await fetchImpl(src, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!resp || !resp.ok) {
        console.warn(
          `[slack] file download failed status=${resp?.status || "?"} name=${file?.name || "?"}`,
        );
        continue;
      }
      const ab = await resp.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length === 0) {
        console.warn(`[slack] file download empty name=${file?.name || "?"}`);
        continue;
      }
      if (buf.length > MAX_SLACK_FILE_BYTES) {
        console.warn(
          `[slack] file too large bytes=${buf.length} name=${file?.name || "?"}`,
        );
        continue;
      }
      const id = store(buf, mime);
      if (!id) {
        console.warn(`[slack] storeImage refused name=${file?.name || "?"}`);
        continue;
      }
      const url = `${publicBase.replace(/\/$/, "")}/image/${id}.${ext}`;
      console.log(
        `[slack] file ingested name=${file?.name || "?"} mime=${mime} bytes=${buf.length} url=${url}`,
      );
      urls.push(url);
    } catch (err) {
      console.warn(
        `[slack] file ingest threw name=${file?.name || "?"}: ${err.message}`,
      );
    }
  }
  return urls;
}

// Exported for the test harness — production callers go through
// dispatchConverted.
export { ingestSlackFiles };

// Tab 22: Slack voice notes. Slack delivers audio clips as event.files[] with
// a `mode: "audio"` flag (or an audio/* mimetype). The doc-ingest path above
// skips them (extForMime returns null), so without this they were silently
// dropped: Sagar could send a Slack voice note and Medha saw nothing. We
// download with the bot token (same auth wall as documents), host the bytes
// through the existing /audio store, and transcribe via the same ElevenLabs
// Scribe path Loop uses. The resulting transcript is hoisted onto the message
// text with a [voice-in] prefix so it flows through the ONE voice-journaling
// path in handleWebhookMessage exactly like an iMessage voice memo.
const AUDIO_MIME_RE = /^audio\//i;
const AUDIO_FILETYPES = new Set([
  "m4a",
  "mp4",
  "mp3",
  "mpeg",
  "mpga",
  "wav",
  "webm",
  "ogg",
  "oga",
  "aac",
  "amr",
  "flac",
  "opus",
]);

function isSlackAudioFile(file) {
  if (!file) return false;
  // Slack's native voice clips carry mode: "audio".
  if (file.mode === "audio") return true;
  if (typeof file.mimetype === "string" && AUDIO_MIME_RE.test(file.mimetype)) {
    return true;
  }
  const ft = (file.filetype || "").toLowerCase();
  return AUDIO_FILETYPES.has(ft);
}

async function transcribeSlackAudioFiles(slackFiles, opts = {}) {
  if (!Array.isArray(slackFiles) || slackFiles.length === 0) return [];
  const audioFiles = slackFiles.filter(isSlackAudioFile);
  if (audioFiles.length === 0) return [];

  const botToken = opts.botToken || process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.warn(
      `[slack] voice ingest skipped: SLACK_BOT_TOKEN not set (cannot download url_private)`,
    );
    return [];
  }
  const publicBase =
    opts.publicBase || process.env.PUBLIC_BASE_URL || process.env.BASE_URL;
  if (!publicBase) {
    console.warn(
      `[slack] voice ingest skipped: PUBLIC_BASE_URL not set (cannot build a transcribe-reachable URL)`,
    );
    return [];
  }
  const fetchImpl = opts.fetch || globalThis.fetch;
  const store = opts.storeAudio || storeAudio;
  const transcribe =
    opts.transcribe ||
    (async (url) => {
      const { executeTranscribeTool } =
        await import("../../tools/transcribe.js");
      return executeTranscribeTool(
        "transcribe_audio",
        { url },
        // Org-level ELEVENLABS_API_KEY, same as the Loop inbound path.
        { tenant: null },
      );
    });

  const transcripts = [];
  for (const file of audioFiles.slice(0, MAX_SLACK_FILES_PER_TURN)) {
    const src = file?.url_private_download || file?.url_private;
    if (!src) continue;
    try {
      const resp = await fetchImpl(src, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!resp || !resp.ok) {
        console.warn(
          `[slack] voice download failed status=${resp?.status || "?"} name=${file?.name || "?"}`,
        );
        continue;
      }
      const ab = await resp.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length === 0) {
        console.warn(`[slack] voice download empty name=${file?.name || "?"}`);
        continue;
      }
      if (buf.length > MAX_SLACK_FILE_BYTES) {
        console.warn(
          `[slack] voice too large bytes=${buf.length} name=${file?.name || "?"}`,
        );
        continue;
      }
      const id = store(buf);
      if (!id) {
        console.warn(`[slack] storeAudio refused name=${file?.name || "?"}`);
        continue;
      }
      const url = `${publicBase.replace(/\/$/, "")}/audio/${id}.mp3`;
      const result = await transcribe(url);
      const text = result?.text ? String(result.text).trim() : "";
      if (text) {
        transcripts.push(text);
        console.log(
          `[slack] voice transcribed name=${file?.name || "?"} bytes=${buf.length} chars=${text.length}`,
        );
      } else if (result?.error) {
        console.warn(
          `[slack] voice transcription failed name=${file?.name || "?"}: ${result.error}`,
        );
      }
    } catch (err) {
      console.warn(
        `[slack] voice ingest threw name=${file?.name || "?"}: ${err.message}`,
      );
    }
  }
  return transcripts;
}

// Exported for the test harness.
export { isSlackAudioFile, transcribeSlackAudioFiles };

// Soft link offer that goes out exactly once per Slack identity, as a
// follow-up reply AFTER the user gets their actual answer. Phrased as
// an invitation, not a gate. Leads with the sign-up URL since most
// people hitting Medha in Slack cold are first-time users; the
// phone-link path is a secondary line for users who already have a
// Medha account from iMessage and want to merge histories.
const LINK_OFFER_TEXT = `btw — new here? Sign up at ${JUSTAROCK_SIGNUP_URL}. Already have a Medha account from iMessage? Send your phone in international format (e.g. +15551234567) to link this Slack to it.`;

const LINK_COMPLETE_TEXT =
  "Linked. From now on this Slack and your iMessage history live together.";

const LINK_FAILED_TEXT =
  "I couldn't save that link just now. Mind sending the number again in a moment?";

/**
 * Route the envelope result.
 *
 * Three paths:
 *   1. complete_link / link_failed — user sent their phone as the entire
 *      message. Reply with a confirmation, do not dispatch to the agent
 *      loop (it's a credential, not a question).
 *   2. Normal dispatch (linked OR unlinked). Always enqueue so the user
 *      gets a real answer. If meta.offerLink is set, also post the
 *      one-time link P.S. as a separate threaded reply ~3.5s after
 *      dispatch so it lands AFTER the agent's answer in the thread.
 */
async function dispatchConverted(converted, enqueueMessage) {
  if (!converted) return; // non-actionable event, already acked

  // Path 1: phone-only message — link ceremony, no agent dispatch.
  if (converted.ack && converted.action) {
    const meta = converted.meta || {};
    const text =
      converted.action === "complete_link"
        ? LINK_COMPLETE_TEXT
        : LINK_FAILED_TEXT;
    console.log(
      `[slack] link-ceremony action=${converted.action} team=${meta.team} user=${meta.slackUserId}`,
    );
    await sendSlackReply({
      channel: meta.channel,
      thread_ts: meta.thread_ts,
      text,
    });
    return;
  }

  // Path 2: normal dispatch (linked or unlinked).
  const { args, meta } = converted;
  const [fromSynthetic] = args;

  // Stamp the session BEFORE enqueue so transport.sendMessage can find
  // the routing context the moment the agent loop replies.
  setSession(fromSynthetic, {
    channel: meta.channel,
    thread_ts: meta.thread_ts,
    slackUserId: meta.slackUserId,
    team: meta.team,
  });

  console.log(
    `[slack] inbound type=${meta.eventType} from=${fromSynthetic} channel=${meta.channel} linked=${meta.linked} offerLink=${meta.offerLink || false} text="${String(args[1]).slice(0, 80)}"`,
  );

  // Thread inbound-sender identity (resolved by lookupSenderByEmail in
  // envelope.js) through to the agent loop. Without this, handleWebhookMessage
  // has no way to know the human typing is Caleb-the-contact and not the
  // channel-owning tenant, so Medha defaults to addressing the channel owner.
  // The hints are stashed on a WeakMap in enqueueMessage and read back in
  // handleWebhookMessage where they get prefixed onto the user turn.
  const senderHints = {
    senderKind: meta.senderKind || null,
    senderDid: meta.senderDid || null,
    senderDisplayName: meta.senderDisplayName || null,
    sourceEmail: meta.sourceEmail || null,
    matchedVia: meta.matchedVia || null,
  };

  // Tab 22: Slack voice notes. Pull audio clips out of the file set first,
  // transcribe them, and hoist the transcript onto the message text with a
  // [voice-in] prefix so handleWebhookMessage's single voice-journaling path
  // captures it exactly like an iMessage voice memo. Document files (the rest)
  // still flow through the OCR ingest below.
  const slackFiles = Array.isArray(meta.slackFiles) ? meta.slackFiles : [];
  if (slackFiles.length > 0) {
    try {
      const transcripts = await transcribeSlackAudioFiles(slackFiles);
      if (transcripts.length > 0) {
        const joined = transcripts.join("\n\n");
        const existing = typeof args[1] === "string" ? args[1].trim() : "";
        const merged =
          existing && existing !== "[attachment-only message]"
            ? `${joined}\n\n${existing}`
            : joined;
        args[1] = `[voice-in] ${merged}`;
      }
    } catch (err) {
      console.warn(`[slack] voice ingest threw: ${err.message}`);
    }
  }

  // Slack file ingest, Tab 8 deferred path. Download each non-audio file with
  // the bot token, store via image-host, append the resulting URLs as the 9th
  // positional arg (`attachments`) so handleWebhookMessage routes them
  // through the same processInboundAttachments OCR pass Loop uses. Failures
  // per file are isolated; an empty result simply means no attachments.
  let attachmentUrls = [];
  const docFiles = slackFiles.filter((f) => !isSlackAudioFile(f));
  if (docFiles.length > 0) {
    try {
      attachmentUrls = await ingestSlackFiles(docFiles);
    } catch (err) {
      console.warn(`[slack] file ingest threw: ${err.message}`);
    }
  }
  const finalArgs =
    attachmentUrls.length > 0 ? [...args, attachmentUrls] : args;

  try {
    const result = enqueueMessage(finalArgs, { senderHints });
    if (result && typeof result.then === "function") {
      result.catch((err) =>
        console.warn(`[slack] enqueueMessage rejected: ${err.message}`),
      );
    }
    console.log(
      `[slack] dispatched to enqueueMessage from=${fromSynthetic} channel=${meta.channel} thread_ts=${meta.thread_ts || "-"} linked=${meta.linked} senderKind=${senderHints.senderKind || "-"} senderDisplayName=${senderHints.senderDisplayName || "-"}`,
    );
  } catch (err) {
    console.warn(`[slack] enqueueMessage threw: ${err.message}`);
    clearSession(fromSynthetic);
    return;
  }

  // One-time link offer follow-up. Posted ~3.5s after dispatch so the
  // agent's real answer lands first in the thread; the P.S. shows up
  // below it as a soft invitation. We mark-prompted BEFORE posting so
  // a Slack retry of the same event can't double-prompt.
  if (meta.offerLink && meta.team && meta.slackUserId) {
    setTimeout(() => {
      markPrompted({ team: meta.team, user: meta.slackUserId }).catch(() => {});
      sendSlackReply({
        channel: meta.channel,
        thread_ts: meta.thread_ts,
        text: LINK_OFFER_TEXT,
      }).catch((err) =>
        console.warn(`[slack] link-offer post failed: ${err.message}`),
      );
    }, 3500);
  }
}

// Re-export so future code can session-key off slack identities without
// re-importing from envelope.js.
export { deriveSlackFrom };

// Exported for the test harness — production callers go through
// slackEventsHandler.
export { dispatchConverted };

function requiredEnvCheck() {
  const missing = [];
  if (!process.env.SLACK_SIGNING_SECRET) missing.push("SLACK_SIGNING_SECRET");
  if (!process.env.SLACK_BOT_TOKEN) missing.push("SLACK_BOT_TOKEN");
  if (!process.env.SLACK_BOT_USER_ID) missing.push("SLACK_BOT_USER_ID");
  if (!process.env.MEDHA_EXPERT_SENDER_ID)
    missing.push("MEDHA_EXPERT_SENDER_ID");
  return missing;
}

function writeJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Main Slack events handler.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} rawBody — already-read utf8 body bytes
 * @param {Object} deps
 * @param {Function} deps.enqueueMessage — agent.js's enqueueMessage(args)
 */
export async function slackEventsHandler(req, res, rawBody, deps = {}) {
  const { enqueueMessage } = deps;

  // ── Pre-flight env check ─────────────────────────────────────────
  // Surface configuration errors as a clear 503 rather than crashing
  // mid-handler. Easier for ops to spot in Railway logs.
  const missing = requiredEnvCheck();
  if (missing.length > 0) {
    console.warn(
      `[slack] required env missing: ${missing.join(", ")} — refusing /slack/events`,
    );
    return writeJson(res, 503, {
      error: "slack-not-configured",
      missing,
    });
  }

  if (typeof enqueueMessage !== "function") {
    console.warn("[slack] enqueueMessage dependency not provided");
    return writeJson(res, 500, { error: "agent-not-wired" });
  }

  // ── Parse body ───────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch (err) {
    console.warn(`[slack] body is not valid JSON: ${err.message}`);
    return writeJson(res, 400, { error: "invalid-json" });
  }

  // ── url_verification challenge ───────────────────────────────────
  // Slack hits this once when you point the request URL at the app.
  // The body is just { type: "url_verification", challenge: "..." }
  // and we have to echo the challenge back, BEFORE signature checks
  // (the challenge fires before the app has any settled signing secret
  // on Slack's side in some setups).
  if (payload.type === "url_verification") {
    return writeJson(res, 200, { challenge: payload.challenge });
  }

  // ── Signature verification ───────────────────────────────────────
  const sig = verifySlackSignature(
    rawBody || "",
    req.headers || {},
    process.env.SLACK_SIGNING_SECRET,
  );
  if (!sig.ok) {
    console.warn(`[slack] signature verification failed: ${sig.reason}`);
    return writeJson(res, 401, {
      error: "invalid-signature",
      reason: sig.reason,
    });
  }

  // ── Dedup ────────────────────────────────────────────────────────
  // Slack retries event deliveries if it does not see a 200 fast enough,
  // so the same event_id can land 2-3 times. We mark up front (before
  // ack) so concurrent retries collide on the first one.
  const eventId =
    payload.event_id || payload?.event?.client_msg_id || payload?.event?.ts;
  if (eventId && wasProcessed(eventId)) {
    console.log(`[slack] duplicate event_id=${eventId} — ignoring`);
    return writeJson(res, 200, { ok: true, deduped: true });
  }
  if (eventId) markProcessed(eventId);

  // ── Ack 200 immediately ──────────────────────────────────────────
  // Slack expects a 200 within 3 seconds or it retries. Everything
  // below is fire-and-forget.
  writeJson(res, 200, { ok: true });

  // ── Convert + dispatch ───────────────────────────────────────────
  // slackEventToInternal is now async because identity resolution
  // (Option C link flow) calls medha-id. Kick it off fire-and-forget
  // so the 200 above is never blocked by the round-trip; errors get
  // logged but never propagate back to Slack.
  Promise.resolve()
    .then(() =>
      slackEventToInternal(payload, {
        botUserId: process.env.SLACK_BOT_USER_ID,
        senderUuid: process.env.MEDHA_EXPERT_SENDER_ID,
      }),
    )
    .then((converted) => dispatchConverted(converted, enqueueMessage))
    .catch((err) => console.warn(`[slack] dispatch failed: ${err.message}`));

  // Note: we intentionally do NOT clearSession here. The agent loop
  // is async (queued behind other messages, runs the AI, calls tools,
  // etc.) and may reply long after this function returns. session.js
  // has its own 5-minute TTL that will clean up stranded entries.
}

/**
 * Convenience helper exposed so server.js can post one-shot replies
 * outside the agent loop (e.g. an error message when the agent crashed
 * before reaching transport.sendMessage). Currently unused by the
 * route handler itself — kept here so future code paths can reach it
 * without re-importing responder.
 */
export { sendSlackReply };
