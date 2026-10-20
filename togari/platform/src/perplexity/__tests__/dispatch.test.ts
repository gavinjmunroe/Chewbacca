import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getMockState,
  queueBqWriteAffected,
  onFetch,
  queueBqRows,
} from "../../../tests/smoke/helpers";
import { dispatchReply } from "../dispatch";
import { parseComputerResult } from "../computer";
import { clearPerplexityHalt } from "../tokens";
import * as oauth from "../oauth";
import type { ReplyItemRow } from "../../replies/store";

const ROW: ReplyItemRow = {
  id: "abc",
  row_id: "clay_row_8f3a91",
  state: "queued",
  client_id: "serif",
  campaign: "q3-outbound",
  email_thread_id: "<m1@test>",
  from_address: "dana@prospect.com",
  sender_account: "rafiq@serif-outreach.com",
  subject: "Re: quick question",
  body: "Interesting, can you send pricing?",
  lead_id: 4242,
  campaign_id: 99,
  lead_name: "Dana Whitfield",
  lead_title: "VP Operations",
  lead_company: "Prospect Co",
};

const GOOD_RESULT = {
  thread_id: "bd3a4829-ea43-4c8f-81cd-3ab4f18fe5b8",
  event: "complete",
  text: "...",
  task_state: "complete",
  pending_input: null,
};

function writes() {
  return getMockState().bq.writes;
}

