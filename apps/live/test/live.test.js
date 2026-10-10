import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-chars-long"; // secret-scan: allow, a fixture, not a credential
const { wilson, verdicts, rates, BOUNCE_FLAG } = await import("../lib/stats.js");
const { validateBlock, KYBER, TYPES } = await import("../lib/blocks.js");
const { renderBlock, KNOWN } = await import("../public/render.js");
const { StatsHub, staleNote } = await import("../lib/freshness.js");
const { cleanProse, togariDid } = await import("../lib/rules.js");
const { tier0, planFromShow, runPlan } = await import("../lib/answer.js");
const C = await import("../lib/compose.js");
const { createApp, sign, accessFor, checkRows } = await import("../server.js");
const { togariSource } = await import("../lib/sources.js");

// ---------------------------------------------------------------- math

test("wilson matches the textbook intervals", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 5e-4, `${a} vs ${b}`);
  const zero = wilson(0, 10);
  near(zero.low, 0);
  near(zero.high, 0.2775);
  const half = wilson(5, 10);
  near(half.low, 0.2366);
  near(half.high, 0.7634);
  // Serif's week: 3 replies on 1,702 sends is somewhere between 0.06% and 0.52%.
  const serif = wilson(3, 1702);
  near(serif.low, 0.0006);
  near(serif.high, 0.0052);
  assert.equal(wilson(0, 0), null);
  assert.throws(() => wilson(5, 3), RangeError);
});

test("a campaign is only ahead or behind when the intervals separate", () => {
  const small = [{ interval: wilson(2, 40) }, { interval: wilson(0, 38) }];
  assert.deepEqual(verdicts(small), ["early", "early"]);
  const big = [{ interval: wilson(60, 500) }, { interval: wilson(5, 500) }, { interval: null }];
  assert.deepEqual(verdicts(big), ["ahead", "behind", "none"]);
});

test("bounces over 5% of sends are flagged and tinted", () => {
  assert.equal(BOUNCE_FLAG, 0.05);
  assert.equal(rates({ sent: 100, bounces: 5, human_replies: 0 }).bounce_flag, false);
  assert.equal(rates({ sent: 100, bounces: 6, human_replies: 0 }).bounce_flag, true);
  const k = C.campaignKpis([{ company: "Ivy", sent: 100, bounces: 9, human_replies: 1, leads: 50 }], {}, "all");
  assert.equal(k.items[3].tone, "bad");
});

test("bars never rank or call a winner on noise", () => {
  const rows = [
    { company: "Ivy", sequence: "Wave 2", sent: 41, human_replies: 2, bounces: 0 },
    { company: "Qube Finance", sequence: "Wave 2", sent: 60, human_replies: 1, bounces: 1 },
  ];
  const b = C.replyRateBars(rows, {}, "7d", "company");
  assert.deepEqual(b.items.map((i) => i.verdict), ["early", "early"]);
  assert.deepEqual(b.items.map((i) => i.label), ["Qube Finance", "Ivy"], "volume order, not rate order");
  assert.match(b.caption, /too early/);
  assert.deepEqual(validateBlock(b), []);

  // One clear laggard must not turn the rest into a rate ranking: 2 of 9 is
  // not ahead of 12 of 200, so volume order holds until a band separates.
  const mixed = C.replyRateBars(
    [
      { company: "Vertocol", sequence: "Midweek", sent: 9, human_replies: 2, bounces: 0 },
      { company: "Ivy", sequence: "Wave 2", sent: 200, human_replies: 12, bounces: 0 },
      { company: "Qube Finance", sequence: "Jonah list", sent: 300, human_replies: 0, bounces: 0 },
    ],
    {},
    "all",
    "campaign",
  );
  assert.deepEqual(mixed.items.map((i) => [i.label, i.verdict]), [
    ["Ivy, Wave 2", "early"],
    ["Vertocol, Midweek", "early"],
    ["Qube Finance, Jonah list", "behind"],
  ]);
});

