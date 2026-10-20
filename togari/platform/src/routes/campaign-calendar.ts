/**
 * The campaign calendar at /dash/<token>/calendar: a month of the client's
 * campaigns as bars, and under it one week's numbers. Click a week to see that
 * week; click a campaign (its name or its bar) to narrow everything to it.
 * Fonts and colors come from the client's theme (src/campaigns/themes.ts).
 *
 * Maggie, 2026-10-14, for Serif first and every client after: "a monthly
 * calendar ... that shows when campaigns are running, and gives reply rates
 * underneath that can be adjusted by week", with out-of-office, sends and
 * what still needs an answer. Same link scheme as the dashboard
 * (DASHBOARD_TOKENS), so one token opens both. New client:
 * docs/CAMPAIGN_CALENDAR_NEW_CLIENT.md.
 *
 * The grid and bars are drawn here; the week panel is filled in the browser
 * from the same numbers, so switching weeks never reloads. Prospect names come
 * from Clay, so the page runs under a nonce CSP and the script only ever sets
 * textContent.
 */
import crypto from "crypto";
import type { Request, Response } from "express";
import { getReplybotClient } from "../agents/replybot/client-config";
import {
  calendarFor,
  forgetCalendars,
  OUTCOMES,
  parseMonth,
  shiftMonth,
  spanOf,
  staleCalendar,
  todayIn,
  weekStart,
  addDays,
  type CalendarSnapshot,
  type CampaignSpan,
} from "../campaigns/calendar";
import { clientForToken } from "./client-dashboard";
import { themeFor, type CalendarTheme } from "../campaigns/themes";
import { addPlan, readPlan, removePlan } from "../campaigns/plans";

// A campaign past the theme's colors, when layoutWeek is called directly.
const NEUTRAL = "#8a909b";

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

/** A <script> body can't be closed early by anything inside the JSON. */
export function scriptJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface Bar {
  id: string;
  name: string;
  color: string;
  lane: number;
  /** Grid columns 1-7, inclusive. */
  from: number;
  to: number;
  /** The days it actually sent this week, when that's narrower than the bar. */
  sent: { from: number; to: number } | null;
}

/**
 * Bars for one Monday-to-Sunday week, each in the first lane free across its
 * days, so campaigns that don't overlap share a row.
 */
export function layoutWeek(
  week: string[],
  campaigns: CampaignSpan[],
  colors: Map<string, string>,
): { bars: Bar[]; lanes: number } {
  const col = (d: string) =>
    Math.min(7, Math.max(1, week.indexOf(d) + 1 || (d < week[0] ? 1 : 7)));
  const bars: Bar[] = [];
  const laneEnds: number[] = [];
  for (const c of campaigns) {
    const s = spanOf(c);
    if (!s || s.from > week[6] || s.to < week[0]) continue;
    const from = col(s.from);
    const to = col(s.to);
    let sent: Bar["sent"] = null;
    if (
      c.first_send &&
      c.last_send &&
      c.first_send <= week[6] &&
      c.last_send >= week[0]
    ) {
      sent = { from: col(c.first_send), to: col(c.last_send) };
    }
    let lane = laneEnds.findIndex((end) => end < from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = to;
    bars.push({
      id: c.id,
      name: c.name,
      color: colors.get(c.id) || NEUTRAL,
      lane,
      from,
      to,
      sent,
    });
  }
  return { bars, lanes: laneEnds.length };
}

/** Which week the panel opens on: this week, else the month's first busy one. */
export function defaultWeek(s: CalendarSnapshot): string {
  const weeks = s.days.filter((_, i) => i % 7 === 0);
  const now = weekStart(s.today);
  if (weeks.includes(now)) return now;
  const busy = weeks.find((w) => (s.weeks[w]?.["*"]?.sent || 0) > 0);
  return busy || weekStart(`${s.month}-01`);
}

/**
 * HeyReach's and Clay's own statuses, in the words the date rules below use.
 * Clay's are the sequencer's (ACTIVE on its sample event); the rest are
 * guesses at its other states and fall through to the date rules if wrong.
 */
const STATUS_WORDS: Record<string, string> = {
  IN_PROGRESS: "Sending",
  STARTING: "Sending",
  ACTIVE: "Sending",
  RUNNING: "Sending",
  PAUSED: "Paused",
  FINISHED: "Finished",
  COMPLETED: "Finished",
  STOPPED: "Finished",
  CANCELED: "Finished",
  CANCELLED: "Finished",
  ARCHIVED: "Finished",
  FAILED: "Stopped",
  SCHEDULED: "Planned",
  DRAFT: "Planned",
};

function status(c: CampaignSpan, today: string): string {
  if (c.status && STATUS_WORDS[c.status]) return STATUS_WORDS[c.status];
  if (!c.last_send) return "Planned";
  // Sequencers skip weekends; three days of quiet is a Friday-to-Monday gap.
  if (c.last_send >= addDays(today, -3)) return "Sending";
  if (c.planned_end && c.planned_end >= today) return "Paused";
  return "Finished";
}

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

const shortMonth = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
  });

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });

