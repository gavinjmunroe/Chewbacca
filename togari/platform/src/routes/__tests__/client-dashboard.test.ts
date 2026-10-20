import { describe, expect, it } from "vitest";
import {
  clientForToken,
  meetingBlocker,
  ownWords,
  readThread,
  renderDashboard,
  type DashboardSnapshot,
} from "../client-dashboard";
import { renewedSession } from "../../integrations/clay/campaign-read";

const TOKEN = "a".repeat(40);

const snap: DashboardSnapshot = {
  client: "Zeutara",
  as_of: "2026-10-14T05:30:00Z",
  totals: { reached: 1088, sent: 2740, replied: 91, bounces: 35 },
  companies: [
    {
      company: "Qube Finance",
      reached: 206,
      sent: 520,
      replied: 15,
      reply_rate: 7.3,
      bounces: 4,
      bounce_rate: 0.8,
    },
  ],
  conversations: [
    {
      name: "clive@nabu-llc.com",
      company: "Vertocol",
      wants: "Come back later",
      said: "<script>alert(1)</script> May be interested",
      since: "2026-10-06T00:00:00Z",
      status: "answered",
    },
    {
      name: "gary@fund.example",
      company: "Qube Finance",
      wants: "Asked a question",
      said: "What is the revenue?",
      since: "2026-10-13T00:00:00Z",
      status: "needs_reply",
    },
  ],
  threads_read: 120,
  threads_total: 123,
};

const msg = (type: string, time: string, body: string) => ({
  type,
  time,
  body,
  from: "",
  messageId: `${type}-${time}`,
  subject: "",
});

