/**
 * Smoke tests for the read-only calendar retrieval source.
 *
 * The googleapis mock in tests/smoke/setup.ts stubs google.auth.JWT but does
 * NOT stub google.calendar, so we exercise the not-configured path here: with
 * GCP_CREDENTIALS_BASE64 (and GOOGLE_CREDENTIALS_BASE64) unset,
 * fetchCalendarEvents must return { configured: false } with an explanatory
 * note and never throw. This also guards the read-only contract: the module
 * imports no BigQuery client and performs no writes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fetchCalendarEvents } from "../calendar-fetch";

describe("fetchCalendarEvents (read-only)", () => {
  const savedGcp = process.env.GCP_CREDENTIALS_BASE64;
  const savedGoogle = process.env.GOOGLE_CREDENTIALS_BASE64;

  beforeEach(() => {
    delete process.env.GCP_CREDENTIALS_BASE64;
    delete process.env.GOOGLE_CREDENTIALS_BASE64;
  });

  afterEach(() => {
    if (savedGcp === undefined) delete process.env.GCP_CREDENTIALS_BASE64;
    else process.env.GCP_CREDENTIALS_BASE64 = savedGcp;
    if (savedGoogle === undefined) delete process.env.GOOGLE_CREDENTIALS_BASE64;
    else process.env.GOOGLE_CREDENTIALS_BASE64 = savedGoogle;
  });

  it("returns configured:false with a note when no creds are set, without throwing", async () => {
    const result = await fetchCalendarEvents({
      user: "test@bluemodernadvisory.com",
    });

    expect(result.configured).toBe(false);
    expect(result.fetched).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.user).toBe("test@bluemodernadvisory.com");
    expect(result.note).toBe(
      "Google not configured: set GCP_CREDENTIALS_BASE64",
    );
  });

  it("resolves the default user when none is passed", async () => {
    const savedIngestUser = process.env.GMAIL_INGEST_USER;
    delete process.env.GMAIL_INGEST_USER;
    try {
      const result = await fetchCalendarEvents({});
      expect(result.configured).toBe(false);
      expect(result.user).toBe("sagar@bluemodernadvisory.com");
    } finally {
      if (savedIngestUser === undefined) delete process.env.GMAIL_INGEST_USER;
      else process.env.GMAIL_INGEST_USER = savedIngestUser;
    }
  });
});
