/**
 * THE HEADERS THAT DECIDE WHO YOU ARE CLOSE TO.
 *
 * Every mistake in this file becomes a wrong relationship. Counting a
 * newsletter makes Stripe one of your closest contacts. Splitting an Outlook
 * display name on its comma invents a person called "Sagar" with no address.
 * Missing the owner's own address makes them the most-contacted person in their
 * own address book. Getting the Message-ID wrong double-counts every thread
 * that lands in two connected mailboxes, which is the exact number this whole
 * feature exists to compute.
 *
 * So these are tested against real header strings rather than a mock of Gmail.
 *
 * Run with:  node --test src/lib/gmail-headers.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeMessageId,
  normalizeAddress,
  parseAddressList,
  isPersonAddress,
  looksAutomated,
  messageFromHeaders,
} from "./gmail-headers.js";

const ME = ["karthik@amber.app", "k@personal.com"];

// ── Message-ID: the cross-account dedupe key ───────────────────────────────

test("angle brackets come off, because every mailbox stores them", () => {
  assert.equal(normalizeMessageId("<CAF=abc123@mail.gmail.com>"), "CAF=abc123@mail.gmail.com");
  assert.equal(normalizeMessageId("  <x@y>  "), "x@y");
});

test("CASE IS PRESERVED, so two different messages never collapse into one", () => {
  assert.equal(normalizeMessageId("<AbC@x>"), "AbC@x");
  assert.notEqual(normalizeMessageId("<AbC@x>"), normalizeMessageId("<abc@x>"));
});

test("a missing or absurd Message-ID is null, not a guess", () => {
  assert.equal(normalizeMessageId(""), null);
  assert.equal(normalizeMessageId(null), null);
  assert.equal(normalizeMessageId("<>"), null);
  assert.equal(normalizeMessageId(`<${"x".repeat(1200)}>`), null);
});

// ── address list parsing ───────────────────────────────────────────────────

test("THE OUTLOOK COMMA: a quoted display name is not two addresses", () => {
  const list = parseAddressList('"Tiwari, Sagar" <sagar@x.com>, ada@y.com');
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "Tiwari, Sagar");
  assert.equal(list[0].address, "sagar@x.com");
  assert.equal(list[1].address, "ada@y.com");
});

test("a comma inside angle brackets does not split either", () => {
  const list = parseAddressList("Ada <ada@y.com>, Bo <bo@z.com>");
  assert.deepEqual(list.map((l) => l.address), ["ada@y.com", "bo@z.com"]);
});

test("a bare address with no display name still parses", () => {
  assert.deepEqual(parseAddressList("solo@x.com"), [{ name: null, address: "solo@x.com" }]);
});

test("addresses are lowercased, so two spellings are one person", () => {
  assert.equal(parseAddressList("Sagar <SAGAR@X.COM>")[0].address, "sagar@x.com");
});

test("the same address twice in one header is one entry", () => {
  assert.equal(parseAddressList("a@x.com, A@X.com").length, 1);
});

test("junk is dropped rather than becoming a contact with no address", () => {
  assert.deepEqual(parseAddressList("not an address, also junk"), []);
  assert.deepEqual(parseAddressList(""), []);
  assert.deepEqual(parseAddressList(null), []);
});

test("normalizeAddress refuses what is not an address", () => {
  assert.equal(normalizeAddress("@x.com"), null);
  assert.equal(normalizeAddress("a@"), null);
  assert.equal(normalizeAddress("a b@x.com"), null);
  assert.equal(normalizeAddress("plainstring"), null);
});

// ── people versus machines ─────────────────────────────────────────────────

test("A ROBOT NEVER BECOMES A CONTACT", () => {
  for (const address of [
    "noreply@stripe.com",
    "no-reply@github.com",
    "no-reply-4821@notifications.example.com",
    "bounces@sendgrid.net",
    "mailer-daemon@google.com",
    "billing@vendor.com",
    "newsletter@substack.com",
  ]) {
    assert.equal(isPersonAddress({ address }), false, `${address} became a contact`);
  }
});

test("a ticket-queue address is not a person", () => {
  assert.equal(isPersonAddress({ address: "ticket849201@support.example.com" }), false);
});

test("real people are kept, including ones with punctuation in the local part", () => {
  for (const address of [
    "sagar@rytual.com",
    "s.tiwari@x.com",
    "karthik+amber@gmail.com",
    "mike-law@realty.com",
  ]) {
    assert.equal(isPersonAddress({ address }), true, `${address} was dropped`);
  }
});

test("a machine display name is caught even when the address looks fine", () => {
  assert.equal(
    isPersonAddress({ address: "svc@example.com", name: "Do Not Reply" }),
    false,
  );
});

// ── headers that admit they are automated ──────────────────────────────────

test("a bulk sender says so, and is believed", () => {
  assert.equal(looksAutomated({ "List-Unsubscribe": "<mailto:x@y>" }), true);
  assert.equal(looksAutomated({ "List-Id": "news.example.com" }), true);
  assert.equal(looksAutomated({ Precedence: "bulk" }), true);
  assert.equal(looksAutomated({ "Auto-Submitted": "auto-generated" }), true);
});

test("auto-submitted: no is a real person following the spec", () => {
  assert.equal(looksAutomated({ "Auto-Submitted": "no" }), false);
});

test("an ordinary message is not automated", () => {
  assert.equal(looksAutomated({ From: "a@b.com", Subject: "lunch?" }), false);
});

// ── the whole record ───────────────────────────────────────────────────────

const base = {
  "Message-ID": "<m1@mail.gmail.com>",
  Date: "Tue, 22 Sep 2026 10:00:00 -0700",
};

test("an inbound message names the sender and the other recipients", () => {
  const m = messageFromHeaders(
    { ...base, From: "Sagar <sagar@x.com>", To: "karthik@amber.app, Ada <ada@y.com>" },
    { ownAddresses: ME },
  );
  assert.equal(m.direction, "inbound");
  assert.equal(m.messageId, "m1@mail.gmail.com");
  assert.deepEqual(
    m.participants.map((p) => p.address),
    ["sagar@x.com", "ada@y.com"],
  );
  assert.equal(m.participants[0].role, "from");
  assert.equal(m.participants[1].role, "to");
});

test("SENDING IS OUTBOUND, which is the stronger signal", () => {
  const m = messageFromHeaders(
    { ...base, From: "karthik@amber.app", To: "sagar@x.com" },
    { ownAddresses: ME },
  );
  assert.equal(m.direction, "outbound");
});

test("ANY of the owner's addresses counts as the owner", () => {
  const m = messageFromHeaders(
    { ...base, From: "k@personal.com", To: "sagar@x.com" },
    { ownAddresses: ME },
  );
  assert.equal(m.direction, "outbound");
});

test("THE OWNER IS NEVER A PARTICIPANT ON THEIR OWN MESSAGES", () => {
  const m = messageFromHeaders(
    { ...base, From: "sagar@x.com", To: "karthik@amber.app", Cc: "k@personal.com" },
    { ownAddresses: ME },
  );
  assert.deepEqual(m.participants.map((p) => p.address), ["sagar@x.com"]);
});

test("cc is kept, and marked as cc rather than as a direct recipient", () => {
  const m = messageFromHeaders(
    { ...base, From: "sagar@x.com", To: "karthik@amber.app", Cc: "Bo <bo@z.com>" },
    { ownAddresses: ME },
  );
  const bo = m.participants.find((p) => p.address === "bo@z.com");
  assert.equal(bo.role, "cc");
});

test("A NEWSLETTER IS NOT A RELATIONSHIP", () => {
  const m = messageFromHeaders(
    {
      ...base,
      From: "Substack <newsletter@substack.com>",
      To: "karthik@amber.app",
      "List-Unsubscribe": "<mailto:u@substack.com>",
    },
    { ownAddresses: ME },
  );
  assert.equal(m, null);
});

test("A HUNDRED PEOPLE ON A CC LINE IS AN ANNOUNCEMENT, not contact with a hundred people", () => {
  const many = Array.from({ length: 40 }, (_, i) => `p${i}@x.com`).join(", ");
  const m = messageFromHeaders(
    { ...base, From: "sagar@x.com", To: "karthik@amber.app", Cc: many },
    { ownAddresses: ME },
  );
  assert.equal(m, null);
});

test("a small group thread IS a relationship, and everyone on it counts", () => {
  const m = messageFromHeaders(
    { ...base, From: "sagar@x.com", To: "karthik@amber.app, ada@y.com, bo@z.com" },
    { ownAddresses: ME },
  );
  assert.equal(m.participants.length, 3);
});

test("a note to yourself is not an interaction", () => {
  const m = messageFromHeaders(
    { ...base, From: "karthik@amber.app", To: "k@personal.com" },
    { ownAddresses: ME },
  );
  assert.equal(m, null);
});

test("no Message-ID means the message is skipped, never counted twice later", () => {
  const m = messageFromHeaders(
    { Date: base.Date, From: "sagar@x.com", To: "karthik@amber.app" },
    { ownAddresses: ME },
  );
  assert.equal(m, null);
});

test("an unparseable Date is skipped: an interaction with no time is no signal", () => {
  const m = messageFromHeaders(
    { ...base, Date: "sometime last week", From: "sagar@x.com", To: "karthik@amber.app" },
    { ownAddresses: ME },
  );
  assert.equal(m, null);
});

test("the timestamp is preserved as an instant, not as the sender's wall clock", () => {
  const m = messageFromHeaders(
    { ...base, From: "sagar@x.com", To: "karthik@amber.app" },
    { ownAddresses: ME },
  );
  assert.equal(m.occurredAt, new Date("2026-09-22T17:00:00.000Z").toISOString());
});

test("header case does not matter, because providers disagree about it", () => {
  const m = messageFromHeaders(
    {
      "message-id": "<m2@x>",
      date: base.Date,
      from: "sagar@x.com",
      to: "karthik@amber.app",
    },
    { ownAddresses: ME },
  );
  assert.equal(m.messageId, "m2@x");
});

test("the account that saw it rides along, so cross-account spread is countable", () => {
  const m = messageFromHeaders(
    { ...base, From: "sagar@x.com", To: "karthik@amber.app" },
    { ownAddresses: ME, accountId: "acct-1" },
  );
  assert.equal(m.accountId, "acct-1");
});

test("no owner addresses at all still parses rather than throwing", () => {
  const m = messageFromHeaders({ ...base, From: "sagar@x.com", To: "ada@y.com" }, {});
  assert.equal(m.direction, "inbound");
  assert.equal(m.participants.length, 2);
});
