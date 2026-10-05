// @ts-nocheck
// people resolve: putting a full name to a decorated contact label from
// local signals, your LinkedIn connections and Clay, without sending any
// message body anywhere.

"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { db } = require("./db");
const { nameWords, appleContacts } = require("./linkedin-match");

// ---------------------------------------------------------------- resolve
//
// Put a full name to a contact saved as "Alex IYA" or "Mateo Ruiz Muir Hs
// CC Prez", using a candidate list you already own and pay nothing for: your
// own LinkedIn connections, sitting in this database.
//
// THE MESSAGE BODIES DO NOT LEAVE. The file-level promise above is that no
// command here sends a message anywhere, and a resolver is not a good enough
// reason to break it. Signals are extracted locally by pattern, and the model
// is handed a handful of words, the label the user typed, and a list of names.
// It never sees a sentence anybody wrote.
//
// AN EMBEDDED SURNAME IS A CONSTRAINT, NOT A HINT. "Vicky Wu Tc Secretary" is
// not Vera Zhao, and a resolver that treats the only candidate as the answer
// would have said it was. Seventy-six of these contradicted every candidate.
const RESOLVE_CONTEXT = new Set(
  `prez president vp treasurer secretary historian co coprez covp club christian bible
   fellowship hs high school usc ucla iya a2f gbg tc cv cvhs mkhs sphs arcadia monrovia
   duarte muir marshall allies sigma alpha beta kappa theta pi chi delta mom dad friend
   coach suitemate roommate trip dominican republic worship director leader intern manager
   uncle aunt cousin young life fca cru ago sc from the and of team baseball basketball
   soccer music ufc cyf ccf fcf cc collective guy girl work school`.split(/\s+/),
);

const SIGNAL = /\b(usc|ucla|caltech|berkeley|stanford|mit|cornell|iya|marshall|viterbi|annenberg|intern|internship|major|dorm|campus|startup|fraternity|sorority|freshman|sophomore|junior|senior|high school)\b/gi;

function localSignals(d, displayName) {
  const rows = d
    .prepare(`SELECT body FROM messages WHERE who LIKE ? ORDER BY sent_at DESC LIMIT 400`)
    .all(`%${displayName}%`);
  const found = new Set();
  for (const r of rows) for (const m of String(r.body || "").match(SIGNAL) || []) found.add(m.toLowerCase());
  return { signals: [...found].slice(0, 12), messages: rows.length };
}

