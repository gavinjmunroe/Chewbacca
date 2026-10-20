/**
 * Read-only Gmail retrieval source.
 *
 * Fetches recent messages from a BMA mailbox via GCP domain-wide delegation
 * and RETURNS them. This module is strictly read-only: it never writes to
 * BigQuery, the CRM, or the mailbox itself. There is no BigQuery import
 * anywhere in this file by design, so a bulk 90-day retrieval for a report
 * cannot flood the production CRM.
 *
 * Auth reuses the exact domain-wide-delegation pattern from the email-engine
 * Gmail client (src/email-engine/gmail-client.ts) and calendar-fetch
 * (src/sources/calendar-fetch.ts): a `google.auth.JWT` built from the
 * service-account credentials in GCP_CREDENTIALS_BASE64 (or
 * GOOGLE_CREDENTIALS_BASE64), with `subject` set to the impersonated mailbox.
 * The DWD grant is domain-wide, so the service account can impersonate any
 * bluemodernadvisory.com user. The only scope requested is gmail.readonly.
 *
 * When credentials are missing, or the DWD grant does not include the
 * gmail.readonly scope for that user (a 403 from the API), the function
 * returns a clean non-throwing "not configured / not authorized" result so an
 * operator can call it safely without a stack trace.
 *
 * Env:
 *   GCP_CREDENTIALS_BASE64      domain-wide-delegation service-account JSON (base64).
 *   GOOGLE_CREDENTIALS_BASE64   alternate name for the same creds.
 *   GMAIL_INGEST_USER           mailbox to read (default sagar@bluemodernadvisory.com).
 */

import { google, gmail_v1 } from "googleapis";
import { createLogger } from "../observability/logger";

const logger = createLogger("sources/gmail-fetch");

const DEFAULT_USER = "sagar@bluemodernadvisory.com";
const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_MAX_MESSAGES = 25;
const MAX_MESSAGES_CAP = 200;

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface FetchGmailMessagesResult {
  configured: boolean;
  user: string;
  fetched: number;
  messages: GmailMessage[];
  note?: string;
}

/** Raw domain-wide-delegation credentials, or null when not configured. */
function getCredentials(): Record<string, unknown> | null {
  const b64 =
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return null;
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
}

/**
 * Build a read-only Gmail client for `userEmail` via domain-wide delegation.
 * Mirrors buildClient in email-engine/gmail-client.ts, but requests only the
 * gmail.readonly scope.
 */
function buildClient(
  creds: Record<string, unknown>,
  userEmail: string,
): gmail_v1.Gmail {
  const auth = new google.auth.JWT({
    email: creds.client_email as string,
    key: creds.private_key as string,
    scopes: [GMAIL_READONLY_SCOPE],
    subject: userEmail,
  });
  return google.gmail({ version: "v1", auth });
}

/** True when a Google API error looks like a permission / 403 problem. */
function isPermissionError(err: unknown): boolean {
  const anyErr = err as {
    code?: number | string;
    status?: number;
    message?: string;
  };
  const code = Number(anyErr?.code ?? anyErr?.status);
  if (code === 403 || code === 401) return true;
  const message = (anyErr?.message ?? "").toLowerCase();
  return (
    message.includes("permission") ||
    message.includes("unauthorized") ||
    message.includes("insufficient") ||
    (message.includes("access") && message.includes("denied"))
  );
}

/** Read one header value (case-insensitive) from a message part. */
function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  if (!headers) return "";
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/**
 * Fetch up to `max` messages from the impersonated mailbox within the last
 * `sinceDays` days, optionally narrowed by a Gmail search `query`. For each
 * message only metadata (from/to/subject/date + snippet) is retrieved.
 *
 * READ ONLY. Never throws: missing creds and 403/permission errors both
 * resolve to a clean `configured: false` result with an explanatory note.
 */
export async function fetchGmailMessages(params: {
  user?: string;
  sinceDays?: number;
  max?: number;
  query?: string;
}): Promise<FetchGmailMessagesResult> {
  const user = params.user || process.env.GMAIL_INGEST_USER || DEFAULT_USER;
  const sinceDays = params.sinceDays ?? DEFAULT_SINCE_DAYS;
  const max = Math.min(params.max ?? DEFAULT_MAX_MESSAGES, MAX_MESSAGES_CAP);

  const creds = getCredentials();
  if (!creds) {
    return {
      configured: false,
      user,
      fetched: 0,
      messages: [],
      note: "Gmail not configured: set GCP_CREDENTIALS_BASE64",
    };
  }

  const afterEpoch = Math.floor(
    (Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000,
  );
  const q = [`after:${afterEpoch}`, params.query?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  try {
    const gmail = buildClient(creds, user);

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: max,
    });

    const ids = listRes.data.messages ?? [];
    const messages: GmailMessage[] = [];

    for (const ref of ids) {
      if (!ref.id) continue;
      if (messages.length >= max) break;
      try {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: ref.id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });
        const headers = full.data.payload?.headers;
        messages.push({
          id: String(full.data.id ?? ref.id),
          from: getHeader(headers, "From"),
          to: getHeader(headers, "To"),
          subject: getHeader(headers, "Subject"),
          date: getHeader(headers, "Date"),
          snippet: String(full.data.snippet ?? ""),
        });
      } catch (err) {
        // A single unreadable message must not fail the batch.
        logger.warn("gmail message fetch failed", {
          user,
          messageId: ref.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("gmail fetch complete", {
      user,
      sinceDays,
      fetched: messages.length,
    });

    return {
      configured: true,
      user,
      fetched: messages.length,
      messages,
    };
  } catch (err) {
    if (isPermissionError(err)) {
      logger.warn("gmail read not authorized", {
        user,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        configured: false,
        user,
        fetched: 0,
        messages: [],
        note: `Gmail read not authorized for ${user} - the service account DWD grant needs the gmail.readonly scope (and the user must be in the workspace)`,
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "gmail fetch failed",
      err instanceof Error ? err : new Error(message),
      { user },
    );
    return {
      configured: true,
      user,
      fetched: 0,
      messages: [],
      note: `Gmail fetch failed: ${message}`,
    };
  }
}
