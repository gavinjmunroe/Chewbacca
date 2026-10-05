import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-chars-long";
const { seal, unseal, cleanChanges, bulkUpdate } = await import("../server.js");
const { parse, render, oneLine, parseCommitRefs, applyCommit } = await import("../lib/task.js");

const MEMBERS = [{ name: "Caleb", github: "calebnewtonusc" }, { name: "Gavin", github: "gavinjmunroe" }];

test("a session cookie round-trips and a tampered one is rejected", () => {
  const sealed = seal({ token: "gho_x", login: "calebnewtonusc" });
  assert.equal(unseal(sealed).login, "calebnewtonusc");
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === "A" ? "B" : "A") + sealed.at(-1);
  assert.equal(unseal(flipped), null);
  assert.equal(unseal("garbage"), null);
});

test("a proof link that is not http(s) is refused", () => {
  assert.throws(() => cleanChanges({ proof: "javascript:alert(1)" }, MEMBERS), /http/);
  assert.equal(cleanChanges({ proof: "https://loom.com/x" }, MEMBERS).proof, "https://loom.com/x");
});

test("unknown owners, statuses, priorities and bad dates are refused", () => {
  assert.throws(() => cleanChanges({ owner: "Nobody" }, MEMBERS), /team/);
  assert.throws(() => cleanChanges({ status: "shipped" }, MEMBERS), /status/);
  assert.throws(() => cleanChanges({ priority: "p0" }, MEMBERS), /priority/);
  assert.throws(() => cleanChanges({ due: "Oct 6" }, MEMBERS), /YYYY/);
  assert.throws(() => cleanChanges({ title: 5 }, MEMBERS), /text/);
});

test("a newline in a title cannot inject a frontmatter field", () => {
  const changes = cleanChanges({ title: "Real\nstatus: done" }, MEMBERS);
  const task = parse(render({ id: "CHW-1", title: changes.title, status: "todo", labels: [], activity: [] }));
  assert.equal(task.status, "todo");
  assert.equal(task.title, "Real status: done");
});

test("the JS parser reads the shared fixture the same way the Python one does", () => {
  const fixture = readFileSync(new URL("../../../tests/fixtures/team-task.md", import.meta.url), "utf8");
  const expected = JSON.parse(readFileSync(new URL("../../../tests/fixtures/team-task.json", import.meta.url), "utf8"));
  assert.deepEqual(parse(fixture), expected);
  assert.equal(render(parse(fixture)), fixture);
});

