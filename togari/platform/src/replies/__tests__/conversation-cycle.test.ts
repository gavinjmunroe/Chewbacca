import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ write: vi.fn(), query: vi.fn() }));
vi.mock("../vantage", () => ({
  vantageContext: async () => ({ deckUrl: "https://example.com/deck" }),
}));
vi.mock("../../bigquery/client", () => ({
  BigQueryClient: class {
    executeWrite = mocks.write;
    executeQuery = mocks.query;
  },
}));
import {
  cycleDue,
  followupDisposition,
  followupObsolete,
  scheduleConversationFollowup,
  settleDeckPromises,
} from "../conversation-cycle";
import { getReplybotClient } from "../../agents/replybot/client-config";
import type { ThreadMessage } from "../../integrations/clay/campaign-read";
const sent: ThreadMessage = {
  messageId: "s1",
  type: "SENT",
  body: "Reply",
  subject: "Re: Deal",
  from: "sender@test.com",
  time: "2026-10-16T18:00:00Z",
};
const inbound = "2026-10-14T18:00:00Z";
beforeEach(() => {
  mocks.write.mockReset();
  mocks.query.mockResolvedValue({ rows: [{ attempt: 0 }] });
});
describe("conversation ownership", () => {
  it("hands failed delivery to repair instead of cancelling ownership", () => {
    expect(
      followupDisposition([
        {
          ...sent,
          type: "REPLY",
          body: "Your message wasn't delivered. Recipient address rejected.",
        },
      ]),
    ).toBe("handoff");
  });
  it("settles only the promised deck handoff after the approved deck is confirmed sent", async () => {
    const promise = {
      ...sent,
      messageId: "promise",
      time: "2026-10-15T18:00:00Z",
      body: "The deck's coming, I'll send it shortly.",
    };
    const msg = { to: "lead@test.com", leadId: 1, campaignId: 2 };
    await settleDeckPromises(
      getReplybotClient("zeutara")!,
      msg,
      { ...sent, body: "Thanks for waiting" },
      inbound,
      [promise],
    );
    expect(mocks.write).not.toHaveBeenCalled();
    await settleDeckPromises(
      getReplybotClient("zeutara")!,
      msg,
      { ...sent, body: "Here is the deck: https://example.com/deck" },
      inbound,
      [promise],
    );
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0][0]).toContain(
      "status = 'handoff_required'",
    );
    expect(mocks.write.mock.calls[0][1]).toMatchObject({
      clientId: "zeutara",
      leadId: "1",
      campaignId: "2",
      promiseIds: ["promise"],
    });
  });
  it("handles a long malformed tag without quadratic stripping", () => {
    expect(
      followupDisposition([
        {
          ...sent,
          type: "REPLY",
          body: "We will pass. " + "<".repeat(200_000),
        },
      ]),
    ).toBe("cancel");
  }, 1000);
  it("keeps a promised missing deck visible rather than scheduling a generic nudge", async () => {
    await scheduleConversationFollowup(
      getReplybotClient("zeutara")!,
      { to: "lead@test.com", leadId: 1, campaignId: 2 },
      { ...sent, body: "The deck's coming, I'll send it over shortly." },
      inbound,
    );
    expect(mocks.write.mock.calls[0][1].status).toBe("handoff_required");
  });
  it("does not nudge a pass, a later condition, or a form request", () => {
    const reply = (body: string): ThreadMessage[] => [
      {
        messageId: "r1",
        type: "REPLY",
        body,
        subject: "Re: Deal",
        from: "lead@test.com",
        time: inbound,
      },
    ];
    expect(
      followupDisposition(reply("We have a conflict. Going to pass here")),
    ).toBe("cancel");
    expect(
      followupDisposition(
        reply(
          "Happy to chat once they identify a lead, until then I have to pass",
        ),
      ),
    ).toBe("handoff");
    expect(
      followupDisposition(
        reply("Please submit through our founder intake form"),
      ),
    ).toBe("handoff");
    expect(
      followupDisposition(reply("Happy to meet the founder. What times work?")),
    ).toBe("handoff");
    expect(
      followupDisposition(reply("Can you share more about the round?")),
    ).toBe("handoff");
    expect(
      followupDisposition([
        ...reply("Can you share more about the round?"),
        { ...sent, time: "2026-10-15T18:00:00Z" },
      ]),
    ).toBe("send");
    expect(followupDisposition([])).toBe("handoff");
    expect(
      followupDisposition(
        reply("I am out of the office until October 15"),
        true,
      ),
    ).toBe("send");
    expect(
      followupDisposition(reply("I am out of the office until October 15")),
    ).toBe("handoff");
    expect(
      followupDisposition(
        reply(
          "Happy to chat once they identify a lead, until then I have to pass",
        ),
        true,
      ),
    ).toBe("handoff");
  });
  it("schedules across weekends and cancels obsolete work on newer activity", () => {
    expect(cycleDue(new Date(sent.time)).toISOString()).toBe(
      "2026-10-20T14:00:00.000Z",
    );
    expect(followupObsolete([sent], sent.time)).toBe(false);
    expect(
      followupObsolete(
        [{ ...sent, type: "REPLY", time: "2026-10-17T18:00:00Z" }],
        sent.time,
      ),
    ).toBe(true);
    expect(followupObsolete([], "")).toBe(true);
  });
  it("restores the next task without resetting the nudge budget", async () => {
    mocks.query.mockResolvedValue({ rows: [{ attempt: 2 }] });
    await scheduleConversationFollowup(
      getReplybotClient("zeutara")!,
      { to: "lead@test.com", leadId: 1, campaignId: 2 },
      sent,
      inbound,
    );
    expect(mocks.write.mock.calls[0][1].status).toBe("waiting_on_investor");
    expect(mocks.write.mock.calls[0][0]).toContain("t.thread_id = @threadId");
  });
  it("surfaces persistence failure instead of dropping conversation ownership", async () => {
    mocks.write.mockRejectedValue(new Error("database down"));
    await expect(
      scheduleConversationFollowup(
        getReplybotClient("zeutara")!,
        { to: "lead@test.com", leadId: 1, campaignId: 2, followupAttempt: 1 },
        sent,
        inbound,
      ),
    ).rejects.toThrow("database down");
  });
});
