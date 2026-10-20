/**
 * Test script — sends a welcome email directly via Gmail API.
 * Bypasses Stripe/subscription flow entirely.
 *
 * Usage:
 *   GMAIL_ACCESS_TOKEN=ya29.xxx node scripts/test-welcome-email.mjs
 *
 * Optional overrides:
 *   TO_EMAIL=you@example.com           (default: maggie@bluemodernadvisory.com)
 *   SUBSCRIBER_NAME="Maggie Chen"      (default: "Maggie Chen")
 *   SLACK_INVITE_URL=https://...       (default: '#' to keep button visible)
 *   SLACK_CHANNEL_NAME=maggie-job-postings  (default: none — shows "our Slack channel")
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ─── Token helper (refresh → access) ──────────────────────────────────────

async function getValidGmailToken() {
  const refresh = process.env.GMAIL_REFRESH_TOKEN;
  const id      = process.env.GMAIL_CLIENT_ID;
  const secret  = process.env.GMAIL_CLIENT_SECRET;

  if (refresh && id && secret) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id, client_secret: secret,
        refresh_token: refresh, grant_type: 'refresh_token',
      }),
    });
    const data = await res.json();
    if (res.ok && data.access_token) {
      console.log('✓ Got fresh access token via refresh token');
      return data.access_token;
    }
    console.error('Token refresh failed:', data);
    process.exit(1);
  }

  const token = process.env.GMAIL_ACCESS_TOKEN;
  if (!token) {
    console.error('ERROR: set GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET (recommended) or GMAIL_ACCESS_TOKEN.');
    process.exit(1);
  }
  return token;
}

const gmailToken = await getValidGmailToken();

// ─── Params ────────────────────────────────────────────────────────────────

const toEmail          = process.env.TO_EMAIL          || 'maggie@bluemodernadvisory.com';
const subscriberName   = process.env.SUBSCRIBER_NAME   || 'Maggie Chen';
const slackInviteUrl   = process.env.SLACK_INVITE_URL  || '#';  // '#' keeps button visible in tests
const slackChannelName = process.env.SLACK_CHANNEL_NAME || null;

const firstName = subscriberName.trim().split(/\s+/)[0];
const greeting  = `Hi ${firstName},`;

// ─── BMA logo — CID inline (works in Gmail), hosted URL fallback, else omit ─

let logoFileData = null;
try {
  logoFileData = readFileSync(join(__dirname, '..', 'public', 'assets', 'bma-logo.avif'));
  console.log('✓ BMA logo found — will embed as CID inline attachment');
} catch {
  console.log('  bma-logo.avif not found in public/assets/');
}

const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
const logoSrc = logoFileData ? 'cid:bma-logo' : appUrl ? `${appUrl}/assets/bma-logo.avif` : null;
const logoImg = logoSrc
  ? `<img src="${logoSrc}" alt="Blue Modern Advisory" width="130" height="130" style="display:block;" />`
  : '';

if (logoSrc === 'cid:bma-logo') console.log('✓ Logo: CID inline');
else if (logoSrc) console.log(`✓ Logo: hosted URL ${logoSrc}`);
else console.log('  Logo omitted (no file and no APP_URL)');

// ─── Slack button ──────────────────────────────────────────────────────────
// Channel name in button label — Gmail strips all inline SVGs

const derivedChannel = slackChannelName ?? `${firstName.toLowerCase()}-job-postings`;
const slackChannelLabel = `#${derivedChannel}`;
const slackButton = `<table cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr>
      <td>
        <a href="${slackInviteUrl}" style="text-decoration:none;">
          <table cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;background-color:#1C5099;">
            <tr>
              <td style="padding:13px 24px;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:#ffffff;white-space:nowrap;letter-spacing:0.2px;">Join ${slackChannelLabel}</td>
            </tr>
          </table>
        </a>
      </td>
    </tr>
  </table>`;

// ─── HTML body ─────────────────────────────────────────────────────────────

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

// ─── MIME construction ─────────────────────────────────────────────────────

const subject = `=?UTF-8?B?${Buffer.from("Welcome! You're all set.").toString('base64')}?=`;
const headers = [
  `From: Blue Modern Advisory <maggie@bluemodernadvisory.com>`,
  `To: ${toEmail}`,
  `Subject: ${subject}`,
  'MIME-Version: 1.0',
];

let rawMessage;
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
  console.log('✓ MIME: multipart/related with CID inline logo');
} else {
  rawMessage = [...headers, 'Content-Type: text/html; charset=utf-8', '', htmlBody].join('\r\n');
  console.log('  MIME: plain text/html (no logo file)');
}

const encoded = Buffer.from(rawMessage).toString('base64url');

// ─── Send ──────────────────────────────────────────────────────────────────

console.log(`Sending welcome email to ${toEmail}...`);

const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${gmailToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ raw: encoded }),
});

const result = await resp.json();

if (resp.ok) {
  console.log(`✓ Email sent! Message ID: ${result.id}`);
} else {
  console.error(`✗ Failed (${resp.status}):`, JSON.stringify(result, null, 2));
  process.exit(1);
}
