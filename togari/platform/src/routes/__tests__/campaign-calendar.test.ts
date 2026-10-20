import { describe, expect, it } from "vitest";
import {
  defaultWeek,
  layoutWeek,
  renderCalendar,
  scriptJson,
} from "../campaign-calendar";
import { monthDays, type CalendarSnapshot } from "../../campaigns/calendar";
import { themeFor } from "../../campaigns/themes";

const WEEK = [
  "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
  "2026-10-16", "2026-10-17", "2026-10-18",
];
const camp = (id: string, from: string, to: string, extra = {}) => ({
  id,
  name: `Campaign ${id}`,
  channel: "email" as const,
  first_send: from,
  last_send: to,
  planned_start: null,
  planned_end: null,
  ...extra,
});

describe("layoutWeek", () => {
  it("stacks overlapping campaigns and lets the rest share a lane", () => {
    const { bars, lanes } = layoutWeek(
      WEEK,
      [
        camp("a", "2026-10-01", "2026-10-14"), // Mon-Wed
        camp("b", "2026-10-13", "2026-10-20"), // Tue-Sun, overlaps a
        camp("c", "2026-10-16", "2026-10-17"), // Fri-Sat, fits after a
      ],
      new Map(),
    );
    expect(lanes).toBe(2);
    const by = Object.fromEntries(bars.map((b) => [b.id, b]));
    expect(by.a).toMatchObject({ lane: 0, from: 1, to: 3 });
    expect(by.b).toMatchObject({ lane: 1, from: 2, to: 7 });
    expect(by.c).toMatchObject({ lane: 0, from: 5, to: 6 });
  });

  it("draws planned days apart from the days it sent", () => {
    const { bars } = layoutWeek(
      WEEK,
      [camp("p", "2026-10-12", "2026-10-13", { planned_end: "2026-10-16" })],
      new Map(),
    );
    expect(bars[0]).toMatchObject({ from: 1, to: 5, sent: { from: 1, to: 2 } });
  });

  it("leaves out campaigns that don't touch the week", () => {
    expect(
      layoutWeek(WEEK, [camp("x", "2026-09-01", "2026-09-30")], new Map()).bars,
    ).toHaveLength(0);
  });
});

function snapshot(over: Partial<CalendarSnapshot> = {}): CalendarSnapshot {
  return {
    client: "Serif Health",
    clientId: "serif",
    month: "2026-10",
    tz: "America/New_York",
    as_of: "2026-10-14T16:00:00Z",
    today: "2026-10-14",
    days: monthDays("2026-10"),
    campaigns: [camp("907", "2026-10-05", "2026-10-14")],
    weeks: {},
    daily: { "2026-10-13": { "907": 212, "*": 212 } },
    waiting: [],
    followups: [],
    linkedin: null,
    plans: [],
    notes: [],
    ...over,
  };
}

