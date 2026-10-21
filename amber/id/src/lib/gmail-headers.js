/**
 * TURNING A MAIL HEADER INTO A RELATIONSHIP FACT.
 *
 * Pure functions, no I/O, no database. Everything that decides whether a
 * message counts, who it counts for, and which direction it went lives here so
 * it can be tested against real header strings rather than against a mock of
 * Gmail.
 *
 * NO BODY EVER REACHES THIS FILE, because no body is ever fetched. The sync
 * asks Gmail for `format=metadata` with a named header list, which is a
 * different API response shape from the one that carries content -- so a bug
 * cannot accidentally persist an email body, since the bytes were never on the
 * wire.
 */

import { classifyRealness } from "./people-rank-realness.js";

/**
 * ADDRESSES THAT ARE NOT PEOPLE.
 *
 * An address book that fills with noreply@, bounces and ticketing robots is
 * worse than one with gaps: every one of them becomes a node in the graph, a
 * row in the ranker, and a candidate the resolver has to consider forever. The
 * local part carries the intent almost every time.
 *
 * Matched as a whole local part or as a prefix before a separator, so
 * `no-reply` and `no-reply-1234` both go, while a real person called
 * `noreplyman@` -- who does not exist, but the rule should still be principled
 * -- does not match on a substring.
 */
const AUTOMATION_LOCAL_PARTS = [
  "noreply", "no-reply", "donotreply", "do-not-reply", "reply",
  "bounce", "bounces", "mailer-daemon", "postmaster", "notifications",
  "notification", "alerts", "alert", "updates", "news", "newsletter",
  "info", "support", "help", "billing", "invoices", "receipts",
  "security", "admin", "hello", "contact", "team", "marketing",
  "unsubscribe", "automated", "auto", "system", "daemon", "bot",
];

const AUTOMATION_SET = new Set(AUTOMATION_LOCAL_PARTS);

/** Strip the angle brackets and whitespace a Message-ID arrives wrapped in. */
export function normalizeMessageId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Peeled rather than regex-matched, so a malformed "<>" comes out empty and
  // is rejected instead of surviving as the literal string "<>" -- which would
  // become a shared dedupe key for every broken message in the mailbox and
  // collapse them all into one.
  let id = s;
  while (id.startsWith("<")) id = id.slice(1);
  while (id.endsWith(">")) id = id.slice(0, -1);
  id = id.trim();
  if (!id || id.length > 998) return null;
  if (id.includes("<") || id.includes(">") || /\s/.test(id)) return null;
  // Case is preserved: RFC 5322 makes the id-left part case-sensitive, and two
  // mailboxes holding the same message hold the same bytes, so folding case
  // would only risk collapsing two genuinely different messages.
  return id;
}

export function normalizeAddress(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s.length > 320) return null;
  // Deliberately permissive: this is not validating an address for sending, it
  // is deciding whether two strings are the same person. One @ and something
  // either side of it is the whole requirement.
  const at = s.indexOf("@");
  if (at <= 0 || at === s.length - 1) return null;
  if (s.includes(" ")) return null;
  return s;
}

/**
 * Parse an RFC 5322 address list into { name, address } pairs.
 *
 * THE COMMA IS THE PROBLEM. `"Tiwari, Sagar" <s@x.com>, ada@y.com` is two
 * addresses, and splitting on commas gives three. Outlook writes display names
 * in exactly that "Last, First" shape constantly, so this is the common case
 * rather than an edge one. Splitting therefore tracks whether it is inside a
 * quoted string or inside angle brackets, and only breaks on a comma that is
 * outside both.
 */
export function parseAddressList(raw) {
  const s = String(raw ?? "");
  if (!s.trim()) return [];

  const parts = [];
  let buf = "";
  let inQuotes = false;
  let inAngles = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== "\\") inQuotes = !inQuotes;
    else if (ch === "<" && !inQuotes) inAngles = true;
    else if (ch === ">" && !inQuotes) inAngles = false;
    if (ch === "," && !inQuotes && !inAngles) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);

  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;

    let name = null;
    let addr = null;
    const angled = /^(.*)<([^<>]+)>\s*$/.exec(piece);
    if (angled) {
      name = angled[1].trim().replace(/^"(.*)"$/, "$1").trim() || null;
      addr = normalizeAddress(angled[2]);
    } else {
      addr = normalizeAddress(piece);
    }
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    out.push({ name: name || null, address: addr });
  }
  return out;
}

