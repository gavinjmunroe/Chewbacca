/**
 * @togari/core — Transport-agnostic email operations
 *
 * Wraps Gmail API for sending emails and creating drafts.
 * Also includes Claude-powered email drafting from smartlead-responder/classifier.ts.
 */

import { google } from "googleapis";
import { createLogger } from "../../observability/logger";
import { SONNET } from "../../config/models";
import { buildDateContext } from "../identity/date-context";

const logger = createLogger("core/email-ops");

/**
 * Patch I — Kevin → Sagar sender migration.
 *
 * IMPORTANT prerequisite (BEFORE this lands in prod): the GCP service
 * account used by GCP_CREDENTIALS_BASE64 must have domain-wide delegation
 * enabled for `sagar@bluemodernadvisory.com` in Google Admin Console —
 * same configuration that was previously set up for `kevin@`. Without it,
 * Gmail send / drafts.create fail with HTTP 403 / "insufficient permissions".
 */
const SAGAR_EMAIL = "sagar@bluemodernadvisory.com";

function getGmailClient(senderEmail: string = SAGAR_EMAIL) {
  const credentialsBase64 =
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!credentialsBase64) throw new Error("GCP_CREDENTIALS_BASE64 not set");

  const credentials = JSON.parse(
    Buffer.from(credentialsBase64, "base64").toString("utf-8"),
  );

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    // Domain-wide delegation — see SAGAR_EMAIL note above. Any other sender
    // (e.g. maggie@) must be covered by the same delegation config in Google
    // Admin Console or Gmail calls fail with 403.
    subject: senderEmail,
  });

  return google.gmail({ version: "v1", auth });
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: string | Buffer;
}

/** Header values must never carry a line break (header injection). */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2045 base64: wrapped at 76 characters per line. */
function wrapBase64(content: string | Buffer): string {
  const b64 = Buffer.from(content).toString("base64");
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

export function buildRawEmail(params: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  inReplyTo?: string;
  cc?: string;
  bcc?: string;
  /** Optional HTML alternative; when set, the body becomes multipart/alternative. */
  html?: string;
  /** Files to attach; when set, the message becomes multipart/mixed. */
  attachments?: EmailAttachment[];
}): string {
  const from = params.from || `Sagar Tiwari <${SAGAR_EMAIL}>`;
  const headers = [
    `From: ${from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
  ];

  if (params.cc) {
    headers.push(`Cc: ${headerSafe(params.cc)}`);
  }
  if (params.bcc) {
    headers.push(`Bcc: ${params.bcc}`);
  }
  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo}`);
    headers.push(`References: ${params.inReplyTo}`);
  }

  // The readable part: plain text, or text + HTML alternatives.
  let bodyType: string;
  let bodyContent: string;
  if (params.html) {
    const boundary = `togari-${Date.now().toString(36)}`;
    bodyType = `multipart/alternative; boundary="${boundary}"`;
    bodyContent =
      `--${boundary}\r\n` +
      "Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
      params.body +
      `\r\n--${boundary}\r\n` +
      "Content-Type: text/html; charset=UTF-8\r\n\r\n" +
      params.html +
      `\r\n--${boundary}--`;
  } else {
    bodyType = "text/plain; charset=UTF-8";
    bodyContent = params.body;
  }

  let raw: string;
  if (params.attachments && params.attachments.length > 0) {
    const mixed = `togari-mixed-${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
    const parts = [
      `--${mixed}\r\nContent-Type: ${bodyType}\r\n\r\n${bodyContent}`,
      ...params.attachments.map((a) => {
        const name = headerSafe(a.filename).replace(/"/g, "");
        return (
          `--${mixed}\r\n` +
          `Content-Type: ${headerSafe(a.contentType)}; name="${name}"\r\n` +
          `Content-Disposition: attachment; filename="${name}"\r\n` +
          "Content-Transfer-Encoding: base64\r\n\r\n" +
          wrapBase64(a.content)
        );
      }),
    ];
    raw = headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${mixed}--`;
  } else {
    headers.push(`Content-Type: ${bodyType}`);
    raw = headers.join("\r\n") + "\r\n\r\n" + bodyContent;
  }
  return Buffer.from(raw).toString("base64url");
}

