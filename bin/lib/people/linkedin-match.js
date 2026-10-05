// @ts-nocheck
// people LinkedIn and Contacts matching: reading LinkedIn exports and the
// Apple Contacts database, and pairing rows only when the match is safe.

"use strict";

const fs = require("node:fs");
const { DatabaseSync } = require("./db");

// ---------------------------------------------------------------- linkedin
//
// Match a LinkedIn export against Apple Contacts, and carry what LinkedIn
// knows back onto the contact card.
//
// The direction matters. A LinkedIn export already lives in `people` on this
// machine; what it has never reached is Contacts.app, which is the thing that
// syncs to a phone and is what actually shows up when somebody rings. So the
// job is not "import LinkedIn" a second time, it is to put a company and a
// title on the 1,100 cards that are a bare name and a number.
//
// WHAT THIS REFUSES TO DO. It will not invent an identity. Two people called
// Wilson, one saved as Drew and one listed as Andy, are not known to be the
// same person just because both names shorten from Andrew. A wrong merge here
// is invisible forever: every later message, score and reminder inherits it
// and nothing ever prompts anyone to doubt it. So matches come in tiers and
// only the safe ones are written.
const NICKNAMES = {
  bob: "robert", rob: "robert", bobby: "robert", bill: "william", will: "william",
  billy: "william", rick: "richard", rich: "richard", dick: "richard",
  jim: "james", jimmy: "james", jack: "john", johnny: "john", mike: "michael",
  mick: "michael", tom: "thomas", tommy: "thomas", ed: "edward", eddie: "edward",
  ted: "edward", tony: "anthony", charlie: "charles", chuck: "charles",
  harry: "henry", hank: "henry", kate: "katherine", katie: "katherine",
  kathy: "katherine", cathy: "catherine", beth: "elizabeth", liz: "elizabeth",
  betty: "elizabeth", sue: "susan", susie: "susan", patty: "patricia",
  pat: "patricia", becky: "rebecca", jen: "jennifer", jenny: "jennifer",
  dan: "daniel", danny: "daniel", dave: "david", steve: "steven",
  stevie: "steven", joe: "joseph", joey: "joseph", sam: "samuel",
  sammy: "samuel", alex: "alexander", nick: "nicholas", matt: "matthew",
  ben: "benjamin", andy: "andrew", drew: "andrew", greg: "gregory",
  jeff: "jeffrey", ken: "kenneth", larry: "lawrence", tim: "timothy",
  ron: "ronald", don: "donald", jerry: "gerald", nate: "nathan",
  zach: "zachary", josh: "joshua", chris: "christopher", phil: "philip",
  gabe: "gabriel", manny: "manuel", vince: "vincent", ray: "raymond",
};
const formalOf = (n) => NICKNAMES[n.toLowerCase()] || n.toLowerCase();

function nameWords(s) {
  return (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|phd|md|mba)\b/g, "")
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// One edit apart, and no further. Anything looser matches unrelated names.
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    prev = cur;
  }
  return prev[b.length] === 1;
}

// Contacts.app keeps its records in a SQLite file per account. Reading it
// directly is the difference between a second and ten minutes: the scriptable
// interface costs one Apple Event per property, and a few thousand contacts
// times a dozen properties is tens of thousands of IPC round trips. Opened
// read-only, because this is the user's live address book.
function appleContacts() {
  const base = `${process.env.HOME}/Library/Application Support/AddressBook/Sources`;
  let dirs = [];
  try {
    dirs = fs.readdirSync(base).map((d) => `${base}/${d}/AddressBook-v22.abcddb`);
  } catch {
    return null; // no Contacts database: not an error, just nothing to sync
  }
  const out = [];
  for (const f of dirs) {
    if (!fs.existsSync(f)) continue;
    let d;
    try {
      d = new DatabaseSync(`file:${f}?mode=ro`, { readOnly: true });
    } catch {
      continue;
    }
    try {
      const rows = d
        .prepare(
          `SELECT Z_PK, ZUNIQUEID, ZFIRSTNAME, ZLASTNAME, ZNICKNAME, ZORGANIZATION, ZJOBTITLE
             FROM ZABCDRECORD
            WHERE ZFIRSTNAME IS NOT NULL OR ZLASTNAME IS NOT NULL`,
        )
        .all();
      // The phone is the whole point of the Clay handoff: the enrichment being
      // paid for is number -> LinkedIn profile, and a first name on its own
      // resolves to nobody. Fetched in one pass and grouped, rather than a
      // query per contact.
      const phones = new Map(), emails = new Map();
      for (const t of [
        ["ZABCDPHONENUMBER", phones],
        ["ZABCDEMAILADDRESS", emails],
      ]) {
        try {
          for (const p of d.prepare(`SELECT ZOWNER, ZFULLNUMBER AS v FROM ${t[0]}`).all()) {
            if (!p.v) continue;
            if (!t[1].has(p.ZOWNER)) t[1].set(p.ZOWNER, []);
            t[1].get(p.ZOWNER).push(String(p.v).trim());
          }
        } catch {
          try {
            for (const p of d.prepare(`SELECT ZOWNER, ZADDRESS AS v FROM ${t[0]}`).all()) {
              if (!p.v) continue;
              if (!t[1].has(p.ZOWNER)) t[1].set(p.ZOWNER, []);
              t[1].get(p.ZOWNER).push(String(p.v).trim());
            }
          } catch {
            /* a source without that table contributes nothing */
          }
        }
      }
      for (const r of rows)
        out.push({
          phones: phones.get(r.Z_PK) || [],
          emails: emails.get(r.Z_PK) || [],
          pk: r.Z_PK,
          // The id Contacts itself uses, "<UUID>:ABPerson". The integer primary
          // key is private to this file and means nothing to the app, so the
          // write path needs this one.
          uid: r.ZUNIQUEID || "",
          first: r.ZFIRSTNAME || "",
          last: r.ZLASTNAME || "",
          nick: r.ZNICKNAME || "",
          org: r.ZORGANIZATION || "",
          title: r.ZJOBTITLE || "",
        });
    } catch {
      /* a source that will not read is skipped, not fatal */
    }
    d.close();
  }
  return out;
}

