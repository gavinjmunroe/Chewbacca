/**
 * The two pure pieces of a room: what a shared page IS, and the links
 * nobody files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { workKind, linksIn } from "./org-circles.js";

test("a page says what kind of thing it is, from the tag the importer left", () => {
  assert.equal(workKind(["from:artifact"]), "artifact");
  assert.equal(workKind(["from:skill", "ai:skill:x"]), "skill");
  assert.equal(workKind(["from:claude-project"]), "project");
  assert.equal(workKind(["from:data"]), "record");
  assert.equal(workKind([]), "page");
  assert.equal(workKind(undefined), "page");
});

test("links are collected from messages, newest mention winning", () => {
  const links = linksIn([
    { id: "2", created_at: "2026-10-10T10:00:00Z", author_name: "Sagar", body: "again https://amber.example/x" },
    { id: "1", created_at: "2026-10-01T10:00:00Z", author_name: "Karthik", body: "see https://amber.example/x and https://paychex.com/gtm." },
  ]);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, "https://amber.example/x");
  assert.equal(links[0].by, "Sagar", "the newer mention is the useful context");
  // Sentence punctuation is not part of the URL.
  assert.ok(links.some((l) => l.url === "https://paychex.com/gtm"));
  assert.equal(links.find((l) => l.host === "paychex.com")?.host, "paychex.com");
});

test("text that looks like a link but is not does not become one", () => {
  const links = linksIn([
    { id: "1", created_at: "2026-10-01T10:00:00Z", author_name: null, body: "email me at a@b.com or read http://" },
  ]);
  assert.equal(links.length, 0);
});

test("no messages, no links, and nothing thrown", () => {
  assert.deepEqual(linksIn([]), []);
  assert.deepEqual(linksIn(), []);
});

/**
 * THE @AMBER CONTRACT, WRITTEN DOWN WHERE THE ROUTE CAN SEE IT.
 *
 * The parser runs in the browser -- it has to, because the message posts
 * whatever happens and only then is the command sent -- so this does not
 * import it. It pins the RULE the route depends on: a bare mention is not an
 * instruction. A product that fires every time somebody says its name is one
 * people stop saying its name around.
 */
test("a tag with a command is a command, and a bare mention is not", () => {
  const parse = (body) => {
    const m = String(body ?? "").match(/@amber\b[,:]?\s*([\s\S]+)/i);
    const cmd = m ? m[1].trim() : "";
    return cmd.length >= 2 ? cmd : null;
  };

  assert.equal(parse("@amber build me a slideshow on this"), "build me a slideshow on this");
  assert.equal(parse("@Amber: who is going quiet?"), "who is going quiet?");
  assert.equal(parse("hey @amber can you draft the brief"), "can you draft the brief");

  assert.equal(parse("@amber"), null);
  assert.equal(parse("we should ask amber about this"), null);
  assert.equal(parse(""), null);
});