// ---------------------------------------------------------------- blocks

test("the block validator accepts every composed block and names every error", () => {
  const rows = [{ company: "Ivy", sequence: "Fit relaunch", campaign: "Zeutara | Ivy | Pre-seed | Fit relaunch", sent: 41, human_replies: 2, bounces: 0, leads: 21, status: "active" }];
  const m = C.meta("clay", "2026-10-10T18:10:42Z");
  for (const b of [C.campaignKpis(rows, m, "all"), C.replyRateBars(rows, m, "all", "campaign"), C.campaignTable(rows, m, "all"), C.text("t", C.headline(rows, "all")), C.notice("n", "x")]) {
    assert.deepEqual(validateBlock(b), [], b.type);
  }
  assert.match(validateBlock({ type: "html", id: "x", html: "<script>" })[0], /not a block type/);
  assert.match(validateBlock({ type: "text", id: "x", text: "hi", onclick: "x" })[0], /onclick is not a field/);
  assert.match(validateBlock({ type: "kpi_row", id: "x", items: [{ label: "a", value: "12" }] })[0], /number or null/);
  assert.match(validateBlock({ type: "reply_cards", id: "x", items: Array.from({ length: 13 }, () => ({ investor: "a", wrote: "b" })) })[0], /cap is 12/);
  assert.match(validateBlock({ type: "text", id: "Bad Id", text: "x" })[0], /short lowercase id/);
});

test("every block type maps onto a component in the HUD's genui catalog", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../../config/genui/catalog.json", import.meta.url), "utf8"));
  for (const t of TYPES) assert.ok(catalog.components[KYBER[t]], `${t} -> ${KYBER[t]} missing from catalog.json`);
  assert.deepEqual([...KNOWN].sort(), [...TYPES].sort(), "renderer and validator know the same types");
});

// ---------------------------------------------------------------- renderer

const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat().filter((k) => k !== null && k !== undefined) });
const texts = (n) => (typeof n === "string" ? [n] : n && n.kids ? n.kids.flatMap(texts) : []);

test("the renderer refuses unknown block types and draws strings only as text", () => {
  assert.equal(renderBlock(h, { type: "script", id: "x", text: "alert(1)" }), null);
  assert.equal(renderBlock(h, { type: "__proto__", id: "x" }), null);
  assert.equal(renderBlock(h, null), null);
  const evil = "<img src=x onerror=alert(1)>";
  const el = renderBlock(h, { type: "reply_cards", id: "r", items: [{ investor: evil, wrote: evil, did: "Logged" }] });
  assert.ok(texts(el).includes(evil), "the payload is a text node, never parsed");
  const walk = (n) => (n && n.tag ? [n, ...n.kids.flatMap(walk)] : []);
  for (const node of walk(el)) for (const k of Object.keys(node.props)) assert.ok(!/^on/i.test(k), `no event handler props (${k})`);
});

test("a stale block says how old it is", () => {
  const el = renderBlock(h, { type: "text", id: "t", text: "x", source: "clay", as_of: "2026-10-10T10:00:00Z", stale: { age: "40 minutes", note: "Clay did not answer in time, so these numbers are from 40 minutes ago.", refreshing: false } });
  assert.ok(texts(el).some((s) => /40 minutes ago/.test(s)));
});

// ---------------------------------------------------------------- freshness

function fakeClock(start = Date.parse("2026-10-10T18:00:00Z")) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test("a stale snapshot asks the sync agent for a refresh and renders the fresh numbers", async () => {
  const clock = fakeClock();
  const hub = new StatsHub({ now: clock.now });
  hub.put("zeutara", "7d", { as_of: new Date(clock.now()).toISOString(), rows: [{ campaign: "Zeutara | Ivy", sent: 10 }] });
  clock.advance(30 * 60 * 1000); // 30 minutes later: older than the 10 minute bound
  hub.agentSeenAt = clock.now(); // the agent is polling
  const poll = hub.wanted(5000);
  const reading = hub.read("zeutara", "7d", { maxAgeMs: 10 * 60 * 1000, waitMs: 5000 });
  assert.deepEqual(await poll, ["zeutara"], "the agent is told which client needs a read");
  clock.advance(4000);
  hub.put("zeutara", "7d", { as_of: new Date(clock.now()).toISOString(), rows: [{ campaign: "Zeutara | Ivy", sent: 25 }] });
  const res = await reading;
  assert.equal(res.fresh, true);
  assert.equal(res.snap.rows[0].sent, 25);
  assert.equal(res.age_ms, 0);
});