describe("renderCalendar", () => {
  it("draws the month, the campaign and the day's sends", () => {
    const html = renderCalendar(snapshot(), { nonce: "abc" });
    expect(html).toContain("October 2026");
    expect(html).toContain("Campaign 907");
    expect(html).toContain('href="?m=2026-09"');
    expect(html).toContain('href="?m=2026-11"');
    expect(html).toContain(">212<");
    expect(html).toContain(`--c:${themeFor(undefined).campaigns[0]}`);
    expect(html).toContain('<script nonce="abc">');
  });

  it("gives the page each campaign's colour for the outcome popup and the campaign table", () => {
    const html = renderCalendar(snapshot(), { nonce: "n" });
    const data = JSON.parse(
      html.split('<script id="cal-data" type="application/json">')[1].split("</script>")[0],
    );
    expect(data.campaigns[0].color).toBe(themeFor(undefined).campaigns[0]);
    expect(html).toContain('id="p-pop"');
    expect(html).toContain('id="p-camps"');
    expect(html).toContain("By campaign");
  });

  it("wears the client's theme", () => {
    const serif = themeFor("serif");
    const html = renderCalendar(snapshot(), { nonce: "n", theme: serif });
    expect(html).toContain("family=Sora");
    expect(html).toContain(`--accent:${serif.accent}`);
    expect(html).toContain(`--c:${serif.campaigns[0]}`);
    expect(html).toContain("color-scheme:light");
  });

  it("escapes names from Clay everywhere they appear", () => {
    const evil = '<img src=x onerror=alert(1)></script>';
    const html = renderCalendar(
      snapshot({
        campaigns: [{ ...camp("907", "2026-10-05", "2026-10-14"), name: evil }],
        waiting: [
          {
            lead: "x@y.com",
            name: evil,
            campaign_id: "907",
            campaign: evil,
            outcome: "interested",
            at: "2026-10-13T15:00:00Z",
            day: "2026-10-13",
            channel: "email" as const,
          },
        ],
      }),
      { nonce: "abc" },
    );
    expect(html).not.toContain("<img");
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  it("says how many replies are waiting", () => {
    const one = renderCalendar(
      snapshot({
        waiting: [
          {
            lead: "x@y.com", name: null, campaign_id: "907", campaign: null,
            outcome: "needs_read", at: "2026-10-13T15:00:00Z", day: "2026-10-13",
            channel: "email" as const,
          },
        ],
      }),
      { nonce: "n" },
    );
    expect(one).toContain("1 reply is waiting on an answer");
    expect(renderCalendar(snapshot(), { nonce: "n" })).toContain(
      "Every reply that needs an answer has one.",
    );
  });

  it("links back to the outbound summary only when there is one", () => {
    expect(
      renderCalendar(snapshot(), { nonce: "n", dashHref: "/dash/abc" }),
    ).toContain('href="/dash/abc"');
    expect(renderCalendar(snapshot(), { nonce: "n" })).not.toContain(
      "Outbound summary",
    );
  });

  it("says so when a month has no campaigns", () => {
    expect(
      renderCalendar(snapshot({ campaigns: [] }), { nonce: "n" }),
    ).toContain("No campaign ran in October 2026.");
  });
});

describe("renderCalendar with LinkedIn", () => {
  const li = snapshot({
    campaigns: [
      camp("907", "2026-10-05", "2026-10-14"),
      { ...camp("li:501", "2026-10-13", "2026-10-14"), name: "HFMA Region 2", channel: "linkedin" as const, status: "IN_PROGRESS" },
    ],
    linkedin: { weeks: {}, daily: { "2026-10-13": { "li:501": 49, "*": 49 } } },
  });

  it("adds the channel switch, groups campaigns and marks LinkedIn bars", () => {
    const html = renderCalendar(li, { nonce: "n" });
    expect(html).toContain('class="channels"');
    expect(html).toContain('data-ch="linkedin" aria-pressed="false">LinkedIn</button>');
    expect(html).toContain('<div class="keyrow" data-ch="linkedin"><span class="group">LinkedIn</span>');
    expect(html).toContain('<b class="in" title="LinkedIn">in</b>HFMA Region 2');
    expect(html).toContain("HFMA Region 2 <small>Sending</small>");
    // Oct 13: 212 emails plus 49 LinkedIn requests and messages.
    expect(html).toContain(">261<");
  });

  it("leaves the switch off for a client without LinkedIn", () => {
    expect(renderCalendar(snapshot(), { nonce: "n" })).not.toContain('class="channels"');
  });
});

describe("renderCalendar conferences", () => {
  it("lists them with a remove button and offers to add one", () => {
    const html = renderCalendar(
      snapshot({
        campaigns: [
          camp("907", "2026-10-05", "2026-10-14"),
          { ...camp("plan:p2", "2026-10-26", "2026-11-06"), name: "HFMA Region 4", channel: "plan" as const, first_send: null, last_send: null, planned_start: "2026-10-26", planned_end: "2026-11-06" },
        ],
        plans: [{ id: "p2", name: "HFMA <Region 4>", start: "2026-10-26", end: "2026-11-06" }],
      }),
      { nonce: "n" },
    );
    expect(html).toContain('id="plan-open">Add a conference</button>');
    expect(html).toContain('<input type="date" name="start" required>');
    expect(html).toContain('data-plan="p2" data-name="HFMA &lt;Region 4&gt;">Remove</button>');
    expect(html).toContain("Oct 26 to Nov 6, 2026");
    expect(html).toContain('class="bar planned" data-c="plan:p2" data-ch="plan"');
    expect(html).toContain("HFMA Region 4 <small>Planned</small>");
  });

  it("says when there are none", () => {
    expect(renderCalendar(snapshot(), { nonce: "n" })).toContain("No conferences added yet.");
  });
});

describe("defaultWeek", () => {
  it("opens on this week, or the first week that sent anything", () => {
    expect(defaultWeek(snapshot())).toBe("2026-10-12");
    const sept = snapshot({
      month: "2026-09",
      days: monthDays("2026-09"),
      today: "2026-10-14",
      weeks: { "2026-09-14": { "*": { sent: 5 } as any } },
    });
    expect(defaultWeek(sept)).toBe("2026-09-14");
  });
});

describe("the page's own script", () => {
  // 2026-10-14: an escaped quote inside the script's template string lost its
  // backslash and the whole page went dead in the browser. Tests that only
  // read the HTML never saw it.
  it("is valid JavaScript", () => {
    for (const snap of [snapshot(), snapshot({ linkedin: { weeks: {}, daily: {} } })]) {
      const js = renderCalendar(snap, { nonce: "n" }).split('<script nonce="n">')[1].split("</script>")[0];
      expect(() => new Function(js)).not.toThrow();
    }
  });
});

describe("scriptJson", () => {
  it("can't close the script tag or break the line", () => {
    const out = scriptJson({ a: "</script> " });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain(" ");
    expect(JSON.parse(out)).toEqual({ a: "</script> " });
  });
});
