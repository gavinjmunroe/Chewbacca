#!/usr/bin/env node
/**
 * send-checkin.js
 *
 * Invoked by Perplexity Computer crons to deliver a check-in to a user
 * via Loop Message. Uses the SAME env vars as the production Railway
 * deployment (LOOP_API_KEY, LOOP_SENDER_ID, CALEB_PHONE, SAGAR_PHONE).
 *
 * Falls back to writing to vision/inbox/ if:
 *   - the target phone env var is not set (phase 0)
 *   - Loop API returns non-2xx
 *
 * Usage:
 *   node Newton/agent/scripts/send-checkin.js \
 *     --to caleb \
 *     --dimension emotional \
 *     --kind morning \
 *     --text "<the prompt>"
 *
 * Env vars (required for live send):
 *   LOOP_API_KEY     (Authorization header)
 *   LOOP_SECRET_KEY  (Loop-Secret-Key header, required by Loop for status + production sends)
 *   LOOP_SENDER_ID
 *   CALEB_PHONE   (for --to caleb)
 *   SAGAR_PHONE   (for --to sagar, phase 1+)
 *
 * Optional:
 *   LOOP_BASE_URL (defaults to https://a.loopmessage.com)
 *
 * Side effects:
 *   - Writes vision/inbox/<file> on both success and fallback (training track ingest)
 *   - Writes vision/outbox/<stamp>/<msg-id>.json with the full Loop request/response
 *     and post-send status poll, so we have an audit trail independent of Loop's
 *     webhook UI. This is what the tracer reads.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const INBOX_DIR = path.join(REPO_ROOT, "vision", "inbox");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function todayStamp() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function writeInboxFallback({ to, dimension, kind, text, reason }) {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const stamp = todayStamp();
  const filename =
    to === "caleb"
      ? `checkin-${kind}-caleb-${stamp}.md`
      : `checkin-${kind}-${stamp}.md`;
  const full = path.join(INBOX_DIR, filename);
  const phase = reason === "no-phone" ? 0 : 1;
  const fm = [
    "---",
    `to: ${to}`,
    `dimension: ${dimension}`,
    `phase: ${phase}`,
    reason === "no-phone"
      ? "would_send_via: loop_imessage"
      : `sent_via: loop_imessage_attempted`,
    `fallback_reason: ${reason}`,
    `stamp: ${stamp}`,
    "---",
    "",
    text,
    "",
  ].join("\n");
  fs.writeFileSync(full, fm);
  return full;
}

async function sendToLoop({ recipient, text, passthrough }) {
  const key = process.env.LOOP_API_KEY;
  const secret = process.env.LOOP_SECRET_KEY;
  const sender = process.env.LOOP_SENDER_ID;
  const base = process.env.LOOP_BASE_URL || "https://a.loopmessage.com";
  if (!key || !sender) {
    return { ok: false, reason: "missing-loop-env" };
  }
  if (!secret) {
    return { ok: false, reason: "missing-loop-secret-key" };
  }
  const url = `${base}/api/v1/message/send/`;
  // Loop's documented body shape uses `recipient` + `sender_name` + `text`,
  // with optional `passthrough` for status-callback metadata. We pass a stable
  // passthrough string so webhook ingestion can correlate later.
  const body = { recipient, sender_name: sender, text };
  if (passthrough) body.passthrough = passthrough;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: key,
        "Loop-Secret-Key": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const respText = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `loop-${res.status}`, body: respText };
    }
    try {
      return { ok: true, response: JSON.parse(respText) };
    } catch {
      return { ok: true, response: { raw: respText } };
    }
  } catch (err) {
    return { ok: false, reason: "loop-fetch-error", error: err.message };
  }
}

/**
 * Poll Loop's status endpoint for a message_id. Returns the status object or
 * null if unavailable. Waits `delayMs` before the first poll so Loop has time
 * to process.
 */
