/**
 * What an investor's reply is asking for, and the one thing to do next.
 *
 * Jonah walked every Zeutara card on a call on 2026-10-08 and named the move
 * for each kind of reply: a changed address gets the original email again, a
 * "reach out to these four people" gets the same email sent to all four, a
 * link to an intake form gets filled out under his name, a deck request gets
 * the deck, a "traveling for three weeks" gets a follow-up in three weeks, a
 * lender is dropped, and a pass is just noted as a reply. The card used to
 * show only a draft, so he had to work each of those out himself.
 *
 * Deterministic on purpose: the label sits on a card Jonah acts on, so the
 * same text has to get the same label every time, and anything unrecognised
 * falls through to "read it" rather than inventing an action.
 */

export type ReplyIntentKind =
  | "new_address"
  | "referral"
  | "form"
  | "deck"
  | "question"
  | "later"
  | "pass"
  | "interested"
  | "unsubscribe"
  | "ignore"
  | "unclear";

/**
 * Kinds that never need Jonah: zeutara-gtme's autopilot resends, follows up,
 * blocklists or just logs them. Interested, questions, deck requests, forms
 * and anything unclear still reach him.
 */
export const AUTO_HANDLED = new Set<ReplyIntentKind>([
  "pass",
  "later",
  "new_address",
  "referral",
  "unsubscribe",
  "ignore",
]);

export interface ReplyIntent {
  kind: ReplyIntentKind;
  /** Delivery failures need repair ownership, never an email back to the server. */
  isDeliveryFailure?: boolean;
  /** True only when the reply describes an absence, not a funding condition. */
  isAway?: boolean;
  /** Short label for the card, e.g. "Wants the deck". */
  label: string;
  /** One sentence: what to do next. */
  nextStep: string;
  /** For new_address and referral: who the original email goes to now. */
  addresses?: string[];
}

/**
 * The client facts a next step names, read from the client's registry entry
 * (ReplybotClientConfig.replyCopy). Only the wording reads them: the kind a
 * reply gets never depends on the client, so a client without them is sorted
 * exactly like Zeutara and just sees no one's name.
 */
export interface ReplyCopy {
  /** First name the client's outreach goes out under, e.g. "Jonah". */
  principal: string;
  /** The client's own name, e.g. "Zeutara". */
  clientName: string;
  /** False means a lender reply is noted as "<client> isn't raising debt". */
  raisesDebt?: boolean;
  /** Who the call is with, e.g. "the founder". */
  callWith?: string;
}

const MAX_INPUT = 6000;
const FREE_MAIL =
  /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|aol|proton|protonmail)\./i;
const MAX_LISTED = 6;
// Bounded on both sides of the @: the unbounded form backtracks
// quadratically on a long run of "a.a.a." (1.6s on 6000 chars, measured
// 2026-10-09), which a reply can be made to contain.
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}/gi;
const URL = /https?:\/\/[^\s<>()\]"']+/gi;

