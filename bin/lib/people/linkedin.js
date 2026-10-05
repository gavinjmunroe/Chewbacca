// @ts-nocheck
// people linkedin: the linkedin command and its subcommands, including
// writing organization, title and notes back to Contacts, Clay lookups,
// invitations, changes and the audit.

"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { db, uuid } = require("./db");
const {
  nameWords, appleContacts, parseCsvRows, allExports, mergeExports, matchContacts,
} = require("./linkedin-match");
const { clayKey, clayCandidates } = require("./resolve");

function cmdLinkedin(argv) {
  const sub = ["sync", "audit", "clay", "changes", "locate"].includes(argv[0]) ? argv.shift() : "sync";
  const { flags } = parseArgs(argv);
  const files = typeof flags.export === "string" ? [flags.export] : allExports();
  if (!files.length) die("No LinkedIn export found. Unzip one into ~/Downloads and re-run.");
  const { conns, changes } = mergeExports(files);
  const contacts = appleContacts();
  if (contacts === null) die("Could not read Contacts. Grant Full Disk Access to your terminal.");
  const m = matchContacts(contacts, conns);
  const apply = !flags["dry-run"];

  if (sub === "audit") return linkedinAudit(m, flags);
  if (sub === "clay") return linkedinClay(m, flags);
  if (sub === "changes") return linkedinChanges(changes, flags);
  if (sub === "locate") return linkedinLocate(flags);

  say();
  say(`  ${c.b("LinkedIn")} ${c.dim("->")} ${c.b("Contacts")}`);
  say(`  ${c.dim(`${files.length} export(s) merged`)}`);
  say(`  ${c.dim(`${conns.length} connections, ${contacts.length} contacts`)}`);
  say();

  const d = db();
  let orgWrites = 0, nickWrites = 0, metWrites = 0;
  const writes = [];

  // FIRST, EVERY CONNECTION GETS A ROW.
  //
  // This was missing and it is the difference between "matched" and "saved".
  // The command walked the address book looking for LinkedIn records and never
  // wrote the connections themselves, so 124 people who appear in an export
  // existed nowhere in the store: no row, unsearchable, and invisible to every
  // later question. Matching is what happens after the people exist.
  //
  // Keyed on the profile URL, because a name is not an identifier: two Daniel
  // Kims are two rows, and one person who changes their display name must not
  // become a second.
  //
  // THE URL IS NOT STABLE EITHER, which this used to assume. A vanity URL is a
  // field the member edits, and Tobias Lund edited his between the June and
  // September exports. The URL key missed, a second row was inserted, and one
  // man existed twice: the old row holding the internship and the new one
  // holding the job. A brief written off either half was half wrong.
  //
  // The connection date is the thing that genuinely never changes. LinkedIn
  // stamps it once and no member can edit it, so name plus connection date
  // catches a URL change that the URL alone cannot. It is only consulted when
  // the URL misses, and only when exactly one row matches, because two people
  // of the same name connecting on the same day is a reason to insert rather
  // than to guess.
  let imported = 0, refreshed = 0, reurled = 0;
  const haveUrl = new Map();
  for (const r of d
    .prepare(`SELECT id, linkedin, company, role FROM people WHERE linkedin IS NOT NULL AND linkedin<>'' AND deleted_at IS NULL`)
    .all())
    haveUrl.set(String(r.linkedin).trim().replace(/\/+$/, ""), r);

  const connKey = (name, on) => `${String(name).trim().toLowerCase()}|${String(on).trim().toLowerCase()}`;
  const haveConn = new Map();
  for (const r of d
    .prepare(`SELECT id, name, company, role, linkedin, li_connected_on, how_we_met FROM people
               WHERE deleted_at IS NULL
                 AND (li_connected_on IS NOT NULL OR how_we_met LIKE 'connected on LinkedIn %')`)
    .all()) {
    // The column when it is there; rows written before it existed still carry
    // the date inside how_we_met, and backfilling from that costs one parse.
    const on = r.li_connected_on || String(r.how_we_met || "").replace(/^connected on LinkedIn /i, "");
    if (!on) continue;
    const k = connKey(r.name, on);
    // A collision means the key cannot identify anybody. Poison it rather than
    // letting the second row win.
    haveConn.set(k, haveConn.has(k) ? null : r);
  }

  for (const li of conns) {
    const url = (li.URL || "").trim().replace(/\/+$/, "");
    if (!url) continue;
    const name = `${li["First Name"]} ${li["Last Name"]}`.replace(/\s+/g, " ").trim();
    if (!name) continue;
    let existing = haveUrl.get(url);
    if (!existing && li["Connected On"]) {
      const moved = haveConn.get(connKey(name, li["Connected On"]));
      if (moved && moved.linkedin && moved.linkedin.replace(/\/+$/, "") !== url) {
        if (apply)
          d.prepare(`UPDATE people SET linkedin=?, updated_at=datetime('now') WHERE id=?`).run(url, moved.id);
        haveUrl.set(url, moved);
        existing = moved;
        reurled++;
      }
    }
    if (!existing) {
      if (apply)
        d.prepare(
          `INSERT INTO people (id, name, company, role, linkedin, source, how_we_met, li_connected_on)
           VALUES (?,?,?,?,?,'linkedin',?,?)`,
        ).run(
          uuid(),
          name,
          li.Company || null,
          li.Position || null,
          url,
          li["Connected On"] ? `connected on LinkedIn ${li["Connected On"]}` : null,
          li["Connected On"] || null,
        );
      imported++;
    } else if (existing && li["Connected On"] && !existing.li_connected_on) {
      // Backfill, so the next URL change is catchable even for rows that were
      // imported before this column existed.
      if (apply)
        d.prepare(`UPDATE people SET li_connected_on=? WHERE id=? AND (li_connected_on IS NULL OR li_connected_on='')`)
          .run(li["Connected On"], existing.id);
    }
    if (existing && li.Company && existing.company !== li.Company) {
      // The merged export is newer than whatever is on the row.
      if (apply)
        d.prepare(`UPDATE people SET company=?, role=COALESCE(?,role), updated_at=datetime('now') WHERE id=?`)
          .run(li.Company, li.Position || null, existing.id);
      refreshed++;
    }
  }
  for (const [ct, li] of [...m.exact, ...m.nickname]) {
    const full = `${li["First Name"]} ${li["Last Name"]}`.replace(/\s+/g, " ").trim();
    // LinkedIn wins on employer, because people update it when they move and
    // an address book is where a job title goes to die. A card saying Cisco
    // for somebody who has been at MindFort since June is not a preserved
    // preference, it is a stale fact. The old value is not lost: it goes in
    // the note as where they used to be.
    if (li.Company && ct.org !== li.Company) {
      writes.push({ uid: ct.uid, org: li.Company, title: li.Position || "", was: ct.org || "" });
      orgWrites++;
    }
    const row = d
      .prepare(`SELECT id, nickname, how_we_met FROM people WHERE lower(name)=lower(?) AND deleted_at IS NULL`)
      .get(full);
    if (!row) continue;

    // A NICKNAME IS A DIFFERENT FIRST NAME, not a longer line. Mike for
    // Michael is one. "Leo Owen Marsh IYA" is a full name with the
    // club he is from typed after it, and filing that as what he goes by would
    // be wrong in a way that then gets printed next to his name forever.
    const liFirst = nameWords(li["First Name"])[0] || "";
    const ctFirst = nameWords(ct.first)[0] || "";
    const isNickname = ctFirst && liFirst && ctFirst !== liFirst;
    if (isNickname && !row.nickname) {
      if (apply)
        d.prepare(`UPDATE people SET nickname=?, updated_at=datetime('now') WHERE id=?`)
          .run(ct.first.trim(), row.id);
      nickWrites++;
    }
    // The rest of what was typed into the name field is how this person is
    // known, which is the one thing an address book records that LinkedIn
    // never will.
    if (ct.context && !row.how_we_met) {
      if (apply)
        d.prepare(`UPDATE people SET how_we_met=?, updated_at=datetime('now') WHERE id=?`)
          .run(ct.context, row.id);
      metWrites++;
    }
    if (apply) d.prepare(`UPDATE people SET apple_contact_id=? WHERE id=?`).run(String(ct.uid || ct.pk), row.id);
  }

  if (imported || refreshed) {
    say(
      apply
        ? `  ${c.grn(String(imported))} new people saved from your exports, ${refreshed} had their employer refreshed.`
        : c.dim(`  ${imported} new people would be saved, ${refreshed} refreshed (--dry-run)`),
    );
    say();
  }
  const line = (label, n, note = "") =>
    say(`  ${c.b(String(n).padStart(5))}  ${label.padEnd(22)} ${c.dim(note)}`);
  line("matched by name", m.exact.length);
  line("matched by nickname", m.nickname.length, "both names now stored");
  line("uncertain", m.unsure.length, "not written, listed below");
  line("first name only", m.firstOnly.length, "needs Clay: phone -> LinkedIn");
  if (reurled)
    say(
      c.dim(
        `  ${reurled} changed their LinkedIn URL since the last export and were followed, not duplicated.`,
      ),
    );
  line("not on LinkedIn", m.absent.length, "people linkedin audit");
  say();

  if (m.nickname.length) {
    say(`  ${c.b("Nicknames learned")}`);
    for (const [ct, li] of m.nickname)
      say(`    ${c.cyn((ct.first + " " + ct.last).trim().padEnd(24))} ${c.dim("is")} ${(li["First Name"] + " " + li["Last Name"]).replace(/\s+/g, " ").trim()}`);
    say();
  }
  if (m.unsure.length) {
    say(`  ${c.b("Not sure these are the same person")} ${c.dim("(nothing written)")}`);
    for (const [ct, li] of m.unsure)
      say(`    ${c.yel((ct.first + " " + ct.last).trim().padEnd(24))} ${c.dim("vs")} ${(li["First Name"] + " " + li["Last Name"]).replace(/\s+/g, " ").trim()}`);
    say();
  }

  // Everything known about each matched person, onto the card itself.
  const notes = [];
  for (const [ct, li] of [...m.exact, ...m.nickname]) {
    const full = `${li["First Name"]} ${li["Last Name"]}`.replace(/\s+/g, " ").trim();
    const row = d.prepare(`SELECT id FROM people WHERE lower(name)=lower(?) AND deleted_at IS NULL`).get(full);
    const body = composeNote(d, row && row.id, li, ct.context);
    if (body && ct.uid) notes.push({ id: ct.uid, body });
  }

  if (writes.length && apply) {
    const n = writeContactOrgs(writes);
    const moved = writes.filter((w) => w.was).length;
    say(`  ${c.grn(String(n))} contact cards updated with a current company.`);
    if (moved) say(c.dim(`    ${moved} of those had an older employer on the card.`));
  } else if (writes.length) {
    say(c.dim(`  ${writes.length} cards would gain or update a company (--dry-run)`));
  }
  const invites = ingestInvitations(d, files, apply);
  if (invites)
    say(
      apply
        ? `  ${c.grn(String(invites))} now record who sent the connection request first.`
        : c.dim(`  ${invites} would record who reached out first (--dry-run)`),
    );

  if (notes.length && apply) {
    const n = writeContactNotes(notes);
    say(`  ${c.grn(String(n))} notes written, with the LinkedIn link and what you know.`);
  } else if (notes.length) {
    say(c.dim(`  ${notes.length} notes would be written (--dry-run)`));
  }
  if (nickWrites)
    say(
      apply
        ? `  ${c.grn(String(nickWrites))} people now store both names.`
        : c.dim(`  ${nickWrites} people would store both names (--dry-run)`),
    );
  if (metWrites)
    say(
      apply
        ? `  ${c.grn(String(metWrites))} gained how you know them, kept from your own labels.`
        : c.dim(`  ${metWrites} would gain how you know them (--dry-run)`),
    );
  say();
  say(
    c.dim(
      `  No contact was created. ${conns.length - m.exact.length - m.nickname.length} connections had no card and stayed out of Contacts.`,
    ),
  );
  say();
  say(`  ${c.dim("next:")} people linkedin audit   ${c.dim("|")}   people linkedin clay`);
  say();
}

