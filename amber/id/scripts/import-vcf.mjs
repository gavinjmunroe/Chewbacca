#!/usr/bin/env node
/**
 * One-off seed script: import a vCard 3.0 (.vcf) export into Postgres via the
 * existing POST /v1/me/contacts endpoint, scoped to ONE dev user.
 *
 * NOT an app feature — a manual seed for testing PeopleRank.
 *
 * Usage:
 *   node scripts/import-vcf.mjs <file.vcf> --dry-run   # parse + stats only, no network
 *   node scripts/import-vcf.mjs <file.vcf>             # parse + mint dev token + upload
 *
 * Env:
 *   MEDHA_BASE  (default https://medha-id-production.up.railway.app)
 *   DEV_PHONE   (default +15550100001)  — the test user the contacts seed under
 *
 * Reuses the real write path: POST /v1/me/contacts { contacts: [...] }, which
 * loops upsertContact (dedup on owner_id + external_id) and scopes owner_id to
 * the authed user from the bearer token. We chunk at 150/req (under the 1 MB
 * body limit) and throttle ~500ms (under the 100 req/min rate limit).
 */

import fs from "node:fs";
import crypto from "node:crypto";

const CHUNK_SIZE = 150;
const THROTTLE_MS = 500;

// ── vCard parsing ────────────────────────────────────────────────────────────

/** RFC 6350 line unfolding: a line starting with space/tab continues the prior
 *  line. Must run BEFORE property parsing (folded PHOTO/NOTE span many lines). */
function unfoldLines(raw) {
  const lines = raw.split(/\r\n|\r|\n/);
  const out = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1); // drop the single leading WSP
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Split unfolded lines into per-card arrays (the lines between BEGIN/END). */
function splitCards(unfolded) {
  const cards = [];
  let cur = null;
  for (const line of unfolded) {
    const u = line.trim().toUpperCase();
    if (u === "BEGIN:VCARD") {
      cur = [];
    } else if (u === "END:VCARD") {
      if (cur) cards.push(cur);
      cur = null;
    } else if (cur) {
      cur.push(line);
    }
  }
  return cards;
}

/** Parse one property line into { prop, head, value }. Splits on the FIRST ":"
 *  (values may contain ":", e.g. URLs). Strips item-prefix (item1.EMAIL→EMAIL). */
function parseLine(line) {
  const ci = line.indexOf(":");
  if (ci < 0) return null;
  const head = line.slice(0, ci); // name + params (everything before first ":")
  const value = line.slice(ci + 1);
  let name = head.split(";")[0]; // property name = up to first ";"
  const dot = name.indexOf(".");
  if (dot >= 0) name = name.slice(dot + 1); // drop "item1." group prefix
  return { prop: name.toUpperCase(), head, value };
}

/** vCard value unescaping: \n→newline, \,→",", \;→";", \\→"\". */
function unescapeValue(v) {
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "\\" && i + 1 < v.length) {
      const n = v[++i];
      out += n === "n" || n === "N" ? "\n" : n;
    } else {
      out += c;
    }
  }
  return out;
}

/** Build the POST /v1/me/contacts contact object from one card, or null if no
 *  FN (name is required). Omits empty optional fields. */
function buildContact(card) {
  const phoneNumbers = [];
  const emails = [];
  let name, firstName, lastName, company, title, notes, birthday, website;
  let uid = null;

  for (const line of card) {
    const p = parseLine(line);
    if (!p) continue;
    const { prop, head, value } = p;
    switch (prop) {
      case "FN":
        name = unescapeValue(value).trim();
        break;
      case "N": {
        const parts = value.split(";"); // Family;Given;Middle;Prefix;Suffix
        const family = unescapeValue(parts[0] || "").trim();
        const given = unescapeValue(parts[1] || "").trim();
        if (given) firstName = given;
        if (family) lastName = family;
        break; // middle/prefix/suffix ignored
      }
      case "TEL": {
        const t = value.trim(); // raw; server normalizes to E.164
        if (t) phoneNumbers.push(t);
        break;
      }
      case "EMAIL": {
        const e = value.trim();
        if (e) emails.push(e);
        break;
      }
      case "ORG": {
        const org = unescapeValue(value.split(";")[0] || "").trim(); // "Company;Dept" → Company
        if (org && !company) company = org;
        break;
      }
      case "TITLE": {
        const t = unescapeValue(value).trim();
        if (t && !title) title = t;
        break;
      }
      case "NOTE": {
        const n = unescapeValue(value).trim();
        if (n && !notes) notes = n;
        break;
      }
      case "URL": {
        const u = value.trim();
        if (u && !website) website = u;
        break;
      }
      case "BDAY": {
        if (head.includes("X-APPLE-OMIT-YEAR")) break; // partial date → skip
        const v = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) birthday = v; // only full YYYY-MM-DD
        break;
      }
      case "UID":
        uid = value.trim();
        break;
      default:
        break; // skip PHOTO / PRODID / VERSION / VND-* / X-* / ADR / X-ABLabel
    }
  }

  if (!name) return null; // FN required

  // Stable externalId so re-runs upsert (dedup on owner_id + external_id)
  // instead of duplicating. Prefer the card's UID; else hash identity.
  const externalId = uid
    ? `vcf:${uid}`
    : "vcf:" +
      crypto
        .createHash("sha256")
        .update(`${name}|${phoneNumbers[0] || ""}|${emails[0] || ""}`)
        .digest("hex")
        .slice(0, 24);

  const contact = { externalId, name, source: "apple" };
  if (firstName) contact.firstName = firstName;
  if (lastName) contact.lastName = lastName;
  if (phoneNumbers.length) contact.phoneNumbers = phoneNumbers;
  if (emails.length) contact.emails = emails;
  if (company) contact.company = company;
  if (title) contact.title = title;
  if (notes) contact.notes = notes;
  if (birthday) contact.birthday = birthday;
  if (website) contact.website = website;
  return contact;
}

