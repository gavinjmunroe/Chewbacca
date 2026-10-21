/**
 * Amber Integration — Marrow
 *
 * Pushes social + financial health signals to Amber whenever:
 *   - A recruiting pipeline moves (org chart updated, candidate advanced)
 *   - A network connection is made (intro sent, referral landed)
 *   - An org snapshot is computed (headcount, growth, health)
 *
 * Amber maps Marrow → "social" + "financial" health dimensions.
 *
 * Usage:
 *   import { pushAmberSignal } from '@/lib/amber'
 *   await pushAmberSignal(amberUserId, { type: 'network_update', ... })
 */

const AMBER_API_URL = process.env.AMBER_API_URL ?? 'https://api.amber.health';
const AMBER_WEBHOOK_SECRET = process.env.AMBER_WEBHOOK_SECRET;

export type NetworkUpdateSignal = {
  type: 'network_update';
  newConnectionsThisWeek: number;
  introsGiven: number;
  introsReceived: number;
  warmLeadsActive: number;
  networkSize: number;
  networkGrowthRate: number;
};

export type RecruitingSignal = {
  type: 'recruiting_event';
  event: 'candidate_advanced' | 'offer_accepted' | 'offer_declined' | 'hire_made' | 'pipeline_stall';
  roleTitle?: string;
  pipelineStage?: string;
  timeToFillDays?: number;
};

export type OrgSnapshotSignal = {
  type: 'org_snapshot';
  headcount: number;
  openRoles: number;
  attritionRate: number;
  engagementScore?: number;
  revenuePerHead?: number;
};

export type AmberMarrowSignal =
  | NetworkUpdateSignal
  | RecruitingSignal
  | OrgSnapshotSignal;

/**
 * Push a Marrow signal to Amber for the given Amber user ID.
 * Non-blocking — errors are logged but never thrown.
 */
export async function pushAmberSignal(
  amberUserId: string | number,
  signal: AmberMarrowSignal
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Amber-User-Id': String(amberUserId),
    };
    if (AMBER_WEBHOOK_SECRET) {
      headers['X-Amber-Webhook-Secret'] = AMBER_WEBHOOK_SECRET;
    }

    const res = await fetch(`${AMBER_API_URL}/integrations/marrow/signal`, {
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