// Writes go through Contacts itself, never the SQLite file. That file is the
// app's private storage: a write behind its back does not sync to the phone
// and gets overwritten the next time the app decides to.
//
// `mac contacts edit` addresses a card by the same "<UUID>:ABPerson" id the
// database stores, which is what makes this a direct write rather than the
// scan-every-contact loop that made the first attempt take minutes.
// Organization and job title, through the same scripted interface the notes go
// through.
//
// This used to shell out to `mac contacts edit` once per card. That worked
// until it didn't: it started returning CoreData 134092 and exiting zero, so
// every write failed while the run reported success, and the summary printed
// "0 cards updated" directly above "33 of those had an older employer". A
// count that disagrees with the sentence under it is the only reason this was
// noticed at all.
//
// One osascript call for the whole batch, addressed by the same id the notes
// use, and it sets the job title too, which the CLI never could.
function writeContactOrgs(writes) {
  const rows = writes.filter((w) => w.uid && (w.org || w.title));
  if (!rows.length) return 0;
  const script = `
function run(argv) {
  var rows = JSON.parse(argv[0]);
  var app = Application("Contacts");
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    try {
      var p = app.people.byId(rows[i].uid);
      if (rows[i].org) p.organization = rows[i].org;
      if (rows[i].title) p.jobTitle = rows[i].title;
      n++;
    } catch (e) {}
  }
  app.save();
  return String(n);
}`;
  const f = `${require("node:os").tmpdir()}/chewbacca-orgs-${process.pid}.js`;
  fs.writeFileSync(f, script);
  try {
    const out = execFileSync("osascript", ["-l", "JavaScript", f, JSON.stringify(rows)], {
      encoding: "utf8",
      timeout: 180000,
    });
    return Number(String(out).trim()) || 0;
  } catch {
    return 0;
  } finally {
    try { fs.unlinkSync(f); } catch {}
  }
}

