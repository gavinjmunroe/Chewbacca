import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), write: vi.fn() }));
vi.mock("../../bigquery/client", () => ({
  BigQueryClient: class {
    executeQuery = mocks.query;
    executeWrite = mocks.write;
  },
}));
import { humanDisposition, recordCardAction } from "../card-actions";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.write.mockResolvedValue({ success: true });
});
it("scopes human decisions to the tenant, campaign, prospect and inbound boundary", async () => {
  await expect(
    humanDisposition(
      "zeutara",
      " Lead@Test.com ",
      2,
      "2026-10-15T18:00:00Z",
      "reply-A",
    ),
  ).resolves.toBeNull();
  expect(mocks.query.mock.calls[0][1]).toEqual({
    clientId: "zeutara",
    email: "lead@test.com",
    campaignId: "2",
    inboundAt: "2026-10-15T18:00:00Z",
    inboundId: "reply-A",
  });
  expect(mocks.query.mock.calls[0][0]).toContain(
    "acted_at >= TIMESTAMP(@inboundAt)",
  );
  mocks.query.mockResolvedValue({ rows: [{ reply_thread_id: "reply-A" }] });
  await expect(
    humanDisposition(
      "zeutara",
      "lead@test.com",
      2,
      "2026-10-15T18:00:00Z",
      "reply-A",
    ),
  ).resolves.toBe("closed");
});
it("refuses to acknowledge a human skip that was not persisted", async () => {
  mocks.write.mockRejectedValue(new Error("database unavailable"));
  await expect(
    recordCardAction(
      "zeutara",
      { leadEmail: "lead@test.com", campaignId: 2, inReplyTo: "reply-A" },
      "skipped",
      "jonah",
      true,
    ),
  ).rejects.toThrow("database unavailable");
  await expect(
    recordCardAction(
      "zeutara",
      { leadEmail: "lead@test.com", campaignId: 2 },
      "sent",
      "togari",
    ),
  ).resolves.toBeUndefined();
});
it("fails closed when the human decision cannot be read", async () => {
  mocks.query.mockRejectedValue(new Error("database unavailable"));
  await expect(
    humanDisposition(
      "zeutara",
      "lead@test.com",
      2,
      "2026-10-15T18:00:00Z",
      "reply-A",
    ),
  ).rejects.toThrow("database unavailable");
});
it("persists the card's original inbound identity before acknowledging it", async () => {
  await recordCardAction(
    "zeutara",
    { leadEmail: "lead@test.com", campaignId: 2, inReplyTo: "reply-A" },
    "skipped",
    "jonah",
    true,
  );
  expect(mocks.write.mock.calls[0][1].inReplyTo).toBe("reply-A");
});
it("holds legacy actions without falsely closing an identified inbound", async () => {
  mocks.query.mockResolvedValue({ rows: [{ reply_thread_id: null }] });
  await expect(
    humanDisposition(
      "zeutara",
      "lead@test.com",
      2,
      "2026-10-15T18:00:00Z",
      "reply-B",
    ),
  ).resolves.toBe("legacy_hold");
  expect(mocks.query.mock.calls[0][1].inboundId).toBe("reply-B");
  await expect(
    humanDisposition("zeutara", "lead@test.com", 2, "2026-10-15T18:00:00Z", ""),
  ).resolves.toBe("legacy_hold");
});
it("does not persist a new ambiguous human decision without an original message", async () => {
  await expect(
    recordCardAction(
      "zeutara",
      { leadEmail: "lead@test.com", campaignId: 2 },
      "skipped",
      "jonah",
      true,
    ),
  ).rejects.toThrow("original inbound identity");
  expect(mocks.write).not.toHaveBeenCalled();
});
