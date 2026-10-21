/**
 * THE SENTENCES BEHIND "TELL ME ABOUT MY NETWORK".
 *
 * This block is prompt text, and the reason it is tested at all is that the
 * last version of this answer got the user's own numbers WRONG, out loud, with
 * praise attached: a bare 723 printed one line under a total of 2,897 came back
 * as "all 2,897 have saved notes, meaning you have captured context on every
 * single person". Twice in four live turns.
 *
 * A test cannot stop a model from writing a bad sentence. It can make the bad
 * sentence unwritable, which is what the denominators are for, and it can pin
 * the two states nobody sees during development: the brand-new account, and the
 * read that failed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderAmberBrief } from "./amber-brief.js";

const FULL = {
  contacts: 966,
  contactsWithFacts: 134,
  facts: 402,
  circles: 4,
  circleMembers: 37,
  eventsNext7d: 6,
  eventsTotal: 88,
  openReminders: 2,
  timedRemindersAhead: 3,
  calendarAccounts: 1,
  voiceNotes: 12,
  amberConnections: 5,
  pendingRequests: 1,
};

const EMPTY = {
  contacts: 0,
  contactsWithFacts: 0,
  facts: 0,
  circles: 0,
  circleMembers: 0,
  eventsNext7d: 0,
  eventsTotal: 0,
  openReminders: 0,
  timedRemindersAhead: 0,
  calendarAccounts: 0,
  voiceNotes: 0,
  amberConnections: 0,
  pendingRequests: 0,
};

test("A COUNT NEVER APPEARS WITHOUT ITS DENOMINATOR AND ITS REMAINDER", () => {
  /**
   * The exact bug. "134" one line under "966" reads as the whole, so the
   * remainder is spelled out and there is no way left to phrase 832 people with
   * nothing on them as "every single person".
   */
  const block = renderAmberBrief(FULL);
  assert.match(block, /134 of those 966 carry something/);
  assert.match(block, /The other 832 have nothing on them yet/);
});

test("a null snapshot says nothing rather than saying zero", () => {
  // A FAILED READ IS NOT AN EMPTY ACCOUNT. Returning zeroes here would tell
  // somebody holding three thousand people that they have nobody, which is the
  // worst sentence this feature could produce.
  assert.equal(renderAmberBrief(null), "");
  assert.equal(renderAmberBrief(undefined), "");
});

test("day one is stated plainly, with the one thing that changes it", () => {
  const block = renderAmberBrief(EMPTY);
  assert.match(block, /NO contacts yet/);
  assert.match(block, /brand-new account/);
  assert.match(block, /syncing/i);
  // And it must not recite an empty inventory at them.
  assert.doesNotMatch(block, /0 circles|0 voice notes|0 saved facts/);
});

test("a zero section is left out rather than reported as nothing", () => {
  const block = renderAmberBrief({ ...EMPTY, contacts: 40, contactsWithFacts: 0 });
  assert.match(block, /40 contacts/);
  assert.match(block, /0 of those 40 carry something/);
  assert.doesNotMatch(block, /circle/i);
  assert.doesNotMatch(block, /voice note/i);
  assert.doesNotMatch(block, /connection request/i);
});

test("no connected calendar is said out loud, because silence reads as a free week", () => {
  const none = renderAmberBrief({ ...FULL, calendarAccounts: 0, eventsNext7d: 0 });
  assert.match(none, /NO calendar account connected/);
  assert.match(none, /do not claim their week is empty/);

  const one = renderAmberBrief(FULL);
  assert.match(one, /1 calendar account connected/);
  assert.doesNotMatch(one, /NO calendar account/);
});

test("one of something is never \"1 contacts\"", () => {
  const block = renderAmberBrief({
    ...EMPTY,
    contacts: 1,
    contactsWithFacts: 1,
    facts: 1,
    circles: 1,
    circleMembers: 1,
    calendarAccounts: 1,
    voiceNotes: 1,
    amberConnections: 1,
    pendingRequests: 1,
    eventsNext7d: 1,
    eventsTotal: 1,
    openReminders: 1,
  });
  for (const bad of [
    /1 contacts/,
    /1 circles/,
    /1 people between/,
    /1 calendar accounts/,
    /1 voice notes/,
    /1 open reminders/,
    /1 connection requests/,
    /1 things scheduled/,
    /1 saved facts/,
  ]) {
    assert.doesNotMatch(block, bad, `wrote a plural for one: ${bad}`);
  }
  assert.match(block, /1 person between them/);
});

test("the two questions get different instructions from the same numbers", () => {
  const mine = renderAmberBrief(FULL, "about_theirs");
  const amber = renderAmberBrief(FULL, "about_amber");
  assert.match(amber, /THEY ASKED WHAT YOU ARE/);
  assert.match(amber, /Never a headed menu of capabilities/);
  assert.match(mine, /THEY ASKED ABOUT THEIR OWN BOOK/);
  // The facts themselves are identical: only the emphasis changes.
  assert.match(mine, /134 of those 966/);
  assert.match(amber, /134 of those 966/);
});

test("the block forbids the sentence that got this wrong before", () => {
  const block = renderAmberBrief(FULL);
  assert.match(block, /Never invent a number/i);
  assert.match(block, /"all", "every", "each", "everyone" or "none"/);
  assert.match(block, /never praise their coverage as complete/);
});

test("THE BLOCK CONTAINS NO EM-DASH OR EN-DASH", () => {
  // CHAT_SYSTEM and HOUSE_RULES both forbid them in the reply, and a model
  // writes like its context. Same rule as lib/day-brief.js.
  for (const inv of [FULL, EMPTY, { ...FULL, calendarAccounts: 0 }]) {
    assert.doesNotMatch(renderAmberBrief(inv), /[—–]/);
  }
});
