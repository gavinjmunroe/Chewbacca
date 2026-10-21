/**
 * THE WEB'S DATA LAYER, AT ITS BOUNDARIES.
 *
 * The drawing is the easy part. Everything that can actually be wrong here is
 * arithmetic about people:
 *
 *   THE CUTOFF        suggestions vanish at exactly five connections, and "at
 *                     exactly" is where an off-by-one lives.
 *   THE DOUBLE        one human drawn twice -- once solid, once faint offering
 *                     to invite them to the app they are already on.
 *   THE DEAD FILTER   a pill that empties the ring and cannot be undone except
 *                     by pressing All.
 *   THE RESHUFFLE     pressing Work and then All putting everyone somewhere new,
 *                     which makes the drawing look like it is guessing.
 *
 * None of those are visible in a screenshot of a happy path, and all of them are
 * certain on somebody's real address book.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LABEL_CHAR_PT,
  LABEL_GAP_Y,
  LABEL_LINE_H,
  MAX_BOW,
  SPIRAL_S,
  MAX_WEB_NODES,
  SINGLE_ORBIT_MAX,
  SUGGESTION_CUTOFF,
  boardForCount,
  arrangeAroundRing,
  buildWeb,
  hash01,
  hubDiameter,
  filterByCircle,
  filterPills,
  initialsOf,
  layoutWeb,
  ringPlan,
  sortPeople,
  suggestionsFromCircles,
  unitEllipseAt,
  webCapacity,
  webSummary,
  normalizeName,
  type WebPerson,
} from './connectionsWeb.ts';
import { groupMembersByCircle } from './circles.ts';

// ── builders, so a test says what it is about and nothing else ──────────────

let seq = 0;
const uid = (p: string) => `${p}-${(seq += 1)}`;

function connection(fullName: string, amberId = uid('amber')) {
  return {
    connectionId: uid('conn'),
    connectedAt: '2026-01-01T00:00:00.000Z',
    user: {
      amberId,
      username: fullName.toLowerCase().replace(/\s+/g, ''),
      fullName,
      avatarUrl: null,
      occupation: null,
      currentCity: null,
    },
  };
}

function member(name: string, opts: { amberId?: string | null; contactId?: string } = {}) {
  return {
    contactId: opts.contactId ?? uid('contact'),
    name,
    avatarUrl: null,
    connected: Boolean(opts.amberId),
    amberId: opts.amberId ?? null,
    username: null,
  };
}

function circle(name: string, preview: ReturnType<typeof member>[], id = uid('circle')) {
  return {
    id,
    name,
    color: 'orange',
    kindTag: name,
    memberCount: preview.length,
    connectedCount: preview.filter((m) => m.amberId).length,
    preview,
  } as any;
}

// ── initials ────────────────────────────────────────────────────────────────

test('initials are two letters, whatever the name is', () => {
  assert.equal(initialsOf('Mina Cho'), 'MC');
  assert.equal(initialsOf('daniel kim'), 'DK');
  // A MONONYM GETS TWO LETTERS. "P" beside "MK" reads as a rendering fault.
  assert.equal(initialsOf('Prince'), 'PR');
  assert.equal(initialsOf('  Sofia   Lopez  '), 'SL');
  // Three names take the first and the LAST, which is the one people answer to.
  assert.equal(initialsOf('Arjun Ibrahim Tanaka'), 'AT');
  // Nothing to take is "?", never an empty disc that looks like a failed load.
  assert.equal(initialsOf(''), '?');
  assert.equal(initialsOf('   '), '?');
  assert.equal(initialsOf('!!!'), '?');
  assert.equal(initialsOf('🙂'), '?');
  // Punctuation inside a real name does not eat the letter behind it.
  assert.equal(initialsOf("Grace O'Brien"), 'GO');
  assert.equal(initialsOf('Jean-Luc Picard'), 'JP');
  // Non-Latin scripts have letters too, and uppercasing them must not crash.
  assert.equal(initialsOf('María Ángel'), 'MÁ');
});

// ── the cutoff ──────────────────────────────────────────────────────────────

test('EVERYBODY IN A CIRCLE IS DRAWN, however many connections you already have', () => {
  // The old rule hid every non-Amber person once you had five connections, and
  // capped them at eight before that. Both are gone: "every single person
  // represented in every single circle should be shown on the web."
  //
  // This is the test that would have caught the reported bug. With nine people
  // filed in Work and five connections, the ring used to hold five nodes and
  // Work's pill read whatever fraction of nine had won a slot -- which was zero.
  const people = Array.from({ length: 9 }, (_, i) => member(`Contact ${i}`));
  const circles = [circle('Work', people)];

  for (const n of [0, 1, 4, SUGGESTION_CUTOFF, SUGGESTION_CUTOFF + 1, 20]) {
    const web = buildWeb({
      connections: Array.from({ length: n }, (_, i) => connection(`Real ${i}`)),
      circles,
    });
    assert.equal(
      web.filter((p) => p.kind === 'suggestion').length,
      9,
      `${n} connections: all nine people in Work must still be on the ring`,
    );
    assert.equal(web.filter((p) => p.kind === 'connection').length, n);
  }
});

test('a brand-new user with no circles and no connections gets an empty ring, not a crash', () => {
  const web = buildWeb({ connections: [], circles: [] });
  assert.deepEqual(web, []);
  assert.equal(webSummary(web), 'Nobody here yet');
  assert.deepEqual(layoutWeb(web, 120), []);
  assert.deepEqual(filterPills(web, []), []);
});

test('a normal address book is drawn in full; the ceiling is only for a mad one', () => {
  // Forty people in a circle is forty nodes. The cap that used to make this
  // eight is what made the pills count the drawing instead of the circle.
  const many = Array.from({ length: 40 }, (_, i) => member(`Person ${String(i).padStart(2, '0')}`));
  const web = buildWeb({ connections: [], circles: [circle('Everyone', many)] });
  assert.equal(web.length, 40, 'forty people in a circle should be forty nodes');

  // The ceiling exists so that somebody who filed two thousand contacts into one
  // circle does not put two thousand labeled discs on a phone screen. It is a
  // frame-rate guard, not a rule about the product, and nobody normal reaches it.
  assert.ok(MAX_WEB_NODES >= 100, 'the ceiling is so high it is not a design choice');
  const huge = Array.from({ length: MAX_WEB_NODES + 25 }, (_, i) =>
    member(`Person ${String(i).padStart(4, '0')}`),
  );
  assert.equal(buildWeb({ connections: [], circles: [circle('Everyone', huge)] }).length, MAX_WEB_NODES);

  // And the pill still reports the TRUE size even when the ring is clipped, so
  // the number on screen never contradicts the number on the pill.
  const clipped = buildWeb({ connections: [], circles: [circle('Everyone', huge, 'c-huge')] });
  const pills = filterPills(clipped, [circle('Everyone', huge, 'c-huge')]);
  assert.equal(pills[0]!.count, MAX_WEB_NODES + 25);
});

// ── the double ──────────────────────────────────────────────────────────────

test('ONE HUMAN IS NEVER DRAWN TWICE, even with a duplicate unresolved card', () => {
  // Sofia is connected. Her card in Work resolved to her account; a second,
  // unresolved duplicate of her sits in Friends. Without the guard she is drawn
  // solid AND faint, and the faint one offers to invite her to Amber.
  const sofiaAmber = 'amber-sofia';
  const sofiaContact = 'contact-sofia';
  const resolved = member('Sofia Lopez', { amberId: sofiaAmber, contactId: sofiaContact });
  const duplicate = member('Sofia Lopez', { amberId: null, contactId: sofiaContact });

  const web = buildWeb({
    connections: [connection('Sofia Lopez', sofiaAmber)],
    circles: [circle('Work', [resolved]), circle('Friends', [duplicate, member('Tom Park')])],
  });

  const sofias = web.filter((p) => p.name === 'Sofia Lopez');
  assert.equal(sofias.length, 1, 'Sofia was drawn twice');
  assert.equal(sofias[0]!.kind, 'connection');
  assert.ok(
    web.some((p) => p.kind === 'suggestion' && p.name === 'Tom Park'),
    'the guard should drop only Sofia, not every suggestion in that circle',
  );
});

test('somebody in six circles is one node carrying six circles', () => {
  const contactId = 'contact-omar';
  const circles = Array.from({ length: 6 }, (_, i) =>
    circle(`Circle ${i}`, [member('Omar Park', { contactId })], `circle-${i}`),
  );
  const web = buildWeb({ connections: [], circles });
  const omars = web.filter((p) => p.name === 'Omar Park');
  assert.equal(omars.length, 1, 'one person, six circles, one node');
  assert.equal(omars[0]!.circleIds.length, 6);
  // And the same for a connection.
  const amberId = 'amber-omar';
  const web2 = buildWeb({
    connections: [connection('Omar Park', amberId)],
    circles: Array.from({ length: 6 }, (_, i) =>
      circle(`Circle ${i}`, [member('Omar Park', { amberId, contactId })], `circle-${i}`),
    ),
  });
  assert.equal(web2.length, 1);
  assert.equal(web2[0]!.circleIds.length, 6);
});

test('a connection in no circle is still drawn', () => {
  // The commonest real case for an early user: you connected with someone from a
  // link and never filed them. Dropping them would be catastrophic and is
  // exactly what a naive "join circles to connections" would do.
  const web = buildWeb({ connections: [connection('Unfiled Friend')], circles: [circle('Work', [member('Someone')])] });
  const unfiled = web.find((p) => p.name === 'Unfiled Friend');
  assert.ok(unfiled, 'a connection who is in no circle vanished from the web');
  assert.deepEqual(unfiled!.circleIds, []);
});

// ── filters ─────────────────────────────────────────────────────────────────

test('a filter shows exactly that circle, and All shows everyone', () => {
  const a = 'amber-a';
  const b = 'amber-b';
  const work = circle('Work', [member('Ann Wu', { amberId: a })], 'w');
  const fam = circle('Family', [member('Bo Diaz', { amberId: b })], 'f');
  const web = buildWeb({ connections: [connection('Ann Wu', a), connection('Bo Diaz', b)], circles: [work, fam] });

  assert.equal(filterByCircle(web, null).length, 2);
  assert.deepEqual(filterByCircle(web, 'w').map((p) => p.name), ['Ann Wu']);
  assert.deepEqual(filterByCircle(web, 'f').map((p) => p.name), ['Bo Diaz']);
});

test('EVERY CIRCLE GETS A PILL, INCLUDING THE EMPTY ONES', () => {
  /**
   * This used to hide any circle nobody on the ring belonged to, so a pill could
   * never lead to a blank web. Reasonable, and it cost the row the thing it is
   * for: these are the person's own circles, and a row that silently omits half
   * of them is a row they cannot trust. "I don't see all of my circles."
   *
   * The dead end is handled where it belongs instead -- the count is on the
   * pill, so an empty circle says so before it is pressed, and pressing the lit
   * pill turns it off.
   */
  const amberIds = Array.from({ length: 5 }, (_, i) => `amber-${i}`);
  const onWeb = circle('Work', amberIds.map((id, i) => member(`Real ${i}`, { amberId: id })), 'w');
  // TWO PEOPLE, NEITHER OF THEM ON AMBER. This is the reported bug in one line:
  // the pill used to read 0 because it counted the ring, and nobody from this
  // circle was on the ring. It is a circle with two people in it.
  const offWeb = circle('Old School', [member('Nobody Here'), member('Also Absent')], 'o');
  const web = buildWeb({
    connections: amberIds.map((id, i) => connection(`Real ${i}`, id)),
    circles: [onWeb, offWeb],
  });

  const pills = filterPills(web, [onWeb, offWeb]);
  assert.deepEqual(pills.map((p) => p.id).sort(), ['o', 'w'], 'a circle was dropped from the row');
  assert.equal(pills.find((p) => p.id === 'o')!.count, 2, 'a circle of two read as empty');
  assert.equal(pills.find((p) => p.id === 'w')!.count, 5);
  // AND THE PILL LEADS SOMEWHERE. The count promised two people; pressing it has
  // to produce two people, drawn faint because neither is on Amber. A pill that
  // says 2 and filters to nobody is the same broken promise the other way round.
  const inOld = filterByCircle(web, 'o');
  assert.equal(inOld.length, 2, 'the pill claimed two people and the ring showed none');
  assert.deepEqual(inOld.map((p) => p.kind), ['suggestion', 'suggestion']);
});

