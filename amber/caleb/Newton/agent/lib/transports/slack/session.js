/**
 * Slack session map.
 *
 * Bridges the Slack transport into Medha's existing agent loop without
 * touching agent.js. The pattern:
 *
 *   1. Slack /events handler synthesizes a Loop-shaped envelope with a
 *      derived `from` value (e.g. `slack:T012:U456`) and dispatches it
 *      through `enqueueMessage` exactly like a Loop webhook.
 *   2. Before dispatching, the handler stamps the Slack context
 *      (channel, thread_ts, bot_token info) into this map keyed by
 *      that derived `from`.
 *   3. When agent.js eventually calls `sendMessage(from, text, opts)`,
 *      transport.js looks up the from value here. If a Slack session
 *      exists, it routes the reply via responder.sendSlackReply
 *      instead of Loop, threaded into the originating thread_ts.
 *   4. The handler clears the entry once the agent loop returns, OR
 *      the TTL purges it if the agent loop hung.
 *
 * Single-process only. Same constraint as dedup — Slack on Medha runs
 * one Railway replica.
 */

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 min upper bound, matches Slack ack window + agent timeout

// from -> { channel, thread_ts, slackUserId, team, createdAt }
const sessions = new Map();

function purgeStale(now) {
  for (const [key, sess] of sessions) {
    if (now - sess.createdAt > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}

/**
 * Stamp a Slack session for the given synthetic `from` value. Any
 * subsequent outbound sendMessage for this `from` will route to Slack
 * (channel + thread_ts) instead of Loop.
 *
 * @param {string} from — the synthetic identifier produced by envelope.js
 * @param {Object} ctx
 * @param {string} ctx.channel — Slack channel id
 * @param {string} ctx.thread_ts — Slack thread anchor for replies
 * @param {string} ctx.slackUserId — original Slack user id
 * @param {string} ctx.team — Slack team / workspace id
 */
export function setSession(from, ctx) {
  if (!from || !ctx?.channel) return;
  purgeStale(Date.now());
  sessions.set(from, {
    channel: ctx.channel,
    thread_ts: ctx.thread_ts,
    slackUserId: ctx.slackUserId || null,
    team: ctx.team || null,
    createdAt: Date.now(),
  });
}

/** Look up the active Slack session for `from`, or null if none. */
export function getSession(from) {
  if (!from) return null;
  const sess = sessions.get(from);
  if (!sess) return null;
  if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
    sessions.delete(from);
    return null;
  }
  return sess;
}

/** Clear the session — called once the agent loop has finished replying. */
export function clearSession(from) {
  if (!from) return;
  sessions.delete(from);
}

/** Test-only. */
export function _resetSessions() {
  sessions.clear();
}
