// @ts-nocheck
// people import: contacts from the macOS Contacts app, a vCard file or a
// CSV.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { db, uuid } = require("./db");
const { recomputeScores } = require("./scoring");

// ---------------------------------------------------------------- import

function parseVCards(text) {
  const out = [];
  for (const block of text.split(/BEGIN:VCARD/i).slice(1)) {
    const get = (re) => {
      const m = block.match(re);
      return m ? m[1].trim().replace(/\\,/g, ",").replace(/\\;/g, ";") : null;
    };
    const name =
      get(/^FN[^:]*:(.+)$/im) ||
      (() => {
        const n = get(/^N[^:]*:(.+)$/im);
        if (!n) return null;
        const [last, first] = n.split(";");
        return [first, last].filter(Boolean).join(" ").trim();
      })();
    if (!name) continue;
    const org = get(/^ORG[^:]*:(.+)$/im);
    out.push({
      name,
      email: get(/^EMAIL[^:]*:(.+)$/im),
      phone: get(/^TEL[^:]*:(.+)$/im),
      company: org ? org.split(";")[0].trim() : null,
      role: get(/^TITLE[^:]*:(.+)$/im),
      birthday: get(/^BDAY[^:]*:(.+)$/im),
    });
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return rows;
  const split = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const pick = (r, ...names) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i > -1 && r[i]) return r[i];
    }
    return null;
  };
  for (const line of lines.slice(1)) {
    const r = split(line);
    const name =
      pick(r, "name", "fullname", "displayname") ||
      [pick(r, "firstname", "givenname"), pick(r, "lastname", "surname", "familyname")]
        .filter(Boolean)
        .join(" ");
    if (!name) continue;
    rows.push({
      name,
      email: pick(r, "email", "emailaddress", "email1"),
      phone: pick(r, "phone", "phonenumber", "mobile", "phone1"),
      company: pick(r, "company", "organization", "org"),
      role: pick(r, "role", "title", "jobtitle"),
      birthday: pick(r, "birthday", "bday", "dateofbirth"),
    });
  }
  return rows;
}

function cmdImport(argv) {
  const { flags } = parseArgs(argv);
  let rows = [];
  let label = "";

  if (flags.vcf) {
    rows = parseVCards(fs.readFileSync(String(flags.vcf), "utf8"));
    label = path.basename(String(flags.vcf));
  } else if (flags.csv) {
    rows = parseCsv(fs.readFileSync(String(flags.csv), "utf8"));
    label = path.basename(String(flags.csv));
  } else if (flags.mac) {
    // Chewbacca ships `mac`, which reads the real Contacts app. It has `find`
    // but no "list everything", so sweep the alphabet and dedupe on the card id.
    // Any contact whose name, email or phone contains one alphanumeric is caught.
    const seen = new Map();
    let ok = false;
    for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789") {
      let raw;
      try {
        raw = execFileSync("mac", ["contacts", "find", ch, "--json"], {
          encoding: "utf8",
          maxBuffer: 1 << 28,
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        continue;
      }
      ok = true;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      for (const x of Array.isArray(parsed) ? parsed : []) {
        if (x && x.id && !seen.has(x.id)) seen.set(x.id, x);
      }
    }
    if (!ok)
      die(
        "Could not read Contacts.\n" +
          "  `mac` ships with Chewbacca. Check it with: mac doctor\n" +
          "  Exit code 2 there means macOS needs you to grant Contacts access.\n" +
          "  Or export Contacts to a .vcf and run: people import --vcf FILE",
      );
    rows = [...seen.values()]
      .map((x) => ({
        name: x.name || [x.firstName, x.lastName].filter(Boolean).join(" "),
        email: Array.isArray(x.emails) ? x.emails[0] : x.email || null,
        phone: Array.isArray(x.phones) ? x.phones[0] : x.phone || null,
        company: x.organization || x.company || null,
        role: x.jobTitle || x.title || null,
        birthday: x.birthday || null,
        externalId: x.id || null,
      }))
      .filter((x) => x.name);
    label = "macOS Contacts";
  } else {
    die(
      "people import --mac              read the macOS Contacts app\n" +
        "             --vcf FILE.vcf      a vCard export\n" +
        "             --csv FILE.csv      name,email,phone,company,role",
    );
  }

  if (!rows.length) return say(c.dim(`nothing to import from ${label}`));

  // Contacts exports are not type-clean: an email can arrive as an object, a
  // phone as a number, a field as an empty array. SQLite binds none of those.
  const str = (v) => {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return str(v[0]);
    if (typeof v === "object") return str(v.value ?? v.address ?? v.label ?? null);
    const s = String(v).trim();
    return s ? s : null;
  };
  rows = rows.map((r) => ({
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    company: str(r.company),
    role: str(r.role),
    birthday: str(r.birthday),
    externalId: str(r.externalId),
  })).filter((r) => r.name);

  const d = db();
  const existing = d.prepare("SELECT id, name, email, phone FROM people WHERE deleted_at IS NULL").all();
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
  const byEmail = new Map(existing.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p]));

  let added = 0;
  let merged = 0;
  const limit = flags.limit ? Number(flags.limit) : Infinity;
  for (const r of rows) {
    if (added >= limit) break;
    const hit =
      (r.email && byEmail.get(String(r.email).toLowerCase())) || byName.get(r.name.toLowerCase());
    if (hit) {
      // Fill blanks only. An import must never overwrite something you typed.
      for (const f of ["email", "phone", "company", "role", "birthday"]) {
        if (r[f] && !hit[f]) d.prepare(`UPDATE people SET ${f} = ? WHERE id = ?`).run(r[f], hit.id);
      }
      merged++;
      continue;
    }
    const id = uuid();
    d.prepare(
      `INSERT INTO people (id, name, phone, email, company, role, birthday, source, external_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, r.name, r.phone, r.email, r.company, r.role, r.birthday, "import", r.externalId);
    byName.set(r.name.toLowerCase(), { id, name: r.name });
    added++;
  }
  say(`${c.grn("imported")} ${added} new, ${merged} already known ${c.dim("from " + label)}`);
  if (added) say(c.dim("  imported people have no observations yet; that is what makes them useful"));
  recomputeScores();
}

module.exports = {
  cmdImport,
};
