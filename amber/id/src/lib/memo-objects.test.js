import test from "node:test";
import assert from "node:assert/strict";
import { memoObjects, attachMemoPlaces } from "./memo-objects.js";
test("places stay attached to extracted objects and invented contact IDs are removed", () => {
  const got = memoObjects(
    {
      people: [
        { name: "Maya", contactId: "invented", places: ["Cafe", "invented"] },
        { name: "Alex", contactId: "alex", places: ["Cafe"] },
      ],
      places: ["Cafe", "Cafe"],
      plans: [{ title: "Coffee", places: ["Cafe"] }],
    },
    [{ id: "alex" }],
  );
  assert.deepEqual(got.places, ["Cafe"]);
  assert.equal(got.people[0].contactId, "");
  assert.deepEqual(got.people[0].places, ["Cafe"]);
  assert.equal(got.people[1].contactId, "alex");
  assert.deepEqual(got.plans[0].places, ["Cafe"]);
  assert.deepEqual(memoObjects(null), { people: [], places: [], plans: [] });
});

test("a matching place flows into the save draft even if the model omitted the duplicate field", () => {
  const objects = {
    people: [{ name: "Maya Chen", contactId: "maya", places: ["Cafe"] }],
    plans: [{ title: "Coffee", places: ["Cafe"] }],
    places: ["Cafe"],
  };
  const got = attachMemoPlaces(
    [
      { kind: "contact", contactId: "maya" },
      { kind: "calendar", title: "Coffee" },
      { kind: "calendar", title: "Other" },
    ],
    objects,
  );
  assert.equal(got[0].place, "Cafe");
  assert.equal(got[0].personName, "Maya Chen");
  assert.equal(got[1].place, "Cafe");
  assert.equal(got[2].place, undefined);
});
