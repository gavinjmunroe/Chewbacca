import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  thread: vi.fn(),
  schedule: vi.fn(),
  receipt: vi.fn(),
  humanClosed: vi.fn(),
}));
vi.mock("../card-actions", () => ({ humanDisposition: mocks.humanClosed }));
vi.mock("../vantage-outbox", () => ({ retainVantageReceipt: mocks.receipt }));
vi.mock("../../bigquery/client", () => ({
  BigQueryClient: class {
    executeQuery = mocks.read;
    executeWrite = mocks.write;
  },
}));
vi.mock("../../integrations/clay/campaign-read", () => ({
  thread: mocks.thread,
}));
vi.mock("../conversation-cycle", () => ({
  scheduleConversationFollowup: mocks.schedule,
  followupAttempt: () => 0,
  followupDisposition: () => "send",
}));
import { reconcileFollowups } from "../followup-recovery";
import { getReplybotClient } from "../../agents/replybot/client-config";
const row = {
  id: "ooo:r1",
  lead_id: 1,
  campaign_id: 2,
  lead_email: "lead@test.com",
  thread_id: "old",
  created_at: "2026-10-10T18:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.humanClosed.mockResolvedValue(null);
  mocks.read.mockImplementation(async (sql: string) =>
    sql.includes("waiting_on_principal") ? { rows: [] } : { rows: [row] },
  );
  mocks.schedule.mockResolvedValue(undefined);
  mocks.thread.mockResolvedValue([
    { type: "REPLY", time: "2026-10-09T18:00:00Z" },
    { type: "SENT", messageId: "new", time: "2026-10-11T18:00:00Z" },
  ]);
});
describe("follow-up receipt recovery", () => {
  it("cancels follow-through after a human closes the conversation while retaining actual sends", async () => {
    mocks.humanClosed.mockResolvedValue("closed");
    await reconcileFollowups(getReplybotClient("zeutara")!);
    expect(mocks.receipt).toHaveBeenCalledOnce();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.write.mock.calls[0][1].status).toBe("cancelled");
  });
  it("retains a sent receipt before cancelling work superseded by a new inbound", async () => {
    const sent = {
      type: "SENT",
      messageId: "new",
      time: "2026-10-11T18:00:00Z",
    };
    mocks.thread.mockResolvedValue([
      sent,
      { type: "REPLY", time: "2026-10-12T18:00:00Z" },
    ]);
    await reconcileFollowups(getReplybotClient("zeutara")!);
    expect(mocks.receipt).toHaveBeenCalledWith("zeutara", row.lead_email, sent);
    expect(mocks.receipt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.write.mock.invocationCallOrder[0],
    );
    expect(mocks.write.mock.calls[0][0]).toContain("status = 'cancelled'");
  });
  it("restores an uncertain OOO send without relying on the original reply row", async () => {
    await reconcileFollowups(getReplybotClient("zeutara")!);
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][0]).toContain("status = 'sent'");
    expect(mocks.schedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.write.mock.invocationCallOrder[0],
    );
  });
  it("cancels old work when the investor has replied again", async () => {
    mocks.thread.mockResolvedValue([
      { type: "REPLY", time: "2026-10-12T18:00:00Z" },
    ]);
    await reconcileFollowups(getReplybotClient("zeutara")!);
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.write.mock.calls[0][0]).toContain("status = 'cancelled'");
  });
  it("rotates missing identities without resending", async () => {
    mocks.read.mockResolvedValue({ rows: [{ ...row, lead_id: null }] });
    await reconcileFollowups(getReplybotClient("zeutara")!);
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.write.mock.calls[0][0]).toContain("TIMESTAMP_ADD");
  });
  // Independent review, 2026-10-17: nothing ever read waiting_on_principal.
  it("cancels a row parked for the principal once the investor writes again, and keeps it otherwise", async () => {
    const parked = {
      id: "ooo:p1",
      lead_id: 1,
      campaign_id: 2,
      lead_email: "lead@test.com",
      created_at: "2026-10-12T00:00:00Z",
    };
    mocks.read.mockImplementation(async (sql: string) =>
      sql.includes("waiting_on_principal") ? { rows: [parked] } : { rows: [] },
    );
    mocks.thread.mockResolvedValue([
      { type: "REPLY", messageId: "r1", time: "2026-10-11T00:00:00Z" },
    ]);
    await reconcileFollowups(getReplybotClient("zeutara")!);
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.thread.mockResolvedValue([
      { type: "REPLY", messageId: "r2", time: "2026-10-13T00:00:00Z" },
    ]);
    await reconcileFollowups(getReplybotClient("zeutara")!);
    expect(mocks.write).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      expect.objectContaining({ id: "ooo:p1" }),
    );
  });
});
