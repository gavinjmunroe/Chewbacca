/**
 * A SETTING THAT DOES NOT DO WHAT IT SAYS IS WORSE THAN NO SETTING.
 *
 * Three switches decide whether a push goes out, and all three are the
 * recipient's: push at all, this KIND of push, and this PERSON. They are
 * asserted here rather than through a route because this is the only place they
 * are consulted -- every social event in the app funnels through
 * notifyAmberUsers, so a gate that is wrong here is wrong everywhere at once.
 *
 * The token lookup is left alone deliberately: with no database these tests see
 * zero registered devices, which is exactly the state that still proves the
 * gating (recipients counts who was ALLOWED, optedOut counts who was not).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { notifyAmberUsers } from "./notify.js";
import {
  categoryForPushType,
  normalizeCategories,
  normalizeMuted,
} from "../routes/notification-settings.js";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const SENDER = "cccccccc-3333-4333-8333-333333333333";

/**
 * NO BLOCKS, INJECTED EVERYWHERE fromAmberId IS SET.
 *
 * The real blockedIdsFor reads the database, and the fail-closed contract says
 * an unreadable list sends nothing -- so in a test process with no database
 * every push from a named sender is correctly suppressed. Injecting an empty
 * Set is how a test says "the block list was readable and nobody is blocked",
 * which is the state these tests are actually about.
 */
const noBlocks = async () => new Set();

const prefs = (over = {}) => ({
  channels: { apple: true, imessage: false },
  categories: normalizeCategories(over.categories),
  muted: normalizeMuted(over.muted),
  ...(over.channels ? { channels: over.channels } : {}),
});

test("push off entirely: nobody is a recipient", async () => {
  const out = await notifyAmberUsers({
    ownerIds: [A, B],
    title: "x",
    data: { type: "note" },
    getPrefs: async () => prefs({ channels: { apple: false, imessage: false } }),
  });
  assert.equal(out.optedOut, 2);
  assert.equal(out.recipients, 0);
});

test("one category off does not turn the others off", async () => {
  const getPrefs = async () => prefs({ categories: { note: false } });
  const muted = await notifyAmberUsers({ ownerIds: [A], title: "x", data: { type: "note" }, getPrefs });
  assert.equal(muted.optedOut, 1);
  // 'share' is the older spelling of the same decision and must be gated with it.
  const alsoMuted = await notifyAmberUsers({ ownerIds: [A], title: "x", data: { type: "share" }, getPrefs });
  assert.equal(alsoMuted.optedOut, 1);
  const through = await notifyAmberUsers({ ownerIds: [A], title: "x", data: { type: "circle" }, getPrefs });
  assert.equal(through.optedOut, 0);
  assert.equal(through.recipients, 1);
});

test("a muted person is silenced without silencing the category", async () => {
  const getPrefs = async () => prefs({ muted: [SENDER] });
  const fromThem = await notifyAmberUsers({
    ownerIds: [A],
    title: "x",
    data: { type: "note" },
    fromAmberId: SENDER,
    getBlockedIds: noBlocks,
    getPrefs,
  });
  assert.equal(fromThem.optedOut, 1);

  const fromSomeoneElse = await notifyAmberUsers({
    ownerIds: [A],
    title: "x",
    data: { type: "note" },
    fromAmberId: B,
    getBlockedIds: noBlocks,
    getPrefs,
  });
  assert.equal(fromSomeoneElse.recipients, 1);

  // A push with nobody behind it (a reminder coming due) is not mutable by
  // person, because there is no person to mute.
  const noSender = await notifyAmberUsers({ ownerIds: [A], title: "x", data: { type: "reminder" }, getPrefs });
  assert.equal(noSender.recipients, 1);
});

test("an unknown push type is never gated by category", async () => {
  // A new type nobody has taught the table about must still arrive; the
  // alternative is shipping a feature that is silent for everybody.
  const out = await notifyAmberUsers({
    ownerIds: [A],
    title: "x",
    data: { type: "something_new" },
    getPrefs: async () => prefs({ categories: { note: false, circle: false } }),
  });
  assert.equal(out.recipients, 1);
});

test("unreadable settings SEND rather than mute", async () => {
  const out = await notifyAmberUsers({
    ownerIds: [A],
    title: "x",
    data: { type: "note" },
    getPrefs: async () => {
      throw new Error("profile_extra is having a moment");
    },
  });
  assert.equal(out.optedOut, 0);
  assert.equal(out.recipients, 1);
});

