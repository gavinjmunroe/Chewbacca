/**
 * WHAT SOMEBODY ACTUALLY DROPS ON THE DROPZONE, AND THE RULE THAT EVERY PART
 * OF IT COMES THROUGH.
 *
 * Not "a Claude export". A folder of skills, an Obsidian vault, an artifact
 * they built and use every day, an export, or -- usually -- several of those
 * in one archive. The first version returned the first shape it recognized
 * and silently dropped the rest, which looked like a working import with a
 * low number. These tests exist mostly to hold that line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readExportBuffer, titleFromMarkdown, titleFromHtml, fileTitle, folderName } from "./ai-export.js";

const AdmZip = createRequire(import.meta.url)("adm-zip");
const long = (s) => s + "x".repeat(Math.max(0, 90 - s.length));

test("one archive holding several kinds yields all of them", () => {
  const z = new AdmZip();
  z.addFile(
    "projects/abc.json",
    Buffer.from(JSON.stringify({ uuid: "abc", name: "Clay Outbound", docs: [], prompt_template: "x".repeat(60) })),
  );
  z.addFile("skills/cold-outreach/SKILL.md", Buffer.from("---\nname: Cold Outreach\n---\n" + long("How I write first emails.")));
  z.addFile("skills/cold-outreach/template.txt", Buffer.from(long("Dear whoever,")));
  z.addFile("artifacts/tracker.html", Buffer.from(`<html><title>Deal Desk</title><body>${"x".repeat(200)}</body></html>`));
  z.addFile("notes/pricing.md", Buffer.from("# Pricing\n" + long("What we charge and why.")));
  z.addFile("memories/mem.json", Buffer.from(JSON.stringify({ a: "x".repeat(120) })));
  z.addFile("logo.png", Buffer.from([0x89, 0x50]));

  const out = readExportBuffer(z.toBuffer(), "everything.zip");
  assert.equal(out.kind, "bundle");
  assert.equal(out.projects.length, 1);
  assert.equal(out.skills.length, 1);
  assert.equal(out.artifacts.length, 1, "the artifact must not be lost to the project branch");
  assert.equal(out.docs.length, 1, "pricing.md must not be lost to the skill branch");
  assert.equal(out.data.length, 1);
  assert.equal(out.skipped, 1, "the png is counted, not hidden");
});

test("a skill owns its own files, so they are not also loose pages", () => {
  const z = new AdmZip();
  z.addFile("s/SKILL.md", Buffer.from(long("# Thing\nDo the thing.")));
  z.addFile("s/template.md", Buffer.from(long("A template that belongs to the skill.")));
  const out = readExportBuffer(z.toBuffer(), "s.zip");
  assert.equal(out.skills.length, 1);
  assert.deepEqual(out.skills[0].files, ["template.md"]);
  assert.equal(out.docs.length, 0, "the template is part of the skill, not a second page");
});

test("a stub file is not a page", () => {
  const z = new AdmZip();
  z.addFile("vault/Paychex.md", Buffer.from("# Paychex discovery\n" + long("What Jason asked for.")));
  z.addFile("vault/daily/2026-10-04.md", Buffer.from("x"));
  const out = readExportBuffer(z.toBuffer(), "vault.zip");
  assert.equal(out.docs.length, 1);
  assert.equal(out.docs[0].name, "Paychex discovery");
});

test("a conversations export still parses as conversations, alongside the rest", () => {
  const z = new AdmZip();
  z.addFile("conversations.json", Buffer.from(JSON.stringify([{ uuid: "c", name: "A chat" }])));
  z.addFile("notes/x.md", Buffer.from(long("Something written down.")));
  const out = readExportBuffer(z.toBuffer(), "export.zip");
  assert.ok(Array.isArray(out.json), "the conversation file is still read");
  assert.equal(out.docs.length, 1, "and the notes beside it are not dropped");
});

test("an archive with nothing readable in it says so", () => {
  const z = new AdmZip();
  z.addFile("photo.png", Buffer.from([0x89, 0x50]));
  assert.equal(readExportBuffer(z.toBuffer(), "x.zip").error, "no_conversations_json");
});

test("a bare artifact file is recognized by itself", () => {
  const html = `<!doctype html><html><head><title>Sales Motion Tracker</title></head><body><h1>x</h1></body></html>`;
  const out = readExportBuffer(Buffer.from(html), "tracker.html");
  assert.equal(out.kind, "bundle");
  assert.equal(out.artifacts[0].name, "Sales Motion Tracker");
  assert.equal(out.artifacts[0].body, html, "an artifact is kept exactly as written");
});

test("a bare json export is still a json export, not a page of markup", () => {
  const out = readExportBuffer(Buffer.from(JSON.stringify([{ uuid: "a", name: "x" }])), "conversations.json");
  assert.ok(out.json);
});

test("titles come from the author before the filesystem", () => {
  assert.equal(titleFromMarkdown("---\nname: Cold Outreach\n---\nbody"), "Cold Outreach");
  assert.equal(titleFromMarkdown("# Paychex discovery call\nmore"), "Paychex discovery call");
  assert.equal(titleFromMarkdown("no heading here"), null);
  assert.equal(titleFromHtml("<html><title>Deal Desk</title></html>"), "Deal Desk");
  assert.equal(titleFromHtml("<html><title>Untitled</title><h1>Real One</h1></html>"), "Real One");
  assert.equal(fileTitle("vault/notes/pricing-model.md"), "pricing model");
  assert.equal(folderName("skills/cold-outreach/"), "Cold Outreach");
});
