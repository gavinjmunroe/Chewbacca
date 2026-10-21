/**
 * seed-sagar-schedule.js
 *
 * One-shot: write Sagar's per-tenant check-in schedule into medha-id so
 * the scheduler picks it up on the next 60s tick.
 *
 * Defaults:
 *   morning emotional    — 5 min after wake
 *   nightly physical     — 8h05 before wake (anchored at wake_alarm)
 *   Sunday spiritual     — 07:00 local (America/Los_Angeles)
 *
 * Override wake time with --wake=HH:MM (e.g. --wake=06:45). If Sagar
 * sends his real wake time after this runs, re-run with --wake=... to
 * patch in place.
 *
 * Required env:
 *   AMBER_ID_API_URL       — e.g. https://amber-id-production.up.railway.app
 *   AMBER_ID_API_KEY       — admin API key
 *   SAGAR_DID              — Sagar's Privy DID (did:privy:...)
 *
 * Usage:
 *   AMBER_ID_API_URL=... AMBER_ID_API_KEY=... SAGAR_DID=did:privy:xxx \
 *     node Newton/agent/scripts/seed-sagar-schedule.js [--wake=07:00] [--off]
 */

import { defaultSagarSchedule } from "../lib/checkin-schedule.js";

function parseArgs(argv) {
  const out = { wake: "07:00", off: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--off") out.off = true;
    else if (arg.startsWith("--wake=")) out.wake = arg.slice("--wake=".length);
  }
  return out;
}

async function main() {
  const { wake, off } = parseArgs(process.argv);
  const apiUrl = process.env.AMBER_ID_API_URL;
  const apiKey = process.env.AMBER_ID_API_KEY;
  const did = process.env.SAGAR_DID;

  if (!apiUrl || !apiKey || !did) {
    console.error(
      "Missing env. Need AMBER_ID_API_URL, AMBER_ID_API_KEY, SAGAR_DID.",
    );
    process.exit(2);
  }

  const schedule = defaultSagarSchedule(wake);
  if (off) schedule.enabled = false;

  // Per-tenant opt-in for the proactive scheduler. With Tab 1's flip the
  // global default is OFF, so this preference is what turns the windows on.
  const body = {
    preferences: { proactive: { checkins: !off } },
    checkInSchedule: schedule,
  };

  const url = `${apiUrl.replace(/\/+$/, "")}/tenants/${encodeURIComponent(did)}/metadata`;
  console.log(`POST ${url}`);
  console.log(JSON.stringify(body, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed: ${res.status} ${text}`);
    process.exit(1);
  }
  console.log("OK:", text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
