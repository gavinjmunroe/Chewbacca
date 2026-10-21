/**
 * THE GATE, AND EVERY WAY ROUND IT I COULD THINK OF.
 *
 * This is the file where a passing suite is worth the least, because the thing
 * being tested is a refusal: everything happy-path still works if the gate is
 * deleted outright. So the assertions below are written the other way up --
 * each one names a specific way an account could be driven by somebody who does
 * not own it, and fails if that way is open.
 *
 * The one exception, the one place a green test means something ordinary, is
 * the "link" verdict. Silence for a signed-up user who texts the number they
 * were shown is a broken product, and the reason it is tested here rather than
 * left to the webhook is that "reject" and "link" are one word apart and the
 * wrong one is invisible until a real person is on the other end of it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  dmAdmission,
  isLinkablePhone,
  isLinkedTo,
  LINK_INSTRUCTION,
  parseAllowlist,
} from "./imessage-link.js";

const MINE = "+16175551234";
const THEIRS = "+14155559999";

/** An app-created account: real, signed up, never armed iMessage. */
const appUser = (over = {}) => ({
  amber_id: "11111111-1111-4111-8111-111111111111",
  phone: MINE,
  status: "active",
  imessage_linked_at: null,
  imessage_linked_phone: null,
  ...over,
});

/** The same account, armed from a signed-in session. */
const armedUser = (phone = MINE) =>
  appUser({ imessage_linked_at: new Date("2026-09-01T00:00:00Z"), imessage_linked_phone: phone });

const open = (over = {}) => dmAdmission({ dmOpen: true, allowlist: new Set(), ...over });

test("AN UNARMED ACCOUNT IS NOT REACHABLE BY TEXT, which is the entire point", () => {
  /**
   * The regression this whole change exists for. Before it:
   *     getUserByPhone(sender) -> ownerId -> the contact graph.
   * A verdict of anything but "link" here means a phone number in a webhook
   * body is once again sufficient to be somebody.
   */
  const v = open({ user: appUser(), senderE164: MINE });
  assert.equal(v.action, "link");
  assert.equal(v.reason, "channel_not_linked");
  assert.equal(v.ownerId, undefined, "an unadmitted verdict handed back an owner id");
});

test("armed for this number, and only then, the pipeline runs", () => {
  const v = open({ user: armedUser(MINE), senderE164: MINE });
  assert.equal(v.action, "proceed");
  assert.equal(v.ownerId, "11111111-1111-4111-8111-111111111111");
});

test("A CHANGED PHONE NUMBER DOES NOT CARRY THE CHANNEL WITH IT", () => {
  /**
   * Why the link stores a phone instead of a boolean. They armed iMessage on
   * their old number, then changed their number in the app. users.phone is now
   * the new one, so getUserByPhone(new) finds the row -- and a boolean would
   * read as "armed" for a number nobody ever consented for. Re-arming is one
   * tap; inheriting a channel is not something the user can undo, because they
   * never knew it happened.
   */
  const movedNumbers = armedUser("+16175550000"); // armed for the old number
  const v = open({ user: { ...movedNumbers, phone: MINE }, senderE164: MINE });
  assert.equal(v.action, "link");
  assert.equal(v.reason, "linked_to_other_number");
});

test("half a link is no link, in both directions", () => {
  // The database CHECK forbids these rows, so reaching one means the constraint
  // was dropped or a migration ran halfway. Failing open on a row the schema
  // says cannot exist is how a broken deploy becomes a breach.
  assert.equal(isLinkedTo(appUser({ imessage_linked_at: new Date() }), MINE), false);
  assert.equal(isLinkedTo(appUser({ imessage_linked_phone: MINE }), MINE), false);
  assert.equal(isLinkedTo(null, MINE), false);
});

test("a new number enrolls, because there is no account there to take", () => {
  const v = open({ user: null, senderE164: THEIRS });
  assert.equal(v.action, "enroll");
});

