// @ts-nocheck
// people commitments: dates, tasks, loans, relationships, check-ins and
// quick facts (date, task, loan, rel, check-on, ask, fact).

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db, uuid, nowISO, daysBetween } = require("./db");
const { findPerson } = require("./lookup");

// Writing "Sarah is Ben's mother" without also writing "Ben is Sarah's son"
// makes the graph a lie in one direction. Anything not in this map is stored
// symmetrically, which is right for friend, colleague, neighbour.
const INVERSE = {
  parent: "child", child: "parent",
  mother: "child", father: "child",
  sibling: "sibling", brother: "sibling", sister: "sibling",
  spouse: "spouse", partner: "partner",
  grandparent: "grandchild", grandchild: "grandparent",
  manager: "report", report: "manager",
  mentor: "mentee", mentee: "mentor",
  friend: "friend", colleague: "colleague", neighbour: "neighbour", neighbor: "neighbor",
  cofounder: "cofounder", roommate: "roommate", ex: "ex",
};

// ---------------------------------------------------------------- commitments

function parseMonthDay(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  m = t.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m) return { year: null, month: +m[1], day: +m[2] };
  die(`Could not read the date "${s}". Use MM-DD, or YYYY-MM-DD when you know the year.`);
}

function cmdDate(argv) {
  const sub = argv[0] === "add" || argv[0] === "list" || argv[0] === "rm" ? argv.shift() : "add";
  const { flags, rest } = parseArgs(argv);
  const d = db();

  if (sub === "list") {
    const rows = upcomingDates(Number(flags.days || 90));
    if (!rows.length) return say(c.dim("  no dates in that window"));
    say("");
    for (const r of rows) say(`  ${c.b(r.name.padEnd(22))} ${r.label.padEnd(16)} ${whenLabel(r.away)}${r.age ? c.dim(`  turns ${r.age}`) : ""}`);
    say("");
    return;
  }

  const who = rest.shift();
  const label = rest.join(" ").trim();
  if (!who || !label || !flags.on)
    die('Try: people date add maggie "wedding anniversary" --on 06-14');
  const p = findPerson(who);
  if (sub === "rm") {
    d.prepare("DELETE FROM important_dates WHERE person_id=? AND lower(label)=lower(?)").run(p.id, label);
    return say(`${c.red("removed")} ${label} for ${p.name}`);
  }
  const { year, month, day } = parseMonthDay(flags.on);
  d.prepare(
    "INSERT INTO important_dates (id, person_id, label, month, day, year) VALUES (?,?,?,?,?,?)",
  ).run(uuid(), p.id, label, month, day, year);
  say(`${c.grn("added")} ${label} for ${c.b(p.name)}`);
}

function whenLabel(away) {
  if (away === 0) return c.grn("today");
  if (away === 1) return c.yel("tomorrow");
  return `in ${away} days`;
}

// Birthdays live on people.birthday and everything else lives in
// important_dates. Both are recurring days, so they are read as one list.
function upcomingDates(days) {
  const d = db();
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out = [];
  const push = (name, label, month, day, year) => {
    if (!month || !day) return;
    let next = new Date(base.getFullYear(), month - 1, day);
    if (next < base) next = new Date(base.getFullYear() + 1, month - 1, day);
    const away = Math.round((next - base) / 86400000);
    if (away <= days)
      out.push({ name, label, away, age: year ? next.getFullYear() - year : null });
  };
  for (const r of d
    .prepare("SELECT name, birthday FROM people WHERE deleted_at IS NULL AND birthday IS NOT NULL")
    .all()) {
    const s = String(r.birthday);
    if (s.length >= 10) push(r.name, "birthday", +s.slice(5, 7), +s.slice(8, 10), +s.slice(0, 4));
    else {
      const m = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
      if (m) push(r.name, "birthday", +m[1], +m[2], null);
    }
  }
  for (const r of d
    .prepare(
      `SELECT p.name, i.label, i.month, i.day, i.year FROM important_dates i
         JOIN people p ON p.id = i.person_id WHERE p.deleted_at IS NULL`,
    )
    .all())
    push(r.name, r.label, r.month, r.day, r.year);
  out.sort((a, b) => a.away - b.away);
  return out;
}

