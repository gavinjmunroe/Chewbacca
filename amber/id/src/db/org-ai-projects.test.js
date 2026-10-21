/**
 * A CLAUDE PROJECT IS ALREADY THE UNIT PEOPLE WANT TO SHARE.
 *
 * Each project is its own file in the export -- name, description, the
 * instructions somebody wrote for it, and the documents they attached. The
 * shapes here are taken from a real export: thirteen projects, one with 58
 * documents and a page of instructions, several with instructions and no
 * documents at all.
 *
 * THAT LAST GROUP IS THE ONE WORTH PROTECTING. A project with a page of
 * instructions and no files is somebody's working method written down --
 * exactly the thing a team wants handed over, and exactly what a
 * document-counting filter would throw away.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "./org-ai-projects.js";

const { looksLikeProject, projectSubstance, projectBody, projectKey } = __test;

const project = (over = {}) => ({
  uuid: "019be1fc-d406-75b9-9ac7-f7fbf1a40959",
  name: "Amber Development",
  description: "Multiplayer AI that pushes you to meet in real life.",
  prompt_template: "",
  docs: [],
  ...over,
});

test("a project is recognized, and a conversation is not", () => {
  assert.equal(looksLikeProject(project()), true);
  // A conversation export is an array of objects with chat_messages.
  assert.equal(looksLikeProject([{ uuid: "a", chat_messages: [] }]), false);
  assert.equal(looksLikeProject({ uuid: "a", chat_messages: [] }), false);
  for (const bad of [null, undefined, "", 0, [], {}]) {
    assert.equal(looksLikeProject(bad), false);
  }
});

test("instructions alone are enough to be worth keeping", () => {
  /*
   * Four of thirteen real projects have instructions and zero documents --
   * Clay Outbound, Karthik's Business Landscape, Tide Rock, Global
   * WorldBuilder. Those are the method somebody worked out and wrote down.
   * A filter that counted files would drop every one.
   */
  const methodOnly = project({
    docs: [],
    description: "",
    prompt_template: "x".repeat(600),
  });
  assert.ok(projectSubstance(methodOnly) >= 40, "instructions must carry a project on their own");
});

test("an empty folder somebody made and abandoned is not a page", () => {
  const empty = project({ description: "", prompt_template: "", docs: [] });
  assert.ok(projectSubstance(empty) < 40);
});

test("the body leads with the instructions, because that is the part that took the thinking", () => {
  const p = project({
    prompt_template: "Always produce three outputs: leads, a plan, and a front end.",
    docs: [{ uuid: "d1", filename: "Base Case Buildout", created_at: "2026-02-05T01:55:59Z" }],
  });
  const body = projectBody(p);

  assert.ok(body.includes("## Instructions"));
  assert.ok(body.includes("Always produce three outputs"));
  assert.ok(
    body.indexOf("## Instructions") < body.indexOf("## Documents"),
    "instructions come before the file list",
  );
  assert.ok(body.includes("Base Case Buildout"));
  assert.ok(body.includes("2026-02-05"));
});

test("the page says the document CONTENTS are not in the export", () => {
  /*
   * The export lists each doc by uuid, filename and date and carries none of
   * the text. A page that showed 58 filenames and said nothing would have
   * somebody clicking a name expecting a document. Saying it once, at the
   * bottom, is the difference between a summary and a false promise.
   */
  const p = project({ docs: [{ uuid: "d", filename: "Spec", created_at: "2026-01-01" }] });
  assert.match(projectBody(p), /contents are not\s+included/i);
});

test("the key is stable, so re-uploading the same export makes nothing twice", () => {
  assert.equal(projectKey("abc"), "ai:project:abc");
  assert.equal(projectKey("abc"), projectKey("abc"));
  assert.notEqual(projectKey("abc"), projectKey("abd"));
});