function emailsIn(text: string, exclude: string[]): string[] {
  const skip = new Set(exclude.filter(Boolean).map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  for (const m of text.match(EMAIL) ?? []) {
    const e = m.toLowerCase().replace(/[.,;]+$/, "");
    if (!skip.has(e)) seen.add(e);
  }
  return [...seen];
}

function urlsIn(text: string): string[] {
  return [
    ...new Set((text.match(URL) ?? []).map((u) => u.replace(/[.,;]+$/, ""))),
  ];
}

function domainOf(email: string): string {
  return (email.split("@")[1] || "").toLowerCase();
}

/**
 * The reply without the quoted thread under it, so our own outbound (which
 * mentions decks, raises and links) can't decide the label.
 */
export function ownWords(text: string): string {
  // Outlook and Gmail wrap "On <date>, <name> <address> wrote:" across lines
  // (Perceptive Ventures, 2026-10-08), so the match spans newlines.
  const cut = text.search(
    /\n\s*(On [\s\S]{4,200}?\bwrote:|-{2,}\s*Original Message|From: .+\n)/i,
  );
  const body = cut > 0 ? text.slice(0, cut) : text;
  const lines = body
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"));
  // Stop at the sign-off or legal footer. A Zurich law firm's "No, txs" read
  // as a referral on 2026-10-09 because its disclaimer says "please contact
  // us immediately".
  const end = lines.findIndex((l, i) => i > 0 && SIGN_OFF.test(l.trim()));
  // Joined on spaces so a phrase the mail client wrapped ("nicht / mehr
  // aktiv") still matches.
  return (end > 0 ? lines.slice(0, end) : lines).join(" ").replace(/\s+/g, " ");
}

const SIGN_OFF =
  /^(--\s*$|(kind |best |warm )?regards|best,?$|cheers|sincerely|mit freundlichen|freundliche gr|cordialement|this e-?mail (has been|and any|is (intended|confidential|for the)|may)|confidential|disclaimer|sent (from|via) )/i;

// "Please take us off your distribution list" read as unclear on 2026-10-11.
const UNSUBSCRIBE =
  /\b(unsubscribe|remove (me|us)|take (me|us) off|stop emailing|do not contact|don'?t contact|off (your|the) (distribution|mailing|e-?mail) list)\b/i;
// A removal ask that names someone else: "Remove Daniel" was a partner's
// whole reply on 2026-10-10 and came out unclear. Only a reply that OPENS with
// remove, or asks to remove someone from a list, counts, so "we'll remove the
// cap next round" is still read for what it is.
const REMOVE_ASK =
  /^\s*(please\s+)?remove\b(?![^.!?\n]*\?)|\bremove\s+(him|her|them|us|this (person|contact|address))\b|\bremove\s+[^.!?\n]{1,60}\bfrom (your|the|this) (list|database|mailing|distribution|outreach)/i;
// Mail we must not answer: spam-filter challenges, and a firm's notice that
// its partner died (Cervin Ventures, 2026-10-06). Redirecting a pitch off a
// death notice is not something to automate.
const IGNORE =
  /(verify that the message you sent is not unsolicited|this email is to verify|passing of|passed away|in memoriam)/i;
// A mail server saying the email never arrived. On Zeutara's 65 real replies
// both bounces ("Address not found", "Message blocked") fell through to
// "unclear" and would have reached Jonah as work, with nobody to answer
// (Chewbacca's gtme-reply parity run, 2026-10-10). Server wording only.
const BOUNCE =
  /(address not found|wasn'?t delivered|message (was )?blocked|undeliverable|delivery (status notification|has failed|failure)|mail delivery (subsystem|failed)|could not be delivered|recipient address rejected|mailbox (unavailable|not found|full))/i;
const NEW_ADDRESS =
  /(new|updated|different) (e-?mail|address)|send all correspondence|my new e-?mail|address future (communication|correspondence|emails?)|will soon cease to function|completed the transition to/i;
// Auto-replies: English, plus the French and German ones Qube's Swiss and
// Belgian investors sent on 2026-10-06.
const OUT_OF_OFFICE =
  /(out of (the )?office|traveling|travelling|on (leave|vacation|holiday)|limited access to e-?mail|checking e-?mails? infrequently|je suis absent|abwesend|nicht im haus|wieder im b(ü|u)ro|automatic reply|auto-?reply|out today|slow to respond|this is an automated (message|response|reply))/i;
const LENDER =
  /\b(lender|lending|debt financing|venture debt|credit facility)\b/i;
// \s+ because a German auto-reply broke "nicht mehr aktiv" across a line.
const MOVED_ON =
  /(i'?ve left|i have left|no longer\s+(with|at|monitor|active)|nicht\s+mehr\s+aktiv|has retired from|please contact|please direct all|please email|reach out to office|has (now )?taken over|is (now )?the best person|best person to (reach|contact)|reach out to (him|her|them|anyone)|feel free to reach out to|is more on the|\(cc'?d\)|cc'?ing|looping in)/i;
const FORM =
  /(intake form|founder form|application|apply (directly )?(through|via|on|at)|submit (your|the|a|it|their)|fill (out|in)|our website|investment criteria|typeform|airtable|vettable|portal|form (at|here|below|link))/i;
// "More information" alone is a signature line ("for more information please
// visit mimecast.com" read as a deck request on 2026-10-09), so it needs a
// verb asking for it.
const DECK =
  /\bdeck\b|(send|share) (me |us )?(over )?(the |a |your |some )?(one[- ]?pager|more (info|information|details)|materials|numbers)/i;
const MATERIAL_REQUEST =
  /(?:\b(?:send|share|provide|forward|attach)\b|\b(?:could|can|may|would)\s+(?:i|we)\s+(?:please\s+)?(?:see|review|receive|access|have|get)\b|\b(?:i|we)(?:'d| would)\s+(?:like|love)\s+to\s+(?:see|review|receive|access|have|get)\b)[^.!?\n]{0,60}\b(?:one[- ]?pager|deck|memo|files?|materials?|teaser|presentation)\b/i;

export function isMaterialRequest(text: string): boolean {
  return DECK.test(text) || MATERIAL_REQUEST.test(text);
}
// "Happy to chat once they identify a lead for the round, but until then, I
// have to pass" was carded to the client as a reply waiting on them (2026-10-11).
const LATER =
  /(back (on|in|after)|in (\d+|a few|two|three|four) weeks|circle back|reach out when|once (they|you|the company) (identify|have|find|land|secure) a lead|until then|after the holidays|next quarter|ball (is )?in my court)/i;
// A bare "no" with no punctuation, "no interest", "a conflict of interest since
// we have our own" and "I have to pass" all came out unclear on 2026-10-11.
const PASS =
  /(^\s*no\b(\s*[.!]?\s*$|[,.!]?\s*(thanks?|thank you|txs|thx)\b)|\bno interest\b|conflict of interest|\b(i|we) (have to|must|need to) pass\b|(doesn'?t|isn'?t|not)\b[^.]{0,20}\bfit\b|retired from (making )?(new )?invest|retired from investing|^\s*no thank|no thank you|not (an )?area of (focus|interest)|pass on|outside (of )?our (investment\s*)?(scope|focus|thesis|mandate)|don'?t do (consumer|b2c|crypto|hardware|pre-?seed|seed|safes)|bow out|is tough for us|going to pass|will pass|not for us|not a fit|no(t)? (a )?fit for us|we('ll| will)? pass|passing on|not for us|don'?t do safes|do not do safes|we don'?t invest|not investing|outside (of )?our (focus|thesis|mandate)|only (consider|back|invest)|not (the )?right time|don'?t think a call makes sense|^\s*no\b(?=[\s,.!]*(get outlook|sent from|([A-Z][a-z]+\s+){1,3}\d|$))|no longer (making|doing|writing) (new )?(investments|checks|deals)|(we|i) do not invest|will never (talk|work) (to|with) anyone|out of (our )?thesis|^\s*np interest\b|falls outside the (sectors|areas|scope)|partners\b[^.]{0,15}\b(have|has) (all )?retired|(i|we) (have|has) retired from|(i'?m|i am) not active (with|at)|(probably |a bit )?too (soon|early) for us)/i;
// Passes that can carry a condition ("won't be a fit unless you have $1M ARR.
// What is your revenue?"), so they're read only after questions and interest.
const SOFT_PASS = /(won'?t be a (good )?fit|no longer invest)/i;
// The 2026-10-14 and 2026-10-16 additions above came from Chewbacca's
// gtme_reply.py, where they had drifted ahead of this file. Both now pin
// __tests__/reply-kind-cases.json so the two can't drift apart again. Review
// of the port (2026-10-16) caught an opening "No need to apologize. What are
// you raising?" reading as a pass, so a leading no counts only on its own line.
const QUESTION_TOPIC =
  /(revenue|arr\b|traction|valuation|raising|round|terms|cap table|burn|runway|users|customers|ltm|ntm|how much|metrics|what('?s| is) the (company|startup|business)|which company|company name)/i;
const INTERESTED =
  /(interested|happy to (chat|take a look|connect|meet)|let'?s (set up|schedule|find)|would love|open to (a )?(call|chat)|send me (a )?time|calendly)/i;

export function replyIntent(
  replyText: string,
  opts: {
    leadEmail?: string;
    sendingEmail?: string;
    companyName?: string | null;
    client?: ReplyCopy | null;
  } = {},
): ReplyIntent {
  // Bounded before any regex runs: the email and URL patterns backtrack
  // polynomially on long runs without a match, and a reply's own words are
  // never this long. Only the quoted thread and footers are.
  const text = ownWords((replyText || "").slice(0, MAX_INPUT));
  const leadEmail = (opts.leadEmail || "").toLowerCase();
  const company = opts.companyName || "the company";
  const copy = opts.client || null;
  const asPrincipal = copy?.principal ? ` as ${copy.principal}` : "";
  const call = copy?.callWith ? `a call with ${copy.callWith}` : "a call";
  const others = emailsIn(text, [leadEmail, opts.sendingEmail || ""]);
  const links = urlsIn(text);

  // An opt-out wins over every other reading: a person writing "remove me,
  // my mailbox is full of this" must be blocklisted, not filed as a bounce.
  if (UNSUBSCRIBE.test(text) || REMOVE_ASK.test(text)) {
    return {
      kind: "unsubscribe",
      label: "Asked to unsubscribe",
      nextStep: "Blocklisted. Never email them again.",
    };
  }

  if (BOUNCE.test(text)) {
    return {
      kind: "ignore",
      isDeliveryFailure: true,
      label: "Didn't deliver",
      nextStep:
        "Repair the failed delivery and confirm the intended recipient received it.",
    };
  }

  if (IGNORE.test(text)) {
    return {
      kind: "ignore",
      label: "No action",
      nextStep: "Leave it. Nothing to send.",
    };
  }

  if (NEW_ADDRESS.test(text)) {
    return {
      kind: "new_address",
      label: "New email address",
      addresses: others.slice(0, 1),
      nextStep: others[0]
        ? `Resend the original email to ${others[0]}.`
        : "Resend the original email to the new address in their reply.",
    };
  }

  // An eligibility questionnaire can describe investments they only consider;
  // that restriction is not a rejection of this deal (Correlation, 2026-10-15).
  if (
    /\b(?:eligib\w*|criteria|qualif\w*|institutional VC)\b/i.test(text) &&
    /\b(?:answer|respond to)\b[^.!?]{0,120}\b(?:questions|yes)\b/i.test(text)
  ) {
    return {
      kind: "form",
      label: "Eligibility questions",
      nextStep:
        "Confirm eligibility from verified company facts, then answer their questions.",
    };
  }

  if (LENDER.test(text)) {
    return {
      kind: "pass",
      label: "Lender, not an equity investor",
      nextStep:
        copy?.raisesDebt === false
          ? `No reply needed. ${copy.clientName} isn't raising debt, so it's logged as replied.`
          : "No reply needed. They're a lender, so it's logged as replied.",
    };
  }

  if (OUT_OF_OFFICE.test(text)) {
    // A person, not an autoresponder, saying when to come back: Clive at
    // NABU, "traveling internationally for next 3 weeks. Ball in my court."
    const weeks = text.toLowerCase().match(/(\d+|two|three|four) weeks/);
    if (weeks) {
      return {
        kind: "later",
        isAway: true,
        label: "Come back later",
        nextStep: `Follow up in ${weeks[1]} weeks, like they asked.`,
      };
    }
    const back = text.match(
      /(until|du|bis|through|thru|back on|return(ing)? on)\s+([^.\n]{3,40})/i,
    );
    return {
      kind: "later",
      isAway: true,
      label: "Out of office",
      nextStep: back
        ? `Auto-reply. Follow up once they're back (${back[3].trim()}).`
        : "Auto-reply. Follow up once they're back.",
    };
  }

  if (MOVED_ON.test(text)) {
    // A personal address in a "left the firm" note is for personal matters
    // (Claridge and TomorrowVentures, 2026-10-08), never for the pitch.
    const firm = others.filter((e) => !FREE_MAIL.test(domainOf(e)));
    return {
      kind: "referral",
      label: "Pointed us to someone else",
      addresses: firm.slice(0, MAX_LISTED),
      nextStep: firm.length
        ? `Send the same email to ${firm.slice(0, MAX_LISTED).join(", ")}${firm.length > MAX_LISTED ? ` and ${firm.length - MAX_LISTED} more` : ""} and mention who pointed us to them.`
        : "Send the same email to the person they named and mention who pointed us to them.",
    };
  }

  if (FORM.test(text)) {
    // A bare link to their own homepage is usually the signature; prefer one
    // that looks like a form.
    const formLink =
      links.find((u) =>
        /form|apply|submit|intake|typeform|airtable|criteria|vettable/i.test(u),
      ) ||
      links.find(
        (u) => !leadEmail || !u.toLowerCase().includes(domainOf(leadEmail)),
      ) ||
      links[0];
    return {
      kind: "form",
      label: "Wants a form filled out",
      nextStep: formLink
        ? `Fill out their form${asPrincipal} with ${company}'s details: ${formLink}`
        : `Fill out the form on their website${asPrincipal} with ${company}'s details.`,
    };
  }

  if (isMaterialRequest(text)) {
    return {
      kind: "deck",
      label: "Wants the deck",
      nextStep: `Send the ${company} deck, then offer ${call}.`,
    };
  }

  if (LATER.test(text)) {
    const weeks = text.toLowerCase().match(/(\d+|two|three|four) weeks/);
    return {
      kind: "later",
      label: "Come back later",
      nextStep: weeks
        ? `Follow up in ${weeks[1]} weeks, like they asked.`
        : "Follow up when they said they'd be back.",
    };
  }

  if (PASS.test(text)) {
    return {
      kind: "pass",
      label: "Passed",
      nextStep: "No reply needed. Logged as replied.",
    };
  }

  if (text.includes("?") && QUESTION_TOPIC.test(text)) {
    return {
      kind: "question",
      label: "Asked a question",
      nextStep: copy?.principal
        ? `Answer it in ${copy.principal}'s words, then offer ${call}.`
        : `Answer it, then offer ${call}.`,
    };
  }

  if (INTERESTED.test(text)) {
    return {
      kind: "interested",
      label: "Interested",
      nextStep: copy?.callWith
        ? `Book the call with ${copy.callWith}.`
        : "Book the call.",
    };
  }

  if (SOFT_PASS.test(text)) {
    return {
      kind: "pass",
      label: "Passed",
      nextStep: "No reply needed. Logged as replied.",
    };
  }

  return {
    kind: "unclear",
    label: "Needs a read",
    nextStep: "Read their reply and decide.",
  };
}
