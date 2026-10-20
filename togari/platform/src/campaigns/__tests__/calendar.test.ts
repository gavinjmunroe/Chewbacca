import { afterEach, describe, expect, it } from "vitest";
import { getMockState, onFetch, queueBqRows } from "../../../tests/smoke/helpers";
import {
  DAILY_SQL,
  FOLLOWUPS_SQL,
  SPANS_SQL,
  WAITING_SQL,
  WEEKLY_SQL,
  buildCalendar,
  monthDays,
  parseMonth,
  shiftMonth,
  spanOf,
  todayIn,
  weekStart,
} from "../calendar";

describe("calendar dates", () => {
  it("pads a month out to whole Monday-to-Sunday weeks", () => {
    const days = monthDays("2026-10");
    expect(days[0]).toBe("2026-09-28");
    expect(days[days.length - 1]).toBe("2026-11-01");
    expect(days).toHaveLength(35);
    // February 2027 starts on a Monday and ends on a Sunday: four weeks exactly.
    expect(monthDays("2027-02")).toHaveLength(28);
  });

  it("finds a week's Monday", () => {
    expect(weekStart("2026-10-14")).toBe("2026-10-12");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
  });

  it("reads ?m= or falls back to this month", () => {
    expect(parseMonth("2026-09", "2026-10-14")).toBe("2026-09");
    expect(parseMonth("2026-13", "2026-10-14")).toBe("2026-10");
    expect(parseMonth("'; DROP", "2026-10-14")).toBe("2026-10");
    expect(parseMonth(undefined, "2026-10-14")).toBe("2026-10");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("takes today in the client's timezone", () => {
    // 01:30 UTC on the 15th is still the 14th in New York.
    expect(todayIn("America/New_York", Date.parse("2026-10-15T01:30:00Z"))).toBe(
      "2026-10-14",
    );
  });

  it("spans a campaign over its planned dates and its sends together", () => {
    const c = {
      id: "1",
      name: "x",
      channel: "email" as const,
      first_send: "2026-10-05",
      last_send: "2026-10-09",
      planned_start: "2026-10-01",
      planned_end: null,
    };
    expect(spanOf(c)).toEqual({ from: "2026-10-01", to: "2026-10-09" });
    expect(
      spanOf({ ...c, first_send: null, last_send: null, planned_start: null }),
    ).toBeNull();
  });
});

describe("calendar SQL", () => {
  // The first live run (2026-10-14) failed on "AS at": AT is reserved in
  // BigQuery, and the test mocks never parse SQL. Checked here instead.
  const RESERVED = new Set(
    ("ALL AND ANY ARRAY AS ASC AT BETWEEN BY CASE CAST COLLATE CONTAINS CREATE CROSS CUBE " +
      "CURRENT DEFAULT DEFINE DESC DISTINCT ELSE END ENUM ESCAPE EXCEPT EXCLUDE EXISTS EXTRACT " +
      "FALSE FETCH FOLLOWING FOR FROM FULL GROUP GROUPING GROUPS HASH HAVING IF IGNORE IN INNER " +
      "INTERSECT INTERVAL INTO IS JOIN LATERAL LEFT LIKE LIMIT LOOKUP MERGE NATURAL NEW NO NOT " +
      "NULL NULLS OF ON OR ORDER OUTER OVER PARTITION PRECEDING PROTO QUALIFY RANGE RECURSIVE " +
      "RESPECT RIGHT ROLLUP ROWS SELECT SET SOME STRUCT TABLESAMPLE THEN TO TREAT TRUE " +
      "UNBOUNDED UNION UNNEST USING WHEN WHERE WINDOW WITH WITHIN").split(" "),
  );
  it.each(Object.entries({ WEEKLY_SQL, DAILY_SQL, SPANS_SQL, WAITING_SQL, FOLLOWUPS_SQL }))(
    "%s names nothing with a reserved word",
    (_name, sql) => {
      const names = [...sql.matchAll(/\bAS\s+([A-Za-z_]\w*)/gi)].map((m) => m[1].toUpperCase());
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => RESERVED.has(n))).toEqual([]);
    },
  );
});

