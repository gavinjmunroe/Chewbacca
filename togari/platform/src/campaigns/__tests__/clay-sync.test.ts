import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../secrets/tenantSecrets", () => ({
  getTenantSecret: async () => "s",
  setTenantSecret: async () => {},
}));

import { countRows, mightHaveSent } from "../clay-sync";
import { dayWiseStats } from "../../integrations/clay/campaign-read";

const c = {
  id: 4121238,
  name: "Aggregate Arcadia Post Conference",
  status: "COMPLETED",
  createdAt: "2026-10-11T15:00:00Z",
  updatedAt: "2026-10-14T20:00:00Z",
};

describe("countRows", () => {
  it("adds only the sends past what is stored, numbered so a re-read repeats ids", () => {
    const rows = countRows("sent", c, "2026-10-13", 415, 417);
    expect(rows.map((r) => r.event_id)).toEqual([
      "clay:sent:4121238:2026-10-13:416",
      "clay:sent:4121238:2026-10-13:417",
    ]);
    expect(rows[0].occurred_at).toBe("2026-10-13T12:00:00.000Z");
    expect(countRows("bounce", c, "2026-10-13", 45, 45)).toEqual([]);
  });
});

describe("mightHaveSent", () => {
  it("skips campaigns made after the window and finished before it", () => {
    expect(mightHaveSent(c, "2026-10-12", "2026-10-15")).toBe(true);
    expect(mightHaveSent(c, "2026-10-15", "2026-10-16")).toBe(false);
    expect(mightHaveSent(c, "2026-10-01", "2026-10-10")).toBe(false);
    expect(
      mightHaveSent({ ...c, status: "ACTIVE", updatedAt: "2026-01-01" }, "2026-10-15", "2026-10-16"),
    ).toBe(true);
  });
});

describe("dayWiseStats", () => {
  afterEach(() => vi.unstubAllGlobals());
  const day = (date: string, sent: number) => ({
    date,
    emailEngagementMetrics: { sent, bounced: 1, uniqueLeadReached: sent },
  });
  const reply = (stats: unknown[]) =>
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      headers: { getSetCookie: () => [] },
      json: async () => ({ dayWiseStats: stats }),
    }));

  // Clay's labels carry no year ("12 Oct"), as read from Serif's on 2026-10-16.
  it("dates each day in order and reads its counts", async () => {
    reply([day("12 Oct", 198), day("13 Oct", 417)]);
    expect(
      await dayWiseStats("t1", "1", 4121238, "2026-10-12", "2026-10-13", "America/New_York"),
    ).toEqual([
      { day: "2026-10-12", sent: 198, bounced: 1, leads: 198 },
      { day: "2026-10-13", sent: 417, bounced: 1, leads: 417 },
    ]);
  });

  it("refuses a day that is not the one due", async () => {
    reply([day("13 Oct", 1)]);
    await expect(
      dayWiseStats("t2", "1", 1, "2026-10-12", "2026-10-12", "America/New_York"),
    ).rejects.toThrow(/13 Oct/);
  });
});
