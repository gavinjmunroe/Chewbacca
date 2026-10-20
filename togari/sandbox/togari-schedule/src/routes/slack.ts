import { Router, Request, Response } from 'express';

// Internal workspace members added to every new client channel.
// Resolved to user IDs at runtime via users.lookupByEmail (requires users:read.email scope).
const INTERNAL_MEMBER_EMAILS = [
  'maggie@bluemodernadvisory.com',
  'sagar@bluemodernadvisory.com',
];

function sanitizePart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toFirstNameChannel(name: string): string {
  const first = sanitizePart(name.trim().split(/\s+/)[0]);
  return `${first}-job-postings`;
}

function toFullNameChannel(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = sanitizePart(parts[0]);
  const last = parts.length > 1 ? sanitizePart(parts[parts.length - 1]) : '';
  return last ? `${first}-${last}-job-postings` : `${first}-job-postings`;
}

export async function setupSlackClient(params: {
  email: string;
  subscriberName: string;
}): Promise<{ channel_id: string; channel_name: string; invite_url: string | null }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not set');

  async function slackPost(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  async function tryCreate(channelName: string): Promise<{ ok: boolean; id?: string; name?: string; error?: string }> {
    const data = await slackPost('conversations.create', { name: channelName, is_private: false });
    if (data.ok) {
      const ch = data.channel as Record<string, string>;
      return { ok: true, id: ch.id, name: ch.name };
    }
    return { ok: false, error: String(data.error) };
  }

  // Resolve internal member emails → user IDs (best-effort; failures are logged, not fatal)
  async function resolveInternalMemberIds(): Promise<string[]> {
    const ids: string[] = [];
    for (const memberEmail of INTERNAL_MEMBER_EMAILS) {
      try {
        const qs = new URLSearchParams({ email: memberEmail });
        const lookupRes = await fetch(`https://slack.com/api/users.lookupByEmail?${qs}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await lookupRes.json() as Record<string, unknown>;
        if (data.ok) {
          const userId = (data.user as Record<string, string>)?.id;
          if (userId) ids.push(userId);
        } else {
          process.stderr.write(`[slack-setup] could not resolve user ${memberEmail}: ${data.error}\n`);
        }
      } catch (err) {
        process.stderr.write(`[slack-setup] error resolving user ${memberEmail}: ${err instanceof Error ? err.message : err}\n`);
      }
    }
    return ids;
  }

  // Add internal workspace members to the channel (conversations.invite)
  async function addInternalMembers(channelId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const data = await slackPost('conversations.invite', { channel: channelId, users: userIds.join(',') });
    if (!data.ok) {
      // already_in_channel is harmless; log anything else
      if (data.error !== 'already_in_channel') {
        process.stderr.write(`[slack-setup] conversations.invite warning: ${data.error}\n`);
      }
    }
  }

  const firstName = toFirstNameChannel(params.subscriberName);
  const fullName = toFullNameChannel(params.subscriberName);

  // Resolve internal member IDs once, reused across attempts
  const internalUserIds = await resolveInternalMemberIds();

  // Helper: invite internal members + generate Slack Connect invite URL
  async function finalise(channelId: string, channelName: string): Promise<{ channel_id: string; channel_name: string; invite_url: string | null }> {
    await addInternalMembers(channelId, internalUserIds);
    const invite_url = await sendConnectInvite(channelId, channelName, slackPost);
    return { channel_id: channelId, channel_name: channelName, invite_url };
  }

  // Attempt 1: firstname-job-postings
  const attempt1 = await tryCreate(firstName);
  if (attempt1.ok) {
    return finalise(attempt1.id!, attempt1.name!);
  }
  if (attempt1.error !== 'name_taken') {
    throw new Error(`conversations.create failed: ${attempt1.error}`);
  }

  // Attempt 2: firstname-lastname-job-postings (only if different from attempt 1)
  if (fullName !== firstName) {
    const attempt2 = await tryCreate(fullName);
    if (attempt2.ok) {
      return finalise(attempt2.id!, attempt2.name!);
    }
    if (attempt2.error !== 'name_taken') {
      throw new Error(`conversations.create failed: ${attempt2.error}`);
    }
  }

  // Both taken — find the existing channel (prefer full name if we tried it)
  const preferredName = fullName !== firstName ? fullName : firstName;
  const listData = await slackPost('conversations.list', { exclude_archived: true, limit: 1000 }) as Record<string, unknown>;
  const channels = (listData.channels as Array<Record<string, string>>) ?? [];
  const existing = channels.find(c => c.name === preferredName) ?? channels.find(c => c.name === firstName);
  if (!existing) throw new Error(`Channel name taken but could not find existing channel: ${preferredName}`);

  return finalise(existing.id, existing.name);
}

async function sendConnectInvite(
  channelId: string,
  channelName: string,
  slackPost: (method: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<string | null> {
  const inviteData = await slackPost('conversations.inviteShared', {
    channel: channelId,
  });
  if (!inviteData.ok) {
    process.stderr.write(`[slack-setup] conversations.inviteShared warning: ${inviteData.error}\n`);
    return null;
  }
  const url = typeof inviteData.url === 'string' ? inviteData.url : null;
  process.stderr.write(`[slack-setup] channel=${channelName} (${channelId}) invite link ${url ? 'generated' : 'created (no URL returned)'}\n`);
  return url;
}

export function createSlackRouter(): Router {
  const router = Router();

  router.post('/setup-client', async (req: Request, res: Response) => {
    try {
      const secret = process.env.FRAMER_WEBHOOK_SECRET;
      if (secret) {
        const provided = req.headers['x-framer-secret'];
        if (provided !== secret) {
          res.status(401).json({ error: true, message: 'Invalid secret' });
          return;
        }
      }

      const { email, subscriber_name } = req.body as { email?: string; subscriber_name?: string };

      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: true, message: 'Missing required field: email' });
        return;
      }
      if (!subscriber_name || typeof subscriber_name !== 'string') {
        res.status(400).json({ error: true, message: 'Missing required field: subscriber_name' });
        return;
      }

      const result = await setupSlackClient({ email, subscriberName: subscriber_name });
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[slack-setup-client] error: ${message}\n`);
      res.status(500).json({ error: true, message });
    }
  });

  return router;
}
