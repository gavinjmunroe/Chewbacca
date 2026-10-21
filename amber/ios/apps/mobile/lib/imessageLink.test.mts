/**
 * THE INBOUND SWITCH, AND THE TWO WAYS IT CAN LIE.
 *
 * Nothing here touches the network. What is pinned is the pair of states where
 * the screen and the server can disagree, and in both of them the user's only
 * feedback loop is "I texted Amber and nothing happened", which is not a loop
 * anybody closes on their own:
 *
 *   a row we cannot parse rendering as ON
 *   a link pinned to a number the account no longer has, rendering as ON
 *
 * Both are invisible from the switch itself. Neither is recoverable by guessing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amberMessagesUrl,
  isStaleLink,
  linkStatusLine,
  parseImessageLink,
} from './imessageLink.ts';

const MINE = '+16175551234';
const OLD = '+16175550000';
const AMBER = '+15550100008';

const armed = parseImessageLink({
  linked: true,
  phone: MINE,
  linkedPhone: MINE,
  linkedAt: '2026-09-12T10:00:00.000Z',
  amberNumber: AMBER,
});

test('OFF IS THE ONLY SAFE READING OF A ROW WE DO NOT UNDERSTAND', () => {
  /**
   * `linked` is recomputed, never trusted. A screen showing ON while the server
   * refuses every text is the one failure the user cannot diagnose: they text,
   * nothing comes back, and the switch says it should have.
   */
  assert.equal(parseImessageLink(null).linked, false);
  assert.equal(parseImessageLink({}).linked, false);
  assert.equal(parseImessageLink({ linked: true }).linked, false, 'trusted the server flag alone');
  assert.equal(
    parseImessageLink({ linked: true, linkedPhone: MINE }).linked,
    false,
    'a link with no arming date read as on',
  );
  assert.equal(
    parseImessageLink({ linked: true, linkedAt: '2026-09-12T10:00:00.000Z' }).linked,
    false,
    'a link with no number read as on',
  );
  assert.equal(parseImessageLink({ linked: false, linkedPhone: MINE, linkedAt: 'x' }).linked, true);
});

test('both spellings of every field parse, so one server change cannot blank the screen', () => {
  const snake = parseImessageLink({
    phone: MINE,
    linked_phone: MINE,
    linked_at: '2026-09-12T10:00:00.000Z',
    amber_number: AMBER,
  });
  assert.equal(snake.linked, true);
  assert.equal(snake.linkedPhone, MINE);
  assert.equal(snake.amberNumber, AMBER);
});

test('whitespace is not a value', () => {
  const blank = parseImessageLink({ linkedPhone: '   ', linkedAt: '  ', amberNumber: '' });
  assert.equal(blank.linked, false);
  assert.equal(blank.amberNumber, null);
});

test('A LINK PINNED TO AN OLD NUMBER DOES NOT GET TO SAY "ON"', () => {
  /**
   * Arming pins to one exact number, so changing your phone in Amber leaves the
   * link pointing at the old one. The switch is on and the server is refusing
   * every text. This is the sentence that turns an unexplainable silence into a
   * two-tap fix, and it has to name both numbers to do that.
   */
  const stale = parseImessageLink({
    phone: MINE,
    linkedPhone: OLD,
    linkedAt: '2026-09-01T10:00:00.000Z',
    amberNumber: AMBER,
  });
  assert.equal(isStaleLink(stale), true);
  const line = linkStatusLine(stale);
  assert.ok(line.includes(OLD), 'did not say which number it is stuck on');
  assert.ok(line.includes(MINE), 'did not say which number it should be on');
  assert.match(line, /off and back on/i, 'named the problem without naming the fix');
});

test('the ordinary states read plainly', () => {
  assert.match(linkStatusLine(armed), /On for \+16175551234/);
  assert.equal(isStaleLink(armed), false);
  assert.match(linkStatusLine(parseImessageLink(null)), /^Off\./);
  assert.match(linkStatusLine(null), /^Off\./);
  assert.equal(isStaleLink(null), false);
});

test('an unarmed link is never called stale, however odd its numbers', () => {
  // Off is off. A stale warning on a switch that is already off is a puzzle
  // with no action attached to it.
  const off = parseImessageLink({ phone: MINE, linkedPhone: OLD, linkedAt: null });
  assert.equal(isStaleLink(off), false);
  assert.match(linkStatusLine(off), /^Off\./);
});

test('the Messages link opens addressed to Amber, or does not exist', () => {
  // sms: is the scheme iOS actually honors for a prefilled body -- the server
  // helper says the same. A link to nowhere would render as a dead button.
  assert.equal(amberMessagesUrl(armed), `sms:${AMBER}&body=Hi%20Amber`);
  assert.equal(amberMessagesUrl(parseImessageLink({ linkedPhone: MINE, linkedAt: 'x' })), null);
  assert.equal(amberMessagesUrl(null), null);
});
