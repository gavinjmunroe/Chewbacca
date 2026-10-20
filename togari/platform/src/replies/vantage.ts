/**
 * Vantage: Zeutara's own system of record for decks, calendars and who has
 * already been answered. Togari asks it before answering an investor and tells
 * it what went out after.
 *
 * Ryan Korn, 2026-10-13: Togari had sent dead deck links to four investors
 * (Eric Chin at Crosslink, Joseph Akpan at Nok among them). Every /d/<token>
 * link 404ed because Slack answered files.info with file_not_found. His ask:
 * "Before replying, POST {email} to .../togari/context. That gives you the deck
 * link, times to offer and the words to never use. Only use that link and
 * those times, if there's no link just say the deck's coming. After sending,
 * POST to_email, from_email, subject, text and sent_at to .../togari/sent."
 *
 * Auth is the same x-creature-token the Vantage webhook account in Clay uses,
 * read from VANTAGE_CREATURE_TOKEN. With no token set Vantage is off and
 * nothing changes. The context response shape was never documented to us, so
 * the parser accepts the existing key spellings but refuses unrecognized or
 * malformed responses. An unknown schema cannot establish that no deck exists.
 */

const BASE = (
  process.env.VANTAGE_BASE_URL || "https://vantage.zeutara.com"
).replace(/\/+$/, "");
const PATH = "/api/webhooks/clay-creature/togari";
// Vantage sits in the send path. A slow answer holds the reply webhook open,
// so after this long the reply goes to a card instead (guessed, never measured).
const TIMEOUT_MS = 8000;

export interface VantageContext {
  deckUrl: string | null;
  times: string[];
  neverUse: string[];
  policy?: {
    hasDeck: boolean;
    hasOnePager: boolean;
    materialDelivery: "vantage_attachments";
    timesSuit: "reply owner only";
    bookingUrl: string | null;
    verdict: "NOT_A_FIT" | "QUALIFIED" | null;
    answered: { at: string; from: string } | null;
    neverNameClient: true;
  };
}

// These are the four instructions observed in Vantage's 2026-10-16 live
// response. A new instruction needs an implementation before any send.
const OBSERVED_RULES = [
  "Never name the client, its website or its people. Describe it by stage and sector.",
  "Never send a link to a deck, one-pager or any file. Files go to investors as attachments, sent from Vantage. If they ask for material, say Jonah will send it over shortly, and leave the reply for Vantage.",
  "Offer only the times listed, or the booking link. Never invent a time.",
  "If verdict is NOT_A_FIT, do not offer a meeting.",
];

// Vantage's 2026-10-17 live response for an investor at stage TO_BOOK, who
// had asked for the deck and been answered, carried verdict "QUALIFIED". Its
// rules name only NOT_A_FIT as restricting meetings, so QUALIFIED is treated
// exactly like null: meetings may be offered, still only at the listed times
// or booking link and still owned by the reply owner. Any other value refuses.
type VantageVerdict = "NOT_A_FIT" | "QUALIFIED" | null;
const KNOWN_VERDICTS: VantageVerdict[] = [null, "NOT_A_FIT", "QUALIFIED"];

function liveContext(data: Record<string, unknown>): VantageContext {
  const stringArray = (value: unknown): string[] => {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || !item.trim())
    )
      throw new Error("Vantage policy requires explicit string lists");
    return value.map((item: string) => item.trim());
  };
  const rules = stringArray(data.rules);
  if (
    rules.length !== OBSERVED_RULES.length ||
    !OBSERVED_RULES.every((rule) => rules.includes(rule))
  )
    throw new Error("Vantage has unsupported or incomplete sending rules");
  if (
    typeof data.hasDeck !== "boolean" ||
    typeof data.hasOnePager !== "boolean" ||
    data.timesSuit !== "reply owner only" ||
    !KNOWN_VERDICTS.includes(data.verdict as VantageVerdict)
  )
    throw new Error(
      "Vantage has unsupported material, meeting-owner or verdict semantics",
    );
  const bookingUrl = data.bookingUrl;
  if (
    bookingUrl !== null &&
    (typeof bookingUrl !== "string" || !/^https:\/\/\S+$/.test(bookingUrl))
  )
    throw new Error("Vantage has an invalid booking URL");
  let answered: { at: string; from: string } | null = null;
  if (data.answered !== null) {
    const value = data.answered;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Vantage has malformed answered metadata");
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.at !== "string" ||
      !Number.isFinite(Date.parse(entry.at)) ||
      typeof entry.from !== "string" ||
      !entry.from.trim()
    )
      throw new Error("Vantage has malformed answered metadata");
    answered = { at: entry.at, from: entry.from };
  }
  return {
    deckUrl: null,
    times: stringArray(data.times),
    neverUse: stringArray(data.neverMention),
    policy: {
      hasDeck: data.hasDeck,
      hasOnePager: data.hasOnePager,
      materialDelivery: "vantage_attachments",
      timesSuit: data.timesSuit,
      bookingUrl,
      verdict: data.verdict as VantageVerdict,
      answered,
      neverNameClient: true,
    },
  };
}

