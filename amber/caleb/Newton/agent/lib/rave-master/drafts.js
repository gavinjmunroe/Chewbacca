/**
 * Copy generators for Rave Master.
 *
 * Every string that goes outbound passes through `humanize()` so the
 * voice-guard rules (no em-dashes, no "as an AI", no service-desk
 * closers) apply automatically. Drafts are deliberately terse with
 * a touch of warmth — Sagar's concierge voice, not corporate.
 *
 * Identity-leak rule (see lib/contacts.js + CLAUDE.md): we never
 * render Sagar's name as the friend's name and we never disclose the
 * owner's identity to unknown senders. Drafts use generic labels.
 */

import { humanize } from "../voice-guard.js";

const PUBLIC_RALLY_NUMBER = "+1 (555) 010-0005";

function fmtMeetup(card) {
  if (!card?.next_meetup?.evidence) return null;
  return card.next_meetup.evidence;
}

function fmtList(items, max = 3) {
  if (!items || items.length === 0) return null;
  return items
    .slice(-max)
    .map((it) => it.evidence || "")
    .filter(Boolean)
    .join("; ");
}

/**
 * The reply Amber sends to a TRUSTED friend during the event. Surfaces
 * the latest plan slots with a short rally-number footer. Per the
 * brief, trusted friends do get the full latest plan, not just the
 * next meetup — that's the v1 difference from the broader public.
 */
export function buildLatestPlanReply(card) {
  const lines = ["Latest from the group:"];
  const meetup = fmtMeetup(card);
  if (meetup) lines.push(`Next meetup: ${meetup}`);
  if (card?.transport_plan?.evidence)
    lines.push(`Rides: ${card.transport_plan.evidence}`);
  if (card?.lodging_plan?.evidence)
    lines.push(`Lodging: ${card.lodging_plan.evidence}`);
  const tix = fmtList(card?.ticket_ledger);
  if (tix) lines.push(`Tickets: ${tix}`);
  const pay = fmtList(card?.payment_ledger);
  if (pay) lines.push(`Money: ${pay}`);
  const sup = fmtList(card?.supply_list);
  if (sup) lines.push(`Supplies: ${sup}`);
  if (card?.safety_status?.evidence)
    lines.push(`Heads up: ${card.safety_status.evidence}`);
  if (lines.length === 1) {
    lines.push("Nothing locked in yet. Text me if you get separated and I'll route you.");
  } else {
    lines.push(`If you lose the group, text this number: ${PUBLIC_RALLY_NUMBER}`);
  }
  return humanize(lines.join("\n"));
}

/**
 * Unknown-sender reply during the event. Asks them to identify
 * themselves without leaking who Amber's owner is or any plan
 * details. Generic agent branding only.
 */
export function buildUnknownSenderReply() {
  return humanize(
    [
      "Hey, Amber here. I'm not sure who this is yet.",
      "Could you tell me your first name and how you know the group? Once I know who you are I can help you find people or share the plan.",
      "If anything feels urgent or unsafe, text the word SAFE and I'll switch into safety mode.",
    ].join("\n"),
  );
}

/**
 * Notification to Sagar after Amber replied to a trusted friend.
 * Includes who texted and a short summary of what Amber said back.
 * Never quotes Sagar's name as if it were the friend's name.
 */
export function buildSagarNotifyTrustedReply({ friendLabel, replySummary }) {
  const label = friendLabel || "a trusted contact";
  const summary = replySummary || "the latest plan";
  return humanize(
    `Heads up: ${label} just texted me. I sent them ${summary}.`,
  );
}

/**
 * Notification to Sagar when an unknown sender hits the Amber number.
 * Includes the masked handle and the first bit of what they said so
 * Sagar can decide whether to add them to the trusted list.
 */
export function buildSagarNotifyUnknown({ handle, text }) {
  const masked = maskHandle(handle);
  const snippet = (text || "").trim().slice(0, 120);
  return humanize(
    [
      `Unknown number just texted Amber: ${masked}.`,
      snippet ? `They said: "${snippet}"` : "No content yet.",
      "I asked them to identify themselves. Reply RAVE: trust <number> to add them.",
    ].join("\n"),
  );
}

/**
 * Draft a logistics-only group update for Sagar's direct approval.
 * Includes a guardrail note when the underlying material had to be
 * filtered. NEVER auto-sends — Sagar must approve via RAVE: approve.
 */
export function buildGroupUpdateDraft(card, { guardrailNote = null } = {}) {
  const head = ["Draft (not sent) — reply RAVE: approve to send to the group:"];
  const body = [];
  const meetup = fmtMeetup(card);
  if (meetup) body.push(`Next meetup: ${meetup}.`);
  if (card?.transport_plan?.evidence)
    body.push(`Rides: ${card.transport_plan.evidence}.`);
  if (card?.lodging_plan?.evidence)
    body.push(`Lodging: ${card.lodging_plan.evidence}.`);
  const tix = fmtList(card?.ticket_ledger);
  if (tix) body.push(`Tickets: ${tix}.`);
  if (card?.safety_status?.evidence)
    body.push(`Safety: ${card.safety_status.evidence}.`);
  if (body.length === 0) {
    body.push("Nothing locked in yet. Text me when you have the next pin and I'll draft something.");
  } else {
    body.push(`If anyone gets separated, text this number: ${PUBLIC_RALLY_NUMBER}.`);
  }
  const tail = guardrailNote
    ? ["", `Note: ${guardrailNote}`]
    : [];
  return humanize([...head, "", ...body, ...tail].join("\n"));
}

/**
 * Mask a phone number for the Sagar notice so the raw number doesn't
 * splatter across a screenshot. Keeps the last 4 digits for recall.
 */
export function maskHandle(handle) {
  if (!handle || typeof handle !== "string") return "unknown";
  const digits = handle.replace(/\D/g, "");
  if (digits.length < 4) return "unknown";
  return `***-***-${digits.slice(-4)}`;
}
