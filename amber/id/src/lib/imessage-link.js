/**
 * WHO IS ALLOWED TO BE YOU OVER TEXT.
 *
 * The Photon webhook receives a phone number and, until this existed, treated
 * it as proof of identity: getUserByPhone(sender) -> ownerId -> your contacts,
 * your notes, your research. Nothing in that chain was checked by us. It worked
 * because Apple's handle registration is hard to forge, which is a property of
 * somebody else's system that we neither control nor observe.
 *
 * This module is the decision that now sits in front of it. It is deliberately
 * pure -- a row, a string, two pieces of config in; one verdict out -- because
 * the interesting cases are the ones that are miserable to reproduce against a
 * live webhook, and a gate whose edge cases are untested is a gate that will be
 * quietly wrong in exactly the situation it exists for.
 *
 * WHAT IT ESTABLISHES IS CONSENT, NOT AUTHENTICITY. The owner arms the channel
 * from an app session that already proved the phone. We still cannot tell a
 * forged handle from a real one; what we can tell is whether the person who
 * owns this account ever asked to be reachable this way. An account that never
 * asked is not reachable, and that is the whole of the protection.
 *
 * NOT THE SAME SWITCH AS notification-settings.channels.imessage. That one is
 * outbound: may Amber text me my reminders. This one is inbound: may a text
 * command my account. Conflating them would mean turning on reminder delivery
 * silently handed out write access to a contact graph, which is the kind of
 * coupling that reads as reasonable right up until it is a breach.
 */

/**
 * A sender we are willing to key an account on.
 *
 * An iMessage handle is not always a phone number -- Apple IDs are email
 * addresses, and normalizePhone passes anything non-numeric straight through
 * untouched. Before this check, "someone@example.com" reached createUser and
 * got written into users.phone, minting an account keyed on an email in a
 * column the entire service treats as E.164. The gate is the cheap place to
 * refuse that.
 */
export function isLinkablePhone(value) {
  return /^\+[1-9]\d{6,14}$/.test(String(value ?? ""));
}

/** Parse the ALLOWED_TEST_NUMBERS shape into a Set. Empty means empty. */
export function parseAllowlist(raw) {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Is this account armed for texts from this exact number? */
export function isLinkedTo(user, senderE164) {
  if (!user) return false;
  // Both columns are checked, and only one of them needs its own line. A null
  // imessage_linked_phone can never equal a sender that got past isLinkablePhone,
  // so the comparison already refuses it; a separate `if (!linked) return false`
  // was a guard no test could tell the absence of, which is the definition of
  // decoration. The timestamp does need its own check -- without it, a row that
  // holds a stale phone with no arming date would read as armed.
  if (!user.imessage_linked_at) return false;
  return String(user.imessage_linked_phone) === String(senderE164);
}

/**
 * THE ONE DECISION, so the webhook has one branch instead of four.
 *
 *   reject   drop it on the floor and log. Nobody is told anything, because
 *            everything in this bucket is either junk or a sender we have
 *            already decided not to talk to.
 *   enroll   a number with no account behind it. Create one, armed, because
 *            the text IS the signup and there is no prior owner whose account
 *            could be taken -- the account would not exist otherwise.
 *   link     an account exists and has not armed this channel. This is the
 *            case the whole module is for. It gets an answer rather than
 *            silence: a person who signed up in the app, was shown Amber's
 *            number, texted it, and heard nothing back has been handed a
 *            broken product in the name of security.
 *   proceed  armed for this number. Run the pipeline.
 */
export function dmAdmission({ user, senderE164, dmOpen, allowlist } = {}) {
  if (!isLinkablePhone(senderE164)) {
    return { action: "reject", reason: "sender_not_e164" };
  }
  const allowed = allowlist instanceof Set ? allowlist : parseAllowlist(allowlist);
  if (!dmOpen && !allowed.has(senderE164)) {
    return { action: "reject", reason: "unauthorized_sender" };
  }
  if (!user) return { action: "enroll", reason: "new_number" };
  if (isLinkedTo(user, senderE164)) {
    return { action: "proceed", reason: "linked", ownerId: user.amber_id || null };
  }
  // Armed, but for a different number: they changed their phone in the app and
  // the channel did not follow. Same verdict as never-armed, and on purpose --
  // the alternative is a channel that migrates to whatever number an account
  // happens to carry, which is the property the second column exists to deny.
  return {
    action: "link",
    reason: user.imessage_linked_at ? "linked_to_other_number" : "channel_not_linked",
  };
}

/**
 * What an unlinked account is told, once.
 *
 * No account details, no name, no confirmation of what is on the account --
 * just the one instruction that resolves it. Somebody who reached this without
 * owning the account learns only that the number they texted from has an Amber
 * account, which they would have to control the number to discover at all.
 */
export const LINK_INSTRUCTION =
  "Hi! This number is registered to an Amber account, but texting is not turned on for it yet. " +
  "Open Amber, tap the Amber logo, then Connections > Amber, and turn on Texting Amber. Then text me here and I'll be right with you.";

// Readiness is separate from consent: a linked number may still be outside the beta.
export function textingAvailability(row, { amberNumber, env = process.env } = {}) {
  if (!amberNumber || !env.PHOTON_PROJECT_ID || !env.PHOTON_PROJECT_SECRET || !env.PHOTON_WEBHOOK_SECRET) {
    return { available: false, unavailableReason: 'service_unconfigured' };
  }
  if (env.DM_ENROLLMENT_OPEN !== 'true' && !parseAllowlist(env.ALLOWED_TEST_NUMBERS).has(row?.phone)) {
    return { available: false, unavailableReason: 'beta_not_enabled' };
  }
  return { available: true, unavailableReason: null };
}