const rangeLabel = (from: string, to: string) => {
  const f = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${f(from, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} to ${f(to, { month: "short", day: "numeric", year: "numeric" })}`;
};

/** The conferences added so far, each with a way to take it off. */
export function planList(s: CalendarSnapshot): string {
  if (!s.plans.length)
    return `<p class="empty">No conferences added yet.</p>`;
  return `<ul class="planlist">${s.plans
    .map(
      (p) =>
        `<li><span class="pname">${esc(p.name)}</span><span class="pdates">${esc(rangeLabel(p.start, p.end))}</span><button type="button" class="linkbtn" data-plan="${esc(p.id)}" data-name="${esc(p.name)}">Remove</button></li>`,
    )
    .join("")}</ul>`;
}

export function renderCalendar(
  s: CalendarSnapshot,
  opts: { nonce: string; dashHref?: string; theme?: CalendarTheme },
): string {
  const t = opts.theme || themeFor(undefined);
  const hasLi = s.linkedin !== null;
  const colors = new Map(
    s.campaigns.map((c, i) => [c.id, t.campaigns[i] || t.faint]),
  );
  const weeks: string[][] = [];
  for (let i = 0; i < s.days.length; i += 7) weeks.push(s.days.slice(i, i + 7));
  const channelOf = new Map(s.campaigns.map((c) => [c.id, c.channel]));

  const grid = weeks
    .map((week) => {
      const { bars, lanes } = layoutWeek(week, s.campaigns, colors);
      const rows = `30px repeat(${Math.max(lanes, 1)}, 24px) 10px`;
      const days = week
        .map((d, i) => {
          const cls = [
            "day",
            d.slice(0, 7) !== s.month ? "out" : "",
            d === s.today ? "today" : "",
            i >= 5 ? "weekend" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const sent =
            (s.daily[d]?.["*"] || 0) + (s.linkedin?.daily[d]?.["*"] || 0);
          return `<div class="${cls}" style="grid-column:${i + 1}"><span class="num">${Number(d.slice(8))}</span><span class="sends" data-day="${d}">${sent ? sent.toLocaleString("en-US") : ""}</span></div>`;
        })
        .join("");
      const barHtml = bars
        .map((b) => {
          const row = b.lane + 2;
          const ch = channelOf.get(b.id) || "email";
          const tag = ch === "linkedin" ? `<b class="in" title="LinkedIn">in</b>` : "";
          const attrs = `data-c="${esc(b.id)}" data-ch="${ch}"`;
          const planned =
            !b.sent || b.sent.from !== b.from || b.sent.to !== b.to
              ? `<div class="bar planned" ${attrs} style="--c:${b.color};grid-column:${b.from}/${b.to + 1};grid-row:${row}">${b.sent ? "" : tag + esc(b.name)}</div>`
              : "";
          const solid = b.sent
            ? `<div class="bar" ${attrs} style="--c:${b.color};grid-column:${b.sent.from}/${b.sent.to + 1};grid-row:${row}" title="${esc(b.name)}">${tag}${esc(b.name)}</div>`
            : "";
          return planned + solid;
        })
        .join("");
      return `<div class="week" data-week="${week[0]}" style="grid-template-rows:${rows}" tabindex="0" role="button" aria-pressed="false" aria-label="Week of ${esc(dayLabel(week[0]))}">${days}${barHtml}</div>`;
    })
    .join("");

  const key = (c: CampaignSpan) =>
    `<button type="button" class="key" data-c="${esc(c.id)}" data-ch="${c.channel}" aria-pressed="false" style="--c:${colors.get(c.id)}"><i></i>${esc(c.name)} <small>${esc(status(c, s.today))}</small></button>`;
  // With LinkedIn, one row per channel, and the channel switch clears a
  // campaign; without it, one row led by All campaigns.
  const group = (ch: CampaignSpan["channel"], label: string) => {
    const list = s.campaigns.filter((c) => c.channel === ch);
    return list.length
      ? `<div class="keyrow" data-ch="${ch}"><span class="group">${label}</span>${list.map(key).join("")}</div>`
      : "";
  };
  const keys = hasLi
    ? group("email", "Email") +
      group("linkedin", "LinkedIn") +
      group("plan", "Conferences")
    : `<div class="keyrow"><button type="button" class="key" data-c="*" aria-pressed="true">All campaigns</button>${s.campaigns.map(key).join("")}</div>`;
  const channels = hasLi
    ? `<div class="channels" role="group" aria-label="Channel"><button type="button" data-ch="all" aria-pressed="true">All</button><button type="button" data-ch="email" aria-pressed="false">Email</button><button type="button" data-ch="linkedin" aria-pressed="false">LinkedIn</button></div>`
    : "";

  const waitingNow = s.waiting.length;
  const waitingLine = waitingNow
    ? `<b>${waitingNow} ${waitingNow === 1 ? "reply is" : "replies are"} waiting on an answer</b>, the oldest from ${esc(new Date(s.waiting[0].at).toLocaleDateString("en-US", { timeZone: s.tz, month: "short", day: "numeric" }))}.`
    : "Every reply that needs an answer has one.";

  const updated = new Date(s.as_of).toLocaleString("en-US", {
    timeZone: s.tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const data = {
    days: s.days,
    campaigns: s.campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      channel: c.channel,
      color: colors.get(c.id),
      planned_start: c.planned_start,
      planned_end: c.planned_end,
    })),
    weeks: s.weeks,
    daily: s.daily,
    li: s.linkedin,
    waiting: s.waiting,
    followups: s.followups,
    outcomes: OUTCOMES,
    selectedWeek: defaultWeek(s),
  };

  const prev = shiftMonth(s.month, -1);
  const next = shiftMonth(s.month, 1);
  const empty = s.campaigns.length
    ? ""
    : `<p class="empty">No campaign ran in ${esc(monthName(s.month))}.</p>`;
  const vars = [
    ["page", t.page],
    ["band", t.band],
    ["surface", t.surface],
    ["weekend", t.weekend],
    ["line", t.line],
    ["ink", t.ink],
    ["text", t.text],
    ["muted", t.muted],
    ["faint", t.faint],
    ["accent", t.accent],
    ["accent-soft", t.accentSoft],
    ["bar-soft", t.barSoft],
    ["today", t.today],
    ["attention", t.attention],
    ["control", t.control],
    ["heading", t.heading],
    ["body", t.body],
  ]
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");

  const liNote = hasLi
    ? " LinkedIn comes from HeyReach: its reply rate is replies divided by people messaged, and people are only messaged once they accept, so it matches HeyReach's own. A LinkedIn conversation is waiting while the lead wrote last. Bars marked in are LinkedIn, and LinkedIn days run on UTC."
    : "";
  const dayNote = hasLi
    ? "The number on each day is emails sent plus LinkedIn requests and messages."
    : "The number on each day is emails sent.";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(s.client)} campaigns</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${esc(t.fonts)}&display=swap" rel="stylesheet">
<style>
:root{${vars};color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--text);font:15px/1.55 var(--body);-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
@media (min-width:720px){.wrap{padding:0 32px}}
h1,h2,h3{font-family:var(--heading);font-weight:400;color:var(--ink);margin:0;letter-spacing:-.01em}
a{color:var(--accent)}
a:focus-visible,button:focus-visible,.week:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.top{padding-top:40px}
.client{margin:0 0 6px;font:500 14px/1.4 var(--heading);color:var(--accent)}
h1{font-size:34px;line-height:1.15}
.status{margin:14px 0 0;font-size:16px}
.status b{color:var(--attention);font-weight:600}
.updated{margin:4px 0 0;font-size:13px;color:var(--muted)}
.monthbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin:36px 0 14px}
.monthbar h2{font-size:24px}
.pager{display:flex;gap:8px}
.pager a{font-size:14px;line-height:1;color:var(--ink);text-decoration:none;background:var(--surface);border:1px solid var(--control);padding:8px 12px}
.pager a:hover{background:var(--accent-soft)}
.channels{display:inline-flex;margin:0 0 14px;border:1px solid var(--control)}
.channels button{font:inherit;font-size:14px;line-height:1;color:var(--ink);background:var(--surface);border:0;border-left:1px solid var(--control);padding:8px 14px;cursor:pointer}
.channels button:first-child{border-left:0}
.channels button[aria-pressed="true"]{background:var(--control);color:var(--surface)}
.keys{margin:0 0 14px}
.keyrow{display:flex;flex-wrap:wrap;align-items:center;gap:4px 20px}
.group{flex:none;width:64px;font-size:12px;color:var(--muted)}
.key{display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:14px;color:var(--text);background:none;border:0;border-bottom:2px solid transparent;padding:4px 0;cursor:pointer;text-align:left}
.key i{width:10px;height:10px;background:var(--c);flex:none}
.key small{font-size:12px;color:var(--muted)}
.key:hover{color:var(--ink)}
.key[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--ink)}
.keyrow[hidden]{display:none}
.cal{background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.dow{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)}
.dow span{padding:8px 10px}
.week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));row-gap:3px;border-bottom:1px solid var(--line);cursor:pointer}
.week:last-child{border-bottom:0}
.week.sel{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
.day{grid-row:1/-1;display:flex;justify-content:space-between;align-items:flex-start;gap:4px;min-width:0;padding:5px 8px;border-right:1px solid var(--line)}
.day:last-child{border-right:0}
.day.weekend{background:var(--weekend)}
.num{font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}
.day.out .num{color:var(--faint)}
.today .num{background:var(--today);color:var(--ink);font-weight:600;padding:0 6px}
.sends{font-size:11px;line-height:20px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.bar{z-index:1;height:22px;margin:0 4px;padding:0 6px;border-radius:3px;border-left:3px solid var(--c);background:color-mix(in srgb,var(--c) 14%,var(--surface));color:var(--ink);font-size:12px;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .12s}
.bar.planned{background:transparent;border:1px dashed var(--c);color:var(--muted)}
.bar.dim{opacity:.25}
.in{display:inline-block;margin-right:5px;padding:0 3px;font:700 10px/14px var(--body);color:var(--ink);background:var(--surface);border:1px solid var(--c);border-radius:2px;vertical-align:1px}
.empty{color:var(--muted);margin:12px 0 0}
.plans{margin-top:36px}
.planshead{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.planshead h2{font-size:20px}
.planhelp{margin:6px 0 0;font-size:13px;color:var(--muted);max-width:640px}
.btn{font:inherit;font-size:14px;line-height:1;color:var(--ink);background:var(--surface);border:1px solid var(--control);padding:9px 14px;cursor:pointer}
.btn:hover{background:var(--accent-soft)}
.btn.primary{background:var(--control);color:var(--surface)}
.btn:disabled{opacity:.6;cursor:default}
.planform{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-top:14px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.planform[hidden]{display:none}
.planform label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text)}
.planform input{font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:0;padding:8px 10px;min-width:150px}
.planform input[name="name"]{min-width:240px}
.planform input:focus{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}
.formbtns{display:flex;gap:8px}
.formerr{flex-basis:100%;margin:0;font-size:13px;color:var(--attention)}
.formerr:empty{display:none}
.planlist{list-style:none;margin:14px 0 0;padding:0;border-top:1px solid var(--line)}
.planlist li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding:10px 0;border-bottom:1px solid var(--line)}
.planlist .pname{color:var(--ink);font-weight:500}
.planlist .pdates{color:var(--muted);font-size:14px}
.planlist .linkbtn{margin-left:auto;font:inherit;font-size:13px;color:var(--accent);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
.plannote{margin:18px 0 0;color:var(--text)}
.band{margin-top:44px;padding:36px 0 44px;background:var(--band);border-top:1px solid var(--line)}
.phead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px}
.phead h2{font-size:24px}
.phead p{margin:0;color:var(--muted)}
.label{margin:22px 0 0;font:500 14px/1.4 var(--heading);color:var(--ink)}
.label+.strip{margin-top:8px}
.strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:18px 0 0;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.strip div{padding:16px 18px;border-left:1px solid var(--line)}
.strip div:first-child{border-left:0}
.strip dt{font-size:13px}
.strip dd{margin:0}
.strip .v{margin-top:6px;font:400 30px/1.1 var(--heading);color:var(--ink);font-variant-numeric:tabular-nums}
.strip .s{margin-top:4px;font-size:13px;color:var(--muted)}
.cols{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;margin-top:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:18px 20px}
.card h3{font-size:16px;margin-bottom:6px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;font-weight:400;padding:8px 0;border-top:1px solid var(--line);vertical-align:middle}
tbody tr:first-child th,tbody tr:first-child td{border-top:0}
.out td.n{width:3.5em;padding-right:12px;text-align:right;color:var(--ink);font-variant-numeric:tabular-nums}
.out td.m{width:42%}
.meter{display:block;height:8px}
.meter i{display:block;height:8px;border-radius:0 4px 4px 0;background:var(--bar-soft)}
.out tr.hi .meter i{background:var(--accent)}
.out tr.aside th,.out tr.aside td.n{color:var(--muted)}
.out tr.aside small{display:block;font-size:12px}
.outcard{position:relative}
.out tr[data-o]{cursor:default}
.out tr[data-o]:hover th,.out tr[data-o]:focus th{color:var(--ink);text-decoration:underline dotted var(--muted);text-underline-offset:3px}
.out tr[data-o]:focus{outline:2px solid var(--accent);outline-offset:-2px}
.pop{position:absolute;left:12px;z-index:5;width:min(340px,calc(100% - 24px));padding:12px 14px;background:var(--surface);border:1px solid var(--control);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.12);pointer-events:none;font-size:13px}
.pop[hidden]{display:none}
.pop h4{margin:0 0 6px;font:500 13px/1.4 var(--heading);color:var(--ink)}
.pop ul{list-style:none;margin:0;padding:0}
.pop li{display:flex;align-items:center;gap:8px;padding:3px 0}
.pop li i{width:9px;height:9px;flex:none;background:var(--c)}
.pop li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pop li b{font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums}
.pop p{margin:0;color:var(--muted)}
.bycamp{margin-top:16px}
.cardhelp{margin:0 0 10px;font-size:13px;color:var(--muted)}
.scroll{overflow-x:auto}
.camps th,.camps td{padding:8px 12px 8px 0;white-space:nowrap}
.camps thead th{border-top:0;padding-top:0;font-size:12px;font-weight:500;color:var(--muted)}
.camps .r{text-align:right;font-variant-numeric:tabular-nums}
.camps td.r{color:var(--ink)}
.camps th:last-child,.camps td:last-child{padding-right:0}
.camps .cname{white-space:normal;min-width:140px}
.camps .cname button{display:inline-flex;align-items:center;gap:8px;font:inherit;color:var(--ink);background:none;border:0;padding:0;cursor:pointer;text-align:left}
.camps .cname button:hover{text-decoration:underline}
.camps .cname i{width:10px;height:10px;flex:none;background:var(--c)}
.camps tr.on td,.camps tr.on th{background:var(--accent-soft)}
.camps tr.total th,.camps tr.total td{border-top:2px solid var(--line);color:var(--muted)}
.camps .rate{font-weight:600}
.camps .none{color:var(--muted);padding:12px 0;white-space:normal}
.wait thead th{border-top:0;padding-top:0;font-size:12px;font-weight:500;color:var(--muted)}
.wait td{padding-right:12px}
.wait .who{color:var(--ink);font-weight:500;word-break:break-word}
.wait .who a{color:inherit}
.wait .via{color:var(--muted);white-space:nowrap}
.wait .age{padding-right:0;text-align:right;white-space:nowrap;color:var(--muted)}
.wait .tag{color:var(--attention);white-space:nowrap}
.wait td.none{color:var(--muted);padding:12px 0}
.note{padding-top:28px;padding-bottom:48px;font-size:13px;color:var(--muted)}
.note p{max-width:760px;margin:0 0 8px}
@media (max-width:819px){.strip{grid-template-columns:repeat(2,minmax(0,1fr))}.strip div{border-left:0;border-top:1px solid var(--line)}.strip div:nth-child(-n+2){border-top:0}.strip div:nth-child(even){border-left:1px solid var(--line)}.strip div:last-child:nth-child(odd){grid-column:1/-1}.cols{grid-template-columns:minmax(0,1fr)}}
@media (max-width:560px){.wait .camp,.camps .opt{display:none}}
@media (max-width:480px){.planform input,.planform input[name="name"]{min-width:0;width:100%}.planform label{flex-basis:100%}h1{font-size:28px}.sends{display:none}.day{padding:5px 4px}.dow span{padding:8px 4px}.bar{margin:0 1px;padding:0 4px;font-size:11px}}
@media (prefers-reduced-motion:reduce){.bar{transition:none}}
</style></head><body>
<header class="top wrap">
<p class="client">${esc(s.client)}</p>
<h1>Outbound campaigns</h1>
<p class="status">${waitingLine}</p>
<p class="updated">Updated ${esc(updated)}.${opts.dashHref ? ` <a href="${esc(opts.dashHref)}">Outbound summary</a>` : ""}</p>
</header>
<main class="wrap">
<div class="monthbar"><h2>${esc(monthName(s.month))}</h2><nav class="pager" aria-label="Month"><a href="?m=${prev}">&lsaquo; ${esc(shortMonth(prev))}</a><a href="?m=${next}">${esc(shortMonth(next))} &rsaquo;</a></nav></div>
${channels}
<div class="keys" role="group" aria-label="Campaign">${keys}</div>
<div class="cal" id="cal"><div class="dow"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>${grid}</div>
${empty}
<section class="plans" aria-labelledby="plans-title">
<div class="planshead"><h2 id="plans-title">Conferences</h2><button type="button" class="btn" id="plan-open">Add a conference</button></div>
<p class="planhelp">A conference's dates go on every campaign named after it, drawn dashed. With no campaign of that name yet, it gets a bar of its own.</p>
<form id="plan-form" class="planform" hidden novalidate>
<label>Conference<input name="name" maxlength="120" autocomplete="off" required placeholder="HFMA Region 4"></label>
<label>Outreach starts<input type="date" name="start" required></label>
<label>Outreach ends<input type="date" name="end" required></label>
<div class="formbtns"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" id="plan-cancel">Cancel</button></div>
<p class="formerr" id="plan-err" role="alert"></p>
</form>
${planList(s)}
</section>
</main>
<section class="band" aria-labelledby="p-title"><div class="wrap">
<div class="phead"><h2 id="p-title"></h2><p id="p-scope"></p></div>
<div id="p-strips"></div>
<div class="cols">
<section class="card outcard"><h3>Replies by outcome</h3><table class="out"><tbody id="p-out"></tbody></table><div class="pop" id="p-pop" role="tooltip" hidden></div></section>
<section class="card"><h3>Waiting on an answer</h3><table class="wait" id="p-wait"></table></section>
</div>
<section class="card bycamp" aria-labelledby="camps-title"><h3 id="camps-title">By campaign</h3><p class="cardhelp">Each campaign's sends and replies this week. Click a name to see only that campaign.</p><div id="p-camps"></div></section>
</div></section>
<footer class="wrap note">
<p>Click a week to see its numbers. Point at a reply outcome, or tap it, to see it split by campaign. To see one campaign, click its name above the calendar, or its bar in the selected week; click it again to see them all. Solid bars are days a campaign ran; dashed bars are planned days. ${dayNote}</p>
<p>Email reply rate is people who replied that week divided by people emailed that week. Out-of-office and other automatic replies don't count, so it reads lower than Clay's own dashboard. Needs a reply is anyone interested, or whose reply couldn't be sorted, who hasn't had an answer: for email, their Slack card hasn't been sent, skipped or marked done.${liNote} Times are ${esc(s.tz.replace(/_/g, " "))}.${s.notes.length ? " " + s.notes.map(esc).join(" ") : ""}</p>
</footer>
<script id="cal-data" type="application/json">${scriptJson(data)}</script>
<script nonce="${esc(opts.nonce)}">${CLIENT_JS}</script>
</body></html>`;
}

/** The week section, filled in the browser from #cal-data. textContent only. */
const CLIENT_JS = `(function(){
var D=JSON.parse(document.getElementById('cal-data').textContent);
var LABEL={interested:'Interested',needs_read:'Needs a read',later:'Come back later',pass:'Passed',opt_out:'Opted out',redirect:'Pointed elsewhere',ooo:'Out of office'};
var WAIT={interested:'Interested',needs_read:'Needs a read'};
var weeks=D.days.filter(function(_,i){return i%7===0});
var byId={};D.campaigns.forEach(function(c){byId[c.id]=c});
var CHS=D.li?['email','linkedin']:['email'];
var state={week:D.selectedWeek,c:'*',ch:'all'};
try{var h=new URLSearchParams(location.hash.slice(1));if(weeks.indexOf(h.get('w'))>=0)state.week=h.get('w');if(byId[h.get('c')])state.c=h.get('c');if(D.li&&['email','linkedin'].indexOf(h.get('ch'))>=0)state.ch=h.get('ch')}catch(e){}
function $(s){return document.querySelector(s)}
function $$(s){return Array.prototype.slice.call(document.querySelectorAll(s))}
function n(x){return Number(x||0).toLocaleString('en-US')}
function pct(a,b){return b?(Math.round(1000*a/b)/10)+'%':'n/a'}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function add(d,k){return new Date(Date.parse(d+'T00:00:00Z')+k*864e5).toISOString().slice(0,10)}
function fmt(d,o){o.timeZone='UTC';return new Date(d+'T00:00:00Z').toLocaleDateString('en-US',o)}
function wlabel(w){var e=add(w,6);var same=fmt(w,{month:'short'})===fmt(e,{month:'short'});return fmt(w,{month:'short',day:'numeric'})+' to '+(same?fmt(e,{day:'numeric'}):fmt(e,{month:'short',day:'numeric'}))}
function age(iso){var h=(Date.now()-Date.parse(iso))/36e5;if(!(h>=0))return '';if(h<24)return Math.max(1,Math.round(h))+'h';var d=Math.floor(h/24);return d===1?'1 day':d+' days'}
function inWeek(day,w){return day>=w&&day<=add(w,6)}
function fill(box,kids){while(box.firstChild)box.removeChild(box.firstChild);kids.forEach(function(k){box.appendChild(k)})}
function cell(label,v,sub){var d=el('div');d.appendChild(el('dt',null,label));d.appendChild(el('dd','v',v));d.appendChild(el('dd','s',sub));return d}
function strip(cells){var dl=el('dl','strip');cells.forEach(function(c){dl.appendChild(c)});return dl}
function orow(r,max){
  var tr=el('tr',(r.aside?'aside':'')+(r.hi?' hi':''));
  if(r.o&&state.c==='*'){tr.setAttribute('data-o',r.o);tr.tabIndex=0}var th=el('th',null,r.label);if(r.note)th.appendChild(el('small',null,r.note));tr.appendChild(th);
  tr.appendChild(el('td','n',n(r.n)));var td=el('td','m');
  if(!r.noBar){var m=el('span','meter');m.setAttribute('aria-hidden','true');var i=el('i');i.style.width=(r.n?Math.max(2,100*r.n/max):0)+'%';m.appendChild(i);td.appendChild(m)}
  tr.appendChild(td);return tr
}
// Which channel the numbers are for: the chosen campaign's, else the switch.
function channel(){var c=byId[state.c];return c?c.channel:state.ch}
function shows(ch){var cur=channel();return cur==='all'||cur===ch}
function waitingFor(ch){return D.waiting.filter(function(x){return x.channel===ch&&inWeek(x.day,state.week)&&(state.c==='*'||x.campaign_id===state.c)})}
// The week's numbers for one campaign (or '*') on one channel.
function statsOf(ch,id){var src=ch==='linkedin'?(D.li?D.li.weeks:{}):D.weeks;return (src[state.week]||{})[id]||{}}
function onSwitch(ch){return state.ch==='all'||state.ch===ch}
function swatch(c){var i=el('i');i.style.setProperty('--c',c.color||'#8a909b');return i}
function waitCell(list){return cell('Needs a reply',n(list.length),list.length?'oldest '+age(list[0].at):'nobody waiting')}
function render(){
  var key=state.c==='*'?'*':state.c;
  var camp=byId[state.c];
  $('#p-title').textContent='Week of '+wlabel(state.week);
  $('#p-scope').textContent=camp?camp.name:(state.ch==='email'?'All email campaigns':state.ch==='linkedin'?'All LinkedIn campaigns':'All campaigns');
  var e=(D.weeks[state.week]||{})[key]||{};
  var l=D.li?((D.li.weeks[state.week]||{})[key]||{}):{};
  var strips=[],labelled=!!D.li;
  if(camp&&camp.channel==='plan'){
    strips.push(el('p','plannote','Planned for '+fmt(camp.planned_start,{month:'short',day:'numeric'})+' to '+fmt(camp.planned_end,{month:'short',day:'numeric'})+'. No campaign named after it has sent anything yet.'));
  }
  if(shows('email')){
    if(labelled)strips.push(el('h3','label','Email'));
    strips.push(strip([
      cell('People emailed',n(e.leads),n(e.sent)+' emails sent'),
      cell('Reply rate',pct(e.replied,e.leads),n(e.replied)+' replied'),
      cell('Interested',pct(e.interested,e.leads),n(e.interested)+' people'),
      waitCell(waitingFor('email')),
      cell('Bounced',n(e.bounces),pct(e.bounces,e.sent)+' of emails')
    ]));
  }
  if(D.li&&shows('linkedin')){
    strips.push(el('h3','label','LinkedIn'));
    strips.push(strip([
      cell('Connection requests',n(l.requests),n(l.accepted)+' accepted ('+pct(l.accepted,l.requests)+')'),
      cell('Messaged',n(l.messaged),'people who got a message'),
      cell('Reply rate',pct(l.replied,l.messaged),n(l.replied)+' replied'),
      cell('Interested',pct(l.interested,l.messaged),n(l.interested)+' people'),
      waitCell(waitingFor('linkedin'))
    ]));
  }
  fill($('#p-strips'),strips);
  function count(o){return (shows('email')?(e[o]||0):0)+(D.li&&shows('linkedin')?(l[o]||0):0)}
  var rows=D.outcomes.filter(function(o){return o!=='ooo'}).map(function(o){return {o:o,label:LABEL[o],n:count(o),hi:o==='interested'}});
  rows.push({o:'ooo',label:LABEL.ooo,note:'Not counted as a reply',n:count('ooo'),aside:true});
  if(state.c==='*'&&shows('email'))rows.push({label:'Follow-ups due',n:D.followups.filter(function(f){return inWeek(f.day,state.week)}).length,aside:true,noBar:true});
  var max=Math.max.apply(null,[1].concat(rows.filter(function(r){return !r.noBar}).map(function(r){return r.n})));
  hidePop();
  fill($('#p-out'),rows.map(function(r){return orow(r,max)}));
  fill($('#p-camps'),CHS.filter(onSwitch).map(campTable));
  var waiting=D.waiting.filter(function(x){return shows(x.channel)&&inWeek(x.day,state.week)&&(state.c==='*'||x.campaign_id===state.c)});
  var body=el('tbody');
  if(waiting.length){
    waiting.forEach(function(w){
      var tr=el('tr');var who=el('td','who');
      if(w.url){var a=el('a',null,w.name||w.url);a.href=w.url;a.target='_blank';a.rel='noopener noreferrer';who.appendChild(a)}else who.textContent=w.name||w.lead;
      tr.appendChild(who);
      if(D.li)tr.appendChild(el('td','via',w.channel==='linkedin'?'LinkedIn':'Email'));
      tr.appendChild(el('td','camp',w.campaign||''));
      var k=el('td');k.appendChild(el('span','tag',WAIT[w.outcome]||w.outcome));tr.appendChild(k);
      tr.appendChild(el('td','age',age(w.at)));body.appendChild(tr)
    });
    var head=el('thead');var hr=el('tr');var cols=[['who','Who']];if(D.li)cols.push(['via','Via']);cols.push(['camp','Campaign'],['','Reply'],['age','Waiting']);
    cols.forEach(function(c){hr.appendChild(el('th',c[0],c[1]))});head.appendChild(hr);
    fill($('#p-wait'),[head,body]);
  }else{var tr=el('tr');var td=el('td','none','Nobody who replied this week is waiting on an answer.');td.colSpan=5;tr.appendChild(td);body.appendChild(tr);fill($('#p-wait'),[body])}
  $$('.week').forEach(function(w){var on=w.getAttribute('data-week')===state.week;w.classList.toggle('sel',on);w.setAttribute('aria-pressed',on?'true':'false')});
  $$('.bar').forEach(function(b){var other=state.c!=='*'?b.getAttribute('data-c')!==state.c:state.ch!=='all'&&b.getAttribute('data-ch')!==state.ch;b.classList.toggle('dim',other)});
  $$('.key').forEach(function(c){c.setAttribute('aria-pressed',c.getAttribute('data-c')===state.c?'true':'false')});
  $$('.keyrow[data-ch]').forEach(function(r){r.hidden=state.ch!=='all'&&r.getAttribute('data-ch')!==state.ch});
  $$('.channels button').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-ch')===state.ch?'true':'false')});
  $$('.sends').forEach(function(x){
    var d=x.getAttribute('data-day'),em=D.daily[d]||{},li=D.li?(D.li.daily[d]||{}):{},v;
    if(camp)v=(camp.channel==='linkedin'?li:em)[state.c];
    else v=(shows('email')?(em['*']||0):0)+(shows('linkedin')?(li['*']||0):0);
    x.textContent=v?n(v):'';x.title=v?n(v)+(camp&&camp.channel==='linkedin'||state.ch==='linkedin'?' LinkedIn requests and messages':state.ch==='email'||camp?' emails sent':' emails, requests and messages'):''
  });
  try{history.replaceState(null,'','#w='+state.week+(state.c==='*'?'':'&c='+encodeURIComponent(state.c))+(state.ch==='all'?'':'&ch='+state.ch))}catch(e){}
}
// One outcome split by campaign, under its row. Only with every campaign
// showing: with one chosen, the row is already that campaign's.
function hidePop(){var p=$('#p-pop');if(!p)return;p.hidden=true;$$('#p-out tr[aria-describedby]').forEach(function(t){t.removeAttribute('aria-describedby')})}
function showPop(tr){
  var o=tr.getAttribute('data-o'),pop=$('#p-pop'),list=[];
  CHS.filter(onSwitch).forEach(function(ch){D.campaigns.forEach(function(c){if(c.channel!==ch)return;var v=statsOf(ch,c.id)[o]||0;if(v)list.push({c:c,v:v})})});
  list.sort(function(a,b){return b.v-a.v||a.c.name.localeCompare(b.c.name)});
  var kids=[el('h4',null,LABEL[o]+', by campaign')];
  if(list.length){var ul=el('ul');list.forEach(function(x){var li=el('li');li.appendChild(swatch(x.c));li.appendChild(el('span',null,(x.c.channel==='linkedin'&&state.ch==='all'&&CHS.length>1?'LinkedIn: ':'')+x.c.name));li.appendChild(el('b',null,n(x.v)));ul.appendChild(li)});kids.push(ul)}
  else kids.push(el('p',null,'No campaign had any this week.'));
  fill(pop,kids);pop.hidden=false;
  var card=tr.closest('.card').getBoundingClientRect(),row=tr.getBoundingClientRect();
  pop.style.top=Math.round(row.bottom-card.top+4)+'px';
  $$('#p-out tr[aria-describedby]').forEach(function(t){t.removeAttribute('aria-describedby')});
  tr.setAttribute('aria-describedby','p-pop')
}
var outBody=$('#p-out');
outBody.addEventListener('mouseover',function(e){var tr=e.target.closest('tr[data-o]');if(tr)showPop(tr)});
outBody.addEventListener('mouseleave',hidePop);
outBody.addEventListener('focusin',function(e){var tr=e.target.closest('tr[data-o]');if(tr)showPop(tr)});
outBody.addEventListener('focusout',hidePop);
outBody.addEventListener('click',function(e){var tr=e.target.closest('tr[data-o]');if(!tr)return;if(tr.getAttribute('aria-describedby'))hidePop();else showPop(tr)});
document.addEventListener('keydown',function(e){if(e.key==='Escape')hidePop()});
// Every campaign on one channel that did anything this week, busiest first,
// with the channel's total under them.
function campTable(ch){
  var li=ch==='linkedin';
  var cols=li?[['requests','Requests',''],['accepted','Accepted','opt'],['messaged','Messaged','']]:[['sent','Emails sent',''],['leads','People emailed','opt']];
  var reach=li?'messaged':'leads';
  var rows=D.campaigns.filter(function(c){return c.channel===ch}).map(function(c){return {c:c,s:statsOf(ch,c.id)}})
    .filter(function(r){return li?(r.s.requests||r.s.messaged||r.s.replied):(r.s.sent||r.s.replied||r.s.bounces)})
    .sort(function(a,b){var k=li?'requests':'sent';return (b.s[k]||0)-(a.s[k]||0)||a.c.name.localeCompare(b.c.name)});
  var box=el('div');
  if(CHS.length>1)box.appendChild(el('h3','label',li?'LinkedIn':'Email'));
  var wrap=el('div','scroll'),t=el('table','camps'),head=el('thead'),hr=el('tr');
  hr.appendChild(el('th','cname','Campaign'));
  cols.forEach(function(x){hr.appendChild(el('th','r '+x[2],x[1]))});
  [['Replied',''],['Reply rate',''],['Interested','']].concat(li?[]:[['Bounced','opt']]).forEach(function(x){hr.appendChild(el('th','r '+x[1],x[0]))});
  head.appendChild(hr);t.appendChild(head);
  var body=el('tbody');
  function line(name,s,c){
    var tr=el('tr',c?(c.id===state.c?'on':''):'total'),th=el('th','cname');
    if(c){var b=el('button');b.type='button';b.setAttribute('data-c',c.id);b.appendChild(swatch(c));b.appendChild(el('span',null,name));th.appendChild(b)}else th.textContent=name;
    tr.appendChild(th);
    cols.forEach(function(x){tr.appendChild(el('td','r '+x[2],n(s[x[0]])))});
    tr.appendChild(el('td','r',n(s.replied)));
    tr.appendChild(el('td','r rate',pct(s.replied,s[reach])));
    tr.appendChild(el('td','r',n(s.interested)));
    if(!li)tr.appendChild(el('td','r opt',n(s.bounces)));
    body.appendChild(tr)
  }
  if(rows.length){rows.forEach(function(r){line(r.c.name,r.s,r.c)});if(rows.length>1)line(li?'All LinkedIn':'All email',statsOf(ch,'*'),null)}
  else{var tr=el('tr'),td=el('td','none',li?'No LinkedIn campaign ran this week.':'No email campaign sent anything this week.');td.colSpan=8;tr.appendChild(td);body.appendChild(tr)}
  t.appendChild(body);wrap.appendChild(t);box.appendChild(wrap);return box
}
$('#p-camps').addEventListener('click',function(e){var b=e.target.closest('button[data-c]');if(!b)return;var id=b.getAttribute('data-c');state.c=state.c===id?'*':id;render()});
document.getElementById('cal').addEventListener('click',function(e){
  var w=e.target.closest('.week');if(!w)return;var wk=w.getAttribute('data-week');
  // Bars fill most of a week, so the first click on one only picks the week.
  var b=e.target.closest('.bar');if(b&&wk===state.week){var c=b.getAttribute('data-c');state.c=state.c===c?'*':c}
  state.week=wk;render()
});
document.getElementById('cal').addEventListener('keydown',function(e){
  var w=e.target.closest&&e.target.closest('.week');if(!w||(e.key!=='Enter'&&e.key!==' '))return;
  e.preventDefault();state.week=w.getAttribute('data-week');render()
});
$$('.key').forEach(function(c){c.addEventListener('click',function(){var id=c.getAttribute('data-c');state.c=id!=='*'&&state.c===id?'*':id;render()})});
$$('.channels button').forEach(function(b){b.addEventListener('click',function(){state.ch=b.getAttribute('data-ch');state.c='*';render()})});
render();
var form=$('#plan-form'),err=$('#plan-err'),base=location.pathname.replace(/[/]$/,'')+'/plans';
function send(url,body){return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok)throw new Error(j.error||"That didn't save. Try again in a minute.");return j})})}
$('#plan-open').addEventListener('click',function(){form.hidden=false;err.textContent='';form.elements.name.focus()});
$('#plan-cancel').addEventListener('click',function(){form.hidden=true;form.reset();err.textContent=''});
form.addEventListener('submit',function(e){
  e.preventDefault();var btn=form.querySelector('[type=submit]');btn.disabled=true;err.textContent='';
  send(base,{name:form.elements.name.value,start:form.elements.start.value,end:form.elements.end.value})
    .then(function(){location.reload()})
    .catch(function(x){err.textContent=x.message;btn.disabled=false})
});
$$('.planlist [data-plan]').forEach(function(b){b.addEventListener('click',function(){
  if(!confirm('Remove '+b.getAttribute('data-name')+' from the calendar?'))return;
  b.disabled=true;send(base+'/'+encodeURIComponent(b.getAttribute('data-plan'))+'/remove').then(function(){location.reload()}).catch(function(x){b.disabled=false;alert(x.message)})
})});
})();`;

export async function handleCampaignCalendar(
  req: Request,
  res: Response,
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  const token = String(req.params.token || "");
  const clientId = clientForToken(token);
  const client = clientId ? getReplybotClient(clientId) : undefined;
  if (!clientId || !client?.campaignCalendar) {
    res.status(404).send("Not found");
    return;
  }
  const month = parseMonth(req.query.m, todayIn(client.voice.timezone));
  const nonce = crypto.randomBytes(16).toString("base64");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      // The conference form posts to this page's own /plans.
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  const opts = {
    nonce,
    dashHref: client.live ? `/dash/${token}` : undefined,
    theme: themeFor(client.campaignCalendar.theme),
  };
  try {
    res.type("html").send(renderCalendar(await calendarFor(clientId, month), opts));
  } catch (err) {
    const stale = staleCalendar(clientId, month);
    if (stale) {
      res.type("html").send(renderCalendar(stale, opts));
      return;
    }
    res
      .status(503)
      .send("The calendar couldn't load its numbers just now. Try again in a minute.");
    console.warn("calendar.build_failed", clientId, String(err));
  }
}

const PLAN_ID = /^[0-9a-f-]{36}$/;

function planClient(req: Request, res: Response): string | null {
  res.setHeader("Cache-Control", "no-store");
  const clientId = clientForToken(String(req.params.token || ""));
  if (!clientId || !getReplybotClient(clientId)?.campaignCalendar) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  // The page always sends JSON; a plain cross-site form can't.
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Send JSON." });
    return null;
  }
  return clientId;
}