beforeEach(() => {
  clearPerplexityHalt();
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

describe("parseComputerResult — the two parses", () => {
  it("parses content[0].text as JSON a second time", () => {
    const raw = {
      content: [{ type: "text", text: JSON.stringify(GOOD_RESULT) }],
    };
    expect(parseComputerResult(raw).thread_id).toBe(GOOD_RESULT.thread_id);
  });

  it("fails loudly when text is not JSON, rather than returning an empty object", () => {
    expect(() =>
      parseComputerResult({
        content: [{ type: "text", text: "I could not do that" }],
      }),
    ).toThrow(/not JSON/i);
  });

  it("fails when there is no text content at all", () => {
    expect(() => parseComputerResult({ content: [] })).toThrow(
      /no text content/i,
    );
  });
});

describe("dispatchReply — the write ordering step 06 insists on", () => {
  it("moves to dispatching BEFORE calling Perplexity", async () => {
    const seen: string[] = [];
    await dispatchReply(ROW, async () => {
      // Whatever is written at this point happened before the call.
      seen.push(...writes().map((w: any) => w.sql));
      return GOOD_RESULT;
    });

    expect(seen.join(" ")).toContain("state = 'dispatching'");
    expect(seen.join(" ")).not.toContain("state = 'dispatched'");
  });

  it("saves thread_id and account separately, then dispatched", async () => {
    const out = await dispatchReply(ROW, async () => GOOD_RESULT);

    expect(out.status).toBe("dispatched");
    expect(out.threadId).toBe(GOOD_RESULT.thread_id);
    expect(out.account).toBe("serif");

    const sql = writes().map((w: any) => w.sql);
    const identityAt = sql.findIndex((s: string) =>
      s.includes("pplx_thread_id"),
    );
    const dispatchedAt = sql.findIndex((s: string) =>
      s.includes("state = 'dispatched'"),
    );
    expect(identityAt).toBeGreaterThan(-1);
    // The identity write must land before the row is called dispatched, or a
    // crash between them hides that paid work started.
    expect(identityAt).toBeLessThan(dispatchedAt);

    const identity = writes().find((w: any) =>
      w.sql.includes("pplx_thread_id"),
    );
    expect(identity.params).toMatchObject({
      rowId: ROW.row_id,
      threadId: GOOD_RESULT.thread_id,
      account: "serif",
    });
  });

  it("leaves the row on dispatching when the call throws — never auto-retried", async () => {
    const out = await dispatchReply(ROW, async () => {
      throw new Error("stream dropped");
    });

    expect(out.status).toBe("failed");
    const sql = writes()
      .map((w: any) => w.sql)
      .join(" ");
    // Ambiguous: work may have started. Not marked failed, not marked
    // dispatched — a person decides (step 08 alerts on it).
    expect(sql).toContain("state = 'dispatching'");
    expect(sql).not.toContain("state = 'failed'");
    expect(sql).not.toContain("state = 'dispatched'");
  });

  it("does not send when another dispatcher already claimed the row", async () => {
    queueBqWriteAffected(0); // the claim matches nothing
    const call = vi.fn(async () => GOOD_RESULT);
    const out = await dispatchReply(ROW, call);

    expect(out.status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
  });

  it("sends the email and the row_id in the message", async () => {
    let sent = "";
    await dispatchReply(ROW, async ({ message }) => {
      sent = message;
      return GOOD_RESULT;
    });

    expect(sent).toContain(ROW.body);
    expect(sent).toContain(ROW.row_id);
    expect(sent).toContain(ROW.sender_account!);
    // Must ask for the CALLBACK's field names — what /replies/result parses.
    // Asking for the replybot's internal names cost a live run: the post
    // succeeded, the category saved, and the draft was silently dropped.
    expect(sent).toContain("draft");
    expect(sent).toContain("reasoning");
    expect(sent).toContain("category");
    // The callback token must never appear in a message Perplexity records.
    expect(sent).not.toMatch(/Bearer\s+\S/);
  });

  it("skips without claiming when the account is halted", async () => {
    const { getPerplexityAccessToken } = await import("../tokens");
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(null);
    await expect(getPerplexityAccessToken("serif")).rejects.toThrow(); // halts serif

    const before = writes().length;
    const call = vi.fn(async () => GOOD_RESULT);
    const out = await dispatchReply(ROW, call);

    expect(out.status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
    expect(writes().length).toBe(before); // no claim burned
  });
});

describe("who replied", () => {
  it("gives Perplexity the prospect's name, title and company", async () => {
    const { buildTaskMessage } = await import("../task-message");
    const msg = buildTaskMessage(ROW);
    expect(msg).toContain("Name: Dana Whitfield");
    expect(msg).toContain("Title: VP Operations");
    expect(msg).toContain("Company: Prospect Co");
  });
});

describe("per-client reply guide (step 09)", () => {
  const KEY = "SERIF_REPLY_GUIDE_URL";
  afterEach(() => {
    delete process.env[KEY];
    delete process.env.SERIF_TEST_REPLY_GUIDE_URL;
  });

  it("points the instructions at this client's published guide", async () => {
    process.env[KEY] = "https://docs.example/serif-guide";
    const { buildTaskMessage } = await import("../task-message");
    expect(buildTaskMessage(ROW)).toContain("https://docs.example/serif-guide");
  });

  it("gives the derived test client the same guide, not a second variable", async () => {
    process.env[KEY] = "https://docs.example/serif-guide";
    const { buildTaskMessage } = await import("../task-message");
    const msg = buildTaskMessage({ ...ROW, client_id: "serif_test" });
    expect(msg).toContain("https://docs.example/serif-guide");
  });

  it("never borrows another client's guide when one is unset", async () => {
    process.env[KEY] = "https://docs.example/serif-guide";
    const { buildTaskMessage } = await import("../task-message");
    const msg = buildTaskMessage({ ...ROW, client_id: "amber" });
    expect(msg).not.toContain("serif-guide");
    // Still a usable task, just without the guide line.
    expect(msg).toContain(ROW.body);
  });
});

describe("the sweeper sends new work, not just chases old", () => {
  it("dispatches queued replies — without this the queue never drains", async () => {
    const { sweepReplies } = await import("../sweeper");
    // No stuck/ancient/dispatching rows; one queued row to pick up.
    queueBqRows([{ row_id: ROW.row_id }]); // findQueuedRows
    queueBqRows([ROW]); // getReplyItem
    queueBqRows([]); // countCallsToday -> 0
    queueBqRows([]); // findStuckDispatching
    queueBqRows([]); // findAncient
    queueBqRows([]); // findStuckDispatched

    const call = vi.fn(async () => GOOD_RESULT);
    const summary = await sweepReplies(call, {
      staleMinutes: 15,
      maxAttempts: 3,
      giveUpAfterMinutes: 60,
      dispatchingAlertMinutes: 5,
    });

    expect(call).toHaveBeenCalled();
    expect(
      summary.dispatched + summary.skipped + summary.failed,
    ).toBeGreaterThan(0);
  });
});

describe("the stuck-mid-dispatch alert window", () => {
  const saved = process.env.REPLY_SWEEP_DISPATCHING_MINUTES;
  afterEach(() => {
    if (saved === undefined) delete process.env.REPLY_SWEEP_DISPATCHING_MINUTES;
    else process.env.REPLY_SWEEP_DISPATCHING_MINUTES = saved;
  });

  it("defaults above the time a healthy reply takes, so slow is not stuck", async () => {
    delete process.env.REPLY_SWEEP_DISPATCHING_MINUTES;
    const { sweepConfig } = await import("../sweeper");
    // A healthy reply goes queued -> done in 3-6 minutes. Alerting inside that
    // window pages a person about work that is merely slow — which is exactly
    // what happened on 2026-09-17 with the default at 5.
    expect(sweepConfig().dispatchingAlertMinutes).toBeGreaterThan(6);
  });

  it("still gives up long after it alerts, so the alert comes first", async () => {
    delete process.env.REPLY_SWEEP_DISPATCHING_MINUTES;
    const { sweepConfig } = await import("../sweeper");
    const cfg = sweepConfig();
    // Reversing these would mark the row failed before anyone was told it
    // needed a decision.
    expect(cfg.dispatchingAlertMinutes).toBeLessThan(cfg.giveUpAfterMinutes);
  });

  it("is still overridable per deploy", async () => {
    process.env.REPLY_SWEEP_DISPATCHING_MINUTES = "25";
    const { sweepConfig } = await import("../sweeper");
    expect(sweepConfig().dispatchingAlertMinutes).toBe(25);
  });
});

describe("a slow Perplexity cannot run away with the sweep", () => {
  const savedTimeout = process.env.PERPLEXITY_CALL_TIMEOUT_MS;
  afterEach(() => {
    if (savedTimeout === undefined)
      delete process.env.PERPLEXITY_CALL_TIMEOUT_MS;
    else process.env.PERPLEXITY_CALL_TIMEOUT_MS = savedTimeout;
  });

  it("stops starting new dispatches once the pass has spent its budget", async () => {
    // Budget is derived from the call timeout, so a tiny timeout gives a tiny
    // budget and the second row is left queued rather than started.
    process.env.PERPLEXITY_CALL_TIMEOUT_MS = "1";
    const { dispatchQueued } = await import("../dispatch");
    const SECOND = { ...ROW, row_id: "clay_row_second", id: "def" };

    queueBqRows([{ row_id: ROW.row_id }, { row_id: SECOND.row_id }]); // findQueuedRows
    queueBqRows([ROW]); // getReplyItem #1
    queueBqRows([SECOND]); // getReplyItem #2
    queueBqRows([]); // countCallsToday

    const call = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return GOOD_RESULT;
    });
    const outcomes = await dispatchQueued(2, call);

    // The first row always gets to start — the budget gates the NEXT one.
    expect(call).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].rowId).toBe(ROW.row_id);
  });

  it("dispatches every row when the budget is not the constraint", async () => {
    delete process.env.PERPLEXITY_CALL_TIMEOUT_MS;
    const { dispatchQueued } = await import("../dispatch");
    const SECOND = { ...ROW, row_id: "clay_row_second", id: "def" };

    queueBqRows([{ row_id: ROW.row_id }, { row_id: SECOND.row_id }]);
    queueBqRows([ROW]);
    queueBqRows([SECOND]);
    queueBqRows([]); // countCallsToday #1
    queueBqRows([]); // countCallsToday #2

    const call = vi.fn(async () => GOOD_RESULT);
    const outcomes = await dispatchQueued(2, call);

    expect(call).toHaveBeenCalledTimes(2);
    expect(outcomes).toHaveLength(2);
  });

  it("never alerts inside the window a call may legitimately still be running", async () => {
    // Someone sets the alert below the call timeout. A row sits on
    // 'dispatching' for exactly as long as its call runs, so honouring this
    // literally would report every slow-but-working task as stranded.
    process.env.PERPLEXITY_CALL_TIMEOUT_MS = String(15 * 60_000);
    process.env.REPLY_SWEEP_DISPATCHING_MINUTES = "5";
    const { sweepConfig } = await import("../sweeper");
    try {
      expect(sweepConfig().dispatchingAlertMinutes).toBeGreaterThan(15);
    } finally {
      delete process.env.REPLY_SWEEP_DISPATCHING_MINUTES;
    }
  });
});