// A job change, found for free by comparing two exports that were already on
// the disk. This is the answer to "can Clay watch for job updates": for anyone
// already connected on LinkedIn, it does not need to. A fresh export is free
// and takes two minutes, and the Company column moving is the event.
// Everything this store knows, written onto the contact card itself.
//
// The card is the thing that is there when the phone rings, offline, with no
// terminal. So the note carries the links and the facts rather than pointing
// at a database the person holding the phone cannot open.
//
// FENCED AND IDEMPOTENT. Anything the user typed above or below the fence is
// theirs and survives every re-run; only the block between the markers is
// rewritten. A sync that appended would grow the note forever, and one that
// replaced the whole field would delete a note somebody wrote by hand.
const NOTE_START = "--- chewbacca ---";
const NOTE_END = "--- end chewbacca ---";

function composeNote(d, personId, li, context) {
  const lines = [];
  const p = personId
    ? d.prepare(`SELECT * FROM people WHERE id=?`).get(personId)
    : null;
  const role = (p && p.role) || (li && li.Position) || "";
  const company = (p && p.company) || (li && li.Company) || "";
  if (role || company) lines.push([role, company].filter(Boolean).join(" at "));
  const url = (p && p.linkedin) || (li && li.URL) || "";
  if (url) lines.push(url);
  if (context) lines.push(`known from: ${context}`);

  if (p) {
    const circles = d
      .prepare(
        `SELECT c.name FROM circle_members m JOIN circles c ON c.id=m.circle_id
          WHERE m.person_id=? AND c.deleted_at IS NULL ORDER BY c.name`,
      )
      .all(p.id)
      .map((r) => r.name);
    if (circles.length) lines.push(`circles: ${circles.join(", ")}`);

    const facts = d
      .prepare(`SELECT key, value FROM quick_facts WHERE person_id=? ORDER BY key`)
      .all(p.id);
    for (const f of facts) lines.push(`${f.key.replace(/_/g, " ")}: ${String(f.value).slice(0, 220)}`);

    const s = d.prepare(`SELECT last_interaction_at FROM person_scores WHERE person_id=?`).get(p.id);
    if (s && s.last_interaction_at) lines.push(`last contact: ${s.last_interaction_at.slice(0, 10)}`);
    if (p.nickname) lines.push(`also known as: ${p.nickname}`);
  }
  return lines.filter(Boolean).join("\n");
}

