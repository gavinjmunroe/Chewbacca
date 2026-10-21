import test from "node:test";
import assert from "node:assert/strict";

import { tidyName } from "./observed-names.js";

/*
 * These are the exact strings off one introduction email. Every one of them
 * was being read and thrown away, which is why a graph of thirteen people
 * showed eleven mailbox strings.
 */

test("a plain display name survives", () => {
  assert.equal(tidyName("Ipsha Pandey"), "Ipsha Pandey");
  assert.equal(tidyName("Nate Hinman"), "Nate Hinman");
});

test("Exchange writes the surname first, and that is still a person", () => {
  assert.equal(tidyName("Ryan, Jason"), "Jason Ryan");
  assert.equal(tidyName("Vance, Beaumont"), "Beaumont Vance");
  assert.equal(tidyName("Heckathorn, Tomi"), "Tomi Heckathorn");
});

test("quotes come off", () => {
  assert.equal(tidyName('"Ryan, Jason"'), "Jason Ryan");
  assert.equal(tidyName('"Ipsha Pandey"'), "Ipsha Pandey");
});

test("a list is not flipped into a name", () => {
  // Two commas is a list. Guessing at it is how three people become one.
  assert.equal(tidyName("Smith, Jones, Patel"), "Smith, Jones, Patel");
});

test("an address is not a name", () => {
  assert.equal(tidyName("i.pandey@pnptc.com"), null);
  assert.equal(tidyName(""), null);
  assert.equal(tidyName(null), null);
});

test("whitespace is collapsed", () => {
  assert.equal(tidyName("  Sagar    Tiwari "), "Sagar Tiwari");
});
