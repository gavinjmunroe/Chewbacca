// Data in, blocks out. Code picks every number on the page; nothing here is
// written by a model. Layout follows Maggie's campaign report for Serif (four
// headline tiles, reply rate per campaign, an all-metrics table with a total,
// completed campaigns all time), with the intervals her report did not have.
import { rates, sum, verdicts, pct, BOUNCE_FLAG } from "./stats.js";
import { capItems } from "./blocks.js";
import { togariDid } from "./rules.js";

const WINDOW_WORDS = { "7d": "the last 7 days", all: "all time" };

export function meta(source, asOf, stale) {
  return { source, as_of: asOf || null, ...(stale ? { stale } : {}) };
}

export function campaignKpis(rows, m, window) {
  const t = rates(sum(rows));
  const live = rows.filter((r) => r.sent > 0).length;
  return {
    type: "kpi_row",
    id: `kpis-${window}`,
    title: `Campaigns, ${WINDOW_WORDS[window]}`,
    ...m,
    items: [
      {
        label: "Emails sent",
        value: t.sent,
        format: "int",
        sub: `${live} campaign${live === 1 ? "" : "s"} sending${t.leads ? ` to ${t.leads.toLocaleString("en-US")} investors` : ""}`,
      },
      {
        label: "Delivered",
        value: t.delivered,
        format: "pct",
        sub: `${(t.sent - t.bounces).toLocaleString("en-US")} of ${t.sent.toLocaleString("en-US")}`,
      },
      {
        label: "Reply rate",
        value: t.reply ? t.reply.rate : null,
        format: "pct",
        sub: t.reply
          ? `${t.replies} replies, likely ${pct(t.reply.low)} to ${pct(t.reply.high)}`
          : "nothing sent yet",
        tone: "good",
      },
      {
        label: "Bounced",
        value: t.bounce,
        format: "pct",
        sub: t.bounce_flag
          ? `${t.bounces} bounced, over the ${pct(BOUNCE_FLAG, 0)} line where inboxes start to push back`
          : `${t.bounces} bounced`,
        tone: t.bounce_flag ? "bad" : "muted",
      },
    ],
  };
}

/**
 * A campaign's name inside its company, without the segment every one of that
 * company's campaigns repeats: "Pre-seed investors, Wave 2" under Ivy becomes
 * "Wave 2" (on a 375 px phone the repeated segment wrapped every row to three
 * lines, 2026-10-10). A campaign named by its segment alone keeps it.
 */
export function shortNames(rows) {
  const firstOf = (r) => String(r.sequence || "").split(", ")[0];
  const shared =
    rows.length > 1 && rows.every((r) => firstOf(r) === firstOf(rows[0]))
      ? firstOf(rows[0])
      : null;
  const out = new Map();
  for (const r of rows) {
    const s = String(r.sequence || r.campaign || "");
    out.set(
      r,
      shared && s.startsWith(`${shared}, `) ? s.slice(shared.length + 2) : s,
    );
  }
  return out;
}

