#!/usr/bin/env node
// The api-anything MCP server, with the two things agents kept tripping on
// fixed in between: a lapsed session and a login window.
//
//   node api_mcp_proxy.mjs <renew-command...> -- <engine-command...>
//
// Sessions imported from Chrome's cookie file (Brightspace, Handshake, WebReg)
// last 12 hours, and the engine can't re-read them itself, so an MCP call
// answered 403 and told the agent to open a sign-in window. On 2026-10-11 that
// sent an agent hunting through four tools for a quiz while the CLI path,
// which re-imports, worked fine. Here a call that comes back signed out is
// renewed once, silently, and sent again. A login in "window" mode is refused:
// that window landed on top of whatever the student was doing ("STOP FLASH
// BANGING ME"). Signing in for real happens in their own Chrome.
//
// MCP over stdio is one JSON-RPC message per line, so this reads lines.
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
if (split < 1 || split === argv.length - 1) {
  console.error("usage: api_mcp_proxy.mjs <renew-cmd...> -- <engine-cmd...>");
  process.exit(2);
}
const renewCmd = argv.slice(0, split);
const engineCmd = argv.slice(split + 1);
const renewable = new Set(
  (process.env.CHEWBACCA_RENEWABLE_SITES || "").split(/\s+/).filter(Boolean),
);

const child = spawn(engineCmd[0], engineCmd.slice(1), {
  stdio: ["pipe", "pipe", "inherit"],
});
child.on("exit", (code) => process.exit(code ?? 0));
const toChild = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
const toAgent = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

// id -> { msg, site, retried }
const pending = new Map();

function lapsed(result) {
  const text = result?.content?.map((c) => c?.text || "").join("") || "";
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return false;
  }
  const why = String(r?.reason || "");
  return (
    r?.ok === false &&
    (r.class === "auth" ||
      /HTTP (30[12]|40[13])\b/.test(why) ||
      (r.class === "blocked" && /challeng|sign.?in|log.?in/i.test(why)))
  );
}

function renew(site) {
  const r = spawnSync(renewCmd[0], [...renewCmd.slice(1), site], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 60_000,
  });
  return r.status === 0;
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    child.stdin.write(line + "\n");
    return;
  }
  const tool = msg?.method === "tools/call" ? msg.params?.name : undefined;
  const args = msg?.params?.arguments || {};
  if (tool === "login" && msg.id !== undefined) {
    if (renewable.has(args.site)) {
      const ok = renew(args.site);
      toAgent({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                ok
                  ? {
                      ok: true,
                      site: args.site,
                      note: "session renewed from the student's Chrome, no window",
                    }
                  : {
                      ok: false,
                      site: args.site,
                      error: `BLOCKED: ${args.site} is signed out in Chrome. Tell the user to sign in there once. No window was opened.`,
                    },
              ),
            },
          ],
        },
      });
      return;
    }
    if (args.mode === "window") {
      toAgent({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error:
                  "Chewbacca never opens a sign-in window from an agent. Say BLOCKED: <site> needs a sign-in in Chrome, and the user does it in their own browser.",
              }),
            },
          ],
        },
      });
      return;
    }
  }
  if (
    tool === "call_operation" &&
    msg.id !== undefined &&
    renewable.has(args.site)
  ) {
    pending.set(msg.id, { msg, site: args.site, retried: false });
  }
  toChild(msg);
});

readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(line + "\n");
    return;
  }
  const p = msg?.id !== undefined ? pending.get(msg.id) : undefined;
  if (p) {
    if (!p.retried && lapsed(msg.result) && renew(p.site)) {
      p.retried = true;
      toChild(p.msg);
      return;
    }
    pending.delete(msg.id);
  }
  toAgent(msg);
  maybeEnd();
});
// Hold the engine's input open while a renewed call is still owed a resend.
let ended = false;
const maybeEnd = () => { if (ended && pending.size === 0) child.stdin.end(); };
process.stdin.on("end", () => { ended = true; maybeEnd(); });
