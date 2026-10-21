/**
 * THE GUARD IS THE ONLY THING STANDING BETWEEN A MODEL AND SOMEBODY'S NAME.
 *
 * A model asked "who is sagartiw@stanford.edu" always answers. Most of the
 * time it is right; when it is wrong it is confidently wrong, the wrong name
 * is then shown on every screen, and nobody reading it knows to doubt it. So
 * the test that matters is not "does it name people" -- it is "does it refuse
 * a name the address cannot account for", and that one is exercised hardest.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { nameExplainsAddress, stillAnAddress, proposeNames } from "./org-name-enrich.js";

test("a name the address supports is accepted", () => {
  // The case from the real account: the address is a truncation of the name.
  assert.equal(nameExplainsAddress("Sagar Tiwari", "sagartiw@stanford.edu"), true);
  assert.equal(nameExplainsAddress("Brian Vance", "b.vance@paychex.com"), true);
  assert.equal(nameExplainsAddress("Brian Vance", "bvance@paychex.com"), true);
  assert.equal(nameExplainsAddress("Brian Vance", "vance.brian@paychex.com"), true);
  assert.equal(nameExplainsAddress("James Ryan", "jryan4@paychex.com"), true);
  assert.equal(nameExplainsAddress("Karthik Dinakar", "karthik@bluemodern.com"), true);
});

test("a name the address does not support is refused", () => {
  assert.equal(nameExplainsAddress("Sarah Chen", "sagartiw@stanford.edu"), false);
  assert.equal(nameExplainsAddress("Michael Dell", "bvance@paychex.com"), false);
  // Right firm, invented human: exactly the failure this exists to stop.
  assert.equal(nameExplainsAddress("John Smith", "jryan4@paychex.com"), false);
  assert.equal(nameExplainsAddress("", "anything@x.com"), false);
  assert.equal(nameExplainsAddress("Someone", ""), false);
});

test("only an address-shaped name is eligible to be overwritten", () => {
  assert.equal(stillAnAddress("sagartiw@stanford.edu"), true);
  assert.equal(stillAnAddress("Sagartiw"), true);
  assert.equal(stillAnAddress(""), true);
  // A real name, however it got there, is never a candidate.
  assert.equal(stillAnAddress("Sagar Tiwari"), false);
  assert.equal(stillAnAddress("Jason O'Brien"), false);
});

test("a hallucinated batch lands nothing", async () => {
  const chat = async () =>
    JSON.stringify([
      { address: "sagartiw@stanford.edu", name: "Sagar Tiwari" },
      { address: "bvance@paychex.com", name: "Beatrice Wellington" },
      { address: "info@paychex.com", name: null },
    ]);

  const out = await proposeNames(
    ["sagartiw@stanford.edu", "bvance@paychex.com", "info@paychex.com"],
    { chat },
  );

  assert.equal(out.get("sagartiw@stanford.edu"), "Sagar Tiwari");
  assert.equal(out.has("bvance@paychex.com"), false, "Wellington is not in that address");
  assert.equal(out.has("info@paychex.com"), false);
});

test("a model that returns prose, nothing, or junk changes no names", async () => {
  for (const reply of ["I cannot help with that", "", "[", "{}", null]) {
    const out = await proposeNames(["a.b@x.com"], { chat: async () => reply });
    assert.equal(out.size, 0, `reply ${JSON.stringify(reply)} should produce no names`);
  }
});

test("an absurdly long or multi-part answer is dropped", async () => {
  const chat = async () =>
    JSON.stringify([
      { address: "a.b@x.com", name: "A B C D E F" },
      { address: "c.d@x.com", name: "C".repeat(200) },
    ]);
  const out = await proposeNames(["a.b@x.com", "c.d@x.com"], { chat });
  assert.equal(out.size, 0);
});

test("a meeting title is enough, when the address alone is not", async () => {
  /*
   * THE CASE THE FIRST VERSION COULD NOT DO. sagartiw has no separator and
   * no case change, so splitting it is a guess -- but the calendar says who
   * was in the room, and those rows are already on this person's timeline.
   */
  const chat = async () =>
    JSON.stringify([{ address: "sagartiw@stanford.edu", name: "Sagar Tiwari" }]);

  const out = await proposeNames(
    [
      {
        email: "sagartiw@stanford.edu",
        emails: ["sagartiw@stanford.edu", "sagar@joinrytual.com"],
        firm: "Stanford",
        seenIn: ["Sagar Tiwari and Harris Stolzenberg", "Karthik x Sagar"],
      },
    ],
    { chat },
  );

  assert.equal(out.get("sagartiw@stanford.edu"), "Sagar Tiwari");
});

test("a second address can be the one that explains the name", async () => {
  // The guard runs against every address, not only the one we filed first.
  const chat = async () =>
    JSON.stringify([{ address: "xk19@corp.com", name: "Priya Raman" }]);

  const out = await proposeNames(
    [{ email: "xk19@corp.com", emails: ["xk19@corp.com", "p.raman@corp.com"] }],
    { chat },
  );
  assert.equal(out.get("xk19@corp.com"), "Priya Raman");
});

test("a name no address of theirs explains is still refused", async () => {
  const chat = async () =>
    JSON.stringify([{ address: "xk19@corp.com", name: "Dominic Fairweather" }]);

  const out = await proposeNames(
    [{ email: "xk19@corp.com", emails: ["xk19@corp.com", "p.raman@corp.com"] }],
    { chat },
  );
  assert.equal(out.size, 0, "more evidence must not mean a weaker guard");
});
