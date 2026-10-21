/**
 * FILES OTHER PEOPLE EXPORTED.
 *
 * Every assertion here is a shape a real export actually has, and most of them
 * are things a naive parser gets wrong in a way that quietly corrupts an
 * address book rather than failing:
 *
 *   - Apple folds long lines, so splitting on newlines truncates emails
 *   - Outlook quoted-printable-encodes any name with an accent in it
 *   - a job title of "Director, Partnerships" breaks comma-splitting
 *   - LinkedIn puts three lines of preamble above its header row
 *   - "Tiwari;Sagar" is family-then-given, and reversing it renames everybody
 *
 * Run with:  node --test src/lib/contact-files.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  unfold,
  parseLine,
  parseVCard,
  parseCsv,
  parseContactCsv,
  detectFormat,
  parseContactFile,
} from "./contact-files.js";

// ── vCard ──────────────────────────────────────────────────────────────────

test("FOLDED LINES ARE REJOINED, or every long email is truncated", () => {
  const folded = "EMAIL:averylongaddress\r\n @example.com";
  assert.equal(unfold(folded), "EMAIL:averylongaddress@example.com");
});

test("a tab continuation folds too, because some exporters use one", () => {
  assert.equal(unfold("A:one\n\ttwo"), "A:onetwo");
});

test("Apple's item grouping is stripped from the property name", () => {
  const p = parseLine("ITEM1.TEL;TYPE=CELL:+15550001111");
  assert.equal(p.name, "TEL");
  assert.deepEqual(p.params.TYPE, ["CELL"]);
  assert.equal(p.value, "+15550001111");
});

test("a legacy bare type parameter parses", () => {
  const p = parseLine("TEL;CELL:+15550001111");
  assert.deepEqual(p.params.TYPE, ["CELL"]);
});

test("a colon inside a quoted parameter does not end the parameters", () => {
  const p = parseLine('X-ABLabel;VALUE="a:b":hello');
  assert.equal(p.value, "hello");
});

const VCARD = `BEGIN:VCARD
VERSION:3.0
N:Tiwari;Sagar;;;
FN:Sagar Tiwari
ORG:Rytual Health;Product
TITLE:Chief Executive
TEL;TYPE=CELL:+1 555 000 1111
TEL;TYPE=HOME:+1 555 000 2222
EMAIL;TYPE=WORK:sagar@rytual.com
EMAIL;TYPE=HOME:s.tiwari@gmail.com
ADR;TYPE=WORK:;;1 Main St;Chicago;IL;60601;USA
URL:https://www.linkedin.com/in/sagartiwari
UID:abc-123
END:VCARD`;

test("a whole card comes back in the shape the resolver takes", () => {
  const [c] = parseVCard(VCARD);
  assert.equal(c.fullName, "Sagar Tiwari");
  assert.equal(c.firstName, "Sagar");
  assert.equal(c.lastName, "Tiwari");
  assert.deepEqual(c.phones, ["+1 555 000 1111", "+1 555 000 2222"]);
  assert.deepEqual(c.emails, ["sagar@rytual.com", "s.tiwari@gmail.com"]);
  assert.equal(c.company, "Rytual Health");
  assert.equal(c.title, "Chief Executive");
  assert.equal(c.city, "Chicago");
  assert.equal(c.linkedinUrl, "https://www.linkedin.com/in/sagartiwari");
  assert.equal(c.externalId, "vcard:abc-123");
});

test("N IS FAMILY-THEN-GIVEN, and reversing it renames everybody", () => {
  const [c] = parseVCard("BEGIN:VCARD\nN:Park;Shirley;;;\nEND:VCARD");
  assert.equal(c.firstName, "Shirley");
  assert.equal(c.lastName, "Park");
  assert.equal(c.fullName, "Shirley Park");
});

test("ORG keeps the company and drops the department", () => {
  const [c] = parseVCard("BEGIN:VCARD\nFN:X\nORG:Acme Inc;Sales;West\nEND:VCARD");
  assert.equal(c.company, "Acme Inc");
});

test("several cards in one file are several records", () => {
  const two = `${VCARD}\n${VCARD.replace("Sagar Tiwari", "Shirley Park")}`;
  assert.equal(parseVCard(two).length, 2);
});

test("escaped commas and semicolons come back as characters, not separators", () => {
  const [c] = parseVCard("BEGIN:VCARD\nFN:Smith\\, John\nORG:A\\;B\nEND:VCARD");
  assert.equal(c.fullName, "Smith, John");
  assert.equal(c.company, "A;B");
});

test("QUOTED-PRINTABLE DECODES, which is how Outlook writes any accent", () => {
  const [c] = parseVCard(
    "BEGIN:VCARD\nFN;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa\nEND:VCARD",
  );
  assert.equal(c.fullName, "José García");
});

test("a card with nothing on it is dropped rather than imported as blank", () => {
  assert.deepEqual(parseVCard("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD"), []);
});

test("a card with an address but no name keeps the address as the name", () => {
  const [c] = parseVCard("BEGIN:VCARD\nEMAIL:only@example.com\nEND:VCARD");
  assert.equal(c.fullName, "only@example.com");
  assert.deepEqual(c.emails, ["only@example.com"]);
});

// ── CSV ────────────────────────────────────────────────────────────────────

test('A COMMA INSIDE A QUOTED FIELD IS NOT A SEPARATOR', () => {
  const rows = parseCsv('a,"Director, Partnerships",c');
  assert.deepEqual(rows, [["a", "Director, Partnerships", "c"]]);
});

test("a doubled quote is one literal quote", () => {
  assert.deepEqual(parseCsv('"she said ""hi"""'), [['she said "hi"']]);
});

test("a newline inside a quoted field does not start a row", () => {
  assert.deepEqual(parseCsv('"line one\nline two",x'), [["line one\nline two", "x"]]);
});

const LINKEDIN = `Notes:
"When exporting your connection data, you may notice..."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Sagar,Tiwari,https://www.linkedin.com/in/sagartiwari,sagar@rytual.com,Rytual Health,"Director, Partnerships",01 Jan 2026
Shirley,Park,https://www.linkedin.com/in/shirleypark,,Amber,CPO,02 Jan 2026`;

test("LINKEDIN'S PREAMBLE IS SKIPPED and the real header is found", () => {
  const { records, headerRow } = parseContactCsv(LINKEDIN);
  // Not a fixed index: blank rows are dropped before the header is looked for,
  // so coupling this to the line number in the fixture would make the test
  // fail on a whitespace edit. What matters is that a preamble was skipped and
  // the two real connections came back.
  assert.ok(headerRow > 0, "the header was taken as row zero, preamble and all");
  assert.equal(records.length, 2);
});

test("a LinkedIn row maps onto the resolver's shape", () => {
  const { records } = parseContactCsv(LINKEDIN);
  const [sagar] = records;
  assert.equal(sagar.fullName, "Sagar Tiwari");
  assert.deepEqual(sagar.emails, ["sagar@rytual.com"]);
  assert.equal(sagar.company, "Rytual Health");
  assert.equal(sagar.title, "Director, Partnerships");
  assert.equal(sagar.linkedinUrl, "https://www.linkedin.com/in/sagartiwari");
});

test("a connection with no email is still a contact", () => {
  const { records } = parseContactCsv(LINKEDIN);
  assert.equal(records[1].fullName, "Shirley Park");
  assert.deepEqual(records[1].emails, []);
});

test("alternative header wordings are recognized, because exporters differ", () => {
  const { records } = parseContactCsv(
    "Name,E-mail Address,Mobile Phone,Organization\nAda Reyes,ada@x.com,555-1111,Acme",
  );
  assert.equal(records[0].fullName, "Ada Reyes");
  assert.deepEqual(records[0].emails, ["ada@x.com"]);
  assert.deepEqual(records[0].phones, ["555-1111"]);
  assert.equal(records[0].company, "Acme");
});

test("several addresses in one cell become several addresses", () => {
  const { records } = parseContactCsv("Name,Email\nAda,a@x.com; b@y.com");
  assert.deepEqual(records[0].emails, ["a@x.com", "b@y.com"]);
});

test("a file with no recognizable header says so rather than inventing people", () => {
  const r = parseContactCsv("alpha,beta,gamma\n1,2,3");
  assert.deepEqual(r.records, []);
  assert.equal(r.reason, "no_recognizable_header");
});

test("empty rows are skipped", () => {
  const { records } = parseContactCsv("Name,Email\nAda,a@x.com\n,\n\nBo,b@y.com");
  assert.equal(records.length, 2);
});

// ── format detection ───────────────────────────────────────────────────────

test("the format is sniffed from the bytes, not from the file name", () => {
  assert.equal(detectFormat(VCARD), "vcard");
  assert.equal(detectFormat(LINKEDIN), "csv");
  assert.equal(detectFormat("just some prose with no delimiters"), "unknown");
});

test("one entry point handles either, and refuses what it cannot read", () => {
  assert.equal(parseContactFile(VCARD).records.length, 1);
  assert.equal(parseContactFile(LINKEDIN).records.length, 2);
  const junk = parseContactFile("nothing parseable here");
  assert.deepEqual(junk.records, []);
  assert.equal(junk.reason, "unrecognized_format");
});

test("garbage never throws, because this runs on whatever somebody uploaded", () => {
  for (const input of [null, undefined, "", "\0\0\0", "BEGIN:VCARD", "a".repeat(5000)]) {
    assert.doesNotThrow(() => parseContactFile(input));
  }
});
