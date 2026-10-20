/**
 * Fit review: the client rules on each reply before anything can be sent.
 *
 * Jonah, 2026-10-08, clicking the first card: "am I saying good fit or not a
 * fit based on... is the firm or founder a good fit or is the message a good
 * fit?" The buttons meant "answer this one", so they now say so: Reply to
 * this / Skip, no reply. Action ids are unchanged so cards already in the
 * channel keep working.
 *
 * Jonah asked on 2026-10-07 to see every investor reply himself and decide
 * whether it fits the company it was sent for. So a card for a client with
 * `fitReview` set opens with only Good fit / Not a fit. Good fit swaps those
 * for the usual Send / Edit buttons, Not a fit closes the card with nothing
 * sent. Both are gated by the client's approver list like a send is.
 */

import type { ReplybotClientConfig } from '../replybot/client-config';
import { replyIntent, type ReplyCopy } from './reply-intent';

export const FIT_GOOD_ACTION = 'replybot_fit_good';
export const FIT_BAD_ACTION = 'replybot_fit_bad';
// The thing to do isn't an email (get the deck, fill the form): one press says
// it's done and closes the card with nothing sent.
export const FIT_DONE_ACTION = 'replybot_done';
// A deck request: opens the send-the-deck modal, the link prefilled when the
// company's deck is already on file (src/replies/decks.ts).
export const DECK_SEND_ACTION = 'replybot_deck';
export const FIT_ACTIONS = new Set([FIT_GOOD_ACTION, FIT_BAD_ACTION, FIT_DONE_ACTION]);

/**
 * Caleb, 2026-10-09: a card shouldn't say Reply / Skip when the obvious next
 * step is Jonah doing something that isn't replying. Those kinds get a button
 * for the actual task, and a holding reply only as the second choice.
 */
const OFF_EMAIL_TASK: Record<string, string> = {
  deck: 'I sent the deck',
  form: 'I filled out the form',
};

/**
 * Whether the Slack interactivity route hands this click to the replybot.
 * server.ts used to check only the `smartlead_` prefix, so the fit buttons
 * added in PR #53 were acked and dropped: Jonah clicked Good fit on
 * 2026-10-08 and nothing happened, with no log line anywhere.
 */
export function isReplybotCardAction(actionId: string): boolean {
  return actionId.startsWith('smartlead_') || FIT_ACTIONS.has(actionId) || actionId === DECK_SEND_ACTION;
}

/** The buttons a fit-review card opens with. `value` is the card payload. */
export function fitButtons(value: string, intentKind?: string, primaryLabel?: string): any[] {
  if (intentKind === 'deck') {
    return [
      {
        type: 'button',
        text: { type: 'plain_text', text: primaryLabel || 'Send the deck', emoji: true },
        action_id: DECK_SEND_ACTION,
        style: 'primary',
        value,
      },
      // Caleb, 2026-10-09, on a card with three buttons and a grey holding
      // reply under them: "WTF IS THIS SHIT???". One job, one button, plus
      // the way out if Jonah already sent it himself.
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Already sent', emoji: true },
        action_id: FIT_DONE_ACTION,
        value,
      },
    ];
  }
  const task = intentKind ? OFF_EMAIL_TASK[intentKind] : undefined;
  if (task) {
    return [
      {
        type: 'button',
        text: { type: 'plain_text', text: task, emoji: true },
        action_id: FIT_DONE_ACTION,
        style: 'primary',
        value,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Send a holding reply', emoji: true },
        action_id: FIT_GOOD_ACTION,
        value,
      },
    ];
  }
  return [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Reply to this', emoji: true },
      action_id: FIT_GOOD_ACTION,
      style: 'primary',
      value,
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Skip, no reply', emoji: true },
      action_id: FIT_BAD_ACTION,
      style: 'danger',
      value,
    },
  ];
}

/**
 * The standard send row. Same buttons the send-ready and manual-review cards
 * build inline, so a card unlocked by Good fit behaves like any other card.
 */
