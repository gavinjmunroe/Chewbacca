import { describe, expect, it } from "vitest";
import { confirmedReply } from "../delivery";
import type { ThreadMessage } from "../../integrations/clay/campaign-read";

const sent = (messageId: string, body: string): ThreadMessage => ({
  messageId,
  body,
  type: "SENT",
  from: "sender@example.com",
  subject: "Re: offer",
  time: "2026-10-14T20:00:00Z",
});
describe("delivery confirmation", () => {
  it("compares malformed long HTML without quadratic stripping", () => {
    const body = "An answer " + "<".repeat(200_000);
    expect(confirmedReply([], [sent("new", body)], body)).toBe(true);
  }, 1000);
  it("requires a new matching outbound message, not an old send or a webhook receipt", () => {
    const old = sent("old", "Hi, would a call work?");
    expect(confirmedReply([old], [old], old.body)).toBe(false);
    expect(
      confirmedReply([old], [old, sent("new", "Different email")], old.body),
    ).toBe(false);
    expect(
      confirmedReply(
        [old],
        [old, { ...sent("new", old.body), type: "REPLY" }],
        old.body,
      ),
    ).toBe(false);
    expect(
      confirmedReply(
        [old],
        [old, sent("new", "Hi,<br>would a call work?")],
        old.body,
      ),
    ).toBe(true);
  });
});
