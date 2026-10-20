/**
 * @togari/transports/slack — Block Kit builders + dispatch for the
 * confirmation-gated writes (send_email, transfer_deal, new_deal dedupe).
 *
 * Routes through the existing /slack/interactivity endpoint in
 * src/server.ts — action_ids matched in handleTogariConfirmAction below.
 *
 * Mirrors the smartlead-responder pattern (slack-actions.ts) for
 * familiarity; deliberately does NOT reinvent reactions.
 */

import { createLogger } from '../../observability/logger';
import { sendEmail as gmailSendEmail } from '../../core/tools/email-ops';
import { searchDeal, updateDeal, createDeal } from '../../core/tools/deal-ops';
import { resolveReminderOwner } from '../../core/identity/mention-resolver';
import { isInactiveOperator } from '../../core/identity/mention-resolver';
import { postTextReply } from './responder';

const logger = createLogger('slack/confirm-actions');

// ── Action IDs (kept in one place so server.ts router can match) ──

export const TOGARI_CONFIRM_ACTION_IDS = [
  'togari_confirm_send_email',
  'togari_cancel_send_email',
  'togari_confirm_transfer_deal',
  'togari_cancel_transfer_deal',
  'togari_confirm_new_deal_dedupe',
  'togari_cancel_new_deal_dedupe',
  // Coalesced multi-action confirm: posted when a single assistant turn
  // produces ≥2 confirmable writes of the same kind. The action_id
  // suffix matches the per-kind action (send_email / transfer_deal /
  // new_deal_dedupe) so the dispatcher can dispatch each remaining row.
  'togari_confirm_all_send_email',
  'togari_cancel_all_send_email',
  'togari_drop_one_send_email',
  'togari_confirm_all_transfer_deal',
  'togari_cancel_all_transfer_deal',
  'togari_drop_one_transfer_deal',
  'togari_confirm_all_new_deal_dedupe',
  'togari_cancel_all_new_deal_dedupe',
  'togari_drop_one_new_deal_dedupe',
] as const;

export type TogariConfirmActionId = (typeof TOGARI_CONFIRM_ACTION_IDS)[number];

export function isTogariConfirmActionId(actionId: string): actionId is TogariConfirmActionId {
  return (TOGARI_CONFIRM_ACTION_IDS as readonly string[]).includes(actionId);
}

// ── Block builders ────────────────────────────────────────────────

interface SendEmailConfirmValue {
  to: string;
  subject: string;
  body: string;
  in_reply_to?: string;
}

/**
 * Build the Block Kit message that presents an outbound email for
 * confirmation. Mirrors the smartlead `postReviewThread` shape with
 * Togari-prefixed action ids.
 */