export function sendButtons(
  client: ReplybotClientConfig,
  value: string,
): any[] {
  return [
    {
      type: 'button',
      text: { type: 'plain_text', text: '✅ Send as-is', emoji: true },
      action_id: 'smartlead_send',
      style: 'primary',
      value,
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '✏️ Edit & Send', emoji: true },
      action_id: 'smartlead_edit_modal',
      value,
    },
    // A Gmail draft lands in a mailbox a Clay reply never goes out of.
    ...(!client.sendMethods.includes('clay')
      ? [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📝 Save as Gmail Draft',
              emoji: true,
            },
            action_id: 'smartlead_draft',
            value,
          },
        ]
      : []),
    // The campaign calendar counts a reply as waiting until its card is sent,
    // skipped or done. Without a way to skip, a reply nobody means to answer
    // would wait there forever.
    ...(client.campaignCalendar
      ? [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Skip, no reply', emoji: true },
            action_id: FIT_BAD_ACTION,
            value,
          },
        ]
      : []),
  ];
}

/** Buttons a fresh reply card shows: fit review first when the client wants it. */
export function replyCardButtons(
  client: ReplybotClientConfig,
  value: string,
): any[] {
  return client.fitReview ? fitButtons(value) : sendButtons(client, value);
}

// ── Card layout ───────────────────────────────────────────────────

/**
 * What a fit-review card shows, in the order Jonah decides on it: which of
 * his companies this is for and who answered, what they said, what we'd
 * send back, then the two buttons. Routing detail (campaign wave, mailbox,
 * classifier reason) sits in small grey text at the bottom.
 *
 * Caleb, 2026-10-07, on the first cards in #zeutara-cold-replies: "The visual
 * hierarchy is disgusting." They opened with an emoji status, then a Name /
 * Title / Company / Email row and a raw campaign string, so the company the
 * raise was for was the fourth thing on the card.
 */
export interface FitCardInput {
  /** 'Interested', 'Needs a look' */
  verdict: string;
  leadName: string;
  leadTitle: string;
  leadCompany: string;
  leadEmail: string;
  campaignName: string;
  sendingEmail: string;
  replyText: string;
  draftBody: string;
  reason: string;
  value: string;
  postedAt: string;
  /** Slack user to @ on the card: the person who has to act on it. */
  mention?: string;
  /** Primary button label written for this card (src/replies/card-copy.ts). */
  primaryLabel?: string;
  /** Set when this company's replies are also emailed to the client (autopilot.copy). */
  copiedTo?: string;
  /** The client's registry facts the next step names (ReplybotClientConfig.replyCopy). */
  replyCopy?: ReplyCopy;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

function quote(text: string): string {
  return text.split('\n').map((line) => `>${line}`).join('\n');
}

/**
 * "Zeutara | Ivy | Pre-seed investors | Midweek founder story" → company
 * "Ivy", detail "Pre-seed investors · Midweek founder story". A name that
 * doesn't follow the pattern is shown whole as the detail.
 */
export function splitCampaign(campaignName: string, clientName: string): { company: string | null; detail: string } {
  const parts = (campaignName || '').split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && parts[0].toLowerCase() === clientName.toLowerCase()) {
    return { company: parts[1], detail: parts.slice(2).join(' · ') };
  }
  return { company: null, detail: parts.join(' · ') };
}

// A line where the person has stopped writing: sign-offs, phone footers,
// legal notices, social links. Only looked for after the first line, so a
// one-line "Thanks, no." survives.
const SIGNATURE_START =
  /^(--\s*$|regards|best( regards)?[,!]?$|thanks[,!]?$|thank you[,!]?$|cheers[,!]?$|sincerely|sent (from|via) |get outlook|\[image|this e-?mail and any attachments|confidential|phone\b|cell:|tel:|mobile\b|address\b|website\b|linkedin\b|𝕏)/i;

// Signature lines the sign-off list misses. Infinity Ventures' card on
// 2026-10-09 showed a bold name, a phone number, a street address and three
// links under a one-line question: a line that is only a bold name, or that
// carries a link, a phone number or a street address, is where they stopped
// writing.
const SIGNATURE_LINE =
  /^\*[^*]{2,60}\*$|https?:\/\/|\bwww\.|\d{3}[-. )]+\d{3}[-. ]+\d{3,4}|\d+ [A-Z][a-z]+ (Street|St|Avenue|Ave|Road|Rd|Blvd|Suite)\b/;

