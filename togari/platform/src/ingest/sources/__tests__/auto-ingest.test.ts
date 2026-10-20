/**
 * Smoke tests for the on-demand Gmail + Fireflies ingestion sources.
 *
 * BigQuery + googleapis are auto-mocked by tests/smoke/setup.ts; Fireflies
 * HTTP is stubbed via onFetch. We assert:
 *   1. With credentials UNSET, ingestGmail / ingestFireflies return
 *      configured:false with a note and never throw.
 *   2. With a stubbed source returning one item, ingest runs and a BigQuery
 *      write to raw_ingestions happens (raw is always preserved first).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getMockState,
  onFetch,
  anthropicText,
} from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import { ingestGmail } from "../gmail-ingest";
import { ingestFireflies } from "../fireflies-ingest";

function bq(): BigQueryClient {
  return new BigQueryClient("test-project", null, null);
}

/** Snapshot + restore the env vars these sources read. */
const GMAIL_ENV = [
  "GCP_CREDENTIALS_BASE64",
  "GMAIL_OAUTH_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
];
const FIREFLIES_ENV = ["FIREFLIES_API_KEY"];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of [...GMAIL_ENV, ...FIREFLIES_ENV]) {
    saved[k] = process.env[k];
  }
});

function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function unset(keys: string[]) {
  for (const k of keys) delete process.env[k];
}

describe("ingestGmail", () => {
  it("returns configured:false with a note when no creds are set (no throw)", async () => {
    unset(GMAIL_ENV);
    const result = await ingestGmail({ bq: bq(), clientId: "bma" });
    restoreEnv();

    expect(result.configured).toBe(false);
    expect(result.fetched).toBe(0);
    expect(result.ingested).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.note).toMatch(/not configured/i);
  });
});

describe("ingestFireflies", () => {
  it("returns configured:false with a note when FIREFLIES_API_KEY is unset (no throw)", async () => {
    unset(FIREFLIES_ENV);
    const result = await ingestFireflies({ bq: bq(), clientId: "bma" });
    restoreEnv();

    expect(result.configured).toBe(false);
    expect(result.fetched).toBe(0);
    expect(result.ingested).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.note).toMatch(/not configured/i);
  });

  it("ingests a stubbed transcript and preserves the raw (BQ write happens)", async () => {
    process.env.FIREFLIES_API_KEY = "test-fireflies-key";

    // Fireflies GraphQL: one transcript.
    onFetch("api.fireflies.ai/graphql", () => ({
      data: {
        transcripts: [
          {
            id: "M123",
            title: "Acme <> BMA",
            date: "2026-07-01T00:00:00Z",
            duration: 1800,
            participants: ["ceo@acme.com"],
            summary: { overview: "Intro call", action_items: [], keywords: [] },
            sentences: [{ text: "Hello there", speaker_name: "CEO" }],
            transcript_url: "https://app.fireflies.ai/view/M123",
          },
        ],
      },
    }));
    // Extractor calls Anthropic; return an empty-entities envelope so routing
    // is a no-op but the raw store still writes.
    onFetch("api.anthropic.com/v1/messages", () =>
      anthropicText(JSON.stringify({ entities: [], summary: "meeting" })),
    );

    const result = await ingestFireflies({
      bq: bq(),
      clientId: "bma",
      maxMeetings: 5,
    });
    restoreEnv();

    expect(result.configured).toBe(true);
    expect(result.fetched).toBe(1);
    expect(result.ingested).toBe(1);
    expect(result.results[0].meetingId).toBe("M123");

    // Raw is preserved first: at least one BQ write targeting raw_ingestions.
    const writes = getMockState().bq.writes as Array<{ sql: string }>;
    const rawWrite = writes.some((w) => /raw_ingestions/i.test(w.sql));
    expect(rawWrite).toBe(true);
  });
});