test('THE PILLS FOLLOW THE PINNED GRID, because that is the order they chose', () => {
  const a = circle('Alpha', [member('P', { amberId: 'x' })], 'a');
  const b = circle('Beta', [member('Q', { amberId: 'y' })], 'b');
  const c = circle('Gamma', [member('R', { amberId: 'z' })], 'c');
  const web = buildWeb({
    connections: [connection('P', 'x'), connection('Q', 'y'), connection('R', 'z')],
    circles: [a, b, c],
  });

  // Pinned in a deliberate, non-alphabetical order.
  assert.deepEqual(filterPills(web, [a, b, c], ['c', 'a']).map((p) => p.name), ['Gamma', 'Alpha', 'Beta']);
  // Unpinned circles come after, alphabetically, so the tail is predictable.
  assert.deepEqual(filterPills(web, [c, b, a], []).map((p) => p.name), ['Alpha', 'Beta', 'Gamma']);
  // A pinned id for a circle that no longer exists is simply ignored.
  assert.deepEqual(filterPills(web, [a, b], ['gone', 'b']).map((p) => p.name), ['Beta', 'Alpha']);
});

test('pills carry the count of who is actually on the ring', () => {
  const ids = ['a', 'b', 'c'];
  const big = circle('Work', ids.map((id, i) => member(`P${i}`, { amberId: id })), 'w');
  const small = circle('Family', [member('P0', { amberId: 'a' })], 'f');
  const web = buildWeb({ connections: ids.map((id, i) => connection(`P${i}`, id)), circles: [big, small] });
  const pills = filterPills(web, [big, small], ['w', 'f']);
  assert.deepEqual(pills.map((p) => [p.name, p.count]), [['Work', 3], ['Family', 1]]);
});

// ── the reshuffle ───────────────────────────────────────────────────────────

test('FILTERING AND UNFILTERING PUTS EVERYONE BACK WHERE THEY WERE', () => {
  // Position carries no meaning, but it has to be the same meaninglessness every
  // time. If All -> Work -> All moves people, the drawing looks like it is
  // reshuffling at random.
  const ids = Array.from({ length: 7 }, (_, i) => `amber-${i}`);
  const work = circle('Work', ids.slice(0, 3).map((id, i) => member(`P${i}`, { amberId: id })), 'w');
  const rest = circle('Rest', ids.slice(3).map((id, i) => member(`Q${i}`, { amberId: id })), 'r');
  const web = sortPeople(buildWeb({ connections: ids.map((id, i) => connection(`Name ${i}`, id)), circles: [work, rest] }));

  const before = layoutWeb(web, 140).map((p) => [p.person.key, p.x, p.y]);
  const filtered = layoutWeb(sortPeople(filterByCircle(web, 'w')), 140);
  const after = layoutWeb(sortPeople(filterByCircle(web, null)), 140).map((p) => [p.person.key, p.x, p.y]);

  assert.deepEqual(after, before, 'coming back from a filter moved people');
  assert.equal(filtered.length, 3);
});

test('the relative order of a subset matches the order it had in the whole', () => {
  const people: WebPerson[] = ['Zoe', 'Ada', 'Mo', 'Bea'].map((n, i) => ({
    key: `k${i}`,
    kind: 'connection',
    amberId: `a${i}`,
    contactId: null,
    name: n,
    initials: initialsOf(n),
    avatarUrl: null,
    username: null,
    circleIds: i % 2 === 0 ? ['w'] : [],
  }));
  const all = sortPeople(people).map((p) => p.name);
  const subset = sortPeople(filterByCircle(people, 'w')).map((p) => p.name);
  const expected = all.filter((n) => subset.includes(n));
  assert.deepEqual(subset, expected, 'the subset came back in a different order than the whole');
});

test('connections come before suggestions, so the real people hold the top of the ring', () => {
  const web = sortPeople(
    buildWeb({
      connections: [connection('Zzz Last')],
      circles: [circle('Work', [member('Aaa First')])],
    }),
  );
  assert.equal(web[0]!.kind, 'connection', 'a suggestion outranked a real connection');
});

// ── layout ──────────────────────────────────────────────────────────────────

const ring = (n: number): WebPerson[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `k${i}`, kind: 'connection' as const, amberId: `a${i}`, contactId: null,
    name: `P${i}`, initials: 'PP', avatarUrl: null, username: null,
    // Real connections: `kind` says they are on Amber and `connected` says you
    // have actually connected, which is what pulls them toward the middle.
    connected: true, circleIds: [],
  }));

test('every node lands inside the board, at every count', () => {
  const rx = 140;
  const ry = 182;
  for (let n = 1; n <= 24; n += 1) {
    const placed = layoutWeb(ring(n), rx, ry);
    assert.equal(placed.length, n);
    for (const p of placed) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `n=${n} produced a non-finite position`);
      assert.ok(Math.abs(p.x) <= rx + 0.5, `n=${n} put a node outside the board horizontally`);
      assert.ok(Math.abs(p.y) <= ry + 0.5, `n=${n} put a node outside the board vertically`);
      assert.ok(p.d >= 30, `n=${n} produced a ${p.d}pt disc, too small to tap`);
      assert.ok(p.labelWidth >= p.d, `n=${n} gave a label less room than the disc it sits under`);
    }
  }
});

test('nodes do not overlap on a single ring', () => {
  // The reason discs shrink with count. If two adjacent nodes are closer than
  // their diameter, the ring reads as a smear.
  for (let n = 2; n <= 12; n += 1) {
    const placed = layoutWeb(ring(n), 150, 195);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const gap = Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y);
        assert.ok(gap >= placed[i]!.d * 0.9, `n=${n}: nodes ${i} and ${j} are ${gap.toFixed(1)} apart at ${placed[i]!.d}pt`);
      }
    }
  }
});

test('NAMES CANNOT OVERLAP: no label is wider than the room beside it', () => {
  /**
   * THE COMPLAINT THIS IS FOR, from a screenshot of the real app: "the names are
   * scrunched together". Labels were a flat 92pt wide regardless of how many
   * people were on the ring, so at eleven nodes "Anish Ravindra" ran straight
   * through "Beau La Du" and both were unreadable.
   *
   * A label may be at most the distance to the next node. Checked against the
   * measured neighbor distance rather than the value the layout believes, so a
   * wrong `gap` cannot certify itself.
   */
  for (let n = 2; n <= 24; n += 1) {
    const placed = layoutWeb(ring(n), 150, 195);
    for (let i = 0; i < placed.length; i += 1) {
      /**
       * NEIGHBORS ARE READ OFF `ring`, NOT OFF THE RADIUS.
       *
       * The first version of this test grouped nodes by their distance to the
       * middle, which is exactly the mistake the `ring` field exists to prevent:
       * on a stretched ring the radius sweeps continuously between rx and ry, so
       * an outer node at the side is CLOSER to the center than an inner node at
       * the top. The grouping was nonsense and the test failed on layouts that
       * were fine.
       */
      const sameRing = placed.filter((q, j) => j !== i && q.ring === placed[i]!.ring);
      if (sameRing.length === 0) continue;
      const nearest = Math.min(
        ...sameRing.map((q) => Math.hypot(q.x - placed[i]!.x, q.y - placed[i]!.y)),
      );
      assert.ok(
        placed[i]!.labelWidth <= nearest + 0.5,
        `n=${n}: a ${placed[i]!.labelWidth}pt label sits ${nearest.toFixed(1)}pt from its neighbor`,
      );
    }
  }
});

