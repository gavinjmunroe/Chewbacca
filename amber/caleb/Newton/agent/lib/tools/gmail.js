/**
 * gmail.js — Native Gmail REST API integration with per-tenant OAuth2.
 *
 * Token lifecycle:
 *   - Prefers GMAIL_OAUTH_* secrets; falls back to GCAL_OAUTH_* (shared Google account)
 *   - access token: GMAIL_OAUTH_ACCESS / GCAL_OAUTH_ACCESS  + _EXPIRES
 *   - refresh token: GMAIL_OAUTH_REFRESH / GCAL_OAUTH_REFRESH (never expires)
 *   - client creds: GMAIL_OAUTH_CLIENT_ID/SECRET → GCAL_OAUTH_CLIENT_ID/SECRET
 *     → env GCAL_OAUTH_CLIENT_ID / GCAL_OAUTH_CLIENT_SECRET (canonical) or
 *       GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (legacy alias)
 *
 * Scopes required: gmail.modify, gmail.send
 * Endpoint base:   https://gmail.googleapis.com/gmail/v1/users/me/
 */

import { randomUUID } from "node:crypto";

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

registerCapability("_tools_Gmail", "Read, search, and send Gmail messages");
registerCapability(
  "_tools_Gmail",
  "List inbox, read individual messages, draft emails",
);
registerCapability(
  "_tools_Gmail",
  "Reply in-thread to a message and send mail with attachments",
);

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 min

// Gmail caps a single message (incl. base64 overhead) at 25 MB. We stay well
// under that per attachment so the encoded MIME never trips the limit.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

// ── Secret helpers ────────────────────────────────────────────────────────────