function cmdTask(argv) {
  const sub = ["add", "done", "list", "rm"].includes(argv[0]) ? argv.shift() : "add";
  const { flags, rest } = parseArgs(argv);
  const d = db();

  if (sub === "list") {
    const rows = openTasks(flags.all ? 100000 : Number(flags.days || 3650));
    if (!rows.length) return say(c.grn("  nothing owed"));
    say("");
    for (const r of rows)
      say(
        `  ${c.dim(r.ref.padEnd(6))} ${r.title.padEnd(38)} ${r.person ? c.b(r.person) : c.dim("(no one)")}` +
          (r.due_at ? c.dim(`  ${dueLabel(r.due_at)}`) : ""),
      );
    say(c.dim("\n  people task done <ref>"));
    say("");
    return;
  }

  if (sub === "done" || sub === "rm") {
    const ref = rest[0];
    if (!ref) die("people task done <ref>   (the short code from `people task list`)");
    const row = d
      .prepare("SELECT * FROM tasks WHERE substr(id,1,6)=? AND done_at IS NULL")
      .get(String(ref).toLowerCase());
    if (!row) die(`No open task "${ref}". Run: people task list`);
    if (sub === "rm") d.prepare("DELETE FROM tasks WHERE id=?").run(row.id);
    else d.prepare("UPDATE tasks SET done_at=? WHERE id=?").run(nowISO(), row.id);
    return say(`${c.grn(sub === "rm" ? "removed" : "done")} ${row.title}`);
  }

  // `people task add maggie "send the book"` and `people task add "call the bank"`
  // are both valid: the first word is a person only when it resolves to one.
  let personId = null;
  let title;
  const maybe = rest.length > 1 ? findPerson(rest[0], { required: false }) : null;
  if (maybe) {
    personId = maybe.id;
    title = rest.slice(1).join(" ").trim();
  } else title = rest.join(" ").trim();
  if (!title) die('Try: people task add maggie "send her the Bonhoeffer book" --due 2026-09-20');
  const id = uuid();
  d.prepare("INSERT INTO tasks (id, person_id, title, due_at) VALUES (?,?,?,?)").run(
    id,
    personId,
    title,
    flags.due || null,
  );
  say(`${c.grn("owed")} ${title}${maybe ? ` to ${c.b(maybe.name)}` : ""} ${c.dim(id.slice(0, 6))}`);
}

function dueLabel(due) {
  const days = Math.round(daysBetween(nowISO(), due));
  if (days < 0) return c.red(`${-days}d overdue`);
  if (days === 0) return c.yel("today");
  return `in ${days}d`;
}

function openTasks(withinDays) {
  return db()
    .prepare(
      `SELECT t.*, substr(t.id,1,6) AS ref, p.name AS person
         FROM tasks t LEFT JOIN people p ON p.id = t.person_id
        WHERE t.done_at IS NULL
          AND (t.due_at IS NULL OR julianday(t.due_at) - julianday('now') <= ?)
        ORDER BY t.due_at IS NULL, t.due_at`,
    )
    .all(withinDays);
}

function cmdLoan(argv) {
  const sub = ["list", "settle"].includes(argv[0]) ? argv.shift() : "add";
  const { flags, rest } = parseArgs(argv);
  const d = db();

  if (sub === "list") {
    const rows = d
      .prepare(
        `SELECT l.*, substr(l.id,1,6) AS ref, p.name FROM loans l
           JOIN people p ON p.id = l.person_id
          WHERE l.settled_at IS NULL ORDER BY l.lent_at`,
      )
      .all();
    if (!rows.length) return say(c.grn("  nothing outstanding"));
    say("");
    for (const r of rows) {
      const arrow = r.direction === "lent" ? c.yel("they have") : c.cyn("you have");
      say(`  ${c.dim(r.ref)}  ${arrow} ${r.what}${r.amount ? ` (${r.amount})` : ""}  ${c.b(r.name)}${c.dim("  since " + String(r.lent_at).slice(0, 10))}`);
    }
    say(c.dim("\n  people loan settle <ref>"));
    say("");
    return;
  }

  if (sub === "settle") {
    const row = d
      .prepare("SELECT * FROM loans WHERE substr(id,1,6)=? AND settled_at IS NULL")
      .get(String(rest[0] || "").toLowerCase());
    if (!row) die(`No open loan "${rest[0]}". Run: people loan list`);
    d.prepare("UPDATE loans SET settled_at=? WHERE id=?").run(nowISO(), row.id);
    return say(`${c.grn("settled")} ${row.what}`);
  }

  const who = rest.shift();
  const what = (flags.lent === true || flags.borrowed === true ? rest.join(" ") : flags.lent || flags.borrowed || rest.join(" ")).trim();
  if (!who || !what)
    die('Try: people loan maggie --lent "the Bonhoeffer book"   or --borrowed "$40"');
  const p = findPerson(who);
  const direction = flags.borrowed ? "borrowed" : "lent";
  d.prepare("INSERT INTO loans (id, person_id, direction, what, amount) VALUES (?,?,?,?,?)").run(
    uuid(),
    p.id,
    direction,
    what,
    flags.amount ? Number(flags.amount) : null,
  );
  say(`${c.grn("recorded")} ${direction === "lent" ? "lent to" : "borrowed from"} ${c.b(p.name)}: ${what}`);
}

