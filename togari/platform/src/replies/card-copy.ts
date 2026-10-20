/**
 * Card copy written per reply: the primary button label on a reply card, and
 * the one line Togari posts when it handled a good reply on its own.
 *
 * Caleb, 2026-10-09: "Send the deck (click to upload) makes it more clear",
 * and "the positive things happening that togari handled on its own should
 * still show up there". A fixed label can't say whether the deck is already on
 * file or which company it is; a model can, from the facts.
 *
 * The model only words what the code already decided. Every output is
 * validated (length, no em dash, no emoji, no invented numbers), and anything
 * that fails, times out or errors falls back to a fixed template, so a card is
 * never late or wrong because of this.
 */

const MODEL = process.env.CARD_COPY_MODEL || "claude-haiku-4-5";
// A card waits on this before it posts. 2.5s was the slowest acceptable wait
// for a card that already took seconds to draft; guessed, not measured.
const TIMEOUT_MS = 2500;

async function ask(
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  // Other suites assert Togari never calls Claude for drafts; card copy stays
  // out of their way unless a test opts in.
  if (process.env.VITEST && !process.env.CARD_COPY_LIVE) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const text = data?.content?.[0]?.text;
    return typeof text === "string" ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** True when a model line is safe to show a client. */
export function cleanLine(
  text: string | null,
  maxChars: number,
  allowedNumbers: string[] = [],
): string | null {
  if (!text) return null;
  const s = text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length > maxChars) return null;
  if (/[—–]/.test(s) || EMOJI.test(s)) return null;
  // No number the facts didn't contain: the model words things, it never counts.
  const nums = (s.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[.,]+$/, ""));
  if (nums.some((n) => !allowedNumbers.some((a) => a.includes(n)))) return null;
  return s;
}

/** Fallback deck label: says which company and whether an upload is needed. */
export function deckLabelFallback(company: string, onFile: boolean): string {
  const name = company.length > 24 ? "the" : `the ${company}`;
  return onFile ? `Send ${name} deck` : `Paste link and send ${name} deck`;
}

/**
 * Primary button label for a deck-request card. Slack buttons cap at 75
 * chars; this keeps it under 40 so it fits on a phone.
 */
export async function deckButtonLabel(
  company: string,
  onFile: boolean,
): Promise<string> {
  const fallback = deckLabelFallback(company, onFile);
  const out = await ask(
    "You write the label for one button in Slack. 2 to 7 words, starts with a verb, must contain the word send (and link when no deck is saved), plain words, no punctuation at the end, no quotes, no emoji. Return only the label.",
    `The investor asked for the ${company} deck. ${
      onFile
        ? "The deck is already saved, so one press sends it."
        : "No deck is saved yet, so pressing it asks the user to paste the deck link, then sends it."
    } Write the label.`,
    20,
  );
  const line = cleanLine(out, 40);
  if (!line || !/^[A-Z]/.test(line)) return fallback;
  if (!/send/i.test(line)) return fallback;
  // "Upload and send deck to investor" came back for Qube on 2026-10-09: say which deck.
  if (!line.toLowerCase().includes(company.split(/\s+/)[0].toLowerCase())) return fallback;
  if (!onFile && !/link/i.test(line)) return fallback;
  return line;
}

export type Win = {
  kind: "new_address" | "referral" | "later";
  leadName: string | null;
  company: string;
  replyText: string;
  /** For forwards: who it went to. */
  forwardedTo?: string[];
  /** For a later: when the follow-up goes out. */
  followUpOn?: Date;
};

function day(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

export function winFallback(w: Win): string {
  const who = w.leadName || "An investor";
  if (w.kind === "later" && w.followUpOn) {
    return `${who} is open to it after being away. Togari follows up on ${day(w.followUpOn)}.`;
  }
  const to = (w.forwardedTo || []).join(", ");
  return w.kind === "referral"
    ? `${who} pointed us to ${to || "a colleague"} for ${w.company}. Togari sent it their way.`
    : `${who} moved to ${to || "a new address"}. Togari sent ${w.company} there.`;
}

/** One line for the channel when Togari handled a good reply on its own. */
export async function winLine(w: Win): Promise<string> {
  const fallback = winFallback(w);
  const facts = [
    `Investor: ${w.leadName || "unknown"}`,
    `Company we pitched: ${w.company}`,
    `What they wrote: ${w.replyText.slice(0, 600)}`,
    w.kind === "later" && w.followUpOn
      ? `Togari scheduled a follow up for ${day(w.followUpOn)}`
      : "",
    w.forwardedTo?.length
      ? `Togari forwarded it to ${w.forwardedTo.join(", ")}`
      : "",
  ].filter(Boolean);
  const allowed = facts.join(" ");
  const out = await ask(
    "You write one line for a client's Slack channel saying what happened with an investor reply and what Togari already did about it. One or two short sentences, under 200 characters, confident, plain words, full words, no em dashes, no emoji, no exclamation marks, no numbers that are not in the facts, never say the investor is interested unless they said so, and never say the investor is from the company we pitched: they work at a different firm. Return only the line.",
    facts.join("\n"),
    80,
  );
  const line = cleanLine(out, 200, [allowed]);
  return line || fallback;
}

/**
 * An automatic out-of-office notice, not a person. Those get a quiet
 * follow-up and no win line: "out until Oct 12" is not good news.
 */
export function isAutoReply(text: string): boolean {
  return /(out of (the )?office|automatic reply|auto-?reply|autoreply|currently out|limited access to (my )?e-?mail|on (annual |parental )?leave|away from (my desk|the office)|will (respond|reply|get back to you) (when|upon|after) (i|my) return)/i.test(text);
}