export function buildSendEmailConfirmBlocks(v: SendEmailConfirmValue): any[] {
  const payload = JSON.stringify(v);
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ':envelope_with_arrow: *Confirm send:*' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*To:* ${v.to}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Subject:* ${v.subject}` } },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: v.body
          .split('\n')
          .map((line) => `>${line}`)
          .join('\n')
          .slice(0, 2900),
      },
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':rocket: Send', emoji: true },
          action_id: 'togari_confirm_send_email',
          style: 'primary',
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Cancel', emoji: true },
          action_id: 'togari_cancel_send_email',
          value: '{}',
        },
      ],
    },
  ];
}

interface TransferDealConfirmValue {
  company: string;
  new_owner_token: string; // The free-text owner name as the LLM extracted it
  notes?: string;
}

export function buildTransferDealConfirmBlocks(v: TransferDealConfirmValue): any[] {
  const payload = JSON.stringify(v);
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `:handshake: *Confirm transfer:* ${v.company} → *${v.new_owner_token}*` } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':white_check_mark: Confirm', emoji: true },
          action_id: 'togari_confirm_transfer_deal',
          style: 'primary',
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Cancel', emoji: true },
          action_id: 'togari_cancel_transfer_deal',
          value: '{}',
        },
      ],
    },
  ];
}

interface NewDealDedupeConfirmValue {
  company: string;
  contact_name?: string;
  contact_email?: string;
  value?: number;
  stage?: string;
  pipeline?: string;
  client_brand?: string;
  notes?: string;
  existing_deal_id?: string;
  existing_stage?: string;
  force?: boolean;
}

export function buildNewDealDedupeConfirmBlocks(v: NewDealDedupeConfirmValue, dedupeMessage: string): any[] {
  const payload = JSON.stringify({ ...v, force: true });
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `:warning: *Possible duplicate deal:* ${dedupeMessage}` } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':new: Create anyway', emoji: true },
          action_id: 'togari_confirm_new_deal_dedupe',
          style: 'primary',
          value: payload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Cancel', emoji: true },
          action_id: 'togari_cancel_new_deal_dedupe',
          value: '{}',
        },
      ],
    },
  ];
}

// ── Action dispatcher (called by /slack/interactivity router) ────

interface InteractivityPayload {
  user?: { id?: string; username?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
}

/**
 * Replace the original Block Kit message via response_url. Trusted to
 * fail quietly — the only consequence is a stale-looking message.
 */
async function replaceMessage(responseUrl: string, blocks: any[]): Promise<void> {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_original: true, blocks }),
    });
  } catch (err) {
    logger.warn('replaceMessage failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function statusBlock(text: string): any[] {
  return [{ type: 'context', elements: [{ type: 'mrkdwn', text }] }];
}

function nowET(): string {
  return new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET';
}

/**
 * Main entry: handle a Togari-confirm button click. Called from
 * src/server.ts /slack/interactivity router. Returns nothing — drives
 * Slack updates via response_url and posts thread replies via the bot
 * token.
 */
export async function handleTogariConfirmAction(payload: InteractivityPayload): Promise<void> {
  const action = payload?.actions?.[0];
  if (!action) return;
  const actionId = action.action_id ?? '';
  const responseUrl = payload.response_url ?? '';
  const username = payload.user?.username ?? 'unknown';
  const channelId = payload.channel?.id ?? '';
  const threadTs = payload.message?.thread_ts ?? payload.message?.ts ?? '';

  let value: Record<string, any> = {};
  try {
    value = JSON.parse(action.value ?? '{}');
  } catch {
    /* ignore */
  }

  try {
    switch (actionId) {
      case 'togari_confirm_send_email': {
        const v = value as SendEmailConfirmValue;
        await gmailSendEmail({ to: v.to, subject: v.subject, body: v.body, inReplyTo: v.in_reply_to });
        await replaceMessage(responseUrl, statusBlock(`:white_check_mark: Sent to ${v.to} by @${username} at ${nowET()}`));
        if (channelId && threadTs) {
          await postTextReply(channelId, threadTs, `:white_check_mark: Email sent to ${v.to}`);
        }
        break;
      }
      case 'togari_cancel_send_email': {
        await replaceMessage(responseUrl, statusBlock(`:x: Send cancelled by @${username}`));
        break;
      }
      case 'togari_confirm_transfer_deal': {
        const v = value as TransferDealConfirmValue;
        const sender = (payload.user?.id ?? '') || '';
        const owner = await resolveReminderOwner({
          token: v.new_owner_token,
          senderSlackUserId: sender,
        });
        if (owner.status !== 'resolved' || !owner.ownerSlackUserId) {
          await replaceMessage(
            responseUrl,
            statusBlock(`:warning: Could not resolve owner "${v.new_owner_token}" — transfer not applied.`),
          );
          break;
        }
        if (isInactiveOperator(owner.ownerSlackUserId)) {
          await replaceMessage(
            responseUrl,
            statusBlock(`:warning: <@${owner.ownerSlackUserId}> is on the inactive list — transfer not applied.`),
          );
          break;
        }
        const existing = await searchDeal(v.company);
        if (!existing) {
          await replaceMessage(
            responseUrl,
            statusBlock(`:warning: No deal found for ${v.company} — transfer not applied.`),
          );
          break;
        }
        await updateDeal(existing.deal_id, {
          owner: owner.ownerSlackUserId,
          notes: `Transferred ownership to <@${owner.ownerSlackUserId}> (${v.new_owner_token})${v.notes ? ` — ${v.notes}` : ''}`,
        });
        await replaceMessage(
          responseUrl,
          statusBlock(`:white_check_mark: ${v.company} transferred to <@${owner.ownerSlackUserId}> by @${username} at ${nowET()}`),
        );
        break;
      }
      case 'togari_cancel_transfer_deal': {
        await replaceMessage(responseUrl, statusBlock(`:x: Transfer cancelled by @${username}`));
        break;
      }
      case 'togari_confirm_new_deal_dedupe': {
        const v = value as NewDealDedupeConfirmValue;
        const { deal } = await createDeal({
          company: v.company,
          contactName: v.contact_name,
          contactEmail: v.contact_email,
          value: v.value,
          stage: v.stage,
          pipeline: v.pipeline,
          clientBrand: v.client_brand as any,
          senderSlackUserId: payload.user?.id ?? undefined,
          notes: v.notes,
        });
        await replaceMessage(
          responseUrl,
          statusBlock(`:new: Created deal for ${deal.company} (${deal.deal_id}) by @${username} at ${nowET()}`),
        );
        break;
      }
      case 'togari_cancel_new_deal_dedupe': {
        await replaceMessage(responseUrl, statusBlock(`:x: Deal creation cancelled by @${username}`));
        break;
      }
      // ── Coalesced multi-action handlers ─────────────────────────
      case 'togari_confirm_all_send_email':
      case 'togari_confirm_all_transfer_deal':
      case 'togari_confirm_all_new_deal_dedupe':
        await handleConfirmAll(actionId, value, payload, responseUrl, username);
        break;
      case 'togari_cancel_all_send_email':
      case 'togari_cancel_all_transfer_deal':
      case 'togari_cancel_all_new_deal_dedupe':
        await replaceMessage(responseUrl, statusBlock(`:x: All actions cancelled by @${username}`));
        break;
      case 'togari_drop_one_send_email':
      case 'togari_drop_one_transfer_deal':
      case 'togari_drop_one_new_deal_dedupe':
        await handleDropOne(actionId, value, responseUrl);
        break;
      default:
        logger.warn('Unknown togari confirm action', { actionId });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('handleTogariConfirmAction failed', err instanceof Error ? err : new Error(msg), { actionId });
    await replaceMessage(responseUrl, statusBlock(`:warning: Action failed: ${msg}`));
  }
}

// ── Coalesced multi-action card ──────────────────────────────────
//
// When the tool-use runner emits ≥2 confirmable side-effects of the same
// kind in a single assistant turn (typical for "send invoice + tap Tyler
// + review Tuesday" or 5-person reminder pastes), we render them as one
// Block Kit message with per-row drop buttons and a global Confirm/Cancel
// pair. State is encoded in each button's `value` payload (Slack action
// handlers are stateless); the rendered list is the source of truth.

const COALESCE_THRESHOLD = 2;

/**
 * Slack `value` strings are capped at 2000 chars. Past ~5 rows of email
 * payload we risk overflow, so the flush loop should fall back to
 * individual cards. Conservative — easy to raise later.
 */
const COALESCE_MAX_ROWS = 5;

type CoalesceKind = 'send_email' | 'transfer_deal' | 'new_deal_dedupe';

interface CoalescedRow {
  payload: Record<string, unknown>;
  label: string;        // Human-readable row description ("To: jane@x.com — Welcome")
}

interface CoalescedState {
  kind: CoalesceKind;
  rows: CoalescedRow[];
}

/**
 * True iff the flush loop should coalesce this many items of this kind
 * into a single card (vs. posting one card per item).
 */
export function shouldCoalesce(count: number): boolean {
  return count >= COALESCE_THRESHOLD && count <= COALESCE_MAX_ROWS;
}

function kindHeader(kind: CoalesceKind, count: number): string {
  switch (kind) {
    case 'send_email':
      return `:envelope_with_arrow: *Confirm ${count} email sends:*`;
    case 'transfer_deal':
      return `:handshake: *Confirm ${count} deal transfers:*`;
    case 'new_deal_dedupe':
      return `:warning: *Confirm ${count} new deals (possible duplicates):*`;
  }
}

function describeRow(kind: CoalesceKind, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'send_email': {
      const to = String(payload.to ?? '?');
      const subj = String(payload.subject ?? '(no subject)').slice(0, 80);
      return `*To:* ${to} — _${subj}_`;
    }
    case 'transfer_deal': {
      const company = String(payload.company ?? '?');
      const owner = String(payload.new_owner_token ?? '?');
      return `${company} → *${owner}*`;
    }
    case 'new_deal_dedupe': {
      const company = String(payload.company ?? '?');
      const existing = payload.existing_deal_id ? ` (similar to ${String(payload.existing_deal_id)})` : '';
      return `*${company}*${existing}`;
    }
  }
}

/**
 * Build the coalesced multi-row Block Kit message. Encodes the full
 * remaining row list in every button's `value` so handlers can re-render
 * after a per-row drop without backing storage.
 */
export function buildCoalescedConfirmBlocks(state: CoalescedState): any[] {
  const stateJson = JSON.stringify(state);
  const blocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text: kindHeader(state.kind, state.rows.length) } },
    { type: 'divider' },
  ];

  state.rows.forEach((row, idx) => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: describeRow(state.kind, row.payload) },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: ':x:', emoji: true },
        action_id: `togari_drop_one_${state.kind}`,
        value: JSON.stringify({ state, drop_index: idx }),
      },
    });
  });

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: `:white_check_mark: Confirm all (${state.rows.length})`, emoji: true },
        action_id: `togari_confirm_all_${state.kind}`,
        style: 'primary',
        value: stateJson,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':x: Cancel all', emoji: true },
        action_id: `togari_cancel_all_${state.kind}`,
        value: stateJson,
      },
    ],
  });

  return blocks;
}

function kindFromActionId(actionId: string): CoalesceKind | null {
  if (actionId.endsWith('_send_email')) return 'send_email';
  if (actionId.endsWith('_transfer_deal')) return 'transfer_deal';
  if (actionId.endsWith('_new_deal_dedupe')) return 'new_deal_dedupe';
  return null;
}

/**
 * Confirm-all handler: iterates the remaining rows and dispatches each
 * via the single-action handler. Results are summarized inline.
 */
async function handleConfirmAll(
  actionId: string,
  value: Record<string, any>,
  payload: InteractivityPayload,
  responseUrl: string,
  username: string,
): Promise<void> {
  const kind = kindFromActionId(actionId);
  if (!kind) {
    await replaceMessage(responseUrl, statusBlock(`:warning: Unknown coalesced action: ${actionId}`));
    return;
  }
  const state = value as CoalescedState;
  const rows = state.rows ?? [];
  if (rows.length === 0) {
    await replaceMessage(responseUrl, statusBlock(`:white_check_mark: Nothing to confirm.`));
    return;
  }

  // Dispatch each row by synthesizing a single-action payload and
  // reusing the per-row case below. We swallow errors per-row so one
  // bad row doesn't kill the rest.
  const results: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowPayload = rows[i].payload;
    try {
      await dispatchSingleRow(kind, rowPayload, payload);
      results.push(`:white_check_mark: ${describeRow(kind, rowPayload)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`:warning: ${describeRow(kind, rowPayload)} — ${msg}`);
    }
  }

  await replaceMessage(responseUrl, statusBlock(
    `*All ${rows.length} actions applied by @${username} at ${nowET()}:*\n${results.join('\n')}`,
  ));
}