function parseVcf(raw) {
  const cards = splitCards(unfoldLines(raw));
  const contacts = [];
  let skipped = 0;
  for (const card of cards) {
    const c = buildContact(card);
    if (c) contacts.push(c);
    else skipped++;
  }
  return { totalCards: cards.length, contacts, skipped };
}

// ── upload ───────────────────────────────────────────────────────────────────

async function mintToken(base, phone) {
  const ic = await fetch(`${base}/v1/auth/issue-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const icb = await ic.json().catch(() => ({}));
  if (!ic.ok || !icb.code) {
    throw new Error(`issue-code failed: ${ic.status} ${JSON.stringify(icb)}`);
  }
  const v = await fetch(`${base}/v1/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: icb.code }),
  });
  const vb = await v.json().catch(() => ({}));
  if (!v.ok || !vb.token) {
    throw new Error(`verify failed: ${v.status} ${JSON.stringify(vb)}`);
  }
  return { token: vb.token, personId: vb.person_id };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(base, phone, contacts) {
  console.log(`Minting dev token for ${phone} @ ${base} ...`);
  const { token, personId } = await mintToken(base, phone);
  console.log(`Token minted. person_id=${personId}`);

  const chunks = [];
  for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
    chunks.push(contacts.slice(i, i + CHUNK_SIZE));
  }
  console.log(`Uploading ${contacts.length} contacts in ${chunks.length} chunks of ${CHUNK_SIZE}...`);

  let totalUpserted = 0;
  const failedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    const n = i + 1;
    try {
      const res = await fetch(`${base}/v1/me/contacts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ contacts: chunks[i] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`chunk ${n}/${chunks.length}: FAILED ${res.status} ${body.slice(0, 200)}`);
        failedChunks.push({ chunk: n, status: res.status });
      } else {
        const body = await res.json().catch(() => ({}));
        const upserted = body.upserted ?? (body.contacts ? body.contacts.length : 0);
        totalUpserted += upserted;
        console.log(`chunk ${n}/${chunks.length}: upserted ${upserted}`);
      }
    } catch (err) {
      console.error(`chunk ${n}/${chunks.length}: ERROR ${err.message}`);
      failedChunks.push({ chunk: n, error: err.message });
    }
    if (i < chunks.length - 1) await sleep(THROTTLE_MS);
  }

  console.log(`\nDONE. Total upserted: ${totalUpserted}/${contacts.length}.`);
  if (failedChunks.length) {
    console.log(`Failed chunks (${failedChunks.length}):`, JSON.stringify(failedChunks));
  } else {
    console.log("All chunks succeeded.");
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

function printDryRun({ totalCards, contacts, skipped }) {
  const has = (k) =>
    contacts.filter((c) => {
      const v = c[k];
      return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
    }).length;
  console.log("── DRY RUN (parse only, no network) ──");
  console.log(`total cards (BEGIN/END):   ${totalCards}`);
  console.log(`parsed contacts (have FN): ${contacts.length}`);
  console.log(`skipped (no FN):           ${skipped}`);
  console.log("── field population ──");
  console.log(`name:        ${has("name")}`);
  console.log(`phoneNumbers:${has("phoneNumbers")}`);
  console.log(`emails:      ${has("emails")}`);
  console.log(`company:     ${has("company")}`);
  console.log(`title:       ${has("title")}`);
  console.log(`notes:       ${has("notes")}`);
  console.log(`birthday:    ${has("birthday")}`);
  console.log(`website:     ${has("website")}`);
  console.log(`externalId:  ${has("externalId")} (all should have one)`);
  console.log("\n── first 3 parsed contacts ──");
  console.log(JSON.stringify(contacts.slice(0, 3), null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: node scripts/import-vcf.mjs <file.vcf> [--dry-run]");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(file, "utf8");
  const parsed = parseVcf(raw);

  if (dryRun) {
    printDryRun(parsed);
    return;
  }

  const base = (process.env.MEDHA_BASE || "https://medha-id-production.up.railway.app").replace(/\/+$/, "");
  const phone = process.env.DEV_PHONE || "+15550100001";
  console.log(`Parsed ${parsed.contacts.length} contacts (${parsed.skipped} skipped).`);
  await upload(base, phone, parsed.contacts);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
