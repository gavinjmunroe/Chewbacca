import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseVantageContext,
  vantageContext,
  vantageLogSent,
  vantageProblem,
  vantageDisclosureProblem,
} from "../vantage";

afterEach(() => vi.unstubAllGlobals());

// Sanitized shape of the observed live found:true response. No investor data.
const observedContext = () => ({
  found: true,
  hasDeck: false,
  hasOnePager: true,
  times: ["Tuesday, Oct 20, 10 AM ET"],
  timesSuit: "reply owner only",
  bookingUrl: null,
  neverMention: ["example client", "example founder"],
  verdict: null,
  answered: { at: "2026-10-12T00:21:01.697Z", from: "owner@example.com" },
  rules: [
    "Never name the client, its website or its people. Describe it by stage and sector.",
    "Never send a link to a deck, one-pager or any file. Files go to investors as attachments, sent from Vantage. If they ask for material, say Jonah will send it over shortly, and leave the reply for Vantage.",
    "Offer only the times listed, or the booking link. Never invent a time.",
    "If verdict is NOT_A_FIT, do not offer a meeting.",
  ],
});

describe("Vantage context contract", () => {
  it("checks subject disclosure separately from body meeting offers", () => {
    const ctx = parseVantageContext({
      ...observedContext(),
      verdict: "NOT_A_FIT",
    });
    for (const subject of ["Re: Quick chat", "Re: Tuesday October 20"])
      expect(vantageDisclosureProblem(subject, ctx)).toBeNull();
    expect(vantageDisclosureProblem("Re: Example Client", ctx)).toBeTruthy();
    expect(vantageProblem("Thanks for letting me know.", ctx)).toBeNull();
    expect(vantageProblem("Could we have a quick chat?", ctx)).toBeTruthy();
    expect(vantageProblem("Tuesday October 20 works for me", ctx)).toBeTruthy();
  });
  it.each(["onepager", "one pager", "one-pager", "deck", "memo", "file"])(
    "refuses %s fulfillment claims and acknowledgments",
    (material) => {
      const ctx = parseVantageContext(observedContext());
      expect(
        vantageProblem(`Jonah will send the ${material} shortly.`, ctx),
      ).toBeTruthy();
      expect(vantageProblem(`I sent the ${material}.`, ctx)).toBeTruthy();
      expect(vantageProblem(`Here is the ${material}.`, ctx)).toBeTruthy();
      expect(vantageProblem(`The ${material} is coming.`, ctx)).toBeTruthy();
      expect(vantageProblem("Jonah will send it shortly.", ctx)).toBeTruthy();
    },
  );
  it("reads the observed material policy and keeps answered metadata without closing work", () => {
    const context = parseVantageContext(observedContext());
    expect(context.deckUrl).toBeNull();
    expect(context.policy).toMatchObject({
      hasDeck: false,
      hasOnePager: true,
      timesSuit: "reply owner only",
      materialDelivery: "vantage_attachments",
      answered: { at: "2026-10-12T00:21:01.697Z", from: "owner@example.com" },
    });
    expect(
      vantageProblem("Thanks, I'll follow up shortly.", context),
    ).toBeNull();
    for (const body of [
      "Example Client is raising.",
      "Our founder is Example Founder.",
      "Here is the file: https://example.com/deck.pdf",
      "I've attached the deck.",
      "Could you call the founder Tuesday, Oct 20, 10 AM ET?",
    ])
      expect(vantageProblem(body, context)).toBeTruthy();
    expect(
      vantageProblem("Could we speak Tuesday, Oct 20, 10 AM ET?", context),
    ).toBeNull();
  });
  it("permits only the authorized booking link and suppresses NOT_A_FIT meetings", () => {
    const raw = {
      ...observedContext(),
      bookingUrl: "https://example.com/book",
    };
    const context = parseVantageContext(raw);
    expect(
      vantageProblem("Book here: https://example.com/book", context),
    ).toBeNull();
    expect(
      vantageProblem("Book here: https://example.com/other", context),
    ).toBeTruthy();
    const noFit = parseVantageContext({ ...raw, verdict: "NOT_A_FIT" });
    expect(
      vantageProblem("Could we talk Tuesday, Oct 20, 10 AM ET?", noFit),
    ).toBeTruthy();
    expect(
      vantageProblem("Book here: https://example.com/book", noFit),
    ).toBeTruthy();
    expect(vantageProblem("Thanks for letting me know.", noFit)).toBeNull();
  });
  it("accepts the observed QUALIFIED verdict with every other restriction intact", () => {
    const ctx = parseVantageContext({
      ...observedContext(),
      verdict: "QUALIFIED",
    });
    expect(ctx.policy?.verdict).toBe("QUALIFIED");
    expect(
      vantageProblem("Could we speak Tuesday, Oct 20, 10 AM ET?", ctx),
    ).toBeNull();
    expect(
      vantageProblem("Could we speak Friday, Oct 23, 9 AM ET?", ctx),
    ).toBeTruthy();
    expect(
      vantageProblem("Could you call the founder Tuesday, Oct 20, 10 AM ET?", ctx),
    ).toBeTruthy();
    expect(vantageProblem("Example Client is raising.", ctx)).toBeTruthy();
    for (const verdict of ["INTERESTED", "qualified", ""])
      expect(() =>
        parseVantageContext({ ...observedContext(), verdict }),
      ).toThrow();
  });
  it("refuses unknown or malformed live policy semantics instead of dropping restrictions", () => {
    for (const patch of [
      { rules: [] },
      { rules: [...observedContext().rules, "New restriction"] },
      { timesSuit: "founder only" },
      { verdict: "UNKNOWN" },
      { hasDeck: "yes" },
      { neverMention: [42] },
      { bookingUrl: "javascript:alert(1)" },
      { answered: { at: "invalid", from: "owner@example.com" } },
      { found: false },
    ])
      expect(() =>
        parseVantageContext({ ...observedContext(), ...patch }),
      ).toThrow();
  });
  it("does not combine a day from one slot with the time from another", () => {
    const ctx = {
      deckUrl: null,
      times: ["Monday at 10am ET", "Tuesday at 3pm ET"],
      neverUse: [],
    };
    expect(vantageProblem("Could we meet Monday at 3pm ET?", ctx)).toBeTruthy();
    expect(
      vantageProblem("Could we meet Monday at 10am ET or 3pm ET?", ctx),
    ).toBeTruthy();
    expect(
      vantageProblem("Could we meet Monday at 10am ET or 11am ET?", {
        ...ctx,
        times: [...ctx.times, "Monday at 11am ET"],
      }),
    ).toBeNull();
    expect(
      vantageProblem(
        "Could we meet Monday at 10am ET or Tuesday at 3pm ET?",
        ctx,
      ),
    ).toBeNull();
  });
  it("compares complete date and time tokens instead of prefixes", () => {
    const ctx = {
      deckUrl: null,
      times: ["Friday Oct 23 at 12pm ET"],
      neverUse: [],
    };
    expect(vantageProblem("Friday Oct 2 at 12pm ET works", ctx)).toBeTruthy();
    expect(vantageProblem("Friday Oct 23 at 2pm ET works", ctx)).toBeTruthy();
    expect(vantageProblem("Friday Oct 23 at 12pm ET works", ctx)).toBeNull();
  });
  it("applies a trailing day to preceding alternatives without explicit dates", () => {
    const ctx = {
      deckUrl: null,
      times: ["Tuesday at 10am ET", "Monday at 3pm ET"],
      neverUse: [],
    };
    expect(
      vantageProblem("Would 10am ET or 3pm ET on Monday work?", ctx),
    ).toBeTruthy();
    expect(
      vantageProblem("Would 10am ET or 3pm ET on Monday work?", {
        ...ctx,
        times: [...ctx.times, "Monday at 10am ET"],
      }),
    ).toBeNull();
    expect(
      vantageProblem("Would Tuesday at 10am ET or 3pm ET on Monday work?", ctx),
    ).toBeNull();
    expect(
      vantageProblem("Would 10am ET or 3pm ET on October 23 work?", {
        ...ctx,
        times: ["October 22 at 10am ET", "October 23 at 3pm ET"],
      }),
    ).toBeTruthy();
  });
  it("permits factual company dates while checking actual meeting offers", () => {
    const empty = { deckUrl: null, times: [], neverUse: [] };
    expect(vantageProblem("The round closes October 30", empty)).toBeNull();
    expect(vantageProblem("We launched Monday October 12", empty)).toBeNull();
    const ctx = { ...empty, times: ["Thursday Oct 22 at 2pm ET"] };
    expect(
      vantageProblem(
        "The round closes October 30. Could we meet Thursday Oct 22 at 2pm ET?",
        ctx,
      ),
    ).toBeNull();
    expect(
      vantageProblem(
        "The round closes October 30, and could we meet Thursday Oct 23 at 2pm ET?",
        ctx,
      ),
    ).toBeTruthy();
  });
  it("refuses invented dates, 24-hour slots and timezone changes", () => {
    const empty = { deckUrl: null, times: [], neverUse: [] };
    for (const body of [
      "Let's discuss the round Friday at 9am",
      "Can we review revenue Monday at 10am?",
      "The round closes October 30. Let's discuss Friday at 9am",
      "We launched Monday October 12 and could talk Tuesday at 2pm",
    ])
      expect(vantageProblem(body, empty)).toBeTruthy();
    expect(
      vantageProblem("Would Thursday Oct 22 or Friday Oct 23 work?", empty),
    ).toBeTruthy();
    expect(vantageProblem("Could we meet at 14:00?", empty)).toBeTruthy();
    const ctx = { ...empty, times: ["Thursday Oct 22 at 2pm ET"] };
    expect(
      vantageProblem("Thursday Oct 22 at 2pm ET works for us", ctx),
    ).toBeNull();
    expect(vantageProblem("Thursday Oct 23 at 2pm ET works", ctx)).toBeTruthy();
    expect(vantageProblem("Thursday Oct 22 at 2pm PT works", ctx)).toBeTruthy();
  });
  it("recognizes explicit investor absence but refuses an incomplete found record", () => {
    expect(parseVantageContext({ found: false, note: "No record" })).toEqual({
      deckUrl: null,
      times: [],
      neverUse: [],
    });
    expect(() => parseVantageContext({ found: true, note: "Present" })).toThrow(
      "unrecognized",
    );
    expect(() =>
      parseVantageContext({ deck_url: "https://example.com/deck", times: [] }),
    ).toThrow("missing");
  });
  it("distinguishes explicit empty context from an unknown schema", () => {
    expect(
      parseVantageContext({ deck_url: "", times: [], never_use: [] }).deckUrl,
    ).toBeNull();
    expect(
      parseVantageContext({ deck_url: null, times: [], never_use: [] }),
    ).toEqual({
      deckUrl: null,
      times: [],
      neverUse: [],
    });
    for (const response of [
      {},
      { context: { deck_url: "https://example.com/deck" } },
      { error: "not found" },
    ])
      expect(() => parseVantageContext(response)).toThrow("unrecognized");
  });

  it("reads existing aliases and object list labels", () => {
    expect(
      parseVantageContext({
        data: {
          deck: { url: "https://example.com/deck" },
          availability: [{ label: "Monday 3pm" }],
          avoid: "guaranteed; risk-free",
        },
      }),
    ).toEqual({
      deckUrl: "https://example.com/deck",
      times: ["Monday 3pm"],
      neverUse: ["guaranteed", "risk-free"],
    });
  });

  it("refuses malformed context instead of dropping constraints", () => {
    for (const response of [
      null,
      [],
      { data: null },
      { data: [] },
      { deck_url: "javascript:alert(1)" },
      { deck: {} },
      { times: { monday: "3pm" } },
      { never_use: [42] },
      { times: [{ start: 42 }] },
    ])
      expect(() => parseVantageContext(response)).toThrow();
  });

  it("propagates an unknown schema through the supported context read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: {} }))),
    );
    await expect(vantageContext("lead@example.com")).rejects.toThrow(
      "unrecognized",
    );
  });

  it("fails context reads and sent logging on unsuccessful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    await expect(vantageContext("lead@example.com")).rejects.toThrow("503");
    await expect(
      vantageLogSent({
        to_email: "lead@example.com",
        from_email: "sender@example.com",
        subject: "Re: Company",
        text: "Hello",
        sent_at: "2026-10-15T12:00:00Z",
      }),
    ).rejects.toThrow("503");
  });
  // 2026-10-17: the out-of-office return note said "Open to a short call with
  // the founder?", which Vantage refuses (times belong to the reply owner), so
  // every one went to handoff_required and nobody followed up with James
  // Madden after he was back on 10-16.
  it("passes the follow-up Togari drafts itself", async () => {
    const { followupBody } = await import("../autopilot");
    const ctx = parseVantageContext(observedContext());
    expect(vantageProblem(followupBody("James Madden", "Jonah"), ctx)).toBeNull();
  });
});