/**
 * Drop-one handler: re-renders the card with the indicated row removed.
 * Slack's `replace_original: true` updates the message in place.
 */
async function handleDropOne(
  actionId: string,
  value: Record<string, any>,
  responseUrl: string,
): Promise<void> {
  const kind = kindFromActionId(actionId);
  if (!kind) return;
  const state = value.state as CoalescedState | undefined;
  const dropIndex = typeof value.drop_index === 'number' ? value.drop_index : -1;
  if (!state || dropIndex < 0 || dropIndex >= state.rows.length) {
    return;
  }
  const newRows = state.rows.filter((_, i) => i !== dropIndex);
  if (newRows.length === 0) {
    await replaceMessage(responseUrl, statusBlock(`:x: All rows dropped — nothing to confirm.`));
    return;
  }
  if (newRows.length === 1) {
    // Below threshold — render as single-action card. Keep the dispatch
    // path consistent: emit a new coalesced card with one row instead.
    // (User can still click Confirm-all on a one-row card.)
  }
  const newState: CoalescedState = { kind, rows: newRows };
  await replaceMessage(responseUrl, buildCoalescedConfirmBlocks(newState));
}

/**
 * Dispatch a single row through the existing per-kind handler. Reuses
 * `gmailSendEmail`, `searchDeal/updateDeal`, and `createDeal` directly so
 * behavior matches the single-action card.
 */