test('a stretched ring spaces people evenly instead of clumping at the ends', () => {
  /**
   * Stepping the ANGLE on an ellipse bunches points at the ends of the long
   * axis; walking the perimeter does not. What is uniform under equal-arc
   * placement is the arc, not the chord -- the chord is necessarily shorter
   * wherever the curve is tighter -- so the honest assertion is that the chord
   * variation stays within what curvature alone explains. Angle-stepping this
   * ellipse produces a spread over 2x; equal arc holds it near 1.2.
   */
  const placed = layoutWeb(ring(12), 140, 196);
  assert.ok(placed.every((p) => p.ring === 0), 'twelve should be one ring');
  const gaps = placed.map((a, i) => {
    const b = placed[(i + 1) % placed.length]!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  const lo = Math.min(...gaps);
  const hi = Math.max(...gaps);
  assert.ok(hi / lo < 1.35, `spacing varies from ${lo.toFixed(1)} to ${hi.toFixed(1)} around the ring`);

  /**
   * EVERY NODE IS ON THE ELLIPSE, TIMES ITS OWN STRAY.
   *
   * It used to be exactly on the ellipse, and this test asserted that. Nodes now
   * stray radially on purpose -- connections pulled in, suggestions pushed out,
   * plus a per-person wobble -- so the invariant is weaker and more useful: each
   * one is still on a RAY from the middle through its ellipse point, at a
   * distance inside the declared band. That is what keeps its line pointing at
   * it. A node knocked sideways would leave its own spoke.
   */
  for (const p of placed) {
    const t = Math.hypot(p.x / 140, p.y / 196);
    assert.ok(t > 0.8 && t < 1.01, `a node strayed out of the band (${t.toFixed(3)})`);
  }
});

test('eleven people -- the real case from the app -- land on ONE ring', () => {
  // The screenshot that prompted this: eleven nodes split across two interleaved
  // rings, which is what "the web looks jumbled" was describing.
  const placed = layoutWeb(ring(11), 150, 195);
  assert.ok(placed.every((p) => p.ring === 0), 'eleven people should not be split over two rings');
});

test('A CONNECTION CARRIES THE CARD TO OPEN, NOT JUST THE ACCOUNT', () => {
  /**
   * Tapping somebody used to push /u/<amberId>, which draws the Amber profile --
   * and an account that has filled nothing in renders as "Amber user". That is a
   * stranger's screen for a person whose card you have been keeping notes on for
   * months, and the card was one field away the whole time.
   */
  const withCard = buildWeb({
    connections: [{
      connectionId: 'c1',
      connectedAt: '2026-01-01T00:00:00.000Z',
      user: {
        amberId: 'amber-1', contactId: 'contact-1', username: null, fullName: 'Caleb',
        avatarUrl: null, occupation: null, currentCity: null,
      },
    }],
    circles: [],
  });
  assert.equal(withCard[0]!.contactId, 'contact-1');

  // NO CARD IS A REAL STATE: connected by a link, never in the address book. It
  // must stay null so the caller falls back to the Amber profile rather than
  // pushing a route with "undefined" in it.
  const noCard = buildWeb({
    connections: [connection('Linked Only', 'amber-2')],
    circles: [],
  });
  assert.equal(noCard[0]!.contactId, null);
});

test('an older server that sends no contactId is covered by circle membership', () => {
  // The app and the server ship separately. A circle member already carries the
  // account id and the card id side by side, so anybody filed in a circle
  // resolves without the new field at all.
  const web = buildWeb({
    connections: [connection('Shirley Park', 'amber-shirley')],
    circles: [circle('Work', [member('Shirley Park', { amberId: 'amber-shirley', contactId: 'card-shirley' })])],
  });
  assert.equal(web[0]!.contactId, 'card-shirley');
});

test('the server field wins over the circle-derived guess', () => {
  const web = buildWeb({
    connections: [{
      connectionId: 'c1',
      connectedAt: '2026-01-01T00:00:00.000Z',
      user: {
        amberId: 'amber-1', contactId: 'authoritative', username: null, fullName: 'X',
        avatarUrl: null, occupation: null, currentCity: null,
      },
    }],
    circles: [circle('W', [member('X', { amberId: 'amber-1', contactId: 'stale-guess' })])],
  });
  assert.equal(web[0]!.contactId, 'authoritative');
});

// ── character: the ring is not a pie chart ──────────────────────────────────

const mixed = (conns: number, suggs: number): WebPerson[] => [
  ...Array.from({ length: conns }, (_, i) => ({
    key: `c${i}`, kind: 'connection' as const, amberId: `a${i}`, contactId: null,
    name: `Conn ${i}`, initials: 'CC', avatarUrl: null, username: null, circleIds: [],
  })),
  ...Array.from({ length: suggs }, (_, i) => ({
    key: `s${i}`, kind: 'suggestion' as const, amberId: null, contactId: `k${i}`,
    name: `Sugg ${i}`, initials: 'SS', avatarUrl: null, username: null, circleIds: [],
  })),
];

test('YOUR REAL CONNECTIONS HOLD THE WHOLE RING, not one corner of it', () => {
  /**
   * Straight off the screenshot: three connections and eight suggestions put all
   * three connections in consecutive slots, so the web was a corner of real
   * people with a long gray tail. sortPeople puts connections first on purpose
   * (they take the top of the ring) and the layout then dealt slots in order,
   * which turned "first" into "bunched".
   */
  const people = arrangeAroundRing(mixed(3, 8));
  const at = people.map((p, i) => (p.kind === 'connection' ? i : -1)).filter((i) => i >= 0);
  assert.equal(at.length, 3);
  // Evenly spaced around eleven slots: no two adjacent, and the widest gap is
  // not much bigger than the narrowest.
  const gaps = at.map((slot, i) => {
    const next = at[(i + 1) % at.length]!;
    return (next - slot + people.length) % people.length;
  });
  assert.ok(Math.min(...gaps) >= 3, `connections are bunched: slots ${at.join(', ')}`);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `uneven spread: gaps ${gaps.join(', ')}`);
});

test('the arrangement keeps everybody, exactly once, whatever the mix', () => {
  for (const [c, s] of [[0, 0], [1, 0], [0, 1], [1, 1], [3, 8], [8, 3], [5, 5], [1, 11], [11, 1], [7, 2]]) {
    const input = mixed(c, s);
    const out = arrangeAroundRing(input);
    assert.equal(out.length, input.length, `${c}+${s} changed the count`);
    assert.equal(new Set(out.map((p) => p.key)).size, input.length, `${c}+${s} dropped or duplicated somebody`);
    assert.ok(out.every((p) => p != null), `${c}+${s} left a hole`);
  }
});

test('one kind only is left exactly as it was', () => {
  const onlyConns = mixed(4, 0);
  assert.deepEqual(arrangeAroundRing(onlyConns).map((p) => p.key), onlyConns.map((p) => p.key));
  const onlySuggs = mixed(0, 4);
  assert.deepEqual(arrangeAroundRing(onlySuggs).map((p) => p.key), onlySuggs.map((p) => p.key));
});

test('EVERY VARIATION IS THE PERSON, NOT A DICE ROLL', () => {
  /**
   * The whole point of deriving the stray and the bow from the key: a web that
   * re-rolled them would twitch on every render of a screen that re-renders on
   * every frame of a pan. Same input, same drawing, forever.
   */
  const people = mixed(3, 8);
  const a = layoutWeb(people, 150, 195);
  const b = layoutWeb(people, 150, 195);
  assert.deepEqual(
    a.map((p) => [p.person.key, p.x, p.y, p.d, p.bow]),
    b.map((p) => [p.person.key, p.x, p.y, p.d, p.bow]),
    'two layouts of the same people disagree',
  );
  // And the hash itself is stable and in range.
  for (const k of ['', 'a', 'Caleb', 'c:amber-1234', '🙂', 'x'.repeat(500)]) {
    const h = hash01(k);
    assert.ok(h >= 0 && h < 1 && Number.isFinite(h), `hash01(${JSON.stringify(k)}) = ${h}`);
    assert.equal(h, hash01(k));
  }
  // Different keys mostly differ -- a hash that collapsed would make every node
  // stray identically, which is the tabular look it exists to break.
  const spread = new Set(Array.from({ length: 200 }, (_, i) => hash01(`key-${i}`).toFixed(4)));
  assert.ok(spread.size > 190, `hash collapses: only ${spread.size} distinct values in 200`);
});

test('nobody sits at exactly the same distance, and connections sit closer in', () => {
  const placed = layoutWeb(mixed(4, 6), 150, 195);
  const radii = placed.map((p) => Math.hypot(p.x, p.y));
  assert.ok(new Set(radii.map((r) => r.toFixed(2))).size > 1, 'every node is at an identical radius');

  // The stray MEANS something: the people you have are nearer than the people
  // you could have. Compared on the ellipse parameter rather than raw radius,
  // since a stretched ring makes the top naturally further than the side.
  const bx = 150 / 1.11;
  const by = 195 / 1.11;
  const t = (p: (typeof placed)[number]) => Math.hypot(p.x / bx, p.y / by);
  const conns = placed.filter((p) => p.person.kind === 'connection').map(t);
  const suggs = placed.filter((p) => p.person.kind === 'suggestion').map(t);
  assert.ok(Math.max(...conns) < Math.min(...suggs), 'a suggestion sits nearer you than a connection');
});

/**
 * THE TWO REAL SURFACES, DERIVED THE WAY THE COMPONENT DERIVES THEM.
 *
 * Every geometric test below went through a board it made up -- `layoutWeb(x,
 * 150, 195)`, or `rx * 1.3` copied out of the component and left behind when the
 * component changed. So the shapes being checked were not the shapes on screen,
 * and the suite stayed green through a hub drawn at 0.66 while the layout
 * planned for 0.42, a card handed everybody at a fixed size, and an overlay
 * letterboxed into two thirds of its own screen.
 *
 * One place, both surfaces, matching ConnectionsWeb.tsx: the CARD is a fixed
 * square with no names, the OVERLAY grows its board with boardForCount and pans.
 */
const RING_STRETCH = 1.6;

function cardBoard(screenW = 330) {
  const rx = Math.max(40, screenW / 2 - 30);
  return { rx, ry: rx, labels: false as const };
}

function overlayBoard(n: number, screenW = 393, screenH = 640) {
  const board = boardForCount(n, { rx: screenW / 2, ry: screenH / 2 });
  const rx = Math.max(40, board.rx - 62);
  return { rx, ry: Math.max(40, Math.min(board.ry - 62, rx * RING_STRETCH)), labels: true as const };
}

/** Every surface a person could be looking at, for a given crowd. */
function surfaces(n: number) {
  const card = cardBoard();
  return [
    { name: 'card', ...card, cap: webCapacity(card.rx, card.ry, { labels: false }) },
    { name: 'overlay', ...overlayBoard(n), cap: Number.POSITIVE_INFINITY },
    { name: 'overlay/small', ...overlayBoard(n, 320, 500), cap: Number.POSITIVE_INFINITY },
  ];
}

/** Lay out exactly what that surface would draw, including its own cap. */
function onSurface(n: number, s: { rx: number; ry: number; labels: boolean; cap: number }) {
  const all = mixed(Math.min(3, n), Math.max(0, n - 3));
  return layoutWeb(all.slice(0, Math.min(all.length, s.cap)), s.rx, s.ry, { labels: s.labels });
}

/** Do two segments properly cross? Touching endpoints do not count. */
function segmentsCross(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): boolean {
  const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const E = 1e-9;
  const d1 = side(a, b, c), d2 = side(a, b, d), d3 = side(c, d, a), d4 = side(c, d, b);
  return ((d1 > E && d2 < -E) || (d1 < -E && d2 > E)) && ((d3 > E && d4 < -E) || (d3 < -E && d4 > E));
}

/** Shortest distance from a point to a segment. The exact test, not a proxy. */
function pointToSegment(
  p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Closest approach between two segments. Zero when they touch or cross. */
function segmentGap(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointToSegment(a, c, d), pointToSegment(b, c, d),
    pointToSegment(c, a, b), pointToSegment(d, a, b),
  );
}

const CROWDS = [1, 2, 3, 5, 8, 11, 12, 13, 18, 24, 33, 48, 66, 100, 150];

test('the stray never pushes anybody outside the board it was given', () => {
  for (let n = 1; n <= 20; n += 1) {
    for (const placed of [layoutWeb(mixed(n, 0), 150, 195), layoutWeb(mixed(0, n), 150, 195)]) {
      for (const p of placed) {
        assert.ok(Math.abs(p.x) <= 150.5, `n=${n}: x=${p.x.toFixed(1)} is off the board`);
        assert.ok(Math.abs(p.y) <= 195.5, `n=${n}: y=${p.y.toFixed(1)} is off the board`);
      }
    }
  }
});

test('NO TWO FACES OVERLAP, on either surface, at any count', () => {
  /**
   * "Nothing should be touching other circles."
   *
   * THIS TEST HAS BEEN WRONG TWICE, in the same way both times: it invented a
   * board. First it looked at ONE ring, so eighteen people on three rings with a
   * radial step smaller than the disc went unseen. Then it used
   * `Math.min(board.ry - 62, (board.rx - 62) * 1.3)` -- the component's stretch,
   * copied, and stale the moment the component raised it. And it never looked at
   * the profile card at all, which is the surface that was actually broken:
   * thirty-three people on a fixed 330pt square came out overlapping by 7.8pt
   * and forty-eight by 14.7pt, green the whole time.
   *
   * Both surfaces, from one definition of what they are, every count.
   */
  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = placed[i]!;
          const b = placed[j]!;
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.d + b.d) / 2;
          assert.ok(
            gap >= 0,
            `${s.name} n=${n}: ${a.person.name} and ${b.person.name} overlap by ${(-gap).toFixed(1)}pt`,
          );
        }
      }
    }
  }
});