function writeContactNotes(rows) {
  if (!rows.length) return 0;
  const script = `
function run(argv) {
  var rows = JSON.parse(argv[0]);
  var app = Application("Contacts");
  var START = ${JSON.stringify(NOTE_START)};
  var END = ${JSON.stringify(NOTE_END)};
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    try {
      var p = app.people.byId(r.id);
      var cur = p.note() || "";
      var s = cur.indexOf(START), e = cur.indexOf(END);
      var before = s >= 0 ? cur.slice(0, s) : cur;
      var after = e >= 0 ? cur.slice(e + END.length) : "";
      if (s < 0 && cur && !cur.match(/\\n$/)) before = cur + "\\n";
      var block = START + "\\n" + r.body + "\\n" + END;
      p.note = (before + block + after).replace(/\\n{3,}/g, "\\n\\n");
      n++;
    } catch (err) {}
  }
  app.save();
  return String(n);
}`;
  const f = `${require("node:os").tmpdir()}/chewbacca-notes-${process.pid}.js`;
  fs.writeFileSync(f, script);
  try {
    const out = execFileSync("osascript", ["-l", "JavaScript", f, JSON.stringify(rows)], {
      encoding: "utf8",
      timeout: 180000,
    });
    return Number(String(out).trim()) || 0;
  } catch {
    return 0;
  } finally {
    try { fs.unlinkSync(f); } catch {}
  }
}