// LinkedIn puts a paragraph of notes above the real header row, so the parser
// finds the header rather than assuming line 1.
function readLinkedInCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = parseCsvRows(text);
  const head = rows.findIndex((r) => r[0] === "First Name");
  if (head < 0) return [];
  const cols = rows[head];
  return rows
    .slice(head + 1)
    .filter((r) => r.length >= cols.length - 1 && (r[0] || r[1]))
    .map((r) => Object.fromEntries(cols.map((k, i) => [k, (r[i] || "").trim()])));
}

// A CSV reader that respects quotes AND newlines inside them. Named apart from
// parseCsv below on purpose: that one is line-oriented and keyed by a header on
// line 1, which is right for a vCard-ish import and wrong for a LinkedIn export
// whose first three lines are a quoted disclaimer. Two functions with one name
// is a silent shadow, and this one lost it.
function parseCsvRows(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// EVERY export, oldest first, not just the newest.
//
// Two reasons. 56 people in the June file are missing from September: a
// connection that ends, or a profile whose URL changed, disappears from the
// current export and taking only the latest silently forgets them. And the
// Company column moving between two exports IS a job change, which is the
// thing Clay would otherwise be paid to discover. 551 of them sit in files
// already on this disk.
function allExports() {
  const dl = `${process.env.HOME}/Downloads`;
  const found = [];
  let entries = [];
  try { entries = fs.readdirSync(dl); } catch { return found; }
  for (const e of entries) {
    const f = `${dl}/${e}/Connections.csv`;
    if (fs.existsSync(f)) found.push({ file: f, at: fs.statSync(f).mtimeMs });
  }
  return found.sort((a, b) => a.at - b.at).map((x) => x.file);
}

// Merge them into one record per profile URL, newest winning, and keep what
// the older files said about where somebody used to work.
function mergeExports(files) {
  const byUrl = new Map();
  const changes = [];
  let seq = 0;
  for (const f of files) {
    for (const r of readLinkedInCsv(f)) {
      const url = (r.URL || "").trim().replace(/\/+$/, "");
      const key = url || `${r["First Name"]} ${r["Last Name"]}`.toLowerCase();
      const prev = byUrl.get(key);
      if (prev && prev.Company && r.Company && prev.Company.trim() !== r.Company.trim()) {
        changes.push({
          name: `${r["First Name"]} ${r["Last Name"]}`.replace(/\s+/g, " ").trim(),
          from: prev.Company.trim(),
          to: r.Company.trim(),
          role: r.Position || "",
          url,
        });
      }
      // The newer file wins field by field, so a blank in September does not
      // erase a company June knew about.
      const merged = prev ? { ...prev, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) } : { ...r };
      merged._seq = seq;
      byUrl.set(key, merged);
    }
    seq++;
  }

  // ONE PERSON, ONE ENTRY, EVEN WHEN THEY RENAMED THEIR PROFILE.
  //
  // Keying on URL alone splits a member who edits their vanity URL into two
  // connections, because the old file and the new file disagree about a field
  // the member controls. Tobias Lund did exactly that between June and
  // September and became two people, one holding his internship and one
  // holding his job.
  //
  // "Connected On" is the one field here that nobody can edit: LinkedIn stamps
  // it when the connection is accepted and it is identical in every export
  // forever. Name plus that date collapses the pair, and the entry from the
  // newest file wins so the current URL and the current employer survive. Two
  // strangers of the same name who connected on the same day would collide, so
  // that case is left split rather than guessed at.
  const byConn = new Map();
  for (const r of byUrl.values()) {
    const on = (r["Connected On"] || "").trim();
    const nm = `${r["First Name"]} ${r["Last Name"]}`.replace(/\s+/g, " ").trim().toLowerCase();
    if (!on || !nm) continue;
    const k = `${nm}|${on.toLowerCase()}`;
    const prev = byConn.get(k);
    byConn.set(k, prev === null ? null : prev && prev.length ? [...prev, r] : [r]);
  }
  const dropped = new Set();
  for (const group of byConn.values()) {
    if (!group || group.length < 2) continue;
    const urls = new Set(group.map((g) => (g.URL || "").trim().replace(/\/+$/, "")));
    if (urls.size < 2) continue;
    const newest = group.reduce((a, b) => (b._seq >= a._seq ? b : a));
    for (const g of group) {
      if (g === newest) continue;
      dropped.add(g);
      // The older entry still knows where they used to work. Keep that, drop
      // the stale URL.
      for (const [k2, v] of Object.entries(g)) if (v && !newest[k2]) newest[k2] = v;
    }
  }

  const out = [...byUrl.values()].filter((r) => !dropped.has(r));
  for (const r of out) delete r._seq;
  return { conns: out, changes };
}

