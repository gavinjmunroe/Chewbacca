/**
 * A cohort is an audience somebody will SHARE to. A wrong member is not a
 * cosmetic error, it is a stranger receiving something meant for classmates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  domainOf, isFreemail, isAcademic, cohortDomainOf, cohortNameOf,
  cohortsForContact, buildCohorts, MIN_COHORT_SIZE,
} from "./cohorts.js";

test("ONE UNIVERSITY IS ONE COHORT, however many subdomains it hands out", () => {
  // cs.stanford.edu, gsb.stanford.edu and alumni.stanford.edu are one school.
  // Three cohorts would split a class year three ways and each share would
  // reach a third of the people it was meant for.
  for (const d of ["stanford.edu", "cs.stanford.edu", "gsb.stanford.edu", "alumni.stanford.edu"]) {
    assert.equal(cohortDomainOf(d), "stanford.edu", `${d} should fold to stanford.edu`);
  }
  assert.equal(cohortDomainOf("eng.ox.ac.uk"), "ox.ac.uk");
});

test("A COMPANY SUBDOMAIN IS NOT FOLDED, because that would be a guess", () => {
  // An academic suffix makes the parent a real institution. "acme.com" being
  // the parent of "eu.acme.com" is a hosting arrangement that may or may not
  // mean one employer, and merging two audiences on a hunch is the expensive
  // direction to be wrong in.
  assert.equal(cohortDomainOf("eu.acme.com"), "eu.acme.com");
  assert.equal(cohortDomainOf("acme.com"), "acme.com");
});

test("FREEMAIL IS NEVER A COHORT", () => {
  // Four hundred people share gmail.com and none of them are a group.
  for (const d of ["gmail.com", "icloud.com", "yahoo.com", "proton.me", "hey.com"]) {
    assert.equal(isFreemail(d), true, `${d} should be freemail`);
  }
  const c = cohortsForContact({ emails: ["someone@gmail.com", "me@icloud.com"] });
  assert.deepEqual(c, []);
});

test("schools are told apart from workplaces", () => {
  assert.equal(isAcademic("stanford.edu"), true);
  assert.equal(isAcademic("ox.ac.uk"), true);
  assert.equal(isAcademic("unimelb.edu.au"), true);
  assert.equal(isAcademic("acme.com"), false);
  // "ac.com" is not a university, which is why the suffixes are a list.
  assert.equal(isAcademic("ac.com"), false);

  const [school] = cohortsForContact({ emails: ["a@stanford.edu"] });
  assert.equal(school.flavor, "school");
  const [work] = cohortsForContact({ emails: ["a@acme.com"] });
  assert.equal(work.flavor, "organization");
});

test("a name is a first guess, and the key is what membership hangs off", () => {
  assert.equal(cohortNameOf("stanford.edu"), "Stanford");
  assert.equal(cohortNameOf("mit.edu"), "MIT");
  assert.equal(cohortNameOf("blue-modern.com"), "Blue Modern");
  assert.equal(cohortNameOf("ox.ac.uk"), "OX");
  assert.equal(cohortNameOf(""), "");
});

test("EVERY MEMBERSHIP CARRIES THE ADDRESS THAT CAUSED IT", () => {
  // The first question about an automatic audience is "why is this person in
  // it". An answer that is not in the data is not an answer.
  const [c] = cohortsForContact({ emails: ["sagar@gsb.stanford.edu"] });
  assert.equal(c.key, "stanford.edu");
  assert.equal(c.evidence, "sagar@gsb.stanford.edu");
});

test("one person in two places is in two cohorts", () => {
  const cs = cohortsForContact({ emails: ["s@stanford.edu", "s@bluemodernadvisory.com"] });
  assert.deepEqual(cs.map((c) => c.key), ["bluemodernadvisory.com", "stanford.edu"]);
});

test("A COHORT OF ONE IS A PERSON, NOT AN AUDIENCE", () => {
  // Sharing to one person is what scope_type 'contact' is for. Two is the
  // smallest number that makes "everyone at X" mean anything.
  assert.equal(MIN_COHORT_SIZE, 2);
  const cohorts = buildCohorts([
    { id: 1, emails: ["a@stanford.edu"] },
    { id: 2, emails: ["b@stanford.edu"] },
    { id: 3, emails: ["c@lonely.com"] },
  ]);
  assert.deepEqual(cohorts.map((c) => c.key), ["stanford.edu"]);
  assert.equal(cohorts[0].members.length, 2);
});

test("the book's cohorts come back biggest first", () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, emails: [`s${i}@stanford.edu`] })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, emails: [`a${i}@acme.com`] })),
  ];
  assert.deepEqual(buildCohorts(rows).map((c) => c.key), ["stanford.edu", "acme.com"]);
});

test("malformed addresses produce nothing rather than a junk cohort", () => {
  assert.equal(domainOf("not-an-address"), null);
  assert.equal(domainOf("@nope.com"), null);
  assert.equal(domainOf("a@b"), null);
  assert.equal(domainOf(""), null);
  assert.deepEqual(cohortsForContact({ emails: ["nonsense", "", null] }), []);
  assert.deepEqual(cohortsForContact({}), []);
  assert.deepEqual(buildCohorts([]), []);
  assert.deepEqual(buildCohorts(null), []);
});

test("a contact with no id cannot be a member of anything", () => {
  assert.deepEqual(buildCohorts([{ emails: ["a@stanford.edu"] }, { emails: ["b@stanford.edu"] }]), []);
});