test("a failed refresh renders the cached numbers with their real age, never a new number", async () => {
  const clock = fakeClock();
  const hub = new StatsHub({ now: clock.now });
  hub.put("zeutara", "all", { as_of: new Date(clock.now()).toISOString(), rows: [{ campaign: "Zeutara | Ivy", sent: 41 }] });
  clock.advance(42 * 60 * 1000);
  hub.agentSeenAt = clock.now();
  const reading = hub.read("zeutara", "all", { waitMs: 5000 });
  hub.fail("zeutara", "the Clay sign-in on this machine is a different workspace");
  const res = await reading;
  assert.equal(res.fresh, false);
  assert.equal(res.reason, "failed");
  assert.equal(res.snap.rows[0].sent, 41);
  assert.match(staleNote(res), /Clay refused the refresh, so these numbers are from 42 minutes ago\./);
});

test("with the agent offline a question does not wait, and with no numbers it says so", async () => {
  const clock = fakeClock();
  const hub = new StatsHub({ now: clock.now });
  const started = Date.now();
  const res = await hub.read("zeutara", "7d", { waitMs: 60000 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(res.snap, null);
  assert.equal(res.reason, "offline");
  assert.match(staleNote(res), /no earlier numbers are on file/);
});

test("a timed-out refresh keeps the cached value and labels it", async () => {
  const clock = fakeClock();
  const hub = new StatsHub({ now: clock.now });
  hub.put("zeutara", "7d", { as_of: new Date(clock.now()).toISOString(), rows: [] });
  clock.advance(15 * 60 * 1000);
  hub.agentSeenAt = clock.now();
  const res = await hub.read("zeutara", "7d", { waitMs: 20 });
  assert.equal(res.reason, "timeout");
  assert.match(staleNote(res), /did not answer in time, so these numbers are from 15 minutes ago/);
});

// ---------------------------------------------------------------- rules

test("model prose keeps only real numbers, read interest and full words", () => {
  const grounding = JSON.stringify({ sent: 1702, replies: 3, company: "Ivy" });
  const { text, dropped } = cleanProse(
    "We sent 1,702 emails and 3 investors wrote back. Ivy got 14 replies. Ken at Fund is interested. I ran a query to check. Let u know if ur team wants more w the deck — soon.",
    { grounding, replyText: "Thanks, not for us." },
  );
  assert.equal(text, "We sent 1,702 emails and 3 investors wrote back. Let you know if your team wants more with the deck, soon.");
  assert.deepEqual(dropped.map((d) => d.why), ["numbers 14", "interest", "process"]);
  assert.equal(cleanProse("Ken is interested in a call.", { replyText: "I'd be interested in a call" }).text, "Ken is interested in a call.");
  assert.equal(cleanProse("No Ivy reply says they are interested yet.", { replyText: "Not for us" }).text, "No Ivy reply says they are interested yet.");
  assert.equal(cleanProse("Nobody has written that they're interested.").text, "Nobody has written that they're interested.");
});

test("a Clay category is never shown as what Togari did", () => {
  assert.equal(togariDid("Interested"), "Sent to you as a card in Slack");
  assert.equal(togariDid("follow up scheduled"), "Follow up scheduled");
});

// ---------------------------------------------------------------- routing

test("the suggestion chips answer from fixed plans with no model", () => {
  const cos = ["Goldies Good Vibes", "Ivy", "Qube Finance", "Vertocol"];
  assert.equal(tier0("How did this week go?", cos)[0].view, "stats_headline");
  assert.equal(tier0("Which campaign is working?", cos)[1].view, "stats_rates_campaign");
  assert.equal(tier0("What needs me?", cos)[0].view, "replies_for_me");
  assert.deepEqual(tier0("Who replied about Ivy?", cos)[0], { view: "replies", args: { company: "Ivy", days: 30 } });
  assert.equal(tier0("Who replied about Qube?", cos)[0].args.company, "Qube Finance");
  assert.equal(tier0("what should Ryan wear to the pitch", cos), null);
});

test("a model plan can only name known views, and never a client", () => {
  const plan = planFromShow({ say: "Hi.", views: [{ view: "html" }, { view: "replies", company: "ivy", clientId: "serif", days: 9999 }] }, ["Ivy"]);
  assert.deepEqual(plan, [
    { view: "say", args: { text: "Hi." } },
    { view: "replies", args: { window: "7d", company: "Ivy", search: undefined, days: 90, who: undefined } },
  ]);
});

// ---------------------------------------------------------------- scoping

function fakeTogari() {
  const calls = [];
  return {
    calls,
    async clients() {
      return [
        { clientId: "zeutara", displayName: "Zeutara", brief: "", clayWorkspaceId: "1372623", campaignPrefix: "Zeutara |" },
        { clientId: "serif", displayName: "Serif", brief: "", clayWorkspaceId: "999", campaignPrefix: "Serif |" },
      ];
    },
    async client(id) {
      return (await this.clients()).find((c) => c.clientId === id) || null;
    },
    async read(clientId, name, input) {
      calls.push({ clientId, name, input });
      return { data: [{ investor: "Ann Lee", firm: "Fund", company: "Ivy", wrote: "Send the deck", togari_did: "card for Jonah", received: "2026-10-09" }], as_of: "2026-10-10T18:00:00Z" };
    },
  };
}

async function serve(app) {
  const srv = createServer((req, res) => app.handle(req, res));
  await new Promise((r) => srv.listen(0, r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test("a zeutara session reads only zeutara, whatever the URL says", async () => {
  const togari = fakeTogari();
  const app = createApp({ togari, syncKey: "sync-key-for-tests-only-0123456789", modelKey: "unused" });
  const { srv, base } = await serve(app);
  try {
    const cookie = `live=${sign({ c: "zeutara", w: "Jonah" })}`;
    assert.equal((await fetch(`${base}/c/serif`, { headers: { cookie } })).status, 401);
    assert.equal((await fetch(`${base}/c/zeutara`, { headers: { cookie } })).status, 200);
    const r = await fetch(`${base}/api/ask?q=${encodeURIComponent("Who replied about Ivy?")}&client=serif`, { headers: { cookie } });
    const body = await r.text();
    assert.match(body, /event: block/);
    assert.match(body, /Ann Lee/);
    assert.ok(togari.calls.length > 0);
    for (const c of togari.calls) assert.equal(c.clientId, "zeutara");
    assert.equal((await fetch(`${base}/api/ask?q=hi`)).status, 401, "no session, no answers");
    // Flip a character inside the MAC, not the last one: base64url's final
    // character carries padding bits, so two last characters can decode to
    // the same bytes and the "forgery" is the same signature.
    const real = sign({ c: "zeutara" });
    const i = real.length - 10;
    const forged = `live=${real.slice(0, i)}${real[i] === "A" ? "B" : "A"}${real.slice(i + 1)}`;
    assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: forged } })).status, 401);
  } finally {
    srv.close();
  }
});