// Fill in where people live, for nothing.
//
// The export gives a company and a title and never a location, and location is
// the field every "who do I know in New York" question turns on. Enriching a
// phone number into a profile is billed per record; searching by name is not.
// And because the export already carries each person's LinkedIn URL, the
// search result can be matched on that URL exactly rather than guessed at, so
// the free path has none of the ambiguity that made the paid one attractive.
// Six of six matched on the first run and the credit balance did not move.
//
// RESUMABLE, PER PERSON. A run over two thousand people will be interrupted,
// and a pass that banks everything until the end and then dies has bought
// nothing. Each person is written as they resolve.
function linkedinLocate(flags) {
  const key = clayKey();
  if (!key) die("No Clay key. Put one at ~/.chewbacca/clay-key");
  const d = db();
  const limit = Number(flags.limit || 50);
  // Two sequential HTTP calls per person means a single pass over two thousand
  // people takes about seven hours. The work is entirely network-bound and the
  // requests are independent, so it shards: run this N times with --of N and a
  // different --shard each, and they divide the list with no overlap and no
  // coordination. Writes are per person into WAL-mode SQLite, which handles
  // several writers appending short transactions.
  const of = Math.max(1, Number(flags.of || 1));
  const shard = Math.max(0, Number(flags.shard || 0)) % of;
  // ONE NAMED PERSON IS THE COMMON ASK, and without this the only way to look
  // somebody up was to run the whole backlog and hope they came out in the
  // first --limit rows. An agent handed "find out where Ethan Zhou lives"
  // could not express that, so it went off inventing its own search instead of
  // using the free path that already existed. --who also ignores the
  // location-is-empty filter, because asking for a specific person is asking to
  // look them up again.
  const who = flags.who ? String(flags.who).trim() : "";
  const rows = who
    ? d
        .prepare(
          `SELECT id, name, linkedin FROM people
            WHERE deleted_at IS NULL AND linkedin IS NOT NULL AND linkedin<>''
              AND (id = ? OR name LIKE ? COLLATE NOCASE)
            ORDER BY id`,
        )
        .all(who, `%${who}%`)
        .slice(0, Math.max(1, limit))
    : d
        .prepare(
          `SELECT id, name, linkedin FROM people
            WHERE deleted_at IS NULL AND linkedin IS NOT NULL AND linkedin<>''
              AND (location IS NULL OR location='')
            ORDER BY id`,
        )
        .all()
        .filter((_, i) => i % of === shard)
        .slice(0, limit);

  if (who && !rows.length)
    die(`Nobody called "${who}" has a LinkedIn URL on file, so there is nothing free to match on.`);
  // ONE NAME, ONE PERSON. `--who "Tobias Lund"` used to LIKE-match every row
  // whose name contained it and look all of them up in one run, printing the
  // results as a list with no indication they were different humans. Ten Tobias
  // Larsens come back from Clay and only the URL separates them, so a caller
  // who asked about one and got three has no way to tell which career belongs
  // to the person they are about to write to.
  if (who && rows.length > 1)
    die(
      `"${who}" matches ${rows.length} rows with a LinkedIn URL:\n` +
        rows.map((r) => `  ${r.id}  ${r.name}  ${r.linkedin}`).join("\n") +
        "\nLook one up by id, or merge them first if they are the same person.",
      2,
    );

  const total = d
    .prepare(`SELECT COUNT(*) n FROM people WHERE deleted_at IS NULL AND linkedin IS NOT NULL AND linkedin<>'' AND (location IS NULL OR location='')`)
    .get().n;

  say();
  say(`  ${c.b("Finding where people live")}  ${c.dim(`${total} still without a location`)}`);
  say(c.dim(`  Searching by name and matching on the LinkedIn URL you already have.`));
  say(c.dim(`  Clay bills enrichment, not search, so this costs nothing.`));
  say();

  const norm = (u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
  let found = 0, missed = 0;
  let errors = 0;
  for (const p of rows) {
    let cands;
    try {
      cands = clayCandidates(p.name, 10);
    } catch {
      // Throttled or broken. NOT a miss: the row keeps its NULL location and
      // the next run retries it, which is the whole reason this is resumable.
      errors++;
      continue;
    }
    const mine = norm(p.linkedin);
    const hit = cands.find((x) => norm(x.linkedin) === mine);
    if (hit && (hit.location || hit.experiences.length)) {
      // Everything that came back, not just the city. A blank company on the
      // row is filled from the current job; one already there is left alone,
      // because the export is the user's own data and this is a lookup.
      d.prepare(
        `UPDATE people SET location=COALESCE(NULLIF(?,''), location),
                           company=COALESCE(NULLIF(company,''), NULLIF(?,'')),
                           role=COALESCE(NULLIF(role,''), NULLIF(?,'')),
                           updated_at=datetime('now')
          WHERE id=?`,
      ).run(hit.location, hit.company, hit.role, p.id);

      // The dated history is the part that answers a question about time:
      // who moved up, who joined a company in the last two years.
      if (hit.experiences.length) {
        const career = hit.experiences
          .slice(0, 8)
          .map((e) => `${e.title || "?"} at ${e.company || "?"}${e.from ? ` (${e.from}${e.to ? ` to ${e.to}` : " to now"})` : ""}`)
          .join("; ");
        d.prepare(
          `INSERT INTO quick_facts (person_id, key, value) VALUES (?, 'career', ?)
           ON CONFLICT(person_id, key) DO UPDATE SET value=excluded.value`,
        ).run(p.id, career.slice(0, 1200));
      }
      found++;
      const label = hit.location || (hit.experiences[0] && hit.experiences[0].company) || "";
      say(
        `    ${c.grn(p.name.slice(0, 24).padEnd(26))} ${String(label).slice(0, 34).padEnd(35)} ${c.dim(`${hit.experiences.length} role(s)`)}`,
      );
    } else {
      missed++;
    }
  }
  say();
  say(`  ${c.b(String(found))} located, ${missed} genuinely not in Clay's database.`);
  if (errors)
    say(
      c.yel(`  ${errors} were never looked up: rate limited or failed. They keep a NULL location and retry next run.`),
    );
  if (total > rows.length) say(c.dim(`  ${total - rows.length} still to go. Re-run to continue; finished people are skipped.`));
  say();
}

// WHO REACHED OUT FIRST.
//
// Invitations.csv sits in every LinkedIn export and nothing was reading it. It
// carries a Direction per connection, so it answers a question no other source
// here can: did this person seek him out, or did he seek them. 450 of these
// people wrote first, and that is a different relationship from the 1,589 he
// pursued. It costs nothing, it is already on the disk, and it never changes
// once written, which makes it the cheapest durable fact in the export.
function ingestInvitations(d, files, apply) {
  let written = 0;
  const seen = new Set();
  for (const conns of files) {
    const dir = conns.replace(/Connections\.csv$/, "Invitations.csv");
    if (!fs.existsSync(dir)) continue;
    let rows = [];
    try {
      rows = parseCsvRows(fs.readFileSync(dir, "utf8").replace(/^﻿/, ""));
    } catch {
      continue;
    }
    const head = rows.findIndex((r) => r.includes("Direction"));
    if (head < 0) continue;
    const cols = rows[head];
    const idx = (n) => cols.indexOf(n);
    for (const r of rows.slice(head + 1)) {
      const direction = r[idx("Direction")];
      if (!direction) continue;
      // The other party's name is whichever end is not him.
      const who = direction === "OUTGOING" ? r[idx("To")] : r[idx("From")];
      const when = r[idx("Sent At")] || "";
      if (!who || seen.has(who)) continue;
      seen.add(who);
      const p = d
        .prepare(`SELECT id FROM people WHERE lower(name)=lower(?) AND deleted_at IS NULL`)
        .get(who.trim());
      if (!p) continue;
      const value =
        direction === "INCOMING"
          ? `they sent the connection request${when ? ` (${when})` : ""}`
          : `he sent the connection request${when ? ` (${when})` : ""}`;
      if (apply)
        d.prepare(
          `INSERT INTO quick_facts (person_id, key, value) VALUES (?, 'first_move', ?)
           ON CONFLICT(person_id, key) DO UPDATE SET value=excluded.value`,
        ).run(p.id, value);
      written++;
    }
  }
  return written;
}

function linkedinChanges(changes, flags) {
  const limit = Number(flags.limit || 30);
  say();
  say(`  ${c.b("Job changes")}  ${c.dim(`${changes.length} found across your exports, at no cost`)}`);
  say();
  for (const ch of changes.slice(0, limit)) {
    say(`    ${c.b(ch.name)}`);
    say(`      ${c.dim(ch.from.slice(0, 44))} ${c.dim("->")} ${c.cyn(ch.to.slice(0, 44))}`);
  }
  if (changes.length > limit) say(c.dim(`    ... and ${changes.length - limit} more`));
  say();
  say(c.dim(`  Re-export LinkedIn and re-run to pick up the next batch.`));
  say();
}

// Everyone in the address book with no LinkedIn record, ordered by how much
// you actually talk to them.
//
// Alphabetical would be useless: the question behind this list is "who do I
// know well and have no professional record for", and the answer has to put
// the person you text every day above a landline from 2019. Messages sent is
// the right measure rather than messages total, because what you sent is a
// thing you chose.
function linkedinAudit(m, flags = {}) {
  const d = db();
  const limit = Number(flags.limit || 40);
  const counts = new Map();
  for (const r of d
    .prepare(
      `SELECT who, SUM(CASE WHEN from_me=1 THEN 1 ELSE 0 END) sent,
              SUM(CASE WHEN from_me=0 THEN 1 ELSE 0 END) recvd, COUNT(*) n
         FROM messages GROUP BY who`,
    )
    .all())
    counts.set(String(r.who || "").toLowerCase(), r);

  const scored = m.absent
    .filter((x) => x.first)
    .map((ct) => {
      const full = `${ct.first} ${ct.last}`.replace(/\s+/g, " ").trim().toLowerCase();
      let best = counts.get(full);
      if (!best)
        for (const [k, v] of counts)
          if (k.includes(ct.first.toLowerCase()) && (!ct.last || k.includes(nameWords(ct.last)[0] || ""))) {
            best = v;
            break;
          }
      return { ct, sent: best ? best.sent : 0, recvd: best ? best.recvd : 0 };
    })
    .sort((a, b) => b.sent - a.sent);

  const talk = scored.filter((x) => x.sent > 0);
  say();
  say(`  ${c.b("In your contacts, not on your LinkedIn")}  ${c.dim(`${m.absent.length} people`)}`);
  say(`  ${c.dim("Ranked by how many messages you have sent them.")}`);
  say();
  for (const { ct, sent, recvd } of scored.slice(0, limit)) {
    const name = `${ct.first} ${ct.last}`.replace(/\s+/g, " ").trim();
    const bar = sent > 0 ? c.cyn(String(sent).padStart(5)) : c.dim("    0");
    say(`   ${bar} sent ${c.dim(String(recvd).padStart(5) + " recvd")}   ${name.slice(0, 40)}`);
  }
  if (scored.length > limit) say(c.dim(`\n    ... and ${scored.length - limit} more`));
  say();
  say(
    c.dim(
      `  ${talk.length} of these you have actually texted. The rest are numbers you kept.`,
    ),
  );
  say(
    `  ${c.b(String(m.firstOnly.length))} more are a first name only, so no name match is possible. ${c.dim("Clay resolves those from a phone number.")}`,
  );
  say();
}

// The handoff to Clay. Karthik's shape, so the same payload that proves the
// workbook works is the one the API takes later without a rewrite.
function linkedinClay(m, flags) {
  const limit = Number(flags.limit || 5);
  // E.164 or the lookup misses. "(415) 555-0137" and "+14155550137" are the
  // same number and match nothing as strings, and this is the exact shape of
  // the bug that once left 206 people in this store attributed to nobody: a
  // normalizer that looked like it ran and silently did nothing.
  const e164 = (raw) => {
    const digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;
    if (String(raw).trim().startsWith("+")) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
    return `+${digits}`;
  };
  // Only contacts that carry a phone. Clay resolves a number to a profile; a
  // bare first name resolves to nobody and would spend a credit proving it.
  // A shortcode is not a person. "Golfwang Updates" on +37077 is a broadcast
  // sender, and enriching it spends a credit to learn that. Anything under ten
  // digits is not a dialable personal number anywhere.
  const eligible = [...m.firstOnly, ...m.absent]
    .map((ct) => ({
      ...ct,
      phones: ct.phones.map(e164).filter((p) => p && p.replace(/\D/g, "").length >= 10),
    }))
    .filter((ct) => ct.phones.length);
  const rows = eligible.slice(0, limit).map((ct) => ({
    amber_contact_id: null,
    full_name: `${ct.first} ${ct.last}`.replace(/\s+/g, " ").trim() || ct.first,
    first_name: ct.first || null,
    last_name: ct.last || null,
    email: ct.emails[0] || null,
    emails_all: ct.emails.length > 1 ? ct.emails.join(", ") : null,
    phone: ct.phones[0],
    phones_all: ct.phones.length > 1 ? ct.phones.join(", ") : null,
    company: ct.org || null,
    title: ct.title || null,
    location: null,
    linkedin_url: null,
    source: "chewbacca",
    pushed_from: "amber",
  }));
  say(JSON.stringify(rows, null, 2));
  say();
  say(c.dim(`  ${rows.length} of ${eligible.length} enrichable contacts (have a phone, no LinkedIn).`));
  say(c.dim(`  Amber's clay-webhook row shape, so the API swap is a no-op later.`));
  say(c.dim(`  POST to $CLAY_WEBHOOK_URL. Location is what comes back, and location`));
  say(c.dim(`  is what four of the five demo questions need.`));
  say();
}

module.exports = {
  cmdLinkedin,
};
