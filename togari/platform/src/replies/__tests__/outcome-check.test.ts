import { describe, expect, it, vi } from "vitest";

// 2026-10-13: four investors sat at "done" for a week with no answer.
const replies: any[] = [];
const followups: Array<{
  email: string;
  hours: number;
  reason: string;
  leadId?: number;
  campaignId?: number;
  owner?: "us" | "principal" | "investor";
  needText?: string;
}> = [];
const openReplies: Array<{
  email: string;
  hours: number;
  reason: string;
  leadId?: number;
  campaignId?: number;
}> = [];
const threadHistory: any[] = [];
const decisions = vi.hoisted(() => ({
  lookup: vi.fn(
    async (..._args: unknown[]) => null as "closed" | "legacy_hold" | null,
  ),
}));
vi.mock("../card-actions", () => ({ humanDisposition: decisions.lookup }));
vi.mock("../../integrations/cl" + "ay/campaign-read", () => ({
  inboxReplies: async () => replies,
  thread: async () => threadHistory,
}));
vi.mock("../inbox-poller", () => ({ takeLease: async () => true }));
vi.mock("../store", () => ({
  settledByAutopilot: async (_client: string, rows: any[]) =>
    new Set(
      rows
        .filter((r) =>
          ["optout@x.com", "ooo@x.com", "pass@x.com"].includes(r.leadEmail),
        )
        .map((r) => `${r.emailCampaignId}:${r.emailLeadId}:${r.lastReply}`),
    ),
  stalledFollowups: async () => followups,
  stalledReplyItems: async () => openReplies,
}));

import { digest, findStuck } from "../outcome-check";

const NOW = Date.parse("2026-10-14T16:00:00Z");
const r = (email: string, lastSent: string, lastReply: string, category = 0) =>
  replies.push({
    leadEmail: email,
    campaignName: "Zeutara | Qube Finance | Seed",
    lastSent,
    lastReply,
    category,
  });