test("the sync agent cannot post one client's numbers into another's page", async () => {
  const togari = fakeTogari();
  const zeutara = (await togari.clients())[0];
  const good = { window: "7d", workspace: "1372623", rows: [{ campaign: "Zeutara | Ivy | Pre-seed | Wave 2", sent: 1, replies: 0, human_replies: 0, bounces: 0, leads: null }] };
  assert.equal(checkRows(good, zeutara), null);
  assert.match(checkRows({ ...good, workspace: "999" }, zeutara), /workspace/);
  assert.match(checkRows({ ...good, rows: [{ ...good.rows[0], campaign: "Serif | Hiring | Wave 1" }] }, zeutara), /another client/);
  assert.match(checkRows({ ...good, rows: [{ ...good.rows[0], sent: -1 }] }, zeutara), /whole number/);

  const app = createApp({ togari, syncKey: "sync-key-for-tests-only-0123456789" });
  const { srv, base } = await serve(app);
  try {
    const post = (body, key = "sync-key-for-tests-only-0123456789") =>
      fetch(`${base}/sync/stats`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ clientId: "zeutara", as_of: "2026-10-10T18:00:00Z", ...good }, "wrong")).status, 401);
    assert.equal((await post({ clientId: "serif", as_of: "2026-10-10T18:00:00Z", ...good })).status, 422);
    assert.equal((await post({ clientId: "zeutara", as_of: "2026-10-10T18:00:00Z", ...good })).status, 200);
    assert.equal(app.hub.get("zeutara", "7d").rows[0].company, "Ivy");
    assert.equal(app.hub.get("serif", "7d"), null);
  } finally {
    srv.close();
  }
});

