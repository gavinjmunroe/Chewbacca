/**
 * Amber Integration — Story
 *
 * Pushes social + emotional health signals to Amber whenever:
 *   - A story prompt is completed (reflection done, circle engaged)
 *   - A circle interaction occurs (comment, reaction, share)
 *   - A weekly reflection is submitted
 *
 * Amber maps Story → "social" + "emotional" health dimensions.
 *
 * Usage:
 *   import { pushAmberSignal } from '@/lib/amber'
 *   await pushAmberSignal(amberUserId, { type: 'prompt_completed', ... })
 */

const AMBER_API_URL = process.env.AMBER_API_URL ?? 'https://api.amber.health';
const AMBER_WEBHOOK_SECRET = process.env.AMBER_WEBHOOK_SECRET;

export type PromptCompletedSignal = {
  type: 'prompt_completed';
  promptCategory: 'gratitude' | 'reflection' | 'memory' | 'connection' | 'goal';
  wordCount: number;
  sharedWithCircle: boolean;
  emotionTags?: string[];
  sentimentScore?: number; // -1 to 1
};

export type CircleInteractionSignal = {
  type: 'circle_interaction';
  interactionType: 'comment' | 'reaction' | 'share' | 'new_member' | 'story_read';
  circleSize: number;
  activeCircleMembers: number;
  weeklyInteractions: number;
};

export type WeeklyReflectionSignal = {
  type: 'weekly_reflection';
  promptsCompleted: number;
  promptsSkipped: number;
  circleEngagements: number;
  positiveMomentsLogged: number;
  gratitudeStreak: number;
  overallSentiment: 'positive' | 'neutral' | 'negative';
};

export type AmberStorySignal =
  | PromptCompletedSignal
  | CircleInteractionSignal
  | WeeklyReflectionSignal;

/**
 * Push a Story signal to Amber for the given Amber user ID.
 * Non-blocking — errors are logged but never thrown.
 */
export async function pushAmberSignal(
  amberUserId: string | number,
  signal: AmberStorySignal
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Amber-User-Id': String(amberUserId),
    };
    if (AMBER_WEBHOOK_SECRET) {
      headers['X-Amber-Webhook-Secret'] = AMBER_WEBHOOK_SECRET;
    }

    const res = await fetch(`${AMBER_API_URL}/integrations/story/signal`, {
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
