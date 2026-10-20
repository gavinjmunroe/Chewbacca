/**
 * Campaign events: one row per send, reply or bounce from a client's Clay
 * campaigns (migration 0044), for the campaign calendar.
 *
 * Clay logs every event of a campaign to that campaign's Events table, and an
 * HTTP API column there POSTs each row to /campaign-events. The column names
 * in that table are Clay's, so this side is tolerant: numbers or strings for
 * ids, any event name containing "sent", "repl" or "bounce", and a reply's
 * text or Clay's own category, whichever the column maps.
 *
 * A reply's text is read once, here, to sort it, and never stored.
 */
import { z } from "zod";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import {
  ownWords,
  replyIntent,
} from "../agents/smartlead-responder/reply-intent";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

export const EVENTS_TABLE = "campaign_events";

/**
 * "status" is Clay's CAMPAIGN_STATUS_CHANGED: stored for the campaign's
 * status, never counted as activity (every count names its event_type).
 */
export type EventKind = "sent" | "reply" | "bounce" | "status";

/**
 * What a reply was. Everything but ooo and auto counts as a reply in the reply
 * rate; interested and needs_read are the ones a person has to answer.
 */
export type ReplyOutcome =
  | "interested"
  | "needs_read"
  | "ooo"
  | "pass"
  | "opt_out"
  | "redirect"
  | "later"
  | "auto";

const text = z.preprocess(
  (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v),
  z.string(),
);

export const CampaignEventPayload = z.object({
  event_id: text.pipe(z.string().trim().min(1)),
  client_id: text.pipe(z.string().trim().min(1)),
  event_type: text.pipe(z.string().trim().min(1)),
  campaign_id: text.nullish(),
  campaign_name: text.nullish(),
  lead_email: text.nullish(),
  lead_name: text.nullish(),
  // A step Clay sent as "Step 2" or left blank is no reason to lose the send.
  step: z
    .preprocess((v) => {
      const n = Number(String(v ?? "").replace(/[^\d.]/g, "") || NaN);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }, z.number().nullable())
    .optional(),
  occurred_at: text.nullish(),
  /** The reply's text, for sorting. Read once and dropped. */
  reply_text: text.nullish(),
  /** Clay's own category for the reply, an id (6) or a label ("Out Of Office"). */
  reply_category: text.nullish(),
  planned_start: text.nullish(),
  planned_end: text.nullish(),
  // A Clay column built from a reply column often names these body/category.
  body: text.nullish(),
  category: text.nullish(),
  /** Clay's Campaign > Status on the event, e.g. ACTIVE, PAUSED, COMPLETED. */
  campaign_status: text.nullish(),
});

export type CampaignEventPayload = z.infer<typeof CampaignEventPayload>;

/** sent, reply, bounce or status from whatever Clay calls it; null for opens, clicks and the rest. */
export function eventKind(raw: string): EventKind | null {
  const words = raw.toLowerCase().split(/[^a-z]+/);
  if (words.some((w) => w.startsWith("bounce") || w === "undeliverable"))
    return "bounce";
  if (words.some((w) => w.startsWith("repl"))) return "reply";
  if (words.some((w) => w === "sent" || w === "send" || w === "sending"))
    return "sent";
  if (words.includes("status")) return "status";
  return null;
}

/**
 * Clay's sequencer reply categories, as client-dashboard.ts mapped them from
 * 74 Zeutara threads on 2026-10-13: 3 a pass, 4 an unsubscribe or left-the-firm
 * notice, 6 out of office, 7 wrong person, dead mailbox or bounce. 1, 2 and 5
 * held the replies that showed interest or asked something.
 */
const CATEGORY_IDS: Record<string, ReplyOutcome> = {
  "1": "interested",
  "2": "interested",
  "3": "pass",
  "4": "opt_out",
  "5": "interested",
  "6": "ooo",
  "7": "auto",
};

