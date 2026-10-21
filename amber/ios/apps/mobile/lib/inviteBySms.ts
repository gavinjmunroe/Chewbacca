import { Linking, Platform } from 'react-native';

/**
 * INVITING SOMEBODY TO AMBER, BY OPENING THEIR MESSAGES APP.
 *
 * WHY THIS IS ITS OWN FILE. The web's faint suggestion nodes and the DM modal's
 * "not on Amber yet" rows do exactly the same thing, and the thing they do has a
 * trap in it that is invisible when you get it wrong:
 *
 *   iOS wants   sms:<number>&body=<text>
 *   Android wants sms:<number>?body=<text>
 *
 * Use the wrong separator and NOTHING ERRORS. Messages opens, addressed
 * correctly, with an empty draft -- which looks precisely like the invite text
 * being lost somewhere in the app. A second copy of that expression in a second
 * file is a coin flip on whether the next person to touch it keeps the comment
 * explaining why the ternary is there.
 *
 * NOTHING IS EVER SENT ON THE USER'S BEHALF. This opens a prefilled composer and
 * stops. The person presses send, which is the only correct way for an app to
 * text somebody, and is the same rule Amber follows when it drafts a message in
 * chat.
 */

/** The invite. One line about why, and the link. */
export const INVITE_TEXT =
  "I'm using Amber to keep track of the people I actually care about. Join me: https://amber.app";

/**
 * The composer URL.
 *
 * Pure and exported so the separator rule can be tested on both platforms
 * without a simulator, which is the only way anyone would ever catch it
 * regressing -- the failure is silent and looks like a content bug.
 */
export function smsInviteUrl(phone: string, text: string = INVITE_TEXT, os: string = Platform.OS): string {
  const sep = os === 'ios' ? '&' : '?';
  return `sms:${phone}${sep}body=${encodeURIComponent(text)}`;
}

export type InviteOutcome = 'opened' | 'no-number' | 'cannot-open';

/**
 * Invite the person behind a contact id, fetching their number on the tap.
 *
 * WHY THE FETCH IS HERE AND NOT ON THE SCREEN. The web's faint nodes carry a
 * contact id and nothing else, deliberately: holding a phone number for every
 * node would mean pulling the whole address book onto the profile so that up to
 * eight of them could skip one request. One request, on the tap, by the person
 * who asked for it.
 *
 * AND WHY IT IS IN A LIB. Both the web card and the full-screen overlay offer
 * this, and the overlay is mounted by home.tsx, which has none of the profile's
 * state. Passing a handler down two unrelated trees to reach it is how the
 * overlay ends up quietly missing the action the card has.
 */
export async function inviteContactToAmber(
  contactId: string,
  displayName?: string,
): Promise<InviteOutcome> {
  const { getContact } = await import('./contacts');
  const { toast } = await import('./toast');
  let phone: string | null = null;
  try {
    const res = await getContact(contactId);
    if (res.ok) {
      const c = res.data.contact;
      phone = c.phone ?? c.phoneNumbers?.[0] ?? null;
    }
  } catch {
    phone = null;
  }
  const outcome = await inviteBySms(phone);
  if (outcome === 'no-number') toast.error(`No number saved for ${displayName || 'them'}.`);
  else if (outcome === 'cannot-open') toast.error('Couldn’t open Messages.');
  return outcome;
}

/**
 * Open Messages with the invite ready to send.
 *
 * Returns WHICH failure it was rather than a boolean, because the two are not
 * the same thing to the person holding the phone: "no number saved for them" is
 * something they can fix on the contact card, and "couldn't open Messages" is
 * not. Collapsing both into one shrug is how a working feature looks broken.
 */
export async function inviteBySms(
  phone: string | null | undefined,
  text: string = INVITE_TEXT,
): Promise<InviteOutcome> {
  const number = (phone ?? '').trim();
  if (number.length === 0) return 'no-number';
  const url = smsInviteUrl(number, text);
  try {
    const ok = await Linking.canOpenURL(url);
    if (!ok) return 'cannot-open';
    await Linking.openURL(url);
    return 'opened';
  } catch {
    return 'cannot-open';
  }
}
