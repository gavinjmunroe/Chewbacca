/**
 * REACTING TO A POST, AND THE THREE WAYS THE COUNT GOES WRONG.
 *
 * The row of emoji is easy. What is not:
 *
 *   THE DOUBLE COUNT   you had a laugh on it and you tap the heart. The server
 *                      can only hold ONE reaction per person per post -- the
 *                      primary key says so -- so a client that draws both is
 *                      showing a state that cannot exist, and the next refresh
 *                      silently corrects it. That looks like the app losing
 *                      your reaction.
 *   THE GHOST ZERO     you take your reaction back and the key stays behind
 *                      with a 0 in it. "😂 0" claims somebody laughed and then
 *                      says nobody did.
 *   THE BLANK CHIP     a newer build reacts with a kind this one has no emoji
 *                      for, and the row draws an empty box with a 3 next to it.
 *
 * All three are arithmetic on a small object, which is why the arithmetic is a
 * pure function and this file exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMENT_MAX,
  NO_SOCIAL,
  REACTIONS,
  applyReaction,
  nextKind,
  reactionEmoji,
  summarizeReactions,
  totalReactions,
  type PostReactions,
  type ReactionKind,
} from './postSocial.ts';
import {
  REACTION_EMOJI,
  REACTION_GLYPH,
  REACTION_KINDS,
  REACTION_LABEL,
  REACTION_ORDER,
} from './noteMedia.ts';

/**
 * THE VOCABULARY IS SHARED WITH THE DATABASE and this is the copy of it that can
 * drift.
 *
 * THREE tables carry it in a CHECK constraint -- note_reactions, dm_reactions
 * and post_reactions -- and migration 045 widens all three in one file for
 * exactly that reason. The server pins its own list against that migration; this
 * pins the client's against the same set. A seventh reaction added on one side
 * only is then a failing test rather than a tap that fails with a 400 and no
 * explanation.
 */
const SERVER_KINDS = ['emphasis', 'like', 'dislike', 'laugh', 'question', 'heart'];

test('THE CLIENT OFFERS EXACTLY THE KINDS THE DATABASE WILL ACCEPT', () => {
  assert.deepEqual([...REACTIONS.map((r) => r.kind)].sort(), [...SERVER_KINDS].sort());
});

test('there is ONE vocabulary in the app, not one per surface', () => {
  // This file used to declare its own five kinds with its own emoji, which is
  // how it came to call `like` a heart while every other screen drew it as a
  // thumbs-up. The list, the order, the emoji and the labels all come from
  // lib/noteMedia now -- the module the DM thread and the circle feed already
  // use -- and this asserts they are the same objects rather than two lists
  // that happen to match today.
  assert.deepEqual(REACTIONS.map((r) => r.kind), [...REACTION_ORDER]);
  for (const r of REACTIONS) {
    assert.equal(r.emoji, REACTION_EMOJI[r.kind]);
    assert.equal(r.label, REACTION_LABEL[r.kind]);
  }
  // Every kind has both renderings. The feed draws emoji and the DM thread
  // draws monochrome glyphs; a kind with only one of them is a blank in
  // whichever surface it is missing from.
  for (const k of REACTION_KINDS) {
    assert.ok(REACTION_EMOJI[k], `${k} has no emoji`);
    assert.ok(k in REACTION_GLYPH, `${k} has no glyph`);
    assert.ok(REACTION_LABEL[k], `${k} has no label`);
  }
  assert.equal(REACTION_ORDER.length, REACTION_KINDS.length, 'a kind is not offered anywhere');
});

test('the heart leads, because that is what the design draws and what people reach for', () => {
  assert.equal(REACTIONS[0]?.kind, 'heart');
  assert.equal(REACTIONS[0]?.emoji, '❤️');
});

test('every reaction has an emoji and a label, and none of them collide', () => {
  assert.equal(new Set(REACTIONS.map((r) => r.emoji)).size, REACTIONS.length);
  assert.equal(new Set(REACTIONS.map((r) => r.kind)).size, REACTIONS.length);
  for (const r of REACTIONS) {
    assert.ok(r.emoji.length > 0, `${r.kind} has no emoji`);
    assert.ok(r.label.trim().length > 0, `${r.kind} has no label`);
  }
});

test('an emoji is only ever asked for by kind, and an unknown kind answers null', () => {
  assert.equal(reactionEmoji('laugh'), '😂');
  assert.equal(reactionEmoji('shrug'), null);
  assert.equal(reactionEmoji(null), null);
  assert.equal(reactionEmoji(undefined), null);
});

// ── the optimistic tap ──────────────────────────────────────────────────────

test('tapping a reaction you have not used adds it', () => {
  const after = applyReaction({ counts: { like: 2 }, mine: null }, 'laugh');
  assert.deepEqual(after, { counts: { like: 2, laugh: 1 }, mine: 'laugh' });
});

test('tapping the one you already chose takes it back', () => {
  const after = applyReaction({ counts: { laugh: 3 }, mine: 'laugh' }, 'laugh');
  assert.deepEqual(after, { counts: { laugh: 2 }, mine: null });
});

test('THE DOUBLE COUNT: switching reactions MOVES yours, it does not add a second', () => {
  const after = applyReaction({ counts: { laugh: 1, like: 4 }, mine: 'laugh' }, 'like');
  assert.equal(after.mine, 'like');
  assert.equal(after.counts.like, 5);
  // Not 1. You are no longer one of the people who laughed at it.
  assert.equal(after.counts.laugh, undefined);
  assert.equal(totalReactions(after), 5, 'one person is being counted twice');
});

