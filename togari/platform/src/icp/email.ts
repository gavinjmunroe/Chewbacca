/**
 * The one automated email this funnel sends to a requester: the list, when
 * Clay calls back with people. Up to 10 matching the brief, each with a
 * verified work email (partly hidden in this free sample) and their
 * LinkedIn profile, plus the same list as a CSV. When there's no list (no
 * matches, an error, a timeout) nothing automated goes out; Slack asks us to
 * reach out personally.
 *
 * House style: no em dashes in these emails. Signed by Blue Modern
 * Advisory, not a person.
 *
 * Send controls:
 *   ICP_AUTOSEND_ENABLED    kill switch; off → compose, log, don't send
 *   ICP_EMAIL_SENDER        delegated Gmail sender (default maggie@; needs
 *                           domain-wide delegation in Google Admin)
 *   ICP_EMAIL_SENDER_NAME
 *   ICP_LIST_BCC            copy of every list email (default
 *                           maggie@; set to an empty string to turn off)
 */

import { sendEmail, type EmailAttachment } from "../core/tools/email-ops";
import { createLogger } from "../observability/logger";
import { buildListCsv, maskEmail, type ListContact } from "./list";

const logger = createLogger("icp/email");

const DEFAULT_SENDER = "maggie@bluemodernadvisory.com";
const DEFAULT_LIST_BCC = "maggie@bluemodernadvisory.com";

const REPLY_TO = "maggie@bluemodernadvisory.com";
const SITE_URL = "https://www.bluemodernadvisory.com";
/** Served by the website; email clients load it remotely (alt text shows if
 *  images are blocked). */
const LOGO_URL = `${SITE_URL}/bmaicon.png`;

export interface ComposedEmail {
  subject: string;
  textBody: string;
  htmlBody: string;
}

/** What the requester told us, played back so they know it landed intact. */
export interface ThankYouContext {
  job_id: string;
  full_name: string | null;
  email: string;
  industry: string | null;
  icp_description: string;
  company_size?: string | null;
  target_titles?: string[];
}

export type SendOutcome = {
  sent: boolean;
  messageId: string | null;
  reason?: "autosend_disabled" | "send_failed";
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(ctx: ThankYouContext): string {
  return (ctx.full_name ?? "").trim().split(/\s+/)[0] || "there";
}

function briefLines(ctx: ThankYouContext): string[] {
  const lines = [`Who you're after: ${ctx.icp_description}`];
  if (ctx.company_size) lines.push(`Company size: ${ctx.company_size}`);
  if (ctx.target_titles && ctx.target_titles.length > 0) {
    lines.push(`Roles: ${ctx.target_titles.join(", ")}`);
  }
  return lines;
}

const SIGNATURE_TEXT = `Blue Modern Advisory (${SITE_URL.replace("https://", "")})`;

/* ---------------------------------------------------------------------------
 * Branded card layout. Email clients ignore <style> blocks and most modern
 * CSS, so this is table layout with inline styles only, 600px wide, system
 * fonts, and no images (they're blocked by default in many inboxes).
 * Colors match bluemodernadvisory.com.
 * ------------------------------------------------------------------------- */

const C = {
  ink: "#0d1b2a",
  muted: "#55626f",
  faint: "#8a949e",
  blue: "#1f4e73",
  mist: "#9ab3c4",
  pale: "#eef3f6",
  bg: "#f6f5f1",
  rule: "#e3e1da",
};
const FONT = `'Helvetica Neue',Helvetica,Arial,sans-serif`;

function para(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.ink}">${escapeHtml(text)}</p>`;
}

function briefPanel(ctx: ThankYouContext, heading: string): string {
  const rows = briefLines(ctx)
    .map((l) => {
      const i = l.indexOf(": ");
      const label = i > 0 ? l.slice(0, i) : "";
      const value = i > 0 ? l.slice(i + 2) : l;
      return `<tr>
<td valign="top" style="padding:4px 12px 4px 0;font-size:13px;color:${C.muted};white-space:nowrap">${escapeHtml(label)}</td>
<td valign="top" style="padding:4px 0;font-size:13px;color:${C.ink}">${escapeHtml(value)}</td>
</tr>`;
    })
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pale};border-radius:8px;margin:8px 0 24px">
<tr><td style="padding:16px 18px">
<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${C.blue};font-weight:bold;margin-bottom:8px">${escapeHtml(heading)}</div>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
</td></tr></table>`;
}

function replyButton(label: string, subject: string): string {
  const href = `mailto:${REPLY_TO}?subject=${encodeURIComponent(subject)}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px">
