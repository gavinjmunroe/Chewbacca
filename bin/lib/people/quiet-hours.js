// @ts-check
// Hours a person asked not to get a direct text. `people send` refuses a 1:1
// message inside them; a group chat is exempt, since the ask was about direct
// texts.
//
// Sagar, 2026-10-11 00:58, when Caleb asked if it was ever too late to text
// him or Karthik: "Do not text directly after 11pm in our respective time
// zones, and 7pm on Friday and Saturday ... Group chat texts are fine". The
// rule sat in team memory as prose for one reply before Caleb's standing ask
// that every rule run as code.
//
// The list lives at $PEOPLE_DIR/quiet-hours.json, never in the repo, because
// it names real people:
//   [{"name": "Sagar Tiwari", "tz": "America/Los_Angeles",
//     "after": "23:00", "after_by_day": {"Fri": "19:00", "Sat": "19:00"},
//     "until": "07:00", "source": "Sagar by text 2026-10-11"}]

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DIR } = require("./db");

const FILE = () => path.join(process.env.PEOPLE_DIR || DIR, "quiet-hours.json");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function load(file = FILE()) {
  try {
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Day name and minutes past midnight at `when` in time zone `tz`. */
function localClock(when, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(when)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: parts.weekday,
    mins: Number(parts.hour) * 60 + Number(parts.minute),
    label: `${parts.weekday} ${parts.hour}:${parts.minute}`,
  };
}

/**
 * The rule that makes `name` quiet at `when`, or null. Quiet runs from that
 * day's cutoff to `until` the next morning, so 1am Saturday counts against
 * Friday's 7pm cutoff.
 */
function quietFor(name, when = new Date(), rules = load()) {
  const want = String(name || "")
    .trim()
    .toLowerCase();
  const rule = rules.find(
    (r) =>
      String(r.name || "")
        .trim()
        .toLowerCase() === want,
  );
  if (!rule || !rule.tz) return null;
  const now = localClock(when, rule.tz);
  // Guessed, never stated by Sagar: he gave the evening cutoff only. 7am is
  // when a direct text stops being a late-night one.
  const until = minutes(rule.until) ?? 7 * 60;
  const cutoff = (day) => minutes((rule.after_by_day || {})[day] ?? rule.after);
  const today = cutoff(now.day);
  if (today != null && now.mins >= today) return { rule, local: now.label };
  const yesterday = DAYS[(DAYS.indexOf(now.day) + 6) % 7];
  if (now.mins < until && cutoff(yesterday) != null)
    return { rule, local: now.label };
  return null;
}

module.exports = { quietFor, load, localClock, FILE };
