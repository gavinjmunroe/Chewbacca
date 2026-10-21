/**
 * Event card — the single canonical state object for an active event.
 *
 * Shape (from the build brief):
 *   {
 *     event_id, owner_did, title, visibility,
 *     source_chats, latest_plan, next_meetup,
 *     ticket_ledger, payment_ledger, transport_plan,
 *     lodging_plan, supply_list, safety_status,
 *     open_loops, last_scanned_at,
 *     trusted_handles,            // who can receive the latest plan
 *     pending_group_drafts,       // approval-pending drafts to Sagar
 *   }
 *
 * Persistence: stored in the per-tenant amber-id Firestore-backed
 * `event_cards` table via the existing `sbGet` / `sbUpsert` data-plane
 * client. Reads are tenant-scoped (lib/data.js extracts the Privy DID).
 * The card is NOT mirrored to the local filesystem — amber-id owns it.
 *
 * Update model: pure functions return a new card. Side-effecting load /
 * save are kept thin so they're easy to fake in tests.
 */

import { sbGet, sbUpsert } from "../data.js";
import { eventIdForTenant, EDC_2026_EVENT_TITLE } from "./event-config.js";

const TABLE = "event_cards";

const EMPTY_CARD = Object.freeze({
  event_id: null,
  owner_did: null,
  title: EDC_2026_EVENT_TITLE,
  visibility: "private",
  source_chats: [],
  latest_plan: null,
  next_meetup: null,
  ticket_ledger: [],
  payment_ledger: [],
  transport_plan: null,
  lodging_plan: null,
  supply_list: [],
  safety_status: null,
  open_loops: [],
  last_scanned_at: null,
  trusted_handles: [],
  pending_group_drafts: [],
});

export function emptyEventCard(tenant) {
  return {
    ...EMPTY_CARD,
    source_chats: [],
    ticket_ledger: [],
    payment_ledger: [],
    supply_list: [],
    open_loops: [],
    trusted_handles: [],
    pending_group_drafts: [],
    event_id: eventIdForTenant(tenant),
    owner_did: tenant?.privyDid || tenant?.amberId || tenant?.id || null,
  };
}

export async function loadEventCard(tenant) {
  const eventId = eventIdForTenant(tenant);
  if (!eventId) return emptyEventCard(tenant);
  try {
    const row = await sbGet(
      TABLE,
      `event_id=eq.${encodeURIComponent(eventId)}`,
      tenant,
    );
    if (row && row.card) return { ...emptyEventCard(tenant), ...row.card };
    return emptyEventCard(tenant);
  } catch (err) {
    // sbGet only throws when amber-id isn't configured. In that case we
    // still want the orchestrator to function locally — fall through to
    // an empty card and let the caller observe nothing was loaded.
    console.warn("[rave-master/event-card] loadEventCard failed:", err.message);
    return emptyEventCard(tenant);
  }
}

export async function saveEventCard(tenant, card) {
  const eventId = eventIdForTenant(tenant);
  if (!eventId) return;
  try {
    await sbUpsert(TABLE, { event_id: eventId, card }, tenant);
  } catch (err) {
    console.warn("[rave-master/event-card] saveEventCard failed:", err.message);
  }
}

/**
 * Apply a classified inbound message into the card. Pure: returns a new
 * card object without mutating the input.
 *
 * `classification` is the return value of classifier.js#classifyEventMessage.
 * `sourceHandle` is the normalized phone of the sender.
 */
export function applyClassificationToCard(card, classification, sourceHandle) {
  if (!classification || !classification.primary) return card;
  const now = new Date().toISOString();
  const sourceChats = new Set(card.source_chats || []);
  if (sourceHandle) sourceChats.add(sourceHandle);

  const next = {
    ...card,
    source_chats: [...sourceChats].slice(-50),
    last_scanned_at: now,
  };

  // Append the evidence snippet into the open_loops queue under the
  // matching slot. We deliberately do NOT auto-resolve contradictions
  // here — the build brief specifies that reconciliation produces a
  // *latest plan*, not silent overwrites. open_loops carries the trail.
  const loop = {
    slot: classification.primary,
    slots: classification.slots,
    sourceHandle: sourceHandle || null,
    evidence: classification.text,
    at: now,
  };
  next.open_loops = [...(card.open_loops || []), loop].slice(-100);

  // Slot-specific ledgers: bump the ledger pointer so the latest plan
  // generator can pick the freshest signal per slot.
  if (classification.primary === "ticket") {
    next.ticket_ledger = [
      ...(card.ticket_ledger || []),
      { sourceHandle, evidence: classification.text, at: now },
    ].slice(-50);
  } else if (classification.primary === "payment") {
    next.payment_ledger = [
      ...(card.payment_ledger || []),
      { sourceHandle, evidence: classification.text, at: now },
    ].slice(-50);
  } else if (classification.primary === "meetup") {
    next.next_meetup = {
      evidence: classification.text,
      sourceHandle: sourceHandle || null,
      at: now,
    };
  } else if (classification.primary === "transport") {
    next.transport_plan = {
      evidence: classification.text,
      sourceHandle: sourceHandle || null,
      at: now,
    };
  } else if (classification.primary === "lodging") {
    next.lodging_plan = {
      evidence: classification.text,
      sourceHandle: sourceHandle || null,
      at: now,
    };
  } else if (classification.primary === "supply") {
    next.supply_list = [
      ...(card.supply_list || []),
      { sourceHandle, evidence: classification.text, at: now },
    ].slice(-50);
  } else if (classification.primary === "safety") {
    next.safety_status = {
      evidence: classification.text,
      sourceHandle: sourceHandle || null,
      at: now,
    };
  }

  return next;
}

/**
 * Update the trust roster. `op` is "trust" or "untrust".
 * `handles` is an array of normalized phone numbers.
 */
export function updateTrustedHandles(card, op, handles) {
  const set = new Set(card.trusted_handles || []);
  for (const h of handles || []) {
    if (!h) continue;
    if (op === "trust") set.add(h);
    else if (op === "untrust") set.delete(h);
  }
  return { ...card, trusted_handles: [...set] };
}

/**
 * Queue a pending group-update draft for Sagar's approval. The draft is
 * persisted on the card so a later "approve" command can retrieve it
 * without re-running the LLM.
 */
export function queueGroupDraft(card, draft) {
  const queue = [...(card.pending_group_drafts || []), draft].slice(-20);
  return { ...card, pending_group_drafts: queue };
}

export function popLatestGroupDraft(card) {
  const queue = [...(card.pending_group_drafts || [])];
  const popped = queue.pop() || null;
  return { card: { ...card, pending_group_drafts: queue }, draft: popped };
}
