/**
 * Slack outbound: post replies via chat.postMessage (text only) or
 * files.uploadV2 (text + attachments).
 *
 * Lifted in shape from Togari's togari-platform/src/transports/slack/responder.ts,
 * rewritten in plain fetch (no @slack/web-api dependency) to keep
 * medha-imessage's dependency footprint flat.
 *
 * Transport parity (Caleb 2026-05-28): when generate_pdf / generate_image /
 * generate_docx etc returns own-domain URLs and the reply is going out
 * over Slack, we upload the bytes as REAL Slack files (initial_comment =
 * the reply text) instead of pasting the URL into a chat.postMessage.
 * iMessage already delivered attachments as real attachments; this gets
 * Slack to parity.
 *
 * Required env var:
 *   SLACK_BOT_TOKEN — xoxb-... bot token from the Slack app install.
 */

import { uploadFilesToSlack } from "./files-upload.js";
import { markdownToSlack } from "./mrkdwn.js";

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

const MEDHA_IMAGE_HOST_HINT_PREFIX =
  "medha-platform-production.up.railway.app/image/";

// One-line, admin-actionable hint pasted into the fallback chat.postMessage
// when files.uploadV2 fails with missing_scope AND the attachment URL is
// our own image-host (i.e. we can confidently tell the user how to fix it).
const MISSING_SCOPE_HINT =
  "(Sorry, couldn't attach natively. If you're the workspace admin, add `files:write` to the bot scope at https://api.slack.com/apps then reinstall the app.)";

function urlsAreMedhaHosted(urls) {
  if (!Array.isArray(urls)) return false;
  return urls.some(
    (u) => typeof u === "string" && u.includes(MEDHA_IMAGE_HOST_HINT_PREFIX),
  );
}

function buildFallbackText({ text, urls, includeAdminHint }) {
  const lines = [];
  if (text && text.trim().length > 0) {
    lines.push(text);
    lines.push("");
  }
  for (const url of urls) {
    if (typeof url === "string" && url.length > 0) lines.push(url);
  }
  if (includeAdminHint) {
    lines.push("");
    lines.push(MISSING_SCOPE_HINT);
  }
  return lines.join("\n");
}

async function postPlainText({ token, channel, thread_ts, text }) {
  const body = { channel };
  if (thread_ts) body.thread_ts = thread_ts;
  if (text) body.text = text;
  const res = await fetch(SLACK_POST_MESSAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { ok: false, error: raw.slice(0, 200) };
  }
  if (!res.ok || !data.ok) {
    return { ok: false, error: String(data.error || `http_${res.status}`) };
  }
  return { ok: true, ts: data.ts };
}

/**
 * Post a threaded reply into Slack.
 *
 * @param {Object} args
 * @param {string} args.channel — channel id from the inbound event
 * @param {string} [args.thread_ts] — thread anchor; if omitted, posts at top level
 * @param {string} args.text — message text (Slack mrkdwn supported)
 * @param {Array} [args.blocks] — optional Block Kit blocks
 * @param {string[]} [args.attachments] — own-domain URLs to upload as REAL
 *   Slack files (image-host PNGs, generated PDFs, generated XLSX, etc.).
 *   When present and non-empty, routes through files.uploadV2 instead of
 *   chat.postMessage and uses `text` as the upload's initial_comment.
 * @returns {Promise<{ok: boolean, ts?: string, error?: string, file_ids?: string[]}>}
 *   ts is the posted message's timestamp so subsequent replies in the
 *   same agent turn can thread off the SAME parent. file_ids is populated
 *   on the upload path; ts is not (Slack returns the message ts only via
 *   the file's shares metadata, which we don't surface).
 */
export async function sendSlackReply({
  channel,
  thread_ts,
  text,
  blocks,
  attachments,
} = {}) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "no-bot-token" };
  }
  if (!channel) {
    return { ok: false, error: "missing-channel" };
  }
  // Convert the agent's GitHub-flavored markdown to Slack mrkdwn so headers and
  // bold render natively instead of showing literal `#` / `**` (2026-06-03).
  // Block Kit blocks (already mrkdwn) are left untouched.
  const renderedText = typeof text === "string" ? markdownToSlack(text) : text;
  // Attachments path: upload the file(s) with `text` as the caption. Skip
  // the separate chat.postMessage entirely — the upload posts a single
  // Slack message with both the file and the caption text.
  //
  // Fallback (added 2026-05-28): if the upload fails — most commonly
  // missing_scope when the bot token lacks files:write, but also rate
  // limits, transient 5xx, network errors — we fall back to
  // chat.postMessage with the original text PLUS the URLs appended on
  // their own lines. Slack auto-unfurls those into preview cards, so
  // the user still sees their file (just less natively). When the
  // failure reason is missing_scope AND the attachment is a Medha
  // image-host URL, we also include a one-line admin hint pointing at
  // api.slack.com/apps. Without this fallback a missing scope swallowed
  // the entire turn — the user saw nothing.
  if (Array.isArray(attachments) && attachments.length > 0) {
    let result;
    try {
      result = await uploadFilesToSlack({
        botToken: token,
        channel,
        threadTs: thread_ts,
        urls: attachments,
        initialComment: renderedText || "",
      });
    } catch (err) {
      result = { ok: false, error: err.message || "upload_threw" };
    }
    if (result && result.ok) {
      return { ok: true, file_ids: result.file_ids || [] };
    }

    const reason = (result && result.error) || "unknown";
    console.warn(
      `[slack-responder] files.uploadV2 failed (${reason}); falling back to chat.postMessage with URL pastes`,
    );
    const includeAdminHint =
      reason === "missing_scope" && urlsAreMedhaHosted(attachments);
    const fallbackText = buildFallbackText({
      text: renderedText,
      urls: attachments,
      includeAdminHint,
    });
    const sendResult = await postPlainText({
      token,
      channel,
      thread_ts,
      text: fallbackText,
    });
    return { ...sendResult, fallback: true, uploadError: reason };
  }

  if (!renderedText && !blocks) {
    return { ok: false, error: "missing-text-and-blocks" };
  }

  const body = { channel };
  if (thread_ts) body.thread_ts = thread_ts;
  if (renderedText) body.text = renderedText;
  if (Array.isArray(blocks) && blocks.length > 0) body.blocks = blocks;

  try {
    const res = await fetch(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { ok: false, error: raw.slice(0, 200) };
    }
    if (!res.ok || !data.ok) {
      console.warn(
        `[slack-responder] chat.postMessage failed: status=${res.status} error=${data.error || "unknown"}`,
      );
      return { ok: false, error: String(data.error || `http_${res.status}`) };
    }
    return { ok: true, ts: data.ts };
  } catch (err) {
    console.warn(`[slack-responder] chat.postMessage threw: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
