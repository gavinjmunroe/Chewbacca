/**
 * Slack outbound file uploads via files.uploadV2.
 *
 * Background: chat.postMessage with a URL in the body renders the URL as a
 * link, not as a file attachment. When generate_pdf / generate_image /
 * generate_docx etc fires for a Slack reply, the model's reply text gets
 * the URL stripped (the prompt tells it not to paste URLs); the file would
 * end up nowhere unless we explicitly upload it. files.uploadV2 is the
 * current path — chat.postMessage's `files` parameter and files.upload
 * (legacy v1) were both deprecated in 2024.
 *
 * The flow is 3 round-trips per file:
 *
 *   1. POST https://slack.com/api/files.getUploadURLExternal
 *      Form data: { filename, length, alt_txt? } + Authorization: Bearer xoxb-...
 *      Returns { ok, upload_url, file_id }
 *
 *   2. POST {upload_url}
 *      Raw binary body, content-type matches the file's mime.
 *      Returns plain text "OK" on success.
 *
 *   3. POST https://slack.com/api/files.completeUploadExternal
 *      JSON body: { files: [{ id, title }], channel_id, thread_ts?, initial_comment? }
 *      Returns { ok, files: [...] }
 *
 * We use step 3 to attach the message text as initial_comment so the upload
 * shows up as one Slack message (file + caption) instead of two. Threading
 * is preserved via thread_ts.
 *
 * Required env var:
 *   SLACK_BOT_TOKEN — xoxb-... bot token. Same one chat.postMessage uses.
 */

const GET_UPLOAD_URL = "https://slack.com/api/files.getUploadURLExternal";
const COMPLETE_UPLOAD_URL =
  "https://slack.com/api/files.completeUploadExternal";

/**
 * Derive a filename from a URL like https://host/image/<id>.<ext>.
 */
function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "file";
    return last;
  } catch {
    return "file";
  }
}

/**
 * Fetch a single own-domain attachment URL into a Buffer + length + content-type.
 */
async function fetchAttachmentBytes(url, fetchImpl) {
  const resp = await fetchImpl(url, { redirect: "follow" });
  if (!resp || !resp.ok) {
    throw new Error(
      `attachment fetch failed status=${resp?.status || "?"} url=${url}`,
    );
  }
  const contentType =
    resp.headers?.get?.("content-type") || "application/octet-stream";
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length === 0) {
    throw new Error(`attachment empty url=${url}`);
  }
  return { buf, contentType, length: buf.length };
}

/**
 * Upload one or more own-domain URLs as REAL Slack files. Posts a single
 * message in the channel/thread with the supplied initialComment as the
 * caption.
 *
 * @param {object} args
 * @param {string} args.botToken      Slack bot token (xoxb-...).
 * @param {string} args.channel       Slack channel id from session.
 * @param {string} [args.threadTs]    thread_ts to keep the upload in-thread.
 * @param {string[]} args.urls        Own-domain attachment URLs (image-host).
 * @param {string} [args.initialComment]  Reply text rendered as the upload caption.
 * @param {Function} [args.fetch]     Injectable fetch for tests.
 * @returns {Promise<{ok: boolean, file_ids?: string[], error?: string}>}
 */
