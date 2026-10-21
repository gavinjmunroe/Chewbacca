// @ts-nocheck
// people cleanup: repairs to the store's rows. Duplicate people (dedupe,
// merge), irreversible removal (purge), clubs versus employers (orgs) and
// broadcast observations (prune-broadcasts).

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db, nowISO } = require("./db");
const { findPerson } = require("./lookup");
const { recomputeScores } = require("./scoring");

// ── dedupe and merge ─────────────────────────────────────────────────────────
// Two importers and a text sync all create people, and nothing ever noticed
// that "Maggie Chen" from Contacts and "Maggie" from a thread were one person.
// A store that quietly holds the same person twice gets every score wrong.

// EVERY COLUMN THAT POINTS AT A PERSON, READ FROM THE SCHEMA.
//
// This was a hand-written list, kept by hand "because a merge that silently
// misses a table loses data and nothing complains". It had already missed two:
// `identities` and `slack_links` both reference people ON DELETE CASCADE, so
// deleting the absorbed row took their phone numbers, emails and Slack link
// with it, silently, on every merge (found 2026-10-21). Reading the foreign
// keys means a new table is carried by default, and the merge and its undo
// agree about what a person owns.
function personRefs(d) {
  const tables = d
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);
  const refs = [];
  for (const t of tables) {
    for (const fk of d.prepare(`SELECT "table" AS ref, "from" AS col FROM pragma_foreign_key_list(?)`).all(t))
      if (fk.ref === "people") refs.push([t, fk.col]);
  }
  return refs;
}

// `visibility` names people by value with no foreign key (item_type/item_id
// and scope_type/scope_ref), so the schema cannot say it points at anyone.
const POLY_REFS = [
  ["visibility", "item_id", "item_type"],
  ["visibility", "scope_ref", "scope_type"],
];

const DERIVED = new Set(["person_scores", "person_dimension_state"]);

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function digits(s) {
  return String(s || "").replace(/\D/g, "").slice(-10);
}

function duplicatePairs(d) {
  const rows = d
    .prepare("SELECT id, name, handle, phone, email, company FROM people WHERE deleted_at IS NULL")
    .all();
  const pairs = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const reasons = [];
      if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase())
        reasons.push("same email");
      if (digits(a.phone) && digits(a.phone) === digits(b.phone)) reasons.push("same phone");
      const na = normName(a.name), nb = normName(b.name);
      if (na && na === nb) reasons.push("same name");
      else if (na && nb) {
        const shorter = na.length < nb.length ? na : nb;
        const longer = na.length < nb.length ? nb : na;
        if (longer.startsWith(shorter + " ")) {
          // Two different confidences, so two different gates.
          //
          // "Maggie" against "Maggie Chen" is one token extended: weak, because
          // a first name matches a lot of people. It needs the company to agree.
          //
          // "Carlton Aikins" against "Carlton Aikins USC" is a FULL name plus a
          // tag, and that is strong on its own. Requiring a company match here
          // missed the real case this was written for: the LinkedIn import wrote
          // "Carlton Aikins / Stora" and the Contacts import wrote "Carlton
          // Aikins USC" with no company at all, so the companies could not agree
          // and one person sat in the store twice for months. The contact-name
          // suffix (" USC", " FCA Prez", " Arcadia") is this user's own tagging
          // habit, which means it is the COMMON case here, not the rare one.
          const fullName = shorter.split(" ").length >= 2;
          if (fullName) reasons.push("same full name, one carries a tag");
          else if (a.company && a.company === b.company)
            reasons.push("one name contains the other, same company");
        }
      }
      if (reasons.length) pairs.push({ a, b, reasons });
    }
  }
  return pairs;
}

