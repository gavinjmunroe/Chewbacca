/**
 * CHAT CANNOT SCHEDULE, AND MUST STOP IMPLYING THAT IT DID.
 *
 * "Add a reminder to meet with Vega on Google Meet on Monday at noon. Set the
 * reminder for 11am on Monday." came back as:
 *
 *   "Done on my end isn't something I can promise here since calendar writes
 *    confirm themselves in the app. Here is what you asked for:
 *    Event: Meet with Vega on Google Meet  Date: Monday, September 14, 2026
 *    Time: 12:00 PM  Reminder: 11:00 AM Monday
 *    Check that it landed in your calendar..."
 *
 * Nothing was created. Nothing could have been: /v1/chat has no write path to
 * events or reminders at all -- the fact-capture router it does have writes only
 * contact_field, self_field, self_fact, experience, fact and note. Scheduling is
 * an entirely separate call the CLIENT makes to /v1/reminders/parse.
 *
 * TWO SEPARATE LIES IN THAT REPLY, and only one of them is about a database.
 *
 * The first sentence is invented. There is no instruction anywhere in this
 * service that says calendar writes confirm themselves in the app; the model
 * produced a plausible-sounding system constraint to paper over a gap it had no
 * information about. Given no statement of what it can and cannot do, that is
 * what a model does with a request it cannot fulfil, and it is the worst
 * available behavior: unfalsifiable, confident, and shaped exactly like a real
 * limitation.
 *
 * The rest is a formatted confirmation. `Event: ... Date: ... Time: ...` is what
 * a calendar entry looks like when it has been created. Prefacing it with "here
 * is what you asked for" is not a disclaimer that anybody reads.
 *
 * SO IT IS TOLD. Not "be careful about claiming things" -- a hedge instruction
 * produces hedged claims, which is what happened. It is told the specific,
 * true, checkable fact: this endpoint has no scheduling capability, the app
 * handles it on its own, and a receipt is not this turn's to give.
 */

/**
 * The scheduling stance, appended to the chat system prompt.
 *
 * Deliberately says what IS true rather than only what is forbidden. A model
 * told only "do not claim you scheduled it" still has to invent something to
 * say; told that the app is already handling it and will confirm on its own, it
 * has an accurate thing to say instead, and does not need to make one up.
 */
export const SCHEDULE_HONESTY = `
SCHEDULING. You cannot create, change or delete events, reminders or calendar
entries. This conversation has no write access to them, and nothing you say in
this reply will schedule anything.

When someone asks you to set a reminder or put something on their calendar, the
app is already handling it separately, in parallel with this reply, and it
confirms on its own with a toast when it succeeds or a visible error when it
does not. You are not the receipt.

So do not print an Event / Date / Time / Reminder block, do not say it is done,
set, added, scheduled or on the calendar, do not tell them to go and check that
it landed, and do not invent a reason why you cannot confirm. Acknowledge what
they asked for in one short sentence, in your own words, and move on to anything
they actually asked you a question about. If the app fails to save it they will
see that failure themselves; do not pre-empt it and do not apologize for it.`.trim();

/**
 * Wording the model is not allowed to reach for.
 *
 * The point of a list is that "did the fix work" becomes something a test can
 * answer. The failure was one specific reply and a prompt change without a way
 * to check it is a hope. Every phrase here is either from the actual bad reply
 * or the obvious next thing to say once the first is closed off.
 */
export const FALSE_CONFIRMATION_PATTERNS = Object.freeze([
  /\bdone on my end\b/i,
  /\bconfirm themselves\b/i,
  // THE SUBJECT IS REQUIRED, because an optional one made this fire on the
  // negation. "I can't set that from here, but the app is saving it now" is the
  // correct answer and contains "set that"; a pattern that flags the honest
  // reply as a lie is worse than no pattern, because it is the one somebody
  // deletes the whole list over.
  /\bi(?:'ve| have)?\s+(?:added|created|scheduled|set)\s+(?:that|this|it|the reminder|the event)\b/i,
  // The same claim with the subject dropped, which only reads as a claim at the
  // start of a sentence: "Scheduled it for noon."
  /^\s*(?:added|created|scheduled|set)\s+(?:that|this|it|the reminder|the event)\b/im,
  /\bit'?s (?:done|set|scheduled|on your calendar)\b/i,
  /\bcheck that it landed\b/i,
  /^\s*event:\s/im,
]);

/**
 * Does a draft reply claim a write that never happened?
 *
 * Not wired into the response path: a regex is the wrong thing to put between a
 * user and their answer, and one false positive would blank a good reply. It
 * exists so the prompt above is testable, and so the next person to loosen it
 * finds out immediately.
 */
export function claimsAWrite(text) {
  const s = String(text || "");
  return FALSE_CONFIRMATION_PATTERNS.some((re) => re.test(s));
}
