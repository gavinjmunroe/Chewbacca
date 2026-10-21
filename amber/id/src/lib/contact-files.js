/**
 * PARSING A FILE SOMEBODY EXPORTED FROM SOMEWHERE ELSE.
 *
 * vCard from Apple Contacts or an Android export, CSV from LinkedIn, Google
 * Contacts, Outlook, or a spreadsheet somebody typed by hand. Pure functions,
 * no I/O, no database: the whole job here is turning bytes into the same record
 * shape mergeContact already takes, so a file import dedupes exactly the way an
 * Apple sync or a Clay push does rather than having rules of its own.
 *
 * WHY THIS IS NOT A DEPENDENCY. The vCard spec is large and almost none of it
 * matters for a rolodex: this reads N, FN, TEL, EMAIL, ORG, TITLE, ADR and URL
 * and ignores photos, certificates, timezones and the rest. A parser for those
 * seven properties is a hundred lines, handles the two things real files
 * actually break on (line folding and quoted-printable), and adds nothing to
 * the dependency tree of a service that holds people's address books.
 */

/**
 * RFC 6350 line unfolding.
 *
 * A vCard wraps long lines by inserting CRLF followed by a single space or tab,
 * and a naive line-splitter turns one email address into two truncated ones.
 * Every real export from Apple Contacts folds, because photos and long note
 * fields are routine, so this is the first thing that has to happen.
 */
export function unfold(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "");
}

/**
 * Split a vCard property line into name, parameters and value.
 *
 *   ITEM1.TEL;TYPE=CELL;TYPE=VOICE:+1 555 000 1111
 *
 * The grouping prefix ("ITEM1.") is Apple's and carries no meaning here. A
 * colon inside a parameter value is possible in theory and vanishingly rare in
 * exports, so the first unquoted colon ends the parameters.
 */
export function parseLine(line) {
  const raw = String(line ?? "").trim();
  if (!raw) return null;

  let colon = -1;
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  const parts = head.split(";");
  let name = parts[0];
  // Strip Apple's item grouping.
  const dot = name.indexOf(".");
  if (dot !== -1) name = name.slice(dot + 1);

  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) {
      // A bare parameter is a legacy v2.1 type: "TEL;CELL:..."
      params.TYPE = [...(params.TYPE ?? []), p.toUpperCase()];
      continue;
    }
    const k = p.slice(0, eq).toUpperCase();
    const v = p.slice(eq + 1).replace(/^"(.*)"$/, "$1");
    if (k === "TYPE") params.TYPE = [...(params.TYPE ?? []), ...v.split(",").map((t) => t.toUpperCase())];
    else params[k] = v;
  }
  return { name: name.toUpperCase(), params, value };
}

/** Unescape the four characters RFC 6350 escapes in a value. */
const unescape = (v) =>
  String(v ?? "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");

/**
 * Decode quoted-printable, which Outlook still emits for any name with an
 * accent in it.
 *
 * THE BYTES ARE UTF-8, NOT CHARACTERS. `=C3=A9` is two bytes that together mean
 * "é". Turning each into a character with fromCharCode gives "Ã©" -- the classic
 * mojibake, and it would have gone into the database as somebody's actual name.
 * So the escapes are collected as bytes and the whole run is decoded once.
 */
function decodeQP(v) {
  const text = String(v ?? "").replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    const m = /^=([0-9A-F]{2})/i.exec(text.slice(i, i + 3));
    if (m) {
      bytes.push(parseInt(m[1], 16));
      i += 2;
    } else {
      // Anything unescaped is already ASCII in a quoted-printable body.
      bytes.push(text.charCodeAt(i) & 0xff);
    }
  }
  try {
    return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
  } catch {
    return text;
  }
}

/** The value with its encoding undone, but its structure still escaped. */
const rawValueOf = (prop) =>
  prop.params.ENCODING && /quoted-printable/i.test(prop.params.ENCODING)
    ? decodeQP(prop.value)
    : prop.value;

const valueOf = (prop) => unescape(rawValueOf(prop)).trim();

/**
 * Split a structured value (N, ORG, ADR) on its component separator.
 *
 * ON THE RAW VALUE, BEFORE UNESCAPING. A company literally called "A;B" is
 * written `ORG:A\;B`, and unescaping first turns it into a separator -- so the
 * company silently becomes "A". Split on unescaped semicolons, then unescape
 * each component.
 */
