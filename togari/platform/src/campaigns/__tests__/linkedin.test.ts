import { describe, expect, it } from "vitest";
import { linkedinFor, linkedinOutcome, safeLinkedInUrl } from "../linkedin";

const NOW = Date.parse("2026-10-14T20:00:00Z");
const day = (requests: number, messagesSent = 0, extra = {}) => ({
  requests, accepted: 0, messaged: 0, messagesSent, replied: 0, ...extra,
});

function api(convos: any[]) {
  return {
    listCampaigns: async () => [
      { id: "501", name: "HFMA Region 2", status: "IN_PROGRESS" },
      { id: "502", name: "AVBCC", status: "FINISHED" },
    ],
    dailyStats: async (_k: string, id: string) =>
      id === "501"
        ? { "2026-10-13": day(40, 9, { accepted: 9, messaged: 9, replied: 2 }), "2026-10-14": day(30) }
        // AVBCC last ran in September: no bar this month.
        : { "2026-09-20": day(10) },
    conversations: async (_k: string, id: string) =>
      convos.filter((c) => c.campaignId === id),
  };
}

const convo = (over: any) => ({
  campaignId: "501",
  leadName: "Glenn Krauss",
  leadUrl: "https://www.linkedin.com/in/glenn",
  leadWroteLast: true,
  lastAt: "2026-10-14T15:00:00Z",
  leadText: "Interested, can we talk next week?",
  leadAt: "2026-10-14T15:00:00Z",
  tag: null,
  ...over,
});

describe("linkedinFor", () => {
  const opts = { from: "2026-09-28", to: "2026-11-01", tz: "America/New_York", now: NOW };

  it("draws a bar only for campaigns active this month", async () => {
    const li = await linkedinFor("k", opts, api([]));
    expect(li.campaigns.map((c) => c.id)).toEqual(["li:501"]);
    expect(li.campaigns[0]).toMatchObject({ first_send: "2026-10-13", last_send: "2026-10-14", status: "IN_PROGRESS" });
    expect(li.daily["2026-10-13"]).toEqual({ "li:501": 49, "*": 49 });
    expect(li.weeks["2026-10-12"]["li:501"]).toMatchObject({ requests: 70, accepted: 9, messaged: 9, replied: 2 });
  });

  it("sorts replies and lists the ones waiting on us", async () => {
    const li = await linkedinFor(
      "k",
      opts,
      api([
        convo({}),
        // We answered already: sorted, not waiting.
        convo({ leadName: "Answered", leadWroteLast: false }),
        // Out of office: counted as such, never waiting.
        convo({ leadName: "Away", leadText: "I am out of the office until Monday with limited access to email." }),
        // No reply from the lead at all.
        convo({ leadName: "Silent", leadWroteLast: false, leadText: null, leadAt: null }),
        // Too old to list.
        convo({ leadName: "Old", leadAt: "2026-06-01T00:00:00Z" }),
      ]),
    );
    expect(li.weeks["2026-10-12"]["*"]).toMatchObject({ interested: 2, ooo: 1 });
    expect(li.waiting.map((w) => w.name)).toEqual(["Glenn Krauss"]);
    expect(li.waiting[0]).toMatchObject({
      campaign_id: "li:501",
      campaign: "HFMA Region 2",
      channel: "linkedin",
      day: "2026-10-14",
      url: "https://www.linkedin.com/in/glenn",
    });
  });
});

describe("linkedinOutcome", () => {
  it("lets HeyReach's tag settle only what the text rules can't", () => {
    expect(linkedinOutcome("Oh nice, how did the conference go?", "Interested")).toBe("interested");
    expect(linkedinOutcome("Thanks for reaching out.", "Not interested")).toBe("pass");
    expect(linkedinOutcome("asdf", null)).toBe("needs_read");
    // A clear out-of-office stays one whatever the tag says.
    expect(
      linkedinOutcome("I am out of the office until Monday with limited access to email.", "Interested"),
    ).toBe("ooo");
  });
});

describe("safeLinkedInUrl", () => {
  it("links only to LinkedIn over https", () => {
    expect(safeLinkedInUrl("https://www.linkedin.com/in/x")).toBe("https://www.linkedin.com/in/x");
    expect(safeLinkedInUrl("javascript:alert(1)")).toBeNull();
    expect(safeLinkedInUrl("https://linkedin.com.evil.test/in/x")).toBeNull();
    expect(safeLinkedInUrl(null)).toBeNull();
  });
});
