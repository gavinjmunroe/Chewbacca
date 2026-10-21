/**
 * The fill-blanks-never-overwrite rule, and the promise that a failed page read
 * cannot damage a saved contact. Every store and network call is injected.
 *
 * Run with:  node --test src/lib/web-contact-fill.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyProfileUrlFields,
  fillWebContactFromProfile,
  planWebContactFill,
} from "./web-contact-fill.js";

const EXISTING_FULL = {
  id: "11111111-2222-4333-8444-555555555555",
  fullName: "Danielle Renaldo",
  phone: "+13105550100",
  emails: "dr@zocdoc.com",
  company: "Zocdoc",
  title: "VP Finance",
  city: "New York",
  linkedin_url: "https://linkedin.com/in/dr",
  twitter_url: null,
  github_url: null,
  website: null,
  avatar_url: null,
};

const EXTRACTED = {
  core: {
    fullName: "D. Renaldo",
    title: "Head of Finance",
    company: "Acme",
    city: "Brooklyn",
    phone: "+12125550111",
    email: "other@acme.com",
  },
  links: {
    linkedin_url: "https://linkedin.com/in/someone-else",
    website: "https://daniellerenaldo.com",
  },
  extras: ["Previously at Oscar Health"],
};

test("a field that already has a value is never overwritten", () => {
  const { fieldUpdates, linkUpdates, skipped } = planWebContactFill({
    existing: EXISTING_FULL,
    core: EXTRACTED.core,
    links: EXTRACTED.links,
  });
  // Everything the contact already had stays exactly as it was. This is the
  // property that makes running this on a MERGED contact safe.
  assert.deepEqual(fieldUpdates, {});
  assert.deepEqual(linkUpdates, { website: "https://daniellerenaldo.com" });
  for (const f of ["title", "company", "city", "phone", "email", "linkedin_url"]) {
    assert.ok(skipped.includes(f), `${f} should be reported as skipped`);
  }
});

test("empty fields are filled", () => {
  const { fieldUpdates, linkUpdates } = planWebContactFill({
    existing: { id: "11111111-2222-4333-8444-555555555555", fullName: "Danielle Renaldo", title: "", company: null, city: undefined, phone: null, emails: "   " },
    core: EXTRACTED.core,
    links: EXTRACTED.links,
  });
  assert.deepEqual(fieldUpdates, {
    title: "Head of Finance",
    company: "Acme",
    city: "Brooklyn",
    phone: "+12125550111",
    email: "other@acme.com",
  });
  assert.deepEqual(linkUpdates, {
    linkedin_url: "https://linkedin.com/in/someone-else",
    website: "https://daniellerenaldo.com",
  });
});

test("the name the user chose in the save sheet is never replaced", () => {
  const { fieldUpdates } = planWebContactFill({
    existing: { id: "11111111-2222-4333-8444-555555555555", fullName: null },
    core: { fullName: "D. RENALDO (She/Her) | CFA" },
  });
  assert.equal("fullName" in fieldUpdates, false);
});

test("a contact row we could not read is treated as all-blank, not as all-filled", () => {
  // getContactWebFields returning null must not silently mean "skip everything".
  const { fieldUpdates } = planWebContactFill({ existing: null, core: { title: "VP" } });
  assert.deepEqual(fieldUpdates, { title: "VP" });
});

test("applyProfileUrlFields writes the saved-from URL and nothing else", async () => {
  const writes = [];
  const cols = await applyProfileUrlFields({
    ownerId: "o",
    contactId: "11111111-2222-4333-8444-555555555555",
    profileUrl: "https://www.linkedin.com/in/dr",
    deps: {
      getContactWebFields: async () => ({ id: "11111111-2222-4333-8444-555555555555", linkedin_url: null }),
      setContactLinkFields: async (o, c, f) => {
        writes.push(f);
        return { contactId: "11111111-2222-4333-8444-555555555555", updated: Object.keys(f) };
      },
    },
  });
  assert.deepEqual(cols, ["linkedin_url"]);
  assert.deepEqual(writes, [{ linkedin_url: "https://www.linkedin.com/in/dr" }]);
});

test("applyProfileUrlFields does not clobber a LinkedIn URL already on the card", async () => {
  let wrote = false;
  const cols = await applyProfileUrlFields({
    ownerId: "o",
    contactId: "11111111-2222-4333-8444-555555555555",
    profileUrl: "https://www.linkedin.com/in/new",
    deps: {
      getContactWebFields: async () => ({ id: "11111111-2222-4333-8444-555555555555", linkedin_url: "https://linkedin.com/in/old" }),
      setContactLinkFields: async () => {
        wrote = true;
        return {};
      },
    },
  });
  assert.deepEqual(cols, []);
  assert.equal(wrote, false);
});

function fillDeps(over = {}) {
  const spy = { fields: [], links: [], notes: [] };
  const deps = {
    fetchProfileText: async () => "Danielle Renaldo — VP Finance at Zocdoc.",
    extractProfileFields: async () => EXTRACTED,
    getContactWebFields: async () => ({ id: "11111111-2222-4333-8444-555555555555", fullName: "Danielle Renaldo" }),
    setContactLinkFields: async (o, c, f) => {
      spy.links.push(f);
      return { contactId: "11111111-2222-4333-8444-555555555555" };
    },
    updateContactFields: async (a) => {
      spy.fields.push(a);
      return {};
    },
    insertContactNote: async (a) => {
      spy.notes.push(a);
      return 9;
    },
    ...over,
  };
  return { spy, deps };
}

test("a full pass fills the blanks and writes the leftovers as one marked note", async () => {
  const { spy, deps } = fillDeps();
  const out = await fillWebContactFromProfile({
    ownerId: "o",
    contactId: "11111111-2222-4333-8444-555555555555",
    name: "Danielle Renaldo",
    profileUrl: "https://linkedin.com/in/dr",
    deps,
  });
  assert.equal(out.reason, null);
  assert.equal(spy.fields[0].title, "Head of Finance");
  assert.equal(spy.links[0].website, "https://daniellerenaldo.com");
  assert.equal(out.extras, 1);
  // A UUID, not 42. contacts.id is a uuid, and this assertion passing with an
// integer was the fixture agreeing with a bug: Number(contactId) on a real id
// is NaN, so participantIds went out EMPTY and a scraped note attached to
// nobody.
  assert.deepEqual(spy.notes[0].participantIds, ["11111111-2222-4333-8444-555555555555"]);
  assert.equal(spy.notes[0].source, "web_profile_fill");
  // The note says where it came from, so a scrape is never mistaken for
  // something the user said about this person.
  assert.match(spy.notes[0].noteText, /^From the web \(https:\/\/linkedin\.com\/in\/dr\):/);
  assert.match(spy.notes[0].noteText, /• Previously at Oscar Health/);
});

test("nothing extracted means nothing written, and a stated reason", async () => {
  const { spy, deps } = fillDeps({ extractProfileFields: async () => null });
  const out = await fillWebContactFromProfile({
    ownerId: "o",
    contactId: "11111111-2222-4333-8444-555555555555",
    profileUrl: "https://linkedin.com/in/dr",
    deps,
  });
  assert.equal(out.reason, "nothing_extracted");
  assert.deepEqual([spy.fields.length, spy.links.length, spy.notes.length], [0, 0, 0]);
});

test("no extras means no note row", async () => {
  const { spy, deps } = fillDeps({
    extractProfileFields: async () => ({ ...EXTRACTED, extras: [] }),
  });
  const out = await fillWebContactFromProfile({
    ownerId: "o",
    contactId: "11111111-2222-4333-8444-555555555555",
    profileUrl: "https://linkedin.com/in/dr",
    deps,
  });
  assert.equal(out.extras, 0);
  assert.equal(spy.notes.length, 0);
});

test("every failure mode resolves instead of rejecting", async () => {
  // A rejection here would become an unhandledRejection at the route's call site.
  for (const over of [
    { fetchProfileText: async () => { throw new Error("exa down"); } },
    { extractProfileFields: async () => { throw new Error("anthropic down"); } },
    { getContactWebFields: async () => { throw new Error("db down"); } },
    { updateContactFields: async () => { throw new Error("write failed"); } },
    { setContactLinkFields: async () => { throw new Error("write failed"); } },
    { insertContactNote: async () => { throw new Error("note failed"); } },
  ]) {
    const { deps } = fillDeps(over);
    const out = await fillWebContactFromProfile({
      ownerId: "o",
      contactId: "11111111-2222-4333-8444-555555555555",
      profileUrl: "https://linkedin.com/in/dr",
      deps,
    });
    assert.ok(out && typeof out === "object", JSON.stringify(over));
  }
});

test("missing arguments are reported, not guessed at", async () => {
  const { deps } = fillDeps();
  for (const args of [{ contactId: "11111111-2222-4333-8444-555555555555", profileUrl: "https://a.com" }, { ownerId: "o", profileUrl: "https://a.com" }, { ownerId: "o", contactId: "11111111-2222-4333-8444-555555555555" }]) {
    const out = await fillWebContactFromProfile({ ...args, deps });
    assert.equal(out.reason, "missing_args");
  }
});