function group(rows, by) {
  if (by === "campaign") {
    const byCo = new Map();
    for (const r of rows)
      byCo.set(r.company, [...(byCo.get(r.company) || []), r]);
    const names = new Map();
    for (const rs of byCo.values())
      for (const [r, n] of shortNames(rs)) names.set(r, n);
    return rows.map((r) => ({
      label: [r.company, names.get(r)].filter(Boolean).join(", "),
      sub: "",
      row: r,
    }));
  }
  const g = new Map();
  for (const r of rows) {
    const k = r.company || "Other";
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return [...g].map(([label, rs]) => ({
    label,
    sub: `${rs.length} campaign${rs.length === 1 ? "" : "s"}`,
    row: sum(rs),
  }));
}

/** Reply rate per company or campaign, each with its 95% interval and a verdict. */
export function replyRateBars(rows, m, window, by = "company") {
  const groups = group(
    rows.filter((r) => r.sent > 0),
    by,
  );
  const scored = groups.map((g) => ({ ...g, r: rates(g.row) }));
  const v = verdicts(scored.map((s) => ({ interval: s.r.reply })));
  const separated = v.some((x) => x === "ahead" || x === "behind");
  // Rank only what the intervals separate: ahead first, behind last, and
  // everything that is too early to tell in volume order between them. A rate
  // sort would rank 2 replies on 9 emails above 12 on 200.
  const tier = { ahead: 0, early: 1, none: 1, behind: 2 };
  const order = scored.map((s, i) => ({ s, v: v[i] }));
  order.sort((a, b) => tier[a.v] - tier[b.v] || b.s.r.sent - a.s.r.sent);
  const { items, more } = capItems(
    "bar_list",
    order.map(({ s, v: verdict }) => ({
      label: s.label,
      sub: `${s.sub ? `${s.sub}, ` : ""}${s.r.replies} replies on ${s.r.sent.toLocaleString("en-US")} emails`,
      value: s.r.reply ? s.r.reply.rate : null,
      low: s.r.reply ? s.r.reply.low : null,
      high: s.r.reply ? s.r.reply.high : null,
      verdict,
    })),
  );
  return {
    type: "bar_list",
    id: `rates-${by}-${window}`,
    title: `Reply rate by ${by}, ${WINDOW_WORDS[window]}`,
    mode: "rate",
    caption: separated
      ? "Replies per email sent. The shaded band is where the true rate likely sits; only rates whose bands do not overlap are marked ahead or behind."
      : "Replies per email sent. The shaded band is where the true rate likely sits. Every band overlaps, so it is too early to call any of these better than another.",
    ...m,
    items,
    ...(more ? { more } : {}),
  };
}

function columns(withLeads) {
  return [
    { key: "name", label: "Campaign" },
    ...(withLeads
      ? [{ key: "leads", label: "Leads", align: "right", format: "int" }]
      : []),
    { key: "sent", label: "Sent", align: "right", format: "int" },
    { key: "delivered", label: "Delivered", align: "right", format: "pct" },
    { key: "replies", label: "Replies", align: "right", format: "int" },
    { key: "reply", label: "Reply rate", align: "right", format: "interval" },
    { key: "bounces", label: "Bounced", align: "right", format: "int" },
    { key: "bounce", label: "Bounce rate", align: "right", format: "pct" },
  ];
}

function tableRow(name, r, level) {
  return {
    name,
    level,
    leads: r.leads,
    sent: r.sent,
    delivered: r.delivered,
    replies: r.replies,
    reply: r.reply
      ? { rate: r.reply.rate, low: r.reply.low, high: r.reply.high }
      : null,
    bounces: r.bounces,
    bounce: r.bounce,
    flag: r.bounce_flag ? "bounce" : undefined,
  };
}

/** Every metric, companies with their campaigns underneath, and a total row. */
export function campaignTable(rows, m, window, { title, id } = {}) {
  const byCompany = new Map();
  // A week's table lists what sent that week; 8 of 30 rows on 2026-10-10 were
  // campaigns with nothing sent in the window. All time keeps them, since a
  // campaign that never sent is worth seeing.
  const shown = window === "all" ? rows : rows.filter((r) => r.sent > 0);
  for (const r of shown) {
    const k = r.company || "Other";
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(r);
  }
  const out = [];
  for (const [company, rs] of [...byCompany].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    out.push(tableRow(company, rates(sum(rs)), 0));
    const names = shortNames(rs);
    for (const r of [...rs].sort((a, b) => b.sent - a.sent))
      out.push(tableRow(names.get(r) || r.campaign, rates(r), 1));
  }
  return {
    type: "table",
    id: id || `table-${window}`,
    title: title || `All metrics, ${WINDOW_WORDS[window]}`,
    ...m,
    columns: columns(rows.length > 0 && rows.every((r) => r.leads != null)),
    rows: out.slice(0, 40),
    ...(out.length > 40 ? { more: out.length - 40 } : {}),
    total: tableRow("Total", rates(sum(rows)), 0),
  };
}

/** Sentences built from the numbers alone, for the top of an answer. */
export function headline(rows, window) {
  const t = rates(sum(rows));
  if (!t.sent) return `Nothing has gone out in ${WINDOW_WORDS[window]}.`;
  const groups = group(
    rows.filter((r) => r.sent > 0),
    "company",
  ).map((g) => ({ label: g.label, r: rates(g.row) }));
  const v = verdicts(groups.map((g) => ({ interval: g.r.reply })));
  const ahead = groups.filter((_, i) => v[i] === "ahead").map((g) => g.label);
  const when = window === "all" ? "So far" : "In the last 7 days";
  const all = Math.max(
    rows.reduce((a, r) => a + (Number(r.replies) || 0), 0),
    t.replies,
  );
  const parts = [
    `${when}, ${t.sent.toLocaleString("en-US")} emails went out and ${all.toLocaleString("en-US")} ${all === 1 ? "reply" : "replies"} came back, ${t.replies} of them from real people rather than out of office notices (${pct(t.reply.rate)} of emails).`,
    ahead.length
      ? `${ahead.join(" and ")} ${ahead.length > 1 ? "are" : "is"} getting replies at a clearly higher rate than the rest.`
      : "No company is clearly ahead of another yet, because the counts are still too small to separate them.",
  ];
  if (t.bounce_flag)
    parts.push(
      `Bounces are at ${pct(t.bounce)}, above the ${pct(BOUNCE_FLAG, 0)} line, so the lists need cleaning before the next wave.`,
    );
  return parts.join(" ");
}

// Cut on a word boundary and say so, instead of stopping mid-word.
function shorten(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,;:]+$/, "")}...`;
}

export function replyCards(
  list,
  m,
  { id = "replies", title = "Replies" } = {},
) {
  const cards = (Array.isArray(list) ? list : []).map((x) => ({
    investor: String(x.investor || x.email || "Unknown"),
    firm: x.firm ? String(x.firm) : "",
    company: x.company ? String(x.company) : "",
    // Togari's list read keeps the first 400 characters (SUBSTR in
    // list_replies), so a 400-long body was cut there and gets an ellipsis.
    wrote:
      shorten(cleanReply(x.wrote), 360) +
      (String(x.wrote || "").length >= 400 && cleanReply(x.wrote).length <= 360
        ? "..."
        : ""),
    did: togariDid(x.togari_did),
    when: x.received ? String(x.received) : "",
  }));
  const { items, more } = capItems("reply_cards", cards);
  return {
    type: "reply_cards",
    id,
    title,
    ...m,
    items,
    ...(more ? { more } : {}),
  };
}

export function followupTimeline(
  list,
  m,
  { id = "followups", title = "Follow ups scheduled" } = {},
) {
  const rows = (Array.isArray(list) ? list : [])
    .filter((x) => x && x.due)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .map((x) => ({
      when: String(x.due),
      title: String(x.investor || x.email || "Investor"),
      detail:
        x.status === "scheduled"
          ? "One follow up email"
          : `Follow up ${String(x.status || "")}`.trim(),
    }));
  const { items, more } = capItems("timeline", rows);
  return {
    type: "timeline",
    id,
    title,
    ...m,
    items,
    ...(more ? { more } : {}),
  };
}

export function decksTable(list, m) {
  const rows = (Array.isArray(list) ? list : []).map((d) => ({
    name: String(d.company || ""),
    link: String(d.url || ""),
  }));
  return {
    type: "table",
    id: "decks",
    title: "Decks on file",
    ...m,
    columns: [
      { key: "name", label: "Company" },
      { key: "link", label: "Deck", format: "link" },
    ],
    rows,
  };
}

export function outcomeBars(summary, m) {
  const did =
    summary && typeof summary.what_togari_did === "object"
      ? summary.what_togari_did
      : {};
  const items = Object.entries(did)
    .map(([k, n]) => ({ label: togariDid(k), value: Number(n) || 0 }))
    .reduce((acc, it) => {
      const hit = acc.find((a) => a.label === it.label);
      if (hit) hit.value += it.value;
      else acc.push(it);
      return acc;
    }, [])
    .sort((a, b) => b.value - a.value);
  return {
    type: "bar_list",
    id: "togari-did",
    title: `What happened with ${Number(summary?.replies_received) || 0} replies`,
    mode: "count",
    ...m,
    items: capItems("bar_list", items).items,
  };
}

// Clay's inbox tags, in Jonah's words. A tag is the inbox's guess, never a
// verdict, so the positive ones are grouped as "needs a read" and never shown
// as interest (interest-from-text).
const TAG_GROUP = {
  "Out Of Office": "Out of office",
  "Not Interested": "Said no",
  "Do Not Contact": "Asked not to be emailed",
  "Wrong Person": "Wrong person",
};

/** A reply as a person would quote it: no link blobs, image tags or legal footers. */
export function cleanReply(text) {
  return String(text || "")
    .replace(/<\s*(https?:|mailto:)[^>]*(>|$)/gi, "")
    .replace(/\[\s*(https?:|mailto:)[^\]]*\]/gi, "")
    .replace(/\(\s*https?:[^)]*\)/gi, "")
    .replace(/\[image:[^\]]*\]/gi, "")
    .replace(
      /\b(CONFIDENTIALITY NOTICE|This (e-?mail|message) (and any attachments )?(is|may contain) confidential|Sent from my iPhone|Get Outlook for)[\s\S]*$/i,
      "",
    )
    .replace(/\s*ᐧ\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/**
 * One number for the week's replies, with where each one went. Clay's inbox
 * says who wrote back (one row per person); Togari says which of them it has
 * read. On 2026-10-10 the page showed 62 replies from Clay beside 27 read by
 * Togari with nothing joining them: 78 people had written back, 17 of them out
 * of office, and 51 had never reached Togari at all.
 */
export function reconcileReplies(threads, togariRows, m, hashEmail) {
  const read = new Map();
  for (const x of Array.isArray(togariRows) ? togariRows : []) {
    if (x && x.email)
      read.set(hashEmail(String(x.email).trim().toLowerCase()), x);
  }
  const seen = new Set();
  const people = [];
  for (const t of threads) {
    if (seen.has(t.who)) continue; // one person, one row
    seen.add(t.who);
    people.push(t);
  }
  // Grouped by what the person said or what happened next, in the client's
  // words. The page used to split them by which of our systems had read each
  // one ("Read by Togari", "still in the Clay inbox"), which is process
  // chatter under Zeutara's client-channel ruling and told Jonah nothing he
  // could act on (Caleb, 2026-10-11: "The jonah dashbaord site sucks on so
  // many levels").
  const bucket = new Map();
  const add = (label, part) => {
    const b = bucket.get(label) || { n: 0, parts: new Map() };
    b.n += 1;
    if (part) b.parts.set(part, (b.parts.get(part) || 0) + 1);
    bucket.set(label, b);
  };
  for (const t of people) {
    if (read.has(t.who)) {
      const did = togariDid(read.get(t.who).togari_did);
      add(
        DID_BUCKET[did] || "Other",
        DID_BUCKET[did] === "Waiting on you" ? "sent to you in Slack" : null,
      );
    } else {
      const tag = TAG_GROUP[t.category];
      add(
        tag === "Wrong person"
          ? "Pointed to someone else"
          : tag || "Waiting on you",
        tag ? null : "not read yet",
      );
    }
  }
  const order = [
    "Waiting on you",
    "Following up later",
    "Pointed to someone else",
    "Said no",
    "Asked not to be emailed",
    "Out of office",
    "Other",
  ];
  const items = order
    .filter((k) => bucket.has(k))
    .map((k) => {
      const b = bucket.get(k);
      return {
        label: k,
        value: b.n,
        sub:
          [...b.parts].map(([p, n]) => `${n} ${p}`).join(", ") ||
          BUCKET_SUB[k] ||
          "",
      };
    });
  return {
    type: "bar_list",
    id: "replies-reconciled",
    title: `${people.length} ${people.length === 1 ? "person" : "people"} wrote back in the last 7 days`,
    caption:
      "Grouped by what each person said or what happened next. Nobody counts as a yes until their own reply says so.",
    mode: "count",
    ...m,
    items,
  };
}

const DID_BUCKET = {
  "Sent to you as a card in Slack": "Waiting on you",
  "Follow up scheduled": "Following up later",
  "Logged as a pass": "Said no",
  Blocklisted: "Asked not to be emailed",
  "Forwarded to their new address": "Pointed to someone else",
  "Forwarded to the person they referred": "Pointed to someone else",
};

const BUCKET_SUB = {
  "Following up later": "One follow up is scheduled for each",
  "Pointed to someone else":
    "Sent on to the person they named, or the wrong contact",
  "Asked not to be emailed": "Never emailed again",
  "Out of office": "Followed up when they are back",
};

export function notice(id, text, tone = "info") {
  return { type: "notice", id, text, tone };
}

export function text(id, body, m) {
  return { type: "text", id, text: body, ...(m || {}) };
}