function tenantDid(tenant) {
  if (!tenant) return null;
  if (typeof tenant === "string") return tenant;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function setSecret(tenant, key, value) {
  const did = tenantDid(tenant);
  if (!did || !AMBER_ID_API_URL || !AMBER_ID_API_KEY) return;
  try {
    await fetch(
      `${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: {
          "x-api-key": AMBER_ID_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch (err) {
    console.warn(`[gmail] setSecret ${key} failed:`, err?.message);
  }
}

// ── Credential resolution ─────────────────────────────────────────────────────

/**
 * Resolve client credentials. GMAIL_OAUTH_* takes priority; falls back to
 * GCAL_OAUTH_* then org-level env vars (shared Google OAuth app).
 */
async function getClientCreds(tenant) {
  const [gmailId, gmailSecret, gcalId, gcalSecret] = await Promise.all([
    getSecret(tenant, "GMAIL_OAUTH_CLIENT_ID"),
    getSecret(tenant, "GMAIL_OAUTH_CLIENT_SECRET"),
    getSecret(tenant, "GCAL_OAUTH_CLIENT_ID", {
      fallbackEnv: ["GCAL_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"],
    }),
    getSecret(tenant, "GCAL_OAUTH_CLIENT_SECRET", {
      fallbackEnv: ["GCAL_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET"],
    }),
  ]);
  return {
    clientId: gmailId || gcalId,
    clientSecret: gmailSecret || gcalSecret,
  };
}

/**
 * Determine which secret namespace to use (GMAIL or GCAL).
 * Returns the prefix of secrets that have a refresh token.
 */
async function resolveNamespace(tenant) {
  const gmailRefresh = await getSecret(tenant, "GMAIL_OAUTH_REFRESH");
  if (gmailRefresh) return { prefix: "GMAIL", refreshToken: gmailRefresh };
  const gcalRefresh = await getSecret(tenant, "GCAL_OAUTH_REFRESH");
  if (gcalRefresh) return { prefix: "GCAL", refreshToken: gcalRefresh };
  return null;
}

// ── Token management ──────────────────────────────────────────────────────────

async function refreshAccessToken(tenant, refreshToken, prefix) {
  const { clientId, clientSecret } = await getClientCreds(tenant);
  if (!clientId || !clientSecret) {
    console.warn("[gmail] Missing OAuth client credentials");
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let data;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn("[gmail] Token refresh failed:", res.status, errText);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn("[gmail] Token refresh error:", err?.message);
    return null;
  }

  const { access_token, expires_in } = data;
  if (!access_token) return null;

  const expiresAt = Date.now() + (expires_in ?? 3600) * 1000;
  setSecret(tenant, `${prefix}_OAUTH_ACCESS`, access_token).catch(() => {});
  setSecret(tenant, `${prefix}_OAUTH_EXPIRES`, String(expiresAt)).catch(
    () => {},
  );

  return access_token;
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns null when tenant has no Google OAuth connected.
 */
async function resolveAccessToken(tenant) {
  const ns = await resolveNamespace(tenant);
  if (!ns) return null;

  const { prefix, refreshToken } = ns;
  const [cachedAccess, expiresStr] = await Promise.all([
    getSecret(tenant, `${prefix}_OAUTH_ACCESS`),
    getSecret(tenant, `${prefix}_OAUTH_EXPIRES`),
  ]);

  const expiresAt = expiresStr ? parseInt(expiresStr, 10) : 0;
  if (cachedAccess && expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return cachedAccess;
  }

  return refreshAccessToken(tenant, refreshToken, prefix);
}

// ── Core HTTP client ──────────────────────────────────────────────────────────

export async function gmailRequest({ tenant, method, path, query, body }) {
  const accessToken = await resolveAccessToken(tenant);
  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: "gmail-not-connected",
    };
  }

  let url = `${GMAIL_BASE}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      // Array values map to repeated query keys (e.g. metadataHeaders).
      // String(arr) joins with commas, which Gmail then treats as a single
      // bogus header name like "From,Subject,Date,To" and returns the
      // message with payload.headers = []. That made listInbox return rows
      // with empty from/subject/date and Medha invent a "pagination issue"
      // excuse. Append each element separately so Gmail sees the array
      // form it actually documents.
      if (Array.isArray(v)) {
        for (const item of v) params.append(k, String(item));
      } else {
        params.set(k, String(v));
      }
    }
    url += `?${params.toString()}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  }

  let data = null;
  if (res.status !== 204) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const errMsg = data?.error?.message || data?.error || `HTTP ${res.status}`;
    return { ok: false, status: res.status, data, error: errMsg };
  }

  return { ok: true, status: res.status, data };
}

// ── Message helpers ───────────────────────────────────────────────────────────

/** Decode base64url-encoded email body. */
function decodeBody(payload) {
  const findPart = (parts, mimeType) => {
    for (const part of parts || []) {
      if (part.mimeType === mimeType && part.body?.data) return part.body.data;
      const nested = findPart(part.parts, mimeType);
      if (nested) return nested;
    }
    return null;
  };

  const raw =
    payload?.body?.data ||
    findPart(payload?.parts, "text/plain") ||
    findPart(payload?.parts, "text/html") ||
    "";

  if (!raw) return "";
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    .toString("utf-8")
    .slice(0, 4000); // cap at 4 KB to avoid huge tool results
}

/** Extract named header from Gmail message headers array. */
function header(headers, name) {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

/** Summarise a raw Gmail message into a lean object. */
function summariseMessage(msg) {
  const hdrs = msg.payload?.headers || [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: header(hdrs, "From"),
    to: header(hdrs, "To"),
    subject: header(hdrs, "Subject"),
    date: header(hdrs, "Date"),
    snippet: msg.snippet,
    body: decodeBody(msg.payload),
  };
}

/** base64url-encode a string or Buffer for the Gmail `raw` field. */
function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Wrap a long base64 string at 76 chars per line (RFC 2045). */
function chunk76(b64) {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/**
 * Build an RFC 2822 email and base64url-encode it for the Gmail API.
 *
 * Supports plain-text bodies, In-Reply-To / References headers (for true
 * in-thread replies), and base64 attachments (multipart/mixed). When
 * `attachments` is empty the output is a lean single-part text/plain message,
 * byte-for-byte the same shape send/draft used before this change.
 *
 * @param {object} p
 * @param {string} p.to
 * @param {string} p.subject
 * @param {string} p.body
 * @param {string} [p.cc]
 * @param {string} [p.bcc]
 * @param {string} [p.threadId]    Gmail thread to attach the message to.
 * @param {string} [p.inReplyTo]   original Message-ID header value.
 * @param {string} [p.references]  References header value (space-joined IDs).
 * @param {Array<{filename:string,mimeType:string,contentBase64:string}>} [p.attachments]
 */
function buildRawEmail({
  to,
  subject,
  body,
  cc,
  bcc,
  threadId,
  inReplyTo,
  references,
  attachments,
}) {
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    "MIME-Version: 1.0",
  ].filter((l) => l !== null);

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  let mime;
  if (!hasAttachments) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    mime = `${headers.join("\r\n")}\r\n\r\n${body ?? ""}`;
  } else {
    const boundary = `medha_${randomUUID()}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      body ?? "",
    ];
    for (const att of attachments) {
      const safeName = String(att.filename || "attachment").replace(/"/g, "");
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.mimeType || "application/octet-stream"}; name="${safeName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${safeName}"`,
        "",
        chunk76(att.contentBase64),
      );
    }
    parts.push(`--${boundary}--`);
    mime = `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
  }

  return { raw: base64UrlEncode(mime), ...(threadId ? { threadId } : {}) };
}

/**
 * Derive reply metadata from the original message's headers so a draft/send
 * threads correctly: recipient (Reply-To, else From), a "Re:" subject that is
 * not doubled up, and the In-Reply-To / References chain mail clients use to
 * group the conversation.
 *
 * @param {object} originalMsg   Gmail message with payload.headers populated.
 * @param {object} [opts]
 * @param {string} [opts.toOverride]  Force a specific recipient.
 * @returns {{to:string,subject:string,inReplyTo:string|undefined,references:string|undefined}}
 */
function deriveReplyMeta(originalMsg, { toOverride } = {}) {
  const hdrs = originalMsg?.payload?.headers || [];
  const replyTo = header(hdrs, "Reply-To") || header(hdrs, "From");
  const origSubject = header(hdrs, "Subject") || "";
  const subject = /^re:\s/i.test(origSubject.trim())
    ? origSubject
    : `Re: ${origSubject}`.trim();
  const messageId = header(hdrs, "Message-ID") || header(hdrs, "Message-Id");
  const existingRefs = header(hdrs, "References");
  const references =
    [existingRefs, messageId].filter(Boolean).join(" ").trim() || undefined;

  return {
    to: toOverride || replyTo,
    subject,
    inReplyTo: messageId || undefined,
    references,
  };
}

/**
 * Fetch one attachment into a base64 part. Accepts either inline content
 * (`contentBase64`) or a public `url` (e.g. a Medha image-host link from a
 * generate_* tool). Best-effort: returns null on any failure or oversize so a
 * single bad attachment never blocks the send.
 */
async function fetchAttachment(att) {
  if (!att || typeof att !== "object") return null;

  if (att.contentBase64) {
    return {
      filename: att.filename || "attachment",
      mimeType: att.mimeType || "application/octet-stream",
      contentBase64: att.contentBase64,
    };
  }

  const url = att.url || att.source;
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return null;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_ATTACHMENT_BYTES) return null;
    const mimeType =
      att.mimeType ||
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    const filename =
      att.filename ||
      decodeURIComponent(url.split("/").pop()?.split("?")[0] || "") ||
      "attachment";
    return { filename, mimeType, contentBase64: buf.toString("base64") };
  } catch {
    return null;
  }
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function listInbox(input, ctx) {
  const query = input.query || "in:inbox";
  const maxResults = Math.min(input.maxResults || 20, 50);

  const r = await gmailRequest({
    tenant: ctx.tenant,
    method: "GET",
    path: "/messages",
    query: { q: query, maxResults },
  });

  if (!r.ok) {
    if (r.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: r.error };
  }

  const messages = r.data?.messages || [];
  if (messages.length === 0) return { messages: [] };

  // Fetch full metadata for each message (up to 10 to stay fast)
  const toFetch = messages.slice(0, 10);
  const detailed = await Promise.all(
    toFetch.map((m) =>
      gmailRequest({
        tenant: ctx.tenant,
        method: "GET",
        path: `/messages/${m.id}`,
        query: {
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date", "To"],
        },
      }),
    ),
  );

  return {
    total: r.data.resultSizeEstimate || messages.length,
    messages: detailed
      .filter((d) => d.ok)
      .map((d) => {
        const hdrs = d.data?.payload?.headers || [];
        return {
          id: d.data.id,
          threadId: d.data.threadId,
          from: header(hdrs, "From"),
          subject: header(hdrs, "Subject"),
          date: header(hdrs, "Date"),
          snippet: d.data.snippet,
        };
      }),
  };
}

