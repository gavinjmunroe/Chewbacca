import { describe, expect, it, vi } from "vitest";

vi.mock("../decks", () => ({
  getDeck: vi.fn(),
  deckReplyBody: (
    name: string | null,
    company: string,
    url: string,
    signoff: string,
  ) =>
    `Hi ${(name || "").split(" ")[0]},\n\nHere's the ${company} deck: ${url}\n\n${signoff}`,
}));

import {
  autoSend,
  draftProblem,
  gist,
  isAllowedLinkHost,
  linkAlive,
  linkProblem,
  isPrivateAddress,
  linkWorks,
  replySubject,
  sentPost,
} from "../auto-send";
import type { ReplybotClientConfig } from "../../agents/replybot/client-config";

const client = {
  clientId: "zeutara",
  voice: { signoffName: "Jonah" },
  autopilot: { forwardHookEnv: "X", blocklistHookEnv: "Y" },
} as unknown as ReplybotClientConfig;

function row(body: string) {
  return {
    row_id: "r1",
    campaign: "Zeutara | Qube Finance | wave 1",
    email_thread_id: "<abc@mail>",
    from_address: "gary@sixtrees.vc",
    sender_account: "jonah@zeutara-mail.com",
    subject: "Qube Finance",
    body,
    lead_id: 11,
    campaign_id: 22,
    lead_name: "Gary Zimmerman",
  };
}

const DRAFT =
  "Hi Gary,\n\nGreat question. Qube closes its round in November. Open to a short call with the founder this week?\n\nJonah";

