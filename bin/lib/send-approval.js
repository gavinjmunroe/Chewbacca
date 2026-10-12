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

// Must match send_approval.binding(): channel, address and text joined by NUL.
function binding(channel, to, text) {
  return sha([channel, to, text].map(String).join("\0"));
}

function mintPressed(channel, to, text, press) {
  const dir = path.join(root(), "tokens");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(root(), 0o700);
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, `${binding(channel, to, text)}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      channel: String(channel),
      to: String(to),
      text_sha: sha(text),
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
function take(channel, to, text) {
  if (!fs.existsSync(PY))
    return {
      ok: false,
      err: `${PY} is missing, so no send can be approved. Nothing was sent.`,
    };
  const r = spawnSync(
    "python3",
    [PY, "take", "--channel", String(channel), "--to", String(to)],
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

module.exports = { binding, mintPressed, take, PY };
