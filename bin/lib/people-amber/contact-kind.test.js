/**
 * The cost of a wrong answer here is asymmetric: filing a person as a business
 * hides them from somebody scanning for a friend, while missing a business
 * only leaves one more dot in the field. So these tests are mostly about what
 * must NOT be classified as a place.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyContact, hasRoleAddress, nameReadsAsOrganization } from "./contact-kind.js";

const card = (full_name, ...emails) => ({ full_name, emails });

test("the counters, queues and mailboxes in a real address book", () => {
  const places = [
    card("UW-Madison Finaid Front Desk", "front.desk@em.wisc.edu"),
    card("Catering Office Wisconsin Union", "wicatoffice@union.wisc.edu"),
    card("CS Data Engineering Program Adminstration", "csdataeng@cs.wisc.edu"),
    card("Student Recruiting", "studentrecruiting@union.wisc.edu"),
    card("Housing Assignments", "assignme@housing.wisc.edu"),
    card("University of Illinois at Urbana-Champaign", "admissions@illinois.edu"),
    card("BSCHOOL", "bschool@indiana.edu"),
    card("Marina Bay Sands Singapore", "do_not_reply@reservations.marinabaysands.com"),
    card("MB-LaborRelationsMail", "labor_relations_mail@cunamutual.com"),
    card("BKLYN GOLD RENTALS", "info@bklyngold.com"),
    card("Corp", "corp@pasricha.com"),
  ];
  for (const c of places) {
    assert.equal(classifyContact(c), "place", `${c.full_name} was read as a person`);
  }
});

test("PEOPLE ARE NOT BUSINESSES, including the ones sitting next to them", () => {
  const people = [
    card("Sam Zastrow", "smzastrow@wisc.edu"),
    card("MAXWELL KABOT JOHNSON", "mkjohnson9@wisc.edu"),
    card("Joseph S. Miller", "jmiller@math.wisc.edu"),
    card("Nathan Kaplan", "nathan.kaplan@pwc.com"),
    card("Kelly Donnellan", "kelly_prusila@ipsd.org"),
    card("Sagar Tiwari", "sagar@bluemodernadvisory.com"),
    card("Shirley Park"),
    // Substring matching would file all three of these as places.
    card("Bishop Carol", "bcarol@example.com"),
    card("Carol Carr", "ccarr@example.com"),
    card("Marshall Banks", "mbanks@example.com"),
  ];
  for (const c of people) {
    assert.equal(classifyContact(c), "person", `${c.full_name} was read as a business`);
  }
});

test("a role address is recognized however it is punctuated", () => {
  assert.equal(hasRoleAddress(card("x", "do_not_reply@a.com")), true);
  assert.equal(hasRoleAddress(card("x", "front.desk@a.com")), true);
  assert.equal(hasRoleAddress(card("x", "no-reply@a.com")), true);
  assert.equal(hasRoleAddress(card("x", "labor_relations_mail@a.com")), true);
  assert.equal(hasRoleAddress(card("x", "karthik@a.com")), false);
  assert.equal(hasRoleAddress(card("x")), false);
});

test("institution words are matched as tokens, never as substrings", () => {
  assert.equal(nameReadsAsOrganization("Naperville Dental Care"), true);
  assert.equal(nameReadsAsOrganization("Elm Street Law Office"), true);
  assert.equal(nameReadsAsOrganization("Bishop Carol"), false);
  assert.equal(nameReadsAsOrganization("Carol Carr"), false);
  assert.equal(nameReadsAsOrganization(""), false);
});

test("A TRADE WORD IN A SHORT NAME IS A SURNAME, not a shop", () => {
  // English surnames are mostly trades, which is why a bare keyword list files
  // people as businesses. "Jay Barber" was the one this missed on a real book.
  for (const name of [
    "Jay Barber",
    "Mike Law",
    "Law, Mike",
    "Charlotte Church",
    "Henry Cabot Lodge",
    "Shirley Temple",
  ]) {
    assert.equal(nameReadsAsOrganization(name), false, `${name} was read as a business`);
    assert.equal(classifyContact({ full_name: name, emails: [] }), "person");
  }
});

test("a business says what it is as well as what it is called", () => {
  // The same words, with one more word that only a business would carry.
  for (const name of [
    "Magico Barber Shop",
    "Elm Street Law Office",
    "Church Street Dental",
    "Temple University",
    "The Lodge Restaurant",
    "Holiday Inn Express",
  ]) {
    assert.equal(nameReadsAsOrganization(name), true, `${name} was read as a person`);
  }
});
