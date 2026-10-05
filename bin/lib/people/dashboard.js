// @ts-nocheck
// people dashboard: the loopback web view in bin/lib/people-dashboard.js,
// and the launchd agent that keeps it running (--install, --uninstall).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { HOME, db } = require("./db");

// ------------------------------------------------------------------ dashboard

function dashboardModule() {
  const here = path.dirname(fs.realpathSync(process.argv[1]));
  for (const cand of [
    path.join(here, "lib", "people-dashboard.js"),
    path.join(here, "..", "bin", "lib", "people-dashboard.js"),
    path.join(os.homedir(), ".chewbacca", "bin", "lib", "people-dashboard.js"),
  ])
    if (fs.existsSync(cand)) return require(cand);
  die("Cannot find bin/lib/people-dashboard.js. Re-run setup.sh.");
}

const AGENT_LABEL = "com.chewbacca.people-dashboard";

function agentPlistPath() {
  return path.join(HOME, "Library", "LaunchAgents", AGENT_LABEL + ".plist");
}

// "A dashboard I can always open" means the server has to outlive the terminal
// that started it. A LaunchAgent with KeepAlive is the version of that which
// survives a reboot; a backgrounded shell job is not.
function installAgent(port) {
  const plist = agentPlistPath();
  const logDir = path.join(HOME, "Library", "Logs");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.argv[0]}</string>
    <string>${fs.realpathSync(process.argv[1])}</string>
    <string>dashboard</string>
    <string>--port</string>
    <string>${port}</string>
    <string>--no-open</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(logDir, AGENT_LABEL + ".log")}</string>
  <key>StandardErrorPath</key><string>${path.join(logDir, AGENT_LABEL + ".err")}</string>
</dict>
</plist>
`;
  fs.writeFileSync(plist, xml);
  const uid = process.getuid();
  // bootout first so a re-install picks up a changed port rather than silently
  // keeping the old one running.
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}/${AGENT_LABEL}`], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plist]);
  say("");
  say(`  ${c.grn("installed")} ${c.dim(AGENT_LABEL)}`);
  say(`  running at ${c.cyn(`http://localhost:${port}`)} and after every reboot`);
  say(c.dim(`  stop it with: people dashboard --uninstall`));
  say("");
}

function uninstallAgent() {
  const plist = agentPlistPath();
  const uid = process.getuid();
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}/${AGENT_LABEL}`], { stdio: "ignore" });
  } catch {}
  if (fs.existsSync(plist)) fs.unlinkSync(plist);
  say(c.dim("  dashboard agent removed. The data is untouched."));
}

function cmdDashboard(argv) {
  const { flags } = parseArgs(argv);
  const port = Number(flags.port || process.env.PEOPLE_PORT || 7373);
  if (flags.uninstall) return uninstallAgent();
  if (flags.install) return installAgent(port);
  const mod = dashboardModule();
  const server = mod.serve({
    db,
    port,
    host: "127.0.0.1",
    onReady: () => {
      const url = `http://localhost:${port}`;
      say("");
      say(`  ${c.b("who you have been texting")}  ${c.cyn(url)}`);
      say(c.dim("  loopback only. ctrl-c to stop."));
      say("");
      if (!flags["no-open"]) {
        try {
          execFileSync("open", [url]);
        } catch {}
      }
    },
  });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE")
      die(
        `Port ${port} is already taken, which usually means the dashboard is\n` +
          `  already running. Open http://localhost:${port}, or pass --port.`,
      );
    die(e.message);
  });
}

module.exports = {
  cmdDashboard,
};