export async function uploadFilesToSlack({
  botToken,
  channel,
  threadTs,
  urls,
  initialComment,
  fetch: fetchInjected,
} = {}) {
  const fetchImpl = fetchInjected || globalThis.fetch;
  if (!botToken) return { ok: false, error: "no-bot-token" };
  if (!channel) return { ok: false, error: "missing-channel" };
  if (!Array.isArray(urls) || urls.length === 0) {
    return { ok: false, error: "no-urls" };
  }

  const fileIds = [];
  const fileEntries = [];
  // Capture the first per-file Slack API error so when ALL uploads fail we
  // can surface the actual reason (e.g. missing_scope) instead of the
  // bucketed "all-uploads-failed". The responder branches on this to
  // decide whether to include an admin hint in the chat.postMessage
  // fallback.
  let firstSlackError = null;

  for (const url of urls) {
    // Step A: fetch bytes from our own-domain image-host URL.
    let bytes;
    try {
      bytes = await fetchAttachmentBytes(url, fetchImpl);
    } catch (err) {
      console.warn(`[slack-files] ${err.message}`);
      continue;
    }

    const filename = filenameFromUrl(url);

    // Step 1: ask Slack for a per-file upload URL.
    let getRes;
    try {
      const form = new URLSearchParams();
      form.set("filename", filename);
      form.set("length", String(bytes.length));
      getRes = await fetchImpl(GET_UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch (err) {
      console.warn(`[slack-files] getUploadURLExternal threw: ${err.message}`);
      continue;
    }
    const getBody = await getRes
      .json()
      .catch(() => ({ ok: false, error: "bad-json" }));
    if (!getRes.ok || !getBody.ok || !getBody.upload_url || !getBody.file_id) {
      const err = String(getBody.error || `http_${getRes.status}`);
      if (!firstSlackError) firstSlackError = err;
      console.warn(
        `[slack-files] getUploadURLExternal failed: status=${getRes.status} error=${err}`,
      );
      continue;
    }

    // Step 2: PUT/POST the bytes to the per-file upload URL.
    let putRes;
    try {
      putRes = await fetchImpl(getBody.upload_url, {
        method: "POST",
        headers: { "Content-Type": bytes.contentType },
        body: bytes.buf,
      });
    } catch (err) {
      console.warn(`[slack-files] upload-bytes threw: ${err.message}`);
      continue;
    }
    if (!putRes.ok) {
      const text = await putRes
        .text()
        .catch(() => "<unreadable>")
        .then((t) => (typeof t === "string" ? t.slice(0, 200) : "<binary>"));
      console.warn(
        `[slack-files] upload-bytes failed: status=${putRes.status} body=${text}`,
      );
      continue;
    }

    fileIds.push(getBody.file_id);
    fileEntries.push({ id: getBody.file_id, title: filename });
  }

  if (fileEntries.length === 0) {
    // Surface the most actionable error: a real Slack API error (esp.
    // missing_scope) beats the generic bucketed code. The responder uses
    // the tagged scope_needed to decide whether to append an admin hint.
    const surfaced = firstSlackError || "all-uploads-failed";
    const scopeNeeded = surfaced === "missing_scope" ? "files:write" : null;
    return { ok: false, error: surfaced, scope_needed: scopeNeeded };
  }

  // Step 3: complete the upload(s) in one call so they land as a single
  // Slack message with the initial_comment caption + in-thread when
  // threadTs is set.
  const completeBody = {
    files: fileEntries,
    channel_id: channel,
  };
  if (threadTs) completeBody.thread_ts = threadTs;
  if (initialComment && initialComment.length > 0) {
    completeBody.initial_comment = initialComment;
  }

  let completeRes;
  try {
    completeRes = await fetchImpl(COMPLETE_UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(completeBody),
    });
  } catch (err) {
    console.warn(`[slack-files] completeUploadExternal threw: ${err.message}`);
    return { ok: false, error: err.message, scope_needed: null };
  }
  const completeBodyJson = await completeRes
    .json()
    .catch(() => ({ ok: false, error: "bad-json" }));
  if (!completeRes.ok || !completeBodyJson.ok) {
    const err = String(completeBodyJson.error || `http_${completeRes.status}`);
    const scopeNeeded = err === "missing_scope" ? "files:write" : null;
    console.warn(
      `[slack-files] completeUploadExternal failed: status=${completeRes.status} error=${err}`,
    );
    return {
      ok: false,
      error: err,
      scope_needed: scopeNeeded,
    };
  }

  return { ok: true, file_ids: fileIds };
}