/**
 * Is this address a person, or a machine that sends mail?
 *
 * Two independent signals, because either alone misses. The local part catches
 * `noreply@stripe.com`. The realness classifier, which already guards the
 * ranker, catches a display name like "Delivery Subsystem" arriving from an
 * address that looks fine.
 */
export function isPersonAddress(entry) {
  const address = normalizeAddress(entry?.address);
  if (!address) return false;
  const local = address.slice(0, address.indexOf("@"));

  // Three spellings of the same robot, because senders pick one at random:
  //   no-reply           the bare term
  //   no-reply-4821      the term with a queue or campaign number appended
  //   noreply.support    the term followed by a qualifier
  // Trimming the trailing number first is what catches the middle case --
  // splitting on separators alone would leave "no", which is nobody's robot.
  const withoutTrailingNumber = local.replace(/[+._-]?\d+$/, "");
  const head = local.split(/[+._-]/)[0];
  if (
    AUTOMATION_SET.has(local) ||
    AUTOMATION_SET.has(withoutTrailingNumber) ||
    AUTOMATION_SET.has(head)
  ) {
    return false;
  }
  // Mailing lists and ticket robots put the queue id in the local part.
  if (/^[a-z]*\d{6,}$/.test(local)) return false;

  if (entry?.name) {
    const verdict = classifyRealness({ name: entry.name, emails: [address] });
    if (!verdict.isReal) return false;
  }
  return true;
}

/**
 * HEADERS THAT SAY "THIS WAS SENT BY A MACHINE", on the machine's own authority.
 *
 * Far more reliable than guessing from the address, and cheap: every bulk
 * sender sets at least one of these because deliverability depends on it.
 */
export function looksAutomated(headers) {
  const h = lower(headers);
  if (h["list-unsubscribe"] || h["list-id"] || h["list-post"]) return true;
  if (/^(bulk|list|junk)$/i.test(String(h["precedence"] ?? "").trim())) return true;
  const auto = String(h["auto-submitted"] ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (String(h["x-auto-response-suppress"] ?? "").trim()) return true;
  return false;
}

function lower(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[String(k).toLowerCase()] = v;
  return out;
}

/**
 * Turn one message's headers into the record the database wants, or null when
 * the message should not be counted at all.
 *
 * `ownAddresses` is every address the owner sends and receives as, lowercased.
 * It decides direction, and it is also what keeps the owner from becoming a
 * participant on every message they have ever sent -- which would make them the
 * most-contacted person in their own address book.
 */
export function messageFromHeaders(headers, { ownAddresses = [], accountId = null } = {}) {
  const h = lower(headers);
  const messageId = normalizeMessageId(h["message-id"]);
  if (!messageId) return null; // nothing to dedupe on; counting it risks double-counting

  const when = Date.parse(String(h["date"] ?? ""));
  if (!Number.isFinite(when)) return null; // an interaction with no time is not a signal

  if (looksAutomated(h)) return null;

  const mine = new Set(
    (Array.isArray(ownAddresses) ? ownAddresses : [])
      .map((a) => normalizeAddress(a))
      .filter(Boolean),
  );

  const from = parseAddressList(h["from"]);
  const to = parseAddressList(h["to"]);
  const cc = parseAddressList(h["cc"]);

  const sender = from[0] ?? null;
  const direction = sender && mine.has(sender.address) ? "outbound" : "inbound";

  const participants = [];
  const add = (entry, role) => {
    if (!entry) return;
    if (mine.has(entry.address)) return; // never yourself
    if (!isPersonAddress(entry)) return;
    if (participants.some((p) => p.address === entry.address)) return;
    participants.push({ ...entry, role });
  };
  add(sender, "from");
  for (const e of to) add(e, "to");
  for (const e of cc) add(e, "cc");

  // A message with nobody on it but the owner -- a note to self, a receipt
  // already filtered -- is not a relationship signal.
  if (participants.length === 0) return null;

  // A hundred people on a CC line is an announcement, not a conversation, and
  // counting it as contact with all hundred is how a mailing list becomes your
  // closest relationships.
  const MASS_MAIL = 25;
  if (participants.length > MASS_MAIL) return null;

  return {
    messageId,
    threadId: h["x-gm-thrid"] ? String(h["x-gm-thrid"]) : null,
    occurredAt: new Date(when).toISOString(),
    direction,
    accountId,
    participants,
  };
}

export const __testing = { AUTOMATION_LOCAL_PARTS };