test('THE GHOST ZERO: the last one of a kind removes the kind, it does not leave a 0', () => {
  const after = applyReaction({ counts: { laugh: 1 }, mine: 'laugh' }, 'laugh');
  assert.equal(after.counts.laugh, undefined);
  assert.deepEqual(summarizeReactions(after), []);
  assert.equal(totalReactions(after), 0);
});

test('the tap is pure -- the value you had is still the value you had', () => {
  // The caller keeps the old object to roll back to when the PUT fails. If the
  // tap mutated it there would be nothing to roll back TO, and a failed write
  // would leave a reaction on screen that no one else can see.
  const before: PostReactions = { counts: { like: 1 }, mine: 'like' };
  const frozen = JSON.stringify(before);
  applyReaction(before, 'laugh');
  assert.equal(JSON.stringify(before), frozen);
});

test('a post nobody has touched survives every tap', () => {
  const after = applyReaction(NO_SOCIAL.reactions, 'emphasis');
  assert.deepEqual(after, { counts: { emphasis: 1 }, mine: 'emphasis' });
  assert.deepEqual(applyReaction(null, 'like'), { counts: { like: 1 }, mine: 'like' });
  assert.deepEqual(applyReaction(undefined, 'like'), { counts: { like: 1 }, mine: 'like' });
});

test('what gets sent matches what was drawn: null to clear, the kind otherwise', () => {
  const mine: PostReactions = { counts: { laugh: 1 }, mine: 'laugh' };
  assert.equal(nextKind(mine, 'laugh'), null);
  assert.equal(nextKind(mine, 'like'), 'like');
  assert.equal(nextKind(null, 'like'), 'like');
  // The two have to agree, or the screen shows one thing and the server stores
  // another: whenever the tap clears the reaction locally, it clears it there.
  for (const r of REACTIONS) {
    const local = applyReaction(mine, r.kind);
    assert.equal(
      local.mine,
      nextKind(mine, r.kind),
      `tapping ${r.kind} draws ${local.mine} and sends ${nextKind(mine, r.kind)}`,
    );
  }
});

// ── drawing the row ─────────────────────────────────────────────────────────

test('the row is in the offered order, not in whatever order the server answered', () => {
  // Built from the vocabulary rather than from a literal, because the first
  // version of this listed five kinds by hand and broke the day a sixth
  // arrived -- for the one reason that was not a bug.
  const counts: PostReactions = { counts: {}, mine: null };
  // Deliberately inserted in REVERSE, so a `summarizeReactions` that just walked
  // the object it was given would produce the opposite of what this expects.
  for (const k of [...REACTION_ORDER].reverse()) counts.counts[k] = 1;
  assert.deepEqual(
    summarizeReactions(counts).map((r) => r.kind),
    REACTIONS.map((r) => r.kind),
  );
});

test('THE BLANK CHIP: a kind this build does not know is dropped, not drawn empty', () => {
  const fromNewerClient = {
    counts: { like: 2, party: 7 },
    mine: null,
  } as unknown as PostReactions;
  const row = summarizeReactions(fromNewerClient);
  assert.deepEqual(row.map((r) => r.kind), ['like']);
  // And the total does not silently include what the row does not show, which
  // would read as "3 reactions" above a row containing one.
  assert.equal(totalReactions(fromNewerClient), 2);
});

test('a zero, a negative and a nonsense count are all "nobody did that"', () => {
  const junk = {
    counts: { like: 0, laugh: -1, emphasis: Number.NaN, question: 'lots' },
    mine: null,
  } as unknown as PostReactions;
  assert.deepEqual(summarizeReactions(junk), []);
});

test('your own reaction is marked, so the row can light it', () => {
  const row = summarizeReactions({ counts: { like: 2, laugh: 1 }, mine: 'laugh' });
  assert.deepEqual(row.map((r) => r.mine), [false, true]);
});

test('nothing at all is an empty row rather than a crash', () => {
  assert.deepEqual(summarizeReactions(null), []);
  assert.deepEqual(summarizeReactions(undefined), []);
  assert.deepEqual(summarizeReactions({ counts: {}, mine: null }), []);
  assert.equal(totalReactions(null), 0);
  assert.deepEqual(NO_SOCIAL, {
    reactions: { counts: {}, mine: null },
    commentCount: 0,
    comments: [],
  });
});

test('the comment limit is the number the server enforces', () => {
  // db/post-social.js: COMMENT_MAX = 2000. A client that let somebody type more
  // would take a paragraph and answer with a 400 after they pressed send.
  assert.equal(COMMENT_MAX, 2000);
});

test('every kind can be tapped from every state without producing a negative', () => {
  // Brute force over the whole state space, because the count arithmetic is the
  // part that has to be right and there are only thirty states to check.
  const kinds = REACTIONS.map((r) => r.kind);
  const states: (ReactionKind | null)[] = [null, ...kinds];
  const EACH = 2;
  // Derived, not the literal 10 the first version used -- which was five kinds
  // times two and quietly became wrong when a sixth reaction was added.
  const START = kinds.length * EACH;
  for (const mine of states) {
    for (const tapped of kinds) {
      const counts: Partial<Record<ReactionKind, number>> = {};
      for (const k of kinds) counts[k] = EACH;
      const after = applyReaction({ counts, mine }, tapped);
      for (const k of kinds) {
        const n = after.counts[k];
        assert.ok(n === undefined || n > 0, `${mine} → ${tapped} left ${k} at ${n}`);
      }
      // One person, one reaction, one net change of at most one.
      assert.ok(
        Math.abs(totalReactions(after) - START) <= 1,
        `${mine} → ${tapped} moved the total by more than one person`,
      );
    }
  }
});
