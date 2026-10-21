/**
 * Slack reply-threading policy (Tab 29).
 *
 * Decides, at SEND time, which `thread_ts` an outbound Slack reply should
 * carry. The decision is length-aware, so it can only be made once the
 * agent has produced the reply text — not at inbound-envelope time. The
 * envelope (envelope.js) records the raw threading signals on the session
 * and this function turns them into a concrete reply target.
 *
 * The rules, in priority order:
 *
 *   1. Inbound was ALREADY inside a thread (Slack sent a real
 *      `event.thread_ts` distinct from the message's own ts) — ALWAYS
 *      reply inside that thread. Never break out to top-level mid-thread.
 *
 *   2. Inbound was a DM (channel_type === "im") — reply inline (flat). A
 *      1:1 DM has no audience to protect from noise, so threading there
 *      just buries the reply under a disclosure triangle. Return undefined
 *      so the responder posts a normal DM message.
 *
 *   3. Inbound was a top-level channel post (an @mention with no
 *      thread_ts) — Medha DECIDES:
 *        - long reply (> LONG_REPLY_THRESHOLD chars): open a thread off the
 *          inbound message's own ts so the wall of text doesn't dominate the
 *          channel. Subsequent bubbles in the same turn anchor off the SAME
 *          ts, so a segmented reply stays in one thread.
 *        - short reply: post inline at top level so a one-liner reads
 *          naturally where it was asked.
 *
 * Returning `undefined` (not null) means "no thread_ts" so the value can be
 * spread/assigned straight onto a Slack API body without emitting a
 * `thread_ts: null` key.
 */

// A reply longer than this (in characters) gets tucked into a thread when it
// answers a top-level channel @mention. Tuned to roughly "more than a couple
// of sentences" — short enough that quick answers stay inline, long enough
// that a one-paragraph reply doesn't needlessly fragment the channel.
export const LONG_REPLY_THRESHOLD = 500;

/**
 * Decide the thread_ts for an outbound Slack reply.
 *
 * @param {Object} ctx
 * @param {boolean} ctx.inThread — inbound arrived inside an existing thread
 *   (Slack sent a real event.thread_ts).
 * @param {string} [ctx.threadTs] — that existing thread anchor (Slack ts).
 * @param {string} [ctx.messageTs] — the inbound message's own ts; the anchor
 *   used to OPEN a new thread for a long top-level channel reply.
 * @param {string} [ctx.channelType] — Slack channel_type ("im" for a DM,
 *   "channel"/"group"/"mpim" otherwise). app_mention events have none, which
 *   is treated as a channel.
 * @param {number} [ctx.textLength] — length of the outbound reply text.
 * @param {number} [ctx.threshold] — override LONG_REPLY_THRESHOLD (tests).
 * @returns {string|undefined} the thread_ts to reply into, or undefined to
 *   post inline at top level.
 */
export function decideSlackThreadTs({
  inThread,
  threadTs,
  messageTs,
  channelType,
  textLength,
  threshold = LONG_REPLY_THRESHOLD,
} = {}) {
  // 1. Already in a thread — stay in it. Don't break out to top-level.
  if (inThread && threadTs) return threadTs;

  // 2. DMs stay flat. Threading a 1:1 conversation just hides the reply.
  if (channelType === "im") return undefined;

  // 3. Top-level channel post. Long answers open a thread; short ones stay
  //    inline so a quick reply reads naturally where it was asked.
  const len = typeof textLength === "number" && textLength > 0 ? textLength : 0;
  if (len > threshold && messageTs) return messageTs;

  return undefined;
}
