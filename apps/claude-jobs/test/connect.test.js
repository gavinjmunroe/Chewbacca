import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { extractToken, connect } = require(path.join(ROOT, "bin", "chewbacca-claude-jobs"));

// Fixtures shaped like `claude setup-token` output, not credentials.
const TOKEN = "sk-ant-oat01-" + "A1_b-".repeat(10); // secret-scan: allow, a fixture, not a credential

test("the token is found through Ink's colour and cursor codes", () => {
  const screen = `\x1b[2K\x1b[1G\x1b[32m ${TOKEN}\x1b[39m\r\n\r\n Store this token securely.\x1b]0;claude\x07`;
  assert.equal(extractToken(screen), TOKEN);
  assert.equal(extractToken("Paste code here if prompted >"), null);
  assert.equal(extractToken("sk-ant-api03-" + "x".repeat(40)), null, "an API key is not a setup-token");
});

function fakeChild(chunks, code = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  setImmediate(() => {
    for (const c of chunks) child.stdout.emit("data", Buffer.from(c));
    child.emit("close", code);
  });
  return child;
}

test("connect hands the token from setup-token to railway, even split across chunks", async () => {
  const sent = [];
  const runs = [];
  const r = await connect("caleb-os", "caleb-os", {
    run: (bin, args) => (runs.push([bin, ...args]), fakeChild(["Welcome\r\n ", TOKEN.slice(0, 20), TOKEN.slice(20), "\r\n"])),
    set: (p, s, t) => (sent.push([p, s, t]), { ok: true }),
    out: { write() {} },
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(sent, [["caleb-os", "caleb-os", TOKEN]]);
  assert.equal(runs[0][0], "script");
  assert.ok(runs[0].join(" ").includes("claude setup-token"));
  assert.ok(!runs[0].join(" ").includes("sk-ant"), "the token is never an argument");
});

test("connect says so when setup-token was cancelled and sets nothing", async () => {
  let called = false;
  const r = await connect("p", "s", {
    run: () => fakeChild(["Paste code here if prompted >"], 130),
    set: () => ((called = true), { ok: true }),
    out: { write() {} },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /no token came back.*exit 130/);
  assert.equal(called, false);
});