describe("autoSend", () => {
  it("never sends a model draft back to a failed-delivery server", async () => {
    const send = vi.fn();
    const result = await autoSend(
      client,
      row("Mail delivery failed. Recipient address rejected."),
      DRAFT,
      { send },
    );
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("answers a question in its own thread without a person", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const out = await autoSend(
      client,
      row("What is the round size and when does it close?"),
      DRAFT,
      { send },
    );
    expect(out.sent).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0][1];
    expect(msg).toMatchObject({
      to: "gary@sixtrees.vc",
      subject: "Re: Qube Finance",
      inReplyTo: "<abc@mail>",
      leadId: 11,
      campaignId: 22,
      sendVia: "clay",
    });
    expect(msg.body).toBe(DRAFT);
  });

  it("leaves a form request for Jonah", async () => {
    const send = vi.fn();
    const out = await autoSend(
      client,
      row(
        "Please submit through our form at https://fund.com/apply and we'll take a look.",
      ),
      DRAFT,
      { send },
    );
    expect(out).toMatchObject({ sent: false, kind: "form" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the deck when one is on file, and asks Jonah when none is", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const ask = "Can you send over the deck?";
    const none = await autoSend(client, row(ask), DRAFT, {
      send,
      deckFor: async () => null,
    });
    expect(none).toMatchObject({ sent: false, kind: "deck" });
    expect(send).not.toHaveBeenCalled();
    const on = await autoSend(client, row(ask), DRAFT, {
      send,
      deckFor: async () => "https://d.example/qube",
    });
    expect(on.sent).toBe(true);
    expect(send.mock.calls[0][1].body).toContain("https://d.example/qube");
  });

  // Ryan, 2026-10-13: four investors got dead Togari deck links. With Vantage
  // on, its link is the only one that goes out, and no link means "coming".
  it("never sends a deck link that doesn't open", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const dead =
      "https://togari-bma-prod.up.railway.app/d/88cc0602c87bac5ff1340b4ce4e9a347";
    const out = await autoSend(
      client,
      row("Can you send over the deck?"),
      DRAFT,
      {
        send,
        deckFor: async () => dead,
        linkWorks: async (u) => u !== dead,
      },
    );
    expect(out).toMatchObject({ sent: false, kind: "deck" });
    expect(send).not.toHaveBeenCalled();
    const ok = await autoSend(
      client,
      row("Can you send over the deck?"),
      DRAFT,
      {
        send,
        deckFor: async () => "https://docsend.com/view/qube",
        linkWorks: async (u) => u !== dead,
      },
    );
    expect(ok.sent).toBe(true);
  });

  it("holds a reply with more than three links without opening any", async () => {
    const send = vi.fn();
    const linkWorks = vi.fn().mockResolvedValue(true);
    const many =
      "Hi Gary,\n\nhttps://a.com https://b.com https://c.com https://d.com\n\nJonah";
    const out = await autoSend(client, row("What is the round size?"), many, {
      send,
      linkWorks,
    });
    expect(out.sent).toBe(false);
    expect(linkWorks).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses http and private addresses before fetching", async () => {
    for (const u of [
      "http://docsend.com/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://[::1]/x",
      "https://10.0.0.5/x",
    ]) {
      expect(await linkWorks(u)).toBe(false);
    }
    for (const ip of [
      "169.254.169.254",
      "192.168.1.1",
      "172.20.0.1",
      "100.64.0.1",
      "::ffff:10.0.0.1",
      "fd00::1",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("34.120.0.1")).toBe(false);
    expect(await linkWorks("https://evil.example/rebind")).toBe(false);
    expect(isAllowedLinkHost("docsend.com")).toBe(true);
    expect(isAllowedLinkHost("acme.docsend.com")).toBe(true);
    expect(isAllowedLinkHost("docsend.com.evil.example")).toBe(false);
    expect(isAllowedLinkHost("notdocsend.com")).toBe(false);
  });

  it("holds a reply linking off the deck hosts without opening it", async () => {
    const send = vi.fn();
    const check = vi.fn().mockResolvedValue(true);
    const out = await autoSend(
      client,
      row("What is the round size?"),
      "Hi Gary,\n\nMore here: https://metadata.internal/x\n\nJonah",
      { send, linkWorks: check },
    );
    expect(out.sent).toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("counts a bot wall as there and a 404 as dead", () => {
    // docsend.com and dropbox.com answered 403 to a plain GET on 2026-10-13.
    for (const s of [200, 204, 401, 403, 429]) expect(linkAlive(s)).toBe(true);
    for (const s of [400, 404, 410, 500, 502, 503])
      expect(linkAlive(s)).toBe(false);
  });

  it("holds a link written without https", async () => {
    const works = vi.fn().mockResolvedValue(true);
    for (const b of [
      "Deck: docsend.com/view/qube",
      "Deck here www.pitch.com/v/qube thanks",
      "See (drive.google.com/file/d/abc/view)",
    ]) {
      expect(await linkProblem(b, works)).toMatch(/without https/);
    }
    expect(
      await linkProblem("Email me at jonah@zeutara.com.", works),
    ).toBeNull();
    expect(await linkProblem("Raised $1.5M. Thanks.", works)).toBeNull();
  });

  it("strips trailing punctuation before opening a link", async () => {
    const works = vi.fn().mockResolvedValue(true);
    await linkProblem("Here: https://docsend.com/view/qube!", works);
    expect(works).toHaveBeenCalledWith("https://docsend.com/view/qube");
  });

  describe("with Vantage", () => {
    it.each([
      "onepager",
      "one pager",
      "one-pager",
      "deck",
      "memo",
      "file",
      "materials",
      "teaser",
      "presentation",
    ])("leaves %s requests open for Vantage", async (material) => {
      const send = vi.fn();
      const out = await autoSend(
        client,
        row(`Could I see your ${material}?`),
        DRAFT,
        {
          send,
          vantage: {
            context: async () => ({
              deckUrl: null,
              times: [],
              neverUse: [],
              policy: {
                hasDeck: true,
                hasOnePager: true,
                materialDelivery: "vantage_attachments",
                timesSuit: "reply owner only",
                bookingUrl: null,
                verdict: null,
                answered: null,
                neverNameClient: true,
              },
            }),
          },
        },
      );
      expect(out.sent).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(out).toMatchObject({
        reason: expect.stringContaining("Vantage owns"),
      });
    });
    const ctx = (over = {}) => ({
      deckUrl: "https://docsend.com/view/qube",
      times: ["Thu 2pm ET", "Fri 11am ET"],
      neverUse: ["Zeutara Capital"],
      ...over,
    });
    const ask = "Can you send over the deck?";

    it("sends Vantage's deck, never the library one", async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const out = await autoSend(client, row(ask), DRAFT, {
        send,
        deckFor: async () => "https://togari-bma-prod.up.railway.app/d/dead",
        vantage: { context: async () => ctx() },
      });
      expect(out.sent).toBe(true);
      const body = send.mock.calls[0][1].body;
      expect(body).toContain("https://docsend.com/view/qube");
      expect(body).not.toContain("/d/dead");
    });

    it("says the deck is coming when Vantage has no link", async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const out = await autoSend(client, row(ask), DRAFT, {
        send,
        deckFor: async () => "https://togari-bma-prod.up.railway.app/d/dead",
        vantage: {
          context: async () => ctx({ deckUrl: null }),
          logSent: vi.fn().mockResolvedValue(undefined),
        },
      });
      expect(out.sent).toBe(true);
      const body = send.mock.calls[0][1].body;
      expect(body).toMatch(/deck's coming/);
      expect(body).not.toMatch(/https?:\/\//);
    });

    it("sends nothing when Vantage can't be read", async () => {
      const send = vi.fn();
      const out = await autoSend(client, row(ask), DRAFT, {
        send,
        vantage: {
          context: async () => {
            throw new Error("503");
          },
          logSent: vi.fn(),
        },
      });
      expect(out).toMatchObject({ sent: false });
      expect(send).not.toHaveBeenCalled();
    });

    it("holds a draft with a banned word, a stray link or an unoffered time", async () => {
      const send = vi.fn();
      for (const bad of [
        "Hi Gary,\n\nZeutara Capital is excited about Qube. Open to a call?\n\nJonah",
        "Hi Gary,\n\nMore at https://qube.example/old-deck. Open to a call?\n\nJonah",
        "Hi Gary,\n\nWould Monday at 9am work for a call with the founder?\n\nJonah",
      ]) {
        const out = await autoSend(
          client,
          row("What is the round size?"),
          bad,
          {
            send,
            vantage: { context: async () => ctx(), logSent: vi.fn() },
          },
        );
        expect(out.sent).toBe(false);
      }
      expect(send).not.toHaveBeenCalled();
    });

    it("still sends when the sent-log fails, since the email is already out", async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const out = await autoSend(
        client,
        row("What is the round size?"),
        DRAFT,
        {
          send,
          vantage: {
            context: async () => ctx(),
            logSent: vi.fn().mockRejectedValue(new Error("500")),
          },
        },
      );
      expect(out.sent).toBe(true);
    });
  });

  it("refuses an unfinished draft", async () => {
    const send = vi.fn();
    for (const bad of [
      "",
      "Hi [NEED: name], thanks",
      "Hi Gary, thanks — talk soon, open to a call?",
      "Hi Gary, the deck is attached for you to review.",
    ]) {
      const out = await autoSend(client, row("What is the round size?"), bad, {
        send,
      });
      expect(out.sent).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing for a client without autopilot or a reply with no lead", async () => {
    const send = vi.fn();
    const off = {
      ...client,
      autopilot: undefined,
    } as unknown as ReplybotClientConfig;
    expect(
      (await autoSend(off, row("What is the round size?"), DRAFT, { send }))
        .sent,
    ).toBe(false);
    expect(
      (
        await autoSend(
          client,
          { ...row("What is the round size?"), lead_id: null },
          DRAFT,
          { send },
        )
      ).sent,
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("lets a failed send throw so the caller posts the card", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Clay 500"));
    await expect(
      autoSend(client, row("What is the round size?"), DRAFT, { send }),
    ).rejects.toThrow("Clay 500");
  });
});

describe("helpers", () => {
  it("builds a reply subject once", () => {
    expect(replySubject("Re: Hi")).toBe("Re: Hi");
    expect(replySubject("Hi")).toBe("Re: Hi");
    expect(replySubject(null)).toBe("Re: Question");
  });

  it("flags drafts with holes", () => {
    expect(draftProblem(DRAFT)).toBeNull();
    expect(
      draftProblem("{{first_name}} thanks for writing back to us"),
    ).not.toBeNull();
  });

  // Caleb, 2026-10-12: "the updates on auto sends are wayyyy too big just give
  // a short summary". One line: who, which company, their first sentence.
  it("posts one short line with no mention", () => {
    const post = sentPost(
      "Gary Zimmerman",
      "Qube Finance",
      "When does it close? We would want the deck first.\n\nGary",
      DRAFT,
    );
    expect(post.text).toBe(
      'Gary Zimmerman on Qube Finance: "When does it close?" Togari replied.',
    );
    expect(post.blocks).toHaveLength(1);
    const text = JSON.stringify(post);
    expect(text).not.toContain("We sent");
    expect(text).not.toContain("Open to a short call");
    expect(text).not.toMatch(/<@|<!here|<!channel/);
  });

  it("keeps a long or quoted reply to one clipped sentence", () => {
    const long = "x".repeat(200);
    expect(gist(long).length).toBeLessThanOrEqual(90);
    expect(
      gist(
        "Very sorry but we have a conflict. Mar\n\nMar Hershenson\nManaging Partner",
      ),
    ).toBe("Very sorry but we have a conflict.");
    expect(gist("Sure, send it\n-----Original Message-----\nFrom: Jonah")).toBe(
      "Sure, send it",
    );
  });

  // Security review, 2026-10-12: a reply body is attacker-controlled, so a
  // hostile one must not make gist backtrack.
  it("stays fast on a hostile reply body", () => {
    const t0 = Date.now();
    gist("\n".repeat(200000) + "x" + "<".repeat(100000) + " a".repeat(100000));
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
