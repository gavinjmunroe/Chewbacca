/**
 * The knowledge layer's structural guarantees, and the one piece of arithmetic
 * in it that can be wrong quietly.
 *
 * There is no database here. What these check is the shape of the code: that
 * every statement is keyed on an organization, that every route the new file
 * registers has been given a scope, and that measureEdit credits the right
 * person. A contributor bar that is wrong is not an outage -- it is a number
 * that looks fine and is a lie, and the only thing that catches it is a test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { measureEdit } from "./org-knowledge-store.js";
import { knownScopes, scopeAllows } from "../lib/token-scope.js";

const storeSrc = readFileSync(new URL("./org-knowledge-store.js", import.meta.url), "utf8");
const routeSrc = readFileSync(new URL("../routes/org-knowledge.js", import.meta.url), "utf8");
const driveSrc = readFileSync(new URL("../routes/org-drive.js", import.meta.url), "utf8");
// Both route files hold the same properties, so both are checked by the same
// tests. A second file that quietly escaped them is exactly how the drive
// could ship with a route no scope names.
const allRouteSrc = `${routeSrc}\n${driveSrc}`;

test("measureEdit: writing a page from nothing credits every character", () => {
  assert.deepEqual(measureEdit("", "hello"), { chars_added: 5, chars_removed: 0 });
});

test("measureEdit: an append removes nothing", () => {
  const m = measureEdit("hello", "hello world");
  assert.equal(m.chars_added, 6);
  assert.equal(m.chars_removed, 0);
});

test("measureEdit: a deletion adds nothing", () => {
  const m = measureEdit("hello world", "hello");
  assert.equal(m.chars_added, 0);
  assert.equal(m.chars_removed, 6);
});

test("measureEdit: saving an unchanged page credits nobody", () => {
  // The whole reason updatePage checks this before writing a revision. Somebody
  // who opens a page and presses save must not arrive at the top of its
  // contributor list.
  assert.deepEqual(measureEdit("same", "same"), { chars_added: 0, chars_removed: 0 });
});

test("measureEdit: a one-word fix in the middle is a one-word fix", () => {
  const before = "The deploy runs on Tuesday at noon.";
  const after = "The deploy runs on Thursday at noon.";
  const m = measureEdit(before, after);
  // Not the length of the document, which is what a naive length difference
  // would report for an edit that happens to be the same size.
  assert.ok(m.chars_added <= 8, `added ${m.chars_added}`);
  assert.ok(m.chars_removed <= 8, `removed ${m.chars_removed}`);
});

test("measureEdit: a rewrite is both, not one", () => {
  const m = measureEdit("alpha", "omega");
  assert.ok(m.chars_added > 0 && m.chars_removed > 0);
});

/**
 * EVERY STATEMENT IS KEYED ON AN ORGANIZATION.
 *
 * The composite foreign keys stop a row from being WRITTEN across a company
 * boundary. Nothing in the database stops one from being READ across it except
 * these WHERE clauses, and a SELECT that forgets one is a query that serves
 * another company's wiki without erroring.
 */
