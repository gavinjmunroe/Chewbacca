import { describe, expect, it } from "vitest";
import { getMockState, onFetch } from "../../../../tests/smoke/helpers";
import {
  conversations,
  dailyStats,
  listCampaigns,
  readConversation,
} from "../client";

describe("HeyReach reads", () => {
  it("lists campaigns a page at a time", async () => {
    const page = (start: number, n: number) => ({
      items: Array.from({ length: n }, (_, i) => ({
        id: start + i,
        name: `Campaign ${start + i}`,
        status: "in_progress",
      })),
    });
    let calls = 0;
    onFetch("/campaign/GetAll", () => (calls++ === 0 ? page(1, 100) : page(101, 3)));
    const list = await listCampaigns("k");
    expect(list).toHaveLength(103);
    expect(list[0]).toEqual({ id: "1", name: "Campaign 1", status: "IN_PROGRESS" });
    const bodies = getMockState().fetch.calls.map((c: any) => JSON.parse(c.init.body));
    expect(bodies).toEqual([{ offset: 0, limit: 100 }, { offset: 100, limit: 100 }]);
  });

  it("turns HeyReach's day stats into one row per UTC day, InMail included", async () => {
    onFetch("/stats/GetOverallStats", {
      byDayStats: {
        "2026-10-13T00:00:00Z": {
          connectionsSent: 40, connectionsAccepted: 9, messagesSent: 9,
          totalMessageStarted: 9, totalMessageReplies: 2,
          inmailMessagesSent: 1, totalInmailStarted: 1, totalInmailReplies: 1,
        },
        nonsense: {},
      },
    });
    const days = await dailyStats("k", "501", "2026-09-28", "2026-11-01");
    expect(days).toEqual({
      "2026-10-13": { requests: 40, accepted: 9, messaged: 10, messagesSent: 10, replied: 3 },
    });
    const body = JSON.parse(getMockState().fetch.calls[0].init.body);
    expect(body).toEqual({
      accountIds: [],
      campaignIds: [501],
      startDate: "2026-09-28T00:00:00.000Z",
      endDate: "2026-11-01T23:59:59.999Z",
    });
  });

  it("says plainly when the key is refused", async () => {
    onFetch("/campaign/GetAll", () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(listCampaigns("bad")).rejects.toThrow("HeyReach refused the API key");
  });

  it("reads who wrote last and the lead's latest words", () => {
    const c = readConversation({
      lastMessageSender: "ME",
      lastMessageAt: "2026-10-14T16:00:00Z",
      lastMessageText: "Thanks Glenn, sending times now.",
      correspondentProfile: {
        firstName: "Glenn",
        lastName: "Krauss",
        profileUrl: "https://www.linkedin.com/in/glenn",
        autoTags: [
          { name: "Not interested", campaignId: 499 },
          { name: "Interested", campaignId: 501 },
        ],
      },
      messages: [
        { sender: "ME", body: "Hi Glenn", createdAt: "2026-10-12T10:00:00Z" },
        { sender: "CORRESPONDENT", body: "Interested, send times", createdAt: "2026-10-14T15:00:00Z" },
        { sender: "ME", body: "Thanks Glenn, sending times now.", createdAt: "2026-10-14T16:00:00Z" },
      ],
    }, "501");
    expect(c).toEqual({
      campaignId: "501",
      leadName: "Glenn Krauss",
      leadUrl: "https://www.linkedin.com/in/glenn",
      leadWroteLast: false,
      lastAt: "2026-10-14T16:00:00Z",
      leadText: "Interested, send times",
      leadAt: "2026-10-14T15:00:00Z",
      // The tag for this campaign, not the other one.
      tag: "Interested",
    });
  });

  it("falls back to the last message when there's no history", () => {
    const c = readConversation({
      lastMessageSender: "CORRESPONDENT",
      lastMessageAt: "2026-10-14T15:00:00Z",
      lastMessageText: "Out of office until Monday",
    }, "501");
    expect(c).toMatchObject({ campaignId: "501", leadWroteLast: true, leadText: "Out of office until Monday", tag: null });
  });

  it("asks for one campaign's conversations and files them under it", async () => {
    onFetch("/inbox/GetConversationsV2", { items: [{ lastMessageSender: "ME" }] });
    const list = await conversations("k", "501");
    expect(JSON.parse(getMockState().fetch.calls[0].init.body).filters).toEqual({ campaignIds: [501] });
    expect(list[0].campaignId).toBe("501");
  });
});