function cmdResolve(argv) {
  const { flags } = parseArgs(argv);
  const limit = Number(flags.limit || 20);
  const apply = !!flags.apply;
  const useClay = !!flags.clay;
  let clayUsed = 0;
  if (useClay && !clayKey()) die("No Clay key at ~/.chewbacca/clay-key");
  const d = db();

  const conns = d
    .prepare(`SELECT id, name, company, role, linkedin FROM people WHERE source='linkedin' AND deleted_at IS NULL`)
    .all();
  const byFirst = new Map();
  for (const r of conns) {
    const w = nameWords(r.name);
    if (w.length < 2) continue;
    if (!byFirst.has(w[0])) byFirst.set(w[0], []);
    byFirst.get(w[0]).push({ ...r, surname: w[w.length - 1] });
  }

  const contacts = (appleContacts() || []).filter((ct) => ct.first && !ct.last);
  const queue = [];
  let noCandidates = 0, rejected = 0;
  for (const ct of contacts) {
    const w = nameWords(ct.first);
    if (!w.length) continue;
    const first = w[0];
    const others = w.slice(1).filter((x) => !RESOLVE_CONTEXT.has(x));
    let cands = byFirst.get(first) || [];
    // Fall through to Clay's database only when your own connections cannot
    // help. Free, but it is a network call per contact, so it stays opt-in.
    if (!cands.length && useClay && w.length > 1) {
      const full = w.map((x) => x[0].toUpperCase() + x.slice(1)).join(" ");
      cands = clayCandidates(full, 5).filter((x) => x.linkedin);
      if (cands.length) clayUsed++;
    }
    if (!cands.length) { noCandidates++; continue; }
    if (others.length) {
      const kept = cands.filter((c) => others.includes(c.surname));
      if (!kept.length) { rejected++; continue; }
      cands = kept;
    }
    queue.push({ ct, cands, label: ct.first });
  }

  say();
  say(`  ${c.b("Resolving contacts against your own LinkedIn connections")}`);
  say(c.dim(`  ${contacts.length} first-name-only contacts, no Clay credits spent`));
  say();
  say(`  ${c.b(String(queue.length).padStart(5))}  have at least one candidate`);
  say(`  ${c.b(String(rejected).padStart(5))}  ${c.dim("rejected: the surname you typed contradicts every candidate")}`);
  say(`  ${c.b(String(noCandidates).padStart(5))}  ${c.dim(useClay ? "no candidate, even in Clay" : "no candidate on your LinkedIn, try --clay")}`);
  if (clayUsed) say(`  ${c.b(String(clayUsed).padStart(5))}  ${c.dim("got candidates from Clay search, 0 credits")}`);
  say();

  let decided = 0, abstained = 0;
  for (const q of queue.slice(0, limit)) {
    const { signals, messages } = localSignals(d, q.label);
    // One obvious candidate and a label that already carries the surname needs
    // no model at all. Spending a call to confirm an exact string match is
    // theatre.
    let pick = null, why = "", conf = 0;
    if (q.cands.length === 1 && nameWords(q.label).length > 1) {
      pick = q.cands[0]; why = "the surname you typed matches"; conf = 0.95;
    } else if (!signals.length) {
      // A bare first name with nothing extracted is not a resolvable case.
      // Calling the model here invites it to reason from the name, which is
      // the one thing that cannot be evidence: every candidate shares it.
      abstained++;
      say(
        `    ${c.yel(q.label.slice(0, 30).padEnd(32))} ${c.dim(`${q.cands.length} candidate(s), nothing in your messages to tell them apart`)}`,
      );
      continue;
    } else {
      const ans = askModelToResolve(q.label, signals, q.cands);
      if (ans && ans.index >= 0 && ans.index < q.cands.length && ans.confidence >= 0.75) {
        pick = q.cands[ans.index]; why = ans.reason || "model"; conf = ans.confidence;
      } else {
        abstained++;
        say(`    ${c.yel(q.label.slice(0, 30).padEnd(32))} ${c.dim(`${q.cands.length} candidates, not confident`)}`);
        continue;
      }
    }
    decided++;
    say(
      `    ${c.grn(q.label.slice(0, 30).padEnd(32))} ${c.b(pick.name.slice(0, 26).padEnd(27))} ${c.dim(`${Math.round(conf * 100)}%  ${why.slice(0, 40)}`)}`,
    );
    if (apply)
      d.prepare(`UPDATE people SET apple_contact_id=?, nickname=COALESCE(nickname,?), updated_at=datetime('now') WHERE id=?`)
        .run(String(q.ct.uid), q.label.trim(), pick.id);
  }

  say();
  say(`  ${c.b(String(decided))} resolved, ${abstained} left alone.`);
  if (!apply) say(c.dim(`  Nothing was written. Re-run with --apply once the list looks right.`));
  say();
}

