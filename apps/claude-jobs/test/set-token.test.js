import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { setToken } = require(path.join(ROOT, "bin", "chewbacca-claude-jobs"));

// A fixture shaped like `claude setup-token` output, not a credential.
const TOKEN = "sk-ant-oat01-" + "x".repeat(40); // secret-scan: allow, a fixture, not a credential

test("set-token sends the token to railway over stdin, never in argv", () => {
  const calls = [];
  const run = (bin, args, opts) => (calls.push({ bin, args, opts }), { status: 0, stdout: "", stderr: "" });
  assert.deepEqual(setToken("caleb-os", "caleb-os", TOKEN, run), { ok: true });
  assert.deepEqual(calls[0].args, ["link", "-p", "caleb-os", "-s", "caleb-os", "-e", "production"]);
  assert.deepEqual(calls[1].args, ["variables", "-s", "caleb-os", "--set-from-stdin", "CLAUDE_CODE_OAUTH_TOKEN"]);
  assert.equal(calls[1].opts.input, TOKEN);
  assert.ok(!JSON.stringify(calls.map((c) => c.args)).includes(TOKEN));
});

test("set-token refuses something that isn't a setup-token without calling railway", () => {
  const calls = [];
  const run = (...a) => (calls.push(a), { status: 0 });
  assert.match(setToken("p", "s", "sk-ant-api03-nope", run).error, /setup-token/);
  assert.match(setToken("p", "s", "", run).error, /setup-token/);
  assert.equal(calls.length, 0);
});

test("a railway failure is reported by its last stderr line, without the token", () => {
  const run = (bin, args) => ({ status: args[0] === "link" ? 0 : 1, stderr: `${TOKEN}\nService not found` });
  const r = setToken("p", "s", TOKEN, run);
  assert.equal(r.error, "railway refused: Service not found");
});
