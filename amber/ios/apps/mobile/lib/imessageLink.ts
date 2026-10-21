/**
 * THE SWITCH THAT LETS A TEXT COUNT AS YOU.
 *
 * The server side of this is db/migrations/20260912_051 and
 * lib/imessage-link.js: an inbound text carries a phone number, and until the
 * account owner arms this channel, that number is a claim the webhook refuses
 * to act on. This is the arming.
 *
 * IT IS NOT THE iMESSAGE TOGGLE ALREADY IN NOTIFICATIONS, and the two sit two
 * sections apart on the same screen, so the copy has to carry the difference on
 * its own:
 *
 *   Notifications -> iMessage    OUTBOUND. May Amber text me my reminders.
 *   Messaging     -> iMessage    INBOUND.  May a text from my number act as me
 *                                -- read my contacts, add people, make notes.
 *
 * They are one word apart and opposite in blast radius. Somebody who reads the
 * second as "the same switch, again" and flips it to stop getting texts has
 * done the reverse of what they meant, so neither row says just "iMessage" and
 * leaves it there.
 */
import { callMedhaId, type MedhaIdResult } from './medhaId';

export type ImessageLink = {
  available?: boolean;
  unavailableReason?: string | null;
  /** Armed: an inbound text from `linkedPhone` may drive this account. */
  linked: boolean;
  /** The phone on the account, which is the only number that can be armed. */
  phone: string | null;
  /** The number it was armed FOR. Differs from `phone` after a number change. */
  linkedPhone: string | null;
  linkedAt: string | null;
  /** Amber's own number: what the user is told to text. */
  amberNumber: string | null;
};

type LinkRow = {
  available?: unknown;
  unavailableReason?: unknown;
  linked?: unknown;
  phone?: unknown;
  linkedPhone?: unknown;
  linked_phone?: unknown;
  linkedAt?: unknown;
  linked_at?: unknown;
  amberNumber?: unknown;
  amber_number?: unknown;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/**
 * OFF IS THE ONLY SAFE READING OF A ROW WE DO NOT UNDERSTAND.
 *
 * `linked` is recomputed from the two fields rather than trusted, because a
 * screen that shows this on while the server has it off tells the user their
 * texts work when every one of them is being refused -- and they have no way to
 * find that out except by texting and hearing nothing.
 */
export function parseImessageLink(row: LinkRow | null | undefined): ImessageLink {
  const linkedPhone = str(row?.linkedPhone) ?? str(row?.linked_phone);
  const linkedAt = str(row?.linkedAt) ?? str(row?.linked_at);
  return {
    ...(typeof row?.available === 'boolean' ? { available: row.available, unavailableReason: str(row.unavailableReason) } : {}),
    linked: !!(linkedPhone && linkedAt),
    phone: str(row?.phone),
    linkedPhone,
    linkedAt,
    amberNumber: str(row?.amberNumber) ?? str(row?.amber_number),
  };
}

// THE PATH IS WRITTEN OUT AT EVERY CALL, not hoisted into a constant.
// lib/apiContract.test.mts reads these files statically and cannot follow an
// identifier, so a shared `const PATH` silently drops all three routes out of
// the check that every path is an absolute route on a known prefix -- a check
// that has caught a wrong prefix before. Three repetitions is the price of
// staying inside it.

export async function getImessageLink(): Promise<MedhaIdResult<ImessageLink>> {
  const res = await callMedhaId<LinkRow>({ path: '/v1/me/imessage-link', requireAuth: true });
  return res.ok ? { ...res, data: parseImessageLink(res.data) } : res;
}

/**
 * NO BODY, ON PURPOSE. The server arms the phone on the session and refuses to
 * read one from the request, because a caller that could name the number could
 * point somebody else's texts at their own account. Sending a body here would
 * be harmless and would still be the wrong thing to teach the next reader.
 */
export async function linkImessage(): Promise<MedhaIdResult<ImessageLink>> {
  const res = await callMedhaId<LinkRow>({ path: '/v1/me/imessage-link', method: 'POST', requireAuth: true });
  return res.ok ? { ...res, data: parseImessageLink(res.data) } : res;
}

export async function unlinkImessage(): Promise<MedhaIdResult<ImessageLink>> {
  const res = await callMedhaId<LinkRow>({ path: '/v1/me/imessage-link', method: 'DELETE', requireAuth: true });
  return res.ok ? { ...res, data: parseImessageLink(res.data) } : res;
}

/**
 * What the row says about itself, in one line.
 *
 * THE NUMBER-CHANGED CASE IS WHY THIS IS NOT A TERNARY. Arming pins to one exact
 * number, so changing your phone in Amber leaves a link pointing at the old one:
 * the switch is on, the server is refusing every text, and "iMessage is on" is
 * the single most misleading thing the screen could say. That state is rare,
 * invisible from the switch alone, and unrecoverable by guessing, so it gets a
 * sentence naming both numbers.
 */
export function linkStatusLine(link: ImessageLink | null | undefined): string {
  if (link?.available === false) return link.unavailableReason === 'beta_not_enabled'
    ? 'Texting is not enabled for this number in the beta yet.'
    : 'Texting is temporarily unavailable.';
  if (!link?.linked) {
    return 'Off. Texts to Amber from this phone will not reach your account.';
  }
  if (link.phone && link.linkedPhone && link.phone !== link.linkedPhone) {
    return `On for ${link.linkedPhone}, but your number is now ${link.phone}. Turn it off and back on to move it.`;
  }
  return `On for ${link.linkedPhone}. Texts from this number reach your account.`;
}

/** True when the link is armed for a number that is no longer the account's. */
export function isStaleLink(link: ImessageLink | null | undefined): boolean {
  return !!(link?.linked && link.phone && link.linkedPhone && link.phone !== link.linkedPhone);
}

/**
 * The deep link that opens Messages addressed to Amber, with a first word typed.
 *
 * Mirrors lib/imessage-opt-in.js on the server, which explains why the first
 * message has to come FROM the user: Apple will not reliably deliver a cold
 * message from a number you have never texted, so the thread has to be opened
 * from this side. Returns null rather than a broken href when there is no
 * number to address.
 */
export function amberMessagesUrl(link: ImessageLink | null | undefined): string | null {
  const to = link?.amberNumber;
  if (!to) return null;
  return `sms:${to}&body=${encodeURIComponent('Hi Amber')}`;
}