test('NOTHING TOUCHES THE CENTER CIRCLE -- not a face, not a line', () => {
  /**
   * "I want the ones that you're connected with to be closer, obviously, but not
   *  close enough to actually touch the center circle. Nothing should be
   *  touching the center circle."
   *
   * AGAINST hubDiameter, WHICH IS NOW THE ONLY HUB THERE IS. The component used
   * to carry its own copy of this formula at 0.66 while the layout cleared the
   * ring against 0.42 -- so on the profile card the drawn hub had radius 43
   * inside a ring cleared for 28, the first ring of people was drawn on the edge
   * of your own face, and every clearance proved anywhere was about a circle
   * that is not the one on screen. A test that imports the same function the
   * component now calls is the only version of this that means anything.
   */
  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      const hubR = hubDiameter(s.rx, s.ry) / 2;
      for (const p of placed) {
        const gap = Math.hypot(p.x, p.y) - p.d / 2 - hubR;
        assert.ok(
          gap > 0,
          `${s.name} n=${n}: ${p.person.name} is on your own face by ${(-gap).toFixed(1)}pt`,
        );
        for (let i = 0; i + 1 < p.path.length; i += 1) {
          const clear = pointToSegment({ x: 0, y: 0 }, p.path[i]!, p.path[i + 1]!) - hubR;
          assert.ok(
            clear > 0,
            `${s.name} n=${n}: ${p.person.name}'s line runs into the hub by ${(-clear).toFixed(1)}pt`,
          );
        }
      }
    }
  }
});

test('LINES CANNOT CROSS, and the shape tested is the shape drawn', () => {
  /**
   * "Nothing should be overlaying. Not even lines should be crossing."
   *
   * THE PREVIOUS VERSION OF THIS TEST BUILT ITS OWN LINES. It took each node,
   * normalized the vector to it, and checked straight segments from `spokeFrom`
   * to the disc's edge -- a faithful copy of what the component drew at the time,
   * and therefore a test of its own arithmetic. The moment the layout started
   * producing curves, the test went on measuring rays: it would have passed a
   * build whose lines crossed everywhere on screen. It nearly did. The component
   * was still drawing `M x1 y1 L x2 y2` and ignoring the curve the layout had
   * already computed, so for a while BOTH were wrong in the same direction and
   * nothing said so.
   *
   * `p.path` is the geometry the component renders, point for point. Reading it
   * here is the only way this assertion is about the picture.
   */
  assert.equal(MAX_BOW, 0, 'a per-person bow is the one thing that makes two lines cross');

  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const A = placed[i]!.path;
          const B = placed[j]!.path;
          for (let a = 0; a + 1 < A.length; a += 1) {
            for (let b = 0; b + 1 < B.length; b += 1) {
              assert.ok(
                !segmentsCross(A[a]!, A[a + 1]!, B[b]!, B[b + 1]!),
                `${s.name} n=${n}: ${placed[i]!.person.name} and ${placed[j]!.person.name} cross`,
              );
            }
          }
        }
      }
    }
  }
});

test('NO TWO LINES EVEN COME CLOSE, which is what holds the ceilings honest', () => {
  /**
   * Not crossing is the floor. Two lines converging until they read as one is
   * the same complaint one step milder -- and it is the failure mode the FOUR
   * ceilings on the lean exist to prevent, of which only three ever visibly
   * bind. Without this, leanCapForPhases is a comment: deleting it entirely
   * leaves every other test in this file green.
   *
   * So the property is asserted directly. Closest approach between any two
   * lines anywhere on the board, against the clearance two 1.25pt strokes
   * actually need. If a future change to the twist, the lean or the stubs lets
   * lines converge, this is what says so -- whichever ceiling was responsible.
   */
  const CLEAR = 3.5;
  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const A = placed[i]!.path;
          const B = placed[j]!.path;
          let near = Number.POSITIVE_INFINITY;
          for (let a = 0; a + 1 < A.length; a += 1) {
            for (let b = 0; b + 1 < B.length; b += 1) {
              near = Math.min(near, segmentGap(A[a]!, A[a + 1]!, B[b]!, B[b + 1]!));
            }
          }
          assert.ok(
            near >= CLEAR,
            `${s.name} n=${n}: ${placed[i]!.person.name} and ${placed[j]!.person.name} run ${near.toFixed(2)}pt apart`,
          );
        }
      }
    }
  }
});

test('THE LINES CURVE. A web of straight spokes is a diagram of a wheel', () => {
  /**
   * "They can be crisscrossing and going all over the place, not crisscrossing
   *  per se in terms of the lines, but curving around and going all over the
   *  place. They can be creatively all over the place."
   *
   * The no-crossing test above is satisfied perfectly by straight rays from one
   * point, and that is what shipped first: correct, and the thing he was asking
   * to have changed. So the two properties are asserted TOGETHER -- satisfy one
   * by giving up the other and this fails.
   *
   * Measured as sagitta: how far the middle of the line sits off the straight
   * chord between its ends, as a fraction of that chord. Zero is a ray.
   */
  for (const n of [8, 18, 33]) {
    const s = surfaces(n)[1]!;
    const placed = onSurface(n, s);
    const bows = placed
      .filter((p) => p.path.length >= 3)
      .map((p) => {
        const a = p.path[0]!;
        const b = p.path[p.path.length - 1]!;
        const mid = p.path[Math.floor((p.path.length - 1) / 2)]!;
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        return chord > 0 ? pointToSegment(mid, a, b) / chord : 0;
      });
    assert.ok(bows.length > 0, `n=${n}: no lines were drawn at all`);
    const most = Math.max(...bows);
    assert.ok(most > 0.01, `n=${n}: every line is straight (widest bow ${most.toFixed(4)})`);
  }
});

test('A LINE NEVER RUNS UNDER SOMEBODY ELSE FACE', () => {
  /**
   * "Nothing should be touching other circles" covers the lines too -- a spoke
   * crossing a stranger's disc reads as a tie to that stranger.
   *
   * THE STUB LENGTH IS WHAT THIS CATCHES. It used to be "one ring step, inward",
   * which sounds like it stays in its own lane and does not: the node is a disc
   * and so is the ring below, so a stub one full step long ended half a disc PAST
   * the outer edge of the ring inside it -- through a face. withSpokes measures
   * how far that ring actually reaches now.
   *
   * A node's own line is excluded, because it is supposed to end there.
   */
  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      for (const p of placed) {
        for (const q of placed) {
          if (q === p) continue;
          for (let i = 0; i + 1 < p.path.length; i += 1) {
            const clear = pointToSegment({ x: q.x, y: q.y }, p.path[i]!, p.path[i + 1]!) - q.d / 2;
            assert.ok(
              clear > 0,
              `${s.name} n=${n}: ${p.person.name}'s line crosses ${q.person.name} by ${(-clear).toFixed(1)}pt`,
            );
          }
        }
      }
    }
  }
});

test('EVERY LINE ENDS ON ITS OWN FACE', () => {
  /**
   * The curve and the node used to be derived two different ways -- the layout
   * placed the node from (arc position, radius), and spiralPath inverted x and y
   * to recover those numbers. Two derivations of one fact, which drifted every
   * time the placement changed and put lines pointing at nobody on screen. arcS
   * and radiusF are carried now, and this says the two cannot disagree again.
   */
  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      for (const p of placed) {
        if (p.path.length < 2) continue;
        const far = p.path[p.path.length - 1]!;
        const reach = Math.hypot(far.x - p.x, far.y - p.y);
        assert.ok(
          reach >= p.d / 2 - 0.01,
          `${s.name} n=${n}: ${p.person.name}'s line ends ${(p.d / 2 - reach).toFixed(1)}pt under their face`,
        );
        assert.ok(
          reach <= p.d / 2 + Math.max(14, p.d),
          `${s.name} n=${n}: ${p.person.name}'s line stops ${reach.toFixed(1)}pt short of them`,
        );
      }
    }
  }
});

test('unitEllipseAt WALKS THE PERIMETER, which is the claim everything rests on', () => {
  /**
   * THE RING-SPACING TEST BELOW IS BOOKKEEPING WITHOUT THIS ONE, and that was
   * found by mutation rather than by thinking. `A RING IS EVENLY SPACED` asserts
   * that arcS values come out 1/m apart -- which they do BY CONSTRUCTION, they
   * are literally `i / m`, so it passes whatever unitEllipseAt then does with
   * them. Replacing the entire arc-length table with the naive parametric angle
   * (the original bug, restored on purpose) left that test green.
   *
   * So the table is checked on its own terms, and checked as ARC LENGTH rather
   * than as the distance between the points it returns. Equal arc is not equal
   * chord -- the chord cuts the corner, and cuts more where the curve bends
   * harder, so on a 1.6:1 ellipse three points have chords varying by 1.36x and
   * forty by 1.004x, both correct. Measuring chords means picking a fudge factor
   * per count and hoping it is under the bug; measuring arc length is EXACT, to
   * five decimal places, at every ratio and every count.
   *
   * The parametric version misses this by the whole stretch, which is the point.
   */
  for (const ratio of [1, 1.3, 1.6, 2, 3]) {
    const at = unitEllipseAt(ratio);
    for (const m of [3, 7, 12, 40]) {
      const arcs = Array.from({ length: m }, (_, i) => {
        const from = i / m;
        let length = 0;
        let prev = at(from);
        for (let k = 1; k <= 1000; k += 1) {
          const q = at(from + k / (1000 * m));
          length += Math.hypot(q.x - prev.x, q.y - prev.y);
          prev = q;
        }
        return length;
      });
      const lo = Math.min(...arcs);
      const hi = Math.max(...arcs);
      assert.ok(
        hi / lo < 1.001,
        `ratio ${ratio}, m=${m}: arcs run ${lo.toFixed(5)} to ${hi.toFixed(5)} (x${(hi / lo).toFixed(5)})`,
      );
    }
  }

  // AND IT WRAPS, because the twist carries a line's arc position past the top
  // and a discontinuity there is a kink in that line and a tear in the ring.
  const at = unitEllipseAt(1.6);
  for (const s of [0, 0.25, 0.5, 0.9]) {
    const a = at(s);
    for (const k of [-2, -1, 1, 3]) {
      const b = at(s + k);
      assert.ok(
        Math.hypot(a.x - b.x, a.y - b.y) < 1e-9,
        `at(${s}) and at(${s + k}) are different points, so a twist past the top tears`,
      );
    }
  }
});