/** POST /dash/:token/calendar/plans: add a conference from the page. */
export async function handleAddPlan(req: Request, res: Response): Promise<void> {
  const clientId = planClient(req, res);
  if (!clientId) return;
  const plan = readPlan(req.body);
  if ("error" in plan) {
    res.status(400).json({ error: plan.error });
    return;
  }
  try {
    const id = await addPlan(clientId, plan);
    forgetCalendars(clientId);
    res.status(201).json({ id });
  } catch (err) {
    console.warn("calendar.plan_add_failed", clientId, String(err));
    res.status(500).json({ error: "That didn't save. Try again in a minute." });
  }
}

/** POST /dash/:token/calendar/plans/:id/remove: take a conference off. */
export async function handleRemovePlan(
  req: Request,
  res: Response,
): Promise<void> {
  const clientId = planClient(req, res);
  if (!clientId) return;
  const id = String(req.params.id || "");
  if (!PLAN_ID.test(id)) {
    res.status(404).json({ error: "No such conference." });
    return;
  }
  try {
    if (!(await removePlan(clientId, id))) {
      res.status(404).json({ error: "No such conference." });
      return;
    }
    forgetCalendars(clientId);
    res.json({ removed: true });
  } catch (err) {
    console.warn("calendar.plan_remove_failed", clientId, String(err));
    res.status(500).json({ error: "That didn't save. Try again in a minute." });
  }
}