<tr><td style="background:${C.blue};border-radius:6px">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;font-family:${FONT}">${escapeHtml(label)}</a>
</td></tr></table>`;
}

function card(opts: { preheader: string; title: string; subtitle?: string; body: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${C.rule};border-radius:10px;overflow:hidden;font-family:${FONT}">
<tr><td style="background:${C.ink};padding:18px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:13px;letter-spacing:2.5px;font-weight:bold;color:#ffffff;font-family:${FONT}">BLUE MODERN ADVISORY</td>
<td align="right" style="line-height:0"><a href="${SITE_URL}"><img src="${LOGO_URL}" width="36" height="36" alt="BMA" style="display:block;border:0;width:36px;height:36px"></a></td>
</tr></table>
</td></tr>
<tr><td style="padding:32px 28px 8px">
<h1 style="margin:0 0 6px;font-size:24px;line-height:1.25;color:${C.ink};font-family:${FONT}">${escapeHtml(opts.title)}</h1>
${opts.subtitle ? `<div style="font-size:14px;color:${C.muted};margin-bottom:24px">${escapeHtml(opts.subtitle)}</div>` : `<div style="height:18px"></div>`}
${opts.body}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px"><tr>
<td valign="middle" style="padding-right:8px;line-height:0"><a href="${SITE_URL}"><img src="${LOGO_URL}" width="22" height="22" alt="BMA" style="display:block;border:0;width:22px;height:22px"></a></td>
<td valign="middle" style="font-size:14px;font-family:${FONT}"><a href="${SITE_URL}" style="color:${C.blue};text-decoration:none">Blue Modern Advisory</a></td>
</tr></table>
</td></tr>
<tr><td style="border-top:1px solid ${C.rule};padding:16px 28px;font-size:12px;line-height:1.5;color:${C.faint}">
You're receiving this because you requested a free ICP list at bluemodernadvisory.com. Reply to this email with any questions.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function textEmail(parts: string[]): string {
  return [...parts, SIGNATURE_TEXT].join("\n\n");
}

function contactLine(c: ListContact): string {
  const role = [c.title, c.company].filter(Boolean).join(", ");
  return role ? `${c.name}, ${role}` : c.name;
}

/** "Madison, Wisconsin, United States" reads fine as "Madison, Wisconsin". */
function shortLocation(location: string): string {
  return location.replace(/,\s*(United States|USA|US)$/i, "").trim();
}

/** Only link to real LinkedIn URLs; anything else from enrichment is dropped. */
function linkedinHref(url: string): string | null {
  const u = url.trim();
  if (!/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(u)) return null;
  return u;
}

function peopleTable(contacts: ListContact[]): string {
  const th = (label: string) =>
    `<th align="left" style="padding:0 10px 8px 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.faint};font-weight:bold;border-bottom:1px solid ${C.rule}">${label}</th>`;
  const td = (inner: string, last = false) =>
    `<td valign="top" style="padding:10px ${last ? 0 : 10}px 10px 0;border-bottom:1px solid ${C.rule};font-size:13px;color:${C.ink}">${inner}</td>`;
  const sub = (text: string) =>
    text ? `<div style="font-size:12px;color:${C.muted}">${escapeHtml(text)}</div>` : "";
  const rows = contacts
    .map((c) => {
      const li = linkedinHref(c.linkedin);
      return `<tr>
${td(`<div style="font-size:14px;font-weight:bold">${escapeHtml(c.name)}</div>${sub(c.title)}`)}
${td(`${escapeHtml(c.company)}${sub(shortLocation(c.location))}`)}
${td(`<span style="color:${C.muted}">${escapeHtml(maskEmail(c.email))}</span>`)}
${td(li ? `<a href="${escapeHtml(li)}" style="color:${C.blue};text-decoration:none">View profile</a>` : `<span style="color:${C.faint}">Not found</span>`, true)}
</tr>`;
    })
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
<tr>${th("Person")}${th("Company")}${th("Work email")}${th("LinkedIn")}</tr>
${rows}
</table>`;
}

