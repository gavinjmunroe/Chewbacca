import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { getMockState, onFetch, queueBqRows } from "../../../tests/smoke/helpers";
import { dispatchRow } from "../../perplexity/dispatch";
import { clearPerplexityHalt } from "../../perplexity/tokens";
import * as oauth from "../../perplexity/oauth";
import { connectionQueue } from "../queue";
import { clearTargetsCache } from "../targets";
import type { ConnectionItemRow } from "../store";

const GUIDE_URL = "https://docs.google.com/document/d/e/GUIDE/pub";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv";
const ENV_KEYS = ["SERIF_CONNECTION_GUIDE_URL", "SERIF_TARGET_ACCOUNTS_URL"];
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const SHEET = [
  "Segment,Type,Account,Company Domain",
  "Health Systems,,Hospital for Special Surgery,www.hss.edu",
  "Health Systems,,Memorial Hermann,memorialhermann.org",
  "Providers,ASC,Surgery Partners,surgerypartners.com",
].join("\n");

const ROW: ConnectionItemRow = {
  id: "abc",
  row_id: "clay_person_1",
  state: "queued",
  client_id: "serif",
  person_name: "Shannon Yarrow",
  person_title: "VP Managed Care",
  person_company: "Surgery Partners",
  person_company_domain: "surgerypartners.com",
  person_linkedin: null,
  person_location: "Nashville, TN",
  work_history: "Tenet Healthcare, Director of Payer Contracting, 2014-2019",
  pplx_thread_id: null,
  pplx_account: null,
  attempts: 0,
};

const GOOD_RESULT = { thread_id: "t-1", event: "complete", text: "..." };

const writes = () => getMockState().bq.writes.map((w: any) => w.sql as string);

beforeEach(() => {
  clearPerplexityHalt();
  clearTargetsCache();
  process.env.SERIF_CONNECTION_GUIDE_URL = GUIDE_URL;
  process.env.SERIF_TARGET_ACCOUNTS_URL = SHEET_URL;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.PERPLEXITY_ALERT_SLACK_CHANNEL = "C0C14UKEEUR";
  onFetch("chat.postMessage", { ok: true });
  vi.spyOn(oauth, "loadTokens").mockResolvedValue({
    access_token: "at-live",
    issued_at: Date.now(),
    expires_at: Date.now() + 30 * 86400_000,
  } as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  clearPerplexityHalt();
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (PREV[k] === undefined) delete process.env[k];
    else process.env[k] = PREV[k];
  }
});

describe("dispatching a connection search", () => {
  it("points Perplexity at the guide and the sheet, and gives it the person", async () => {
    onFetch(SHEET_URL, SHEET);
    let sent = "";
    const out = await dispatchRow(connectionQueue, ROW, async ({ message }) => {
      sent = message;
      return GOOD_RESULT;
    });

    expect(out.status).toBe("dispatched");
    expect(sent).toContain(GUIDE_URL);
    expect(sent).toContain(SHEET_URL);
    // The count Togari read, so a truncated read on Perplexity's side shows.
    expect(sent).toContain("3 accounts");
    expect(sent).toContain(ROW.row_id);
    expect(sent).toContain("Shannon Yarrow");
    expect(sent).toContain("Tenet Healthcare");
    expect(sent).toContain("/connections/result");
    // The callback's field names, which /connections/result parses.
    for (const field of [
      "target_rows_read",
      "identity_confirmed",
      "people",
      "roles",
      "target_account",
      "target_contacts",
      "joined_year",
    ]) {
      expect(sent).toContain(field);
    }
    // The domain is what Togari matches on, so it is asked for every time.
    expect(sent).toContain("ALWAYS give the company's website domain");
    // The buyer seat is part of the same task, not a second call.
    expect(sent).toMatch(/buyer seat/);
    // Role lists ride in the message too, so a guide that loads only in part
    // cannot change who is researched.
    expect(sent).toContain("Payer Contracting");
    expect(sent).toContain("Chief Strategy Officer");
    expect(sent).not.toMatch(/Bearer\s+\S/);
  });

  it("writes to connection_items, never reply_items", async () => {
    onFetch(SHEET_URL, SHEET);
    await dispatchRow(connectionQueue, ROW, async () => GOOD_RESULT);
    const queueWrites = writes().filter((s) => s.includes("UPDATE"));
    expect(queueWrites.length).toBeGreaterThan(0);
    expect(queueWrites.every((s) => s.includes("connection_items"))).toBe(true);
  });

  it("counts against its own daily cap, not the replies'", async () => {
    onFetch(SHEET_URL, SHEET);
    await dispatchRow(connectionQueue, ROW, async () => GOOD_RESULT);
    const capQuery = getMockState().bq.queries.find((q: any) => q.sql.includes("COUNT(*)"));
    expect(capQuery.sql).toContain("kind LIKE 'connection%'");
    const logged = getMockState().bq.writes.find((w: any) => w.sql.includes("perplexity_calls"));
    expect(logged.params.kind).toBe("connection_dispatch");
  });

  it("costs nothing when the sheet cannot be read — no claim, no call", async () => {
    onFetch(SHEET_URL, "<!DOCTYPE html><html>Sign in</html>");
    const call = vi.fn(async () => GOOD_RESULT);
    const out = await dispatchRow(connectionQueue, ROW, call);

    expect(out.status).toBe("skipped");
    expect(out.reason).toMatch(/published to the web/);
    expect(call).not.toHaveBeenCalled();
    expect(writes().some((s) => s.includes("'dispatching'"))).toBe(false);
  });

  it("costs nothing for a client with no research set up", async () => {
    const call = vi.fn(async () => GOOD_RESULT);
    const out = await dispatchRow(connectionQueue, { ...ROW, client_id: "bma" }, call);
    expect(out.status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("the reply cap ignores connection research", () => {
  it("filters connection calls out of the reply count", async () => {
    const { countCallsToday } = await import("../../perplexity/call-log");
    await countCallsToday("serif");
    const q = getMockState().bq.queries.find((x: any) => x.sql.includes("COUNT(*)"));
    expect(q.sql).toContain("NOT LIKE 'connection%'");
  });
});

describe("the connection sweep", () => {
  it("dispatches queued research from connection_items", async () => {
    onFetch(SHEET_URL, SHEET);
    const { sweepConnections } = await import("../../perplexity/sweeper");
    queueBqRows([{ row_id: ROW.row_id }]); // findQueued
    queueBqRows([ROW]); // getConnectionItem

    const call = vi.fn(async () => GOOD_RESULT);
    const summary = await sweepConnections(call, {
      staleMinutes: 15,
      maxAttempts: 3,
      giveUpAfterMinutes: 60,
      dispatchingAlertMinutes: 20,
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(summary.dispatched).toBe(1);
    const tables = getMockState().bq.queries.map((q: any) => q.sql as string);
    expect(tables.some((s) => s.includes("reply_items"))).toBe(false);
  });
});