// Invisible characters that make two identical names compare as different:
// private use (U+E000..U+F8FF), variation selectors, zero-width space, joiner
// and non-joiner, and the BOM.
function cleanName(n) {
  return String(n || "")
    .replace(/[\uE000-\uF8FF\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cmdDedupe(argv) {
  const { flags } = parseArgs(argv);
  const d = db();
  const pairs = duplicatePairs(d);
  if (!pairs.length) return say(c.dim("no likely duplicates"));
  say("");
  for (const { a, b, reasons } of pairs) {
    say(`  ${c.b(a.name)} ${c.dim("and")} ${c.b(b.name)}`);
    say(`    ${c.dim(reasons.join(", "))}`);
    // Two rows with the same name both resolve to whichever one comes first,
    // so a name-based command for that pair is a guaranteed failure. Print ids
    // when the names match, which is half of this list.
    // TRIM DOES NOT STRIP AN APPLE LOGO. "Aditi Raman" and "Aadhya
    // Sivakumar\uF8FF" are two rows whose names look identical in every
    // terminal, because U+F8FF is a private-use character she carries in her
    // LinkedIn display name. SQLite's TRIM leaves it, so the pair reported as
    // "same name" and then printed a name-based command that cannot work.
    // Private-use, variation selectors and zero-width joiners all do this.
    const same = cleanName(a.name) === cleanName(b.name);
    say(
      `    ${c.dim(same ? `people merge ${a.id} ${b.id}` : `people merge "${a.name}" "${b.name}"`)}`,
    );
  }
  say("");
  say(c.dim(`${pairs.length} likely duplicate pair(s). Nothing was changed.`));
  if (flags.merge) {
    say(c.dim("--merge is deliberate: do them one at a time with people merge <keep> <drop>."));
    say(c.dim("Each one can be taken back with people unmerge."));
  }
}

function cmdMerge(argv) {
  const { rest, flags } = parseArgs(argv);
  if (rest.length < 2)
    die('Merge which two? people merge "Maggie Chen" "Maggie"   (the first one survives)');
  // AN ID IS A VALID ARGUMENT, because half the backlog is same-name pairs.
  //
  // findPerson resolves by name, so two rows called "Anika Rao" both resolve
  // to whichever one it finds first, and the merge refuses itself. 80 of the
  // 166 outstanding duplicate pairs share a name exactly, which made them
  // unmergeable through the CLI, and `people dedupe` printed a name-based
  // command for each one that could not possibly work.
  const d = db();
  const byId = (arg) =>
    d.prepare(`SELECT * FROM people WHERE id = ? AND deleted_at IS NULL`).get(arg);
  const keep = byId(rest[0]) || findPerson(rest[0]);
  const drop = byId(rest[1]) || findPerson(rest[1]);
  if (keep.id === drop.id)
    die(
      "Those resolve to the same row. For two people with the same name, pass ids:\n" +
        "  people dedupe   prints them, and they are safe to copy.",
      2,
    );

  const moved = {};
  let mergeId = null;
  d.exec("BEGIN IMMEDIATE");
  try {
    const refs = personRefs(d);
    // THE PHOTOGRAPH IS OF THE ABSORBED PERSON'S ROWS ONLY, taken as each
    // table is folded. The survivor's own rows are never touched by a merge,
    // so undo has no business with them: the first version photographed both
    // and an unmerge rewrote edits made to the survivor since (review,
    // 2026-10-21). Each row is marked moved (same rowid, now the survivor's)
    // or collided (deleted because the survivor already had its twin).
    const snapshot = { people: [drop], tables: {} };
    const fold = (table, col, where, args, setSql, setArgs) => {
      const rows = d.prepare(`SELECT rowid AS __rowid, * FROM ${table} WHERE ${where}`).all(...args);
      if (!rows.length) return;
      d.prepare(`UPDATE OR IGNORE ${table} SET ${setSql} WHERE ${where}`).run(...setArgs, ...args);
      const stayed = new Set(
        d.prepare(`SELECT rowid AS r FROM ${table} WHERE ${where}`).all(...args).map((r) => r.r),
      );
      d.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...args);
      const bucket = (snapshot.tables[table] ??= []);
      for (const r of rows) bucket.push({ ...r, __col: col, __moved: !stayed.has(r.__rowid) });
      moved[table] = (moved[table] || 0) + rows.length;
    };
    for (const [table, col] of refs) {
      // Scores are rebuilt from observations, so they are folded but never
      // photographed: restoring a stale cache is worse than recomputing it.
      if (DERIVED.has(table)) {
        d.prepare(`UPDATE OR IGNORE ${table} SET ${col} = ? WHERE ${col} = ?`).run(keep.id, drop.id);
        d.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(drop.id);
        continue;
      }
      fold(table, col, `${col} = ?`, [drop.id], `${col} = ?`, [keep.id]);
    }
    for (const [table, col, kind] of POLY_REFS) {
      if (!hasTable(d, table)) continue;
      // OR IGNORE like everything else: two people with the same live rule
      // (both "everyone") hit vis_unique_live and aborted the whole merge.
      fold(table, col, `${kind} = 'person' AND ${col} = ?`, [drop.id], `${col} = ?`, [keep.id]);
    }
    // A blank field on the survivor takes the other's value. A field with
    // something in it is never overwritten: merging must not lose a fact.
    // EVERY COLUMN, NOT A LIST SOMEBODY HAS TO REMEMBER TO EXTEND.
    //
    // This was a hand-written list and `linkedin` was never on it, so merging
    // the LinkedIn row for a person into their contact row threw the profile
    // URL away. The URL is the only thing that makes the free Clay lookup
    // exact, so the merge quietly cost the survivor their work history, and
    // there are 162 pairs outstanding to do it to. `li_connected_on` would
    // have been the second column to go missing the day after it was added.
    //
    // Reading the schema means a new column is carried by default. Only the
    // four that identify the row or timestamp it are held back.
    const never = new Set(["id", "name", "created_at", "updated_at", "deleted_at"]);
    const fill = d
      .prepare(`PRAGMA table_info(people)`)
      .all()
      .map((r) => r.name)
      .filter((n) => !never.has(n));
    const sets = [], vals = [];
    for (const f of fill) {
      if ((keep[f] === null || keep[f] === "" || keep[f] === undefined) && drop[f]) {
        sets.push(`${f} = ?`);
        vals.push(drop[f]);
      }
    }
    if (sets.length) {
      d.prepare(`UPDATE people SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`)
        .run(...vals, keep.id);
    }
    d.prepare("DELETE FROM people WHERE id = ?").run(drop.id);
    const filled = sets.map((s) => s.split(" ")[0]);
    mergeId = d
      .prepare(
        `INSERT INTO merges (keep_id, drop_id, keep_name, drop_name, filled, snapshot)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(keep.id, drop.id, keep.name, drop.name, JSON.stringify(filled), JSON.stringify(snapshot))
      .lastInsertRowid;
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }

  say("");
  say(`  ${c.b(keep.name)} ${c.dim("absorbed")} ${c.b(drop.name)}`);
  for (const [table, n] of Object.entries(moved)) say(c.dim(`    ${n} ${table}`));
  if (!Object.keys(moved).length) say(c.dim("    nothing was attached to the other record"));
  say(c.dim(`    take it back with: people unmerge ${mergeId}`));
  say("");
  if (!flags.quiet) say(c.dim("Scores are stale after a merge. Run: people score"));
}

function hasTable(d, name) {
  return !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

// ---------------------------------------------------------------- unmerge
// Without undo a wrong merge costs data nobody can get back, so every
// uncertain pair waits for a human. With it, a wrong merge costs one command.
// A FAKE UNDO IS WORSE THAN NONE: putting the person back without the phone
// numbers or messages the merge moved leaves them worse off for having trusted
// it, so this restores every photographed row or refuses.

function cmdMerges(argv) {
  const { flags } = parseArgs(argv);
  const d = db();
  const rows = d
    .prepare(
      `SELECT id, keep_name, drop_name, filled, merged_at, undone_at FROM merges
        ORDER BY id DESC LIMIT ?`,
    )
    .all(Number(flags.limit || 20));
  if (!rows.length) return say(c.dim("no merges recorded yet"));
  say("");
  for (const r of rows) {
    const took = JSON.parse(r.filled || "[]");
    const state = r.undone_at ? c.dim(`undone ${r.undone_at.slice(0, 16)}`) : c.dim(r.merged_at.slice(0, 16));
    say(`  ${c.b(String(r.id).padStart(4))}  ${c.b(r.keep_name || "?")} ${c.dim("absorbed")} ${r.drop_name || "?"}  ${state}`);
    if (took.length) say(c.dim(`        took ${took.join(", ")} from ${r.drop_name}`));
  }
  say("");
}

function cmdUnmerge(argv) {
  const { rest, flags } = parseArgs(argv);
  const d = db();
  const arg = rest[0];
  if (!arg) die("Unmerge which? people merges lists them: people unmerge <id> (or last)");
  const m =
    arg === "last"
      ? d.prepare(`SELECT * FROM merges WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1`).get()
      : d.prepare(`SELECT * FROM merges WHERE id = ?`).get(Number(arg));
  if (!m) die(`No merge ${arg}. people merges lists them.`, 2);
  if (m.undone_at) die(`Merge ${m.id} was already undone at ${m.undone_at}.`, 2);
  if (d.prepare(`SELECT 1 FROM people WHERE id = ?`).get(m.drop_id))
    die(`${m.drop_name} already exists again (id ${m.drop_id}), so this would make two of them.`, 2);
  const keepNow = d.prepare(`SELECT * FROM people WHERE id = ?`).get(m.keep_id);
  if (!keepNow) die(`${m.keep_name} is gone from the store, so there is nothing to split apart.`, 2);

  const snap = JSON.parse(m.snapshot);
  const dropRow = snap.people.find((p) => p.id === m.drop_id);
  const restored = {};
  const lost = [];
  const kept = [];
  d.exec("BEGIN IMMEDIATE");
  try {
    // 1. The absorbed person, first, so their rows have someone to point at.
    const cols = Object.keys(dropRow);
    d.prepare(`INSERT INTO people (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
      .run(...cols.map((k) => dropRow[k]));

    // 2. The fields the survivor took. Only those, and only where they still
    //    hold what the merge put there: an edit made since is the user's.
    const filled = JSON.parse(m.filled || "[]");
    for (const f of filled) {
      if (keepNow[f] === dropRow[f])
        d.prepare(`UPDATE people SET ${f} = NULL WHERE id = ?`).run(m.keep_id);
    }

    // 3. Every photographed row, back to the absorbed person.
    //
    //    A MOVED row still has its rowid. It goes back only if it is still the
    //    same row: same rowid, now the survivor's, every other column as
    //    photographed. Only the person column changes, so nothing is deleted
    //    and nothing cascades (deleting and reinserting observations took
    //    their observation_dimensions with them and zeroed a real score,
    //    2026-10-21). A row edited since stays with the survivor and is
    //    reported, because the edit is the user's.
    //
    //    A COLLIDED row was deleted, so it is inserted. Its old rowid is used
    //    only if free: SQLite reuses the highest rowid, and writing into a row
    //    created since the merge would overwrite somebody's new data.
    //
    //    One row failing (its circle deleted since, say) is reported, not fatal.
    const refCols = new Map();
    for (const [tb, col] of personRefs(d)) refCols.set(tb, [...(refCols.get(tb) || []), col]);
    for (const [tb, col] of POLY_REFS) refCols.set(tb, [...(refCols.get(tb) || []), col]);
    for (const [table, rows] of Object.entries(snap.tables)) {
      if (!hasTable(d, table)) {
        lost.push(`${table} (${rows.length})`);
        continue;
      }
      const skip = new Set(["__rowid", "__col", "__moved", ...(refCols.get(table) || [])]);
      let n = 0;
      for (const r of rows) {
        const row = Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("__")));
        const same = Object.keys(row).filter((k) => !skip.has(k));
        try {
          if (r.__moved) {
            const cond = same.map((k) => `${k} IS ?`).join(" AND ");
            const res = d
              .prepare(
                `UPDATE OR IGNORE ${table} SET ${r.__col} = ? WHERE rowid = ? AND ${r.__col} = ?${cond ? ` AND ${cond}` : ""}`,
              )
              .run(m.drop_id, r.__rowid, m.keep_id, ...same.map((k) => row[k]));
            if (res.changes) n++;
            else kept.push(`${table} row ${r.__rowid}`);
          } else {
            const keys = Object.keys(row);
            const ph = keys.map(() => "?").join(", ");
            const free = !d.prepare(`SELECT 1 FROM ${table} WHERE rowid = ?`).get(r.__rowid);
            const res = free
              ? d
                  .prepare(`INSERT OR IGNORE INTO ${table} (rowid, ${keys.join(", ")}) VALUES (?, ${ph})`)
                  .run(r.__rowid, ...keys.map((k) => row[k]))
              : d
                  .prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(", ")}) VALUES (${ph})`)
                  .run(...keys.map((k) => row[k]));
            if (res.changes) n++;
            else lost.push(`${table} row ${r.__rowid}`);
          }
        } catch (e) {
          lost.push(`${table} row ${r.__rowid}: ${String(e.message || e).slice(0, 80)}`);
        }
      }
      if (n) restored[table] = n;
    }
    d.prepare(`UPDATE merges SET undone_at = datetime('now') WHERE id = ?`).run(m.id);
    if (lost.length && !flags.force) {
      d.exec("ROLLBACK");
      say(c.yel(`  Not undone: ${lost.length} row(s) could not go back exactly:`));
      for (const l of lost.slice(0, 10)) say(c.dim(`    ${l}`));
      say(c.dim("  Nothing was changed. --force undoes the rest and leaves those out."));
      process.exitCode = 1;
      return;
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  recomputeScores();
  say("");
  say(`  ${c.b(m.drop_name)} ${c.dim("is back, split from")} ${c.b(m.keep_name)}`);
  for (const [table, n] of Object.entries(restored)) say(c.dim(`    ${n} ${table}`));
  if (kept.length)
    say(c.yel(`    ${kept.length} row(s) changed or removed since the merge, left with ${m.keep_name}`));
  if (lost.length) say(c.yel(`    ${lost.length} row(s) could not go back (--force)`));
  say("");
}

// ---------------------------------------------------------------- purge
// Soft delete hides a person. It does not remove their messages, and the whole
// point of archiving a thread off the machine is that the copy on the machine
// stops existing. This is the irreversible one, and it says so.
function cmdPurge(argv) {
  const { flags, rest } = parseArgs(argv);
  const who = rest.join(" ");
  if (!who) die('Who? Try: people purge "Lexi" --archived-to /Volumes/Drive/lexi-archive');
  const d = db();
  const p = findPerson(who);

  const counts = {
    messages: d.prepare("SELECT count(*) AS n FROM messages WHERE person_id=?").get(p.id).n,
    observations: d.prepare("SELECT count(*) AS n FROM observations WHERE person_id=?").get(p.id).n,
    facts: d.prepare("SELECT count(*) AS n FROM quick_facts WHERE person_id=?").get(p.id).n,
  };

  if (!flags.yes) {
    say("");
    say(c.red(`  This permanently deletes ${c.b(p.name)} and everything attached:`));
    say(`    ${counts.messages} messages, ${counts.observations} observations, ${counts.facts} facts`);
    say("");
    say(c.yel("  There is no undo. Confirm the archive is off this machine first."));
    say(c.dim(`    people purge "${p.name}" --yes`));
    say("");
    return;
  }
  // An archive path is not required, but recording one means the store can say
  // where the data went instead of just that it is gone.
  const note = flags["archived-to"] ? ` archived to ${flags["archived-to"]}` : "";

  d.exec("BEGIN IMMEDIATE");
  try {
    for (const [table, col] of PERSON_TABLES) {
      d.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(p.id);
    }
    d.prepare("DELETE FROM identities WHERE person_id=?").run(p.id);
    d.prepare("DELETE FROM people WHERE id=?").run(p.id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  // The tombstone carries no content, only that a purge happened. Without it
  // the next contact import silently recreates the person.
  d.prepare(
    "INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(`purged:${p.name.toLowerCase()}`, `${nowISO()}${note}`);

  say(`${c.grn("purged")} ${c.b(p.name)}  ${c.dim(`${counts.messages} messages removed${note}`)}`);
  recomputeScores();
}

// A STUDENT CLUB IS NOT AN EMPLOYER.
//
// LinkedIn puts club officer roles in the same experience list as jobs, so
// the import wrote "Kappa Theta Pi" and "SEP at USC" into `company` next to
// "Google". Anything that reads company as a place of work ("who do I know at
// a 20-200 person company") silently counts fraternity members as employees.
//
// This does not rewrite the field, because for USC staff the university IS
// the employer and the same string is correct. It classifies, and the caller
// decides. Role is the tiebreaker: an Academic Advisor at USC is employed, a
// VP of Internal Affairs is holding a club office.
const GREEK =
  "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega";
const CLUB_PATTERNS = [
  // Two Greek letters is a chapter. One is a company name (Alpha Vantage, Sigma).
  new RegExp(`\\b(?:${GREEK})\\b.*\\b(?:${GREEK})\\b`, "i"),
  /\bfraternity|sorority\b/i,
  // "X at USC" is the campus-chapter naming convention. The anchor is what
  // makes it safe: a bare "consulting group" is Boston Consulting Group.
  /\bat (?:USC|UCLA|Berkeley|Stanford|[A-Z][a-z]+ (?:University|College))\b/,
  /\b(?:hackathon|student (?:government|association|union))\b/i,
  /\bLA Hacks\b|\bLavaLab\b/i,
];
const CLUB_ROLES =
  /\b(?:vp|vice president|president|treasurer|secretary|chair|director) of (?:internal|external|finance|marketing|membership|operations|recruitment)\b|\b(?:pledge|rush|social) chair\b|\bco-?founder'?s? education\b/i;
const SCHOOL_PATTERNS = /\b(?:university|college|school of|academy|institute of technology)\b/i;
const STAFF_ROLES =
  /\b(?:professor|lecturer|advisor|adviser|researcher|dean|provost|postdoc|staff|faculty|instructor|coordinator|administrator|scientist)\b/i;

function affiliationKind(company, role) {
  if (!company) return null;
  const r = role || "";
  if (CLUB_PATTERNS.some((re) => re.test(company)) || CLUB_ROLES.test(r)) return "club";
  // A university with a staff-shaped title is a real job. With a student-shaped
  // title or none at all, it is somebody's school.
  if (SCHOOL_PATTERNS.test(company)) return STAFF_ROLES.test(r) ? "employer" : "school";
  return "employer";
}

function cmdOrgs(argv) {
  const { flags } = parseArgs(argv);
  const want = flags.kind || null;
  const rows = db()
    .prepare(
      `SELECT name, company, role FROM people
        WHERE deleted_at IS NULL AND company IS NOT NULL AND company <> ''
        ORDER BY company, name`,
    )
    .all();
  const buckets = { club: [], school: [], employer: [] };
  for (const r of rows) buckets[affiliationKind(r.company, r.role)].push(r);

  for (const kind of ["club", "school", "employer"]) {
    if (want && want !== kind) continue;
    const list = buckets[kind];
    say(`\n  ${c.b(kind)}  ${c.dim(String(list.length) + " people")}`);
    if (kind === "employer" && !want) {
      say(c.dim("    (use --kind employer to list)"));
      continue;
    }
    const byOrg = new Map();
    for (const r of list) byOrg.set(r.company, (byOrg.get(r.company) || 0) + 1);
    for (const [org, n] of [...byOrg].sort((a, b) => b[1] - a[1]).slice(0, 25))
      say(`    ${String(n).padStart(3)}  ${org}`);
  }
  say(
    c.dim(
      `\n  club and school are affiliations, not jobs. Anything asking "who works at"\n  should read employer only.\n`,
    ),
  );
}

// THE SAME SENTENCE ON FIFTY PEOPLE IS NOT FIFTY FACTS.
//
// An import wrote "he wrote when inviting them: Hey goat can we coffee chat"
// onto 50 different people. Every copy is true and none of them tells you
// anything about the person, because the text is identical for all fifty. It
// is the broadcast problem again, one table over: observation_count feeds
// completeness, so fifty people read as better known than they are.
//
// A shared event is the thing this must not touch. Twelve people really did
// attend the same Bible study, and that observation IS about each of them.
// The difference is that a shared event describes what happened with them,
// while a broadcast quotes what went out to everybody. Quoting is the signal,
// so only observations that embed a quoted outbound message are eligible.
const QUOTED_OUTBOUND = /\b(?:wrote|sent|texted|messaged)\b[^:]{0,40}:/i;

function cmdPruneBroadcasts(argv) {
  const { flags } = parseArgs(argv);
  const apply = !!flags.apply;
  const limit = Number(flags.min || 10);
  const d = db();
  const rows = d
    .prepare(
      `SELECT body, COUNT(DISTINCT person_id) AS n FROM observations
        WHERE deleted_at IS NULL
        GROUP BY body HAVING n >= ?1 ORDER BY n DESC`,
    )
    .all(limit);

  const hits = rows.filter((r) => QUOTED_OUTBOUND.test(r.body));
  if (!hits.length) {
    say(c.dim(`\n  nothing sent verbatim to ${limit} or more people\n`));
    return;
  }
  say("");
  let total = 0;
  for (const h of hits) {
    say(`  ${String(h.n).padStart(3)}  ${String(h.body).replace(/\n/g, " ").slice(0, 60)}`);
    total += h.n;
  }
  if (!apply) {
    say(c.dim(`\n  ${total} observations on ${hits.length} broadcasts. --apply to retire them\n`));
    return;
  }
  const up = d.prepare(
    `UPDATE observations SET deleted_at = datetime('now') WHERE body = ? AND deleted_at IS NULL`,
  );
  for (const h of hits) up.run(h.body);
  say(c.grn(`\n  retired ${total} observations. run people score to refresh completeness\n`));
}

module.exports = {
  cmdPurge, cmdDedupe, cmdMerge, cmdMerges, cmdUnmerge, cmdOrgs, cmdPruneBroadcasts,
};
