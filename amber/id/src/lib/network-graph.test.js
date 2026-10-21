/**
 * THE GRAPH THAT SHIPPED SHOWED 966 PEOPLE AND LEFT 505 OF THEM FLOATING,
 * because it only drew contact-to-contact edges and the owner was not in it.
 * These are the properties that stop that happening again.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNetworkGraph,
  tieStrength,
  emailDomainOf,
  organizationOf,
  clusterKeyOf,
  isOwnCard,
  PLACES_KEY,
} from "./network-graph.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-28T00:00:00Z");
const ago = (d) => new Date(NOW - d * DAY).toISOString();

let n = 0;
const c = (over = {}) => ({ id: `c${++n}`, full_name: `Person ${n}`, ...over });

// ── the edge that always exists ─────────────────────────────────────────────

test("EVERY CONTACT IS CONNECTED TO THE OWNER, including the ones with nothing on them", () => {
  const rows = [c(), c({ company: "Rytual" }), c({ emails: ["x@school.edu"] })];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });

  const owner = g.nodes.find((x) => x.kind === "owner");
  assert.ok(owner, "no owner node");
  assert.equal(g.nodes[0].id, owner.id, "owner must be first");

  for (const row of rows) {
    const edge = g.edges.find((e) => e.fromId === owner.id && e.toId === row.id && e.kind === "knows");
    assert.ok(edge, `no owner edge for ${row.id}`);
  }
  // Nobody is an orphan. This is the whole complaint, as an assertion.
  const connected = new Set(g.edges.flatMap((e) => [e.fromId, e.toId]));
  for (const node of g.nodes) assert.ok(connected.has(node.id), `${node.id} has no edges`);
});

// ── clusters are hubs, not cliques ──────────────────────────────────────────

test("a company of 30 emits 30 edges, NOT 435", () => {
  const rows = Array.from({ length: 30 }, () => c({ company: "Naperville North" }));
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  const clusterEdges = g.edges.filter((e) => e.kind === "organization");
  assert.equal(clusterEdges.length, 30);
  // The old complete-graph behavior would have been n(n-1)/2.
  assert.ok(clusterEdges.length < (30 * 29) / 2);
  const hub = g.nodes.find((x) => x.kind === "organization");
  assert.equal(hub.memberCount, 30);
  assert.equal(hub.name, "Naperville North");
});

test("a person is never linked to a colleague directly", () => {
  const rows = [c({ company: "Rytual" }), c({ company: "Rytual" })];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  const ids = new Set(rows.map((r) => r.id));
  for (const e of g.edges) {
    assert.ok(!(ids.has(e.fromId) && ids.has(e.toId)), "contact-to-contact edge reintroduced");
  }
});

// ── clusters that would be lies ─────────────────────────────────────────────

test("GMAIL IS NOT A WORKPLACE", () => {
  const rows = Array.from({ length: 40 }, (_, i) => c({ emails: [`p${i}@gmail.com`] }));
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  assert.equal(g.nodes.filter((x) => x.kind === "domain").length, 0);
  assert.equal(emailDomainOf("someone@gmail.com"), null);
  assert.equal(emailDomainOf("someone@naperville203.org"), "naperville203.org");
});

test("'Self-employed' is not a company anybody shares", () => {
  const rows = Array.from({ length: 5 }, () => c({ company: "Self-Employed" }));
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  assert.equal(g.nodes.filter((x) => x.kind === "organization").length, 0);
  assert.equal(organizationOf({ company: "freelance" }), null);
  assert.equal(organizationOf({ company: "Rytual" }), "rytual");
});

test("one person is not a cluster, and four hundred is not one either", () => {
  assert.equal(buildNetworkGraph([c({ company: "Solo Inc" })], new Map(), { now: NOW })
    .nodes.filter((x) => x.kind === "organization").length, 0);
  const many = Array.from({ length: 400 }, () => c({ company: "Huge Corp" }));
  assert.equal(buildNetworkGraph(many, new Map(), { now: NOW })
    .nodes.filter((x) => x.kind === "organization").length, 0);
});

test("a shared domain does not duplicate a cluster the employer already explains", () => {
  const rows = Array.from({ length: 4 }, (_, i) =>
    c({ company: "Rytual", emails: [`p${i}@rytual.com`] }));
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  assert.equal(g.nodes.filter((x) => x.kind === "organization").length, 1);
  assert.equal(g.nodes.filter((x) => x.kind === "domain").length, 0, "same group hubbed twice");
});

// ── strength ────────────────────────────────────────────────────────────────

test("who you actually talk to is stronger than who you do not", () => {
  const fresh = tieStrength({ last_at: ago(1), count_90d: 30 }, { now: NOW });
  const stale = tieStrength({ last_at: ago(900), count_90d: 2 }, { now: NOW });
  const never = tieStrength(null, { now: NOW });
  assert.ok(fresh > stale, `${fresh} vs ${stale}`);
  assert.ok(stale > never, `${stale} vs ${never}`);
  assert.ok(fresh <= 1 && never > 0, "strength must stay inside (0, 1]");
});

test("A CONTACT WITH NO HISTORY IS STILL VISIBLE", () => {
  // A freshly imported book has no interactions at all. If that rendered as
  // zero, day one would be nine hundred invisible nodes.
  const g = buildNetworkGraph([c()], new Map(), { now: NOW });
  const node = g.nodes.find((x) => x.kind === "contact");
  assert.ok(node.strength > 0, "a contact with no history vanished");
  assert.equal(g.edges.find((e) => e.toId === node.id).weight, node.strength);
});

test("a node carries enough to label itself without another request", () => {
  const stats = new Map([["c-known", { last_at: ago(3), count_90d: 9 }]]);
  const g = buildNetworkGraph(
    [{ id: "c-known", full_name: "Sagar Tiwari", company: "Rytual", title: "CEO", city: "Chicago" }],
    stats,
    { now: NOW },
  );
  const node = g.nodes.find((x) => x.id === "c-known");
  assert.equal(node.name, "Sagar Tiwari");
  assert.equal(node.company, "Rytual");
  assert.equal(node.title, "CEO");
  assert.equal(node.count90d, 9);
  assert.ok(node.lastAt);
});

test("a name is assembled when full_name is missing, never left blank", () => {
  const g = buildNetworkGraph([{ id: "x", first_name: "Kshitij", last_name: "Bhardwaj" }], new Map(), { now: NOW });
  assert.equal(g.nodes.find((x) => x.id === "x").name, "Kshitij Bhardwaj");
  const g2 = buildNetworkGraph([{ id: "y" }], new Map(), { now: NOW });
  assert.equal(g2.nodes.find((x) => x.id === "y").name, "Unnamed");
});

// ── scale and junk ──────────────────────────────────────────────────────────

test("a real-sized book stays bounded and fast", () => {
  const rows = [];
  for (let i = 0; i < 966; i += 1) {
    rows.push(c({
      company: i % 40 === 0 ? `Company ${i % 12}` : null,
      emails: i % 3 === 0 ? [`p${i}@school${i % 9}.edu`] : [`p${i}@gmail.com`],
    }));
  }
  const t0 = Date.now();
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `took ${ms}ms`);
  // One edge per person, plus one per cluster membership. Nothing quadratic.
  assert.ok(g.edges.length < rows.length * 3, `${g.edges.length} edges for ${rows.length} people`);
  assert.equal(g.stats.people, 966);
});

test("junk never throws", () => {
  assert.equal(buildNetworkGraph(null).nodes.length, 1); // owner only
  assert.equal(buildNetworkGraph([]).edges.length, 0);
  assert.equal(buildNetworkGraph([null, undefined, { id: null }]).nodes.length, 1);
  assert.doesNotThrow(() => buildNetworkGraph([{ id: "a", emails: "not-an-array" }]));
});

// ── an edge has to be right, or it poisons the ones that are ────────────────

test("a contact with no full_name is named from the parts, in EITHER row shape", () => {
  // rowToContact hands back name/firstName/lastName; a raw row has
  // full_name/first_name/last_name. Both have to work.
  const g = buildNetworkGraph(
    [
      { id: "raw", first_name: "Shirley", last_name: "Park" },
      { id: "mapped", firstName: "Sagar", lastName: "Tiwari" },
      { id: "named", name: "Meet Patel" },
    ],
    new Map(),
    { now: NOW },
  );
  assert.equal(g.nodes.find((n) => n.id === "raw").name, "Shirley Park");
  assert.equal(g.nodes.find((n) => n.id === "mapped").name, "Sagar Tiwari");
  assert.equal(g.nodes.find((n) => n.id === "named").name, "Meet Patel");
});

// ── a person can be several things at once ──────────────────────────────────

test("SOMEBODY CAN BE A SCHOOLMATE AND A COLLEAGUE AND BE IN BOTH", () => {
  // Sagar is a friend, a schoolmate and a cofounder, and his addresses say so.
  // Taking only the primary threw two of those away.
  const sagar = c({ full_name: "Sagar Tiwari", emails: ["sagart851@gmail.com", "sagar@bluemodernadvisory.com"] });
  const meet = c({ full_name: "Meet Patel", emails: ["meetpat7316@k12.ipsd.org", "meet200013@gmail.com"] });
  const rows = [
    sagar,
    c({ full_name: "Colleague", emails: ["x@bluemodernadvisory.com"] }),
    meet,
    c({ full_name: "Schoolmate", emails: ["y@k12.ipsd.org"] }),
  ];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  const hubFor = (label) => g.nodes.find((n) => (n.kind === "domain" || n.kind === "organization") && n.name.includes(label));
  const membersOf = (hub) => new Set(g.edges.filter((e) => e.fromId === hub.id).map((e) => String(e.toId)));

  const bma = hubFor("bluemodern");
  const ipsd = hubFor("ipsd");
  assert.ok(bma && ipsd, "expected both a company and a school cluster");
  assert.ok(membersOf(bma).has(sagar.id), "cofounder missing from the company cluster");
  assert.ok(membersOf(ipsd).has(meet.id), "schoolmate missing from the school cluster");
});

test("a freemail address never joins anybody to anything, wherever it sits", () => {
  const rows = Array.from({ length: 6 }, (_, i) =>
    c({ emails: [`p${i}@gmail.com`, `p${i}@yahoo.com`] }));
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  assert.equal(g.nodes.filter((n) => n.kind === "domain").length, 0);
});

// ── one employer, one cluster ───────────────────────────────────────────────

test("A COMPANY FIELD AND ITS MAIL DOMAIN ARE ONE CLUSTER, NOT TWO", () => {
  // Apple gave two cards company "PWC"; Google gave five cards @pwc.com. That
  // is one employer and it was drawn as two unrelated groups.
  const rows = [
    c({ full_name: "Mei Lin", company: "PWC" }),
    c({ full_name: "Nate Kaplan", company: "PWC" }),
    c({ full_name: "Vanessa Maganda", emails: ["vanessa.maganda@pwc.com"] }),
    c({ full_name: "Ryan Trammell", emails: ["ryan.m.trammell@pwc.com"] }),
  ];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  const hubs = g.nodes.filter((n) => n.kind === "organization" || n.kind === "domain");
  assert.equal(hubs.length, 1, `expected one PwC cluster, got ${hubs.map((h) => h.name).join(", ")}`);
  assert.equal(hubs[0].memberCount, 4);
  // The typed company name is nicer to read than the domain.
  assert.equal(hubs[0].name, "PWC");
});

test("the cluster key takes the significant label, not the suffix", () => {
  assert.equal(clusterKeyOf({ domain: "pwc.com" }), "pwc");
  assert.equal(clusterKeyOf({ company: "PwC " }), "pwc");
  assert.equal(clusterKeyOf({ domain: "k12.ipsd.org" }), "ipsd");
  assert.equal(clusterKeyOf({ domain: "bluemodernadvisory.com" }), "bluemodernadvisory");
  // A two-part public suffix must not become the key.
  assert.equal(clusterKeyOf({ domain: "acme.co.uk" }), "acme");
  assert.equal(clusterKeyOf({ domain: "mail.acme.com" }), "acme");
  assert.equal(clusterKeyOf({}), null);
});

test("two genuinely different firms are NOT folded together", () => {
  const rows = [
    c({ emails: ["a@acme.com"] }), c({ emails: ["b@acme.com"] }),
    c({ emails: ["c@globex.com"] }), c({ emails: ["d@globex.com"] }),
  ];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  assert.equal(g.nodes.filter((n) => n.kind === "domain").length, 2);
});

// ── the owner's own card ────────────────────────────────────────────────────

test("YOUR OWN CONTACT CARD IS YOU, NOT A SECOND PERSON IN YOUR GRAPH", () => {
  const mine = c({
    full_name: "Karthik Devarakonda",
    phone: "+15550100001",
    emails: ["kdev792@gmail.com", "karthik@bluemodernadvisory.com"],
  });
  const rows = [mine, c({ full_name: "Somebody Else" })];
  const g = buildNetworkGraph(rows, new Map(), {
    now: NOW,
    ownerPhone: "+1 (555) 010-0001",
    ownerEmails: ["karthik@bluemodernadvisory.com"],
  });
  assert.ok(!g.nodes.some((n) => n.id === mine.id), "the owner is drawn twice");
  assert.equal(g.nodes.find((n) => n.kind === "owner").foldedCards, 1);
  assert.equal(g.stats.people, 1);
});

test("identity matches on phone or address, and on a name only under guard", () => {
  const namesake = c({ full_name: "Karthik Devarakonda", phone: "+12225550000" });
  const g = buildNetworkGraph([namesake], new Map(), {
    now: NOW, ownerPhone: "+15550100001", ownerEmails: ["karthik@bluemodernadvisory.com"],
  });
  assert.ok(g.nodes.some((n) => n.id === namesake.id), "a namesake was erased as the owner");

  assert.equal(isOwnCard({ phone: "555-010-0001" }, { ownerPhone: "+15550100001" }), true);
  assert.equal(isOwnCard({ emails: ["KARTHIK@BlueModernAdvisory.com"] }, { ownerEmails: ["karthik@bluemodernadvisory.com"] }), true);
  assert.equal(isOwnCard({ linked_amber_id: "u-1" }, { ownerAmberId: "u-1" }), true);
  assert.equal(isOwnCard({}, {}), false);

  // A bare name never matches on its own -- it needs the profile name AND the
  // caller's assurance that only one card in the book carries it.
  assert.equal(isOwnCard({ full_name: "Karthik Devarakonda" }, { ownerPhone: "+15550100001" }), false);
  assert.equal(
    isOwnCard({ full_name: "Karthik Devarakonda" }, { ownerName: "Karthik Devarakonda" }),
    false,
    "a name match without uniqueness must not fold",
  );
  assert.equal(
    isOwnCard(
      { full_name: "Karthik Devarakonda" },
      { ownerName: "Karthik Devarakonda", nameIsUnique: true },
    ),
    true,
  );
  // THE SON. Same name, his own number on the card: a different man.
  assert.equal(
    isOwnCard(
      { full_name: "Karthik Devarakonda", phone: "+12225550000" },
      { ownerName: "Karthik Devarakonda", nameIsUnique: true, ownerPhone: "+15550100001" },
    ),
    false,
    "a namesake with his own phone was folded into the owner",
  );
});

test("THE APPLE ME CARD IS NOT A CONTACT", () => {
  // The card everybody has for themselves: their name, their own addresses,
  // and frequently no phone at all, because the phone already knows the number.
  const me = c({
    full_name: "Karthik Devarakonda",
    emails: ["kdev792@gmail.com", "karthikdev6991@k12.ipsd.org"],
  });
  const other = c({ full_name: "Meet Patel", emails: ["meetpat7316@k12.ipsd.org"] });
  const g = buildNetworkGraph([me, other], new Map(), {
    now: NOW,
    ownerPhone: "+15550100001",
    ownerProfileName: "Karthik Devarakonda",
  });
  assert.ok(!g.nodes.some((n) => n.id === me.id), "the owner's own card was drawn as a contact");
  assert.equal(g.stats.foldedOwnCards, 1);
  // And its addresses do not drag the owner into everybody else's groups.
  assert.ok(!g.groups.some((gr) => gr.memberIds.includes(me.id)));
});

// ── two cards, one person ───────────────────────────────────────────────────

test("NATE KAPLAN AND NATHAN KAPLAN AT PWC ARE ONE DOT", () => {
  // Exactly the pair in the real book: Apple wrote the company and no address,
  // Google wrote the address and a country label, and neither string matches.
  const apple = c({ full_name: "Nate Kaplan", company: "PWC" });
  const google = c({ full_name: "Nathan Kaplan (US)", emails: ["nathan.kaplan@pwc.com"] });
  const g = buildNetworkGraph([apple, google], new Map(), { now: NOW });

  const people = g.nodes.filter((n) => n.kind === "contact");
  assert.equal(people.length, 1, "the same man is still two dots");
  assert.equal(people[0].name, "Nathan Kaplan", "the merge kept the nickname over the full name");
  assert.deepEqual(people[0].aliases, ["Nate Kaplan"], "a fold must name the cards it stands for");
  assert.equal(people[0].mergedCount, 2);
  assert.equal(g.stats.cards, 2);
  assert.equal(g.stats.people, 1);
  assert.equal(g.stats.merged, 1);
});

test("a nickname alone is NOT a merge", () => {
  // No shared employer, so these stay two people. This is the guard that keeps
  // the fold from becoming a fuzzy name match.
  const a = c({ full_name: "Nate Harris", emails: ["nate@acme.com"] });
  const b = c({ full_name: "Nathan Harris", emails: ["nathan@globex.com"] });
  const g = buildNetworkGraph([a, b], new Map(), { now: NOW });
  assert.equal(g.nodes.filter((n) => n.kind === "contact").length, 2);
});

test("NATHAN AND NATHANIEL ARE NOT THE SAME NAME, even at one company", () => {
  const a = c({ full_name: "Nathan Reed", company: "Acme" });
  const b = c({ full_name: "Nathaniel Reed", company: "Acme" });
  const g = buildNetworkGraph([a, b], new Map(), { now: NOW });
  assert.equal(
    g.nodes.filter((n) => n.kind === "contact").length,
    2,
    "two full names that merely share a short form were merged",
  );
});

test("a shared address merges regardless of the name on the card", () => {
  const a = c({ full_name: "K Dev", emails: ["k@bluemodernadvisory.com"] });
  const b = c({ full_name: "Karthik D", emails: ["k@bluemodernadvisory.com"] });
  const g = buildNetworkGraph([a, b], new Map(), { now: NOW });
  assert.equal(g.nodes.filter((n) => n.kind === "contact").length, 1);
});

test("a merged person's history is the sum of their cards", () => {
  const apple = c({ full_name: "Nate Kaplan", company: "PWC" });
  const google = c({ full_name: "Nathan Kaplan", emails: ["n@pwc.com"] });
  const stats = new Map([
    [apple.id, { last_at: ago(200), count_90d: 2 }],
    [google.id, { last_at: ago(3), count_90d: 5 }],
  ]);
  const g = buildNetworkGraph([apple, google], stats, { now: NOW });
  const person = g.nodes.find((n) => n.kind === "contact");
  assert.equal(person.count90d, 7, "one person's two cards must add up");
  assert.equal(person.lastAt, ago(3), "the most recent of the two must win");
});

// ── groups are membership, not place ────────────────────────────────────────

test("A GROUP LISTS ITS MEMBERS BY ID, so the client never infers membership from position", () => {
  const rows = [
    c({ emails: ["a@pwc.com"] }),
    c({ emails: ["b@pwc.com"] }),
    c({ full_name: "Nobody", emails: ["x@gmail.com"] }),
  ];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  const pwc = g.groups.find((x) => x.key === "pwc");
  assert.ok(pwc, "no pwc group");
  assert.deepEqual(pwc.memberIds.slice().sort(), [rows[0].id, rows[1].id].sort());
  assert.equal(pwc.memberCount, 2);
  assert.ok(!pwc.memberIds.includes(rows[2].id), "a stranger is listed in the group");

  // And the same membership is on the node, so a dot can color itself.
  const a = g.nodes.find((n) => n.id === rows[0].id);
  assert.ok(a.groupKeys.includes("pwc"));
  const stranger = g.nodes.find((n) => n.id === rows[2].id);
  assert.deepEqual(stranger.groupKeys, []);
});

test("groups come back biggest first, so a legend needs no sorting", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => c({ company: "Zulu" })),
    ...Array.from({ length: 9 }, () => c({ company: "Acme" })),
  ];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  assert.deepEqual(g.groups.map((x) => x.memberCount), [9, 5]);
});

test("one person in several groups is in all of them", () => {
  const sagar = c({
    full_name: "Sagar Tiwari",
    emails: ["sagar@bluemodernadvisory.com", "sagart851@k12.ipsd.org"],
  });
  const rows = [
    sagar,
    c({ emails: ["k@bluemodernadvisory.com"] }),
    c({ emails: ["m@k12.ipsd.org"] }),
  ];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  const node = g.nodes.find((n) => n.id === sagar.id);
  assert.deepEqual(node.groupKeys.slice().sort(), ["bluemodernadvisory", "ipsd"]);
});

// ── a dentist's office is not a friend ──────────────────────────────────────

test("BUSINESSES AND PLACES GET THEIR OWN GROUP", () => {
  const desk = c({ full_name: "UW-Madison Finaid Front Desk", emails: ["front.desk@em.wisc.edu"] });
  const hotel = c({
    full_name: "Marina Bay Sands Singapore",
    emails: ["do_not_reply@reservations.marinabaysands.com"],
  });
  const person = c({ full_name: "Sam Zastrow", emails: ["smzastrow@wisc.edu"] });
  const g = buildNetworkGraph([desk, hotel, person], new Map(), { now: NOW });

  const places = g.groups.find((x) => x.key === PLACES_KEY);
  assert.ok(places, "no places group");
  assert.deepEqual(places.memberIds.slice().sort(), [desk.id, hotel.id].sort());
  assert.ok(!places.memberIds.includes(person.id), "a person was filed as a business");

  assert.equal(g.nodes.find((n) => n.id === desk.id).entity, "place");
  assert.equal(g.nodes.find((n) => n.id === person.id).entity, "person");
  assert.equal(g.stats.places, 2);
  assert.equal(g.stats.people, 1, "places must not be counted as people");
});

test("the places chip sorts first, however small it is", () => {
  const rows = [
    ...Array.from({ length: 12 }, () => c({ company: "Acme" })),
    c({ full_name: "Corp", emails: ["corp@x.com"] }),
    c({ full_name: "BKLYN GOLD RENTALS", emails: ["info@bklyngold.com"] }),
  ];
  const g = buildNetworkGraph(rows, new Map(), { now: NOW });
  assert.equal(g.groups[0].key, PLACES_KEY);
});

test("a book with no businesses in it gets no places chip", () => {
  const g = buildNetworkGraph([c({ full_name: "Sagar Tiwari" })], new Map(), { now: NOW });
  assert.ok(!g.groups.some((x) => x.key === PLACES_KEY));
  assert.equal(g.stats.places, 0);
});

// ── which name goes on the dot ──────────────────────────────────────────────

test("THE FULLEST RECORD SURVIVES BUT THE FULLEST NAME IS SHOWN", () => {
  // The real pair: Apple had the phone and the company and said "Nate"; Google
  // had only an address and said "Nathan Kaplan (US)". Letting the surviving
  // record pick the label put "Nate Kaplan" on screen.
  const apple = c({ full_name: "Nate Kaplan", company: "PWC", phoneNumbers: ["+16305551212"] });
  const google = c({ full_name: "Nathan Kaplan (US)", emails: ["nathan.kaplan@pwc.com"] });
  const g = buildNetworkGraph([apple, google], new Map(), { now: NOW });
  const person = g.nodes.find((n) => n.kind === "contact");
  assert.equal(person.id, apple.id, "the fuller record did not survive");
  assert.equal(person.name, "Nathan Kaplan", "the short form was shown");
  assert.deepEqual(person.aliases, ["Nate Kaplan"]);
  // The parenthetical spelling is the same name, not another one.
  assert.ok(!person.aliases.includes("Nathan Kaplan (US)"));
});

// ── what the last contact actually was ──────────────────────────────────────

test("THE CHANNEL TRAVELS WITH THE MOST RECENT CONTACT, not with the biggest count", () => {
  // "How is 'spoke 1 month ago' being calculated? I have not spoken to some of
  // these people that recently." The card has to say what happened, and for a
  // person assembled from two cards that is whichever card is more recent.
  const apple = c({ full_name: "Nate Kaplan", company: "PWC", phoneNumbers: ["+16305551212"] });
  const google = c({ full_name: "Nathan Kaplan (US)", emails: ["n@pwc.com"] });
  const stats = new Map([
    [apple.id, { last_at: ago(3), count_90d: 1, channel: "calendar" }],
    [google.id, { last_at: ago(40), count_90d: 9, channel: "email" }],
  ]);
  const g = buildNetworkGraph([apple, google], stats, { now: NOW });
  const person = g.nodes.find((n) => n.kind === "contact");
  assert.equal(person.lastAt, ago(3));
  assert.equal(person.lastChannel, "calendar", "the label would have said email for a meeting");
  assert.equal(person.count90d, 10, "the totals still add up across both cards");
});

test("a contact with a timestamp but no channel breakdown says so rather than guessing", () => {
  const only = c();
  const g = buildNetworkGraph([only], new Map([[only.id, { last_at: ago(10), count_90d: 2 }]]), {
    now: NOW,
  });
  assert.equal(g.nodes.find((n) => n.kind === "contact").lastChannel, null);
});

// ── closeness comes from the model, not from this file ──────────────────────

test("A SCORE BEATS THE FILE'S OWN GUESS", () => {
  // The Alex case. One observation five weeks old and nothing else on the card
  // scored 0.60 here and sat in the closest circle; contact_scores knows the
  // record is one-eighth filled and says 0.35.
  const alex = c({ full_name: "Alex" });
  const stats = new Map([[alex.id, { last_at: ago(34), count_90d: 1 }]]);
  const guess = buildNetworkGraph([alex], stats, { now: NOW });
  assert.ok(guess.nodes[1].strength > 0.5, "the old guess should be high; that was the bug");

  const scored = buildNetworkGraph([alex], stats, {
    now: NOW,
    scoresById: new Map([[alex.id, 0.35]]),
  });
  assert.equal(scored.nodes[1].strength, 0.35);
});

test("A DORMANT FRIEND IS NOT A STRANGER", () => {
  // The same bug from the other end: silent for two years floored this to 0.12
  // and exiled them to the outer field, while the model says 0.60.
  const friend = c({ full_name: "Old Friend", company: "Acme" });
  const stats = new Map([[friend.id, { last_at: ago(730), count_90d: 0 }]]);
  const guessed = buildNetworkGraph([friend], stats, { now: NOW }).nodes[1].strength;
  assert.ok(guessed < 0.13, `the old guess was ${guessed}; it should be at the floor`);
  const scored = buildNetworkGraph([friend], stats, {
    now: NOW,
    scoresById: new Map([[friend.id, 0.6]]),
  });
  assert.equal(scored.nodes[1].strength, 0.6);
});

test("an unscored contact falls back rather than reading as distant", () => {
  // A contact the rollup has not reached yet must not be treated as cold. A
  // missing score means "not computed", never "not close".
  const fresh = c();
  const stats = new Map([[fresh.id, { last_at: ago(1), count_90d: 20 }]]);
  const g = buildNetworkGraph([fresh], stats, { now: NOW, scoresById: new Map() });
  assert.ok(g.nodes[1].strength > 0.9, "a fresh, busy contact was treated as cold");
});

test("a merged person takes the closest of their cards", () => {
  const apple = c({ full_name: "Nate Kaplan", company: "PWC", phoneNumbers: ["+16305551212"] });
  const google = c({ full_name: "Nathan Kaplan (US)", emails: ["n@pwc.com"] });
  const g = buildNetworkGraph([apple, google], new Map(), {
    now: NOW,
    scoresById: new Map([[apple.id, 0.2], [google.id, 0.77]]),
  });
  assert.equal(g.nodes.find((n) => n.kind === "contact").strength, 0.77);
});

test("a score outside 0..1 is clamped rather than trusted", () => {
  const x = c();
  const hi = buildNetworkGraph([x], new Map(), { now: NOW, scoresById: new Map([[x.id, 4]]) });
  const lo = buildNetworkGraph([x], new Map(), { now: NOW, scoresById: new Map([[x.id, -2]]) });
  assert.equal(hi.nodes[1].strength, 1);
  assert.equal(lo.nodes[1].strength, 0);
});

test("A NODE CARRIES EVERY SOURCE IT ARRIVED THROUGH", () => {
  const both = c({ full_name: "In Both", source: "apple" });
  const g = buildNetworkGraph([both], new Map(), {
    now: NOW,
    sourcesById: new Map([[both.id, ["imessage", "gmail"]]]),
  });
  // apple from two labels and the row's own column, google from gmail; best
  // first, deduplicated.
  assert.deepEqual(g.nodes[1].origins, ["apple", "google"]);
});

test("a merged person carries the origins of every card that became them", () => {
  const apple = c({ full_name: "Nate Kaplan", company: "PWC", source: "apple" });
  const google = c({ full_name: "Nathan Kaplan (US)", emails: ["n@pwc.com"], source: "google" });
  const g = buildNetworkGraph([apple, google], new Map(), { now: NOW });
  assert.deepEqual(g.nodes.find((n) => n.kind === "contact").origins, ["apple", "google"]);
});

test("a contact with no source reports none rather than guessing one", () => {
  const g = buildNetworkGraph([c({ source: null })], new Map(), { now: NOW });
  assert.deepEqual(g.nodes[1].origins, []);
});
