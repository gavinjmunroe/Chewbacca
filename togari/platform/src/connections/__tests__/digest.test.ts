import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getMockState, onFetch, queueBqRows, onAnthropic } from "../../../tests/smoke/helpers";
import {
  groupByTarget,
  headerBlocks,
  isDigestDue,
  localParts,
  packMessages,
  pathBlocks,
  postDigest,
  rankPaths,
  routeText,
  buyerText,
  targetHeaderBlocks,
  targetListBlocks,
} from "../digest";
import { cleanDraft, draftUserPrompt } from "../drafts";
import {
  draftBlocks,
  handleConnectionDraftSubmit,
  handleConnectionEditAction,
  handleConnectionPathAction,
} from "../slack-actions";
import { getReplybotClient } from "../../agents/replybot/client-config";
import { contactEmail, type ConnectionPath } from "../paths";

const PREV_TOKEN = process.env.SLACK_BOT_TOKEN;
const PREV_KEY = process.env.ANTHROPIC_API_KEY;
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.ANTHROPIC_API_KEY = "sk-test";
afterAll(() => {
  if (PREV_TOKEN === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = PREV_TOKEN;
  if (PREV_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = PREV_KEY;
});

function path(over: Partial<ConnectionPath> = {}): ConnectionPath {
  return {
    path_id: "p-hss",
    client_id: "serif",
    person_row_id: "conn-test-1",
    champion_name: "Shannon Yarrow",
    champion_title: "SVP Managed Care",
    champion_company: "Surgery Partners",
    champion_email: "shannon.yarrow@surgerypartners.com",
    bridge_name: "Justin Oppenheimer",
    bridge_title: "COO",
    bridge_relation: "colleague",
    bridge_linkedin: "https://www.linkedin.com/in/justin",
    former_employer: "Hospital for Special Surgery",
    former_title: "VP Operations",
    start_year: 2016,
    end_year: 2021,
    role_source_url: "https://example.com/justin",
    target_account: "HSS",
    target_segment: "Health Systems",
    match: "domain",
    buyer_name: "Alison Solach",
    buyer_title: "Director, Payer Strategy & Contracting",
    buyer_persona: "managed_care_contracting",
    buyer_linkedin: "https://www.linkedin.com/in/alison",
    buyer_source_url: "https://example.com/alison",
    buyer_joined_year: 2018,
    tenure_overlap: "yes",
    overlap_years: 3,
    slack_channel: "C0BAL9JV0E5",
    slack_ts: "100.1",
    thread_ts: "100.1",
    verdict: null,
    verdict_by: null,
    verdict_at: null,
    draft: null,
    draft_ts: null,
    ...over,
  };
}

const TENET_SELF = path({
  path_id: "p-tenet",
  bridge_name: "Shannon Yarrow",
  bridge_title: "SVP Managed Care",
  bridge_relation: "self",
  start_year: 2004,
  end_year: 2007,
  target_account: "Tenet",
  buyer_name: "Pat Rivera",
  buyer_title: "SVP Managed Care",
  buyer_joined_year: 2005,
  overlap_years: 2,
});

const SERIF = getReplybotClient("serif")!;
const SERIF_TEST = getReplybotClient("serif_test")!;

const posts = () =>
  getMockState().fetch.calls.filter((c: any) => String(c.url).includes("chat.postMessage"));
const updates = () =>
  getMockState().fetch.calls.filter((c: any) => String(c.url).includes("chat.update"));
const body = (c: any) => JSON.parse(c.init.body);

let tsCounter = 0;
beforeEach(() => {
  tsCounter = 0;
  onFetch("chat.postMessage", () => ({ ok: true, ts: `200.${++tsCounter}` }));
  onFetch("chat.update", { ok: true });
  onFetch("views.open", { ok: true });
});

describe("ordering", () => {
  it("puts overlap first, then the most recent bridge, then the closest buyer", () => {
    const noOverlap = path({ path_id: "a", tenure_overlap: "no", end_year: 2024 });
    const unknownRecent = path({ path_id: "b", tenure_overlap: "unknown", end_year: 2023 });
    const yesOld = path({ path_id: "c", tenure_overlap: "yes", end_year: 2007 });
    const yesNewExec = path({ path_id: "d", tenure_overlap: "yes", end_year: 2021, buyer_persona: "executive" });
    const yesNewContracting = path({ path_id: "e", tenure_overlap: "yes", end_year: 2021 });
    expect(rankPaths([noOverlap, unknownRecent, yesOld, yesNewExec, yesNewContracting]).map((p) => p.path_id)).toEqual([
      "e",
      "d",
      "c",
      "b",
      "a",
    ]);
  });
});

describe("what a route says", () => {
  it("starts with the person to ask, then the colleague, then the buyer", () => {
    const [line1, line2] = routeText(path()).split("\n");
    expect(line1).toBe("Shannon Yarrow → Justin Oppenheimer (COO) → Alison Solach");
    expect(line2).toContain("Justin at HSS 2016–2021");
    expect(line2).toContain("overlap 3 yrs");
    expect(line2).toContain("<https://www.linkedin.com/in/justin|Justin>");
  });

  it("links the bridge's profile once when it is also the job's source", () => {
    const line2 = routeText(path({ role_source_url: "https://www.linkedin.com/in/justin" })).split("\n")[1];
    expect(line2.match(/linkedin\.com\/in\/justin/g)).toHaveLength(1);
  });

  it("goes straight from the champion to the buyer when they are the bridge", () => {
    const [line1, line2] = routeText(TENET_SELF).split("\n");
    expect(line1).toBe("Shannon Yarrow → Pat Rivera");
    expect(line2).toContain("Shannon at Tenet 2004–2007");
  });

  it("gives the buyer their own line: who, when they joined, where to look them up", () => {
    expect(buyerText(path())).toBe(
      "*Alison Solach* · Director, Payer Strategy &amp; Contracting\n" +
        "Joined HSS 2018 · <https://www.linkedin.com/in/alison|LinkedIn> · <https://example.com/alison|source>",
    );
  });

  it("shows buttons until someone decides, then who decided", () => {
    expect(pathBlocks(path(), "America/New_York")[1].type).toBe("actions");
    const decided = pathBlocks(
      path({ verdict: "good", verdict_by: "U123", verdict_at: "2026-10-12T14:14:00Z" }),
      "America/New_York",
    )[1];
    expect(decided.type).toBe("context");
    expect(decided.elements[0].text).toContain("Good path · <@U123>, 10:14 AM");
  });

  it("says what overlap does and does not mean, every time", () => {
    const note = headerBlocks({
      date: new Date(),
      timezone: "America/New_York",
      total: 3,
      champions: 2,
      targets: 2,
    })[1];
    expect(note.elements[0].text).toContain("not that they know each other");
  });
});

describe("grouped by target account", () => {
  const carolViaEric = path({ path_id: "c1", target_account: "Tenet", buyer_name: "Carol Han", bridge_name: "Eric Evans", tenure_overlap: "yes", end_year: 2019 });
  const sapna = path({ path_id: "s1", target_account: "Tenet", buyer_name: "Sapna Grover", bridge_name: "Eric Evans", tenure_overlap: "yes", end_year: 2018 });
  const carolViaShannon = path({ path_id: "c2", target_account: "Tenet", buyer_name: "Carol Han", bridge_name: "Shannon Yarrow", bridge_relation: "self", tenure_overlap: "no", end_year: 2007 });
  const hss = path({ path_id: "h1", tenure_overlap: "possible", end_year: 2021 });

  it("puts the strongest target first and keeps each buyer's routes together", () => {
    const groups = groupByTarget([carolViaShannon, hss, sapna, carolViaEric]);
    expect(groups.map((g) => g.account)).toEqual(["Tenet", "HSS"]);
    expect(groups[0].paths.map((p) => p.path_id)).toEqual(["c1", "c2", "s1"]);
  });

  it("opens each target with its name, large, then who to ask and their email", () => {
    const [group] = groupByTarget([carolViaEric, carolViaShannon, sapna]);
    const [header, ask] = targetHeaderBlocks(group, 0);
    expect(header).toMatchObject({ type: "header", text: { type: "plain_text", text: "Tenet" } });
    const text = ask.text.text;
    expect(text).toContain("Health Systems · 3 routes to 2 people");
    expect(text).toContain(
      "Ask *Shannon Yarrow* (SVP Managed Care, Surgery Partners) · <mailto:shannon.yarrow@surgerypartners.com|shannon.yarrow@surgerypartners.com>",
    );
  });

  it("lists each customer contact once, and says when there is no email", () => {
    const other = path({ path_id: "o1", target_account: "Tenet", champion_name: "Brent Carson", champion_title: "VP Managed Care", champion_company: "University Hospitals", champion_email: null, person_row_id: "conn-x" });
    const [group] = groupByTarget([carolViaEric, sapna, other]);
    const text = targetHeaderBlocks(group, 0)[1].text.text;
    expect(text.match(/Ask \*Shannon Yarrow\*/g)).toHaveLength(1);
    expect(text).toContain("Ask *Brent Carson* (VP Managed Care, University Hospitals) · _no email on file_");
  });

  it("puts each buyer first, with every route to them underneath", () => {
    const [group] = groupByTarget([carolViaShannon, sapna, carolViaEric]);
    const kinds = targetListBlocks([group], "America/New_York").map((b: any) =>
      b.type === "header"
        ? "target"
        : b.block_id?.startsWith("conntarget_ask")
          ? "ask"
          : b.block_id?.startsWith("connbuyer")
            ? `buyer:${b.text.text.match(/^\*([^*]+)\*/)[1]}`
            : b.block_id?.startsWith("connpath_text")
              ? "route"
              : b.type,
    );
    expect(kinds).toEqual([
      "target",
      "ask",
      "buyer:Carol Han",
      "route",
      "actions",
      "route",
      "actions",
      "buyer:Sapna Grover",
      "route",
      "actions",
    ]);
  });

  it("uses a row id that is an email when nothing else is on file", () => {
    expect(contactEmail({ champion_email: null, person_row_id: "Bret.Hicks@tmcaz.com" })).toBe("Bret.Hicks@tmcaz.com");
    expect(contactEmail({ champion_email: null, person_row_id: "conn-test-1" })).toBeNull();
  });

  it("keeps a target whole in one message when it fits", () => {
    const groups = groupByTarget([
      ...Array.from({ length: 12 }, (_, i) => path({ path_id: `t${i}`, target_account: "Tenet" })),
      ...Array.from({ length: 12 }, (_, i) => path({ path_id: `h${i}`, target_account: "HSS" })),
    ]);
    const messages = packMessages(groups);
    // 3 (header) + 28 + 28 > 50: the second target moves to its own message whole.
    expect(messages.map((m) => m.map((g) => `${g.account}:${g.paths.length}`))).toEqual([["HSS:12"], ["Tenet:12"]]);
  });
});

describe("when the digest goes out", () => {
  // Monday 2026-10-12, 13:30 UTC = 9:30 AM in New York.
  const MONDAY_930_ET = new Date("2026-10-12T13:30:00Z");

  it("reads the client's own clock", () => {
    expect(localParts(MONDAY_930_ET, "America/New_York")).toEqual({
      weekday: "Mon",
      hour: 9,
      date: "2026-10-12",
    });
  });

  it("is due on a weekday morning when today's has not gone out", async () => {
    queueBqRows([{ d: "2026-10-09" }]); // last digest: Friday
    expect(await isDigestDue(SERIF, MONDAY_930_ET)).toBe(true);
  });

  it("never posts twice in a day, even after a restart", async () => {
    queueBqRows([{ d: "2026-10-12" }]);
    expect(await isDigestDue(SERIF, MONDAY_930_ET)).toBe(false);
  });

  it("waits for Monday at weekends, and does not post in the afternoon", async () => {
    expect(await isDigestDue(SERIF, new Date("2026-10-10T13:30:00Z"))).toBe(false); // Saturday
    expect(await isDigestDue(SERIF, new Date("2026-10-12T19:00:00Z"))).toBe(false); // 3 PM ET
  });
});

describe("posting the digest", () => {
  it("posts Serif's routes by target, strongest first, to the opportunity channel", async () => {
    queueBqRows([]); // claim
    queueBqRows([TENET_SELF, path()]); // the claimed routes
    const n = await postDigest(SERIF, new Date("2026-10-12T13:30:00Z"));

    expect(n).toBe(2);
    expect(posts()).toHaveLength(1);
    const msg = body(posts()[0]);
    expect(msg.channel).toBe("C0BAL9JV0E5");
    // HSS (overlap 3 yrs, 2021) ranks above Tenet (overlap 2 yrs, 2007).
    expect(msg.blocks.filter((b: any) => b.type === "header").map((b: any) => b.text.text)).toEqual(["HSS", "Tenet"]);
    const texts = msg.blocks.filter((b: any) => b.type === "section").map((b: any) => b.text.text);
    expect(texts[0]).toContain("Warm-intro paths · Mon, Oct 12");
    expect(texts[1]).toContain("shannon.yarrow@surgerypartners.com");
    expect(texts[2]).toMatch(/^\*Alison Solach\*/);
    expect(texts[3]).toMatch(/^Shannon Yarrow → Justin Oppenheimer \(COO\) → Alison Solach/);
    expect(texts[5]).toMatch(/^\*Pat Rivera\*/);
    expect(texts[6]).toMatch(/^Shannon Yarrow → Pat Rivera/);

    const saved = getMockState().bq.writes.find((w: any) => w.sql.includes("slack_ts = @slackTs"));
    expect(saved.params).toMatchObject({ slackTs: "200.1", threadTs: "200.1", channel: "C0BAL9JV0E5" });
  });

  it("sends serif_test's routes to #test-channel, never Serif's", async () => {
    queueBqRows([]);
    queueBqRows([path({ client_id: "serif_test" })]);
    await postDigest(SERIF_TEST);
    expect(body(posts()[0]).channel).toBe("C0C14UKEEUR");
  });

  it("carries a target too big for one message into the thread, marked continued", async () => {
    const many = Array.from({ length: 30 }, (_, i) => path({ path_id: `p${String(i).padStart(2, "0")}` }));
    queueBqRows([]);
    queueBqRows(many);
    expect(await postDigest(SERIF)).toBe(30);
    expect(posts()).toHaveLength(2);
    expect(body(posts()[0]).blocks.length).toBeLessThanOrEqual(50);
    expect(body(posts()[1]).blocks.length).toBeLessThanOrEqual(50);
    expect(body(posts()[1]).thread_ts).toBe("200.1");
    expect(JSON.stringify(body(posts()[1]).blocks)).toContain("continued");
  });

  it("posts nothing on a day with nothing new", async () => {
    queueBqRows([]);
    queueBqRows([]);
    expect(await postDigest(SERIF)).toBe(0);
    expect(posts()).toHaveLength(0);
  });

  it("puts the paths back for tomorrow when Slack refuses the post", async () => {
    getMockState().fetch.handlers.length = 0;
    onFetch("chat.postMessage", { ok: false, error: "not_in_channel" });
    queueBqRows([]);
    queueBqRows([path()]);
    await expect(postDigest(SERIF)).rejects.toThrow(/not_in_channel/);
    const released = getMockState().bq.writes.find((w: any) => w.sql.includes("posted_at = NULL"));
    expect(released).toBeTruthy();
  });
});

describe("the buttons", () => {
  const click = (actionId: string, value: string) => ({
    type: "block_actions",
    user: { id: "U123" },
    channel: { id: "C0BAL9JV0E5" },
    trigger_id: "trig-1",
    message: {
      ts: "100.1",
      blocks: [
        { type: "section", block_id: "connhead_title", text: { type: "mrkdwn", text: "*Warm-intro paths*" } },
        { type: "context", block_id: "connhead_note", elements: [] },
      ],
    },
    actions: [{ action_id: actionId, value }],
  });

  it("Good path: records it, redraws in place, and drafts the ask in the thread", async () => {
    onAnthropic(
      "Hi Shannon, a favor to ask — we'd love to reach Alison at HSS. See https://serifhealth.com\n\nBest,",
    );
    queueBqRows([path()]); // getPath
    queueBqRows([]); // claimVerdict
    queueBqRows([path({ verdict: "good", verdict_by: "U123", verdict_at: "2026-10-12T14:14:00Z" })]); // redraw
    queueBqRows([path({ verdict: "good" })]); // fresh path for the draft

    await handleConnectionPathAction(click("connpath_good", "p-hss"));

    const verdict = getMockState().bq.writes.find((w: any) => w.sql.includes("verdict = @verdict"));
    expect(verdict.params).toMatchObject({ pathId: "p-hss", verdict: "good", userId: "U123" });

    const redraw = body(updates()[0]);
    expect(redraw.ts).toBe("100.1");
    expect(redraw.blocks[0].block_id).toBe("connhead_title");
    expect(JSON.stringify(redraw.blocks)).toContain("Good path · <@U123>");

    const draft = body(posts()[0]);
    expect(draft.thread_ts).toBe("100.1");
    const shown = JSON.stringify(draft.blocks);
    expect(shown).toContain("Draft ask to Shannon Yarrow");
    expect(shown).toContain("To: <mailto:shannon.yarrow@surgerypartners.com|shannon.yarrow@surgerypartners.com>");
    expect(shown).toContain("intro to Justin Oppenheimer, then Alison Solach at HSS");
    // Cleaned: no em dash, no link, no sign-off.
    expect(shown).not.toContain("—");
    expect(shown).not.toContain("serifhealth.com");
    expect(shown).not.toMatch(/Best,/);
  });

  it("Not a fit: records it and drafts nothing", async () => {
    queueBqRows([path()]);
    queueBqRows([]);
    queueBqRows([path({ verdict: "not_a_fit", verdict_by: "U123" })]);
    await handleConnectionPathAction(click("connpath_bad", "p-hss"));
    expect(JSON.stringify(body(updates()[0]).blocks)).toContain("Not a fit");
    expect(posts()).toHaveLength(0);
  });

  it("a second Good path click on a decided path does not draft again", async () => {
    queueBqRows([path({ verdict: "good" })]); // getPath
    queueBqRows([]); // claimVerdict...
    getMockState().bq.writeAffectedRows.push("0"); // ...which loses: already decided
    queueBqRows([path({ verdict: "good", verdict_by: "U999" })]); // redraw
    await handleConnectionPathAction(click("connpath_good", "p-hss"));
    expect(posts()).toHaveLength(0);
    // The redraw still shows who decided first.
    expect(JSON.stringify(body(updates()[0]).blocks)).toContain("<@U999>");
  });

  it("a failed draft says so and keeps Regenerate", () => {
    const blocks = draftBlocks(path(), null, { failed: true });
    const shown = JSON.stringify(blocks);
    expect(shown).toContain("Couldn't draft this one");
    expect(shown).toContain("connpath_regen");
    expect(shown).not.toContain("connpath_edit");
  });

  it("Edit opens the modal from the button alone, before any database read", async () => {
    const value = JSON.parse(
      draftBlocks(path(), "Hi Shannon, a favor to ask.").at(-1).elements[0].value,
    );
    await handleConnectionEditAction({
      trigger_id: "trig-9",
      actions: [{ action_id: "connpath_edit", value: JSON.stringify(value) }],
    });
    expect(getMockState().bq.queries).toHaveLength(0);
    const open = getMockState().fetch.calls.find((c: any) => String(c.url).includes("views.open"));
    const view = body(open).view;
    expect(body(open).trigger_id).toBe("trig-9");
    expect(view.blocks[1].element.initial_value).toBe("Hi Shannon, a favor to ask.");
    expect(JSON.parse(view.private_metadata).pathId).toBe("p-hss");
  });

  it("saving an edit updates the thread reply and closes the modal", async () => {
    queueBqRows([path({ draft_ts: "300.1", verdict: "good" })]); // getPath
    const out = await handleConnectionDraftSubmit({
      user: { id: "U123" },
      view: {
        private_metadata: JSON.stringify({ pathId: "p-hss" }),
        state: { values: { draft_block: { draft_input: { value: "Hi Shannon, edited." } } } },
      },
    });
    expect(out).toEqual({ response_action: "clear" });
    const saved = getMockState().bq.writes.find((w: any) => w.sql.includes("draft = @draft"));
    expect(saved.params.draft).toBe("Hi Shannon, edited.");
    const upd = body(updates()[0]);
    expect(upd.ts).toBe("300.1");
    expect(JSON.stringify(upd.blocks)).toContain("Edited by <@U123>");
  });

  it("refuses an empty edit", async () => {
    const out = await handleConnectionDraftSubmit({
      view: {
        private_metadata: JSON.stringify({ pathId: "p-hss" }),
        state: { values: { draft_block: { draft_input: { value: "  " } } } },
      },
    });
    expect(out.response_action).toBe("errors");
  });
});

describe("the draft", () => {
  it("asks the champion for the bridge when the bridge is a colleague", () => {
    const prompt = draftUserPrompt(path(), "Serif Health");
    expect(prompt).toContain("Write to: Shannon Yarrow, SVP Managed Care at Surgery Partners");
    expect(prompt).toContain("connect us with their colleague Justin Oppenheimer");
    expect(prompt).toContain("Alison Solach");
  });

  it("asks the champion directly when they are the bridge", () => {
    const prompt = draftUserPrompt(TENET_SELF, "Serif Health");
    expect(prompt).toContain("introduce us to Pat Rivera, SVP Managed Care at Tenet");
    expect(prompt).toContain("they were at Tenet (2004 to 2007)");
  });

  it("strips links, dashes and sign-offs a model slips in", () => {
    expect(cleanDraft("Hi Shannon — would you? https://x.co/y\n\nThanks!\n")).toBe("Hi Shannon, would you?");
  });
});
