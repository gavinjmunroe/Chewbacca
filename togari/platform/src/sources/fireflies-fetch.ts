/**
 * Read-only Fireflies meeting retrieval source.
 *
 * Fetches recent meeting transcripts from the Fireflies GraphQL API and
 * RETURNS them with recording links and action items. This module is strictly
 * read-only: it never writes to BigQuery, the CRM, or Fireflies itself. There
 * is no BigQuery import anywhere in this file by design, so a bulk 90-day
 * retrieval for a report cannot flood the production CRM.
 *
 * The GraphQL fetch mirrors src/ingest/sources/fireflies-ingest.ts and
 * src/pdw/adapters/fireflies.ts, and extends the query to request the summary
 * overview + action items, the meeting participants, and transcript_url so a
 * report has recording links + action items per meeting.
 *
 * FIREFLIES_API_KEY is checked up front. When it is missing the function
 * returns a clean, non-throwing "not configured" result.
 *
 * Env:
 *   FIREFLIES_API_KEY   Fireflies personal API key (Bearer auth).
 */

import { createLogger } from "../observability/logger";

const logger = createLogger("sources/fireflies-fetch");

const FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql";
const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_MAX_MEETINGS = 12;
const MAX_MEETINGS_CAP = 100;

interface FirefliesTranscript {
  id: string;
  title?: string;
  date?: string | number;
  participants?: string[];
  summary?: {
    overview?: string;
    action_items?: string[] | string;
  };
  transcript_url?: string;
}

export interface FirefliesMeeting {
  id: string;
  title: string;
  date: string;
  attendees: string[];
  recordingUrl?: string;
  overview?: string;
  actionItems: string[];
}

export interface FetchFirefliesMeetingsResult {
  configured: boolean;
  fetched: number;
  meetings: FirefliesMeeting[];
  note?: string;
}

/**
 * Fetch recent transcripts via the Fireflies GraphQL API. Extends the ingest
 * query with summary { overview action_items }, attendees, participants, and
 * transcript_url for report use.
 */
async function fetchRecentTranscripts(
  apiKey: string,
  limit: number,
): Promise<FirefliesTranscript[]> {
  const query = `
    query Transcripts($limit: Int) {
      transcripts(limit: $limit) {
        id
        title
        date
        transcript_url
        participants
        summary {
          overview
          action_items
        }
      }
    }
  `;

  const res = await fetch(FIREFLIES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables: { limit } }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fireflies API HTTP ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    data?: { transcripts?: FirefliesTranscript[] };
    errors?: Array<{ message: string }>;
  };
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `Fireflies GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return json.data?.transcripts ?? [];
}

/** Normalize a Fireflies date (epoch ms number or ISO string) to ISO string. */
function toIso(date: string | number | undefined): string {
  if (date === undefined || date === null || date === "") return "";
  if (typeof date === "number") return new Date(date).toISOString();
  const asNumber = Number(date);
  if (!Number.isNaN(asNumber) && String(asNumber) === date) {
    return new Date(asNumber).toISOString();
  }
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? String(date) : parsed.toISOString();
}

/** Collapse attendees + participants into a de-duplicated display list. */
function collectAttendees(t: FirefliesTranscript): string[] {
  const out: string[] = [];
  for (const p of t.participants ?? []) {
    if (p) out.push(p);
  }
  return Array.from(new Set(out));
}

/** action_items may arrive as an array or a newline-delimited string. */
function normalizeActionItems(items: string[] | string | undefined): string[] {
  if (!items) return [];
  if (Array.isArray(items)) return items.filter((i) => Boolean(i && i.trim()));
  return items
    .split("\n")
    .map((i) => i.trim())
    .filter((i) => i.length > 0);
}

/**
 * Fetch up to `max` recent meetings, filter client-side to the last
 * `sinceDays` days, and RETURN them with recording links + action items.
 *
 * READ ONLY. Never throws: the missing-key case resolves to a clean
 * `configured: false` result, and a fetch failure resolves to a note.
 */
export async function fetchFirefliesMeetings(params: {
  sinceDays?: number;
  max?: number;
}): Promise<FetchFirefliesMeetingsResult> {
  const sinceDays = params.sinceDays ?? DEFAULT_SINCE_DAYS;
  const max = Math.min(params.max ?? DEFAULT_MAX_MEETINGS, MAX_MEETINGS_CAP);

  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      fetched: 0,
      meetings: [],
      note: "Fireflies not configured: set FIREFLIES_API_KEY",
    };
  }

  let transcripts: FirefliesTranscript[];
  try {
    transcripts = await fetchRecentTranscripts(apiKey, max);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "fireflies fetch failed",
      err instanceof Error ? err : new Error(message),
    );
    return {
      configured: true,
      fetched: 0,
      meetings: [],
      note: `Fireflies fetch failed: ${message}`,
    };
  }

  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  const meetings: FirefliesMeeting[] = [];
  for (const t of transcripts) {
    const iso = toIso(t.date);
    // Filter client-side by date window; keep undated meetings rather than
    // silently dropping them.
    if (iso) {
      const ms = new Date(iso).getTime();
      if (!Number.isNaN(ms) && ms < cutoff) continue;
    }

    const meeting: FirefliesMeeting = {
      id: t.id,
      title: t.title || "(untitled)",
      date: iso,
      attendees: collectAttendees(t),
      actionItems: normalizeActionItems(t.summary?.action_items),
    };
    if (t.transcript_url) meeting.recordingUrl = t.transcript_url;
    if (t.summary?.overview) meeting.overview = t.summary.overview;
    meetings.push(meeting);
  }

  logger.info("fireflies fetch complete", {
    sinceDays,
    fetched: meetings.length,
  });

  return {
    configured: true,
    fetched: meetings.length,
    meetings,
  };
}