describe("buildCalendar", () => {
  const stats = (o: Record<string, number>) => ({
    sent: 0, leads: 0, replied: 0, interested: 0, needs_read: 0, later: 0,
    pass: 0, opt_out: 0, redirect: 0, ooo: 0, bounces: 0, ...o,
  });

  it("assembles weeks, days, campaigns and who is waiting from five reads", async () => {
    // Order matches the Promise.all in buildCalendar.
    queueBqRows([
      { week: "2026-10-12", ckey: "907", ...stats({ sent: 400, leads: 380, replied: 17, ooo: 6 }) },
      { week: "2026-10-12", ckey: "*", ...stats({ sent: 412, leads: 390, replied: 19, ooo: 6 }) },
    ]);
    queueBqRows([
      { day: "2026-10-13", ckey: "907", sent: 200 },
      { day: "2026-10-13", ckey: "911", sent: 12 },
    ]);
    queueBqRows([
      { ckey: "907", name: "Payer data | Health systems", first_send: "2026-10-05", last_send: "2026-10-14", planned_start: null, planned_end: "2026-10-30" },
      { ckey: "911", name: "Payers | Q3", first_send: "2026-10-13", last_send: "2026-10-13", planned_start: null, planned_end: null },
      // Ran in the summer; nothing to draw in October.
      { ckey: "800", name: "Old", first_send: "2026-06-01", last_send: "2026-06-30", planned_start: null, planned_end: null },
    ]);
    queueBqRows([
      { lead: "cfo@examplehealth.com", name: "Dana Reyes", campaign_id: "907", campaign: "Payer data | Health systems", outcome: "interested", replied_at: "2026-10-13T15:00:00Z", day: "2026-10-13" },
    ]);
    queueBqRows([]);
    // A conference named after an email campaign, and one with no campaign yet.
    queueBqRows([
      { plan_id: "p1", name: "Payer data", start_day: "2026-10-01", end_day: "2026-10-31" },
      { plan_id: "p2", name: "HFMA Region 4", start_day: "2026-10-26", end_day: "2026-11-06" },
    ]);

    const s = await buildCalendar("serif", "2026-10", Date.parse("2026-10-14T16:00:00Z"));

    expect(s.client).toBe("Serif Health");
    expect(s.campaigns.find((c) => c.id === "907")).toMatchObject({ planned_start: "2026-10-01", planned_end: "2026-10-31" });
    expect(s.campaigns.find((c) => c.id === "plan:p2")).toMatchObject({ channel: "plan", name: "HFMA Region 4" });
    expect(s.plans).toHaveLength(2);
    expect(s.tz).toBe("America/New_York");
    expect(s.today).toBe("2026-10-14");
    expect(s.weeks["2026-10-12"]["*"].replied).toBe(19);
    expect(s.weeks["2026-10-12"]["907"].sent).toBe(400);
    expect(s.daily["2026-10-13"]).toEqual({ "907": 200, "911": 12, "*": 212 });
    expect(s.campaigns.map((c) => c.id)).toEqual(["907", "911", "plan:p2"]);
    expect(s.waiting[0]).toMatchObject({ lead: "cfo@examplehealth.com", channel: "email" });
    // Serif's LinkedIn is configured but this test sets no HeyReach key.
    expect(s.linkedin).toBeNull();
    expect(s.notes).toEqual(["LinkedIn numbers aren't connected yet."]);

    const queries = getMockState().bq.queries;
    expect(queries).toHaveLength(6);
    expect(queries[5].sql).toContain("calendar_plans");
    expect(queries[2].sql).toContain("campaign_status");
    for (const q of queries) expect(q.params.clientId).toBe("serif");
    expect(queries[0].params).toMatchObject({ from: "2026-09-28", to: "2026-11-01", tz: "America/New_York" });
    // Out-of-office and automatic replies never count as replied.
    expect(queries[0].sql).toContain("outcome NOT IN ('ooo', 'auto')");
    // Waiting means no card was sent, skipped or done since the reply.
    expect(queries[3].sql).toContain("reply_card_actions");
  });

  describe("with HeyReach connected", () => {
    afterEach(() => {
      delete process.env.SERIF_HEYREACH_API_KEY;
    });

    it("adds LinkedIn campaigns, weeks and waiting conversations", async () => {
      process.env.SERIF_HEYREACH_API_KEY = "hr-test-key";
      onFetch("/campaign/GetAll", {
        totalCount: 2,
        items: [
          { id: 501, name: "HFMA Region 2", status: "IN_PROGRESS" },
          { id: 502, name: "Not started", status: "DRAFT" },
        ],
      });
      onFetch("/stats/GetOverallStats", {
        byDayStats: {
          "2026-10-13T00:00:00Z": { connectionsSent: 40, connectionsAccepted: 9, messagesSent: 9, totalMessageStarted: 9, totalMessageReplies: 2 },
          "2026-10-14T00:00:00Z": { connectionsSent: 30, connectionsAccepted: 4, messagesSent: 4, totalMessageStarted: 4, totalMessageReplies: 1 },
        },
      });
      onFetch("/inbox/GetConversationsV2", {
        items: [
          {
            lastMessageSender: "CORRESPONDENT",
            lastMessageAt: "2026-10-14T15:32:00Z",
            lastMessageText: "Interested, can we set up a call?",
            correspondentProfile: { firstName: "Glenn", lastName: "Krauss", profileUrl: "https://www.linkedin.com/in/glenn-krauss-93521a19" },
          },
        ],
      });
      for (let i = 0; i < 4; i++) queueBqRows([]);
      queueBqRows([]);

      const s = await buildCalendar("serif", "2026-10", Date.parse("2026-10-14T20:00:00Z"));

      expect(s.notes).toEqual([]);
      expect(s.campaigns).toEqual([
        expect.objectContaining({ id: "li:501", name: "HFMA Region 2", channel: "linkedin", first_send: "2026-10-13", last_send: "2026-10-14" }),
      ]);
      expect(s.linkedin!.weeks["2026-10-12"]["*"]).toMatchObject({ requests: 70, accepted: 13, messaged: 13, replied: 3, interested: 1 });
      expect(s.linkedin!.daily["2026-10-13"]).toEqual({ "li:501": 49, "*": 49 });
      expect(s.waiting).toEqual([
        expect.objectContaining({ name: "Glenn Krauss", channel: "linkedin", campaign: "HFMA Region 2", outcome: "interested" }),
      ]);
      const calls = getMockState().fetch.calls.filter((c: any) => c.url.includes("heyreach"));
      expect(calls.every((c: any) => c.init.headers["X-API-KEY"] === "hr-test-key")).toBe(true);
      // The draft campaign's numbers were never asked for.
      const stats = calls.filter((c: any) => c.url.includes("GetOverallStats"));
      expect(stats.map((c: any) => JSON.parse(c.init.body).campaignIds)).toEqual([[501]]);
    });

    it("keeps LinkedIn when the email tables can't be read", async () => {
      process.env.SERIF_HEYREACH_API_KEY = "hr-test-key";
      onFetch("/campaign/GetAll", { items: [{ id: 501, name: "HFMA Region 2", status: "IN_PROGRESS" }] });
      onFetch("/stats/GetOverallStats", {
        byDayStats: { "2026-10-13T00:00:00Z": { connectionsSent: 40 } },
      });
      onFetch("/inbox/GetConversationsV2", { items: [] });
      const { BigQueryClient } = await import("../../bigquery/client");
      const real = BigQueryClient.prototype.executeQuery;
      BigQueryClient.prototype.executeQuery = async function (sql: string, params?: any) {
        if (sql.includes("campaign_events")) throw new Error("Not found: Table campaign_events");
        return real.call(this, sql, params);
      };
      try {
        const s = await buildCalendar("serif", "2026-10");
        expect(s.campaigns.map((c) => c.id)).toEqual(["li:501"]);
        expect(s.notes).toEqual(["Email numbers couldn't be loaded just now."]);
      } finally {
        BigQueryClient.prototype.executeQuery = real;
      }
    });

    it("keeps the email side when HeyReach is down", async () => {
      process.env.SERIF_HEYREACH_API_KEY = "hr-test-key";
      onFetch("/campaign/GetAll", () => ({ ok: false, status: 503, json: async () => ({}) }));
      for (let i = 0; i < 5; i++) queueBqRows([]);
      const s = await buildCalendar("serif", "2026-10");
      expect(s.linkedin).toBeNull();
      expect(s.notes).toEqual(["LinkedIn numbers couldn't be loaded just now."]);
    });
  });

  it("refuses a client without a calendar", async () => {
    await expect(buildCalendar("amber", "2026-10")).rejects.toThrow(
      /No campaign calendar/,
    );
  });
});