test('A RING IS EVENLY SPACED, and stays so however far it is stretched', () => {
  /**
   * "They should be spaced out well."
   *
   * THE BUG THIS EXISTS FOR, measured on a twelve-person ring: gaps of 71-76pt
   * with no twist, 52-98pt with it. Adding a constant to an ellipse's PARAMETRIC
   * angle is not a rotation -- it slides points along the curve, and arc length
   * is not linear in the parameter, so equal spacing dies exactly where the
   * ellipse is tightest. The whole layout moved into arc-length space for this;
   * see SPIRAL_S.
   *
   * ASSERTED IN ARC POSITION, which is where the invariant lives. The chord
   * between two neighbors varies on a stretched ellipse no matter what -- that is
   * what a stretch IS -- so a chord check would be either loose enough to pass
   * the bug or tight enough to forbid the stretch. arcS is exact: 1/m, every gap,
   * at any ratio.
   */
  assert.ok(SPIRAL_S > 0, 'a twist of zero would make this test vacuous');

  for (const n of [3, 7, 12, 18, 33, 64]) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      const byRing = new Map<number, typeof placed>();
      for (const p of placed) {
        const list = byRing.get(p.ring) ?? [];
        list.push(p);
        byRing.set(p.ring, list);
      }
      for (const [r, list] of byRing) {
        if (list.length < 3) continue;
        const sorted = [...list].sort((a, b) => a.arcS - b.arcS);
        const gaps = sorted.map((p, i) =>
          i + 1 < sorted.length ? sorted[i + 1]!.arcS - p.arcS : 1 - p.arcS + sorted[0]!.arcS,
        );
        const want = 1 / sorted.length;
        for (const g of gaps) {
          assert.ok(
            Math.abs(g - want) < 1e-6,
            `${s.name} n=${n} ring ${r}: a gap is ${(g * 100).toFixed(2)}% of the ring, not ${(want * 100).toFixed(2)}%`,
          );
        }
      }
    }
  }
});

test('AND THE STRETCH DOES NOT CLUMP ANYBODY ON THE BOARD EITHER', () => {
  /**
   * The arc-position check above is exact but abstract: equal arc spacing is only
   * worth having because it stops people bunching where the ellipse turns. This
   * is the same claim in points -- loose enough to allow the geometry a stretched
   * ring genuinely has, tight enough to fail the bug, which came out at 1.85
   * between the widest and narrowest gap on one ring.
   */
  for (const n of [7, 12, 18, 33, 64]) {
    const s = surfaces(n)[1]!;
    const placed = onSurface(n, s);
    const byRing = new Map<number, typeof placed>();
    for (const p of placed) {
      const list = byRing.get(p.ring) ?? [];
      list.push(p);
      byRing.set(p.ring, list);
    }
    for (const [r, list] of byRing) {
      if (list.length < 4) continue;
      const sorted = [...list].sort((a, b) => a.arcS - b.arcS);
      const gaps = sorted.map((p, i) => {
        const q = sorted[(i + 1) % sorted.length]!;
        return Math.hypot(p.x - q.x, p.y - q.y);
      });
      const lo = Math.min(...gaps);
      const hi = Math.max(...gaps);
      assert.ok(
        hi / lo < 1.6,
        `n=${n} ring ${r}: spacing varies from ${lo.toFixed(1)} to ${hi.toFixed(1)}pt (x${(hi / lo).toFixed(2)})`,
      );
    }
  }
});

test('THE CARD DRAWS ONLY WHAT FITS, and webCapacity is what the layout agrees to', () => {
  /**
   * The card is a fixed square, so when it is handed more people than it can
   * hold, ringPlan's last resort fires -- "whatever is left goes on the outermost
   * one" -- and faces overlap. That note says "boardForCount is what stops this
   * happening in the app", which was true of the overlay and false of the card.
   *
   * So the card asks. Two halves, and the second is the one that matters: the
   * number has to be REAL (laying out exactly that many overlaps nobody) and it
   * has to be HONEST (it is near the actual limit, not far under it). Without the
   * second half, webCapacity could quietly decay into "show five" and every other
   * test here would be greener for it.
   */
  const card = cardBoard();
  const cap = webCapacity(card.rx, card.ry, { labels: false });
  assert.ok(cap >= 8, `a phone-width card should hold more than ${cap} faces`);

  const atCap = layoutWeb(mixed(3, cap - 3), card.rx, card.ry, { labels: false });
  assert.equal(atCap.length, cap, 'the layout dropped somebody the cap allowed');
  for (let i = 0; i < atCap.length; i += 1) {
    for (let j = i + 1; j < atCap.length; j += 1) {
      const a = atCap[i]!;
      const b = atCap[j]!;
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.d + b.d) / 2;
      assert.ok(gap >= 0, `at the cap of ${cap}, two faces overlap by ${(-gap).toFixed(1)}pt`);
    }
  }

  const over = layoutWeb(mixed(3, cap * 2 - 3), card.rx, card.ry, { labels: false });
  let worst = Number.POSITIVE_INFINITY;
  for (let i = 0; i < over.length; i += 1) {
    for (let j = i + 1; j < over.length; j += 1) {
      const a = over[i]!;
      const b = over[j]!;
      worst = Math.min(worst, Math.hypot(a.x - b.x, a.y - b.y) - (a.d + b.d) / 2);
    }
  }
  assert.ok(worst < 0, 'twice the cap still fits comfortably, so the cap is far too low');
});

test('A NAME DEGRADES full name, then first name, then nothing', () => {
  /**
   * THIS REPLACES A TEST OF labelFor, WHICH WAS DEAD. labelFor took a name and a
   * width and returned whichever form fit -- and nothing called it. The layout
   * moved to resolveLabels, which tests each form against the whole board rather
   * than against one width allowance, and the old function stayed exported, still
   * tested, still looking like the thing that decides a name. It was the screen
   * contract that noticed, by way of the component no longer mentioning it.
   *
   * The property survived the function, so it is asserted where it now lives:
   * whatever a node ends up labeled with is one of exactly three things, and on a
   * tight board at least one person really does get shortened rather than every
   * name being all-or-nothing.
   */
  const forms = (name: string) => {
    const full = name.trim();
    const first = full.split(/\s+/)[0]!;
    return [full, first, ''];
  };

  let sawShortened = false;
  let sawDropped = false;
  let sawFull = false;
  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      for (const p of onSurface(n, s)) {
        const allowed = forms(p.person.name);
        assert.ok(
          allowed.includes(p.label),
          `${s.name} n=${n}: ${p.person.name} is labeled "${p.label}", which is not a form of their name`,
        );
        if (p.label === p.person.name.trim()) sawFull = true;
        else if (p.label === '') sawDropped = true;
        else sawShortened = true;
      }
    }
  }
  assert.ok(sawFull, 'nobody anywhere got their whole name, so the resolver is too timid');
  assert.ok(sawShortened, 'no name was ever shortened to a first name -- the middle form is dead');
  assert.ok(sawDropped, 'no name was ever dropped, so the crowded cases are not being reached');
});

test('A LINE NEVER RUNS THROUGH SOMEBODY ELSE\'S NAME -- the real line', () => {
  /**
   * "The lines for the connections go through their names."
   *
   * THE RESOLVER GOT THIS WRONG TWICE. First it ignored the lines. Then it
   * rebuilt them as ONE STRAIGHT SEGMENT from spokeFrom to the disc's edge --
   * correct while lines were rays, and badly wrong once they were spirals, since
   * the chord between a spiral's ends can be tens of points from the spiral in
   * the middle. So it was clearing names off a line nobody draws while letting
   * them sit on the one that is there.
   *
   * Tested against `p.path`, segment by segment, which is what the component
   * renders.
   *
   * AND IT REPLACES A TEST THAT HAD THE SAME NAME AND THE SAME STRAIGHT-SEGMENT
   * MISTAKE. That one carried a note worth keeping: withSpokes giving an outer
   * node a short stub instead of a full line to the middle is INVISIBLE to every
   * other assertion in this file -- "I removed it on purpose and the suite stayed
   * green". Still true, and still the reason a label-versus-line test has to
   * exist at all; it is just that measuring the wrong line made it defend the
   * stub against a shape the app does not draw.
   */
  for (const n of CROWDS) {
    for (const s of surfaces(n)) {
      const placed = onSurface(n, s);
      for (const p of placed) {
        if (!p.label) continue;
        const w = p.label.length * LABEL_CHAR_PT;
        const top = p.labelAbove
          ? p.y - p.d / 2 - LABEL_GAP_Y - LABEL_LINE_H
          : p.y + p.d / 2 + LABEL_GAP_Y;
        const box = { left: p.x - w / 2, right: p.x + w / 2, top, bottom: top + LABEL_LINE_H };
        for (const q of placed) {
          if (q.person.key === p.person.key) continue;
          for (let i = 0; i + 1 < q.path.length; i += 1) {
            const a = q.path[i]!;
            const b = q.path[i + 1]!;
            const corners = [
              { x: box.left, y: box.top }, { x: box.right, y: box.top },
              { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom },
            ];
            const inside = a.x >= box.left && a.x <= box.right && a.y >= box.top && a.y <= box.bottom;
            const crosses = corners.some((c, k) =>
              segmentsCross(a, b, c, corners[(k + 1) % 4]!),
            );
            assert.ok(
              !inside && !crosses,
              `${s.name} n=${n}: ${q.person.name}'s line runs through "${p.label}"`,
            );
          }
        }
      }
    }
  }
});

test('NO NAME TOUCHES ANYTHING -- not another name, not a face', () => {
  /**
   * The complaint, verbatim: "a lot of the parts of the web are on top of each
   * other, and it looks messy and gross."
   *
   * The old rule capped each label at the distance to its NEAREST node, which is
   * often the ring inside or outside -- so the node actually sitting beside you
   * had no say, and "Sagar Tiwari" ran through "Rocky Pula". This asserts the
   * thing that was wanted rather than the proxy: every label box, against every
   * other label box and every disc on the board.
   */
  for (const [c, o] of [[3, 8], [3, 30], [6, 60]] as const) {
    const placed = layoutWeb(mixed(c, o), 150, 195);
    const boxes = placed
      .map((p) => ({
        p,
        w: p.label.length * LABEL_CHAR_PT,
        // ABOVE OR BELOW, as the resolver decided. The first version of this
        // test assumed always-below and therefore checked boxes that are not on
        // screen -- it failed on labels that do not overlap and would have
        // missed ones that do.
        top: p.labelAbove
          ? p.y - p.d / 2 - LABEL_GAP_Y - LABEL_LINE_H
          : p.y + p.d / 2 + LABEL_GAP_Y,
      }))
      .filter((b) => b.p.label.length > 0)
      .map((b) => ({
        name: b.p.person.name,
        left: b.p.x - b.w / 2,
        right: b.p.x + b.w / 2,
        top: b.top,
        bottom: b.top + LABEL_LINE_H,
      }));

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap =
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        assert.ok(!overlap, `"${a.name}" and "${b.name}" overlap at n=${c + o}`);
      }
    }

    for (const box of boxes) {
      for (const p of placed) {
        if (p.person.name === box.name) continue;
        const nx = Math.max(box.left, Math.min(p.x, box.right));
        const ny = Math.max(box.top, Math.min(p.y, box.bottom));
        assert.ok(
          Math.hypot(p.x - nx, p.y - ny) >= p.d / 2,
          `"${box.name}" is drawn over ${p.person.name}'s face at n=${c + o}`,
        );
      }
    }
  }
});

