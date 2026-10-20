/**
 * Webhook routes — Framer forms + Stripe payment lifecycle + Clay results.
 *
 * POST /webhooks/framer-subscription  — Signal monitoring signup (shared secret)
 * POST /webhooks/data-pull            — One-time data pull request (shared secret)
 * POST /webhooks/stripe               — Stripe signature validation
 * POST /webhooks/clay-results         — Clay HTTP API action callback
 *
 * Stripe event routing by metadata.product_type:
 *   'signal'    → metered subscription lifecycle
 *   'data_pull' → one-time checkout + processing trigger
 */

import { Router, Request, Response } from 'express';
import { BigQuery } from '@google-cloud/bigquery';
import { setupSlackClient } from './slack';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSubscription } from '../agents/opportunity-notifications/subscription-manager';
import {
  createDataPullRecord,
  getDataPullRequest,
  processDataPull,
  createDataPullCheckout,
} from '../agents/opportunity-notifications/data-pull-pipeline';
import {
  SENIORITY_LEVELS, EMPLOYMENT_TYPES, COMPANY_SIZES, PRICING_PLANS,
  FREQUENCY_PRICING, getPriceMonthly, getStripeProductName,
  calculateDataPullCost,
  type SeniorityLevel, type EmploymentType, type CompanySize, type PricingPlan,
  type MonitorFrequency,
  type NotificationMatch, type NotificationPayload,
  type JobPostingMatch, type RecruiterContact,
} from '../agents/opportunity-notifications/types';

// ─── BigQuery Helpers (for audit_log) ──────────────────────────────────────

function getBqClient(): BigQuery {
  const projectId = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };
  const gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gcpCredentialsBase64) {
    const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
    options.credentials = JSON.parse(decoded);
  } else if (credentialsPath) {
    options.keyFilename = credentialsPath;
  }
  return new BigQuery(options);
}

function fqt(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

// ─── Audit Log ─────────────────────────────────────────────────────────────

interface AuditEntry {
  product_type: 'signal' | 'data_pull';
  event_type: string;
  entity_id: string;
  client_email: string;
  amount_cents: number;
  currency: string;
  metadata: Record<string, unknown>;
}

async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const bq = getBqClient();
    const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
    await bq.dataset(dataset).table('audit_log').insert([{
      audit_id: randomUUID(),
      action: `stripe.${entry.event_type}`,
      entity_type: entry.product_type,
      entity_id: entry.entity_id,
      actor: entry.client_email,
      details: JSON.stringify({
        product_type: entry.product_type,
        amount_cents: entry.amount_cents,
        currency: entry.currency,
        ...entry.metadata,
      }),
      created_at: new Date().toISOString(),
    }]);
  } catch (err) {
    process.stderr.write(`Audit log write error: ${err instanceof Error ? err.message : err}\n`);
  }
}

// ─── Stripe API Helpers ────────────────────────────────────────────────────

const STRIPE_API = 'https://api.stripe.com/v1';

function getStripeKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

async function stripePost(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const key = getStripeKey();
  if (!key) return null;

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });

  if (!res.ok) {
    const errText = await res.text();
    process.stderr.write(`Stripe API error (${path}, ${res.status}): ${errText}\n`);
    return null;
  }

  return await res.json() as Record<string, unknown>;
}

async function stripeGet(path: string): Promise<Record<string, unknown> | null> {
  const key = getStripeKey();
  if (!key) return null;

  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { 'Authorization': `Bearer ${key}` },
  });

  if (!res.ok) return null;
  return await res.json() as Record<string, unknown>;
}

// ─── Signal: Create Stripe Product + Price (idempotent) ────────────────────

async function getOrCreateSignalPrice(plan: PricingPlan, frequency: MonitorFrequency): Promise<string | null> {
  const key = getStripeKey();
  if (!key) return null;

  const productName = getStripeProductName(plan, frequency);
  const priceCents = getPriceMonthly(plan, frequency);

  process.stderr.write(`[stripe-debug] getOrCreateSignalPrice called for plan=${plan}, frequency=${frequency}, product_name=${productName}, price=${priceCents}\n`);

  const searchRes = await fetch(
    `${STRIPE_API}/products/search?query=name:'${encodeURIComponent(productName)}'`,
    { headers: { 'Authorization': `Bearer ${key}` } },
  );

  process.stderr.write(`[stripe-debug] product search status=${searchRes.status}\n`);

  if (searchRes.ok) {
    const data = await searchRes.json() as { data?: Array<{ id: string; default_price?: string }> };
    process.stderr.write(`[stripe-debug] product search results=${JSON.stringify(data.data?.map(p => ({ id: p.id, default_price: p.default_price })))}\n`);
    if (data.data && data.data.length > 0 && data.data[0].default_price) {
      process.stderr.write(`[stripe-debug] found existing price=${data.data[0].default_price}\n`);
      return String(data.data[0].default_price);
    }
  }

  process.stderr.write(`[stripe-debug] creating new product for plan=${plan}, frequency=${frequency}\n`);
  const product = await stripePost('/products', {
    name: productName,
    'metadata[plan]': plan,
    'metadata[frequency]': frequency,
    'metadata[product_type]': 'signal',
    'metadata[max_companies]': String(PRICING_PLANS[plan].max_companies),
  });
  process.stderr.write(`[stripe-debug] product created: id=${product?.id ?? 'null'}\n`);
  if (!product?.id) return null;

  const price = await stripePost('/prices', {
    product: String(product.id),
    'unit_amount': String(priceCents),
    currency: 'usd',
    'recurring[interval]': 'month',
  });
  process.stderr.write(`[stripe-debug] price created: id=${price?.id ?? 'null'}\n`);

  return price?.id ? String(price.id) : null;
}

// ─── Signal: Record Usage (metered billing) ────────────────────────────────