describe("sweepRepliesGuarded — one pass at a time", () => {
  it("skips a tick while the previous pass is still running", async () => {
    const { sweepRepliesGuarded } = await import("../sweeper");

    // First pass: block inside the dispatch call so it is still in flight.
    let release: () => void = () => {};
    const blocked = new Promise<void>((r) => (release = r));

    queueBqRows([{ row_id: ROW.row_id }]); // findQueuedRows
    queueBqRows([ROW]); // getReplyItem
    queueBqRows([]); // countCallsToday
    queueBqRows([]); // findStuckDispatching
    queueBqRows([]); // findAncient
    queueBqRows([]); // findStuckDispatched

    const slow = vi.fn(async () => {
      await blocked;
      return GOOD_RESULT;
    });
    const first = sweepRepliesGuarded(slow);
    await new Promise((r) => setImmediate(r)); // let it reach the call

    // Second tick, while the first is still inside Perplexity.
    const secondCall = vi.fn(async () => GOOD_RESULT);
    const second = await sweepRepliesGuarded(secondCall);

    // null, not a zeroed summary: a skip must not be recorded as a run, or
    // /admin/status reports a lastRunAt for a pass that never happened.
    expect(second).toBeNull();
    // The overlapping tick called Perplexity zero times. That is the point:
    // the chase path has no claim, so a concurrent pass would pay twice.
    expect(secondCall).not.toHaveBeenCalled();

    release();
    expect(await first).not.toBeNull();
  });

  it("runs normally again once the previous pass has finished", async () => {
    const { sweepRepliesGuarded } = await import("../sweeper");
    for (let i = 0; i < 2; i++) {
      queueBqRows([]); // findQueuedRows
      queueBqRows([]); // findStuckDispatching
      queueBqRows([]); // findAncient
      queueBqRows([]); // findStuckDispatched
      expect(
        await sweepRepliesGuarded(vi.fn(async () => GOOD_RESULT)),
      ).not.toBeNull();
    }
  });
});

