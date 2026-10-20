import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  pending: vi.fn(),
  state: vi.fn(),
  thread: vi.fn(),
  schedule: vi.fn(),
  receipt: vi.fn(),
  flush: vi.fn(),
  get: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  expected: vi.fn(),
  send: vi.fn(),
  notice: vi.fn(),
  humanClosed: vi.fn(),
}));
vi.mock("../card-actions", () => ({ humanDisposition: mocks.humanClosed }));
vi.mock("../../agents/smartlead-responder/index", () => ({
  slackPostMessage: mocks.notice,
}));
vi.mock("../vantage-outbox", () => ({
  retainVantageReceipt: mocks.receipt,
  flushVantageReceipts: mocks.flush,
}));
vi.mock("../followup-recovery", () => ({ reconcileFollowups: vi.fn() }));
vi.mock("../store", () => ({
  pendingResults: mocks.pending,
  reconcileResultState: mocks.state,
  getReplyItem: mocks.get,
  claimReviewedReply: mocks.claim,
  finishReplyResult: mocks.finish,
  saveExpectedReply: mocks.expected,
}));
vi.mock("../../integrations/clay/campaign-read", () => ({
  thread: mocks.thread,
}));
vi.mock("../conversation-cycle", () => ({
  scheduleConversationFollowup: mocks.schedule,
  settleDeckPromises: vi.fn(),
}));
import { reconcileReplyResults } from "../result-recovery";
import { getReplybotClient } from "../../agents/replybot/client-config";
import { ReplyPreflightError } from "../delivery";
const row = {
  row_id: "r1",
  state: "delivery_unknown",
  lead_id: 1,
  campaign_id: 2,
  from_address: "lead@test.com",
  received_at: "2026-10-14T18:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.humanClosed.mockResolvedValue(null);
  mocks.pending.mockResolvedValue([row]);
  mocks.schedule.mockResolvedValue(undefined);
  mocks.claim.mockResolvedValue(true);
  mocks.get.mockResolvedValue({
    row_id: "r1",
    client_id: "zeutara",
    campaign: "Zeutara | Qube Finance | Seed",
    email_thread_id: "inbound",
    from_address: "lead@test.com",
    sender_account: "jonah@test.com",
    subject: "Re: Qube",
    body: "What is the round size?",
    lead_id: 1,
    campaign_id: 2,
    lead_name: "Lead",
  });
  mocks.send.mockResolvedValue(undefined);
  mocks.thread.mockResolvedValue([
    { type: "SENT", messageId: "s1", time: "2026-10-14T19:00:00Z" },
  ]);
});
describe("reply reconciliation", () => {
  it("retains a failed forward as awaiting repair instead of marking it done", async () => {
    mocks.pending.mockResolvedValue([{ ...row, state: "awaiting_review" }]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "bounce",
        body: "Your message wasn't delivered to referral@fund.com",
        time: row.received_at,
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.state).toHaveBeenCalledWith(
      "r1",
      "awaiting_review",
      "awaiting_review",
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not count a generic sent acknowledgment as repair of a failed referral", async () => {
    mocks.pending.mockResolvedValue([{ ...row, state: "awaiting_review" }]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "bounce",
        body: "Mail delivery failed.",
        time: row.received_at,
      },
      {
        type: "SENT",
        messageId: "ack",
        body: "Thanks",
        time: "2026-10-14T19:00:00Z",
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.state).toHaveBeenCalledWith(
      "r1",
      "awaiting_review",
      "awaiting_review",
    );
    expect(mocks.receipt).toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("does not apply an older card decision while provider history is behind the queued inbound", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        received_at: "2026-10-14T20:00:00Z",
        draft: "Here are the current round details. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "reply-A",
        body: "What is the round size?",
        time: row.received_at,
      },
    ]);
    mocks.humanClosed.mockResolvedValue("closed");
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.humanClosed).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.state).toHaveBeenCalledWith(
      "r1",
      "awaiting_review",
      "awaiting_review",
    );
  });
  it("keeps unbound legacy decisions visible without sending or claiming completion", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft: "Thanks for the question. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "reply-B",
        body: "What is the round size?",
        time: row.received_at,
      },
    ]);
    mocks.humanClosed.mockResolvedValue("legacy_hold");
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.state).toHaveBeenCalledWith(
      "r1",
      "awaiting_review",
      "awaiting_review",
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("leaves unclassified old replies for deliberate disposition instead of sending a stale draft", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft: "Thanks for the response. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "reply-B",
        body: "We do not invest in individual deals unless they are our own",
        time: row.received_at,
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("keeps a human skip terminal after its former preflight blocker clears", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft: "Thanks for your question. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "inbound",
        body: "What is the round size?",
        time: row.received_at,
      },
    ]);
    mocks.humanClosed.mockResolvedValue("closed");
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.state).toHaveBeenCalledWith("r1", "awaiting_review", "done");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  afterEach(() => vi.unstubAllEnvs());
  it("never drains live review drafts while a test-client override is set", async () => {
    vi.stubEnv("REPLIES_FORCE_CLIENT_ID", "serif_test");
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft: "Thanks for the clarification. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "inbound",
        body: "What is the round size?",
        time: row.received_at,
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("retries an exact current review draft once after its blocker clears", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft:
          "Thanks for the clarification. We will stay with our decision. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "inbound",
        body: "What is the round size?",
        time: row.received_at,
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.claim).toHaveBeenCalledWith(
      "zeutara",
      "r1",
      expect.any(String),
    );
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][1].requireUnanswered).toBe(true);
    expect(mocks.expected.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.send.mock.invocationCallOrder[0],
    );
    expect(mocks.finish).toHaveBeenCalledWith("r1", "done", "zeutara");
    expect(mocks.notice).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "zeutara" }),
      expect.objectContaining({ text: "Reply confirmed for lead@test.com." }),
    );
  });
  it("does not retry a stale draft or a claim another worker won", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft: "Thanks for the clarification. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        body: "What is the round size?",
        time: "2026-10-14T20:00:00Z",
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "inbound",
        body: "What is the round size?",
        time: row.received_at,
      },
    ]);
    mocks.claim.mockResolvedValue(false);
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("holds uncertain delivery and only retries proven preflight failures", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft: "Thanks for the clarification. Jonah",
      },
    ]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        messageId: "inbound",
        body: "What is the round size?",
        time: row.received_at,
      },
    ]);
    mocks.send.mockRejectedValueOnce(new Error("delivery connection dropped"));
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.finish).toHaveBeenCalledWith(
      "r1",
      "delivery_unknown",
      "zeutara",
    );
    mocks.send.mockRejectedValueOnce(
      new ReplyPreflightError("Vantage unavailable"),
    );
    await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    expect(mocks.finish).toHaveBeenLastCalledWith(
      "r1",
      "awaiting_review",
      "zeutara",
    );
  });
  it("keeps forms, referrals and conditional timing requests out of draft retries", async () => {
    mocks.pending.mockResolvedValue([
      {
        ...row,
        state: "awaiting_review",
        draft: "Thanks for the clarification. Jonah",
      },
    ]);
    for (const body of [
      "Please submit our intake form",
      "Please contact nathan@afore.vc",
      "Happy to chat once they identify a lead",
    ]) {
      mocks.thread.mockResolvedValue([
        { type: "REPLY", body, time: row.received_at },
      ]);
      await reconcileReplyResults(getReplybotClient("zeutara")!, mocks.send);
    }
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("retains every old send even after a newer inbound and a done card", async () => {
    mocks.pending.mockResolvedValue([{ ...row, state: "done" }]);
    const first = {
      type: "SENT",
      messageId: "s1",
      time: "2026-10-14T19:00:00Z",
    };
    const second = {
      type: "SENT",
      messageId: "s2",
      time: "2026-10-14T19:30:00Z",
    };
    mocks.thread.mockResolvedValue([
      first,
      second,
      {
        type: "REPLY",
        body: "What is the round size?",
        time: "2026-10-14T20:00:00Z",
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!);
    expect(mocks.flush).toHaveBeenCalledWith("zeutara");
    expect(mocks.receipt).toHaveBeenCalledWith(
      "zeutara",
      row.from_address,
      first,
    );
    expect(mocks.receipt).toHaveBeenCalledWith(
      "zeutara",
      row.from_address,
      second,
    );
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.state).toHaveBeenCalledWith("r1", "done", "done");
  });
  it("keeps failed dispatches retryable and does not close unapplied opt-outs or later requests", async () => {
    for (const body of [
      "What is the round size?",
      "Please unsubscribe",
      "Happy to chat once they identify a lead",
    ]) {
      vi.clearAllMocks();
      mocks.pending.mockResolvedValue([{ ...row, state: "failed" }]);
      mocks.thread.mockResolvedValue([
        { type: "REPLY", body, time: "2026-10-14T20:00:00Z" },
      ]);
      await reconcileReplyResults(getReplybotClient("zeutara")!);
      expect(mocks.state).toHaveBeenCalledWith("r1", "failed", "failed");
    }
  });
  it("rotates missing identities so they cannot starve later work", async () => {
    mocks.pending.mockResolvedValue([
      { ...row, lead_id: 0 },
      { ...row, row_id: "r2" },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!);
    expect(mocks.state).toHaveBeenCalledWith(
      "r1",
      "delivery_unknown",
      "awaiting_review",
    );
    expect(mocks.state).toHaveBeenCalledWith("r2", "delivery_unknown", "done");
  });
  it("saves follow-through before marking delivered work done", async () => {
    await reconcileReplyResults(getReplybotClient("zeutara")!);
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.state).toHaveBeenCalledWith("r1", "delivery_unknown", "done");
    expect(mocks.schedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.state.mock.invocationCallOrder[0],
    );
  });
  it("keeps work unresolved while follow-through cannot be saved", async () => {
    mocks.schedule.mockRejectedValue(new Error("database down"));
    await reconcileReplyResults(getReplybotClient("zeutara")!);
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("keeps newer inbound work open and rotates unresolved rows", async () => {
    mocks.thread.mockResolvedValue([
      { type: "SENT", time: "2026-10-14T19:00:00Z" },
      { type: "REPLY", time: "2026-10-14T20:00:00Z" },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!);
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.state).toHaveBeenCalledWith(
      "r1",
      "delivery_unknown",
      "delivery_unknown",
    );
  });
  it("closes a failed card when the investor's latest reply is a pass", async () => {
    mocks.pending.mockResolvedValue([{ ...row, state: "failed" }]);
    mocks.thread.mockResolvedValue([
      {
        type: "REPLY",
        body: "We have a conflict and will pass",
        time: "2026-10-14T20:00:00Z",
      },
    ]);
    await reconcileReplyResults(getReplybotClient("zeutara")!);
    expect(mocks.state).toHaveBeenCalledWith("r1", "failed", "done");
  });
});