async function pollLoopStatus(messageId, { delayMs = 6000, timeoutMs = 4000 } = {}) {
  const key = process.env.LOOP_API_KEY;
  const secret = process.env.LOOP_SECRET_KEY;
  const base = process.env.LOOP_BASE_URL || "https://a.loopmessage.com";
  if (!key || !secret || !messageId) return null;
  await new Promise((r) => setTimeout(r, delayMs));
  const url = `${base}/api/v1/message/status/${messageId}/`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { Authorization: key, "Loop-Secret-Key": secret },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const txt = await res.text();
    if (!res.ok) return { ok: false, http: res.status, body: txt };
    try { return { ok: true, ...JSON.parse(txt) }; } catch { return { ok: true, raw: txt }; }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Write an audit record into vision/outbox/<stamp>/<msg-id>.json */
function writeOutboxAudit({ to, dimension, kind, text, sendResult, status, stamp }) {
  const OUTBOX_DIR = path.join(REPO_ROOT, "vision", "outbox", stamp);
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const msgId =
    sendResult?.response?.message_id ||
    sendResult?.response?.messageId ||
    `no-id-${Date.now()}`;
  const file = path.join(OUTBOX_DIR, `${msgId}.json`);
  const record = {
    stamp,
    sent_at_iso: new Date().toISOString(),
    to, dimension, kind,
    text,
    message_id: msgId,
    send_result: sendResult,
    status_poll: status,
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}

async function main() {
  const args = parseArgs(process.argv);
  const to = String(args.to || "").toLowerCase();
  const dimension = String(args.dimension || "").toLowerCase();
  const kind = String(args.kind || "").toLowerCase();
  const text = args.text;

  if (!to || !dimension || !kind || !text) {
    console.error(
      "Usage: send-checkin.js --to <caleb|sagar> --dimension <emotional|physical|spiritual> --kind <morning|evening|sunday> --text <...>",
    );
    process.exit(2);
  }

  const phoneEnv = to === "caleb" ? "CALEB_PHONE" : "SAGAR_PHONE";
  const recipient = process.env[phoneEnv];

  if (!recipient) {
    const file = writeInboxFallback({
      to,
      dimension,
      kind,
      text,
      reason: "no-phone",
    });
    console.log(
      JSON.stringify({
        ok: true,
        mode: "inbox-fallback",
        reason: "no-phone",
        file,
      }),
    );
    return;
  }

  const stamp = todayStamp();
  const passthrough = `checkin:${to}:${kind}:${dimension}:${stamp}`;
  const result = await sendToLoop({ recipient, text, passthrough });

  if (result.ok) {
    // Poll status so we have a delivery-level signal, not just queued=200.
    const msgId = result.response?.message_id;
    const status = msgId ? await pollLoopStatus(msgId) : null;
    const inbox = writeInboxFallback({
      to, dimension, kind, text, reason: "sent-also-inbox",
    });
    const outbox = writeOutboxAudit({
      to, dimension, kind, text, sendResult: result, status, stamp,
    });
    const deliveryOk = status?.status === "delivered" || status?.status === "processing" || status?.status === "sent";
    console.log(JSON.stringify({
      ok: true,
      mode: "loop",
      message_id: msgId,
      status: status?.status || "unknown",
      delivery_verified: deliveryOk,
      inbox, outbox,
    }));
    // Exit non-zero if Loop reported a terminal failure so the cron escalates.
    if (status && ["failed", "timeout", "unknown_sender"].includes(status.status)) {
      process.exit(3);
    }
    return;
  }

  const inbox = writeInboxFallback({
    to, dimension, kind, text, reason: result.reason,
  });
  const outbox = writeOutboxAudit({
    to, dimension, kind, text, sendResult: result, status: null, stamp,
  });
  console.log(JSON.stringify({
    ok: false,
    mode: "inbox-fallback",
    reason: result.reason,
    body: result.body,
    inbox, outbox,
  }));
  process.exit(1);
}

main().catch((err) => {
  console.error("send-checkin fatal:", err);
  process.exit(1);
});