test("the category table maps what the app actually sends", () => {
  assert.equal(categoryForPushType("note"), "note");
  assert.equal(categoryForPushType("share"), "note");
  assert.equal(categoryForPushType("DM"), "dm");
  assert.equal(categoryForPushType("question"), "question");
  assert.equal(categoryForPushType(""), null);
  assert.equal(categoryForPushType(undefined), null);
  assert.equal(categoryForPushType("nonsense"), null);
});

test("a missing category key means ON, and a mute list keeps only real ids", () => {
  assert.equal(normalizeCategories({}).dm, true);
  assert.equal(normalizeCategories({ dm: false }).dm, false);
  assert.equal(normalizeCategories(null).circle, true);
  assert.deepEqual(normalizeMuted([A, A, "not-a-uuid", 7, null]), [A]);
  assert.deepEqual(normalizeMuted("nope"), []);
});

/**
 * A BLOCK IS NOT A PREFERENCE, AND IT IS NOT A MUTE.
 *
 * Mute is a setting the owner can change and it lives in profile_extra. A block
 * lives in dm_blocks and, until this, was consulted in exactly three places, all
 * of them in routes/dms.js. So blocking somebody stopped their direct messages
 * and left them free to put a circle add, a shared note or a connection request
 * on the recipient's lock screen with their own name attached.
 *
 * This is the one funnel every social push already goes through, which is why
 * the check belongs here rather than at ten call sites.
 */
test("A BLOCKED SENDER REACHES NOBODY, whatever their settings say", async () => {
  const out = await notifyAmberUsers({
    ownerIds: [A, B],
    title: "hi",
    fromAmberId: SENDER,
    // Everything on. The block has to win anyway.
    getPrefs: async () => prefs({}),
    getBlockedIds: async () => new Set([A.toLowerCase()]),
    sendPush: async () => ({ sent: 1, failed: 0 }),
  });
  assert.equal(out.optedOut, 1, "the blocked recipient still got it");
});

test("THE BLOCK IS CHECKED BEFORE THE SETTINGS, because unreadable settings send", async () => {
  /**
   * getPrefs failing defaults to SENDING, which is right for a preference and
   * catastrophic for a block. Asked in the other order, a blocked recipient
   * would be delivered to every time their settings row failed to load.
   */
  const out = await notifyAmberUsers({
    ownerIds: [A],
    title: "hi",
    fromAmberId: SENDER,
    getPrefs: async () => {
      throw new Error("settings unavailable");
    },
    getBlockedIds: async () => new Set([A.toLowerCase()]),
    sendPush: async () => ({ sent: 1, failed: 0 }),
  });
  assert.equal(out.sent, 0, "an unreadable settings row let a blocked sender through");
  assert.equal(out.optedOut, 1);
});

test("AN UNREADABLE BLOCK LIST SENDS NOTHING, rather than sending to everyone", async () => {
  /**
   * null means "could not tell". An empty Set would mean "nobody is blocked" and
   * would deliver. Failing open here puts a push from somebody's blocker on
   * their lock screen, invisibly, for as long as the database is unhappy.
   */
  const out = await notifyAmberUsers({
    ownerIds: [A, B],
    title: "hi",
    fromAmberId: SENDER,
    getPrefs: async () => prefs({}),
    getBlockedIds: async () => null,
    sendPush: async () => ({ sent: 1, failed: 0 }),
  });
  assert.equal(out.sent, 0);
  assert.equal(out.optedOut, 2, "everybody should be held back, not just one");
});

test("a push with nobody behind it is never blocked, because there is nobody to block", async () => {
  // A reminder coming due has no sender. Running the block path on it would be
  // a query per notification for a question with no meaning.
  let asked = false;
  const out = await notifyAmberUsers({
    ownerIds: [A],
    title: "Reminder",
    data: { type: "reminder" },
    fromAmberId: null,
    getPrefs: async () => prefs({}),
    getBlockedIds: async () => {
      asked = true;
      return null;
    },
    sendPush: async () => ({ sent: 1, failed: 0 }),
  });
  assert.equal(asked, false, "looked up a block list for a push from nobody");
  assert.equal(out.optedOut, 0);
});
