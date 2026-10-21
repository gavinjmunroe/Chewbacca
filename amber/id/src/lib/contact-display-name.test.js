import test from "node:test";
import assert from "node:assert/strict";
import { contactDisplayName } from "./contact-display-name.js";
test("a linked short profile never overwrites a recorded full name", () => {
  assert.equal(contactDisplayName({ full_name: "Karthik Devarakonda", linked_name: "Karthik", linked_username: "karthik" }), "Karthik Devarakonda");
  assert.equal(contactDisplayName({ full_name: "Caleb Example", linked_name: "Caleb" }), "Caleb Example");
});
test("structured names and verified profile names are fallbacks, handles are not", () => {
  assert.equal(contactDisplayName({first_name:"Caleb",last_name:"Example",linked_name:"Caleb"}), "Caleb Example");
  assert.equal(contactDisplayName({linked_name:"Karthik Devarakonda"}), "Karthik Devarakonda");
  assert.equal(contactDisplayName({linked_username:"caleb123"}), null);
});
test("names are not shortened using guesses about which tokens are annotations", () => {
  assert.equal(contactDisplayName({full_name:"María del Carmen García"}), "María del Carmen García");
  assert.equal(contactDisplayName({full_name:"Caleb"}), "Caleb");
});
