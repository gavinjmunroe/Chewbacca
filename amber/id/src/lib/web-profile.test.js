/**
 * The validation rules that stand between a model reading a web page and a value
 * landing in a contact column. Every function under test is pure.
 *
 * Run with:  node --test src/lib/web-profile.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyUrl,
  cleanEmail,
  cleanPhone,
  cleanText,
  normalizeExtracted,
  pickExtras,
  webUrlFields,
  extractProfileFields,
  fetchProfileText,
} from "./web-profile.js";

test("cleanText collapses whitespace and rejects the ways a model says nothing", () => {
  assert.equal(cleanText("  VP   Finance\n"), "VP Finance");
  for (const bad of ["", "   ", "N/A", "n/a", "none", "NULL", "unknown", "not found", "not available", "-", "—", "??"]) {
    assert.equal(cleanText(bad), null, bad);
  }
  assert.equal(cleanText(123), null);
  assert.equal(cleanText("x".repeat(300), 200).length, 200);
});

test("cleanEmail takes a real personal address and refuses the rest", () => {
  assert.equal(cleanEmail("Danielle.Renaldo@Zocdoc.com"), "danielle.renaldo@zocdoc.com");
  // A role inbox belongs to a company, not to this person — storing it in their
  // email column is a wrong value, so it is rejected as a field.
  for (const bad of [
    "info@zocdoc.com",
    "press@acme.io",
    "no-reply@acme.io",
    "careers@acme.io",
    "jane@example.com",
    "someone@linkedin.com",
    "not an email",
    "jane@localhost",
  ]) {
    assert.equal(cleanEmail(bad), null, bad);
  }
});

test("cleanPhone keeps a dialable number and drops placeholders", () => {
  assert.equal(cleanPhone("+1 (310) 555-0100"), "+1 (310) 555-0100");
  assert.equal(cleanPhone("310.555.0100"), "310.555.0100");
  for (const bad of ["555-0100", "2026", "x1234", "0000000000", "1111111111", "1234567890123456789"]) {
    assert.equal(cleanPhone(bad), null, bad);
  }
});

test("classifyUrl routes a link to the column it belongs in", () => {
  assert.equal(classifyUrl("https://www.linkedin.com/in/x"), "linkedin_url");
  assert.equal(classifyUrl("https://uk.linkedin.com/in/x"), "linkedin_url");
  assert.equal(classifyUrl("https://x.com/handle"), "twitter_url");
  assert.equal(classifyUrl("https://twitter.com/handle"), "twitter_url");
  assert.equal(classifyUrl("https://github.com/handle"), "github_url");
  assert.equal(classifyUrl("https://daniellerenaldo.com/about"), "website");
  // A bare host is not an openable link, and a search page is not "their site".
  assert.equal(classifyUrl("linkedin.com/in/x"), null);
  assert.equal(classifyUrl("ftp://a.b/c"), null);
  assert.equal(classifyUrl("https://www.google.com/search?q=x"), null);
  assert.equal(classifyUrl("https://facebook.com/x"), null);
  assert.equal(classifyUrl(null), null);
});

test("webUrlFields puts the saved-from URL in its own slot and fills the others once", () => {
  const out = webUrlFields("https://www.linkedin.com/in/dr", [
    "https://daniellerenaldo.com",
    "https://github.com/dr",
    "https://another-site.com",
    "not a url",
  ]);
  assert.deepEqual(out, {
    linkedin_url: "https://www.linkedin.com/in/dr",
    website: "https://daniellerenaldo.com",
    github_url: "https://github.com/dr",
  });
  // A non-LinkedIn save is that person's website.
  assert.deepEqual(webUrlFields("https://dr.dev/bio"), { website: "https://dr.dev/bio" });
  // The primary wins its slot even when a second LinkedIn URL appears.
  assert.deepEqual(
    webUrlFields("https://linkedin.com/in/real", ["https://linkedin.com/in/other"]),
    { linkedin_url: "https://linkedin.com/in/real" },
  );
});

test("pickExtras drops what the fields already say, dedupes, and caps", () => {
  const extras = pickExtras(
    [
      "VP Finance",            // same as the title we are storing
      "Previously at Oscar Health",
      "previously at oscar health", // duplicate, different case
      "  ",
      "CFA charterholder",
      "Board member at a healthtech nonprofit",
      "Speaks Portuguese",
      "Studied at NYU Stern",
      "Focus on FP&A",
      "One extra too many",
    ],
    { title: "VP Finance", company: "Zocdoc" },
  );
  assert.ok(!extras.includes("VP Finance"));
  assert.equal(extras.length, 6);
  assert.equal(new Set(extras.map((e) => e.toLowerCase())).size, extras.length);
});

test("normalizeExtracted keeps only validated values and rescues a rejected email as a note", () => {
  const out = normalizeExtracted(
    {
      fullName: "Danielle Renaldo",
      title: "VP Finance",
      company: "Zocdoc",
      city: "New York",
      email: "info@zocdoc.com",
      phone: "not a phone",
      links: ["https://daniellerenaldo.com"],
      extras: ["Previously at Oscar Health"],
    },
    { profileUrl: "https://www.linkedin.com/in/dr" },
  );
  assert.equal(out.core.title, "VP Finance");
  assert.equal(out.core.city, "New York");
  // Neither of these is allowed to reach a column.
  assert.equal(out.core.email, null);
  assert.equal(out.core.phone, null);
  // But the address is not thrown away — it becomes an extra.
  assert.ok(out.extras.some((e) => e.includes("info@zocdoc.com")));
  assert.deepEqual(out.links, {
    linkedin_url: "https://www.linkedin.com/in/dr",
    website: "https://daniellerenaldo.com",
  });
});

test("normalizeExtracted survives garbage without throwing", () => {
  for (const junk of [null, undefined, 42, "a string", {}, { links: "nope", extras: 7 }]) {
    const out = normalizeExtracted(junk, { profileUrl: "https://linkedin.com/in/x" });
    assert.deepEqual(out.core.title, null);
    assert.deepEqual(out.extras, []);
    assert.deepEqual(out.links, { linkedin_url: "https://linkedin.com/in/x" });
  }
});

test("extraction is skipped, loudly, when there is no key", async () => {
  const lines = [];
  const out = await extractProfileFields({
    profileUrl: "https://linkedin.com/in/x",
    pageText: "some text",
    apiKey: "",
    log: { warn: (m) => lines.push(String(m)), info: () => {} },
  });
  assert.equal(out, null);
  // A missing key must be visible in the logs, not indistinguishable from
  // "the page had nothing on it".
  assert.ok(lines.join(" ").includes("ANTHROPIC_API_KEY"));
});

test("extraction refuses to run with no page text and no snippet", async () => {
  let called = false;
  const out = await extractProfileFields({
    profileUrl: "https://linkedin.com/in/x",
    name: "Some One",
    apiKey: "k",
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    },
  });
  // This is the guard against inventing a profile for a blocked page: with no
  // material, we do not ask the model at all.
  assert.equal(out, null);
  assert.equal(called, false);
});

test("extraction parses a fenced JSON reply and normalizes it", async () => {
  const out = await extractProfileFields({
    profileUrl: "https://linkedin.com/in/dr",
    pageText: "Danielle Renaldo — VP Finance at Zocdoc. New York.",
    apiKey: "k",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [
          {
            text:
              '```json\n{"fullName":"Danielle Renaldo","title":"VP Finance","company":"Zocdoc",' +
              '"city":"New York","email":null,"phone":null,"links":[],"extras":["CFA charterholder"]}\n```',
          },
        ],
      }),
    }),
  });
  assert.equal(out.core.company, "Zocdoc");
  assert.deepEqual(out.extras, ["CFA charterholder"]);
});

test("extraction returns null on a non-ok response and on unparseable text", async () => {
  const bad = await extractProfileFields({
    profileUrl: "https://linkedin.com/in/x",
    pageText: "text",
    apiKey: "k",
    fetchImpl: async () => ({ ok: false, status: 529 }),
  });
  assert.equal(bad, null);
  const junk = await extractProfileFields({
    profileUrl: "https://linkedin.com/in/x",
    pageText: "text",
    apiKey: "k",
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ text: "sorry, no." }] }) }),
  });
  assert.equal(junk, null);
});

test("fetchProfileText returns empty string rather than throwing when the read fails", async () => {
  assert.equal(await fetchProfileText({ url: "https://a.com", contents: async () => { throw new Error("boom"); } }), "");
  assert.equal(await fetchProfileText({ url: "https://a.com", contents: async () => [] }), "");
  assert.equal(await fetchProfileText({ url: "not-a-url", contents: async () => [{ text: "x" }] }), "");
  assert.equal(
    await fetchProfileText({ url: "https://a.com", contents: async () => [{ text: "  hello  " }] }),
    "hello",
  );
});
