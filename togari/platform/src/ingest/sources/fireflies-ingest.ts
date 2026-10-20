/**
 * On-demand Fireflies transcript ingestion source.
 *
 * Pulls recent meeting transcripts from the Fireflies GraphQL API and pushes
 * each one through the EXISTING universal ingestion pipeline
 * (UniversalIngestService), so every transcript is raw-preserved in
 * raw_ingestions, AI-extracted into structured entities (contacts, companies,
 * activities), and routed into the CRM / pipeline tables. The GraphQL fetch
 * mirrors src/pdw/adapters/fireflies.ts and src/transports/webhooks/fireflies.ts.
 *
 * FIREFLIES_API_KEY is checked up front. When it is missing the function
 * returns a clean, non-throwing "not configured" result.
 *
 * Env:
 *   FIREFLIES_API_KEY   Fireflies personal API key (Bearer auth).
 */

import { BigQueryClient } from "../../bigquery/client";
import { createLogger } from "../../observability/logger";
import { UniversalIngestService } from "../universal/service";

const logger = createLogger("ingest/sources/fireflies");

const FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql";
const DEFAULT_MAX_MEETINGS = 10;

interface FirefliesSentence {
  text?: string;
  speaker_name?: string;
}

interface FirefliesTranscript {
  id: string;
  title?: string;
  date?: string;
  duration?: number;
  participants?: string[];
  summary?: {
    overview?: string;
    action_items?: string[];
    keywords?: string[];
  };
  sentences?: FirefliesSentence[];
  transcript_url?: string;
}

export interface FirefliesIngestParams {
  bq: BigQueryClient;
  clientId: string;
  maxMeetings?: number;
}

export interface FirefliesIngestItemResult {
  meetingId: string;
  extracted: number;
  routed: number;
}

export interface FirefliesIngestResult {
  configured: boolean;
  fetched: number;
  ingested: number;
  results: FirefliesIngestItemResult[];
  note?: string;
}

/** Fetch recent transcripts via the Fireflies GraphQL API. */
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
        duration
        participants
        summary {
          overview
          action_items
          keywords
        }
        sentences {
          text
          speaker_name
        }
        transcript_url
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

/** Join a transcript into a single plain-text blob for extraction. */
function transcriptToText(t: FirefliesTranscript): string {
  const header = [
    `Meeting: ${t.title || "(untitled)"}`,
    t.date ? `Date: ${t.date}` : "",
    t.participants && t.participants.length > 0
      ? `Participants: ${t.participants.join(", ")}`
      : "",
    t.summary?.overview ? `Summary: ${t.summary.overview}` : "",
    "",
  ].filter((l) => l !== "");

  const transcript = (t.sentences ?? [])
    .map((s) => `${s.speaker_name || "Unknown"}: ${s.text || ""}`)
    .join("\n");

  return [...header, transcript].join("\n");
}

/**
 * Fetch up to `maxMeetings` recent transcripts and ingest each through the
 * universal pipeline. Per-transcript failures are caught so one bad meeting
 * never fails the batch. Never throws for the missing-key case.
 */
export async function ingestFireflies(
  params: FirefliesIngestParams,
): Promise<FirefliesIngestResult> {
  const { bq, clientId } = params;
  const maxMeetings = params.maxMeetings ?? DEFAULT_MAX_MEETINGS;

  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      fetched: 0,
      ingested: 0,
      results: [],
      note: "Fireflies not configured: set FIREFLIES_API_KEY",
    };
  }

  let transcripts: FirefliesTranscript[];
  try {
    transcripts = await fetchRecentTranscripts(apiKey, maxMeetings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "fireflies fetch failed",
      err instanceof Error ? err : new Error(message),
    );
    return {
      configured: true,
      fetched: 0,
      ingested: 0,
      results: [],
      note: `Fireflies fetch failed: ${message}`,
    };
  }

  const slice = transcripts.slice(0, maxMeetings);
  const results: FirefliesIngestItemResult[] = [];
  const svc = new UniversalIngestService({ bq });

  for (const t of slice) {
    try {
      const outcome = await svc.ingest({
        clientId,
        source: `fireflies:${t.id}`,
        contentType: "text",
        rawText: transcriptToText(t),
        fileName: t.title || undefined,
      });
      const routed =
        outcome.routed.contacts +
        outcome.routed.companies +
        outcome.routed.activities;
      results.push({
        meetingId: t.id,
        extracted: outcome.extracted,
        routed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "fireflies per-transcript ingest failed",
        err instanceof Error ? err : new Error(message),
        { meetingId: t.id },
      );
    }
  }

  logger.info("fireflies ingest complete", {
    fetched: slice.length,
    ingested: results.length,
  });

  return {
    configured: true,
    fetched: slice.length,
    ingested: results.length,
    results,
  };
}