export function vantageEnabled(clientId: string): boolean {
  return clientId === "zeutara" && !!process.env.VANTAGE_CREATURE_TOKEN?.trim();
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys)
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function strings(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object"
            ? pick(x as Record<string, unknown>, [
                "label",
                "text",
                "time",
                "start",
              ])
            : undefined,
      )
      .map((s) => {
        if (typeof s !== "string")
          throw new Error("Vantage context has a malformed list item");
        return s.trim();
      })
      .filter(Boolean);
  }
  if (typeof v === "string" && v.trim())
    return v
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (v === "") return [];
  throw new Error("Vantage context has a malformed list field");
}

export function parseVantageContext(raw: unknown): VantageContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Vantage context is not an object");
  const top = raw as Record<string, unknown>;
  if (
    "data" in top &&
    (!top.data || typeof top.data !== "object" || Array.isArray(top.data))
  )
    throw new Error("Vantage context has a malformed data envelope");
  const data =
    top.data && typeof top.data === "object"
      ? (top.data as Record<string, unknown>)
      : top;
  if (
    "rules" in data ||
    "hasDeck" in data ||
    "neverMention" in data ||
    "timesSuit" in data
  ) {
    if (data.found !== true)
      throw new Error("Vantage policy must identify an explicit found record");
    return liveContext(data);
  }
  const deckKeys = ["deck_url", "deckUrl", "deck_link", "deckLink", "deck"];
  const timeKeys = [
    "times",
    "times_to_offer",
    "timesToOffer",
    "offer_times",
    "slots",
    "availability",
  ];
  const bannedKeys = [
    "never_use",
    "neverUse",
    "words_to_never_use",
    "banned_words",
    "banned",
    "do_not_say",
    "avoid",
  ];
  // The live service also answers {found:false,note:...} for an investor
  // absent from its records. This is explicit absence, not a guessed schema.
  if (
    data.found === false &&
    ![...deckKeys, ...timeKeys, ...bannedKeys].some((key) => key in data)
  )
    return { deckUrl: null, times: [], neverUse: [] };
  // The live 2026-10-15 probe returned an empty parsed result, but the old
  // parser produced that for every unknown schema too. Refuse that ambiguity.
  if (![...deckKeys, ...timeKeys, ...bannedKeys].some((key) => key in data))
    throw new Error(
      "Vantage context schema is unrecognized; empty context is unverified. Fields: " +
        Object.entries(data)
          .slice(0, 20)
          .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key))
          .map(
            ([key, value]) =>
              `${key}:${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`,
          )
          .join(", "),
    );
  if (
    ![deckKeys, timeKeys, bannedKeys].every((keys) =>
      keys.some((key) => key in data),
    )
  )
    throw new Error(
      "Vantage context is missing deck, availability or wording constraints",
    );
  const deck = pick(data, deckKeys);
  const deckStr =
    typeof deck === "string"
      ? deck
      : deck && typeof deck === "object"
        ? pick(deck as Record<string, unknown>, ["url", "link"])
        : "";
  if (
    deck !== undefined &&
    (typeof deckStr !== "string" ||
      (deckStr.trim() !== "" && !/^https?:\/\/\S+$/i.test(deckStr.trim())) ||
      (typeof deck !== "string" && !deckStr.trim()))
  )
    throw new Error("Vantage context has a malformed deck URL");
  return {
    deckUrl:
      typeof deckStr === "string" && deckStr.trim() ? deckStr.trim() : null,
    times: strings(pick(data, timeKeys)),
    neverUse: strings(pick(data, bannedKeys)),
  };
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${PATH}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-creature-token": process.env.VANTAGE_CREATURE_TOKEN?.trim() || "",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Throws when Vantage can't be read: the caller must not send blind. */
export async function vantageContext(email: string): Promise<VantageContext> {
  const res = await post("context", { email });
  if (!res.ok) throw new Error(`Vantage context answered ${res.status}`);
  return parseVantageContext(await res.json());
}

export interface VantageSent {
  to_email: string;
  from_email: string;
  subject: string;
  text: string;
  sent_at: string;
}

export async function vantageLogSent(msg: VantageSent): Promise<void> {
  const res = await post("sent", msg);
  if (!res.ok) throw new Error(`Vantage sent-log answered ${res.status}`);
}

const URL_RE = /https?:\/\/[^\s<>)"']+/gi;
const TIME_RE =
  /\b(?:\d{1,2}(?::\d{2})?\s?(?:am|pm)|(?:[01]?\d|2[0-3]):[0-5]\d)(?:\s*(?:[EP][SD]?T|UTC|GMT))?\b/gi;
const DAY_RE =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b/gi;

