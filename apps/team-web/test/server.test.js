import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SESSION_SECRET = "test-secret";
const { seal, unseal, cleanChanges } = await import("../server.js");
const { parse, render } = await import("../lib/task.js");

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