// Tiered matching. `exact` and `nickname` are written; `unsure` is printed and
// left alone, because the cost of a wrong identity is permanent and the cost
// of a missed one is that somebody types it in.
function matchContacts(contacts, conns) {
  const byLast = new Map();
  const lastFreq = new Map();
  for (const c of conns) {
    const ln = nameWords(c["Last Name"]);
    if (!ln.length) continue;
    const k = ln[ln.length - 1];
    if (!byLast.has(k)) byLast.set(k, []);
    byLast.get(k).push(c);
    lastFreq.set(k, (lastFreq.get(k) || 0) + 1);
  }

  const exact = [], nickname = [], unsure = [], firstOnly = [], absent = [];
  for (const ct of contacts) {
    const fn = nameWords(ct.first), ln = nameWords(ct.last);
    if (!ln.length) { firstOnly.push(ct); continue; }
    if (!fn.length) { absent.push(ct); continue; }
    const cf = fn[0];
    // THE SURNAME IS NOT ALWAYS THE LAST WORD. A third of this address book
    // carries context in the name field: "Owen Marsh IYA", "Arcadia FCA
    // Prez", "Benitez Suitemate". Those labels are how somebody recognises a
    // caller, so they are never edited, but reading only the final word makes
    // Leo Hart's surname "IYA" and loses the match. Every word is a
    // candidate, and the one that hits is remembered so the remainder can be
    // kept as what it actually is: how they are known.
    const cands = [];
    const seen = new Set();
    for (const w of ln) {
      for (const c of byLast.get(w) || []) {
        const k = c.URL || `${c["First Name"]} ${c["Last Name"]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        cands.push([c, w]);
      }
    }
    if (!cands.length) { absent.push(ct); continue; }

    let hit = null, tier = null, usedSurname = null;
    for (const [c, w] of cands) {
      const lw = nameWords(c["First Name"]);
      if (lw.length && lw[0] === cf) { hit = c; tier = "exact"; usedSurname = w; break; }
    }
    if (!hit) {
      for (const [c, w] of cands) {
        const lw = nameWords(c["First Name"]);
        if (!lw.length) continue;
        const lf = lw[0];
        // Only nickname-to-formal, never nickname-to-nickname. Drew and Andy
        // both shorten from Andrew and are routinely different people.
        if (lf !== cf && (lf === formalOf(cf) || cf === formalOf(lf))) { hit = c; tier = "nickname"; usedSurname = w; break; }
        // Sam -> Samuel. A prefix of three or more is the same name spelled out.
        if (cf.length >= 3 && lf.startsWith(cf) && lf !== cf) { hit = c; tier = "nickname"; usedSurname = w; break; }
        // A single typo, and only where the surname is rare enough that the
        // pair is very unlikely to be two different people.
        if (oneEdit(cf, lf) && (lastFreq.get(w) || 0) <= 2) { hit = c; tier = "unsure"; usedSurname = w; break; }
      }
    }
    // Whatever was in the name field and is not the surname is how this person
    // is known: the club, the trip, the dorm. Kept, never deleted.
    //
    // Taken from the ORIGINAL text, not the normalised words. Normalising
    // strips case and digits, which turns "A2F" into "a f" and "Superman IYA"
    // into lowercase. Those strings are names of real things, and a label the
    // user wrote is worth preserving exactly or not at all.
    if (hit)
      ct.context = ct.last
        .split(/\s+/)
        .filter((w) => nameWords(w)[0] !== usedSurname)
        .join(" ")
        .trim();
    if (!hit) absent.push(ct);
    else if (tier === "exact") exact.push([ct, hit]);
    else if (tier === "nickname") nickname.push([ct, hit]);
    else unsure.push([ct, hit]);
  }
  return { exact, nickname, unsure, firstOnly, absent };
}

module.exports = {
  nameWords, appleContacts, parseCsvRows, allExports, mergeExports, matchContacts,
};