function cmdRel(argv) {
  const { rest } = parseArgs(argv);
  const d = db();
  // people rel maggie mother declan   ("maggie is declan's mother")
  if (rest.length === 1) {
    const p = findPerson(rest[0]);
    const rows = d
      .prepare(
        `SELECT r.kind, p2.name FROM relationships r JOIN people p2 ON p2.id = r.to_id
          WHERE r.from_id = ? AND p2.deleted_at IS NULL ORDER BY r.kind`,
      )
      .all(p.id);
    if (!rows.length) return say(c.dim(`  no relationships recorded for ${p.name}`));
    say("");
    for (const r of rows) say(`  ${p.name} is ${c.b(r.kind)} of ${r.name}`);
    say("");
    return;
  }
  if (rest.length < 3)
    die('Try: people rel maggie mother declan    ("maggie is declan\'s mother")');
  const a = findPerson(rest[0]);
  const kind = String(rest[1]).toLowerCase();
  const b = findPerson(rest.slice(2).join(" "));
  if (a.id === b.id) die("A person cannot be related to themselves.");
  const inverse = INVERSE[kind] || kind;
  const ins = d.prepare(
    "INSERT INTO relationships (from_id, to_id, kind) VALUES (?,?,?) ON CONFLICT DO NOTHING",
  );
  ins.run(a.id, b.id, kind);
  ins.run(b.id, a.id, inverse);
  say(`${c.grn("linked")} ${a.name} is ${c.b(kind)} of ${b.name}${c.dim(`, and ${b.name} is ${inverse} of ${a.name}`)}`);
}

function cmdCheckOn(argv) {
  const { flags, rest } = parseArgs(argv);
  const who = rest.join(" ");
  if (!who) die('Try: people check-on ben --in 14d --because "his thesis defense"');
  const p = findPerson(who);
  if (!flags.because)
    die(
      "Say why, with --because.\n" +
        "  A reminder with no reason is a default, not a decision, and in three\n" +
        "  weeks you will not remember which it was.",
    );
  const m = String(flags.in || "14d").match(/^(\d+)\s*([dwm])?$/);
  if (!m) die('--in wants something like 10d, 3w, or 2m');
  const mult = m[2] === "w" ? 7 : m[2] === "m" ? 30 : 1;
  const when = new Date(Date.now() + Number(m[1]) * mult * 86400000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  db()
    .prepare("UPDATE people SET next_check_at=?, next_check_reason=? WHERE id=?")
    .run(when, String(flags.because), p.id);
  say(`${c.grn("will surface")} ${c.b(p.name)} on ${when.slice(0, 10)}${c.dim("  because " + flags.because)}`);
}

function dueChecks() {
  return db()
    .prepare(
      `SELECT name, next_check_at, next_check_reason FROM people
        WHERE deleted_at IS NULL AND next_check_at IS NOT NULL
          AND julianday(next_check_at) <= julianday('now')
        ORDER BY next_check_at`,
    )
    .all();
}

// What you have not asked yet, straight off the template. Turns completeness
// from a number you cannot act on into a list of questions.
function cmdAsk(argv) {
  const { rest } = parseArgs(argv);
  const d = db();
  const tpl = d.prepare("SELECT * FROM quick_fact_template ORDER BY sort_order").all();
  if (!rest.length) {
    say("");
    for (const t of tpl) say(`  ${c.b(t.key.padEnd(14))} ${c.dim(t.prompt)}`);
    say(c.dim("\n  people ask <name>            what is still blank for them"));
    say(c.dim("  people fact <name> <key> <value>"));
    say("");
    return;
  }
  const p = findPerson(rest.join(" "));
  const have = new Map(
    d.prepare("SELECT key, value FROM quick_facts WHERE person_id=?").all(p.id).map((r) => [r.key, r.value]),
  );
  say("\n" + c.b(p.name));
  const missing = [];
  for (const t of tpl) {
    if (have.has(t.key)) say(`  ${c.grn("+")} ${t.key.padEnd(14)} ${have.get(t.key)}`);
    else missing.push(t);
  }
  if (!missing.length) return say(c.grn("\n  nothing left to ask\n"));
  say("\n" + c.cyn("  still unknown"));
  for (const t of missing) say(`    ${t.key.padEnd(14)} ${c.dim(t.prompt)}`);
  say("");
}

function cmdFact(argv) {
  const { rest } = parseArgs(argv);
  if (rest.length < 3) die('Try: people fact maggie food "allergic to shellfish"');
  const p = findPerson(rest[0]);
  const key = String(rest[1]).toLowerCase();
  const value = rest.slice(2).join(" ").trim();
  const d = db();
  if (!d.prepare("SELECT 1 FROM quick_fact_template WHERE key=?").get(key))
    d.prepare("INSERT INTO quick_fact_template (key, prompt, sort_order) VALUES (?,?,?)").run(
      key,
      key.replace(/_/g, " "),
      500,
    );
  d.prepare(
    `INSERT INTO quick_facts (person_id, key, value, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(person_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(p.id, key, value, nowISO());
  say(`${c.grn("saved")} ${key} for ${c.b(p.name)}`);
}

module.exports = {
  cmdDate, upcomingDates, cmdTask, dueLabel, openTasks, cmdLoan, cmdRel, cmdCheckOn, dueChecks,
  cmdAsk, cmdFact,
};
