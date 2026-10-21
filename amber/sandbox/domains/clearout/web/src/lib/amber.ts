/**
 * Amber Integration — ClearOut
 *
 * Pushes social + emotional health signals to Amber whenever:
 *   - Email/Slack inbox is analyzed (volume, tone, stress load)
 *   - A contact interaction is logged (thread resolved, ghost detected)
 *   - Communication patterns are computed (response time, reciprocity)
 *
 * Amber maps ClearOut → "social" + "emotional" health dimensions.
 *
 * Usage:
 *   import { pushAmberSignal } from '@/lib/amber'
 *   await pushAmberSignal(amberUserId, { type: 'inbox_analysis', ... })
 */

const AMBER_API_URL = process.env.AMBER_API_URL ?? 'https://api.amber.health';
const AMBER_WEBHOOK_SECRET = process.env.AMBER_WEBHOOK_SECRET;

export type InboxAnalysisSignal = {
  type: 'inbox_analysis';
  channel: 'email' | 'slack';
  unreadCount: number;
  urgentCount: number;
  avgResponseTimeHours: number;
  toneNegativePercent: number;
  tonePositivePercent: number;
  burnoutIndicators: string[];
};

export type ContactInteractionSignal = {
  type: 'contact_interaction';
  contactId: string;
  interactionType: 'thread_resolved' | 'ghost_detected' | 'reconnected' | 'new_connection';
  daysSinceLastContact?: number;
  relationshipScore?: number;
};

export type CommunicationPatternSignal = {
  type: 'communication_pattern';
  weeklyMessagesSent: number;
  weeklyMessagesReceived: number;
  reciprocityRatio: number;
  uniqueConnectionsActive: number;
  longestSilenceDays: number;
  streakDays: number;
};

export type AmberClearOutSignal =
  | InboxAnalysisSignal
  | ContactInteractionSignal
  | CommunicationPatternSignal;

/**
 * Push a ClearOut signal to Amber for the given Amber user ID.
 * Non-blocking — errors are logged but never thrown.
 */
export async function pushAmberSignal(
  amberUserId: string | number,
  signal: AmberClearOutSignal
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Amber-User-Id': String(amberUserId),
    };
    if (AMBER_WEBHOOK_SECRET) {
      headers['X-Amber-Webhook-Secret'] = AMBER_WEBHOOK_SECRET;
    }

    const res = await fetch(`${AMBER_API_URL}/integrations/clearout/signal`, {
      method: 'POST',
      headers,
      body: JSON.stringify(signal),
    });

    if (!res.ok) {
      console.warn('[amber] signal push failed:', res.status, await res.text());
    }
  } catch (err) {
    console.warn('[amber] signal push error:', err);
  }
}
