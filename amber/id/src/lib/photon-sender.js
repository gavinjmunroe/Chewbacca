/**
 * Shared Spectrum/Photon DM sender.
 *
 * Exports the Spectrum singleton helpers (getSpectrumApp, _resetSpectrumApp)
 * so photon-webhook.js can share the same live gRPC connection, and
 * sendPhotonIMessage for any caller that needs to push an iMessage DM
 * without touching the webhook router.
 *
 * Credentials default to PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET env vars.
 * The optional overrides in getSpectrumApp allow tests or alternate senders
 * to substitute credentials without mutating the environment.
 */

import { createPhotonSpaceCache } from "./photon-space-cache.js";

const dmSpaces = createPhotonSpaceCache();

// Lazily initialized once; kept alive across calls so gRPC does not
// reconnect per message (which trips Photon's ip_per_minute limit).
// Two near-simultaneous callers share the same in-flight init promise.
let _spectrumApp = null;
let _spectrumAppPromise = null;

export async function getSpectrumApp({ projectId, projectSecret } = {}) {
  if (_spectrumApp) return _spectrumApp;
  if (_spectrumAppPromise) return _spectrumAppPromise;
  const pid = projectId ?? process.env.PHOTON_PROJECT_ID;
  const psecret = projectSecret ?? process.env.PHOTON_PROJECT_SECRET;
  if (!pid || !psecret) {
    throw new Error("PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET not set");
  }
  // Assign before the first await: otherwise simultaneous OTP requests can
  // both pass the null check while imports load and open separate connections.
  _spectrumAppPromise = (async () => {
    const [{ Spectrum }, { imessage }] = await Promise.all([
      import("spectrum-ts"), import("spectrum-ts/providers/imessage"),
    ]);
    return Spectrum({ projectId: pid, projectSecret: psecret, providers: [imessage.config()] });
  })().then((app) => {
    _spectrumApp = app;
    _spectrumAppPromise = null;
    return app;
  }).catch((err) => {
    _spectrumAppPromise = null;
    throw err;
  });
  return _spectrumAppPromise;
}

export function _resetSpectrumApp() {
  dmSpaces.clear();
  _spectrumApp = null;
  _spectrumAppPromise = null;
}

/**
 * Send a plain-text iMessage DM to a recipient E.164 phone number.
 * Uses im.space.create(recipientE164) which derives the GUID for shared-mode
 * senders without a network call, and calls chats.create for dedicated numbers.
 * Resets the singleton on any error so the next caller re-initializes.
 *
 * @param {string} recipientE164
 * @param {string} text
 * @returns {Promise<string>} resolves to the space id
 */
export async function sendPhotonIMessage(recipientE164, text) {
  const sanitized = (text || "").replace(/\s*[—–]\s*/g, ", ");
  const { text: mkText } = await import("spectrum-ts");
  const { imessage } = await import("spectrum-ts/providers/imessage");
  const app = await getSpectrumApp();
  try {
    const im = imessage(app);
    const sender = process.env.MEDHA_SENDER_PHONE;
    const dmSpace = await dmSpaces.get(`${sender || "default"}:${recipientE164}`, () =>
      sender ? im.space.create(recipientE164, { phone: sender }) : im.space.create(recipientE164),
    );
    await dmSpace.send(mkText(sanitized));
    return dmSpace.id;
  } catch (err) {
    _resetSpectrumApp();
    throw err;
  }
}

/**
 * Send an iMessage and report the outcome instead of throwing.
 *
 * sendPhotonIMessage throws on failure, which suits a request handler that wants
 * to pattern-match the error. Background senders (the reminder scheduler, the OTP
 * route) want a value they can branch on and record an attempt from, so this is
 * the same send behind the { ok, reason, detail } shape those callers already
 * handle. It is the ONLY iMessage sender in this service: there is no second
 * transport, and adding one would mean a message could go out over a path with
 * different delivery guarantees than the one the code above it was written for.
 *
 *   sendIMessage({ toPhone, text })
 *     -> { ok: true, messageId }                       // messageId is the space id
 *     -> { ok: false, reason: "missing_args" }
 *     -> { ok: false, reason: "not_configured", detail } // no Photon credentials
 *     -> { ok: false, reason: "send_failed", detail }
 */
export async function sendIMessage({ toPhone, text } = {}) {
  const to = typeof toPhone === "string" ? toPhone.trim() : "";
  const body = typeof text === "string" ? text : "";
  if (!to || !body) return { ok: false, reason: "missing_args" };
  try {
    const spaceId = await sendPhotonIMessage(to, body);
    return { ok: true, messageId: spaceId ?? null };
  } catch (err) {
    const detail = err?.message ? String(err.message) : String(err);
    // A missing credential is an operator problem, not a bad recipient, and the
    // two need different responses — so they get different reasons.
    const reason = detail.includes("PHOTON_PROJECT_ID") ? "not_configured" : "send_failed";
    return { ok: false, reason, detail };
  }
}
