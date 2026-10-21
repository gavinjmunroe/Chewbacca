/**
 * Reply capture — divert the agent's outbound replies to an in-process sink
 * instead of delivering them over Loop/iMessage.
 *
 * Why this exists: the iMessage agent and the iOS app share ONE agent loop
 * (agent.js handleWebhookMessage), and that loop sends every reply through the
 * single module-level `sendMessage` in transport.js. iMessage is the only
 * delivery rail it knows about. The app's "talk to tool-Medha in-app" feature
 * (POST /api/v1/quick-call/stream) needs the SAME agent run, but it wants the
 * reply back over its HTTP/SSE response, not pushed to the caller's Messages.
 *
 * Rather than thread a transport through the whole agent (it imports
 * `sendMessage` directly, not via a context arg), we wrap the agent run in an
 * AsyncLocalStorage context. transport.sendMessage checks that context on every
 * send: if one is active and the recipient matches the captured caller, the
 * message is handed to the sink and NOT delivered over Loop. With no active
 * context — every normal iMessage webhook — this is a no-op and behavior is
 * unchanged.
 *
 * AsyncLocalStorage propagates across the agent's `await`s and its burst-flush
 * `setTimeout`s (those timers are created inside the run scope), so replies the
 * queue flushes after the dispatch promise resolves are still captured.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with an active reply-capture context bound to `contact`.
 *
 * @param {object} opts
 * @param {string} opts.contact   E.164 phone of the caller whose replies to divert.
 * @param {(text: string, sendOpts: object) => void} opts.onMessage
 *        Called for each diverted outbound send to that contact.
 * @param {(err: Error) => void} [opts.onError]
 *        Optional. NOT consumed here — it rides along in the capture-context
 *        object so the queue runner (agent.js runQueue) can invoke it when the
 *        agent run for THIS captured item throws. Kept on the context purely so
 *        a single object describes everything one captured run needs.
 * @param {(phase: string, label: string) => void} [opts.onProgress]
 *        Optional. Called by the tool dispatcher (via emitProgress) as each
 *        tool starts, so a streamed surface can show "Checking your calendar"
 *        instead of an idle spinner. No-op for normal iMessage runs, which
 *        never set up a capture context.
 * @param {() => any} fn          The agent run (e.g. dispatchLoopEvent(...)).
 * @returns {any} Whatever `fn` returns.
 */
export function runWithReplyCapture(
  { contact, onMessage, onError, onProgress },
  fn,
) {
  return storage.run(
    {
      contact: contact ? String(contact) : null,
      onMessage,
      onError,
      onProgress,
    },
    fn,
  );
}

/**
 * Called by transport.sendMessage. Returns true if the message was captured
 * (and the caller must therefore SKIP the real Loop delivery).
 *
 * Captures only direct DMs to the bound caller: group sends (opts.group) and
 * sends addressed to anyone else are always delivered normally, so an in-app
 * request can never swallow a message meant for a third party.
 *
 * @param {string} contact   Recipient passed to sendMessage.
 * @param {string} message   Message body (pre-render agent text).
 * @param {object} [opts]    sendMessage opts.
 * @returns {boolean}
 */
export function tryCaptureReply(contact, message, opts = {}) {
  const ctx = storage.getStore();
  if (!ctx || typeof ctx.onMessage !== "function") return false;
  if (opts.group) return false;
  if (ctx.contact && contact && String(contact) !== ctx.contact) return false;
  try {
    ctx.onMessage(typeof message === "string" ? message : "", opts);
  } catch {
    // A failing sink must never break the agent run; the send is still
    // considered captured (we deliberately do not fall through to Loop).
  }
  return true;
}

/**
 * Emit a tool-progress notification to the active capture context, if any.
 * Called by the tool dispatcher as a tool starts. A no-op when no capture
 * context is active (every normal iMessage run) and when the context did not
 * register an onProgress handler, so it is always safe to call unconditionally.
 *
 * A throwing handler is swallowed: progress is advisory and must never break
 * the agent run.
 *
 * @param {string} phase  Short machine tag, e.g. "tool".
 * @param {string} label  Human-facing status, e.g. "Checking your calendar".
 */
export function emitProgress(phase, label) {
  const ctx = storage.getStore();
  if (!ctx || typeof ctx.onProgress !== "function") return;
  try {
    ctx.onProgress(phase, label);
  } catch {
    // Advisory only — never let a progress sink failure surface to the run.
  }
}

/** True when a reply-capture context is currently active. */
export function isCapturing() {
  return storage.getStore() != null;
}
