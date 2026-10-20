/**
 * Slack Events API webhook handler.
 *
 * POST /webhooks/slack-events — handles url_verification and team_join events
 *
 * Mounted BEFORE express.json() in index.ts so it can read the raw body
 * for Slack HMAC-SHA256 request signature verification.
 */

import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';

// ─── BigQuery helpers (duplicated from webhooks.ts to keep this file self-contained) ──

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

// ─── Slack signature verification ─────────────────────────────────────────────

function verifySlackSignature(signingSecret: string, rawBody: string, timestamp: string, slackSig: string): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(baseString).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(slackSig));
  } catch {
    return false;
  }
}

// ─── Channel name generation ───────────────────────────────────────────────────

function toChannelName(fullName: string): string {
  return 'user-' + fullName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ─── Slack API helpers ─────────────────────────────────────────────────────────

async function slackPost(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not set');

  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(params),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function createSlackChannel(name: string): Promise<{ id: string; name: string } | null> {
  const data = await slackPost('conversations.create', { name, is_private: 'false' });
  if (data.ok) {
    const channel = data.channel as Record<string, string>;
    return { id: channel.id, name: channel.name };
  }
  if (data.error === 'name_taken') return null;
  throw new Error(`conversations.create failed: ${data.error}`);
}

async function inviteToChannel(channelId: string, userId: string): Promise<void> {
  const data = await slackPost('conversations.invite', { channel: channelId, users: userId });
  if (!data.ok && data.error !== 'already_in_channel') {
    process.stderr.write(`[slack-invite-channel] ${data.error}\n`);
  }
}

async function postWelcomeMessage(
  channelId: string,
  subscriberName: string,
  department: string | null,
  company: string | null,
): Promise<void> {
  const context = [department, company].filter(Boolean).join(' · ');
  const text = context
    ? `Welcome, ${subscriberName}! :wave: You've been added to this channel${context ? ` (${context})` : ''}. We'll share relevant opportunities and updates here.`
    : `Welcome, ${subscriberName}! :wave: You've been added to this channel. We'll share relevant opportunities and updates here.`;

  const data = await slackPost('chat.postMessage', { channel: channelId, text });
  if (!data.ok) {
    process.stderr.write(`[slack-welcome] chat.postMessage failed: ${data.error}\n`);
  }
}

// ─── team_join handler ─────────────────────────────────────────────────────────

async function handleTeamJoin(slackUser: Record<string, unknown>): Promise<void> {
  const userId = slackUser.id as string | undefined;
  const profile = (slackUser.profile ?? {}) as Record<string, string>;
  const email = profile.email;

  if (!email) {
    process.stderr.write(`[slack-join] team_join event missing email for user ${userId}\n`);
    return;
  }

  const bq = getBqClient();

  // Check if user is in opportunity_subscriptions
  const [rows] = await bq.query({
    query: `SELECT subscription_id, subscriber_name, plan FROM ${fqt('opportunity_subscriptions')} WHERE subscriber_email = @email LIMIT 1`,
    params: { email },
  });

  if (!rows || rows.length === 0) {
    process.stderr.write(`[slack-join-denied] Unauthorized join — not in subscriptions: ${email}\n`);
    return;
  }

  const row = rows[0] as Record<string, string | null>;
  const subscriberName = row.subscriber_name ?? email.split('@')[0];

  process.stderr.write(`[slack-join] Authorized user joined: ${email}\n`);

  // Try to create channel; retry with suffix on name_taken
  let channelId: string | null = null;
  let channelName = toChannelName(subscriberName);

  let channel = await createSlackChannel(channelName);
  if (!channel) {
    process.stderr.write(`[slack-channel-error] name_taken for ${channelName}, retrying with suffix\n`);
    channelName = channelName + '-2';
    channel = await createSlackChannel(channelName);
    if (!channel) {
      channelName = toChannelName(subscriberName) + '-' + randomUUID().slice(0, 6);
      channel = await createSlackChannel(channelName);
    }
  }

  if (!channel) {
    process.stderr.write(`[slack-channel-error] Failed to create channel for ${email} after retries\n`);
    return;
  }

  channelId = channel.id;
  process.stderr.write(`[slack-channel] Created #${channel.name} (${channelId}) for ${email}\n`);

  if (userId) {
    await inviteToChannel(channelId, userId);
  }

  await postWelcomeMessage(channelId, subscriberName, null, null);

  // Update opportunity_subscriptions with the slack channel and user ID
  try {
    const updates = [`slack_channel_id = '${channelId.replace(/'/g, '')}'`];
    if (userId) updates.push(`slack_user_id = '${userId.replace(/'/g, '')}'`);
    await bq.query({
      query: `UPDATE ${fqt('opportunity_subscriptions')} SET ${updates.join(', ')} WHERE subscriber_email = @email`,
      params: { email },
    });
  } catch (err) {
    process.stderr.write(`[slack-join] BQ update failed: ${err instanceof Error ? err.message : err}\n`);
  }
}

// ─── Router ────────────────────────────────────────────────────────────────────

export function createSlackEventsRouter(): Router {
  const router = Router();

  // Use raw body parsing so we can verify Slack's HMAC signature
  router.post('/slack-events', async (req: Request, res: Response) => {
    // req.body is a Buffer because this router is mounted before express.json()
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);

    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (signingSecret) {
      const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
      const slackSig = req.headers['x-slack-signature'] as string | undefined;

      if (!timestamp || !slackSig) {
        res.status(401).json({ error: 'Missing Slack signature headers' });
        return;
      }

      if (!verifySlackSignature(signingSecret, rawBody, timestamp, slackSig)) {
        res.status(401).json({ error: 'Invalid Slack signature' });
        return;
      }
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    // Slack URL verification handshake
    if (body.type === 'url_verification') {
      res.json({ challenge: body.challenge });
      return;
    }

    // Acknowledge immediately — Slack requires a fast 200
    res.status(200).end();

    if (body.type === 'event_callback') {
      const event = body.event as Record<string, unknown> | undefined;
      if (event?.type === 'team_join') {
        handleTeamJoin(event.user as Record<string, unknown>).catch((err) => {
          process.stderr.write(`[slack-join-error] ${err instanceof Error ? err.message : err}\n`);
        });
      }
    }
  });

  return router;
}