describe("outcome check", () => {
  it("honors only a closure for the latest exact inbound in both digest paths", async () => {
    replies.length = 0;
    threadHistory.length = 0;
    r("closed@x.com", "2026-10-07T00:00:00Z", "2026-10-08T11:00:00Z");
    Object.assign(replies[0], { emailCampaignId: 2, emailLeadId: 1 });
    openReplies.push({
      email: "closed@x.com",
      hours: 72,
      reason: "reply awaiting_review",
      leadId: 1,
      campaignId: 2,
    });
    threadHistory.push({
      type: "REPLY",
      time: "2026-10-08T11:00:00Z",
      messageId: "closed-inbound",
      body: "Please send the deck",
    });
    decisions.lookup.mockImplementation(
      async (_client, _email, _campaign, _at, id) =>
        id === "closed-inbound" ? "closed" : null,
    );
    try {
      expect(await findStuck("zeutara", NOW)).toEqual([]);
      expect(decisions.lookup).toHaveBeenCalledWith(
        "zeutara",
        "closed@x.com",
        2,
        "2026-10-08T11:00:00Z",
        "closed-inbound",
      );
      threadHistory.push({
        type: "REPLY",
        time: "2026-10-09T11:00:00Z",
        messageId: "new-inbound",
        body: "Any update?",
      });
      expect((await findStuck("zeutara", NOW)).map((s) => s.email)).toContain(
        "closed@x.com",
      );
      decisions.lookup.mockResolvedValue("legacy_hold");
      expect((await findStuck("zeutara", NOW)).map((s) => s.email)).toContain(
        "closed@x.com",
      );
      decisions.lookup.mockRejectedValue(new Error("warehouse unavailable"));
      expect((await findStuck("zeutara", NOW)).map((s) => s.email)).toContain(
        "closed@x.com",
      );
    } finally {
      decisions.lookup.mockReset().mockResolvedValue(null);
      replies.length = 0;
      openReplies.length = 0;
      threadHistory.length = 0;
    }
  });
  it("does not hide an unapplied opt-out, conditional request or failed referral", async () => {
    for (const body of [
      "Please unsubscribe",
      "Happy to chat once they identify a lead",
      "Your message wasn't delivered to referral@fund.com. Address not found.",
    ]) {
      replies.length = 0;
      threadHistory.length = 0;
      r("new-request@x.com", "2026-10-07T00:00:00Z", "2026-10-08T11:00:00Z", 6);
      replies[0].emailCampaignId = 2;
      replies[0].emailLeadId = 1;
      threadHistory.push({ type: "REPLY", time: "2026-10-08T11:00:00Z", body });
      expect((await findStuck("zeutara", NOW)).map((s) => s.email)).toContain(
        "new-request@x.com",
      );
    }
    replies.length = 0;
    threadHistory.length = 0;
  });
  it("does not call an answered or passed investor stuck because a review row is stale", async () => {
    replies.length = 0;
    threadHistory.length = 0;
    openReplies.push({
      email: "answered@x.com",
      hours: 72,
      reason: "reply awaiting_review",
      leadId: 1,
      campaignId: 2,
    });
    threadHistory.push(
      {
        type: "REPLY",
        time: "2026-10-08T11:00:00Z",
        body: "Can you share the deck?",
      },
      { type: "SENT", time: "2026-10-09T11:00:00Z", body: "Here it is" },
    );
    try {
      expect(await findStuck("zeutara", NOW)).toEqual([]);
    } finally {
      openReplies.length = 0;
      threadHistory.length = 0;
    }
  });
  it("does not call a machine auto-reply or a forwarded referral stuck, but keeps a slow human", async () => {
    // 2026-10-16: 16 of 21 "waiting" rows replied 2 to 20 seconds after our send.
    const cases: Array<[string, any[], boolean]> = [
      [
        "auto@x.com",
        [
          { type: "SENT", time: "2026-10-07T17:47:55Z", body: "Hi" },
          {
            type: "REPLY",
            time: "2026-10-07T17:48:05Z",
            body: "I am traveling this week.",
          },
        ],
        false,
      ],
      [
        "forwarded@x.com",
        [
          { type: "SENT", time: "2026-10-07T17:00:00Z", body: "Hi" },
          {
            type: "REPLY",
            time: "2026-10-07T17:00:04Z",
            body: "I've left the firm, please contact ops@fund.com",
          },
          { type: "FORWARD", time: "2026-10-09T10:00:00Z", body: "Forwarding" },
        ],
        false,
      ],
      [
        "human@x.com",
        [
          { type: "SENT", time: "2026-10-07T17:00:00Z", body: "Hi" },
          {
            type: "REPLY",
            time: "2026-10-07T19:00:00Z",
            body: "What is the company?",
          },
        ],
        true,
      ],
    ];
    for (const [email, history, stuck] of cases) {
      replies.length = 0;
      threadHistory.length = 0;
      r(
        email,
        "2026-10-07T00:00:00Z",
        history.filter((m) => m.type === "REPLY").at(-1).time,
      );
      replies[0].emailCampaignId = 2;
      replies[0].emailLeadId = 1;
      threadHistory.push(...history);
      expect(
        (await findStuck("zeutara", NOW)).map((s) => s.email).includes(email),
      ).toBe(stuck);
    }
    replies.length = 0;
    threadHistory.length = 0;
  });
  it("reads an unlabelled inbox reply before calling a pass stuck", async () => {
    replies.length = 0;
    threadHistory.length = 0;
    r("pass@x.com", "2026-10-07T00:00:00Z", "2026-10-08T11:00:00Z");
    replies[0].emailCampaignId = 2;
    replies[0].emailLeadId = 1;
    threadHistory.push({
      type: "REPLY",
      time: "2026-10-08T11:00:00Z",
      body: "We have a conflict of interest and will pass",
    });
    try {
      expect(await findStuck("zeutara", NOW)).toEqual([]);
    } finally {
      replies.length = 0;
      threadHistory.length = 0;
    }
  });
  it("reports a waiting review card missing from the inbox snapshot", async () => {
    replies.length = 0;
    openReplies.push({
      email: "investor@x.com",
      hours: 72,
      reason: "reply awaiting_review",
    });
    try {
      const stuck = await findStuck("zeutara", NOW);
      expect(stuck).toEqual([
        {
          email: "investor@x.com",
          company: "",
          hours: 72,
          reason: "reply awaiting_review",
          owner: "us",
        },
      ]);
      expect(digest("Zeutara", stuck)).toContain(
        "investor@x.com, waiting 3 days, reply awaiting_review",
      );
    } finally {
      openReplies.length = 0;
    }
  });
  it("retains failed follow-through even after autopilot handled the original reply", async () => {
    replies.length = 0;
    followups.push({
      email: "optout@x.com",
      hours: 30,
      reason: "follow-up delivery_unknown",
    });
    try {
      const stuck = await findStuck("zeutara", NOW);
      expect(stuck).toHaveLength(1);
      expect(digest("Zeutara", stuck)).toContain("delivery_unknown");
    } finally {
      followups.length = 0;
    }
  });
  // 2026-10-17: Adam, Simon, Jill and Frank were answered and closed, and their
  // handoff_required rows still filled Caleb's digest.
  it("drops a handed-off follow-up once a person closed its latest inbound", async () => {
    replies.length = 0;
    threadHistory.length = 0;
    followups.push({
      email: "adam@x.com",
      hours: 36,
      reason: "follow-up handoff_required",
      leadId: 1,
      campaignId: 2,
    });
    threadHistory.push({
      type: "REPLY",
      time: "2026-10-10T18:36:00Z",
      messageId: "adam-inbound",
      body: "Happy to chat once they identify a lead",
    });
    try {
      decisions.lookup.mockResolvedValue(null);
      expect((await findStuck("zeutara", NOW)).map((s) => s.email)).toEqual([
        "adam@x.com",
      ]);
      decisions.lookup.mockImplementation(
        async (_client, _email, _campaign, _at, id) =>
          id === "adam-inbound" ? "closed" : null,
      );
      expect(await findStuck("zeutara", NOW)).toEqual([]);
      threadHistory.push({
        type: "REPLY",
        time: "2026-10-12T18:36:00Z",
        messageId: "adam-new",
        body: "We have a lead now",
      });
      expect((await findStuck("zeutara", NOW)).map((s) => s.email)).toEqual([
        "adam@x.com",
      ]);
    } finally {
      decisions.lookup.mockReset().mockResolvedValue(null);
      followups.length = 0;
      threadHistory.length = 0;
    }
  });
  it("groups the digest by who owes the next move: us, the principal, or the investor", async () => {
    replies.length = 0;
    threadHistory.length = 0;
    openReplies.push({
      email: "card@x.com",
      hours: 30,
      reason: "reply awaiting_review",
    });
    followups.push(
      {
        email: "slots@x.com",
        hours: 26,
        reason: "follow-up waiting_on_principal",
        owner: "principal",
        needText: "Two times Jonah can meet this week.",
      },
      {
        email: "quiet@x.com",
        hours: 50,
        reason: "follow-up waiting_on_investor",
        owner: "investor",
      },
      // Also waiting on us through a card: us outranks the investor.
      {
        email: "card@x.com",
        hours: 10,
        reason: "follow-up waiting_on_investor",
        owner: "investor",
      },
    );
    try {
      const stuck = await findStuck("zeutara", NOW);
      expect(Object.fromEntries(stuck.map((s) => [s.email, s.owner]))).toEqual({
        "card@x.com": "us",
        "slots@x.com": "principal",
        "quiet@x.com": "investor",
      });
      const text = digest("Zeutara", stuck, "Jonah");
      const us = text.indexOf("Waiting on us (1):");
      const jonah = text.indexOf("Waiting on Jonah (1):");
      const investor = text.indexOf("Waiting on the investor (1):");
      expect(us).toBeGreaterThan(-1);
      expect(jonah).toBeGreaterThan(us);
      expect(investor).toBeGreaterThan(jonah);
      expect(text).toContain("Needs: Two times Jonah can meet this week.");
    } finally {
      openReplies.length = 0;
      followups.length = 0;
    }
  });
  it("flags an investor waiting on us past a day, and only them", async () => {
    replies.length = 0;
    r("kellie@x.com", "2026-10-07T00:00:00Z", "2026-10-08T11:00:00Z"); // stuck 6 days
    r("fresh@x.com", "2026-10-14T00:00:00Z", "2026-10-14T10:00:00Z"); // 6h, not yet
    r("answered@x.com", "2026-10-10T00:00:00Z", "2026-10-09T00:00:00Z"); // we wrote last
    r("pass@x.com", "2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", 3); // a pass
    r("ooo@x.com", "2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", 6); // out of office
    r("optout@x.com", "2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z"); // Togari blocklisted it
    const stuck = await findStuck("zeutara", NOW);
    expect(stuck.map((s) => s.email)).toEqual(["kellie@x.com"]);
    expect(digest("Zeutara", stuck)).toContain(
      "kellie@x.com (Qube Finance), waiting 6 days",
    );
  });
});
