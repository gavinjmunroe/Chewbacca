/**
 * @togari/core — Model router
 *
 * Chooses which Claude model to use for a given message type and
 * complexity. Phase 1 scope: return SONNET for everything; provide a
 * `selectModel()` call site so Step 5 (Phase 2/3 seams) can swap in
 * cheaper/faster models for low-complexity intents (e.g. conversation →
 * Haiku).
 *
 * Callers should use `selectModel()` instead of hardcoding the model id.
 */

import { SONNET } from '../../config/models';

export type MessageType =
  | 'conversation'
  | 'intent_classify'
  | 'sql_generate'
  | 'transcript_resolve'
  | 'proposal'
  | 'meeting_analyze'
  | 'email_draft'
  | 'smartlead_reply'
  | 'query_format'
  | 'other';

export type Complexity = 'low' | 'medium' | 'high';

/** Phase 1: every call returns the current default. */
export const DEFAULT_MODEL = SONNET;

/**
 * Select the Claude model id to use for a given message.
 *
 * Phase 1: returns DEFAULT_MODEL for all combinations so behavior is
 * identical to pre-refactor. Phase 2+ can route low-complexity chat to
 * Haiku (claude-haiku-4-5-20251001), high-complexity proposals to Opus,
 * etc. — without any call-site changes.
 */
export function selectModel(_type: MessageType, _complexity: Complexity = 'medium'): string {
  return DEFAULT_MODEL;
}
