/**
 * Rave Master orchestrator (v1, Sagar-only, EDC 2026).
 *
 * Single entry point: `handleRaveInbound`. Called from agent.js for
 * every inbound message after the existing pre-LLM filters (SAFE
 * keyword, substance redirect, vCard share, first-contact greeting,
 * crisis detection) have run. Returns `{ handled: bool }`:
 *
 *   - handled=true  → caller stops processing; we already replied
 *                     (and/or notified Sagar / drafted for approval).
 *   - handled=false → caller continues into the normal LLM path.
 *
 * Tenant isolation: every read/write is scoped via `tenant` (sbGet,
 * sbUpsert, ingestToAmberID, sendMessage). The gate refuses to do
 * anything unless `isRaveMasterEnabledForTenant(tenant)` is true.
 *
 * Idempotency: relies on the existing transport idempotency window
 * (lib/transport.js) and the ingest-key dedupe (lib/amber-id-ingest.js).
 * We deliberately do not add a second layer here.
 */

import { sendMessage as defaultSendMessage } from "../transport.js";
import { humanize } from "../voice-guard.js";
import { normalizeHandle } from "../permissions.js";
import {
  isRaveMasterEnabledForTenant,
  eventIdForTenant,
} from "./event-config.js";
import { classifyEventMessage } from "./classifier.js";
import {
  loadEventCard as defaultLoadEventCard,
  saveEventCard as defaultSaveEventCard,
  applyClassificationToCard,
  updateTrustedHandles,
  queueGroupDraft,
  popLatestGroupDraft,
} from "./event-card.js";
import { isTrustedForEvent, parseRaveAdminCommand } from "./trust.js";
import {
  buildLatestPlanReply,
  buildUnknownSenderReply,
  buildSagarNotifyTrustedReply,
  buildSagarNotifyUnknown,
  buildGroupUpdateDraft,
  maskHandle,
} from "./drafts.js";
import { refuseProcurementDraft } from "./guardrails.js";
import { storeRaveInbound as defaultStoreRaveInbound } from "./ingest.js";

/**
 * Notify Sagar via a direct iMessage. The tenant's own `phoneNumber`
 * is Sagar's number; sending to that handle with `tenant.loopSenderId`
 * lands as a Samber→Sagar DM. Falls through silently if no phone.
 */
async function notifySagar(deps, tenant, body) {
  if (!tenant?.phoneNumber || !body) return;
  try {
    await deps.sendMessage(tenant.phoneNumber, body, {
      tenant,
      auditOrigin: "rave-master",
      // tenant.phoneNumber === Sagar's own phone for the Samber tenant,
      // so this lands as match_owner=true in the outbound audit.
      // Sagar gets a fresh thread each time so notifications can stack
      // without a reply-to thread collapsing them. Idempotency in the
      // transport still deduplicates exact repeats within 60 s.
    });
  } catch (err) {
    console.warn("[rave-master] notifySagar failed:", err.message);
  }
}