test("the Togari adapter refuses act tools and answers for another client", async () => {
  const seen = [];
  const src = togariSource({
    baseUrl: "https://togari.test",
    apiKey: "k",
    fetchImpl: async (url) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ clientId: "serif", data: [] }) };
    },
  });
  await assert.rejects(src.read("zeutara", "reply_to_investor"), /not a Togari read/);
  await assert.rejects(src.read("zeutara", "list_replies"), /different client/);
  assert.deepEqual(seen, ["https://togari.test/api/v1/portal/live/zeutara/list_replies"]);
});

test("only a hashed link token signs anyone in", async () => {
  const { createHash } = await import("node:crypto");
  const token = "tok_abcdefghijklmnopqrstuvwxyz012345";
  const access = JSON.stringify({ [createHash("sha256").update(token).digest("hex")]: { client: "zeutara", who: "Jonah" } });
  assert.deepEqual(accessFor(token, access), { client: "zeutara", who: "Jonah" });
  assert.equal(accessFor("tok_wrongwrongwrongwrongwrong0000", access), null);
  assert.equal(accessFor("short", access), null);
});

test("a stats plan streams the cached block first, then the refreshed one in the same slot", async () => {
  const clock = fakeClock();
  const hub = new StatsHub({ now: clock.now });
  hub.put("zeutara", "7d", { as_of: new Date(clock.now()).toISOString(), rows: [{ campaign: "Zeutara | Ivy | x", company: "Ivy", sequence: "x", sent: 10, human_replies: 1, bounces: 0, leads: null }] });
  clock.advance(20 * 60 * 1000);
  hub.agentSeenAt = clock.now();
  const events = [];
  const done = runPlan([{ view: "stats_kpis", args: { window: "7d" } }], {
    emit: (e, d) => events.push([e, d]),
    hub,
    clientId: "zeutara",
    maxAgeMs: 10 * 60 * 1000,
    waitMs: 5000,
  });
  await new Promise((r) => setImmediate(r));
  hub.put("zeutara", "7d", { as_of: new Date(clock.now()).toISOString(), rows: [{ campaign: "Zeutara | Ivy | x", company: "Ivy", sequence: "x", sent: 30, human_replies: 2, bounces: 0, leads: null }] });
  await done;
  const blocks = events.filter(([e]) => e === "block").map(([, d]) => d);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].at, blocks[1].at);
  assert.equal(blocks[0].block.stale.refreshing, true);
  assert.equal(blocks[0].block.items[0].value, 10);
  assert.equal(blocks[1].block.stale, undefined);
  assert.equal(blocks[1].block.items[0].value, 30);
});
