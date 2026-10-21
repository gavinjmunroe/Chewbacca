/**
 * vCard 3.0 serializer + parser.
 *
 * RFC 2426 with the line-folding rules that iCloud actually accepts:
 *   - Lines wrapped at 75 octets, continuation lines start with a single space
 *   - CRLF line endings
 *   - UID identifies the record across PUTs (so updates don't create duplicates)
 *
 * Scope: just the fields we care about for dedupe. If someone has an exotic
 * field (PHOTO, GEO, KEY, etc.) we round-trip it as a raw line so we don't
 * drop data on write-back.
 */

import type { UnifiedContact } from "../types/index.ts";

const CRLF = "\r\n";

export interface ParsedVCard {
  uid: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  phones: string[];
  org: string | null;
  title: string | null;
  urls: string[];
  /** Lines we did not recognize, preserved verbatim for round-tripping. */
  passthrough: string[];
}

// ─── Escaping ─────────────────────────────────────────────────────────────────

function escapeValue(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeValue(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Fold long lines at 75 octets with single-space continuation. */
function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let buf = "";
  for (const ch of line) {
    if (Buffer.byteLength(buf + ch, "utf8") > 75) {
      out.push(buf);
      buf = " " + ch;
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out.join(CRLF);
}

/** Unfold continuation lines: a line that starts with a space joins the previous one. */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseVCard(raw: string): ParsedVCard {
  const lines = unfold(raw);
  const result: ParsedVCard = {
    uid: null,
    fullName: null,
    firstName: null,
    lastName: null,
    emails: [],
    phones: [],
    org: null,
    title: null,
    urls: [],
    passthrough: [],
  };

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const head = line.slice(0, colonIdx);
    const value = unescapeValue(line.slice(colonIdx + 1));
    const propName = head.split(";")[0].toUpperCase();

    switch (propName) {
      case "BEGIN":
      case "END":
      case "VERSION":
        break;
      case "UID":
        result.uid = value;
        break;
      case "FN":
        result.fullName = value;
        break;
      case "N": {
        const parts = value.split(";");
        result.lastName = parts[0] || null;
        result.firstName = parts[1] || null;
        break;
      }
      case "EMAIL":
        if (value.trim()) result.emails.push(value.trim());
        break;
      case "TEL":
        if (value.trim()) result.phones.push(value.trim());
        break;
      case "ORG":
        result.org = value.split(";")[0] || null;
        break;
      case "TITLE":
        result.title = value;
        break;
      case "URL":
        if (value.trim()) result.urls.push(value.trim());
        break;
      default:
        result.passthrough.push(line);
        break;
    }
  }

  return result;
}

// ─── Serialize ────────────────────────────────────────────────────────────────

export interface SerializeOptions {
  /** UID to write — if you have an existing one, pass it through to keep identity stable. */
  uid: string;
  /** Lines from a previous parse to preserve verbatim. */
  passthrough?: string[];
}

/**
 * Serialize a UnifiedContact into a vCard 3.0 body.
 *
 * The UID is what iCloud uses to identify the record. On update, send the
 * same UID + If-Match etag. On create, send a new UID.
 */
export function serializeVCard(
  contact: Partial<UnifiedContact>,
  opts: SerializeOptions,
): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  lines.push(`UID:${escapeValue(opts.uid)}`);

  const last = contact.last_name ?? "";
  const first = contact.first_name ?? "";
  lines.push(`N:${escapeValue(last)};${escapeValue(first)};;;`);

  const computed = [first, last].filter(Boolean).join(" ").trim();
  const fn = contact.full_name ?? computed ?? "Unknown";
  lines.push(`FN:${escapeValue(fn || "Unknown")}`);

  if (contact.email) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(contact.email)}`);
  }

  if (contact.phone) {
    lines.push(`TEL;TYPE=CELL:${escapeValue(contact.phone)}`);
  }

  if (contact.current_company) {
    lines.push(`ORG:${escapeValue(contact.current_company)}`);
  }

  if (contact.current_title) {
    lines.push(`TITLE:${escapeValue(contact.current_title)}`);
  }

  if (contact.linkedin_url) {
    lines.push(`URL;TYPE=LinkedIn:${escapeValue(contact.linkedin_url)}`);
  }

  if (contact.linkedin_username) {
    lines.push(
      `X-SOCIALPROFILE;TYPE=linkedin:${escapeValue(
        `https://linkedin.com/in/${contact.linkedin_username}`,
      )}`,
    );
  }
  if (contact.twitter_username) {
    lines.push(
      `X-SOCIALPROFILE;TYPE=twitter:${escapeValue(
        `https://twitter.com/${contact.twitter_username}`,
      )}`,
    );
  }
  if (contact.instagram_username) {
    lines.push(
      `X-SOCIALPROFILE;TYPE=instagram:${escapeValue(
        `https://instagram.com/${contact.instagram_username}`,
      )}`,
    );
  }

  if (opts.passthrough) {
    const reserved = new Set([
      "BEGIN",
      "END",
      "VERSION",
      "UID",
      "FN",
      "N",
      "EMAIL",
      "TEL",
      "ORG",
      "TITLE",
      "URL",
      "X-SOCIALPROFILE",
    ]);
    for (const line of opts.passthrough) {
      const head = line.split(":")[0].split(";")[0].toUpperCase();
      if (!reserved.has(head)) lines.push(line);
    }
  }

  lines.push("END:VCARD");

  return lines.map(foldLine).join(CRLF) + CRLF;
}