async function dispatchSingleRow(
  kind: CoalesceKind,
  rowPayload: Record<string, unknown>,
  payload: InteractivityPayload,
): Promise<void> {
  switch (kind) {
    case 'send_email': {
      const v = rowPayload as unknown as SendEmailConfirmValue;
      await gmailSendEmail({ to: v.to, subject: v.subject, body: v.body, inReplyTo: v.in_reply_to });
      return;
    }
    case 'transfer_deal': {
      const v = rowPayload as unknown as TransferDealConfirmValue;
      const sender = payload.user?.id ?? '';
      const owner = await resolveReminderOwner({
        token: v.new_owner_token,
        senderSlackUserId: sender,
      });
      if (owner.status !== 'resolved' || !owner.ownerSlackUserId) {
        throw new Error(`could not resolve owner "${v.new_owner_token}"`);
      }
      if (isInactiveOperator(owner.ownerSlackUserId)) {
        throw new Error(`<@${owner.ownerSlackUserId}> is inactive`);
      }
      const existing = await searchDeal(v.company);
      if (!existing) {
        throw new Error(`no deal found for ${v.company}`);
      }
      await updateDeal(existing.deal_id, {
        owner: owner.ownerSlackUserId,
        notes: `Transferred ownership to <@${owner.ownerSlackUserId}> (${v.new_owner_token})${v.notes ? ` — ${v.notes}` : ''}`,
      });
      return;
    }
    case 'new_deal_dedupe': {
      const v = rowPayload as unknown as NewDealDedupeConfirmValue;
      await createDeal({
        company: v.company,
        contactName: v.contact_name,
        contactEmail: v.contact_email,
        value: v.value,
        stage: v.stage,
        pipeline: v.pipeline,
        clientBrand: v.client_brand as any,
        senderSlackUserId: payload.user?.id ?? undefined,
        notes: v.notes,
      });
      return;
    }
  }
}