/**
 * Their reply, readable: signature and footer cut, mail-client hard wraps
 * joined back into sentences, bracketed duplicate URLs dropped. Conservative:
 * when nothing matches, the text is only re-wrapped.
 */
export function readableReply(text: string, max = 700): string {
  const lines = (text || '').split('\n');
  let end = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (SIGNATURE_START.test(lines[i].trim()) || SIGNATURE_LINE.test(lines[i].trim())) { end = i; break; }
  }
  const body = lines.slice(0, end).join('\n')
    // "nathan@afore.vc [nathan@afore.vc]" and "<https://…>" echoes
    .replace(/\s*\[(mailto:)?[^\]\s]+@[^\]\s]+\]/g, '')
    .replace(/\s*\[https?:\/\/[^\]\s]+\]/g, '');
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
  return clip(paragraphs.join('\n\n').trim(), max);
}

export function fitReviewCardBlocks(input: FitCardInput, clientName: string): any[] {
  const { company, detail } = splitCampaign(input.campaignName, clientName);
  const who = [input.leadName, input.leadCompany].filter(Boolean).join(', ') || input.leadEmail;
  const title = company ? `${company}: ${who}` : who;
  const person = [input.leadTitle, input.leadEmail].filter(Boolean).map(esc).join('  ·  ');
  const meta = [
    `*${esc(input.verdict)}*`,
    input.reason ? esc(clip(input.reason, 220)) : '',
    detail ? esc(detail) : '',
    input.sendingEmail ? `from ${esc(input.sendingEmail)}` : '',
    input.postedAt,
  ].filter(Boolean).join('  ·  ');

  const intent = replyIntent(input.replyText, {
    leadEmail: input.leadEmail,
    sendingEmail: input.sendingEmail,
    companyName: company,
    client: input.replyCopy,
  });

  // Caleb, 2026-10-09, on Infinity's card: "The visual heirarchy here is
  // cooked." The task was the same weight as the reply, the signature filled
  // the middle, and the draft, which wasn't even the next step, was the
  // biggest thing on the card. Now: the task in bold with the @, what they
  // said in their own words, the buttons, and the draft. When the task isn't
  // an email (get the deck, fill a form), the draft drops to small grey text
  // under the buttons as an optional holding reply.
  const offEmail = intent.kind === 'deck' || intent.kind === 'form';
  const firstName = (input.leadName || '').split(' ')[0] || 'They';
  // Slack rejects the whole message when one section passes 3000 chars, so
  // a long form URL must never cost Jonah the card.
  // A company Jonah handles from his own inbox: say the reply is already there.
  const copied = input.copiedTo
    ? `*${esc(firstName)}'s reply is in your inbox at ${esc(input.copiedTo)}.* ${esc(intent.nextStep)}`
    : `*${esc(intent.nextStep)}*`;
  const task = clip(`${input.mention ? `<@${input.mention}>  ` : ''}${copied}`, 2900);
  const said = `*${esc(firstName)} wrote*\n${quote(esc(readableReply(input.replyText, 400)))}`;
  const draft = clip(input.draftBody, 1500);

  return [
    { type: 'header', text: { type: 'plain_text', text: clip(title, 150), emoji: true } },
    ...(person ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: person }] }] : []),
    { type: 'section', text: { type: 'mrkdwn', text: task } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: said } },
    ...(offEmail
      ? []
      : [{ type: 'section', text: { type: 'mrkdwn', text: `*Reply we'd send*\n${quote(esc(draft))}` } }]),
    { type: 'actions', elements: fitButtons(input.value, intent.kind, input.primaryLabel) },
    ...(intent.kind === 'form'
      ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: clip(`Holding reply, if you want one: ${esc(draft.replace(/\s*\n+\s*/g, ' '))}`, 2900) }] }]
      : []),
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${esc(intent.label)}  ·  ${meta}` }] },
  ];
}