// Clay's GTM database as a candidate list, for the contacts your own
// connections cannot cover.
//
// SEARCH IS FREE AND ENRICHMENT IS NOT, and the whole design turns on that
// line. Measured against a live workspace: creating a search and reading its
// results moved the credit balance not at all, while a phone-number lookup is
// an enrichment and is billed per record. Clay's own query reference says the
// dataset cannot filter on a phone number or an email at all, so the cheap
// path and the expensive one are not even the same operation.
//
// What this does is the cheap one: ask by name, get back people with LinkedIn
// URLs, and let the caller decide which is the right one from evidence that
// never leaves this machine.
function clayKey() {
  const f = `${process.env.HOME}/.chewbacca/clay-key`;
  try {
    return fs.readFileSync(f, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function clayCandidates(fullName, limit = 5) {
  const key = clayKey();
  if (!key || !fullName) return [];
  // THE KEY NEVER ENTERS argv. A header passed as a command-line argument is
  // readable by any process on the machine through `ps`, and this one belongs
  // to somebody else's Clay workspace. curl reads its config, headers included,
  // from stdin instead, which no process listing can see.
  // A RATE LIMIT IS NOT AN ABSENCE. Clay answers 429 with "too many concurrent
  // requests in your workspace", and the first version of this caught every
  // error and returned an empty list, so a throttled run reported "270 not
  // found in Clay's database" about people who were never actually looked up.
  // It finished, it printed a number, and the number was a lie.
  //
  // So the status code is read, 429 is retried with backoff, and anything
  // still failing is raised rather than flattened into "no match".
  const post = (url, body) => {
    const cfg =
      `header = "clay-api-key: ${key}"\n` + `header = "Content-Type: application/json"\n`;
    let wait = 1500;
    for (let attempt = 0; attempt < 5; attempt++) {
      const raw = execFileSync(
        "curl",
        ["-s", "-K", "-", "-w", "\\n%{http_code}", "-X", "POST", "--url", url,
         "--data", JSON.stringify(body)],
        { encoding: "utf8", timeout: 45000, input: cfg },
      );
      const cut = raw.lastIndexOf("\n");
      const status = Number(raw.slice(cut + 1).trim());
      const payload = raw.slice(0, cut);
      if (status === 429 || status === 503) {
        execFileSync("sleep", [String(wait / 1000)]);
        wait = Math.min(wait * 2, 20000);
        continue;
      }
      if (status >= 400) throw new Error(`clay ${status}`);
      return JSON.parse(payload);
    }
    throw new Error("clay 429 after retries");
  };
  try {
    const made = post("https://api.clay.com/public/v0/search/query-mode", {
      // `matched_experiences` returns the experiences that MATCHED the query,
      // not the person's whole record. A bare full_name filter therefore comes
      // back with current roles only, and every past job is silently absent.
      // Adding an experience predicate that every row satisfies widens the
      // match to the entire dated history, current and past, in the same free
      // call. Verified 2026-09-18: bare name returned 3 experiences for a
      // profile that has 9.
      query:
        `select from people where full_name = ${JSON.stringify(fullName)}` +
        ` and experiences.any(start_date >= "1900-01")`,
    });
    if (!made || !made.search_id) return [];
    const ran = post(
      `https://api.clay.com/public/v0/search/query-mode/${made.search_id}/run`,
      { limit },
    );
    // Take everything the search returns, not just a city. With the experience
    // predicate above, `matched_experiences` is the full dated career history:
    // company, title, where, and when, past roles included. That is what
    // answers "moved into a higher role" and "raised in the last 24 months",
    // and it arrives in the same free response as the location.
    return (ran.data || []).map((r) => {
      const exps = (r.matched_experiences || r.experiences || []).map((e) => ({
        company: e.company || e.company_name || "",
        title: e.title || e.job_title || "",
        where: e.location || "",
        from: e.start_date || "",
        to: e.end_date || "",
      }));
      const cur = exps.find((e) => !e.to) || exps[0] || {};
      const loc = r.location || {};
      return {
        name: r.name || r.full_name || fullName,
        company: cur.company || "",
        role: cur.title || "",
        linkedin: r.linkedin_url || "",
        location: typeof loc === "string" ? loc : loc.name || "",
        city: typeof loc === "string" ? "" : loc.city || "",
        region: typeof loc === "string" ? "" : loc.state_or_province || "",
        experiences: exps,
        fromClay: true,
      };
    });
  } catch (e) {
    // Raised, not flattened. The caller counts these apart from a genuine miss.
    throw e;
  }
}

// The model sees a label, a few extracted words, and names. Never a message.
function askModelToResolve(label, signals, cands) {
  const list = cands
    .map((c2, i) => `${i}. ${c2.name}${c2.company ? ` (${c2.role || "?"} at ${c2.company})` : ""}`)
    .join("\n");
  const prompt = `A phone contact is saved as "${label}".
Words that came up in conversations with them: ${signals.join(", ") || "(none)"}.

Which of these LinkedIn connections is the same person?
${list}

THE FIRST NAME ALREADY MATCHES ALL OF THEM. That is why they are on this list,
so it is not evidence and must never be your reason. Decide only on the other
words: a school, an employer, a club that lines up with a candidate's company
or role. If those words are absent or point nowhere, the answer is -1.

Answer with JSON only: {"index": <number or -1>, "confidence": <0..1>, "reason": "<8 words>"}.
Guessing is worse than -1: a wrong match here is filed forever and never doubted.`;
  try {
    const out = execFileSync(
      "claude",
      ["-p", "--model", "haiku", "--setting-sources", "", "--strict-mcp-config",
       "--system-prompt", "You match people from sparse evidence. You answer with JSON and nothing else, and you prefer -1 over a guess."],
      { input: prompt, encoding: "utf8", timeout: 60000 },
    );
    const m = String(out).match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

module.exports = {
  cmdResolve, clayKey, clayCandidates,
};
