import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  read: vi.fn(),
  log: vi.fn(),
  exists: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../../bigquery/client", () => ({
  BigQueryClient: class {
    executeWrite = mocks.write;
    executeQuery = mocks.read;
    getClient() {
      return {
        dataset: () => ({
          table: () => ({ exists: mocks.exists, create: mocks.create }),
        }),
      };
    }
  },
}));
vi.mock("../vantage", () => ({
  vantageEnabled: () => true,
  vantageLogSent: mocks.log,
}));
import { flushVantageReceipts, retainVantageReceipt } from "../vantage-outbox";
const sent = {
  type: "SENT" as const,
  messageId: "provider-1",
  from: "sender@example.com",
  to: "investor@example.com",
  subject: "Re: Deck",
  body: "The deck is ready",
  time: "2026-10-15T19:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.exists.mockResolvedValue([true]);
  mocks.write.mockResolvedValue({ success: true, numDmlAffectedRows: "1" });
  mocks.read.mockResolvedValue({
    rows: [
      {
        payload: JSON.stringify({
          to_email: sent.to,
          from_email: sent.from,
          subject: sent.subject,
          text: sent.body,
          sent_at: sent.time,
        }),
      },
    ],
  });
  mocks.log.mockResolvedValue(undefined);
});
describe("durable Vantage receipts", () => {
  it("persists a confirmed receipt before calling Vantage and records success after", async () => {
    await retainVantageReceipt("zeutara", sent.to, sent);
    const merge = mocks.write.mock.calls.findIndex(([sql]) =>
      sql.startsWith("MERGE"),
    );
    expect(merge).toBeGreaterThanOrEqual(0);
    expect(mocks.write.mock.invocationCallOrder[merge]).toBeLessThan(
      mocks.log.mock.invocationCallOrder[0],
    );
    expect(mocks.write.mock.calls.at(-1)?.[0]).toContain(
      "status = 'delivered'",
    );
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ from_email: sent.from, sent_at: sent.time }),
    );
  });
  it("does not contact Vantage when the durable insert fails", async () => {
    mocks.write.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(
      retainVantageReceipt("zeutara", sent.to, sent),
    ).rejects.toThrow("storage unavailable");
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("keeps failed logs pending and retries them without needing a reply card", async () => {
    mocks.log.mockRejectedValueOnce(new Error("Vantage unavailable"));
    await expect(
      retainVantageReceipt("zeutara", sent.to, sent),
    ).rejects.toThrow("Vantage unavailable");
    expect(mocks.write.mock.calls.at(-1)?.[0]).toContain("status = 'pending'");
    mocks.read.mockResolvedValueOnce({ rows: [{ id: "saved-receipt" }] });
    await flushVantageReceipts("zeutara");
    expect(mocks.log).toHaveBeenCalledTimes(2);
    expect(mocks.write.mock.calls.at(-1)?.[0]).toContain(
      "status = 'delivered'",
    );
  });
  it("does not log an already delivered or currently claimed receipt again", async () => {
    mocks.write.mockResolvedValue({ numDmlAffectedRows: "0" });
    await retainVantageReceipt("zeutara", sent.to, sent);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("parks a receipt with no text instead of retrying it forever", async () => {
    // Akbar's blank 2026-10-16 email drew a 400 from Vantage every five minutes.
    mocks.read.mockResolvedValueOnce({ rows: [{ id: "blank-receipt" }] });
    mocks.read.mockResolvedValueOnce({
      rows: [
        {
          payload: JSON.stringify({
            to_email: sent.to,
            from_email: sent.from,
            subject: "",
            text: "",
            sent_at: sent.time,
          }),
        },
      ],
    });
    await flushVantageReceipts("zeutara");
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.write.mock.calls.at(-1)?.[0]).toContain(
      "status = 'dead_letter'",
    );
  });
  it("refuses an acknowledgment without a provider message identity", async () => {
    await expect(
      retainVantageReceipt("zeutara", sent.to, { ...sent, messageId: "" }),
    ).rejects.toThrow("complete provider send receipt");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