function outcomeFromCategory(raw: string): ReplyOutcome | null {
  const c = raw.trim().toLowerCase();
  if (!c) return null;
  if (CATEGORY_IDS[c]) return CATEGORY_IDS[c];
  if (/out.?of.?office|\booo\b|auto.?repl/.test(c)) return "ooo";
  if (/unsub|do.?not.?contact|remove/.test(c)) return "opt_out";
  if (/not.?interested|\bpass/.test(c)) return "pass";
  if (/wrong|referr|left/.test(c)) return "redirect";
  if (/interest|meeting|positive|question/.test(c)) return "interested";
  return null;
}

// reply-intent has no rule for "not interested", and its interested rule
// matches the word inside it, so "Not interested, thanks." reads as interest
// (2026-10-14). Caught here first, on their own words only: a cold email's
// "if you're not interested, just say so" sits in the quoted thread below.
const NOT_INTERESTED =
  /\b(not|no longer|isn'?t|aren'?t)\s+(really\s+|currently\s+|at this time\s+)?interested\b/i;

/**
 * Sort a reply. Its text goes through the same rules as the reply cards
 * (reply-intent.ts); Clay's category decides only when there is no text or
 * the rules can't tell.
 */
export function replyOutcome(
  replyText: string | null | undefined,
  category: string | null | undefined,
): ReplyOutcome {
  const fromCategory = outcomeFromCategory(category || "");
  if (!replyText || !replyText.trim()) return fromCategory || "needs_read";
  if (NOT_INTERESTED.test(ownWords(replyText.slice(0, 6000)))) return "pass";
  const intent = replyIntent(replyText);
  switch (intent.kind) {
    case "interested":
    case "question":
    case "deck":
    case "form":
      return "interested";
    case "later":
      // reply-intent files an autoresponder and a person's "back in three
      // weeks" under the same kind; only the first is out of office.
      return intent.label === "Out of office" ? "ooo" : "later";
    case "pass":
      return "pass";
    case "unsubscribe":
      return "opt_out";
    case "new_address":
    case "referral":
      return "redirect";
    case "ignore":
      return "auto";
    default:
      return fromCategory || "needs_read";
  }
}

/** YYYY-MM-DD, or null for anything that isn't a date. */
export function asDate(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** The row as it lands in campaign_events, or null for an event that isn't counted. */
export function eventRow(
  p: CampaignEventPayload,
  now = new Date(),
): Record<string, unknown> | null {
  const kind = eventKind(p.event_type);
  if (!kind) return null;
  const at = Date.parse(p.occurred_at || "");
  return {
    event_id: p.event_id.trim(),
    client_id: p.client_id.trim(),
    event_type: kind,
    campaign_id: p.campaign_id?.trim() || null,
    campaign_name: p.campaign_name?.trim() || null,
    campaign_status: p.campaign_status?.trim().toUpperCase() || null,
    lead_email: p.lead_email?.trim().toLowerCase() || null,
    lead_name: p.lead_name?.trim() || null,
    step: p.step ?? null,
    occurred_at: (isNaN(at) ? now : new Date(at)).toISOString(),
    outcome:
      kind === "reply"
        ? replyOutcome(
            p.reply_text ?? p.body,
            p.reply_category ?? p.category,
          )
        : null,
    planned_start: asDate(p.planned_start),
    planned_end: asDate(p.planned_end),
    received_at: now.toISOString(),
  };
}

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/**
 * Stream one event in. The insertId lets BigQuery drop most of Clay's retries;
 * readers take the first row per event_id for the rest.
 */
export async function insertCampaignEvent(
  row: Record<string, unknown>,
): Promise<void> {
  await moduleBq()
    .getClient()
    .dataset(resolveDataset())
    .table(EVENTS_TABLE)
    .insert([{ insertId: `${row.client_id}:${row.event_id}`, json: row }], {
      raw: true,
    });
}

/** Stream many events in at once, with the same insertIds as one at a time. */
export async function insertCampaignEvents(
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const table = moduleBq()
    .getClient()
    .dataset(resolveDataset())
    .table(EVENTS_TABLE);
  // BigQuery takes up to 10,000 rows a request; 500 keeps each small.
  for (let i = 0; i < rows.length; i += 500)
    await table.insert(
      rows.slice(i, i + 500).map((row) => ({
        insertId: `${row.client_id}:${row.event_id}`,
        json: row,
      })),
      { raw: true },
    );
}
