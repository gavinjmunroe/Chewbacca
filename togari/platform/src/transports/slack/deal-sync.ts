/**
 * @togari/transports/slack — Deal sync (thin wrapper)
 *
 * Consumes `core/tools/deal-ops` for all BigQuery deal CRUD + activity
 * logging. This file only owns Slack-specific concerns: conflict
 * detection on `new_deal`, mapping `userId` → owner, threading the raw
 * Slack message text (including `<@U...>` mentions) into the notes
 * column so transport payload survives into BQ.
 */

import type { ParsedIntent } from '../../core/types';
import { searchDeal, createDeal, updateDeal, logActivity } from '../../core/tools/deal-ops';
import { createLogger } from '../../observability/logger';

const logger = createLogger('slack/deal-sync');

export interface DealSyncResult {
  operation: 'inserted' | 'updated' | 'activity_only' | 'conflict';
  deal_id: string | null;
  company: string | null;
  stage: string | null;
  pipeline: string | null;
  /** H — brand from the resolved deal (or null when no deal touched). */
  client_brand: string | null;
  value: number | null;
  notes: string | null;
  conflict_deal?: {
    deal_id: string;
    owner: string;
    stage: string;
  };
}

/**
 * Sync a parsed intent to BigQuery. Slack-transport-specific: raw
 * Slack message text flows into the notes column, `userId` is stamped
 * as the deal owner.
 */
export async function syncDeal(
  intent: ParsedIntent,
  userId: string,
  _channelId: string,
  rawText: string,
): Promise<DealSyncResult> {
  const company = intent.company ?? null;
  const contactName = intent.contactName ?? null;

  // ── new_deal ────────────────────────────────────────────────
  if (intent.intent === 'new_deal') {
    if (!company) {
      // Nothing to create — treat as activity
      await logActivity({
        contactName: contactName || undefined,
        type: 'new_deal_attempt_no_company',
        content: rawText,
      });
      return { operation: 'activity_only', deal_id: null, company: null, stage: null, pipeline: null, client_brand: null, value: null, notes: rawText };
    }

    const existing = await searchDeal(company, contactName || undefined);
    if (existing) {
      // Conflict — log an activity against the existing deal, return conflict.
      // This write is non-fatal: if BQ rejects it, we still want the user
      // to see the friendly "deal already exists" UX rather than a generic
      // ":warning: new_deal failed" surface. Every other logActivity /
      // create / update call in this file still propagates on failure.
      try {
        await logActivity({
          dealId: existing.deal_id,
          company: existing.company,
          type: 'new_deal_conflict',
          content: rawText,
        });
      } catch (err) {
        logger.warn('Conflict activity write failed (non-fatal)', { error: String(err) });
      }
      logger.info('new_deal conflict', { company, existingId: existing.deal_id });
      return {
        operation: 'conflict',
        deal_id: existing.deal_id,
        company: existing.company,
        stage: existing.stage,
        pipeline: existing.pipeline ?? null,
        client_brand: existing.client_brand ?? null,
        value: existing.value,
        notes: existing.notes ?? null,
        conflict_deal: {
          deal_id: existing.deal_id,
          owner: existing.owner,
          stage: existing.stage,
        },
      };
    }

    const { deal } = await createDeal({
      company,
      // Patch L — pass through the classifier-resolved company id when
      // present so createDeal can skip the lookup. Most messages still
      // arrive without it (the engine resolves by name), but if the
      // classifier has done the work, don't redo it.
      companyId: intent.companyId,
      contactName: contactName || undefined,
      contactEmail: intent.contactEmail,
      value: intent.dealValue,
      stage: intent.stage,
      pipeline: intent.pipeline,
      clientBrand: intent.clientBrand,
      // userId from a Slack event is already a Slack user ID — passing
      // it as the sender fallback also lets createDeal stamp it when no
      // owner name was extracted from the user's text.
      owner: userId,
      senderSlackUserId: userId,
      notes: rawText,
    });
    return {
      operation: 'inserted',
      deal_id: deal.deal_id,
      company: deal.company,
      stage: deal.stage,
      pipeline: deal.pipeline ?? null,
      client_brand: deal.client_brand ?? null,
      value: deal.value,
      notes: deal.notes ?? null,
    };
  }

  // ── update_deal ─────────────────────────────────────────────
  if (intent.intent === 'update_deal') {
    const existing = await searchDeal(company || undefined, contactName || undefined);
    if (!existing) {
      // No matching deal — log activity and return
      await logActivity({
        company: company || undefined,
        contactName: contactName || undefined,
        type: 'update_deal_no_match',
        content: rawText,
      });
      return { operation: 'activity_only', deal_id: null, company, stage: null, pipeline: null, client_brand: null, value: null, notes: rawText };
    }

    const updates: Record<string, any> = {};
    if (intent.stage) updates.stage = intent.stage;
    if (intent.pipeline) updates.pipeline = intent.pipeline;
    if (intent.clientBrand) updates.client_brand = intent.clientBrand;
    if (intent.dealValue !== undefined) updates.value = intent.dealValue;
    if (intent.contactName) updates.contact_full_name = intent.contactName;
    if (intent.contactEmail) updates.contact_email = intent.contactEmail;
    updates.notes = rawText;

    const { deal } = await updateDeal(existing.deal_id, updates);
    return {
      operation: 'updated',
      deal_id: deal.deal_id,
      company: deal.company,
      stage: deal.stage,
      pipeline: deal.pipeline ?? null,
      client_brand: deal.client_brand ?? null,
      value: deal.value,
      notes: deal.notes ?? null,
    };
  }

  // ── log_activity / schedule_meeting / fallthrough ──────────
  await logActivity({
    company: company || undefined,
    contactName: contactName || undefined,
    type: 'log_activity',
    content: rawText,
  });
  return {
    operation: 'activity_only',
    deal_id: null,
    company,
    stage: null,
    pipeline: null,
    client_brand: null,
    value: null,
    notes: rawText,
  };
}