test('a crowded web drops the OUTER invites\' names, never your connections\'', () => {
  // Somebody has to lose their name when there is no room. It should be the
  // fortieth person on the outer ring, not one of the three you actually talk
  // to -- so the priority order in resolveLabels is asserted, not assumed.
  const placed = layoutWeb(mixed(3, 60), 150, 195);
  const named = placed.filter((p) => p.label.length > 0);
  assert.ok(named.length > 0, 'a web with nobody named at all is not the fix');
  for (const p of placed) {
    if (!p.person.connected) continue;
    assert.ok(p.label.length > 0, `${p.person.name} is a connection and lost their name`);
  }
});

test('a suggestion is drawn smaller than a connection, and still big enough to tap', () => {
  const placed = layoutWeb(mixed(3, 8), 150, 195);
  const conn = placed.find((p) => p.person.kind === 'connection')!;
  const sugg = placed.find((p) => p.person.kind === 'suggestion')!;
  assert.ok(sugg.d < conn.d, 'the people you have should carry more of the drawing');
  for (const p of placed) assert.ok(p.d >= 30, `a ${p.d}pt disc is too small to hit`);
});

test('a filter changing the count changes the drawing, which is the point', () => {
  const many = layoutWeb(ring(18), 150, 195);
  const few = layoutWeb(ring(3), 150, 195);
  assert.ok(few[0]!.d > many[0]!.d, 'filtering to three people should give them bigger discs');
  assert.ok(few[0]!.labelWidth > many[0]!.labelWidth, 'and more room for their names');
  // Eighteen goes onto two rings; three does not.
  const manyRadii = new Set(many.map((p) => Math.round(Math.hypot(p.x, p.y) / 10)));
  assert.ok(manyRadii.size > 1, 'eighteen nodes should use two rings');
});

test('a garbage radius yields no nodes rather than NaN positions', () => {
  for (const r of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(layoutWeb(ring(1), r), [], `radius ${r} should draw nothing`);
    assert.deepEqual(layoutWeb(ring(1), 120, r), [], `ry ${r} should draw nothing`);
  }
});

test('THE SAME PERSON IS NEVER BOTH A CONNECTION AND AN INVITE, EVEN UNLINKED', () => {
  /**
   * STRAIGHT OFF A SCREENSHOT OF THE RUNNING APP. "Sagar Tiwari" was drawn solid
   * as a real connection and, a few degrees away, faint with a dashed ring
   * offering to text him an invitation to Amber.
   *
   * The first guard only caught this when the SERVER had already resolved that
   * contact card to that Amber account. On a real book it often has not -- the
   * card holds an old number, or an email the account never registered -- so the
   * link is null and the card reads as a stranger who happens to have the same
   * name. Nothing about ids can see that; the name is the only thing the two
   * rows share.
   */
  const web = buildWeb({
    connections: [connection('Sagar Tiwari', 'amber-sagar')],
    circles: [
      circle('High School friends', [
        // No amberId and a DIFFERENT contact id: the card was never linked.
        member('Sagar Tiwari', { contactId: 'contact-sagar-unlinked' }),
        member('Beau La Du'),
      ]),
    ],
  });
  assert.equal(
    web.filter((p) => normalizeName(p.name) === 'sagar tiwari').length,
    1,
    'Sagar was drawn twice: once connected, once as somebody to invite',
  );
  assert.ok(web.some((p) => p.name === 'Beau La Du'), 'only the duplicate should be dropped');
});

test('the name fold is not fooled by case, accents or punctuation', () => {
  assert.equal(normalizeName('José  Ramírez'), 'jose ramirez');
  assert.equal(normalizeName('JOSE RAMIREZ'), 'jose ramirez');
  assert.equal(normalizeName("Grace O'Brien"), 'grace obrien');
  assert.equal(normalizeName('  Mina   Cho  '), 'mina cho');
  assert.equal(normalizeName(''), '');
  // Two different people are still two different people.
  assert.notEqual(normalizeName('Sagar Tiwari'), normalizeName('Sagar Tiwary'));
});

test('a nameless connection does not silently swallow every nameless suggestion', () => {
  // The name guard keys on the folded name, and "" folds to "". If an empty name
  // counted as a match, one account with no display name would suppress every
  // suggestion whose name failed to load.
  const web = buildWeb({
    connections: [{
      connectionId: 'c1',
      connectedAt: '2026-01-01T00:00:00.000Z',
      user: { amberId: 'a1', username: null, fullName: null, avatarUrl: null, occupation: null, currentCity: null },
    }],
    circles: [circle('W', [{ ...member(''), contactId: 'c-blank' }, member('Real Person')])],
  });
  assert.ok(
    web.some((p) => p.name === 'Real Person'),
    'a nameless connection suppressed a named suggestion',
  );
});

// ── the seam ────────────────────────────────────────────────────────────────

test('the suggestion source can be replaced, which is how onboarding will land', () => {
  const web = buildWeb({
    connections: [],
    circles: [circle('Work', [member('From Circles')])],
    suggestionsFrom: () => [
      { contactId: 'picked-1', name: 'Chosen In Onboarding', avatarUrl: null, circleIds: [] },
    ],
  });
  assert.deepEqual(web.map((p) => p.name), ['Chosen In Onboarding']);
});

test('circle-derived suggestions rank people in more circles first', () => {
  const shared = 'contact-shared';
  const seeds = suggestionsFromCircles([
    circle('Work', [member('In One')], 'w'),
    circle('Family', [member('In Two', { contactId: shared })], 'f'),
    circle('Friends', [member('In Two', { contactId: shared })], 'r'),
  ]);
  assert.deepEqual(seeds.map((s) => s.name), ['In Two', 'In One']);
  assert.equal(seeds[0]!.circleIds.length, 2);
});

test('SOMEBODY ON AMBER IS STILL DRAWN -- they are just never offered an invite', () => {
  /**
   * This used to drop them entirely, on the reasoning that a member with an
   * account is "a connection or a stranger, never a suggestion". Both halves
   * were wrong for the same person: a card in your circle that resolves to an
   * account you have NOT connected with is neither, and they were drawn nowhere
   * at all -- absent from the ring while their circle's pill counted them.
   *
   * They are on the ring now, and they are SOLID, because "if they're on Amber,
   * obviously fill it in, and if they're not, have the dotted UI."
   */
  const circles = [circle('Work', [member('On Amber', { amberId: 'x' }), member('Not On Amber')])];
  const seeds = suggestionsFromCircles(circles);
  assert.deepEqual(seeds.map((s) => s.name).sort(), ['Not On Amber', 'On Amber']);

  const web = buildWeb({ connections: [], circles });
  const onAmber = web.find((p) => p.name === 'On Amber')!;
  const notOnAmber = web.find((p) => p.name === 'Not On Amber')!;

  // Solid, tappable to their account -- never a text inviting them to an app
  // they are already using.
  assert.equal(onAmber.kind, 'connection');
  assert.equal(onAmber.amberId, 'x');
  // ...but not counted as a connection, because you have not connected.
  assert.equal(onAmber.connected, false);

  assert.equal(notOnAmber.kind, 'suggestion');
  assert.equal(notOnAmber.amberId, null);
  assert.equal(notOnAmber.connected, false);

  // AND THE CAPTION MUST NOT CLAIM EITHER OF THEM. One person to invite, and no
  // connections -- "1 connection" here would be contradicted by the Connections
  // screen the moment somebody opened it.
  assert.equal(webSummary(web), '0 connections · 1 to invite');
});

// ── things the first pass of this file was too polite to check ──────────────

test('THE SERVER SENDING THE SAME CONNECTION TWICE DOES NOT DUPLICATE THE NODE', () => {
  // A duplicate row in the connections payload -- two connection records for one
  // account, which a merge or a retry can produce -- becomes two nodes with the
  // SAME react key. React renders one and warns, so the ring silently holds a
  // person who cannot be tapped, and the count above it is wrong.
  const amberId = 'amber-dupe';
  const web = buildWeb({ connections: [connection('Mina Cho', amberId), connection('Mina Cho', amberId)], circles: [] });
  assert.equal(web.length, 1, 'a duplicated connection was drawn twice');
  assert.equal(new Set(web.map((p) => p.key)).size, web.length, 'two nodes share a react key');

  // AND THE CUTOFF COUNTS REAL PEOPLE. Five duplicate rows for one person is one
  // connection; retiring the invite scaffolding on the strength of it would
  // leave somebody with a single friend looking at a one-node web.
  const fiveOfTheSame = Array.from({ length: 5 }, () => connection('Mina Cho', amberId));
  const stillNew = buildWeb({ connections: fiveOfTheSame, circles: [circle('W', [member('Invite Me')])] });
  assert.equal(stillNew.filter((p) => p.kind === 'connection').length, 1);
  assert.ok(
    stillNew.some((p) => p.kind === 'suggestion'),
    'five rows for one person tripped the cutoff meant for five real people',
  );
});

test('every node has a unique key, in every arrangement', () => {
  const shared = 'contact-x';
  const web = buildWeb({
    connections: [connection('A'), connection('B')],
    circles: [circle('W', [member('C', { contactId: shared }), member('C', { contactId: shared })])],
  });
  assert.equal(new Set(web.map((p) => p.key)).size, web.length);
});

test('a connection with no name at all still draws, and says something', () => {
  // fullName and username both null is a real state on medha-id: an account that
  // signed up by phone and has not filled anything in. A node with an empty
  // label and an empty disc looks like a rendering fault.
  const web = buildWeb({
    connections: [{
      connectionId: 'c1',
      connectedAt: '2026-01-01T00:00:00.000Z',
      user: { amberId: 'a1', username: null, fullName: null, avatarUrl: null, occupation: null, currentCity: null },
    }],
    circles: [],
  });
  assert.equal(web.length, 1);
  assert.equal(web[0]!.initials, '?', 'a nameless account should show ? rather than nothing');
  assert.equal(webSummary(web), '1 connection');
});

