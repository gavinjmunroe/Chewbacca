/**
 * Slack Canvas creation via the canvases.* Web API.
 *
 * Background: long-form output (a polished newsletter section, a multi-part
 * doc, a meeting recap) shouldn't be dumped into a channel as a 2000-char
 * wall of chat.postMessage text. Slack Canvas is the right surface for that:
 * a rich, persistent document that lives alongside the conversation.
 *
 * The flow is up to 3 round-trips:
 *
 *   1. POST https://slack.com/api/canvases.create
 *      JSON: { title?, document_content: { type: "markdown", markdown } }
 *      Returns { ok, canvas_id }. Requires the bot scope `canvases:write`.
 *
 *   2. POST https://slack.com/api/files.info   (best-effort)
 *      Form: { file: <canvas_id> }
 *      A canvas is backed by a file, so files.info surfaces a real
 *      `permalink` we can hand back to the user as a clickable link. If this
 *      fails we still return the canvas_id; the canvas exists either way.
 *
 *   3. POST https://slack.com/api/canvases.access.set   (only when channel set)
 *      JSON: { canvas_id, access_level: "write", channel_ids: [channel] }
 *      Grants the channel's members access so the canvas shows up for them.
 *
 * Required scope:
 *   canvases:write: bot scope, added to the Slack app alongside files:write.
 *   files:read is needed for the step-2 permalink lookup; if it's missing we
 *   degrade gracefully (no permalink, canvas still created).
 */

const CANVAS_CREATE_URL = "https://slack.com/api/canvases.create";
const CANVAS_ACCESS_SET_URL = "https://slack.com/api/canvases.access.set";
const FILES_INFO_URL = "https://slack.com/api/files.info";

/**
 * Create a Slack Canvas from markdown and (optionally) share it with a channel.
 *
 * @param {object} args
 * @param {string} args.botToken          Slack bot token (xoxb-…) with canvases:write.
 * @param {string} args.markdown          Canvas body as Slack-flavored markdown.
 * @param {string} [args.title]           Canvas title.
 * @param {string} [args.channel]         Channel id to grant access to (optional).
 * @param {string} [args.accessLevel]     "read" | "write" for the channel grant (default "write").
 * @param {Function} [args.fetch]         Injectable fetch for tests.
 * @returns {Promise<{ok: boolean, canvas_id?: string, permalink?: string, shared?: boolean, error?: string, scope_needed?: string|null}>}
 */
export async function createSlackCanvas({
  botToken,
  markdown,
  title,
  channel,
  accessLevel = "write",
  fetch: fetchInjected,
} = {}) {
  const fetchImpl = fetchInjected || globalThis.fetch;
  if (!botToken)
    return { ok: false, error: "no-bot-token", scope_needed: null };
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    return { ok: false, error: "missing-markdown", scope_needed: null };
  }

  // Step 1: create the canvas.
  const createBody = {
    document_content: { type: "markdown", markdown },
  };
  if (title && title.trim().length > 0) createBody.title = title;

  let createRes;
  try {
    createRes = await fetchImpl(CANVAS_CREATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(createBody),
    });
  } catch (err) {
    return {
      ok: false,
      error: err.message || "create_threw",
      scope_needed: null,
    };
  }
  const createJson = await createRes
    .json()
    .catch(() => ({ ok: false, error: "bad-json" }));
  if (!createRes.ok || !createJson.ok || !createJson.canvas_id) {
    const err = String(createJson.error || `http_${createRes.status}`);
    const scopeNeeded = err === "missing_scope" ? "canvases:write" : null;
    console.warn(`[slack-canvas] canvases.create failed: ${err}`);
    return { ok: false, error: err, scope_needed: scopeNeeded };
  }

  const canvasId = createJson.canvas_id;

  // Step 2: best-effort permalink lookup. A canvas is file-backed, so
  // files.info returns a real, clickable permalink. Failure here never
  // blocks. The canvas already exists.
  let permalink;
  try {
    const form = new URLSearchParams();
    form.set("file", canvasId);
    const infoRes = await fetchImpl(FILES_INFO_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const infoJson = await infoRes.json().catch(() => ({ ok: false }));
    if (infoJson.ok && infoJson.file?.permalink) {
      permalink = infoJson.file.permalink;
    }
  } catch (err) {
    console.warn(
      `[slack-canvas] files.info permalink lookup failed: ${err.message}`,
    );
  }

  // Step 3: share with the channel when one is supplied.
  let shared = false;
  if (channel && channel.trim().length > 0) {
    try {
      const accessRes = await fetchImpl(CANVAS_ACCESS_SET_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          canvas_id: canvasId,
          access_level: accessLevel === "read" ? "read" : "write",
          channel_ids: [channel],
        }),
      });
      const accessJson = await accessRes.json().catch(() => ({ ok: false }));
      shared = !!accessJson.ok;
      if (!accessJson.ok) {
        console.warn(
          `[slack-canvas] canvases.access.set failed: ${accessJson.error || "unknown"} (canvas still created)`,
        );
      }
    } catch (err) {
      console.warn(`[slack-canvas] canvases.access.set threw: ${err.message}`);
    }
  }

  return {
    ok: true,
    canvas_id: canvasId,
    permalink,
    shared,
    scope_needed: null,
  };
}