test("no statement in the knowledge store reads a shared table without an org_id", () => {
  const SHARED = /\b(org_pages|org_page_revisions|org_page_attachments|org_posts)\b/;
  const offenders = [];
  for (const m of storeSrc.matchAll(/`([^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*)`/gi)) {
    const sql = m[1];
    if (!SHARED.test(sql)) continue;
    if (/org_id\s*=\s*\$1/.test(sql)) continue;
    // An INSERT names the organization as its first column and binds it to the
    // first parameter, which is the same guarantee in the shape INSERT has.
    if (/INSERT INTO \w+\s*\(\s*org_id\b/.test(sql) && /VALUES\s*\(\s*\$1\b/.test(sql)) continue;
    // A correlated subquery inherits the outer statement's org_id by joining
    // on it, which is the other acceptable shape.
    if (/org_id\s*=\s*\w+\.org_id/.test(sql)) continue;
    offenders.push(sql.replace(/\s+/g, " ").trim().slice(0, 90));
  }
  assert.deepEqual(offenders, [], `statements with no organization in them:\n  ${offenders.join("\n  ")}`);
});

/**
 * EVERY ROUTE THE FILE REGISTERS CAN ACTUALLY BE CALLED BY A WEB SESSION.
 *
 * Scope is default-deny per route: a handler that works perfectly and was never
 * added to token-scope.js is a 403 with a message about reading your network,
 * on a page that has nothing to do with your network. That is a confusing
 * afternoon, and it is entirely preventable here.
 */
test("every org-knowledge route is reachable with the scope a browser is minted with", () => {
  const scope = [...knownScopes()];
  const unreachable = [];
  for (const m of allRouteSrc.matchAll(
    /app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g,
  )) {
    const [, verb, path] = m;
    if (!scopeAllows(scope, verb.toUpperCase(), path)) {
      unreachable.push(`${verb.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(
    unreachable,
    [],
    `these routes exist and no scope names them:\n  ${unreachable.join("\n  ")}`,
  );
});

/**
 * THE ROUTES NEVER TAKE AN ORGANIZATION FROM THE CLIENT.
 *
 * Same rule org.js holds, and the reason is the same: an org id a caller gets
 * to choose turns every handler into the place that has to check it, and one of
 * them will not.
 */
test("no knowledge route reads an org id out of the request", () => {
  const bad = allRouteSrc.match(/request\.(?:body|query|params)[.?[\]'"\w]*\borgId\b/g) ?? [];
  assert.deepEqual(bad, [], `an organization came from the client: ${bad.join(", ")}`);
});

/**
 * ATTACHMENTS CANNOT BE HTML.
 *
 * An HTML file served out of the bucket renders as a page on whatever origin
 * signs for it, which makes an upload form into a publishing form.
 */
test("the attachment allowlist does not admit anything that runs", () => {
  for (const src of [routeSrc, driveSrc]) {
    const start = src.indexOf("const ALLOWED_TYPES");
    const list = src.slice(start, src.indexOf("]);", start));
    for (const dangerous of [
      "text/html",
      "application/xhtml",
      "application/javascript",
      "text/javascript",
      "application/x-httpd",
    ]) {
      assert.ok(!list.includes(dangerous), `${dangerous} is uploadable`);
    }
  }
});

/**
 * THE DRIVE IS KEYED ON AN ORGANIZATION EVERYWHERE TOO.
 *
 * A file can now exist without a page, which removes the one lookup that used
 * to carry the org id into every attachment query by accident. The clauses
 * have to be there on purpose instead.
 */
test("every drive statement names an organization", () => {
  const storeSrc2 = readFileSync(new URL("./org-knowledge-store.js", import.meta.url), "utf8");
  const drive = storeSrc2.slice(storeSrc2.indexOf("/* ------------------------------------------------------------------ drive */"));
  const offenders = [];
  for (const m of drive.matchAll(/`([^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*)`/gi)) {
    const sql = m[1];
    if (/org_id\s*=\s*\$1/.test(sql)) continue;
    if (/INSERT INTO \w+\s*\(\s*org_id\b/.test(sql) && /VALUES\s*\(\s*\$1\b/.test(sql)) continue;
    offenders.push(sql.replace(/\s+/g, " ").trim().slice(0, 90));
  }
  assert.deepEqual(offenders, [], `drive statements with no organization:\n  ${offenders.join("\n  ")}`);
});

/**
 * EXTRACTED TEXT NEVER SHIPS IN A LISTING.
 *
 * It is up to 200,000 characters a row and no list renders it. A drive that
 * sends every file's full contents in order to draw a list of filenames is a
 * page load that grows with the company, and it would not be noticed until
 * somebody with a real drive opened it.
 */
test("the file listing does not select extracted_text", () => {
  const storeSrc2 = readFileSync(new URL("./org-knowledge-store.js", import.meta.url), "utf8");
  const list = storeSrc2.slice(storeSrc2.indexOf("export async function listFiles"));
  const select = list.slice(0, list.indexOf("ORDER BY"));
  assert.ok(
    !/SELECT[\s\S]*\ba\.extracted_text\b/.test(select) || /coalesce\(a\.extracted_text/.test(select),
    "listFiles selects the extracted text",
  );
});