describe("client dashboard", () => {
  it("only opens for a token in DASHBOARD_TOKENS", () => {
    const map = JSON.stringify({ [TOKEN]: "zeutara" });
    expect(clientForToken(TOKEN, map)).toBe("zeutara");
    expect(clientForToken("b".repeat(40), map)).toBeNull();
    expect(clientForToken("short", map)).toBeNull();
    expect(clientForToken(TOKEN, "not json")).toBeNull();
    expect(
      clientForToken(TOKEN, JSON.stringify({ [TOKEN]: "x`; DROP" })),
    ).toBeNull();
  });

  it("shows reach, sends, people replied, rates and conversations", () => {
    const html = renderDashboard(snap, Date.parse("2026-10-14T06:00:00Z"));
    for (const s of [
      "1,088",
      "2,740",
      "8.4% of investors, people only",
      "1.3%",
      "Qube Finance",
      "7.3%",
      "Investor conversations",
      "1 need a reply from us",
      "8 days ago",
      "We replied. Waiting on them.",
      "Needs a reply from us.",
      "120 of 123 threads were read",
    ]) {
      expect(html).toContain(s);
    }
  });

  it("lists conversations that need us first", () => {
    const html = renderDashboard(snap);
    expect(html.indexOf("gary@fund.example")).toBeLessThan(
      html.indexOf("clive@nabu-llc.com") + 1e9,
    );
  });

  it("escapes reply text, since investors write it", () => {
    const html = renderDashboard(snap);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("says so when there are no conversations", () => {
    expect(renderDashboard({ ...snap, conversations: [] })).toContain(
      "No open investor conversations right now.",
    );
  });

  it("keeps only their own words above the quoted thread", () => {
    const body =
      "Yes, send the deck.<br /><br />On Tue, Oct 13, 2026 Jonah wrote:<br />&gt; Would a call be useful?";
    expect(ownWords(body)).toBe("Yes, send the deck.");
  });

  // 2026-10-16: the first dashboard read the inbox's last-sent time, which
  // misses Togari's own replies, and counted auto-replies as replies.
  it("reads an answered question as answered, from the thread itself", () => {
    const seen = readThread(
      [
        msg("SENT", "2026-10-07T17:00:00Z", "Hi"),
        msg("REPLY", "2026-10-16T19:17:50Z", "what is the company?"),
        msg("SENT", "2026-10-16T19:50:26Z", "It's the Chicago dating app"),
      ],
      "ethan@fund.example",
      "Ivy",
      null,
    );
    expect(seen).toMatchObject({
      human: true,
      conversation: true,
      status: "answered",
    });
  });

  it("does not count a reply seconds after our email as a person", () => {
    const seen = readThread(
      [
        msg("SENT", "2026-10-07T17:47:55Z", "Hi"),
        msg(
          "REPLY",
          "2026-10-07T17:48:00Z",
          "Thanks for reaching out. I am traveling this week.",
        ),
      ],
      "auto@fund.example",
      "Ivy",
      null,
    );
    expect(seen?.human).toBe(false);
    expect(seen?.conversation).toBe(false);
  });

  it("counts a pass as a person who replied, not a conversation", () => {
    const seen = readThread(
      [
        msg("SENT", "2026-10-07T17:00:00Z", "Hi"),
        msg("REPLY", "2026-10-08T17:00:00Z", "Thanks, but not a fit for us."),
      ],
      "pass@fund.example",
      "Ivy",
      null,
    );
    expect(seen).toMatchObject({ human: true, conversation: false });
  });

  it("names what stands between a yes and a meeting", () => {
    expect(meetingBlocker("deck", { hasDeck: false, bookingUrl: null })).toBe(
      "Deck isn't in Vantage yet",
    );
    expect(
      meetingBlocker("interested", { hasDeck: true, bookingUrl: null }),
    ).toBe("Founder booking link isn't in Vantage yet");
    expect(
      meetingBlocker("interested", {
        hasDeck: true,
        bookingUrl: "https://cal.example/x",
      }),
    ).toBeNull();
    expect(
      meetingBlocker("later", { hasDeck: false, bookingUrl: null }),
    ).toBeNull();
    expect(meetingBlocker("deck", null)).toBeNull();
  });

  it("renders filters, the thread, blockers and the nonce'd script", () => {
    const html = renderDashboard(
      {
        ...snap,
        conversations: [
          {
            ...snap.conversations[1],
            kind: "question",
            blocker: "Founder booking link isn't in Vantage yet",
            thread: [
              { from: "us", at: "2026-10-12T00:00:00Z", text: "Hi Gary" },
              {
                from: "them",
                at: "2026-10-13T00:00:00Z",
                text: "<b>revenue?</b>",
              },
            ],
          },
        ],
      },
      Date.parse("2026-10-14T06:00:00Z"),
      undefined,
      "abc123",
    );
    for (const s of [
      'data-status="needs_reply"',
      "Meeting blocked",
      "Founder booking link isn&#39;t in Vantage yet",
      'class="thread"',
      "&lt;b&gt;revenue?&lt;/b&gt;",
      '<script nonce="abc123">',
      "Search investors",
    ])
      expect(html).toContain(s);
    expect(html).not.toContain("<b>revenue?</b>");
    // 2026-10-17: with sessionStorage blocked (private mode) both catches were
    // empty, so a stale page reloaded itself every minute. Blocked storage now
    // means no auto-reload.
    expect(html).not.toContain("catch(e){}");
    expect(html).toContain("catch(e){return;}location.reload()");
  });

  it("reads the last messages of a thread into its card", () => {
    const seen = readThread(
      [
        msg("SENT", "2026-10-07T17:00:00Z", "Hi Ethan"),
        msg("REPLY", "2026-10-16T19:17:50Z", "what is the company?"),
      ],
      "ethan@fund.example",
      "Ivy",
      null,
    );
    expect(seen?.kind).toBe("question");
    expect(seen?.thread.map((m) => m.from)).toEqual(["us", "them"]);
  });

  it("picks up a renewed Clay session from Set-Cookie", () => {
    expect(
      renewedSession(["foo=1; Path=/", "claysession=abc123; Path=/; HttpOnly"]),
    ).toBe("abc123");
    expect(renewedSession(["__Host-claysession=xyz; Secure"])).toBe("xyz");
    expect(renewedSession(["claysession=deleted; Max-Age=0"])).toBeNull();
    expect(renewedSession([])).toBeNull();
  });
});