async function readEmail(input, ctx) {
  const r = await gmailRequest({
    tenant: ctx.tenant,
    method: "GET",
    path: `/messages/${input.messageId}`,
    query: { format: "full" },
  });

  if (!r.ok) {
    if (r.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: r.error };
  }

  return { message: summariseMessage(r.data) };
}

async function searchMessages(input, ctx) {
  const maxResults = Math.min(input.maxResults || 20, 50);

  const r = await gmailRequest({
    tenant: ctx.tenant,
    method: "GET",
    path: "/messages",
    query: { q: input.query, maxResults },
  });

  if (!r.ok) {
    if (r.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: r.error };
  }

  const messages = r.data?.messages || [];
  return {
    total: r.data.resultSizeEstimate || messages.length,
    messages: messages
      .slice(0, maxResults)
      .map((m) => ({ id: m.id, threadId: m.threadId })),
  };
}

async function sendEmail(input, ctx) {
  const payload = buildRawEmail({
    to: input.to,
    subject: input.subject,
    body: input.body,
    cc: input.cc,
    bcc: input.bcc,
  });

  const r = await gmailRequest({
    tenant: ctx.tenant,
    method: "POST",
    path: "/messages/send",
    body: payload,
  });

  if (!r.ok) {
    if (r.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: r.error };
  }

  return {
    sent: true,
    messageId: r.data.id,
    threadId: r.data.threadId,
    labelIds: r.data.labelIds,
  };
}

