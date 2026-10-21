/**
 * The "message Amber first" deep link, built locally.
 *
 * WHY THIS REPLACED lib/loop-opt-in.js. Apple's anti-spam heuristics mean a
 * sender cannot reliably cold-message a number it has never been in a thread
 * with. The escape hatch is to get the USER to send the first message: hand them
 * a link that opens Messages pre-addressed to Amber's number with a body typed
 * in, they hit send, and from then on Amber can reach them.
 *
 * The old implementation asked Loop's API to generate that link. That made a
 * network call to a third party, on the sign-in error path, to produce a string
 * that is entirely derivable from a phone number and a message body — and it
 * needed LOOP_API_KEY, which is not set, so in production it always returned
 * not_configured and the user got the plain-text fallback instead of a button.
 *
 * So the link is built here. No API key, no network call, nothing to fail, and
 * no second messaging vendor in a service whose only transport is Photon.
 *
 * The one thing lost is Loop's per-link opt-in code, which let an inbound message
 * be attributed back to a specific issuance. `clickId` still goes into the body
 * so the inbound webhook can attribute it — the same capability, without asking
 * anyone's permission for it.
 */

/** Amber's own iMessage number, the one the user is told to message. */
export function senderPhone() {
  return process.env.MEDHA_SENDER_PHONE || "+15550100007";
}

// Always available: a deep link needs a number and a body, both of which we have.
export function isOptInConfigured() {
  return !!senderPhone();
}

/**
 * Build the opt-in links for a body of text.
 *
 * Return shape matches the old Loop helper on purpose, so the two callers
 * (mobile-auth's OTP request, medha-dashboard's sign-in) did not have to change
 * their branching:
 *
 *   { ok: true, data: { id, imessage, sms, url } }
 *   { ok: false, reason: "invalid_body" }
 *
 * `[opt-in-code]` in the body is substituted with the click id (or a short
 * timestamp) rather than being sent to a third party to fill in.
 */
export function generateOptInUrl({ body, clickId } = {}) {
  if (!body || typeof body !== "string") return { ok: false, reason: "invalid_body" };
  const to = senderPhone();
  // Base36 of the epoch: short enough to type, unique enough to attribute.
  const code = String(clickId || "").trim() || `t${Date.now().toString(36)}`;
  const text = body.includes("[opt-in-code]")
    ? body.replace("[opt-in-code]", code)
    : `${body} ${code}`;
  const encoded = encodeURIComponent(text);
  return {
    ok: true,
    data: {
      id: code,
      // iOS opens Messages with the recipient and body prefilled. `sms:` is the
      // form iOS actually honors for a prefilled body; the imessage: scheme is
      // kept for clients that prefer it.
      imessage: `imessage://${to}?body=${encoded}`,
      sms: `sms:${to}&body=${encoded}`,
      url: null, // there is no hosted landing page, and pretending otherwise is worse
    },
  };
}

/** Kept async-compatible: the old helper was awaited at both call sites. */
export async function generateOptInUrlAsync(args) {
  return generateOptInUrl(args);
}
