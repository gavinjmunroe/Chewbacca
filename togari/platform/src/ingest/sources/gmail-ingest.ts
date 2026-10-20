/**
 * On-demand Gmail ingestion source.
 *
 * Pulls recent emails from a BMA mailbox and pushes each one through the
 * EXISTING universal ingestion pipeline (UniversalIngestService), so every
 * email is raw-preserved in raw_ingestions, AI-extracted into structured
 * entities, and routed into the CRM / pipeline tables. This file does NOT
 * reimplement Gmail auth: it reuses `getRecentEmails` from the email-engine
 * Gmail client, which authenticates via GCP domain-wide delegation
 * (GCP_CREDENTIALS_BASE64) and returns already-parsed plain-text bodies.
 *
 * Credentials are checked up front. When they are missing the function
 * returns a clean, non-throwing "not configured" result so an operator can
 * call the tool safely without a stack trace.
 *
 * Env:
 *   GCP_CREDENTIALS_BASE64  domain-wide-delegation service-account JSON (base64).
 *   GMAIL_INGEST_USER       mailbox to read via delegation (default
 *                           sagar@bluemodernadvisory.com).
 *   GMAIL_OAUTH_REFRESH_TOKEN  alternative OAuth path (presence also unlocks
 *                              the tool; delegation is preferred when both set).
 */

import { BigQueryClient } from "../../bigquery/client";
import { createLogger } from "../../observability/logger";
import { UniversalIngestService } from "../universal/service";
import {
  getRecentEmails,
  type ParsedEmail,
} from "../../email-engine/gmail-client";

const logger = createLogger("ingest/sources/gmail");

const DEFAULT_INGEST_USER = "sagar@bluemodernadvisory.com";
const DEFAULT_MAX_MESSAGES = 10;
const DEFAULT_HOURS_BACK = 168; // one week window for on-demand pulls

export interface GmailIngestParams {
  bq: BigQueryClient;
  clientId: string;
  maxMessages?: number;
  query?: string;
}

export interface GmailIngestItemResult {
  messageId: string;
  extracted: number;
  routed: number;
}

export interface GmailIngestResult {
  configured: boolean;
  fetched: number;
  ingested: number;
  results: GmailIngestItemResult[];
  note?: string;
}

/** True when some usable Gmail credential is present. */
function gmailConfigured(): boolean {
  return Boolean(
    process.env.GCP_CREDENTIALS_BASE64 ||
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ||
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

/** Compose a single plain-text blob (sender, subject, body) for extraction. */
function emailToText(email: ParsedEmail): string {
  const lines = [
    `From: ${email.fromName ? `${email.fromName} <${email.from}>` : email.from}`,
    email.to ? `To: ${email.to}` : "",
    `Subject: ${email.subject || "(no subject)"}`,
    email.date ? `Date: ${email.date}` : "",
    "",
    email.body || "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Fetch up to `maxMessages` recent emails and ingest each through the
 * universal pipeline. Per-message failures are caught so one bad email never
 * fails the batch. Never throws for the missing-credentials case.
 */
export async function ingestGmail(
  params: GmailIngestParams,
): Promise<GmailIngestResult> {
  const { bq, clientId } = params;
  const maxMessages = params.maxMessages ?? DEFAULT_MAX_MESSAGES;

  if (!gmailConfigured()) {
    return {
      configured: false,
      fetched: 0,
      ingested: 0,
      results: [],
      note: "Gmail not configured: set GCP_CREDENTIALS_BASE64 (domain-wide delegation) or GMAIL_OAUTH_REFRESH_TOKEN",
    };
  }

  const mailbox = process.env.GMAIL_INGEST_USER || DEFAULT_INGEST_USER;

  let emails: ParsedEmail[];
  try {
    // getRecentEmails handles auth (delegation), listing, and MIME body
    // extraction. It returns the most recent unread inbox emails; we cap the
    // slice to maxMessages here. The `query` arg is accepted for the tool
    // surface but the reused helper builds its own time-bounded query.
    void params.query;
    emails = await getRecentEmails(mailbox, DEFAULT_HOURS_BACK);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "gmail fetch failed",
      err instanceof Error ? err : new Error(message),
      { mailbox },
    );
    return {
      configured: true,
      fetched: 0,
      ingested: 0,
      results: [],
      note: `Gmail fetch failed: ${message}`,
    };
  }

  const slice = emails.slice(0, maxMessages);
  const results: GmailIngestItemResult[] = [];
  const svc = new UniversalIngestService({ bq });

  for (const email of slice) {
    try {
      const outcome = await svc.ingest({
        clientId,
        source: `gmail:${email.messageId}`,
        contentType: "text",
        rawText: emailToText(email),
        fileName: email.subject || undefined,
      });
      const routed =
        outcome.routed.contacts +
        outcome.routed.companies +
        outcome.routed.activities;
      results.push({
        messageId: email.messageId,
        extracted: outcome.extracted,
        routed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "gmail per-message ingest failed",
        err instanceof Error ? err : new Error(message),
        { messageId: email.messageId },
      );
    }
  }

  logger.info("gmail ingest complete", {
    mailbox,
    fetched: slice.length,
    ingested: results.length,
  });

  return {
    configured: true,
    fetched: slice.length,
    ingested: results.length,
    results,
  };
}