test('A CIRCLE PREVIEW THAT OMITS SOMEBODY IS A FILTER THAT HIDES THEM', () => {
  /**
   * THE REAL LIMITATION, WRITTEN DOWN AS A TEST RATHER THAN A COMMENT.
   *
   * `CirclePreview.preview` is the first few members, not all of them. So a
   * connection who is genuinely in your 200-person Work circle but sits at
   * position 40 in it carries NO circle id, and pressing Work hides a person who
   * belongs there. Nothing about that is visible on a small book, and it is
   * certain on a real one.
   *
   * The fix is not guessing -- it is loading the members, which the component
   * does on demand. This pins both halves: the gap exists when only previews are
   * available, and passing `members` closes it exactly.
   */
  const amberId = 'amber-buried';
  const big = {
    ...circle('Work', [member('Someone Else', { amberId: 'other' })], 'w'),
    memberCount: 200,
  };
  const conns = [connection('Buried Person', amberId), connection('Someone Else', 'other')];

  const fromPreviewOnly = buildWeb({ connections: conns, circles: [big] });
  const buried = fromPreviewOnly.find((p) => p.amberId === amberId)!;
  assert.deepEqual(buried.circleIds, [], 'preview-only membership should be honestly empty, not guessed');
  assert.equal(filterByCircle(fromPreviewOnly, 'w').length, 1, 'the buried person is hidden by the Work filter');

  const withMembers = buildWeb({
    connections: conns,
    circles: [big],
    members: new Map([['w', [member('Buried Person', { amberId }), member('Someone Else', { amberId: 'other' })]]]),
  });
  assert.deepEqual(
    filterByCircle(withMembers, 'w').map((p) => p.name).sort(),
    ['Buried Person', 'Someone Else'],
    'loading the members must close the gap exactly',
  );
});

test('a member row with no contact id is not turned into an untappable suggestion', () => {
  const seeds = suggestionsFromCircles([circle('W', [{ ...member('Ghost'), contactId: '' }])]);
  assert.deepEqual(seeds, [], 'a member with no contact id cannot be texted, so it must not be offered');
});

test('a circle with no preview array at all does not throw', () => {
  const broken = { id: 'b', name: 'Broken', color: null, kindTag: null, memberCount: 3, connectedCount: 0 } as any;
  assert.doesNotThrow(() => buildWeb({ connections: [], circles: [broken] }));
  assert.deepEqual(buildWeb({ connections: [], circles: [broken] }), []);
  /**
   * THE PILL STILL SAYS THREE, and the ring is empty. That pair looks wrong and
   * it is the honest answer: the circle HAS three people -- the server counted
   * them -- and this payload carries no names to draw. Reporting 0 would be
   * inventing a fact about the circle to make the screen agree with itself.
   *
   * In the app this state does not arise, because the page loads every member
   * of every circle (GET /v1/me/circles/members) rather than relying on the
   * preview. It arises against an older server, and there the count is the more
   * trustworthy of the two numbers.
   */
  assert.deepEqual(filterPills([], [broken]), [{ id: 'b', name: 'Broken', color: null, count: 3 }]);
});

// ── the summary line ────────────────────────────────────────────────────────

test('the summary counts what is actually drawn, and pluralizes like a person', () => {
  const one = buildWeb({ connections: [connection('Solo')], circles: [] });
  assert.equal(webSummary(one), '1 connection');
  const two = buildWeb({ connections: [connection('A'), connection('B')], circles: [] });
  assert.equal(webSummary(two), '2 connections');
  const mixed = buildWeb({ connections: [connection('A')], circles: [circle('W', [member('B'), member('C')])] });
  assert.equal(webSummary(mixed), '1 connection · 2 to invite');
});

// ── the whole membership, grouped ───────────────────────────────────────────
//
// groupMembersByCircle turns the flat rows from GET /v1/me/circles/members into
// the map buildWeb takes. It is four lines and it is the single point where a
// wrong key produces an empty ring and a page of pills reading zero -- which is
// exactly the bug this whole change is fixing, so it does not go unchecked.

test('every member lands under their own circle, and a person in three circles is in three lists', () => {
  const rows = [
    { circleId: 'work', contactId: 'c1', name: 'Mina', avatarUrl: null, connected: true, amberId: 'a1', username: 'mina' },
    { circleId: 'friends', contactId: 'c1', name: 'Mina', avatarUrl: null, connected: true, amberId: 'a1', username: 'mina' },
    { circleId: 'work', contactId: 'c2', name: 'Rowan', avatarUrl: null, connected: false, amberId: null, username: null },
  ];
  const grouped = groupMembersByCircle(rows);
  assert.deepEqual([...grouped.keys()].sort(), ['friends', 'work']);
  assert.deepEqual(grouped.get('work')!.map((m) => m.contactId), ['c1', 'c2']);
  assert.deepEqual(grouped.get('friends')!.map((m) => m.contactId), ['c1']);

  // AND THE RING STILL DRAWS HER ONCE. Being in two circles is one person in two
  // circles, which is the dedupe buildWeb has always done -- checked here
  // through the real grouping rather than a hand-built map, because the
  // hand-built map is not what ships.
  const circles = [
    { id: 'work', name: 'Work', color: 'orange', memberCount: 2, connectedCount: 1, preview: [] } as any,
    { id: 'friends', name: 'Friends', color: 'green', memberCount: 1, connectedCount: 1, preview: [] } as any,
  ];
  const web = buildWeb({ connections: [], circles, members: grouped });
  assert.equal(web.filter((p) => p.name === 'Mina').length, 1, 'Mina was drawn twice');
  assert.deepEqual(
    web.find((p) => p.name === 'Mina')!.circleIds.sort(),
    ['friends', 'work'],
    'a person in two circles must count toward both pills',
  );
  // The pills read the circles, not the ring: Work has two people in it.
  const pills = filterPills(web, circles);
  assert.equal(pills.find((p) => p.id === 'work')!.count, 2);
  assert.equal(pills.find((p) => p.id === 'friends')!.count, 1);
});

test('junk rows are dropped rather than becoming a node with no name to tap', () => {
  const grouped = groupMembersByCircle([
    { circleId: '', contactId: 'c1', name: 'No circle' } as any,
    { circleId: 'work', contactId: '', name: 'No contact' } as any,
    null as any,
    undefined as any,
  ]);
  assert.equal(grouped.size, 0);
  assert.equal(groupMembersByCircle(null).size, 0);
  assert.equal(groupMembersByCircle(undefined).size, 0);
});

// ── the web is spaced out, and stays spaced out ─────────────────────────────
//
// "The web needs to be spaced out much better. Everything is scrunched up."
//
// It was two rings, whatever the number, which was survivable while the ring
// held at most twenty and hopeless once it held everybody in every circle:
// forty people on two rings is twenty labeled discs on one ellipse.
//
// Spacing is arithmetic, so it is checked rather than eyeballed. What follows
// is the property "no two people are drawn on top of each other", at every size
// a real address book produces.

test('NO TWO NODES OVERLAP, at any count from one person to a hundred', () => {
  const screen = { rx: 150, ry: 210 }; // a phone
  for (const n of [1, 2, 5, 12, 13, 20, 21, 32, 40, 60, 100]) {
    const people = Array.from({ length: n }, (_, i) =>
      member(`Person ${String(i).padStart(3, '0')}`),
    );
    // THE BOARD IS THE ONE THE DRAWING ASKED FOR, which past a dozen people is
    // bigger than the phone -- see boardForCount. A hundred tappable discs do
    // not fit on a phone, and the three ways to pretend otherwise are all worse
    // than letting the web be panned.
    const board = boardForCount(n, screen);
    const placed = layoutWeb(
      buildWeb({ connections: [], circles: [circle('All', people)] }),
      board.rx,
      board.ry,
    );
    assert.equal(placed.length, n, `n=${n} drew ${placed.length} nodes`);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        const touching = (a.d + b.d) / 2;
        assert.ok(
          gap >= touching * 0.9,
          `n=${n}: two discs overlap (${gap.toFixed(1)}pt apart, ${touching.toFixed(1)}pt wide)`,
        );
      }
    }
  }
});

test('A CROWDED WEB OPENS MORE RINGS rather than squeezing one', () => {
  const board = { rx: 150, ry: 210 };
  const ringsFor = (n: number) => {
    const people = Array.from({ length: n }, (_, i) => member(`P${i}`));
    // A FIXED board here on purpose: this is asking what the ring planner does
    // when the room does not grow, which is the question the planner exists to
    // answer. boardForCount is tested separately below.
    const placed = layoutWeb(
      buildWeb({ connections: [], circles: [circle('All', people)] }),
      board.rx,
      board.ry,
    );
    return new Set(placed.map((p) => p.ring)).size;
  };
  assert.equal(ringsFor(8), 1, 'a small web should be one ring, which reads as a web');
  assert.ok(ringsFor(40) >= 2, 'forty people were forced onto one ring');
  /**
   * NINETY ON A 150x210 BOARD IS TWO RINGS NOW, and that is the fix rather than
   * a regression.
   *
   * This asked for three, from when the step inward was a constant 0.24 of the
   * board -- which on a board this size is 37pt, less than the 40pt disc it was
   * separating. The planner could always open a third ring because it was not
   * checking whether the third ring had anywhere to go; the discs overlapped
   * instead, which is what "on top of each other" was.
   *
   * The step is derived from the disc now, so two is genuinely all that fits and
   * the planner says so. What must still hold is that it never draws ninety
   * people on ONE ring -- and boardForCount, tested below, is what stops a real
   * hundred-person web from ever being asked this question.
   */
  assert.ok(ringsFor(90) >= 2, 'ninety people were crammed onto one ring');
});

test('THE BOARD GROWS WITH THE CROWD, because a phone cannot hold a hundred faces', () => {
  const screen = { rx: 150, ry: 210 };
  // A small web fits the screen and must not be blown up into a pan surface for
  // no reason -- eight friends should be one glance.
  assert.deepEqual(boardForCount(8, screen), screen);
  assert.deepEqual(boardForCount(SINGLE_ORBIT_MAX, screen), screen);

  const forty = boardForCount(40, screen);
  const hundred = boardForCount(100, screen);
  assert.ok(forty.rx > screen.rx, 'forty people got no more room than eight');
  assert.ok(hundred.rx > forty.rx, 'a hundred got no more room than forty');
  // The aspect ratio is held, so the web does not turn into a letterbox.
  assert.ok(Math.abs(hundred.rx / hundred.ry - screen.rx / screen.ry) < 0.01);
  // And it is capped, or a pathological book produces a canvas nothing can draw.
  // 3.2 -> 4 with the divisor, because the board is now sized against the LABEL
  // rather than the disc; see boardForCount. Still a ceiling, still finite.
  assert.ok(boardForCount(5000, screen).rx <= screen.rx * 4 + 1);
  assert.ok(boardForCount(5000, screen).rx > screen.rx * 3, 'the cap should still be generous');
});

test('every node stays inside the board however many rings open', () => {
  const rx = 150;
  const ry = 210;
  for (const n of [13, 25, 45, 80]) {
    const people = Array.from({ length: n }, (_, i) => member(`P${i}`));
    const board = boardForCount(n, { rx, ry });
    for (const p of layoutWeb(
      buildWeb({ connections: [], circles: [circle('All', people)] }),
      board.rx,
      board.ry,
    )) {
      assert.ok(Math.abs(p.x) <= board.rx + 0.5, `n=${n}: a node at x=${p.x} left the board`);
      assert.ok(Math.abs(p.y) <= board.ry + 0.5, `n=${n}: a node at y=${p.y} left the board`);
    }
  }
});

