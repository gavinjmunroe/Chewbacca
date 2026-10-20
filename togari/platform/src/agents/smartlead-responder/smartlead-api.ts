/**
 * @togari/admin — Smartlead API client
 *
 * Fetches message history (outbound + inbound) for a campaign lead
 * so the Claude drafter has full conversation context.
 */

import { createLogger } from '../../observability/logger';

const logger = createLogger('SmartleadAPI');

export interface MessageHistoryItem {
  type: 'SENT' | 'REPLY';
  subject: string;
  body: string;
  time: string;
}

export interface MessageHistory {
  originalOutbound: string | null;
  latestInbound: string | null;
  allMessages: MessageHistoryItem[];
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetch full message history for a campaign lead from the Smartlead API.
 * Returns the first outbound message and latest inbound reply.
 * On any error, returns nulls so the rest of the system can continue.
 */
export async function fetchMessageHistory(
  campaignId: number,
  leadId: number,
): Promise<MessageHistory> {
  const empty: MessageHistory = { originalOutbound: null, latestInbound: null, allMessages: [] };

  const apiKey = process.env.SMARTLEAD_API_KEY;
  if (!apiKey) {
    logger.warn('SMARTLEAD_API_KEY not set — skipping message history fetch');
    return empty;
  }

  if (!campaignId || !leadId) {
    logger.warn('Missing campaignId or leadId — skipping message history fetch', { campaignId, leadId });
    return empty;
  }

  const url = `https://server.smartlead.ai/api/v1/campaigns/${campaignId}/leads/${leadId}/message-history?api_key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      logger.warn('Smartlead message history API error', { status: res.status, body: errorBody, campaignId, leadId });
      return empty;
    }

    const data = await res.json() as any[];

    if (!Array.isArray(data) || data.length === 0) {
      logger.info('Smartlead returned empty message history', { campaignId, leadId });
      return empty;
    }

    const allMessages: MessageHistoryItem[] = data.map((msg: any) => ({
      type: (msg.type === 'SENT' ? 'SENT' : 'REPLY') as 'SENT' | 'REPLY',
      subject: msg.subject || '',
      body: stripHtml(msg.email_body || msg.body || ''),
      time: msg.time || msg.created_at || '',
    }));

    // Sort chronologically (earliest first)
    allMessages.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const firstSent = allMessages.find((m) => m.type === 'SENT');
    const replies = allMessages.filter((m) => m.type === 'REPLY');
    const lastReply = replies.length > 0 ? replies[replies.length - 1] : null;

    logger.info('Fetched Smartlead message history', {
      campaignId,
      leadId,
      totalMessages: allMessages.length,
      sentCount: allMessages.filter((m) => m.type === 'SENT').length,
      replyCount: replies.length,
    });

    return {
      originalOutbound: firstSent?.body || null,
      latestInbound: lastReply?.body || null,
      allMessages,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('Smartlead message history request timed out (10s)', { campaignId, leadId });
    } else {
      logger.warn('Smartlead message history fetch failed', {
        error: err instanceof Error ? err.message : String(err),
        campaignId,
        leadId,
      });
    }
    return empty;
  }
}
