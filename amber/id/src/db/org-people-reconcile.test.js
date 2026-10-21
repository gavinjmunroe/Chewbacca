import test from "node:test";
import assert from "node:assert/strict";

import { usableName } from "./org-people-reconcile.js";

/*
 * THE WHOLE BUG, IN ONE ASSERTION. i.pandey@pnptc.com was stored as "Pandey"
 * because the address humanizer drops a one-letter first initial, and nothing
 * downstream would ever replace a name that did not still contain an "@".
 * Google sends "Ipsha Pandey" on every invite. This is the gate that lets it
 * through, and the gate that keeps the placeholders out.
 */

test("a provider name is taken", () => {
  assert.equal(usableName("Ipsha Pandey", "i.pandey@pnptc.com"), "Ipsha Pandey");
  assert.equal(usableName("Sagar Tiwari", "sagar@stanford.edu"), "Sagar Tiwari");
});

test("whitespace is collapsed, not trusted", () => {
  assert.equal(usableName("  Ipsha   Pandey ", "i.pandey@pnptc.com"), "Ipsha Pandey");
});

test("the address wearing a name's clothes is refused", () => {
  // Outlook fills displayName with the address when there is no profile.
  assert.equal(usableName("i.pandey@pnptc.com", "i.pandey@pnptc.com"), null);
  // And some clients fill it with the local part, punctuation and all.
  assert.equal(usableName("i.pandey", "i.pandey@pnptc.com"), null);
  assert.equal(usableName("ipandey", "i.pandey@pnptc.com"), null);
});

test("nothing, or near enough, is refused", () => {
  assert.equal(usableName("", "a@b.com"), null);
  assert.equal(usableName(null, "a@b.com"), null);
  assert.equal(usableName("K", "k@b.com"), null);
  assert.equal(usableName("x".repeat(200), "a@b.com"), null);
});

test("a name unrelated to the address still counts", () => {
  // Married names, nicknames, people at firms that key on employee numbers.
  assert.equal(usableName("Ipsha Pandey", "emp40812@pnptc.com"), "Ipsha Pandey");
});
