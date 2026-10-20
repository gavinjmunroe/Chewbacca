import { describe, expect, it } from "vitest";
import {
  CampaignEventPayload,
  asDate,
  eventKind,
  eventRow,
  replyOutcome,
} from "../events";

const NOW = new Date("2026-10-14T16:00:00Z");

describe("eventKind", () => {
  it("reads Clay's event names however they're spelled", () => {
    expect(eventKind("Email Sent")).toBe("sent");
    expect(eventKind("EMAIL_SENT")).toBe("sent");
    expect(eventKind("send")).toBe("sent");
    expect(eventKind("Reply Received")).toBe("reply");
    expect(eventKind("replied")).toBe("reply");
    expect(eventKind("Bounced")).toBe("bounce");
    expect(eventKind("hard_bounce")).toBe("bounce");
    expect(eventKind("CAMPAIGN_STATUS_CHANGED")).toBe("status");
  });

  it("doesn't count opens, clicks or anything else", () => {
    expect(eventKind("Email Opened")).toBeNull();
    expect(eventKind("link_clicked")).toBeNull();
    expect(eventKind("consent")).toBeNull();
  });
});

describe("replyOutcome", () => {
  it("files an autoresponder as out of office, and a person's 'later' as later", () => {
    expect(
      replyOutcome("I am out of the office until Monday with limited access to email.", null),
    ).toBe("ooo");
    expect(
      replyOutcome("Traveling for the next 3 weeks, circle back after that.", null),
    ).toBe("later");
  });

  it("sorts the replies a person has to answer", () => {
    expect(replyOutcome("Interested, can we set up a call next week?", null)).toBe(
      "interested",
    );
    expect(replyOutcome("asdf", null)).toBe("needs_read");
  });

  it("sorts the ones nobody answers", () => {
    expect(replyOutcome("Please remove me from your list.", null)).toBe("opt_out");
    expect(replyOutcome("Not interested, thanks.", null)).toBe("pass");
    expect(replyOutcome("We're not currently interested.", null)).toBe("pass");
  });

  it("doesn't read our own 'if you're not interested' in the quoted thread as a pass", () => {
    const reply =
      "I am interested, can you set up a call next week?\n\n" +
      "On Mon, Oct 12, 2026 at 9:00 AM Arham <arham@serif-outreach.com> wrote:\n" +
      "> If you're not interested, just let me know.";
    expect(replyOutcome(reply, null)).toBe("interested");
  });

  it("falls back to Clay's category when there's no text or the rules can't tell", () => {
    expect(replyOutcome(null, "6")).toBe("ooo");
    expect(replyOutcome("", "Out Of Office")).toBe("ooo");
    expect(replyOutcome(null, "3")).toBe("pass");
    expect(replyOutcome("asdf", "Interested")).toBe("interested");
    expect(replyOutcome(null, null)).toBe("needs_read");
    expect(replyOutcome(null, "something new")).toBe("needs_read");
  });
});

describe("eventRow", () => {
  const base = {
    event_id: 9001,
    client_id: "serif",
    campaign_id: 907,
    campaign_name: "Payer data | Health systems",
    lead_email: "  CFO@ExampleHealth.com ",
    occurred_at: "2026-10-13T14:02:00Z",
  };

  it("lands a send with its step and the prospect lowercased", () => {
    const row = eventRow(
      CampaignEventPayload.parse({ ...base, event_type: "Email Sent", step: "Step 2" }),
      NOW,
    )!;
    expect(row).toMatchObject({
      event_id: "9001",
      event_type: "sent",
      campaign_id: "907",
      lead_email: "cfo@examplehealth.com",
      step: 2,
      occurred_at: "2026-10-13T14:02:00.000Z",
      outcome: null,
      received_at: NOW.toISOString(),
    });
  });

  it("keeps a reply's outcome and drops its text", () => {
    const row = eventRow(
      CampaignEventPayload.parse({
        ...base,
        event_type: "Reply",
        reply_text: "Out of office until Oct 20. Limited access to email.",
      }),
      NOW,
    )!;
    expect(row.outcome).toBe("ooo");
    expect(JSON.stringify(row)).not.toContain("Limited access");
  });

  it("keeps Clay's campaign status, in capitals", () => {
    const row = eventRow(
      CampaignEventPayload.parse({ ...base, event_type: "CAMPAIGN_STATUS_CHANGED", campaign_status: "paused" }),
      NOW,
    )!;
    expect(row).toMatchObject({ event_type: "status", campaign_status: "PAUSED" });
  });

  it("takes planned dates when the column carries them", () => {
    const row = eventRow(
      CampaignEventPayload.parse({
        ...base,
        event_type: "sent",
        planned_start: "2026-10-01",
        planned_end: "Oct 31, 2026",
      }),
      NOW,
    )!;
    expect(row.planned_start).toBe("2026-10-01");
    expect(row.planned_end).toBe("2026-10-31");
  });

  it("uses arrival time when Clay sent no timestamp, and ignores opens", () => {
    const sent = eventRow(
      CampaignEventPayload.parse({ ...base, occurred_at: "", event_type: "sent" }),
      NOW,
    )!;
    expect(sent.occurred_at).toBe(NOW.toISOString());
    expect(
      eventRow(CampaignEventPayload.parse({ ...base, event_type: "opened" }), NOW),
    ).toBeNull();
  });
});

describe("asDate", () => {
  it("reads a date or gives up", () => {
    expect(asDate("2026-10-01")).toBe("2026-10-01");
    expect(asDate("not a date")).toBeNull();
    expect(asDate(undefined)).toBeNull();
  });
});
