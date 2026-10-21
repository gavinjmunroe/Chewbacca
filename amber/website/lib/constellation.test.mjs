/**
 * Three layouts shipped before this one: a hairball, a clock face, and a set
 * of rings that asserted membership for whoever landed inside them. Each of
 * those is a property, not a screenshot, so each of them is a test here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConstellation,
  initialsOf,
  extentOf,
  dotRadius,
  groupColor,
  groupColors,
  resolveGroups,
  liveExtentOf,
  maxRadiusFor,
  MIN_CLEARANCE,
  LIVE_SPACING_AREA,
  CLOSE_SPACING_AREA,
  INNER_CIRCLE,
  liveRadii,
  QUIET_SPACING_AREA,
  QUIET_BELOW,
} from "./constellation.js";

let n = 0;
const contact = (over = {}) => ({
  id: `c${++n}`, kind: "contact", name: `Person ${n}`, strength: 0.12, groupKeys: [], ...over,
});
const owner = { id: "me", kind: "owner", name: "You", strength: 1 };

const placedOf = (nodes) => {
  const { placed } = buildConstellation(nodes);
  return new Map(placed.map((p) => [p.id, p]));
};

// ── the clock ───────────────────────────────────────────────────────────────

test("NO RING FORMS when hundreds of contacts share the same strength", () => {
  // This is the bug, as a test. Seven hundred identical-strength contacts used
  // to land on one radius and draw a perfect circle.
  const rows = Array.from({ length: 700 }, () => contact());
  const { placed } = buildConstellation([owner, ...rows]);
  const radii = placed
    .filter((p) => p.kind === "contact")
    .map((p) => Math.round(Math.hypot(p.x, p.y)));
  const distinct = new Set(radii);
  assert.ok(distinct.size > 200, `only ${distinct.size} distinct radii across 700 dots`);
});

test("NO TWO DOTS TOUCH, which is a stricter thing than not overlapping", () => {
  // This asserted `d >= a.r + b.r` and passed while the picture still read as
  // crowded, because that is the condition for two circles to be TANGENT. Two
  // dots sharing a tangent line are one smudge. The rule is a real gap.
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => contact({ strength: 0.9 - i * 0.015 })),
    ...Array.from({ length: 600 }, () => contact()),
  ];
  const { placed } = buildConstellation([owner, ...rows]);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(
        d >= a.r + b.r + MIN_CLEARANCE,
        `${a.name} and ${b.name} are ${(d - a.r - b.r).toFixed(1)} apart, need ${MIN_CLEARANCE}`,
      );
    }
  }
});

test("THE QUIET FIELD IS ROOMIER THAN THE CROWD OF PEOPLE YOU DO TALK TO", () => {
  // It holds nine hundred of the thousand dots, so it is the part that decides
  // whether the graph reads as crowded. Its neighbours sit further apart than
  // the dense part of the live field, not closer.
  //
  // Only the DENSE part. The inner circle is roomier than everything, which is
  // the point of it -- so the comparison is drawn past the density ramp, where
  // the live field has settled to its own spacing and the claim is about what
  // the test says it is about.
  const rows = [
    ...Array.from({ length: 90 }, (_, i) => contact({ strength: 0.95 - i * 0.008 })),
    ...Array.from({ length: 400 }, () => contact()),
  ];
  const { placed } = buildConstellation([owner, ...rows]);
  const nearest = (subset) => {
    let min = Infinity;
    for (let i = 0; i < subset.length; i += 1) {
      for (let j = i + 1; j < subset.length; j += 1) {
        min = Math.min(min, Math.hypot(subset[i].x - subset[j].x, subset[i].y - subset[j].y));
      }
    }
    return min;
  };
  const quiet = placed.filter((p) => p.quiet);
  // Live dots are placed in rank order, so position in the array is the rank.
  const dense = placed.filter((p) => p.kind === "contact" && !p.quiet).slice(40);
  assert.ok(
    nearest(quiet) > nearest(dense),
    `quiet neighbours ${nearest(quiet).toFixed(0)} apart, dense live ${nearest(dense).toFixed(0)}`,
  );
});

// ── distance means one thing ────────────────────────────────────────────────

test("THE OWNER IS THE CENTER", () => {
  const p = placedOf([owner, contact(), contact()]);
  assert.equal(p.get("me").x, 0);
  assert.equal(p.get("me").y, 0);
});

test("the people you talk to sit closer than the people you do not", () => {
  const close = contact({ name: "Close", strength: 0.95 });
  const middling = contact({ name: "Middling", strength: 0.4 });
  const cold = contact({ name: "Cold", strength: 0.12 });
  const p = placedOf([owner, cold, close, middling]);
  const d = (id) => Math.hypot(p.get(id).x, p.get(id).y);
  assert.ok(d(close.id) < d(middling.id), "a live tie is not nearer than a weak one");
  assert.ok(d(middling.id) < d(cold.id), "a weak tie is not nearer than a dead one");
});

test("THERE IS EMPTY SPACE between the people you deal with and the ones you never talk to", () => {
  const live = Array.from({ length: 25 }, (_, i) => contact({ strength: 0.9 - i * 0.02 }));
  const cold = Array.from({ length: 400 }, () => contact());
  const { placed, quietStart } = buildConstellation([owner, ...live, ...cold]);
  const liveMax = Math.max(
    ...placed.filter((p) => p.kind === "contact" && !p.quiet).map((p) => Math.hypot(p.x, p.y)),
  );
  const quietMin = Math.min(
    ...placed.filter((p) => p.quiet).map((p) => Math.hypot(p.x, p.y)),
  );
  assert.ok(quietMin >= quietStart - 1, "the quiet field starts inside its own boundary");
  assert.ok(quietMin - liveMax > 200, `the gap is only ${Math.round(quietMin - liveMax)}`);
});

test("the quiet field is everyone below the threshold, and nobody else", () => {
  const rows = [
    contact({ strength: QUIET_BELOW + 0.01 }),
    contact({ strength: QUIET_BELOW - 0.01 }),
  ];
  const p = placedOf([owner, ...rows]);
  assert.equal(p.get(rows[0].id).quiet, false);
  assert.equal(p.get(rows[1].id).quiet, true);
  // And a quiet dot is smaller, so the outer band reads as background.
  assert.ok(dotRadius(rows[1]) < dotRadius(rows[0]));
});

// ── groups are not geometry ─────────────────────────────────────────────────

test("GROUP MEMBERSHIP MOVES NOTHING", () => {
  // The whole reason groups left the layout. If membership changed position,
  // position would again be a claim about membership -- and the moment an
  // unrelated dot landed nearby, the picture would assert a colleague who is
  // not one. Same people, different groups, identical coordinates.
  const plain = [owner, contact({ name: "A" }), contact({ name: "B" }), contact({ name: "C" })];
  const grouped = plain.map((p, i) =>
    p.kind === "owner" ? p : { ...p, groupKeys: i % 2 ? ["pwc"] : ["pwc", "ipsd"] },
  );
  const a = buildConstellation(plain).placed;
  const b = buildConstellation(grouped).placed;
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i].id, b[i].id);
    assert.equal(a[i].x, b[i].x);
    assert.equal(a[i].y, b[i].y);
  }
});

test("group membership survives the layout, so a dot can color itself", () => {
  const c = contact({ groupKeys: ["pwc", "ipsd"] });
  const p = placedOf([owner, c]);
  assert.deepEqual(p.get(c.id).groupKeys, ["pwc", "ipsd"]);
});

test("every group gets its own hue, however many there are", () => {
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) seen.add(groupColor(i));
  assert.equal(seen.size, 40, "two groups were given the same color");

  const groups = [
    { key: "pwc", label: "PWC", memberCount: 7 },
    { key: "ipsd", label: "ipsd.org", memberCount: 30 },
  ];
  const colors = groupColors(groups);
  assert.equal(colors.size, 2);
  assert.notEqual(colors.get("pwc"), colors.get("ipsd"));
});

// ── it must not move on its own ─────────────────────────────────────────────

test("THE SAME DATA DRAWS THE SAME PICTURE", () => {
  const rows = [owner, ...Array.from({ length: 60 }, () => contact())];
  const a = buildConstellation(rows).placed;
  const b = buildConstellation(rows).placed;
  assert.deepEqual(
    a.map((p) => [p.id, p.x, p.y]),
    b.map((p) => [p.id, p.x, p.y]),
  );
});

test("ties break on name, not on input order", () => {
  const x = contact({ name: "Zoe", strength: 0.5 });
  const y = contact({ name: "Adam", strength: 0.5 });
  const one = placedOf([owner, x, y]);
  const two = placedOf([owner, y, x]);
  assert.equal(one.get(x.id).x, two.get(x.id).x);
  assert.equal(one.get(y.id).y, two.get(y.id).y);
});

// ── labels ──────────────────────────────────────────────────────────────────

test("initials are what a person would recognize as themselves", () => {
  assert.equal(initialsOf("Nathan Kaplan"), "NK");
  assert.equal(initialsOf("Madonna"), "M");
  assert.equal(initialsOf("  sagar   tiwari  "), "ST");
  assert.equal(initialsOf("Mary-Jane Watson"), "MW");
  assert.equal(initialsOf(""), "?");
  // An address-book row whose name is an address initials from the person,
  // not from the mail host.
  assert.equal(initialsOf("jose@example.com"), "J");
  assert.equal(initialsOf("+1 555 010 0001"), "1");
});

test("the extent covers everything drawn, so the first fit shows all of it", () => {
  const rows = [owner, ...Array.from({ length: 200 }, () => contact())];
  const { placed } = buildConstellation(rows);
  const e = extentOf(placed);
  for (const p of placed) {
    assert.ok(Math.hypot(p.x, p.y) + p.r <= e + 0.001, `${p.name} is outside the extent`);
  }
});

test("an empty graph does not throw", () => {
  const { placed } = buildConstellation([]);
  assert.deepEqual(placed, []);
  assert.ok(extentOf([]) > 0);
});

// ── every dot can say who it is ─────────────────────────────────────────────

test("EVERY CONTACT CARRIES ITS INITIALS, including the ones you never talk to", () => {
  const live = contact({ name: "Nathan Kaplan", strength: 0.8 });
  const cold = contact({ name: "Meilani Felix" });
  const p = placedOf([owner, live, cold]);
  assert.equal(p.get(live.id).initials, "NK");
  assert.equal(p.get(cold.id).initials, "MF", "a quiet dot has nothing to show when zoomed in");
});

test("dots are big enough to hold two letters", () => {
  // Under about twelve units a pair of initials is a smudge at any zoom that
  // still shows the whole graph. This is the floor, not a preference.
  assert.ok(dotRadius(contact({ strength: 0.12 })) >= 36);
  assert.ok(dotRadius(contact({ strength: 1 })) >= 60);
  assert.ok(dotRadius({ kind: "owner", strength: 1 }) >= 60);
});

test("A DOT IS AS BIG AS IT CAN BE WITHOUT TOUCHING ITS NEIGHBOUR", () => {
  // Spreading the field further out cannot make a node look bigger, because
  // the opening zoom follows the extent. Only the size-to-gap ratio can, and
  // it has a hard ceiling. This pins the dots near it rather than leaving a
  // comment claiming they are near it.
  const liveMax = maxRadiusFor(LIVE_SPACING_AREA);
  const biggest = dotRadius(contact({ strength: 1 }));
  assert.ok(biggest < liveMax, `${biggest} would collide (ceiling ${liveMax.toFixed(1)})`);
  assert.ok(biggest > liveMax * 0.85, `${biggest} wastes room under a ceiling of ${liveMax.toFixed(1)}`);

  const quietMax = maxRadiusFor(QUIET_SPACING_AREA);
  assert.ok(dotRadius(contact({ strength: 0.12 })) < quietMax);
});

test("THE VIEW OPENS ON THE PEOPLE YOU KNOW, not on the whole book", () => {
  // Fitting 966 contacts means a zoom where no name can be drawn. The quiet
  // field is one scroll out; it is not what somebody opens their network for.
  const live = Array.from({ length: 30 }, (_, i) => contact({ strength: 0.9 - i * 0.02 }));
  const cold = Array.from({ length: 600 }, () => contact());
  const { placed } = buildConstellation([owner, ...live, ...cold]);
  const all = extentOf(placed);
  const framed = liveExtentOf(placed);
  assert.ok(framed < all / 2, `the opening frame (${framed}) is not tighter than everything (${all})`);
  // Every live person is inside the opening frame; that is the whole promise.
  for (const p of placed) {
    if (p.quiet || p.kind === "owner") continue;
    assert.ok(Math.hypot(p.x, p.y) + p.r <= framed + 0.001, `${p.name} opens off screen`);
  }
});

test("a book with nobody live in it still frames something", () => {
  const { placed } = buildConstellation([owner, ...Array.from({ length: 50 }, () => contact())]);
  assert.ok(liveExtentOf(placed) > 0);
  assert.ok(Number.isFinite(liveExtentOf(placed)));
});

test("a place keeps its classification through the layout", () => {
  const gym = contact({ name: "Equinox Gold Coast", entity: "place" });
  const p = placedOf([owner, gym]);
  assert.equal(p.get(gym.id).entity, "place");
});

// ── the key ─────────────────────────────────────────────────────────────────

test("THE KEY IS NEVER EMPTY WHILE THE DOTS ARE COLORED", () => {
  // The failure that shipped twice: nodes carry groupKeys, so arcs get drawn,
  // but the groups list is missing, so there is nothing to read them by.
  const nodes = [
    owner,
    { ...contact({ name: "A" }), groupKeys: ["pwc"] },
    { ...contact({ name: "B" }), groupKeys: ["pwc", "ipsd"] },
    { ...contact({ name: "C" }), groupKeys: ["ipsd"] },
    { id: "org:pwc", kind: "organization", name: "PWC", strength: 0.5, memberCount: 2 },
    { id: "dom:ipsd", kind: "domain", name: "ipsd.org", strength: 0.5, memberCount: 2 },
  ];
  const keyed = resolveGroups(nodes, []);
  const colored = new Set(nodes.flatMap((n) => n.groupKeys ?? []));
  for (const k of colored) {
    assert.ok(keyed.some((g) => g.key === k), `${k} is drawn but not in the key`);
  }
  assert.deepEqual(
    keyed.find((g) => g.key === "pwc"),
    { key: "pwc", id: "pwc", label: "PWC", kind: "organization", memberCount: 2, memberIds: [nodes[1].id, nodes[2].id] },
  );
});

test("the server's own list wins when it is there", () => {
  const sent = [
    { key: "pwc", id: "org:pwc", label: "PWC", kind: "organization", memberCount: 2, memberIds: ["x", "y"] },
  ];
  assert.equal(resolveGroups([owner], sent), sent);
});

test("the places category sorts first in a reconstructed key", () => {
  const nodes = [
    owner,
    ...Array.from({ length: 9 }, () => ({ ...contact(), groupKeys: ["acme"] })),
    { ...contact({ name: "Gym" }), groupKeys: ["__places"] },
    { id: "org:acme", kind: "organization", name: "Acme", strength: 0.5, memberCount: 9 },
  ];
  const keyed = resolveGroups(nodes, []);
  assert.equal(keyed[0].key, "__places");
  assert.equal(keyed[0].kind, "category");
});

test("no groups at all is a defined answer, not a crash", () => {
  assert.deepEqual(resolveGroups([owner, contact()], []), []);
  assert.deepEqual(resolveGroups([], []), []);
});

test("THE INNER CIRCLE IS THE ROOMIEST PART OF THE LIVE FIELD", () => {
  // The part of the picture you came to look at must not be the most crowded
  // part of it. One continuous spiral gave the closest eight people exactly as
  // much space each as the hundred-and-fiftieth, which is how the middle
  // became a jumble that no amount of spreading could fix.
  const radii = liveRadii(60);
  const innerSteps = [];
  const outerSteps = [];
  for (let i = 1; i < radii.length; i += 1) {
    const step = radii[i] - radii[i - 1];
    if (i < INNER_CIRCLE) innerSteps.push(step);
    if (i > INNER_CIRCLE + 30) outerSteps.push(step);
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(
    mean(innerSteps) > mean(outerSteps) * 1.4,
    `inner steps ${mean(innerSteps).toFixed(1)} should be well clear of outer ${mean(outerSteps).toFixed(1)}`,
  );
});

test("there is a visible step out of the inner circle, and only one", () => {
  const radii = liveRadii(60);
  const steps = radii.slice(1).map((r, i) => r - radii[i]);
  const boundary = steps[INNER_CIRCLE - 1];
  const others = steps.filter((_, i) => i !== INNER_CIRCLE - 1);
  assert.ok(
    boundary > Math.max(...others) * 1.5,
    "the tier boundary should be the one obvious gap in the live field",
  );
});

test("a close contact is drawn bigger than the same contact further down the order", () => {
  const n = contact({ strength: 0.9 });
  assert.ok(dotRadius(n, 0) > dotRadius(n, 40));
});

test("YOU ARE STILL THE BIGGEST THING IN YOUR OWN NETWORK", () => {
  const owner = { kind: "owner", strength: 1, name: "me", id: "me" };
  assert.ok(dotRadius(owner) > dotRadius(contact({ strength: 1 }), 0));
});

test("the inner circle's dots fit the room the inner circle gives them", () => {
  const ceiling = maxRadiusFor(CLOSE_SPACING_AREA);
  assert.ok(dotRadius(contact({ strength: 1 }), 0) < ceiling);
});