async function draftEmail(input, ctx) {
  const payload = buildRawEmail({
    to: input.to,
    subject: input.subject,
    body: input.body,
    cc: input.cc,
    bcc: input.bcc,
  });

  const r = await gmailRequest({
    tenant: ctx.tenant,
    method: "POST",
    path: "/drafts",
    body: { message: payload },
  });

  if (!r.ok) {
    if (r.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: r.error };
  }

  return {
    drafted: true,
    draftId: r.data.id,
    messageId: r.data.message?.id,
    threadId: r.data.message?.threadId,
  };
}

async function sendMessage(input, ctx) {
  if (!input.to) return { error: "to is required" };

  let attachments = [];
  if (Array.isArray(input.attachments) && input.attachments.length > 0) {
    const fetched = await Promise.all(
      input.attachments.slice(0, MAX_ATTACHMENTS).map(fetchAttachment),
    );
    attachments = fetched.filter(Boolean);
  }

  const payload = buildRawEmail({
    to: input.to,
    subject: input.subject || "(no subject)",
    body: input.body,
    cc: input.cc,
    bcc: input.bcc,
    attachments,
  });

  const r = await gmailRequest({
    tenant: ctx.tenant,
    method: "POST",
    path: "/messages/send",
    body: payload,
  });

  if (!r.ok) {
    if (r.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: r.error };
  }

  return {
    sent: true,
    messageId: r.data.id,
    threadId: r.data.threadId,
    labelIds: r.data.labelIds,
    attachmentsRequested: Array.isArray(input.attachments)
      ? input.attachments.length
      : 0,
    attachmentsIncluded: attachments.length,
  };
}

async function draftReply(input, ctx) {
  const threadId = input.thread_id || input.threadId;
  if (!threadId) return { error: "thread_id is required" };
  if (!input.body) return { error: "body is required" };

  // Pull the thread's last message to thread the reply correctly.
  const tr = await gmailRequest({
    tenant: ctx.tenant,
    method: "GET",
    path: `/threads/${threadId}`,
    query: {
      format: "metadata",
      metadataHeaders: [
        "From",
        "Reply-To",
        "Subject",
        "Message-ID",
        "References",
        "To",
      ],
    },
  });

  if (!tr.ok) {
    if (tr.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: tr.error };
  }

  const messages = tr.data?.messages || [];
  if (messages.length === 0) {
    return { error: "thread-empty-or-not-found", threadId };
  }

  const last = messages[messages.length - 1];
  const meta = deriveReplyMeta(last, { toOverride: input.to });
  if (!meta.to) {
    return { error: "could-not-resolve-reply-recipient", threadId };
  }

  const payload = buildRawEmail({
    to: meta.to,
    subject: meta.subject,
    body: input.body,
    cc: input.cc,
    threadId,
    inReplyTo: meta.inReplyTo,
    references: meta.references,
  });

  const r = await gmailRequest({
    tenant: ctx.tenant,
    method: "POST",
    path: "/drafts",
    body: { message: payload },
  });

  if (!r.ok) {
    if (r.error === "gmail-not-connected") {
      return { error: "Gmail not connected", hint: "connect-first" };
    }
    return { error: r.error };
  }

  return {
    drafted: true,
    draftId: r.data.id,
    messageId: r.data.message?.id,
    threadId: r.data.message?.threadId || threadId,
    to: meta.to,
    subject: meta.subject,
  };
}

// ── Tool definitions (Claude format) ─────────────────────────────────────────