describe("a refusal at dispatch is seen, not just logged", () => {
  it("out of credit: puts the row back, halts the account, alerts once", async () => {
    const { dispatchReply } = await import("../dispatch");
    const { isPerplexityHalted } = await import("../tokens");

    const out = await dispatchReply(ROW, async () => ({
      event: "insufficient_credits",
      text: "no credits remaining",
    }));

    // Not 'failed'. The task never ran, so there is nothing to duplicate by
    // sending it again — and a queued row drains by itself when the account is
    // topped up, instead of needing a person to re-queue it by hand.
    expect(out.status).toBe("skipped");
    const sql = writes()
      .map((w: any) => w.sql)
      .join(" ");
    expect(sql).toContain("SET state = 'queued'");
    const requeue = writes().find((w: { sql: string }) =>
      w.sql.includes("SET state = 'queued'"),
    );
    expect(requeue.sql).toContain(
      "state IN ('queued', 'failed', 'dispatching')",
    );
    expect(sql).not.toContain("state = 'failed'");

    // The row must NOT be called dispatched — that is what made the sweeper
    // fail it 15 minutes later for having no thread to chase.
    expect(sql).not.toContain("state = 'dispatched'");

    // Halted, so the next 34 replies are not dispatched into the same wall.
    expect(isPerplexityHalted("serif")).toBe(true);

    const posts = getMockState().fetch.calls.filter((c: any) =>
      String(c.url).includes("chat.postMessage"),
    );
    expect(posts.length).toBe(1);
    expect(JSON.parse(posts[0].init.body).text).toMatch(/out of credit/i);
  });

  it("halts once across many rows, not once per row", async () => {
    const { dispatchReply } = await import("../dispatch");
    const refuse = async () => ({ event: "insufficient_credits", text: "" });

    await dispatchReply(ROW, refuse);
    await dispatchReply({ ...ROW, row_id: "second" }, refuse);
    await dispatchReply({ ...ROW, row_id: "third" }, refuse);

    const posts = getMockState().fetch.calls.filter((c: any) =>
      String(c.url).includes("chat.postMessage"),
    );
    // One outage, one message. A per-row alert would have been 35 of them.
    expect(posts.length).toBe(1);
  });

  it("access_denied really is failed — re-sending it would be refused again", async () => {
    const { dispatchReply } = await import("../dispatch");
    const out = await dispatchReply(ROW, async () => ({
      event: "access_denied",
    }));

    expect(out.status).toBe("failed");
    const sql = writes()
      .map((w: any) => w.sql)
      .join(" ");
    expect(sql).toContain("state = 'failed'");
    expect(sql).not.toContain("SET state = 'queued'");
  });

  it("leaves the normal path alone — a result with no event still dispatches", async () => {
    const { dispatchReply } = await import("../dispatch");
    const { isPerplexityHalted } = await import("../tokens");

    // Real results have come back with neither event nor task_state. That
    // classifies as 'unknown' and must keep behaving exactly as before, or
    // this change breaks every working reply.
    const out = await dispatchReply(ROW, async () => ({
      thread_id: GOOD_RESULT.thread_id,
    }));

    expect(out.status).toBe("dispatched");
    expect(isPerplexityHalted("serif")).toBe(false);
    expect(
      writes()
        .map((w: any) => w.sql)
        .join(" "),
    ).toContain("state = 'dispatched'");
  });
});

describe("a reply that dies with no draft is never silent", () => {
  it("alerts when a dispatched row has no thread to chase", async () => {
    const { sweepReplies } = await import("../sweeper");

    queueBqRows([]); // findQueuedRows
    queueBqRows([]); // findStuckDispatching
    queueBqRows([]); // findAncient
    queueBqRows([{ row_id: ROW.row_id }]); // findStuckDispatched
    queueBqRows([{ ...ROW, pplx_thread_id: null, attempts: 1 }]); // getReplyItem
    queueBqRows([]); // countCallsToday
    queueBqRows([{ attempts: 1 }]); // recordChaseAttempt read-back

    const summary = await sweepReplies(vi.fn(async () => GOOD_RESULT));

    expect(summary.failed).toBeGreaterThan(0);
    const posts = getMockState().fetch.calls.filter((c: any) =>
      String(c.url).includes("chat.postMessage"),
    );
    expect(posts.length).toBeGreaterThan(0);
    const text = posts.map((c: any) => JSON.parse(c.init.body).text).join(" ");
    // The message has to say the reply survived and how to get it back, or it
    // reads like the reply was lost.
    expect(text).toMatch(/no draft/i);
    expect(text).toMatch(/requeue-failed-replies/);
  });
});