function splitStructured(prop) {
  const raw = rawValueOf(prop);
  const parts = [];
  let buf = "";
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "\\") {
      buf += raw[i] + (raw[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (raw[i] === ";") {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += raw[i];
  }
  parts.push(buf);
  return parts.map((x) => unescape(x).trim());
}

/**
 * Parse a .vcf file into contact records.
 *
 * Returns the shape mergeContact takes, so the caller hands these straight to
 * the resolver with no translation of its own.
 */
export function parseVCard(text) {
  const lines = unfold(text).split("\n");
  const out = [];
  let current = null;

  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;

    if (prop.name === "BEGIN" && /vcard/i.test(prop.value)) {
      current = { emails: [], phones: [], names: {} };
      continue;
    }
    if (prop.name === "END") {
      if (current) {
        const rec = finishVCard(current);
        if (rec) out.push(rec);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const v = valueOf(prop);
    if (!v) continue;

    switch (prop.name) {
      case "FN":
        current.fullName = v;
        break;
      case "N": {
        // family;given;additional;prefix;suffix
        const [family, given] = splitStructured(prop);
        current.names = { family: family ?? "", given: given ?? "" };
        break;
      }
      case "TEL":
        current.phones.push(v);
        break;
      case "EMAIL":
        current.emails.push(v);
        break;
      case "ORG":
        // "Company;Department" -- only the company is a rolodex fact.
        current.company = splitStructured(prop)[0] || null;
        break;
      case "TITLE":
        current.title = v;
        break;
      case "ADR": {
        // pobox;ext;street;locality;region;postal;country -- locality is the city
        const city = splitStructured(prop)[3] ?? "";
        if (city && !current.city) current.city = city;
        break;
      }
      case "URL":
        if (/linkedin\.com/i.test(v) && !current.linkedinUrl) current.linkedinUrl = v;
        break;
      case "UID":
        current.uid = v;
        break;
      default:
        break;
    }
  }
  return out;
}

function finishVCard(c) {
  const fullName =
    c.fullName ||
    [c.names?.given, c.names?.family].filter(Boolean).join(" ").trim() ||
    null;
  // A card with no name and no way to reach anybody is not a contact, it is a
  // line of a file. The resolver would refuse it anyway; refusing here means
  // the import can report it rather than silently dropping it.
  if (!fullName && c.emails.length === 0 && c.phones.length === 0) return null;
  return {
    fullName: fullName || c.emails[0] || c.phones[0],
    firstName: c.names?.given || null,
    lastName: c.names?.family || null,
    emails: c.emails,
    phones: c.phones,
    company: c.company ?? null,
    title: c.title ?? null,
    city: c.city ?? null,
    linkedinUrl: c.linkedinUrl ?? null,
    externalId: c.uid ? `vcard:${c.uid}` : null,
  };
}

/**
 * RFC 4180 CSV, which is to say: quoted fields, doubled quotes inside them, and
 * newlines inside quoted fields. Splitting on commas and newlines works until
 * somebody's job title is "Director, Partnerships", which is immediately.
 */
export function parseCsv(text) {
  const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/**
 * LinkedIn's export puts a copyright notice and blank lines above the header
 * row, and has changed the wording of it more than once. So the header is FOUND
 * rather than assumed to be line one: the first row containing a recognizable
 * name column wins.
 */
const HEADER_ALIASES = {
  firstName: ["first name", "firstname", "given name", "first"],
  lastName: ["last name", "lastname", "surname", "family name", "last"],
  fullName: ["name", "full name", "display name", "contact name"],
  email: ["email address", "email", "e-mail address", "e-mail", "primary email", "emails"],
  phone: ["phone number", "phone", "mobile", "mobile phone", "phone numbers", "primary phone"],
  company: ["company", "organization", "organisation", "current company", "employer"],
  title: ["position", "title", "job title", "current position", "role"],
  city: ["city", "location", "locality"],
  linkedinUrl: ["url", "profile url", "linkedin url", "public profile url", "linkedin"],
};

function headerIndex(row) {
  const cells = row.map((c) => String(c).trim().toLowerCase());
  const idx = {};
  for (const [field, names] of Object.entries(HEADER_ALIASES)) {
    const at = cells.findIndex((c) => names.includes(c));
    if (at !== -1) idx[field] = at;
  }
  return idx;
}

export function parseContactCsv(text) {
  const rows = parseCsv(text);
  let headerAt = -1;
  let idx = {};
  // Scan the first few rows: LinkedIn's preamble is three lines, and a file
  // whose header is further down than that is not a contact export.
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const candidate = headerIndex(rows[i]);
    if (candidate.firstName != null || candidate.fullName != null || candidate.email != null) {
      headerAt = i;
      idx = candidate;
      break;
    }
  }
  if (headerAt === -1) return { records: [], columns: {}, reason: "no_recognizable_header" };

  const cell = (row, at) => (at == null ? null : String(row[at] ?? "").trim() || null);
  const records = [];
  for (const row of rows.slice(headerAt + 1)) {
    const first = cell(row, idx.firstName);
    const last = cell(row, idx.lastName);
    const full = cell(row, idx.fullName) || [first, last].filter(Boolean).join(" ").trim() || null;
    // Some exports put several addresses in one cell, separated by semicolons.
    const emails = (cell(row, idx.email) ?? "").split(/[;,]/).map((e) => e.trim()).filter(Boolean);
    const phones = (cell(row, idx.phone) ?? "").split(/[;]/).map((e) => e.trim()).filter(Boolean);
    if (!full && emails.length === 0 && phones.length === 0) continue;
    records.push({
      fullName: full || emails[0] || phones[0],
      firstName: first,
      lastName: last,
      emails,
      phones,
      company: cell(row, idx.company),
      title: cell(row, idx.title),
      city: cell(row, idx.city),
      linkedinUrl: cell(row, idx.linkedinUrl),
      externalId: null,
    });
  }
  return { records, columns: idx, headerRow: headerAt };
}

/** Sniff the format so a caller does not have to trust a file extension. */
export function detectFormat(text) {
  const head = String(text ?? "").slice(0, 2000);
  if (/^\s*BEGIN:VCARD/im.test(head)) return "vcard";
  if (head.includes(",") || head.includes("\t")) return "csv";
  return "unknown";
}

/** One entry point: take a file's text, get records the resolver understands. */
export function parseContactFile(text) {
  const format = detectFormat(text);
  if (format === "vcard") return { format, records: parseVCard(text) };
  if (format === "csv") {
    const r = parseContactCsv(text);
    return { format, records: r.records, columns: r.columns, reason: r.reason };
  }
  return { format, records: [], reason: "unrecognized_format" };
}