export const GMAIL_TOOLS = [
  {
    name: "gmail_list_inbox",
    description:
      "List messages in the Gmail inbox. Optionally filter with a Gmail search query (e.g. 'from:boss@company.com is:unread').",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query. Defaults to 'in:inbox'. Examples: 'is:unread', 'from:alice@example.com', 'subject:invoice'.",
        },
        maxResults: {
          type: "integer",
          description: "Max messages to return (1-50, default 20).",
        },
      },
    },
  },
  {
    name: "gmail_send_email",
    description: "Send an email via Gmail on behalf of the user.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address(es), comma-separated.",
        },
        subject: { type: "string", description: "Email subject." },
        body: {
          type: "string",
          description: "Plain-text email body.",
        },
        cc: {
          type: "string",
          description: "CC addresses (optional, comma-separated).",
        },
        bcc: {
          type: "string",
          description: "BCC addresses (optional, comma-separated).",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_read_email",
    description:
      "Fetch the full content of a specific Gmail message by its ID.",
    input_schema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "Gmail message ID (from list_inbox or search results).",
        },
      },
      required: ["messageId"],
    },
  },
  {
    name: "gmail_search",
    description:
      "Search Gmail messages using Gmail's query syntax (from:, to:, subject:, after:, before:, has:attachment, etc.).",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query. Examples: 'from:alice subject:invoice after:2024/01/01'.",
        },
        maxResults: {
          type: "integer",
          description: "Max results to return (1-50, default 20).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_draft_email",
    description:
      "Create a draft email in Gmail without sending it. Useful for preparing emails for user review.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address(es), comma-separated.",
        },
        subject: { type: "string", description: "Email subject." },
        body: {
          type: "string",
          description: "Plain-text email body.",
        },
        cc: {
          type: "string",
          description: "CC addresses (optional, comma-separated).",
        },
        bcc: {
          type: "string",
          description: "BCC addresses (optional, comma-separated).",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_send_message",
    description:
      "Send an email via Gmail, optionally with file attachments. Use this (not gmail_send_email) when the message needs attachments such as a generated PDF, image, or spreadsheet. Pass each attachment's public URL (e.g. a generate_pdf / generate_image result) and a filename.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address(es), comma-separated.",
        },
        subject: { type: "string", description: "Email subject." },
        body: { type: "string", description: "Plain-text email body." },
        cc: {
          type: "string",
          description: "CC addresses (optional, comma-separated).",
        },
        bcc: {
          type: "string",
          description: "BCC addresses (optional, comma-separated).",
        },
        attachments: {
          type: "array",
          description:
            "Optional file attachments. Each item is a public URL to fetch plus a filename. Up to 10, 10 MB each.",
          items: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description:
                  "Public https URL of the file to attach (e.g. a generated PDF/image link).",
              },
              filename: {
                type: "string",
                description:
                  "Name the attachment should have in the email, e.g. 'newsletter.pdf'.",
              },
              mimeType: {
                type: "string",
                description:
                  "Optional MIME type override (auto-detected from the URL response when omitted).",
              },
            },
            required: ["url", "filename"],
          },
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_draft_reply",
    description:
      "Draft an in-thread reply to an existing Gmail conversation. Resolves the recipient, 'Re:' subject, and threading headers from the thread's latest message automatically. Creates a draft (does not send) so the reply is ready for review. Use when the user says 'reply to that email' or 'draft a response to the thread from X'.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description:
            "Gmail thread ID to reply within (the threadId from a list/search/read result).",
        },
        body: {
          type: "string",
          description:
            "Plain-text reply body, written in the requested tone/voice.",
        },
        tone: {
          type: "string",
          description:
            "Optional tone guidance for the reply (e.g. 'warm', 'concise', 'formal'). Informational: shape the body text to match.",
        },
        to: {
          type: "string",
          description:
            "Optional recipient override. Defaults to the thread's Reply-To/From sender.",
        },
        cc: {
          type: "string",
          description: "Optional CC addresses, comma-separated.",
        },
      },
      required: ["thread_id", "body"],
    },
  },
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Execute a Gmail tool call from Claude's tool_use block.
 *
 * @param {string} toolName
 * @param {object} input     - Claude's tool input
 * @param {object} ctx       - { tenant }
 * @returns {Promise<object>}
 */
export async function executeGmailTool(toolName, input, ctx) {
  console.log(`[gmail] ${toolName}`);
  try {
    switch (toolName) {
      case "gmail_list_inbox":
        return await listInbox(input, ctx);
      case "gmail_send_email":
        return await sendEmail(input, ctx);
      case "gmail_send_message":
        return await sendMessage(input, ctx);
      case "gmail_draft_reply":
        return await draftReply(input, ctx);
      case "gmail_read_email":
        return await readEmail(input, ctx);
      case "gmail_search":
        return await searchMessages(input, ctx);
      case "gmail_draft_email":
        return await draftEmail(input, ctx);
      default:
        return { error: `Unknown Gmail tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[gmail] ${toolName} failed:`, err?.message);
    return { error: err?.message || "gmail-tool-error" };
  }
}

// Pure helpers exported for unit tests (no network, deterministic shape).
export { buildRawEmail, deriveReplyMeta, base64UrlEncode };