async function handleAdminCommand({
  deps,
  tenant,
  text,
  sendOpts,
  fromHandle,
}) {
  const cmd = parseRaveAdminCommand(text);
  if (!cmd) return null;

  const card = await deps.loadEventCard(tenant);

  if (cmd.cmd === "trust" || cmd.cmd === "untrust") {
    if (!cmd.handles || cmd.handles.length === 0) {
      await deps.sendMessage(
        fromHandle,
        humanize(`Usage: RAVE: ${cmd.cmd} +1XXXXXXXXXX`),
        sendOpts,
      );
      return { handled: true };
    }
    const next = updateTrustedHandles(card, cmd.cmd, cmd.handles);
    await deps.saveEventCard(tenant, next);
    await deps.sendMessage(
      fromHandle,
      humanize(
        `${cmd.cmd === "trust" ? "Added" : "Removed"} ${cmd.handles.length} contact(s). Trusted now: ${next.trusted_handles.length}.`,
      ),
      sendOpts,
    );
    return { handled: true };
  }

  if (cmd.cmd === "plan") {
    await deps.sendMessage(fromHandle, buildLatestPlanReply(card), sendOpts);
    return { handled: true };
  }

  if (cmd.cmd === "status") {
    const summary = [
      `Event: ${card.title || "EDC 2026"}`,
      `Trusted: ${card.trusted_handles?.length || 0}`,
      `Open loops: ${card.open_loops?.length || 0}`,
      `Pending drafts: ${card.pending_group_drafts?.length || 0}`,
      `Last scan: ${card.last_scanned_at || "never"}`,
    ].join("\n");
    await deps.sendMessage(fromHandle, humanize(summary), sendOpts);
    return { handled: true };
  }

  if (cmd.cmd === "approve") {
    const { card: nextCard, draft } = popLatestGroupDraft(card);
    if (!draft) {
      await deps.sendMessage(
        fromHandle,
        humanize("No pending draft to approve."),
        sendOpts,
      );
      return { handled: true };
    }
    // We still don't auto-send to the group. Approval just confirms
    // the draft is good — Sagar copy-pastes it into the group chat
    // himself. v1 explicitly avoids any auto-send into multi-person
    // chats (build brief: "draft only").
    await deps.saveEventCard(tenant, nextCard);
    await deps.sendMessage(
      fromHandle,
      humanize(
        ["Approved. Copy this into the group chat:", "", draft.body].join("\n"),
      ),
      sendOpts,
    );
    return { handled: true };
  }

  if (cmd.cmd === "reset") {
    const empty = {
      ...card,
      latest_plan: null,
      next_meetup: null,
      ticket_ledger: [],
      payment_ledger: [],
      transport_plan: null,
      lodging_plan: null,
      supply_list: [],
      safety_status: null,
      open_loops: [],
      pending_group_drafts: [],
      last_scanned_at: new Date().toISOString(),
    };
    await deps.saveEventCard(tenant, empty);
    await deps.sendMessage(
      fromHandle,
      humanize("Event card reset. Trusted list preserved."),
      sendOpts,
    );
    return { handled: true };
  }

  return null;
}

/**
 * Main entry. See module header.
 *
 * @param {Object} opts
 * @param {Object} opts.tenant
 * @param {string} opts.fromHandle - normalized phone of sender
 * @param {string} opts.text - inbound text
 * @param {boolean} opts.isOwner - true if sender is the tenant owner (Sagar)
 * @param {boolean} opts.isGroup
 * @param {string|null} opts.groupId
 * @param {Object} opts.sendOpts - opts to forward to sendMessage (already has tenant)
 * @returns {Promise<{handled: boolean}>}
 */