test('the ring plan fills from the outside in, and never loses anybody', () => {
  // Everybody the pill counted has to be somewhere. A plan that quietly drops
  // the remainder is a count that disagrees with the drawing, which is the bug
  // this whole change is about.
  for (const n of [1, 7, 30, 120, 400]) {
    const plan = ringPlan(n, 150, 210, 34);
    assert.equal(
      plan.reduce((sum, r) => sum + r.count, 0),
      n,
      `${n} people, ${plan.reduce((s, r) => s + r.count, 0)} placed`,
    );
    // Outside in: the first ring is the largest and each is smaller.
    for (let i = 1; i < plan.length; i += 1) {
      assert.ok(plan[i]!.factor < plan[i - 1]!.factor, 'the rings are not ordered outward-in');
    }
  }
  assert.deepEqual(ringPlan(0, 150, 210, 34), []);
});

test('A BIGGER BOARD PUTS MORE SPACE BETWEEN PEOPLE, which is the only reason to grow it', () => {
  /**
   * The first version of this asserted that a bigger board puts more people on
   * its OUTER RING, which stopped being true -- and stopped being the point --
   * when the planner started distributing proportionally instead of filling the
   * outside to capacity. More people on one ring was never the goal; more room
   * between them is.
   *
   * So it measures the room. Same sixty people, two boards, and the tightest
   * gap on the large one has to beat the tightest gap on the small one.
   */
  const people = Array.from({ length: 60 }, (_, i) => member(`P${i}`));
  const web = buildWeb({ connections: [], circles: [circle('All', people)] });
  const tightest = (rx: number, ry: number) => {
    const placed = layoutWeb(web, rx, ry);
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        min = Math.min(min, Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y));
      }
    }
    return min;
  };
  const small = tightest(120, 160);
  const large = tightest(360, 480);
  assert.ok(large > small * 1.5, `a 3x board gave ${large.toFixed(0)}pt vs ${small.toFixed(0)}pt`);
});

test('the plan opens as many rings as it needs and no more', () => {
  // One ring while one ring is enough -- a two-ring drawing of nine people
  // reads as two groups of strangers rather than as one web.
  assert.equal(ringPlan(6, 150, 210, 40).length, 1);
  // And it grows rather than overfilling.
  assert.ok(ringPlan(60, 150, 210, 34).length > 1);
  assert.ok(ringPlan(200, 150, 210, 34).length >= ringPlan(60, 150, 210, 34).length);
});

// ── the web that was missing its own connections ────────────────────────────

/**
 * A mixed web: `c` real connections you have on Amber, plus `s` suggestions.
 *
 * Mirrors what the screen actually holds -- three connections against thirty
 * people to invite -- which is the shape both bugs below needed to appear.
 */
/**
 * NOT the `mixed` helper above: that one omits `connected`, and the ring
 * assignment reads `connected` rather than `kind`. They are different questions
 * -- kind is "on Amber", connected is "you two have actually connected" -- and
 * buildWeb sets them together, so a fixture that sets only one is testing a
 * state the product never produces.
 */
const mixedConnected = (c: number, s: number): WebPerson[] => [
  ...Array.from({ length: c }, (_, i) => ({
    key: `c${i}`, kind: 'connection' as const, amberId: `a${i}`, contactId: null,
    name: `Conn ${i}`, initials: 'CN', avatarUrl: null, username: null,
    connected: true, circleIds: [],
  })),
  ...Array.from({ length: s }, (_, i) => ({
    key: `s${i}`, kind: 'suggestion' as const, amberId: null, contactId: `x${i}`,
    name: `Sugg ${i}`, initials: 'SG', avatarUrl: null, username: null,
    connected: false, circleIds: [],
  })),
];

test('EVERY NODE HAS A LINE TO THE MIDDLE, at every count', () => {
  /**
   * "There are still connections missing with me and the people I'm actually
   *  connected to on Amber. There's no line between the central node and them."
   *
   * spiralPath had three returns that handed back an empty array, and the
   * component draws nothing for a path under two points -- with no error
   * anywhere. The trim is the one that fired: it walks back a whole sample at a
   * time to clear the node's own disc, and a node near the middle has a short
   * spiral to spend. A connection's disc is full size where a suggestion's is
   * 0.78 of it, and connections sit innermost -- so the biggest discs on the
   * shortest spirals lost their lines first. Exactly the ties that are real.
   */
  for (const [c, s] of [[3, 30], [1, 0], [3, 0], [1, 20], [12, 12], [5, 28], [2, 6]]) {
    for (const [rx, ry] of [[140, 182], [120, 120], [180, 300]]) {
      const placed = layoutWeb(mixedConnected(c, s), rx, ry);
      assert.equal(placed.length, c + s, `${c}+${s} @ ${rx}x${ry}: lost a node`);
      for (const p of placed) {
        assert.ok(
          p.path.length >= 2,
          `${c}+${s} @ ${rx}x${ry}: ${p.person.name} (${p.person.kind}) has no line`,
        );
        // TWO POINTS IN THE SAME PLACE IS NOT A LINE. The fallback computes its
        // own endpoints, so a length check on the array alone would pass on a
        // stub that draws nothing -- which is the bug over again, invisibly.
        const a = p.path[0]!;
        const b = p.path[p.path.length - 1]!;
        assert.ok(
          Math.hypot(b.x - a.x, b.y - a.y) >= 1,
          `${c}+${s} @ ${rx}x${ry}: ${p.person.name} has a line of no length`,
        );
      }
    }
  }
});

test('the line reaches from near the middle out to the node', () => {
  // A two-point stub that starts and ends in the same place would satisfy a
  // length check and draw nothing visible.
  const placed = layoutWeb(mixedConnected(3, 30), 140, 182);
  for (const p of placed) {
    const a = p.path[0]!;
    const b = p.path[p.path.length - 1]!;
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 2, `${p.person.name}: line of no length`);
    // It ends at the node, not somewhere else on the board.
    assert.ok(
      Math.hypot(b.x - p.x, b.y - p.y) <= p.d,
      `${p.person.name}: the line does not arrive at the node`,
    );
  }
});

test('THE PEOPLE YOU ACTUALLY HAVE ARE THE CLOSEST ONES', () => {
  /**
   * "The ones that are supposed to be closer aren't closer."
   *
   * The bucket loop stepped one ring outward after EVERY person, round-robin,
   * directly against its own "CONNECTIONS TAKE THE INNER RINGS" comment. Three
   * connections and three rings deals exactly one to each, including the
   * outermost: Caleb and Shirley beside the K, Sagar out at the rim.
   *
   * MEASURED IN RINGS, NOT IN PIXELS, and the first draft of this got it wrong.
   * The rings are ellipses, so distance from the middle depends on DIRECTION as
   * much as on ring: on a 140x182 board a node at the top of a ring is 153pt out
   * while its own ring-mate at the side is 118pt. Asserting "every connection is
   * nearer than every suggestion" in pixels therefore fails on a correct layout,
   * and chasing it would mean distorting the ellipse into a circle.
   *
   * Ring is the thing the layout actually decides and the thing the eye reads as
   * an orbit. plan[0] is the OUTERMOST ring, so inner means a HIGHER index.
   */
  for (const [c, s] of [[3, 30], [2, 20], [5, 28], [1, 14], [8, 40]]) {
    const placed = layoutWeb(mixedConnected(c, s), 140, 182);
    const conns = placed.filter((p) => p.person.kind === 'connection');
    const suggs = placed.filter((p) => p.person.kind === 'suggestion');
    assert.equal(conns.length, c);
    const outermostConn = Math.min(...conns.map((p) => p.ring));
    const innermostSugg = Math.max(...suggs.map((p) => p.ring));
    assert.ok(
      outermostConn >= innermostSugg,
      `${c}+${s}: a connection sits on ring ${outermostConn}, outside a suggestion on ring ${innermostSugg}`,
    );
  }
});

test('THE ORDER IS ESTABLISHED HERE, not inherited from the caller', () => {
  /**
   * A mutation that deleted the connected/not-connected split survived, because
   * every fixture already handed layoutWeb its connections first. Callers do not
   * all sort -- and a layout whose correctness depends on the caller having done
   * it is a layout that will be wrong the first time somebody passes a raw list.
   */
  // Reversed rather than key-sorted: connection keys are c0..c3 and
  // suggestion keys s0..s23, so sorting by key leaves connections first and the
  // fixture is not shuffled at all. The guard below caught exactly that.
  const shuffled = [...mixedConnected(4, 24)].reverse();
  assert.notEqual(shuffled[0]!.kind, 'connection', 'the fixture was not actually shuffled');
  const placed = layoutWeb(shuffled, 140, 182);
  const conns = placed.filter((p) => p.person.kind === 'connection');
  const suggs = placed.filter((p) => p.person.kind === 'suggestion');
  assert.ok(
    Math.min(...conns.map((p) => p.ring)) >= Math.max(...suggs.map((p) => p.ring)),
    'an unsorted input put a connection outside a suggestion',
  );
});

test('a ring shared by both kinds is filled by connections first', () => {
  // Three connections do not earn a ring of their own -- a ten-slot ring holding
  // three people and seven gaps is its own kind of wrong. They take the first
  // slots of the innermost ring and suggestions take what is left, so the only
  // ring that mixes is the one the connections could not fill.
  const placed = layoutWeb(mixedConnected(3, 30), 140, 182);
  const byRing = new Map<number, string[]>();
  for (const p of placed) {
    const list = byRing.get(p.ring) ?? [];
    list.push(p.person.kind);
    byRing.set(p.ring, list);
  }
  const mixedRings = [...byRing.values()].filter((k) => new Set(k).size > 1);
  assert.ok(mixedRings.length <= 1, `${mixedRings.length} rings hold both kinds; at most one should`);
});

test('connections share the innermost ring rather than being dealt across rings', () => {
  // The direct statement of the same bug: with room on the inside, three
  // connections belong on one ring, not one apiece on three.
  const placed = layoutWeb(mixedConnected(3, 30), 140, 182);
  const rings = new Set(
    placed.filter((p) => p.person.kind === 'connection').map((p) => p.ring),
  );
  assert.equal(rings.size, 1, `three connections were spread across ${rings.size} rings`);
});

test('a web of nothing but connections still fills from the inside out', () => {
  // No suggestions to push outward means the ordering rule has to hold on its
  // own rather than as a side effect of two groups.
  const placed = layoutWeb(mixedConnected(20, 0), 140, 182);
  assert.equal(placed.length, 20);
  for (const p of placed) assert.ok(p.path.length >= 2, `${p.person.name} has no line`);
  const inner = Math.min(...placed.map((p) => p.ring));
  assert.ok(placed.some((p) => p.ring === inner), 'the innermost ring was left empty');
});

test('nobody is dropped when there are more people than planned room', () => {
  // The overflow branch. A missing person is worse than a tight outer rim.
  const placed = layoutWeb(mixedConnected(4, 60), 110, 110);
  assert.equal(placed.length, 64);
  for (const p of placed) assert.ok(p.path.length >= 2, `${p.person.name} has no line`);
});