test("THE CLOSED GATE STILL CLOSES, and it closes before anything else", () => {
  // DM_ENROLLMENT_OPEN=false plus an empty allowlist is the locked-down posture,
  // and the link gate must not have loosened it: an armed user who is not on
  // the allowlist is still refused, silently.
  const v = dmAdmission({
    user: armedUser(MINE),
    senderE164: MINE,
    dmOpen: false,
    allowlist: new Set(),
  });
  assert.equal(v.action, "reject");
  assert.equal(v.reason, "unauthorized_sender");
});

test("the allowlist admits, and admitting is not the same as arming", () => {
  /**
   * A number we put in ALLOWED_TEST_NUMBERS gets past the door. It does NOT get
   * past the link. Our decision about a number and the account owner's decision
   * about their account are different decisions, and letting the first stand in
   * for the second would make the gate ceremonial.
   */
  const v = dmAdmission({
    user: appUser(),
    senderE164: MINE,
    dmOpen: false,
    allowlist: new Set([MINE]),
  });
  assert.equal(v.action, "link");
});

test("AN APPLE ID IS NOT A PHONE NUMBER, and must never become one", () => {
  /**
   * normalizePhone passes anything non-numeric straight through, so an iMessage
   * sent from an Apple ID arrives as "someone@example.com" and used to reach
   * createUser -- minting an account with an email address sitting in
   * users.phone, a column every other part of this service reads as E.164.
   */
  for (const junk of [
    "someone@example.com",
    "amber",
    "",
    null,
    undefined,
    "+",
    "+0123456789",       // E.164 country codes do not start at zero
    "16175551234",       // unnormalized: the caller's job, not ours to guess
    "+1617555123456789", // longer than E.164 permits
  ]) {
    assert.equal(isLinkablePhone(junk), false, `accepted ${JSON.stringify(junk)}`);
    const v = open({ user: null, senderE164: junk });
    assert.equal(v.action, "reject", `enrolled ${JSON.stringify(junk)}`);
    assert.equal(v.reason, "sender_not_e164");
  }
  assert.equal(isLinkablePhone(MINE), true);
  assert.equal(isLinkablePhone("+447700900123"), true, "a UK number was refused");
  assert.equal(isLinkablePhone("+3312345678"), true, "a short national number was refused");
});

test("a junk sender is refused even when it somehow matches an account", () => {
  // Ordering. If the E.164 check ran after the lookup, a row whose phone column
  // already holds an email -- and rows like that exist, from before the check --
  // would authenticate that email as its own owner forever.
  const v = open({
    user: armedUser("someone@example.com"),
    senderE164: "someone@example.com",
  });
  assert.equal(v.action, "reject");
});

test("the allowlist string parses the way the env var is actually written", () => {
  const set = parseAllowlist(" +16175551234 , +14155559999 ,, ");
  assert.equal(set.size, 2);
  assert.ok(set.has(MINE));
  assert.equal(parseAllowlist("").size, 0);
  assert.equal(parseAllowlist(null).size, 0);
  assert.equal(parseAllowlist(undefined).size, 0);
});

test("a raw allowlist string works as well as a Set, so a call site cannot half-pass it", () => {
  const v = dmAdmission({
    user: appUser(),
    senderE164: MINE,
    dmOpen: false,
    allowlist: `${MINE},${THEIRS}`,
  });
  assert.equal(v.action, "link", "a string allowlist was treated as empty and rejected outright");
});

test("what an unlinked account is told gives away nothing about the account", () => {
  /**
   * The reply reaches a number we have not authenticated. It may say what to
   * do; it may not say who this is. A name, an email, or a count of anything
   * would turn a gate into a disclosure.
   */
  assert.match(LINK_INSTRUCTION, /Connections > Amber/);
  assert.match(LINK_INSTRUCTION, /Texting Amber/);
  assert.ok(LINK_INSTRUCTION.length < 320, "an SMS-length instruction ran long enough to split");
  assert.ok(!/—|–/.test(LINK_INSTRUCTION), "an em dash reaches iMessage as a mangled character");
});

test("a deleted account is a new number, not a reachable one", () => {
  // getUserByPhone filters deleted_at, so a deleted account arrives here as
  // null. Enrolling is right: the row it would resurrect is gone on purpose.
  const v = open({ user: null, senderE164: MINE });
  assert.equal(v.action, "enroll");
});
