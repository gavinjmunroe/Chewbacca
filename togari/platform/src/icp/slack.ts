/**
 * Internal Slack alerts for website form fills (#bma-website-fills via
 * SLACK_WEBSITE_NOTIFY_WEBHOOK). Each alert carries enough to act on without
 * opening BigQuery: who submitted, what they asked for, and what happened.
 *
 * The channel is internal, so requester details are included here (they are
 * never written to logs). Everything the requester typed is escaped so it
 * can't render as a link or an @channel ping.
 */

import type { ListContact } from "./list";

/** Slack mrkdwn control characters; escaping them also blocks <!channel>. */
export function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function field(label: string, value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v ? `*${label}:* ${slackEscape(v)}` : null;
}

function quote(text: string, max = 1500): string {
  const clipped = text.length > max ? `${text.slice(0, max)}…` : text;
  return clipped
    .split(/\r?\n/)
    .map((line) => `> ${slackEscape(line)}`)
    .join("\n");
}

export interface IcpRequester {
  job_id: string;
  full_name: string | null;
  email: string;
  company?: string | null;
  industry?: string | null;
  icp_description: string;
  company_size?: string | null;
  target_titles?: string[];
  lead_score?: number | null;
}

function requesterLine(r: IcpRequester): string {
  const who = slackEscape((r.full_name ?? "").trim() || "Someone");
  const company = r.company?.trim() ? ` at ${slackEscape(r.company.trim())}` : "";
  return `${who}${company} (${slackEscape(r.email)})`;
}

function briefFields(r: IcpRequester): string[] {
  return [
    field("Who they're after", r.icp_description),
    field("Company size", r.company_size),
    field("Roles", r.target_titles?.join(", ")),
    field("Their industry", r.industry),
  ].filter((l): l is string => l !== null);
}

export type IcpOutcome =
  | { kind: "emailed"; contacts: ListContact[]; leadsSaveFailed?: boolean }
  | { kind: "unsent"; contacts: ListContact[] }
  | { kind: "needs_hand_build"; reason: string }
  | { kind: "stalled"; minutes: number; giveUpMinutes: number };

function listSize(contacts: ListContact[]): string {
  const n = contacts.length;
  const companies = new Set(contacts.map((c) => c.company.toLowerCase()).filter(Boolean)).size;
  return `${n} ${n === 1 ? "person" : "people"} at ${companies} ${companies === 1 ? "company" : "companies"}`;
}

/**
 * The one alert per ICP request: they submitted, and either the list went
 * out or it didn't (with why). Nothing is posted at submit time, so a
 * request that never finishes is reported by the timeout sweeper.
 */
export function formatIcpOutcomeAlert(r: IcpRequester, outcome: IcpOutcome): string {
  const job = `Job ${slackEscape(r.job_id)}`;
  if (outcome.kind === "stalled") {
    return [
      `⏳ *ICP form submitted, list not sent yet* for ${requesterLine(r)}`,
      `*Why:* Clay is still building after ${outcome.minutes} minutes`,
      ...briefFields(r),
      `_Nothing to do yet: if Clay finishes, the list still goes out automatically. If it hasn't by ${outcome.giveUpMinutes} minutes, you'll get another alert to reach out personally. ${job}_`,
    ].join("\n");
  }
  if (outcome.kind === "needs_hand_build") {
    return [
      `⚠️ *ICP form submitted, list NOT sent* for ${requesterLine(r)}`,
      `*Why:* ${slackEscape(outcome.reason)}`,
      ...briefFields(r),
      `_Nothing automated was sent to them. Reach out personally from maggie@. ${job}_`,
    ].join("\n");
  }

  if (outcome.kind === "unsent") {
    return [
      `⏸ *ICP form submitted, list ready but NOT sent* (autosend is off) for ${requesterLine(r)}`,
      `*List:* ${listSize(outcome.contacts)}`,
      ...briefFields(r),
      `_Turn on ICP_AUTOSEND_ENABLED to send automatically. ${job}_`,
    ].join("\n");
  }

  return [
    `✅ *ICP form submitted, list sent* to ${requesterLine(r)}`,
    `*Sent:* ${listSize(outcome.contacts)}`,
    ...briefFields(r),
    outcome.leadsSaveFailed
      ? `_Saving these people to Togari failed; check the logs. ${job}_`
      : `_People saved to Togari as sourced prospects (no outreach). ${job}_`,
  ].join("\n");
}

/** Posted when someone sends the Contact Us form. */
export function formatContactAlert(m: {
  message_id: string;
  full_name: string;
  email: string;
  message: string;
}): string {
  return [
    `💬 *New Contact Us message* from ${slackEscape(m.full_name)} (${slackEscape(m.email)})`,
    quote(m.message),
    `_They were told to expect a reply within one business day. Reply from maggie@ directly. Message ${slackEscape(m.message_id)}_`,
  ].join("\n");
}
