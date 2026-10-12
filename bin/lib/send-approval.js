// Send approval for the kit's Node code. The press logic lives once, in
// tools/send_approval.py (read its header): take() here runs it, and
// mintPressed() writes the same token file for a press handler that already
// checked its own press (kit_confirm's six-digit code). Never call
// mintPressed from anywhere a person didn't just press something.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PY = path.join(__dirname, "..", "..", "tools", "send_approval.py");

function root() {
  return (
    process.env.CHEWBACCA_SEND_APPROVALS ||
    path.join(os.homedir(), ".chewbacca", "send-approvals")
  );
}

const sha = (s) =>
  crypto
    .createHash("sha256")
    .update(Buffer.from(String(s), "utf8"))
    .digest("hex");

// Must match send_approval.binding(): channel, address, text and subject
// joined by NUL.
function binding(channel, to, text, subject = "") {
  return sha([channel, to, text, subject || ""].map(String).join("\0"));
}

function mintPressed(channel, to, text, press, subject = "") {
  const dir = path.join(root(), "tokens");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(root(), 0o700);
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, `${binding(channel, to, text, subject)}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      channel: String(channel),
      to: String(to),
      text_sha: sha(text),
      subject_sha: sha(subject || ""),
      press: String(press),
      at: Date.now() / 1000,
    }),
    { mode: 0o600 },
  );
  fs.renameSync(tmp, file);
  return file;
}

// { ok: true, press } or { ok: false, err }. A missing module or a python
// that won't start refuses: no approval check means no send.
function take(channel, to, text, subject = "") {
  if (!fs.existsSync(PY))
    return {
      ok: false,
      err: `${PY} is missing, so no send can be approved. Nothing was sent.`,
    };
  const r = spawnSync(
    "python3",
    // --flag=value, so an address or subject that starts with a dash stays a value.
    [
      PY,
      "take",
      `--channel=${channel}`,
      `--to=${to}`,
      `--subject=${subject || ""}`,
    ],
    // Long enough for a person at the terminal to read the draft and type
    // send. Guessed, never measured; a send nobody answers just refuses.
    { input: String(text), encoding: "utf8", timeout: 300000 },
  );
  if (r.status === 0) return { ok: true, press: String(r.stdout || "").trim() };
  return {
    ok: false,
    err: String(
      r.stderr || r.error?.message || `send approval exited ${r.status}`,
    ).trim(),
  };
}

const POLICY_PY = path.join(__dirname, "..", "..", "tools", "send_policy.py");

// The send policy's answer for a text (config/send-policy.cedar):
// { decision: "allow" | "deny" | "unavailable", rules: [{ id, reason }] }.
// "unavailable" only when the policy can't be asked at all (no module, or no
// binary built); the caller's inline checks then stand alone. Anything else
// that goes wrong is a deny.
function policy(facts) {
  if (!fs.existsSync(POLICY_PY))
    return { decision: "unavailable", rules: [], errors: [`${POLICY_PY} is missing`] };
  const r = spawnSync("python3", [POLICY_PY, "ask"], {
    input: JSON.stringify({ action: "text", facts }),
    encoding: "utf8",
    // The binary answers in 8 ms; python3 starting is most of this. Guessed,
    // never measured at load: long enough for a busy Mac, short of a hang.
    timeout: 20000,
  });
  try {
    const got = JSON.parse(r.stdout);
    if (["allow", "deny", "unavailable"].includes(got.decision)) return got;
  } catch {
    /* falls through to a deny */
  }
  return {
    decision: "deny",
    rules: [],
    errors: [String(r.stderr || r.error?.message || `send policy exited ${r.status}`).trim()],
  };
}

module.exports = { binding, mintPressed, take, policy, PY, POLICY_PY };