export function composeListEmail(
  ctx: ThankYouContext,
  contacts: ListContact[],
): ComposedEmail & { attachment: EmailAttachment } {
  const n = contacts.length;
  const people = `${n} ${n === 1 ? "person" : "people"}`;
  const companyCount = new Set(contacts.map((c) => c.company.toLowerCase()).filter(Boolean)).size;
  const companies = `${companyCount} ${companyCount === 1 ? "company" : "companies"}`;
  const brief = briefLines(ctx);
  const preview = contacts.map(contactLine);

  const greeting = `Hi ${firstName(ctx)},`;
  const intro = `Here's your ICP list: ${people} who match your brief. We found and verified a work email for each one; in this free sample the addresses are partly hidden. The same list, with LinkedIn profiles, is in the attached CSV.`;
  const pitch = `This is a sample of what we build. The full version covers every matching account and the whole buying committee inside each one, refreshed and synced to your CRM. If you'd like that for your market, just reply to this email.`;

  const textBody = textEmail([
    greeting,
    intro,
    preview.map((l) => `  • ${l}`).join("\n"),
    `Built from your brief:`,
    brief.map((l) => `  • ${l}`).join("\n"),
    pitch,
  ]);

  const htmlBody = card({
    preheader: `${people} at ${companies} who match your brief. CSV attached.`,
    title: "Your ICP list is ready",
    subtitle: `${people} · ${companies} · CSV attached`,
    body: [
      para(greeting),
      para(intro),
      peopleTable(contacts),
      briefPanel(ctx, "Built from your brief"),
      para(pitch),
      replyButton("Reply to get the full list", "Full ICP list"),
    ].join("\n"),
  });

  return {
    subject: "Your BMA ICP List is Ready",
    textBody,
    htmlBody,
    attachment: {
      filename: "icp-list.csv",
      contentType: "text/csv; charset=UTF-8",
      content: buildListCsv(contacts),
    },
  };
}

/** One send path for all three emails: kill switch, sender, logging. */
async function deliver(
  kind: "list",
  ctx: ThankYouContext,
  email: ComposedEmail,
  extra: { bcc?: string; attachments?: EmailAttachment[] } = {},
): Promise<SendOutcome> {
  if (process.env.ICP_AUTOSEND_ENABLED !== "true") {
    // Kill switch: compose but never send. PII-safe log: job id + subject only.
    logger.info(`icp.${kind}.autosend_disabled`, {
      jobId: ctx.job_id,
      subject: email.subject,
    });
    return { sent: false, messageId: null, reason: "autosend_disabled" };
  }

  const senderEmail = process.env.ICP_EMAIL_SENDER || DEFAULT_SENDER;
  const senderName = process.env.ICP_EMAIL_SENDER_NAME || "Blue Modern Advisory";

  const result = await sendEmail({
    to: ctx.email,
    subject: email.subject,
    body: email.textBody,
    html: email.htmlBody,
    from: `${senderName} <${senderEmail}>`,
    senderEmail,
    bcc: extra.bcc,
    attachments: extra.attachments,
    // Transactional: the recipient asked for this.
    bypassDnc: true,
  });

  if (!result.success) {
    logger.error(`icp.${kind}.send_failed`, new Error("gmail send failed"), {
      jobId: ctx.job_id,
    });
    return { sent: false, messageId: null, reason: "send_failed" };
  }
  logger.info(`icp.${kind}.sent`, {
    jobId: ctx.job_id,
    messageId: result.messageId,
  });
  return { sent: true, messageId: result.messageId };
}

function listBcc(): string | undefined {
  const value = process.env.ICP_LIST_BCC ?? DEFAULT_LIST_BCC;
  return value.trim() || undefined;
}

export function sendListEmail(
  ctx: ThankYouContext,
  contacts: ListContact[],
): Promise<SendOutcome> {
  const { attachment, ...email } = composeListEmail(ctx, contacts);
  return deliver("list", ctx, email, { bcc: listBcc(), attachments: [attachment] });
}

/**
 * Internal-only ping so we know a list went out (or needs a hand). Fire and
 * forget: never blocks or fails the caller.
 */
export function notifyInternal(text: string): void {
  const webhook = process.env.SLACK_WEBSITE_NOTIFY_WEBHOOK;
  if (!webhook) return;
  fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch((err) =>
    logger.warn("icp.internal_notify_failed", {
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
