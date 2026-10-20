/**
 * Smoke tests for the read-only Gmail + Fireflies retrieval sources.
 *
 * These assert the safe, non-throwing behavior that matters for a bulk report
 * pull: with credentials unset, each fetch returns a clean `configured: false`
 * result and a note rather than a stack trace. A Fireflies happy-path test
 * stubs the GraphQL endpoint via onFetch and verifies action items + recording
 * link mapping.
 *
 * Robust to the shared setup.ts auto-mocks (googleapis JWT, global fetch).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { onFetch } from "../../../tests/smoke/helpers";
import { fetchGmailMessages } from "../gmail-fetch";
import { fetchFirefliesMeetings } from "../fireflies-fetch";

describe("fetchGmailMessages (read-only)", () => {
  const prevGcp = process.env.GCP_CREDENTIALS_BASE64;
  const prevGoogle = process.env.GOOGLE_CREDENTIALS_BASE64;

  beforeEach(() => {
    delete process.env.GCP_CREDENTIALS_BASE64;
    delete process.env.GOOGLE_CREDENTIALS_BASE64;
  });

  afterEach(() => {
    if (prevGcp === undefined) delete process.env.GCP_CREDENTIALS_BASE64;
    else process.env.GCP_CREDENTIALS_BASE64 = prevGcp;
    if (prevGoogle === undefined) delete process.env.GOOGLE_CREDENTIALS_BASE64;
    else process.env.GOOGLE_CREDENTIALS_BASE64 = prevGoogle;
  });

  it("returns configured:false with a note when creds are unset (no throw)", async () => {
    const result = await fetchGmailMessages({ sinceDays: 90 });
    expect(result.configured).toBe(false);
    expect(result.fetched).toBe(0);
    expect(result.messages).toEqual([]);
    expect(result.note).toContain("GCP_CREDENTIALS_BASE64");
  });

  it("resolves the mailbox default", async () => {
    const result = await fetchGmailMessages({ user: "custom@bma.com" });
    expect(result.user).toBe("custom@bma.com");
  });
});

describe("fetchFirefliesMeetings (read-only)", () => {
  const prevKey = process.env.FIREFLIES_API_KEY;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.FIREFLIES_API_KEY;
    else process.env.FIREFLIES_API_KEY = prevKey;
  });

  it("returns configured:false with a note when the key is unset (no throw)", async () => {
    delete process.env.FIREFLIES_API_KEY;
    const result = await fetchFirefliesMeetings({ sinceDays: 90 });
    expect(result.configured).toBe(false);
    expect(result.fetched).toBe(0);
    expect(result.meetings).toEqual([]);
    expect(result.note).toContain("FIREFLIES_API_KEY");
  });

  it("maps a recent meeting with action items and recording link", async () => {
    process.env.FIREFLIES_API_KEY = "test-fireflies-key";

    onFetch("api.fireflies.ai/graphql", {
      data: {
        transcripts: [
          {
            id: "T1",
            title: "BMA sync",
            date: Date.now(),
            transcript_url: "https://app.fireflies.ai/view/T1",
            participants: ["sagar@bluemodernadvisory.com"],
            attendees: [
              { displayName: "Sagar", email: "sagar@bluemodernadvisory.com" },
            ],
            summary: {
              overview: "Discussed the pipeline.",
              action_items: ["Send proposal", "Book follow-up"],
            },
          },
        ],
      },
    });

    const result = await fetchFirefliesMeetings({ sinceDays: 90 });
    expect(result.configured).toBe(true);
    expect(result.fetched).toBe(1);

    const meeting = result.meetings[0];
    expect(meeting.id).toBe("T1");
    expect(meeting.title).toBe("BMA sync");
    expect(meeting.recordingUrl).toBe("https://app.fireflies.ai/view/T1");
    expect(meeting.overview).toBe("Discussed the pipeline.");
    expect(meeting.actionItems).toEqual(["Send proposal", "Book follow-up"]);
    expect(meeting.attendees.length).toBeGreaterThan(0);
  });

  it("filters out meetings older than the since_days window", async () => {
    process.env.FIREFLIES_API_KEY = "test-fireflies-key";

    const oldDate = Date.now() - 200 * 24 * 60 * 60 * 1000;
    onFetch("api.fireflies.ai/graphql", {
      data: {
        transcripts: [
          {
            id: "OLD",
            title: "Ancient meeting",
            date: oldDate,
            summary: { action_items: [] },
          },
        ],
      },
    });

    const result = await fetchFirefliesMeetings({ sinceDays: 90 });
    expect(result.configured).toBe(true);
    expect(result.fetched).toBe(0);
  });
});