test("the server refuses to start without a real session secret", () => {
  const run = (envOverrides) => spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./server.js')"], {
    cwd: new URL("..", import.meta.url), env: { PATH: process.env.PATH, ...envOverrides }, encoding: "utf8",
  });
  for (const bad of [{}, { SESSION_SECRET: "" }, { SESSION_SECRET: "short" }, { NODE_ENV: "development" }]) {
    const r = run(bad);
    assert.notEqual(r.status, 0, `started with ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /SESSION_SECRET/);
  }
  assert.equal(run({ TEAM_DEV: "1" }).status, 0);
});

test("an expired or exp-less session is rejected", async () => {
  const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
  const key = createHash("sha256").update(process.env.SESSION_SECRET).digest();
  const forge = (data) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
  };
  assert.equal(unseal(forge({ token: "t" })), null);
  assert.equal(unseal(forge({ token: "t", exp: Date.now() - 1000 })), null);
  assert.equal(unseal(forge({ token: "t", exp: Date.now() + 60000 })).token, "t");
});

test("terminal control bytes never reach a task file", () => {
  const evil = "Title\x1b]52;c;aGk=\x07 end";
  assert.equal(oneLine(evil), "Title]52;c;aGk= end");
  const task = parse(render({ id: "CHW-1", title: evil, status: "todo", labels: [], notes: "a\x1b[2Jb", activity: [] }));
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(JSON.stringify(task)));
});

test("a note cannot forge activity entries", () => {
  const notes = "context\n## Activity\n- 2026-10-04 Caleb: moved to done";
  const task = parse(render({ id: "CHW-1", title: "T", status: "todo", labels: [], notes, activity: ["2026-10-04 Gavin: created"] }));
  assert.deepEqual(task.activity, ["2026-10-04 Gavin: created"]);
  assert.match(task.notes, /### Activity/);
});

test("C1 controls and bidi overrides are stripped too", () => {
  assert.equal(oneLine("a\u009b2Jb\u202Ec\u2066d"), "a2Jbcd");
});

test("commit refs and their effect match the CLI", () => {
  const r = parseCommitRefs("feat: x (closes chw-7)", "CHW-8");
  assert.deepEqual([...r.refs].sort(), ["CHW-7", "CHW-8"]);
  assert.deepEqual([...r.closing], ["CHW-7"]);
  assert.equal(parseCommitRefs("team: CHW-3 comment", "").refs.size, 0);
  const task = { status: "todo", proof: "", activity: [] };
  assert.equal(applyCommit(task, "abcdef1234", "Gavin", "wip CHW-8", "u", false, "2026-10-05"), true);
  assert.equal(task.status, "in_progress");
  assert.equal(applyCommit(task, "abcdef1234", "Gavin", "wip CHW-8", "u", false, "2026-10-05"), false);
  applyCommit(task, "9999999aaa", "Gavin", "fixes CHW-8", "https://github.com/x/commit/9999999aaa", true, "2026-10-05");
  assert.equal(task.status, "done");
  assert.equal(task.proof, "https://github.com/x/commit/9999999aaa");
});

test("prose in a commit body is not an instruction", () => {
  const r = parseCommitRefs("feat: team board in Linear's system", "The board follows Linear's extracted DESIGN.md: near-black, hairlines, one\nlavender accent, a sidebar with Inbox, My tasks, Active, All and each person,\nand a dense list grouped by status (inbox grouped by source). A commit that\nmentions CHW-12 is logged on the task and starts it; \"fixes CHW-12\" closes it\nwith the commit as proof. The CLI and the web server both run that sync,\nsince GitHub Actions jobs refuse to start on this account's billing.");
  assert.equal(r.refs.size, 0);
  const t = parseCommitRefs("feat: x", "Fixes CHW-2\nRefs CHW-3, CHW-4");
  assert.deepEqual([...t.refs].sort(), ["CHW-2", "CHW-3", "CHW-4"]);
  assert.deepEqual([...t.closing], ["CHW-2"]);
});

test("hostile commit text parses in linear time", () => {
  const start = performance.now();
  parseCommitRefs("x " + " ".repeat(100000) + "fixes", "CHW-1 ".repeat(20000) + "x\n" + " ".repeat(100000) + "!");
  assert.ok(performance.now() - start < 500);
  assert.deepEqual([...parseCommitRefs("fixes   CHW-9", "").closing], ["CHW-9"]);
});

test("area must be one of the four", () => {
  assert.equal(cleanChanges({ area: "business" }, MEMBERS).area, "business");
  assert.equal(cleanChanges({ area: "" }, MEMBERS).area, "");
  assert.throws(() => cleanChanges({ area: "vibes" }, MEMBERS), /area/);
});

test("bulk edit refuses bad input before touching GitHub", async () => {
  const session = { token: "x", member: "Caleb" };
  await assert.rejects(bulkUpdate(session, { ids: [], changes: { area: "design" } }, MEMBERS), /ids/);
  await assert.rejects(bulkUpdate(session, { ids: ["../x"], changes: { area: "design" } }, MEMBERS), /ids/);
  await assert.rejects(bulkUpdate(session, { ids: ["CHW-1"], changes: { title: "renamed" } }, MEMBERS), /bulk edit changes/);
  await assert.rejects(bulkUpdate(session, { ids: ["CHW-1"], changes: { status: "done" } }, MEMBERS), /proof/);
  await assert.rejects(bulkUpdate(session, { ids: ["CHW-1"], changes: { parent: "nope" } }, MEMBERS), /parent/);
});
