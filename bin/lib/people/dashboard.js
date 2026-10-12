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

// "A dashboard I can always open" means the server has to outlive the terminal
// that started it. It is a keepalive service of chewbacca-daemon, the one
// Login Items row Chewbacca has (Caleb, 2026-10-11: "only 1 thing").
function daemon(args) {
  const bin = path.join(__dirname, "..", "..", "chewbacca-daemon");
  return execFileSync(process.argv[0], [bin, ...args], { encoding: "utf8" });
}

// A path inside a kit snapshot, rewritten through kit/current, so the service
// follows kit moves. Registering the resolved snapshot path pinned it to one
// generation, and the daemon never swaps a pinned service.
function viaCurrentKit(file) {
  const kit = path.join(HOME, ".chewbacca", "kit");
  let snaps;
  try { snaps = fs.realpathSync(path.join(kit, "snapshots")); } catch { return file; }
  const rel = path.relative(snaps, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return file;
  return path.join(kit, "current", ...rel.split(path.sep).slice(1));
}

function installAgent(port) {
  // --swap overlap: on a kit move the new copy binds beside the old one and
  // the old one stops once / answers (reengineer step 10).
  daemon(["register", "people-dashboard", "--keepalive", "--swap", "overlap", "--listen", String(port), "--health-http", "/", "--",
    process.argv[0], viaCurrentKit(fs.realpathSync(process.argv[1])), "dashboard", "--port", String(port), "--no-open"]);
  for (const label of [AGENT_LABEL, "com.calebnewton.people-dashboard"]) {
    try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${label}`], { stdio: "ignore" }); } catch {}
    const old = path.join(HOME, "Library", "LaunchAgents", label + ".plist");
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  daemon(["install"]);
  say("");
  say(`  ${c.grn("installed")} ${c.dim("people-dashboard")}`);
  say(`  running at ${c.cyn(`http://localhost:${port}`)} and after every reboot`);
  say(c.dim(`  stop it with: people dashboard --uninstall`));
  say("");
}

function uninstallAgent() {
  daemon(["unregister", "people-dashboard"]);
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
          execFileSync("open", ["-g", url]);
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
  viaCurrentKit,
  cmdDashboard,
};