export async function recordSignalUsage(
  stripeSubscriptionId: string,
  matchCount: number,
): Promise<void> {
  if (!stripeSubscriptionId || matchCount <= 0) return;

  const key = getStripeKey();
  if (!key) return;

  try {
    const sub = await stripeGet(`/subscriptions/${stripeSubscriptionId}`);
    if (!sub) return;

    const items = sub.items as { data?: Array<{ id: string }> } | undefined;
    const itemId = items?.data?.[0]?.id;
    if (!itemId) return;

    await stripePost(`/subscription_items/${itemId}/usage_records`, {
      quantity: String(matchCount),
      timestamp: String(Math.floor(Date.now() / 1000)),
      action: 'increment',
    });

    process.stderr.write(`  Recorded ${matchCount} usage units on subscription ${stripeSubscriptionId}\n`);
  } catch (err) {
    process.stderr.write(`Usage record error: ${err instanceof Error ? err.message : err}\n`);
  }
}

// ─── Push new subscription to Clay ────────────────────────────────────────

async function pushSubscriptionToClay(params: {
  subscription_id: string;
  subscriber_email: string;
  subscriber_name: string | null;
  plan: PricingPlan;
  signal_query: string | null;
  monitor_frequency: string;
  companies_limit: number;
  target_industries: string[];
  target_company_sizes: CompanySize[];
  target_location: string;
  target_job_titles: string[];
  target_seniority: SeniorityLevel | null;
  target_employment_type: EmploymentType | null;
  posting_limit_per_company: number;
  target_keywords: string[];
  target_companies: string[];
  notification_channels: ('email' | 'slack')[];
  notification_email: string | null;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
}): Promise<void> {
  const webhookUrl = process.env.CLAY_SUBSCRIPTION_WEBHOOK_URL;
  if (!webhookUrl) {
    process.stderr.write(
      `  [clay-subscription-skip] CLAY_SUBSCRIPTION_WEBHOOK_URL not set — ` +
      `subscription ${params.subscription_id} not pushed to Clay\n`,
    );
    return;
  }

  const payload = {
    subscription_id:       params.subscription_id,
    subscriber_email:      params.subscriber_email,
    subscriber_name:       params.subscriber_name ?? '',
    plan:                  params.plan,
    companies_limit:       params.companies_limit,
    monitor_frequency:     params.monitor_frequency,
    job_titles:            params.target_job_titles.join(', '),
    seniority:             params.target_seniority ?? '',
    employment_type:       params.target_employment_type ?? '',
    keywords:              params.target_keywords.join(', '),
    target_companies:      params.target_companies.join(', '),
    location:              params.target_location,
    industries:            params.target_industries.join(', '),
    company_sizes:         params.target_company_sizes.join(', '),
    posting_limit_per_company: params.posting_limit_per_company,
    signal_query:          params.signal_query ?? '',
    notification_channels: params.notification_channels.join(', '),
    slack_channel_id:      params.slack_channel_id ?? '',
    slack_channel_name:    params.slack_channel_name ?? '',
    notification_email:    params.notification_email ?? '',
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      process.stderr.write(
        `  Clay subscription webhook failed (${res.status}): ${body.slice(0, 200)}\n`,
      );
    } else {
      process.stderr.write(
        `  Pushed subscription ${params.subscription_id} to Clay signal table\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `  Clay subscription webhook error: ${err instanceof Error ? err.message : err}\n`,
    );
  }
}

// ─── Slack: Create channel + generate Slack Connect invite URL ────────────

async function sendSlackInvite(
  email: string,
  subscriberName: string | null,
): Promise<{ channel_id: string; channel_name: string; invite_url: string | null } | null> {
  try {
    return await setupSlackClient({ email, subscriberName: subscriberName || email.split('@')[0] });
  } catch (err) {
    process.stderr.write(`[slack-invite-error] ${err instanceof Error ? err.message : err}\n`);
    return null;
  }
}

// ─── Gmail Token Helper ────────────────────────────────────────────────────
// Always fetches a fresh access token from the refresh token so it never
// expires in production. Falls back to GMAIL_ACCESS_TOKEN for local testing.

async function getValidGmailToken(): Promise<string | null> {
  const refreshToken  = process.env.GMAIL_REFRESH_TOKEN;
  const clientId      = process.env.GMAIL_CLIENT_ID;
  const clientSecret  = process.env.GMAIL_CLIENT_SECRET;

  if (refreshToken && clientId && clientSecret) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (res.ok && typeof data.access_token === 'string') return data.access_token;
      process.stderr.write(`  [gmail-token-warn] refresh failed: ${JSON.stringify(data)}\n`);
    } catch (err) {
      process.stderr.write(`  [gmail-token-error] ${err instanceof Error ? err.message : err}\n`);
    }
  }

  // Fallback: use a static access token (fine for quick local tests)
  return process.env.GMAIL_ACCESS_TOKEN ?? null;
}

// ─── Welcome Email ─────────────────────────────────────────────────────────

async function sendWelcomeEmail(params: {
  toEmail: string;
  subscriberName: string | null;
  slackInviteUrl: string | null;
  slackChannelName: string | null;
}): Promise<void> {
  const gmailToken = await getValidGmailToken();
  if (!gmailToken) {
    process.stderr.write(`  [welcome-email-skip] no Gmail token — would send to ${params.toEmail}\n`);
    return;
  }

  const firstName = params.subscriberName ? params.subscriberName.trim().split(/\s+/)[0] : null;
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';

  // BMA logo — CID inline attachment (works in Gmail); falls back to hosted URL, else omit
  let logoFileData: Buffer | null = null;
  try { logoFileData = readFileSync(join(process.cwd(), 'public/assets/bma-logo.avif')); } catch { /* not present */ }
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  const logoSrc = logoFileData ? 'cid:bma-logo' : appUrl ? `${appUrl}/assets/bma-logo.avif` : null;
  const logoImg = logoSrc ? `<img src="${logoSrc}" alt="Blue Modern Advisory" width="130" height="130" style="display:block;" />` : '';

  // Slack button — derive channel name from subscriber first name if not explicitly provided
  const slackHref = params.slackInviteUrl ?? '#';
  const derivedChannel = params.slackChannelName ?? (firstName ? `${firstName.toLowerCase()}-job-postings` : null);
  const slackChannelLabel = derivedChannel ? `#${derivedChannel}` : 'our Slack channel';
  const slackButton = `<table cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td>
          <a href="${slackHref}" style="text-decoration:none;">
            <table cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;background-color:#1C5099;">
              <tr>
                <td style="padding:13px 24px;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:#ffffff;white-space:nowrap;letter-spacing:0.2px;">Join ${slackChannelLabel}</td>
              </tr>
            </table>
          </a>
        </td>
      </tr>
    </table>`;

  const year = new Date().getFullYear();

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">

          <!-- Wordmark above card -->
          <tr>
            <td align="center" style="padding-bottom:18px;">
              <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1C5099;">Blue Modern Advisory</p>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 24px rgba(28,80,153,0.10);">

              <!-- Blue header with logo -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#0D2B6E 0%,#1C5099 60%,#2563C4 100%);padding:36px 36px 32px;" valign="middle">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="middle">
                          <p style="margin:0 0 2px;font-size:15px;font-weight:400;color:#ffffff;letter-spacing:0.1px;">Welcome to the</p>
                          <p style="margin:0;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;line-height:1.15;font-family:Georgia,'Times New Roman',serif;">BMA community</p>
                        </td>
                        ${logoImg ? `<td valign="middle" align="right" width="148" style="padding-left:12px;"><img src="${logoSrc}" alt="Blue Modern Advisory" width="130" height="130" style="display:block;" /></td>` : ''}
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Body -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:32px 36px 28px;">

                    <p style="font-size:15px;color:#374151;line-height:1.75;margin:0 0 14px;">${greeting}</p>

                    <p style="font-size:15px;color:#374151;line-height:1.75;margin:0 0 14px;">
                      You're all set. We're actively monitoring for opportunities that match your criteria and will be in touch as soon as we find strong matches.
                    </p>

                    <p style="font-size:15px;color:#374151;line-height:1.75;margin:0 0 24px;">
                      Join our Slack channel to receive signals directly, ask questions, or update your preferences at any time.
                    </p>

                    ${slackButton}

                  </td>
                </tr>
              </table>

              <!-- Benefits section -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 36px 8px;">
                    <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#1C5099;">How to make the most of your signals</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 36px 32px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:14px 16px;background-color:#F0F5FF;border-radius:8px;" valign="top">
                          <table cellpadding="0" cellspacing="0" width="100%"><tr>
                            <td width="28" valign="top" style="padding-right:12px;padding-top:2px;font-size:18px;color:#1C5099;line-height:1;">&#9678;</td>
                            <td valign="top">
                              <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#0D1F3C;">Spot companies in active hiring mode</p>
                              <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">Companies hiring for these roles are already in growth or transition, making them high-priority targets worth reaching out to now.</p>
                            </td>
                          </tr></table>
                        </td>
                      </tr>
                      <tr><td style="height:8px;"></td></tr>
                      <tr>
                        <td style="padding:14px 16px;background-color:#F0F5FF;border-radius:8px;" valign="top">
                          <table cellpadding="0" cellspacing="0" width="100%"><tr>
                            <td width="30" valign="top" style="padding-right:10px;padding-top:3px;">
                              <table cellpadding="0" cellspacing="0" width="20"><tr><td align="center" style="padding-bottom:2px;line-height:1;"><div style="width:9px;height:9px;background-color:#1C5099;border-radius:5px;margin:0 auto;"></div></td></tr><tr><td align="center" style="line-height:0;"><div style="width:18px;height:9px;border:2px solid #1C5099;border-bottom:0;border-radius:9px 9px 0 0;"></div></td></tr></table>
                            </td>
                            <td valign="top">
                              <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#0D1F3C;">Access recruiter contact info and a draft outreach message</p>
                              <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">Skip hours of manual research, get a ready-to-send message with every signal match. Available when this feature is unlocked.</p>
                            </td>
                          </tr></table>
                        </td>
                      </tr>
                      <tr><td style="height:8px;"></td></tr>
                      <tr>
                        <td style="padding:14px 16px;background-color:#F0F5FF;border-radius:8px;" valign="top">
                          <table cellpadding="0" cellspacing="0" width="100%"><tr>
                            <td width="28" valign="top" style="padding-right:12px;padding-top:3px;">
                              <table cellpadding="0" cellspacing="0" width="20"><tr><td align="center" style="line-height:0;"><table cellpadding="0" cellspacing="0"><tr><td style="line-height:0;"><div style="width:8px;height:8px;border:2px solid #1C5099;border-radius:5px;box-sizing:border-box;"></div></td><td style="line-height:0;padding-top:3px;"><div style="width:4px;height:2px;background-color:#1C5099;"></div></td><td style="line-height:0;"><div style="width:8px;height:8px;border:2px solid #1C5099;border-radius:5px;box-sizing:border-box;"></div></td></tr></table></td></tr><tr><td align="center" style="line-height:0;padding-top:2px;"><table cellpadding="0" cellspacing="0"><tr><td style="line-height:0;"><div style="width:8px;height:8px;background-color:#1C5099;border-radius:0 0 3px 3px;"></div></td><td width="4"></td><td style="line-height:0;"><div style="width:8px;height:8px;background-color:#1C5099;border-radius:0 0 3px 3px;"></div></td></tr></table></td></tr></table>
                            </td>
                            <td valign="top">
                              <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#0D1F3C;">Stay ahead, not reactive</p>
                              <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6;">You'll know about relevant openings as they appear, not weeks later when everyone else has already reached out.</p>
                            </td>
                          </tr></table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Feedback + signoff -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 36px 36px;border-top:1px solid #E5EAF3;">
                    <p style="font-size:14px;color:#374151;line-height:1.75;margin:24px 0 20px;">
                      We're constantly improving and pushing out new features. If something feels off or you have ideas, we'd genuinely love to hear from you, just reply to this email.
                    </p>
                    <p style="font-size:14px;color:#374151;margin:0 0 4px;">Best regards,</p>
                    <p style="font-size:15px;color:#0D1F3C;margin:0;font-weight:600;">The Blue Modern Advisory team</p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">&copy; ${year} Blue Modern Advisory LLC. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const subject = `=?UTF-8?B?${Buffer.from("Welcome! You're all set.").toString('base64')}?=`;
  const headers = [
    `From: Blue Modern Advisory <maggie@bluemodernadvisory.com>`,
    `To: ${params.toEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];

  let rawMessage: string;
  if (logoFileData) {
    const boundary = `bma_${randomUUID().replace(/-/g, '')}`;
    rawMessage = [
      ...headers,
      `Content-Type: multipart/related; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
      '',
      `--${boundary}`,
      'Content-Type: image/avif',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <bma-logo>',
      'Content-Disposition: inline; filename="bma-logo.avif"',
      '',
      logoFileData.toString('base64'),
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    rawMessage = [...headers, 'Content-Type: text/html; charset=utf-8', '', htmlBody].join('\r\n');
  }

  const encoded = Buffer.from(rawMessage).toString('base64url');

  try {
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gmailToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      process.stderr.write(`  [welcome-email-error] Gmail API ${resp.status}: ${body}\n`);
    } else {
      process.stderr.write(`  [welcome-email] sent to ${params.toEmail}\n`);
    }
  } catch (err) {
    process.stderr.write(`  [welcome-email-error] ${err instanceof Error ? err.message : err}\n`);
  }
}

// ─── Signal: Send payment failed notification ──────────────────────────────

async function sendPaymentFailedEmail(email: string, productType: string, entityId: string): Promise<void> {
  const gmailToken = await getValidGmailToken();
  if (!gmailToken) {
    process.stderr.write(`  [email-skip] Would notify ${email}: payment failed for ${productType} ${entityId}\n`);
    return;
  }

  const subject = `Payment failed — action required`;
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#333;">
      <h1 style="font-size:22px;color:#1a1a1a;">Payment Failed</h1>
      <p>We were unable to process your payment for your ${productType === 'signal' ? 'Signal Monitor subscription' : 'data pull request'}.</p>
      <p>Please update your payment method to avoid service interruption.</p>
      <p style="color:#666;font-size:13px;">Reference: ${entityId}</p>
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0;">
      <p style="font-size:12px;color:#999;">Powered by Togari</p>
    </body>
    </html>`;

  const mimeMessage = [
    `To: ${email}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ].join('\r\n');

  const encoded = Buffer.from(mimeMessage).toString('base64url');

  try {
    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gmailToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });
  } catch (err) {
    process.stderr.write(`Payment failed email error: ${err instanceof Error ? err.message : err}\n`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════

export function createWebhookRouter(): Router {
  const router = Router();

  // ─── Framer Subscription Webhook ──────────────────────────────────────────

  router.post('/framer-subscription', async (req: Request, res: Response) => {
    try {
      // Validate shared secret
      const secret = process.env.FRAMER_WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers['x-framer-secret'];
        if (provided !== secret) {
          res.status(401).json({ error: true, message: 'Invalid webhook secret' });
          return;
        }
      }

      const body = req.body;
      if (!body || !body.email) {
        res.status(400).json({ error: true, message: 'Missing required field: email' });
        return;
      }

      const hasSignalQuery = body.signal_query && typeof body.signal_query === 'string';

      if (!hasSignalQuery) {
        if (!body.job_titles || !Array.isArray(body.job_titles) || body.job_titles.length === 0) {
          res.status(400).json({ error: true, message: 'Missing required field: job_titles (array) or signal_query' });
          return;
        }
      }

      const validPlans = Object.keys(PRICING_PLANS) as PricingPlan[];
      const plan: PricingPlan = validPlans.includes(body.plan) ? body.plan : 'starter';

      const companySizes = Array.isArray(body.company_sizes)
        ? body.company_sizes.filter((s: string) =>
            (COMPANY_SIZES as readonly string[]).includes(s)
          ) as CompanySize[]
        : [];

      let seniority: SeniorityLevel | null = null;
      if (body.seniority && (SENIORITY_LEVELS as readonly string[]).includes(body.seniority)) {
        seniority = body.seniority as SeniorityLevel;
      }

      let employmentType: EmploymentType | null = null;
      if (body.employment_type && (EMPLOYMENT_TYPES as readonly string[]).includes(body.employment_type)) {
        employmentType = body.employment_type as EmploymentType;
      }

      const channels: ('email' | 'slack')[] = [];
      if (Array.isArray(body.notification_channels)) {
        if (body.notification_channels.includes('email')) channels.push('email');
        if (body.notification_channels.includes('slack')) channels.push('slack');
        if (body.notification_channels.includes('both')) { channels.push('email'); channels.push('slack'); }
      }
      if (channels.length === 0) channels.push('email');

      const validFrequencies = ['daily', 'weekly', 'biweekly'] as const;
      const frequency: MonitorFrequency = validFrequencies.includes(body.monitor_frequency)
        ? body.monitor_frequency
        : 'daily';

      const subscription = await createSubscription({
        subscriber_email: String(body.email),
        subscriber_name: body.name ? String(body.name) : undefined,
        plan,
        signal_query: hasSignalQuery ? String(body.signal_query) : undefined,
        monitor_frequency: frequency,
        companies_limit: PRICING_PLANS[plan].max_companies,
        stripe_price_id: body.stripe_price_id ? String(body.stripe_price_id) : undefined,
        target_industries: Array.isArray(body.industries) ? body.industries.map(String) : [],
        target_company_sizes: companySizes.length > 0 ? companySizes : ['D', 'E', 'F'] as CompanySize[],
        target_location: body.location ? String(body.location) : 'United States',
        target_job_titles: Array.isArray(body.job_titles) ? body.job_titles.map(String) : [],
        target_seniority: seniority,
        target_employment_type: employmentType,
        posting_limit_per_company: body.posting_limit ? Math.min(Number(body.posting_limit), 100) : 10,
        target_keywords: body.keywords ? body.keywords.map(String) : undefined,
        target_companies: Array.isArray(body.target_companies) ? body.target_companies.map(String) : [],
        notification_channels: channels,
        slack_channel_id: body.slack_channel_id ? String(body.slack_channel_id) : undefined,
        notification_email: body.notification_email ? String(body.notification_email) : undefined,
      });

      // Create Stripe checkout
      let stripe_checkout_url: string | null = null;
      const stripeKey = getStripeKey();
      process.stderr.write(`[stripe-debug] stripeKey exists: ${!!stripeKey}, plan: ${plan}\n`);

      if (!stripeKey) {
        process.stderr.write(`[stripe-skip] STRIPE_SECRET_KEY not set — checkout session not created for subscription ${subscription.subscription_id}\n`);
      } else {
        try {
          const priceId = await getOrCreateSignalPrice(plan, frequency);
          process.stderr.write(`[stripe-debug] priceId returned: ${priceId}\n`);

          if (!priceId) {
            process.stderr.write(`[stripe-skip] getOrCreateSignalPrice returned null for plan=${plan}\n`);
          } else {
            const sessionParams = {
              'mode': 'subscription',
              'customer_email': subscription.subscriber_email,
              'line_items[0][price]': priceId,
              'line_items[0][quantity]': '1',
              'allow_promotion_codes': 'true',
              'metadata[subscription_id]': subscription.subscription_id,
              'metadata[product_type]': 'signal',
              'metadata[plan]': plan,
              'subscription_data[metadata][subscription_id]': subscription.subscription_id,
              'subscription_data[metadata][product_type]': 'signal',
              'subscription_data[metadata][plan]': plan,
              'success_url': process.env.STRIPE_SUCCESS_URL || 'https://bluemodernadvisory.com/checkout/success',
              'cancel_url': process.env.STRIPE_CANCEL_URL || 'https://bluemodernadvisory.com/checkout/canceled',
            };
            process.stderr.write(`[stripe-debug] creating checkout session with params: ${JSON.stringify(sessionParams)}\n`);

            const session = await stripePost('/checkout/sessions', sessionParams);
            process.stderr.write(`[stripe-debug] session response: ${JSON.stringify(session)}\n`);

            if (!session?.url) {
              process.stderr.write(`[stripe-skip] Stripe session created but returned no URL\n`);
            }
            stripe_checkout_url = session?.url ? String(session.url) : null;
          }
        } catch (err) {
          process.stderr.write(`[stripe-error] Checkout creation failed for plan=${plan}: ${err instanceof Error ? err.message : err}\n`);
        }
      }

      process.stderr.write(`[stripe-debug] final stripe_checkout_url: ${stripe_checkout_url}\n`);

      // Audit log
      await writeAuditLog({
        product_type: 'signal',
        event_type: 'subscription_created',
        entity_id: subscription.subscription_id,
        client_email: subscription.subscriber_email,
        amount_cents: getPriceMonthly(plan, frequency),
        currency: 'usd',
        metadata: { plan, monitor_frequency: frequency, has_signal_query: hasSignalQuery },
      });

      res.status(201).json({
        subscription_id: subscription.subscription_id,
        status: subscription.status,
        payment_status: subscription.payment_status,
        plan: subscription.plan,
        max_companies: PRICING_PLANS[plan].max_companies,
        stripe_checkout_url,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Framer webhook error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  // ─── Data Pull Request Webhook (Framer form) ─────────────────────────────

  router.post('/data-pull', async (req: Request, res: Response) => {
    try {
      const secret = process.env.FRAMER_WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers['x-framer-secret'];
        if (provided !== secret) {
          res.status(401).json({ error: true, message: 'Invalid webhook secret' });
          return;
        }
      }

      const body = req.body;
      if (!body || !body.email) {
        res.status(400).json({ error: true, message: 'Missing required field: email' });
        return;
      }
      if (!body.query || typeof body.query !== 'string') {
        res.status(400).json({ error: true, message: 'Missing required field: query (string)' });
        return;
      }
      if (!body.count || typeof body.count !== 'number' || body.count < 1) {
        res.status(400).json({ error: true, message: 'Missing required field: count (positive number)' });
        return;
      }
      if (body.count > 10000) {
        res.status(400).json({ error: true, message: 'count must be 10,000 or less' });
        return;
      }

      const clientId = String(body.client_id || body.email);
      const email = String(body.email);
      const query = String(body.query);
      const count = Number(body.count);

      const costUsd = calculateDataPullCost(count);
      const costCents = Math.round(costUsd * 100);

      const request = await createDataPullRecord(clientId, query, count, null);
      const checkoutUrl = await createDataPullCheckout(request.pull_id, email, count);

      await writeAuditLog({
        product_type: 'data_pull',
        event_type: 'checkout_created',
        entity_id: request.pull_id,
        client_email: email,
        amount_cents: costCents,
        currency: 'usd',
        metadata: { query, count, cost_usd: costUsd },
      });

      res.status(201).json({
        pull_id: request.pull_id,
        status: 'pending_payment',
        estimated_cost_usd: costUsd,
        stripe_checkout_url: checkoutUrl,
        query,
        count,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Data pull webhook error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  // ─── Stripe Webhook ───────────────────────────────────────────────────────

  router.post('/stripe', async (req: Request, res: Response) => {
    try {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        res.status(503).json({ error: true, message: 'Stripe webhooks not configured' });
        return;
      }

      const signature = req.headers['stripe-signature'];
      if (!signature) {
        res.status(401).json({ error: true, message: 'Missing Stripe signature' });
        return;
      }

      const event = req.body;
      if (!event || !event.type) {
        res.status(400).json({ error: true, message: 'Invalid event payload' });
        return;
      }

      const { updateSubscription, getSubscription } = await import('../agents/opportunity-notifications/subscription-manager');

      const eventObj = event.data?.object as Record<string, unknown> | undefined;
      const metadata = (eventObj?.metadata ?? {}) as Record<string, string>;
      const productType = metadata.product_type as 'signal' | 'data_pull' | undefined;

      process.stderr.write(`[Stripe] Event: ${event.type}, product_type: ${productType || 'unknown'}\n`);

      switch (event.type) {

        case 'checkout.session.completed': {
          const session = eventObj as Record<string, unknown>;
          const sessionMeta = (session?.metadata ?? {}) as Record<string, string>;

          if (sessionMeta.product_type === 'signal' && sessionMeta.subscription_id) {
            const stripeSubId = session.subscription ? String(session.subscription) : null;
            const stripeCustomerId = session.customer ? String(session.customer) : null;

            try {
              await updateSubscription(sessionMeta.subscription_id, {
                stripe_customer_id: stripeCustomerId ?? undefined,
                stripe_subscription_id: stripeSubId ?? undefined,
                payment_status: 'active',
              });
              process.stderr.write(`  Signal subscription activated: ${sessionMeta.subscription_id}\n`);
            } catch (updateErr) {
              process.stderr.write(`  [stripe-error] updateSubscription failed for ${sessionMeta.subscription_id}: ${updateErr instanceof Error ? updateErr.message : updateErr}\n`);
            }

            await writeAuditLog({
              product_type: 'signal',
              event_type: 'checkout_completed',
              entity_id: sessionMeta.subscription_id,
              client_email: session.customer_email ? String(session.customer_email) : '',
              amount_cents: Number(session.amount_total || 0),
              currency: 'usd',
              metadata: {
                stripe_subscription_id: stripeSubId,
                plan: sessionMeta.plan,
              },
            });

            // Create Slack channel first so channel info is available for Clay
            let slackChannel: { channel_id: string; channel_name: string; invite_url: string | null } | null = null;
            const customerEmail = session.customer_email ? String(session.customer_email) : null;
            const subscriberName = sessionMeta.subscriber_name ?? null;
            if (customerEmail && sessionMeta.subscription_id) {
              slackChannel = await sendSlackInvite(customerEmail, subscriberName);
              if (slackChannel) {
                try {
                  await updateSubscription(sessionMeta.subscription_id, { slack_channel_id: slackChannel.channel_id });
                } catch (slackUpdateErr) {
                  process.stderr.write(`  [stripe-warn] failed to store slack_channel_id for ${sessionMeta.subscription_id}: ${slackUpdateErr instanceof Error ? slackUpdateErr.message : slackUpdateErr}\n`);
                }
              }
            }

            // Send branded welcome email (replaces Slack's own invite email)
            if (customerEmail) {
              await sendWelcomeEmail({
                toEmail: customerEmail,
                subscriberName: subscriberName,
                slackInviteUrl: slackChannel?.invite_url ?? null,
                slackChannelName: slackChannel?.channel_name ?? null,
              });
            }

            try {
              const activatedSub = await getSubscription(sessionMeta.subscription_id);
              if (activatedSub) {
                await pushSubscriptionToClay({
                  subscription_id: activatedSub.subscription_id,
                  subscriber_email: activatedSub.subscriber_email,
                  subscriber_name: activatedSub.subscriber_name,
                  plan: activatedSub.plan as Parameters<typeof pushSubscriptionToClay>[0]['plan'],
                  signal_query: activatedSub.signal_query,
                  monitor_frequency: activatedSub.monitor_frequency,
                  companies_limit: activatedSub.companies_limit,
                  target_industries: activatedSub.target_industries,
                  target_company_sizes: activatedSub.target_company_sizes,
                  target_location: activatedSub.target_location,
                  target_job_titles: activatedSub.target_job_titles,
                  target_seniority: activatedSub.target_seniority,
                  target_employment_type: activatedSub.target_employment_type,
                  posting_limit_per_company: activatedSub.posting_limit_per_company,
                  target_keywords: activatedSub.target_keywords,
                  target_companies: activatedSub.target_companies,
                  notification_channels: activatedSub.notification_channels.filter(
                    (c): c is 'email' | 'slack' => c === 'email' || c === 'slack',
                  ),
                  notification_email: activatedSub.notification_email,
                  slack_channel_id: slackChannel?.channel_id ?? activatedSub.slack_channel_id,
                  slack_channel_name: slackChannel?.channel_name ?? null,
                });
              } else {
                process.stderr.write(`  [stripe-warn] getSubscription returned null for ${sessionMeta.subscription_id} — subscription record not found\n`);
              }
            } catch (fetchErr) {
              process.stderr.write(`  [stripe-error] getSubscription/Clay push failed for ${sessionMeta.subscription_id}: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}\n`);
            }
          }

          if (sessionMeta.product_type === 'data_pull' && sessionMeta.pull_id) {
            const pullId = sessionMeta.pull_id;
            process.stderr.write(`  Data pull payment completed: ${pullId}\n`);

            await writeAuditLog({
              product_type: 'data_pull',
              event_type: 'payment_completed',
              entity_id: pullId,
              client_email: session.customer_email ? String(session.customer_email) : '',
              amount_cents: Number(session.amount_total || 0),
              currency: 'usd',
              metadata: {},
            });

            const pullRequest = await getDataPullRequest(pullId);
            if (pullRequest && pullRequest.status === 'pending') {
              processDataPull(pullRequest).catch(err => {
                process.stderr.write(`Data pull processing error: ${err instanceof Error ? err.message : err}\n`);
              });
            }
          }

          if (!sessionMeta.product_type && sessionMeta.subscription_id) {
            await updateSubscription(sessionMeta.subscription_id, {
              stripe_customer_id: session.customer ? String(session.customer) : undefined,
              stripe_subscription_id: session.subscription ? String(session.subscription) : undefined,
              payment_status: 'active',
            });
          }
          break;
        }

        case 'customer.subscription.created': {
          const sub = eventObj as Record<string, unknown>;
          const subMeta = (sub?.metadata ?? {}) as Record<string, string>;

          if (subMeta.product_type === 'signal' && subMeta.subscription_id) {
            const existing = await getSubscription(subMeta.subscription_id);
            if (existing) {
              await updateSubscription(subMeta.subscription_id, {
                stripe_subscription_id: sub.id ? String(sub.id) : undefined,
                stripe_customer_id: sub.customer ? String(sub.customer) : undefined,
                payment_status: 'active',
              });
            }

            await writeAuditLog({
              product_type: 'signal',
              event_type: 'subscription_activated',
              entity_id: subMeta.subscription_id,
              client_email: existing?.subscriber_email || '',
              amount_cents: 0,
              currency: 'usd',
              metadata: { stripe_subscription_id: sub.id, plan: subMeta.plan },
            });

            process.stderr.write(`  Signal subscription created in Stripe: ${subMeta.subscription_id}\n`);
          }
          break;
        }

        case 'customer.subscription.updated': {
          const sub = eventObj as Record<string, unknown>;
          const subMeta = (sub?.metadata ?? {}) as Record<string, string>;

          const status = sub?.status === 'active' ? 'active' as const
            : sub?.status === 'past_due' ? 'past_due' as const
            : undefined;

          const subscriptionId = subMeta?.subscription_id;
          if (status && subscriptionId) {
            await updateSubscription(subscriptionId, { payment_status: status });

            await writeAuditLog({
              product_type: 'signal',
              event_type: 'subscription_updated',
              entity_id: subscriptionId,
              client_email: '',
              amount_cents: 0,
              currency: 'usd',
              metadata: { stripe_status: sub.status, payment_status: status },
            });
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const sub = eventObj as Record<string, unknown>;
          const subMeta = (sub?.metadata ?? {}) as Record<string, string>;

          if (subMeta?.subscription_id) {
            await updateSubscription(subMeta.subscription_id, {
              payment_status: 'canceled', status: 'canceled',
            });

            await writeAuditLog({
              product_type: 'signal',
              event_type: 'subscription_canceled',
              entity_id: subMeta.subscription_id,
              client_email: '',
              amount_cents: 0,
              currency: 'usd',
              metadata: { reason: 'stripe_subscription_deleted' },
            });

            process.stderr.write(`  Signal subscription canceled: ${subMeta.subscription_id}\n`);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = eventObj as Record<string, unknown>;
          const subDetails = invoice?.subscription_details as Record<string, unknown> | undefined;
          const invoiceMeta = (subDetails?.metadata ?? invoice?.metadata ?? {}) as Record<string, string>;

          if (invoiceMeta?.subscription_id) {
            await updateSubscription(invoiceMeta.subscription_id, {
              payment_status: 'past_due',
            });

            const existing = await getSubscription(invoiceMeta.subscription_id);
            if (existing) {
              await sendPaymentFailedEmail(
                existing.subscriber_email,
                'signal',
                invoiceMeta.subscription_id,
              );
            }

            await writeAuditLog({
              product_type: 'signal',
              event_type: 'payment_failed',
              entity_id: invoiceMeta.subscription_id,
              client_email: existing?.subscriber_email || '',
              amount_cents: Number(invoice?.amount_due || 0),
              currency: 'usd',
              metadata: { attempt_count: invoice?.attempt_count },
            });

            process.stderr.write(`  Invoice payment failed for subscription: ${invoiceMeta.subscription_id}\n`);
          }
          break;
        }

        case 'payment_intent.payment_failed': {
          const intent = eventObj as Record<string, unknown>;
          const intentMeta = (intent?.metadata ?? {}) as Record<string, string>;

          if (intentMeta?.product_type === 'data_pull' && intentMeta?.pull_id) {
            const bq = getBqClient();
            try {
              await bq.query({
                query: `UPDATE ${fqt('data_pull_requests')} SET status = 'pending', updated_at = CURRENT_TIMESTAMP() WHERE pull_id = @id`,
                params: { id: intentMeta.pull_id },
                useLegacySql: false,
              });
            } catch (err) {
              process.stderr.write(`Data pull status update error: ${err instanceof Error ? err.message : err}\n`);
            }

            const customerEmail = intent?.receipt_email
              ? String(intent.receipt_email)
              : '';

            if (customerEmail) {
              await sendPaymentFailedEmail(customerEmail, 'data_pull', intentMeta.pull_id);
            }

            await writeAuditLog({
              product_type: 'data_pull',
              event_type: 'payment_failed',
              entity_id: intentMeta.pull_id,
              client_email: customerEmail,
              amount_cents: Number(intent?.amount || 0),
              currency: 'usd',
              metadata: {
                error_message: (intent?.last_payment_error as Record<string, unknown>)?.message,
              },
            });

            process.stderr.write(`  Data pull payment failed: ${intentMeta.pull_id}\n`);
          }
          break;
        }
      }

      res.status(200).json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Stripe webhook error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  // ─── Clay Enrichment Callback ─────────────────────────────────────────────

  router.post('/clay-enrichment', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;

      if (!body?.pull_id || !body?.row_id) {
        res.status(400).json({ error: true, message: 'Missing pull_id or row_id' });
        return;
      }

      const bq = getBqClient();
      const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
      const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';

      await bq.query({
        query: `
          UPDATE \`${project}.${dataset}.togari_structured_contacts\`
          SET
            workEmail     = @email,
            currentCompany = COALESCE(@company, currentCompany)
          WHERE row_id = @row_id AND pull_id = @pull_id
        `,
        params: {
          pull_id: String(body.pull_id),
          row_id:  String(body.row_id),
          email:   body.email   ? String(body.email)   : null,
          company: body.company ? String(body.company) : null,
        },
      });

      process.stderr.write(
        `[clay-enrichment] row_id=${body.row_id} pull_id=${body.pull_id} ` +
        `email=${body.email ?? '(none)'}\n`,
      );

      res.status(200).json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Clay enrichment callback error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  // ─── Clay Results Webhook ─────────────────────────────────────────────────

  router.post('/clay-results', async (req: Request, res: Response) => {
    try {
      const secret = process.env.CLAY_RESULTS_WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers['x-clay-secret'];
        if (provided !== secret) {
          res.status(401).json({ error: true, message: 'Invalid webhook secret' });
          return;
        }
      }

      const body = req.body as Record<string, unknown> | undefined;
      if (!body?.subscription_id) {
        res.status(400).json({ error: true, message: 'Missing subscription_id' });
        return;
      }
      const subscriptionId = String(body.subscription_id);
      const rawResults = Array.isArray(body.results) ? body.results : [];

      const {
        getSubscription,
        updateSubscription,
      } = await import('../agents/opportunity-notifications/subscription-manager');
      const { sendNotification } = await import(
        '../agents/opportunity-notifications/notification-sender'
      );
      const { draftOutreachMessage } = await import(
        '../agents/opportunity-notifications/outreach-drafter'
      );

      const subscription = await getSubscription(subscriptionId);
      if (!subscription) {
        res.status(404).json({ error: true, message: `Subscription ${subscriptionId} not found` });
        return;
      }
      if (subscription.status !== 'active') {
        process.stderr.write(
          `  [clay-results] Subscription ${subscriptionId} is ${subscription.status} — skipping\n`,
        );
        res.status(200).json({ received: true, skipped: true, reason: 'subscription not active' });
        return;
      }

      const pick = (row: Record<string, unknown>, ...keys: string[]): string | null => {
        for (const k of keys) {
          const v = row[k];
          if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
        }
        return null;
      };
      const coerceSeniority = (v: string | null): SeniorityLevel | null =>
        v && (SENIORITY_LEVELS as readonly string[]).includes(v) ? (v as SeniorityLevel) : null;
      const coerceEmployment = (v: string | null): EmploymentType | null =>
        v && (EMPLOYMENT_TYPES as readonly string[]).includes(v) ? (v as EmploymentType) : null;

      const matches: NotificationMatch[] = [];
      for (const raw of rawResults as Record<string, unknown>[]) {
        const title = pick(raw, 'job_title', 'title', 'posting_title');
        const company = pick(raw, 'company', 'company_name', 'employer');
        if (!title || !company) continue;

        const jobPosting: JobPostingMatch = {
          title,
          company,
          company_domain: pick(raw, 'company_domain', 'domain', 'website'),
          url: pick(raw, 'job_url', 'url', 'posting_url', 'linkedin_url') || '',
          posted_date: pick(raw, 'posted_date', 'date_posted', 'posted_at'),
          seniority: coerceSeniority(pick(raw, 'seniority', 'seniority_level')),
          employment_type: coerceEmployment(pick(raw, 'employment_type', 'job_type')),
          location: pick(raw, 'location', 'job_location'),
          source: 'clay',
        };

        const recruiter: RecruiterContact | null = pick(raw, 'recruiter_name', 'contact_name')
          || pick(raw, 'recruiter_email', 'contact_email')
          || pick(raw, 'recruiter_linkedin', 'contact_linkedin')
          ? {
              name: pick(raw, 'recruiter_name', 'contact_name'),
              title: pick(raw, 'recruiter_title', 'contact_title'),
              email: pick(raw, 'recruiter_email', 'contact_email'),
              linkedin_url: pick(raw, 'recruiter_linkedin', 'contact_linkedin'),
              company,
            }
          : null;

        const outreach_draft = await draftOutreachMessage(jobPosting, recruiter, {
          name: subscription.subscriber_name,
          email: subscription.subscriber_email,
        });

        matches.push({ job_posting: jobPosting, recruiter, outreach_draft });
      }

      process.stderr.write(
        `[clay-results] subscription=${subscriptionId} rows_in=${rawResults.length} ` +
        `matches_out=${matches.length}\n`,
      );

      const now = new Date();
      const frequencyDays = subscription.monitor_frequency === 'weekly' ? 7
        : subscription.monitor_frequency === 'biweekly' ? 14 : 1;
      const nextRun = new Date(now.getTime() + frequencyDays * 24 * 60 * 60 * 1000);

      const payload: NotificationPayload = {
        subscriber: {
          name: subscription.subscriber_name,
          email: subscription.subscriber_email,
        },
        date: now.toISOString().slice(0, 10),
        matches,
        total_matches: matches.length,
        companies_discovered: new Set(matches.map(m => m.job_posting.company)).size,
        next_notification_date: nextRun.toISOString().slice(0, 10),
      };

      const sendResult = await sendNotification(subscription, payload, {
        exa_calls: 0,
        clay_calls: rawResults.length,
        cost_usd: 0,
        companies_found: payload.companies_discovered,
        postings_found: matches.length,
      });

      try {
        await updateSubscription(subscriptionId, {
          last_notification_at: now.toISOString(),
          last_run_at: now.toISOString(),
          total_matches_found: subscription.total_matches_found + matches.length,
        });
      } catch (updateErr) {
        process.stderr.write(
          `  [clay-results] subscription update skipped (streaming buffer): ` +
          `${updateErr instanceof Error ? updateErr.message : updateErr}\n`,
        );
      }

      if (sendResult.status === 'sent' && subscription.stripe_subscription_id && matches.length > 0) {
        await recordSignalUsage(subscription.stripe_subscription_id, matches.length);
      }

      await writeAuditLog({
        product_type: 'signal',
        event_type: 'clay_results_processed',
        entity_id: subscriptionId,
        client_email: subscription.subscriber_email,
        amount_cents: 0,
        currency: 'usd',
        metadata: {
          rows_in: rawResults.length,
          matches_out: matches.length,
          channels: subscription.notification_channels,
          send_status: sendResult.status,
          send_error: sendResult.error,
        },
      });

      res.status(200).json({
        received: true,
        subscription_id: subscriptionId,
        rows_received: rawResults.length,
        matches_processed: matches.length,
        notification_status: sendResult.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Clay results webhook error: ${message}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  // ─── Clay Webhook (form submission → BigQuery + Slack invite) ────────────────

  router.post('/clay', async (req: Request, res: Response) => {
    try {
      const secret = process.env.CLAY_WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers['x-clay-secret'];
        if (provided !== secret) {
          res.status(401).json({ error: true, message: 'Invalid webhook secret' });
          return;
        }
      }

      const body = req.body as Record<string, unknown>;
      const email = body.email ? String(body.email).toLowerCase().trim() : null;
      if (!email) {
        res.status(400).json({ error: true, message: 'Missing required field: email' });
        return;
      }

      const name = body.name ? String(body.name) : null;
      const department = body.department ? String(body.department) : null;
      const company = body.company ? String(body.company) : null;

      const bq = getBqClient();
      const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';

      await bq.dataset(dataset).table('opportunity_subscriptions').insert([{
        subscription_id: randomUUID(),
        subscriber_email: email,
        subscriber_name: name ?? email.split('@')[0],
        plan: 'starter',
        status: 'active',
        payment_status: 'pending',
        notification_channels: ['slack'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }]);

      process.stderr.write(`[clay-webhook] User added to opportunity_subscriptions: ${email}\n`);

      await sendSlackInvite(email, null);

      res.status(200).json({ success: true, message: 'User added and invite sent', email });
    } catch (err) {
      process.stderr.write(`[clay-webhook] Error: ${err instanceof Error ? err.message : err}\n`);
      res.status(500).json({ error: true, message: 'Internal server error' });
    }
  });

  return router;
}