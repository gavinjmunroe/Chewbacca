#!/usr/bin/env node
/**
 * trace-checkins.js
 *
 * Reads vision/outbox/<YYYY-MM-DD>/*.json and prints a table of every
 * check-in we have ATTEMPTED through send-checkin.js, with the Loop
 * message_id, the post-send status poll result, and the first 70
 * chars of the text.
 *
 * Existence in outbox = we actually invoked the script.
 * Absence = the cron claimed success without calling it.
 *
 * Usage:
 *   node Newton/agent/scripts/trace-checkins.js --to caleb --days 7
 *   node Newton/agent/scripts/trace-checkins.js --days 30
 *   node Newton/agent/scripts/trace-checkins.js --json
 *
 * Flags:
 *   --to      caleb | sagar   filter recipient (optional)
 *   --days    N               look back N days from today (default 7)
 *   --json                    dump raw records as JSON array
 *   --kind    morning|evening|sunday   filter kind
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const OUTBOX_DIR = path.join(REPO_ROOT, "vision", "outbox");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function daysBack(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const dd = new Date(d);
    dd.setUTCDate(d.getUTCDate() - i);
    out.push(dd.toISOString().slice(0, 10));
  }
  return out;
}

function readDay(stamp) {
  const dir = path.join(OUTBOX_DIR, stamp);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function truncate(s, n) {
  if (!s) return "";
  const one = String(s).replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function pad(s, n) {
  const str = String(s ?? "");
  if (str.length >= n) return str.slice(0, n);
  return str + " ".repeat(n - str.length);
}

function main() {
  const args = parseArgs(process.argv);
  const filterTo = args.to ? String(args.to).toLowerCase() : null;
  const filterKind = args.kind ? String(args.kind).toLowerCase() : null;
  const days = Number(args.days) > 0 ? Number(args.days) : 7;
  const jsonOut = Boolean(args.json);

  const stamps = daysBack(days);
  const records = [];
  for (const s of stamps) {
    for (const r of readDay(s)) {
      if (filterTo && r.to !== filterTo) continue;
      if (filterKind && r.kind !== filterKind) continue;
      records.push(r);
    }
  }

  records.sort((a, b) =>
    String(b.sent_at_iso || "").localeCompare(String(a.sent_at_iso || "")),
  );

  if (jsonOut) {
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
    return;
  }

  if (records.length === 0) {
    console.log(`No check-in audit records in the last ${days} day(s).`);
    console.log(
      `Searched: ${OUTBOX_DIR}/{${stamps[stamps.length - 1]} .. ${stamps[0]}}/`,
    );
    console.log(
      "If crons claim to have sent check-ins, they are NOT invoking send-checkin.js.",
    );
    return;
  }

  console.log(
    pad("stamp", 11) +
      pad("to", 7) +
      pad("kind", 9) +
      pad("dim", 13) +
      pad("status", 12) +
      pad("message_id", 22) +
      "text",
  );
  console.log("-".repeat(130));
  for (const r of records) {
    const status = r.status_poll?.status || (r.send_result?.ok ? "queued" : "failed");
    const msgId = truncate(r.message_id, 20);
    console.log(
      pad(r.stamp, 11) +
        pad(r.to, 7) +
        pad(r.kind, 9) +
        pad(r.dimension, 13) +
        pad(status, 12) +
        pad(msgId, 22) +
        truncate(r.text, 70),
    );
  }
  console.log("-".repeat(130));
  const delivered = records.filter(
    (r) => r.status_poll?.status === "delivered",
  ).length;
  const failed = records.filter((r) => !r.send_result?.ok).length;
  console.log(
    `${records.length} records · ${delivered} delivered · ${failed} failed-send`,
  );
}

main();