function availabilityText(draft: string): string {
  // Exempt only the date directly attached to an explicit factual predicate.
  // Mentioning a round while proposing a meeting previously hid the whole clause.
  const date = DATE_RE.source;
  const day = DAY_RE.source;
  const factualDate = new RegExp(
    `\\b(?:(?:the\\s+)?round\\s+closes?|(?:we\\s+)?(?:launched|incorporated|were\\s+founded)|as\\s+of)\\s+(?:on\\s+)?(?:${day}\\s+)?(?:${date})`,
    "gi",
  );
  return draft.replace(factualDate, "");
}

/**
 * Why a draft can't go out under what Vantage said, or null. A banned word,
 * a link that isn't the Vantage deck, or a time Vantage didn't offer all send
 * the reply to a person instead.
 */
export function vantageDisclosureProblem(
  draft: string,
  ctx: VantageContext,
): string | null {
  const lower = draft.toLowerCase();
  const banned = ctx.neverUse.find((w) => w && lower.includes(w.toLowerCase()));
  if (banned)
    return `the draft uses "${banned}", which Vantage says never to say`;
  if (ctx.policy) {
    if (/\b(?:attached|attachment|enclosed)\b/i.test(draft))
      return "Vantage must send materials as attachments; Togari cannot claim an attachment";
  }
  const strayLink = (draft.match(URL_RE) || []).find(
    (u) =>
      u.replace(/[.,]+$/, "") !==
      (ctx.policy ? ctx.policy.bookingUrl : ctx.deckUrl),
  );
  if (strayLink) return "the draft has a link Vantage didn't give us";
  return null;
}

export function vantageProblem(
  draft: string,
  ctx: VantageContext,
): string | null {
  const disclosure = vantageDisclosureProblem(draft, ctx);
  if (disclosure) return disclosure;
  if (ctx.policy) {
    if (
      /(?:\b(?:send|share|forward|provide|sent|shared)\b|\bhere(?:'s| is| are)\b)[^.!?\n]{0,60}\b(?:it|them|one[- ]?pager|deck|memo|files?|materials?|teaser|presentation)\b/i.test(
        draft,
      ) ||
      /\b(?:one[- ]?pager|deck|memo|files?|materials?|teaser|presentation)\b[^.!?\n]{0,40}\b(?:coming|sent|on (?:its|their) way)\b/i.test(
        draft,
      )
    )
      return "Material fulfillment belongs to Vantage; keep the request open instead of sending an acknowledgment";
    const meeting =
      /\b(?:call|meet(?:ing)?|book(?:ing)?|schedule|chat|talk|speak|invite)\b/i.test(
        draft,
      ) ||
      [DAY_RE, DATE_RE, TIME_RE].some((pattern) =>
        availabilityText(draft).match(pattern),
      );
    if (
      ctx.policy.verdict === "NOT_A_FIT" &&
      (meeting ||
        (ctx.policy.bookingUrl !== null &&
          draft.includes(ctx.policy.bookingUrl)))
    )
      return "Vantage marked this investor NOT_A_FIT; no meeting offer is authorized";
    if (meeting && /\b(?:founder|ceo|client(?:'s)? team)\b/i.test(draft))
      return "Vantage's times belong to the reply owner, not the founder";
  }
  const normalize = (token: string) => token.toLowerCase().replace(/\s+/g, "");
  const patterns = [DAY_RE, DATE_RE, TIME_RE];
  const tokens = (text: string) =>
    patterns.flatMap((pattern, index) =>
      (text.match(pattern) || []).map(
        (token) => `${index}:${normalize(token)}`,
      ),
    );
  const offered = ctx.times.map((slot) => new Set(tokens(slot)));
  for (const sentence of availabilityText(draft).split(/[.!?;\n]+/)) {
    const clauses = sentence.split(/\bor\b/gi).map(tokens);
    // The trailing Monday in "10am or 3pm on Monday" also qualifies 10am.
    let sharedDate =
      clauses
        .find((clause) => clause.some((token) => !token.startsWith("2:")))
        ?.filter((token) => !token.startsWith("2:")) ?? [];
    for (const explicit of clauses) {
      const date = explicit.filter((token) => !token.startsWith("2:"));
      // Monday 10am or 3pm previously borrowed Tuesday's offered 3pm slot.
      if (date.length) sharedDate = date;
      const proposed = [...sharedDate, ...explicit];
      if (
        proposed.length &&
        !offered.some((slot) => proposed.every((token) => slot.has(token)))
      )
        return "the draft combines a day, date or time that Vantage didn't offer together";
    }
  }
  return null;
}

/** The deck reply when Vantage has no deck yet: no link, just that it's coming. */
export function deckComingBody(
  leadName: string | null | undefined,
  company: string,
  signoff: string,
): string {
  const first = (leadName || "").trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : "Hi,";
  return `${hi}\n\nThanks for the interest in ${company}. The deck's coming, I'll send it over shortly.\n\n${signoff}`;
}
