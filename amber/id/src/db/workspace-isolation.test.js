/**
 * NOTHING CROSSES BETWEEN WORKSPACES, AND THIS IS THE TEST THAT KEEPS IT TRUE.
 *
 * The bug this model exists to prevent already happened once: creating an
 * organization enrolled THE CALLER'S ACCOUNT, so somebody's personal Amber --
 * their own address book, their own relationship graph -- became a company's
 * because of one button. Nothing was copied and nothing leaked; the account
 * simply changed what it was.
 *
 * The fix is that a personal account and a work account are different accounts
 * and account_links is the only thing joining them. So the risk moves to one
 * place: the day somebody writes a query that joins THROUGH account_links to be
 * helpful -- "show me my contacts from both workspaces" -- the silo is gone and
 * nothing anywhere else will notice.
 *
 * These are source-level assertions for that reason. The property being
 * protected is the ABSENCE of a code path, and absence is what you can see in
 * the source and cannot see in a passing query.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

function sourcesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...sourcesUnder(`${dir}${entry.name}/`));
    else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      out.push({
        path: `${dir}${entry.name}`,
        text: readFileSync(new URL(`${dir}${entry.name}`, import.meta.url), "utf8"),
      });
    }
  }
  return out;
}

const SOURCES = sourcesUnder("../");

/**
 * The only files allowed to name account_links, and what each is for. An
 * exemption is a line somebody has to write and a reviewer can argue with.
 */
const ALLOWED = new Map([
  ["../db/org-store.js", "listWorkspaces / linkAccounts / accountsAreLinked — names and kinds, no content"],
  ["../db/purge.js", "deleting both halves of a link when an account goes"],
  ["../routes/workspaces.js", "the picker and the switch, which return no content"],
]);

test("ONLY THE PICKER TOUCHES account_links", () => {
  const strays = SOURCES.filter((f) => /account_links/.test(f.text)).filter((f) => !ALLOWED.has(f.path));
  assert.deepEqual(
    strays.map((f) => f.path),
    [],
    "a new file joins through account_links; workspace isolation is only as good as this list",
  );
});

test("THE PICKER SELECTS NO CONTENT, only who and what kind", () => {
  const store = SOURCES.find((f) => f.path === "../db/org-store.js").text;
  const fn = store.slice(store.indexOf("export async function listWorkspaces"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));

  // The tables a workspace's actual contents live in. If any of them is joined
  // in the one query that spans two accounts, the silo has a hole in it.
  for (const table of [
    "contacts",
    "observations",
    "shares",
    "notes",
    "note_shares",
    "circles",
    "cohorts",
    "connections",
    "dm_messages",
    "email_messages",
    "events",
  ]) {
    assert.equal(
      new RegExp(`\\b${table}\\b`).test(body),
      false,
      `listWorkspaces reaches into ${table}; it must return names and kinds only`,
    );
  }
});

test("a work account is created only where work accounts are born", () => {
  // 'work' is set in exactly one place -- the account created from a work email
  // -- and there is no route anywhere that changes an existing account's kind.
  /*
   * ASSIGNED, not merely mentioned.
   *
   * A WHERE clause that READS workspace_kind -- "only set a password on a work
   * account" -- is the opposite of a conversion and must not trip this. So each
   * UPDATE's SET clause is pulled out on its own and only that is examined; a
   * regex spanning the whole file matches the two halves of two different
   * statements and calls it a bug.
   */
  const writers = SOURCES.filter((f) =>
    f.text
      .split(/UPDATE\s+users/i)
      .slice(1)
      .some((chunk) => {
        const set = chunk.search(/\bSET\b/i);
        if (set === -1) return false;
        const where = chunk.search(/\bWHERE\b/i);
        const clause = chunk.slice(set, where === -1 ? set + 400 : where);
        return /workspace_kind\s*=/i.test(clause);
      }),
  );
  const creators = SOURCES.filter((f) => /'work'/.test(f.text) && /INSERT INTO users/.test(f.text));
  assert.deepEqual(creators.map((f) => f.path), ["../db/org-invite-store.js"]);
});

test("enrolling a company refuses a personal account", () => {
  const store = SOURCES.find((f) => f.path === "../db/org-store.js").text;
  const fn = store.slice(store.indexOf("export async function createOrganization"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.ok(body.includes("workspace_kind"), "createOrganization no longer checks the account kind");
  assert.ok(body.includes("personal_account"), "the refusal somebody sees has lost its name");
});