// ── Send Email ───────────────────────────────────────────────────

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  inReplyTo?: string;
  cc?: string;
  bcc?: string;
  /** Optional HTML alternative body (multipart/alternative). */
  html?: string;
  /** Files to attach (multipart/mixed). */
  attachments?: EmailAttachment[];
  /** Delegated Gmail account to send as (must have domain-wide delegation). */
  senderEmail?: string;
  /** Set true only for system mail that must bypass the DNC suppression gate. */
  bypassDnc?: boolean;
}): Promise<{
  messageId: string;
  success: boolean;
  blocked?: boolean;
  dncReason?: string;
}> {
  // Compliance gate: never send to a suppressed address. This is the single
  // chokepoint every send path funnels through (MCP send_email, REST
  // /api/v1/emails/send, Slack), so the DNC list is enforced everywhere.
  if (!params.bypassDnc) {
    try {
      const { checkDncByEmail } = await import("../../dnc");
      const { getCurrentTenant } = await import("../../tenant/context");
      let tenantId = "bma";
      try {
        tenantId = getCurrentTenant().tenantId;
      } catch {
        /* no tenant context (e.g. cron) — fall back to default org */
      }
      const decision = await checkDncByEmail(
        { email: params.to },
        { tenantId },
      );
      if (decision.suppressed) {
        logger.warn("Email send BLOCKED by do-not-contact list", {
          to: params.to,
          reason: decision.reason,
        });
        return {
          messageId: "",
          success: false,
          blocked: true,
          dncReason: decision.reason ?? "on do-not-contact list",
        };
      }
    } catch (err) {
      // Fail-open on infrastructure error so a transient BigQuery hiccup does
      // not block all outbound mail, but log loudly.
      logger.warn("DNC pre-send check failed (allowing send)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const gmail = getGmailClient(params.senderEmail);
    const raw = buildRawEmail(params);

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    const messageId = result.data.id || "";
    logger.info("Email sent", {
      to: params.to,
      subject: params.subject,
      messageId,
    });

    return { messageId, success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[core/email-ops] Send failed:", errMsg);
    logger.error(
      "Email send failed",
      err instanceof Error ? err : new Error(errMsg),
      {
        to: params.to,
        subject: params.subject,
      },
    );
    return { messageId: "", success: false };
  }
}

// ── Create Draft ─────────────────────────────────────────────────

export async function createDraft(params: {
  to: string;
  subject: string;
  body: string;
  from?: string;
}): Promise<{ draftId: string; success: boolean }> {
  try {
    const gmail = getGmailClient();
    const raw = buildRawEmail(params);

    const result = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw },
      },
    });

    const draftId = result.data.id || "";
    logger.info("Draft created", {
      to: params.to,
      subject: params.subject,
      draftId,
    });

    return { draftId, success: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[core/email-ops] Draft creation failed:", errMsg);
    logger.error(
      "Draft creation failed",
      err instanceof Error ? err : new Error(errMsg),
      {
        to: params.to,
        subject: params.subject,
      },
    );
    return { draftId: "", success: false };
  }
}

// ── Draft Reply (Claude-powered) ─────────────────────────────────

const DRAFT_SYSTEM_PROMPT = `You are drafting an email response for Sagar Tiwari at Blue Modern Advisory (sagar@bluemodernadvisory.com). Draft a professional, warm email reply.

## Rules:
- Be warm and professional. 3-5 sentences for simple replies, up to 8 for meeting requests.
- For meeting requests suggest 2-3 time slots this week.
- For information requests provide a concise helpful answer.
- For referrals thank them and ask for the introduction.
- NEVER use these phrases: 'I hope this email finds you well', 'synergy', 'leverage', 'We work with companies like yours', 'I wanted to reach out'.

## Sign-off:
Always end with this exact sign-off (on separate lines):

Sagar,
Co-founder
Blue Modern Advisory

Return ONLY valid JSON: { "draft_subject": string, "draft_body": string, "urgency": "high" | "medium" | "low" }
If the reply is ambiguous or you're unsure how to respond, return { "action": "manual_review", "reason": "explain why" } instead.`;

export async function draftReply(params: {
  leadEmail: string;
  leadName: string;
  replyText: string;
  originalOutreach?: string;
  category?: string;
  /** Requester IANA timezone. TODO: thread through from the caller; defaults to Chicago today. */
  timezone?: string;
}): Promise<{ subject: string; body: string; urgency: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const timezone = params.timezone ?? "America/Chicago";
  const today = new Date().toISOString().split("T")[0];

  const userPrompt = `Today is ${today}. Draft a reply to this email.

Lead info:
- Name: ${params.leadName || "Unknown"}
- Email: ${params.leadEmail}
${params.category ? `- Category: ${params.category}` : ""}

${params.originalOutreach ? `Original outreach context: ${params.originalOutreach}` : ""}

Their reply:
${params.replyText || "(empty)"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 1024,
        system: `${buildDateContext(timezone)}\n\n${DRAFT_SYSTEM_PROMPT}`,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as any;
    const rawText = data.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");

    const cleaned = rawText
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.action === "manual_review") {
      return {
        subject: "",
        body: `Manual review needed: ${parsed.reason || "Ambiguous reply"}`,
        urgency: "medium",
      };
    }

    logger.info("Email draft generated", {
      leadEmail: params.leadEmail,
      urgency: parsed.urgency,
    });

    return {
      subject: parsed.draft_subject || `Re: ${params.leadName}`,
      body: parsed.draft_body || "",
      urgency: parsed.urgency || "medium",
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[core/email-ops] Draft reply failed:", errMsg);
    logger.error(
      "Draft reply failed",
      err instanceof Error ? err : new Error(errMsg),
      {
        leadEmail: params.leadEmail,
      },
    );
    return {
      subject: "",
      body: `Failed to generate draft: ${errMsg}`,
      urgency: "medium",
    };
  }
}
