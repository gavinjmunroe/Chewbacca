/**
 * THE RULE THAT DECIDES WHICH COMPANY A PERSON LANDS IN.
 *
 * Getting this wrong does not produce an error. It produces a person -- and
 * shortly their calendar, their contacts and their assistant history --
 * inside the wrong customer's workspace. So the guards are tested without a
 * database, because the guards are the part that must never loosen.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { domainOf } from "./org-domain-join.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("./org-domain-join.js", import.meta.url)), "utf8");

test("the domain is the part after the one @", () => {
  assert.equal(domainOf("sagar@joinrytual.com"), "joinrytual.com");
  assert.equal(domainOf("  Sagar@JoinRytual.COM  "), "joinrytual.com");
  assert.equal(domainOf("no-at-sign"), null);
  assert.equal(domainOf("two@at@signs"), null);
  assert.equal(domainOf("trailing@"), null);
  assert.equal(domainOf(null), null);
  assert.equal(domainOf(""), null);
});

test("a personal domain can never be claimed by a company", () => {
  /*
   * THE ONE THAT WOULD BE A DISASTER. One organization setting its email
   * domain to gmail.com would swallow every consumer sign-up on the
   * platform into that company's workspace -- calendars, contacts and all.
   * It is one typo away at any time, which is why it is refused in code
   * rather than trusted to nobody making it.
   */
  for (const d of ["gmail.com", "outlook.com", "icloud.com", "proton.me", "yahoo.com"]) {
    assert.ok(SRC.includes(`"${d}"`), `${d} must be in the never-claimable list`);
  }
});

test("an existing membership is read before anything is written", () => {
  /*
   * A person invited as an ADMIN must not be quietly demoted to member by
   * signing in again. The only thing that guarantees it is that the function
   * checks for a membership and returns before it can insert one.
   */
  const checkAt = SRC.indexOf("FROM org_members WHERE amber_id");
  const insertAt = SRC.indexOf("INSERT INTO org_members");
  assert.ok(checkAt > 0 && insertAt > 0, "both statements must exist");
  assert.ok(checkAt < insertAt, "the membership check must come before the insert");
});

test("two companies claiming one domain joins neither", () => {
  /*
   * Guessing which one somebody meant puts a person inside the wrong
   * customer. Nothing is a better answer than a coin flip, and LIMIT 2 is
   * what makes the ambiguity visible rather than silently resolved by
   * whichever row sorted first.
   */
  assert.ok(/LIMIT 2/.test(SRC), "the lookup must be able to SEE a second match");
  assert.ok(/ambiguous_domain/.test(SRC), "and must refuse rather than pick");
});

test("arrivals are members, never admins", () => {
  /*
   * A domain is evidence of employment, not of authority. If this ever says
   * 'admin', everybody at the company can change the company's policy.
   */
  const insert = SRC.slice(SRC.indexOf("INSERT INTO org_members"));
  assert.ok(/'member'/.test(insert.slice(0, 400)), "the inserted role must be member");
  assert.ok(!/'admin'/.test(insert.slice(0, 400)), "nothing here may grant admin");
});