export async function handleRaveInbound({
  tenant,
  fromHandle,
  text,
  isOwner,
  isGroup,
  groupId,
  sendOpts,
  // Optional dependency injection for tests. Production callers leave
  // these undefined and we wire the real implementations.
  _deps,
}) {
  if (!isRaveMasterEnabledForTenant(tenant)) return { handled: false };
  if (!text || typeof text !== "string") return { handled: false };

  const deps = {
    sendMessage: _deps?.sendMessage || defaultSendMessage,
    loadEventCard: _deps?.loadEventCard || defaultLoadEventCard,
    saveEventCard: _deps?.saveEventCard || defaultSaveEventCard,
    storeRaveInbound: _deps?.storeRaveInbound || defaultStoreRaveInbound,
  };

  const normFrom = normalizeHandle(fromHandle);
  const eventId = eventIdForTenant(tenant);

  // PR-I outbound audit: every rave-master send carries auditOrigin
  // "rave-master" so the structured log distinguishes Sagar-only event
  // traffic from normal webhook replies. webhookContact remains the
  // inbound `from` (the contact who texted us this turn) so the
  // cross-tenant invariant still passes for sends to that contact.
  const raveSendOpts = {
    ...sendOpts,
    auditOrigin: "rave-master",
    webhookContact: sendOpts?.webhookContact || normFrom,
  };

  // ── Owner admin commands (DM only, owner only) ─────────────────────────
  if (isOwner && !isGroup) {
    const adminResult = await handleAdminCommand({
      deps,
      tenant,
      text,
      sendOpts: raveSendOpts,
      fromHandle: normFrom,
    });
    if (adminResult?.handled) return adminResult;
  }

  // Classify the message. If nothing event-relevant AND not a known
  // friend asking for the plan, fall through to normal LLM handling.
  const classification = classifyEventMessage(text);

  // ── Group messages: never auto-reply, draft for Sagar approval ──────
  // Build brief: group updates are drafted to Sagar's DM, never auto-
  // sent to the group. We still store and classify.
  if (isGroup) {
    if (!classification) return { handled: false };
    let card = await deps.loadEventCard(tenant);
    card = applyClassificationToCard(card, classification, normFrom);

    // Procurement guardrail: refuse to draft if the source message is
    // sourcing/dosing. Persist the card update (for situational
    // awareness) but tell Sagar we held the draft back.
    const guard = refuseProcurementDraft(text);
    if (!guard.ok) {
      await deps.saveEventCard(tenant, card);
      await deps
        .storeRaveInbound({
          tenant,
          fromHandle: normFrom,
          text,
          replyText: null,
          classification,
          eventId,
        })
        .catch(() => {});
      await notifySagar(
        deps,
        tenant,
        humanize(
          [
            `Heads up: I logged an event-context message in ${groupId || "a group"} but won't draft a group update for it.`,
            guard.reason,
          ].join("\n"),
        ),
      );
      return { handled: true };
    }

    const draftBody = buildGroupUpdateDraft(card);
    const draft = {
      groupId: groupId || null,
      body: draftBody,
      sourceEvidence: classification.text,
      sourceHandle: normFrom,
      at: new Date().toISOString(),
    };
    card = queueGroupDraft(card, draft);
    await deps.saveEventCard(tenant, card);
    await deps
      .storeRaveInbound({
        tenant,
        fromHandle: normFrom,
        text,
        replyText: null,
        classification,
        eventId,
      })
      .catch(() => {});

    await notifySagar(
      deps,
      tenant,
      humanize(
        [
          `Drafted a group update from a new message in ${groupId || "a group"}.`,
          "Reply RAVE: approve to confirm. I will NOT auto-send.",
          "",
          draftBody,
        ].join("\n"),
      ),
    );
    return { handled: true };
  }

  // ── Owner DM: passive ingestion only (admin already handled above) ──
  if (isOwner) {
    if (!classification) return { handled: false };
    let card = await deps.loadEventCard(tenant);
    card = applyClassificationToCard(card, classification, normFrom);
    await deps.saveEventCard(tenant, card);
    await deps
      .storeRaveInbound({
        tenant,
        fromHandle: normFrom,
        text,
        replyText: null,
        classification,
        eventId,
      })
      .catch(() => {});
    // Don't claim "handled" — Sagar's own DM should still get a normal
    // Amber reply through the LLM. We just enriched the card silently.
    return { handled: false };
  }

  // ── Non-owner DM during the event ──────────────────────────────────────
  let card = await deps.loadEventCard(tenant);

  // Always store the inbound (build brief: "automatically store all texts
  // when they are received"). Replies and reasons are filled in below.
  let replyText = null;
  let replySummary = null;

  if (isTrustedForEvent(normFrom, card, { isOwner: false })) {
    // Trusted friend: return the latest full rave plan.
    replyText = buildLatestPlanReply(card);
    replySummary = "the latest plan";

    if (classification) {
      card = applyClassificationToCard(card, classification, normFrom);
      await deps.saveEventCard(tenant, card);
    }

    await deps.sendMessage(normFrom, replyText, raveSendOpts);
    await deps
      .storeRaveInbound({
        tenant,
        fromHandle: normFrom,
        text,
        replyText,
        classification,
        eventId,
      })
      .catch(() => {});

    // Update Sagar on who texted and what Amber replied.
    await notifySagar(
      deps,
      tenant,
      buildSagarNotifyTrustedReply({
        friendLabel: maskHandle(normFrom),
        replySummary,
      }),
    );
    return { handled: true };
  }

  // Unknown sender: ask them to identify and notify Sagar.
  replyText = buildUnknownSenderReply();
  await deps.sendMessage(normFrom, replyText, raveSendOpts);
  await deps
    .storeRaveInbound({
      tenant,
      fromHandle: normFrom,
      text,
      replyText,
      classification,
      eventId,
    })
    .catch(() => {});
  await notifySagar(
    deps,
    tenant,
    buildSagarNotifyUnknown({ handle: normFrom, text }),
  );
  return { handled: true };
}
