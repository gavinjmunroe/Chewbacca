/**
 * WHAT THIS QUESTION IS ASKING FOR, WORKED OUT IN CODE, IN UNDER A MILLISECOND.
 *
 * "Recommend coffee shops in the East Village, tell me who I know nearby, and
 *  find me VPs of engineering to talk to about hardware"
 *
 * is three questions with three different sources, and until now it was handled
 * as one: a single model call classified the whole sentence into ONE intent, and
 * whichever reading won, the other two parts were answered by a model with no
 * data behind them. The router's own instructions say to prefer the web reading
 * when a message could be read either way -- so the "who do I know" part of that
 * sentence was routinely dropped.
 *
 * WHY THIS IS NOT A MODEL CALL. Two reasons, and the second is the important one.
 *
 *   1. Latency. A classifier hop is 400ms-8s of the wait it would be helping to
 *      explain, spent before any of the actual work starts.
 *   2. It does not need to be. Deciding WHOSE people a clause is about is a
 *      first-person-pronoun test. "who I know" is the user's address book;
 *      "VPs of engineering" with no possessive is the open web. That is a regex,
 *      it is deterministic, it is auditable, and it cannot answer differently
 *      twice for the same sentence.
 *
 * WHAT IT PRODUCES. The message split into asks, each ask assigned to exactly
 * one lane, and the lanes ordered by how fast they actually are (see
 * lane-speed.js -- measured, not assumed). Every lane carries the TEXT OF ITS
 * OWN ASK, which is the other half of the point:
 *
 *   "If it's categorized as web, you do not need to look into the network
 *    information for the query. If it's categorized as network, you do not
 *    need to look into the web for the query."
 *
 * So the place search is asked about coffee shops, not about coffee shops and
 * VPs of engineering; the LinkedIn pass is asked for VPs, not for coffee; and a
 * question entirely about the user's own people spends no web call at all, while
 * a question entirely about the world never loads the address book.
 *
 * PRECEDENCE INSIDE ONE ASK. An ask gets one lane, decided in this order:
 *
 *   network      a first-person marker AND a people word -- "who do I know",
 *                "my contacts in fintech", "anyone I've met at Stripe"
 *   places       wantsPlaces() -- an outing or place noun with an intent to
 *                plan or look one up. This OUTRANKS the bare word "my", because
 *                "coffee near my apartment" is a place question with a
 *                possessive in it, not a question about the user's people.
 *   web_people   looksLikePeopleSearch() with no first-person marker: a role
 *                plus an intent to list, about strangers
 *   web          a marker that the answer changes over time -- latest, current,
 *                today, prices, "best X"
 *
 * WHEN IT DEFERS TO THE ROUTER, which is most of the point of it being safe.
 * This planner replaces the classifier ONLY where it is strictly better
 * informed, and asks for the model otherwise:
 *
 *   - two or more lanes  -> decisive. One intent cannot describe three asks, so
 *                          there is nothing the router could tell us that we do
 *                          not already know better.
 *   - places only        -> decisive (chat + web). wantsPlaces() is a narrow,
 *                          well-tested predicate and the router agrees with it
 *                          by construction.
 *   - strangers only     -> decisive (chat + web).
 *   - one network ask    -> ROUTER RUNS. It also returns structured filters
 *                          ({company,title,city,q}) that drive the cheap SQL
 *                          path instead of the ranker, and those cannot be
 *                          derived here as well as it derives them. What the
 *                          planner contributes is a veto: every ask is about
 *                          the user's own people, so no web call.
 *   - a bare web hint    -> ROUTER RUNS. "is Balthazar open on Sunday" needs no
 *                          keyword to need the web, and the router's rules for
 *                          that are richer than this regex. A weak local hint
 *                          must not pre-empt them.
 *   - nothing matched    -> ROUTER RUNS. Ordinary conversation.
 *
 * The rule throughout: the planner may only take work AWAY from the classifier
 * where it knows more, never where it knows less.
 */

import { looksLikePeopleSearch, PEOPLE_ROLE_RE } from "./exa-search.js";
import { wantsPlaces } from "./place-search.js";
import { orderLanesBySpeed } from "./lane-speed.js";

export const LANE_LABELS = Object.freeze({
  people: "Your people",
  web_people: "People on the web",
  places: "Places",
  web: "The web",
});

/**
 * A first-person claim on the people being asked about.
 *
 * This is the whole distinction between "who do I know in finance" and "list
 * ten VPs of finance", and it is a pronoun. Note "who should i" and "which of
 * my" are here as phrases: they are asks about the user's own circle that do
 * not contain a bare possessive next to the people word.
 */
/**
 * ALREADY KNOWS THEM. The strong form: a possessive over people, or a claim to
 * having met them. These are unambiguous -- "my contacts", "of mine", "I
 * haven't seen", "who do I know" -- and they mean the address book.
 */
const KNOWS_THEM =
  /\b(?:my\s+(?:contacts?|friends?|network|people|colleagues?|coworkers?|classmates?|circle|book)|of\s+mine|which\s+of\s+my|any\s+of\s+my|in\s+my\s+(?:book|network|contacts?|circle)|i\s+know|i\s+knew|do\s+i\s+know|who\s+do\s+i|i've\s+met|i\s+have\s+met|i\s+met|haven'?t\s+seen|have\s+not\s+seen|not\s+seen\s+in\s+a\s+(?:while|minute)|catch\s+up|reconnect|our\s+network)\b/i;

/**
 * A FIRST PERSON WITH NO CLAIM EITHER WAY. "if I have anyone in New York", "who
 * should I talk to", "can I get an intro". On its own this says the question is
 * about the ASKER, which makes his own book the sensible reading -- but only
 * when nothing in the clause says otherwise. See STRANGERS.
 */
const FIRST_PERSON =
  /\b(?:my|mine|i\s+have|do\s+i\s+have|have\s+i|i\s+haven'?t|i\s+should|should\s+i|i\s+can|can\s+i|i\s+could|could\s+i|who\s+should\s+i|who\s+can\s+i|anyone\s+i|someone\s+i|somebody\s+i|from\s+my)\b/i;

/**
 * PEOPLE HE DOES NOT HAVE YET, said explicitly.
 *
 * This is the signal the first version of this file was missing, and getting it
 * wrong cost an entire section of an answer in both directions. His ask was:
 *
 *   "pull up a few names of people that I should try and reach out to on
 *    LinkedIn or email... and allow me to add their contact cards here"
 *
 * Every word of that is about strangers, and it also contains "I should" -- so a
 * rule that treated any first-person marker as "his own people" sent it to the
 * ranker and never searched the web at all. A rule that ignored first-person
 * markers sent the OTHER clause ("if I have anyone in New York") to the web,
 * which cannot answer it. Both readings were wrong for one of the two clauses.
 *
 * So: an explicit stranger marker wins over a weak first-person one, and loses
 * to a possessive. "Find me someone in my network who does design" is a
 * question about his network that happens to start with "find me".
 */
const STRANGERS =
  /\b(?:linkedins?|on\s+the\s+web|cold\s+(?:email|outreach|message)|reach\s+out\s+to|pull\s+up|find\s+me|look\s+up|new\s+(?:people|contacts?|prospects?|leads?)|prospects?|add\s+(?:them|their|these)|to\s+add|profiles?)\b/i;
// LinkedInS, PLURAL, AND IT COST AN ENTIRE ANSWER. The marker was `\blinkedin\b`
// and he wrote "give me their contacts like LinkedIns and stuff to add" -- the
// trailing s defeats the word boundary, so the single most explicit stranger
// signal in the sentence matched nothing. "to add" is here for the same reason:
// the pattern only knew "add them/their/these", and "stuff to add" is how the
// same intent actually gets said.
// "GIVE ME THREE NAMES" IS A COUNT, NOT A CLAIM ABOUT WHOSE PEOPLE THEY ARE.
// It was in this list for one draft, and it sent "give me 3 people who know
// private equity" to the web -- a question the address book is the better
// answer to, and one the classifier already handles well. A number is how
// people ask for a list; it says nothing about where the list comes from.

/**
 * A word that makes an ask be about PEOPLE at all.
 *
 * Required alongside any of the markers above, because "my" and "I have" are in
 * half the sentences anybody types: "coffee shops near my office" is not a
 * question about the user's contacts.
 */
const PEOPLE_WORD =
  /\b(?:who|whom|people|person|contacts?|friends?|someone|somebody|anyone|anybody|connections?|network|folks|colleagues?|classmates?|coworkers?|introductions?|intros?|names?|refer(?:rals?)?|prospects?)\b/i;
// `prospects` IS A WORD FOR PEOPLE, and it was in neither this list nor the role
// list -- so "find me some new prospects in nyc" opened none of the tests below
// and fell all the way through to null. It was added to the STRANGERS markers
// first, which did nothing at all: STRANGERS is only consulted once a word here
// has already established that the ask is about people.

/**
 * BEING TOLD, IN SO MANY WORDS, TO SEARCH.
 *
 *   "I want to find sales executives i can pitch a product to, do a web search
 *    and find five contacts in the nyc area ... and give me their contacts like
 *    LinkedIns and stuff to add"
 *
 * Amber answered that entirely from his address book and said finding new people
 * was "not something I do". Every fragment of it classified to `network` or to
 * NOTHING -- including, absurdly, the words "do a web search", which asked for no
 * people and named no place and therefore matched no lane at all. networkOnly
 * was true, the planner vetoed the web, and the clearest instruction a person
 * can give was the one signal in the sentence that counted for nothing.
 *
 * This is the STRONGEST signal in the file and the only one that is not a guess
 * about intent. Every other marker here infers what somebody probably meant;
 * this one is them saying it. It beats first person, it beats the veto, and it
 * makes an ask about people an ask about STRANGERS -- because nobody says "do a
 * web search" about the contacts already in their phone.
 */
const WEB_COMMAND =
  /\b(?:(?:do|run|perform|make)\s+(?:an?\s+)?(?:web|internet|online|google)\s+search|search\s+(?:the\s+)?(?:web|internet|online)|look\s+(?:it\s+)?up\s+online|google\s+(?:it|them|for)|on\s+the\s+internet|web\s+search|exa\s+search)\b/i;

/**
 * The answer changes with time, so it cannot come from training.
 *
 * Deliberately a WEAK signal: matching here does not skip the router, it only
 * says "if the router is not going to run, this looks like a web ask".
 */
const WEB_CURRENT =
  /\b(?:latest|current(?:ly)?|today|tonight|tomorrow|right\s+now|this\s+(?:week|month|year)|news|headlines?|prices?|cost|stock|weather|scores?|open\s+(?:now|today)|hours|recent(?:ly)?|20\d\d|best|top\s+\d*|highest[-\s]rated|who\s+is\s+the|what'?s\s+happening)\b/i;

/**
 * THEIR OWN DAY, WHICH IS NOT A QUESTION ABOUT THE WORLD.
 *
 *   "What's on my calendar?"
 *   "Calendar is something you'd manage through your phone or calendar app
 *    directly."
 *
 * Amber holds the day -- captured events, the connected calendar accounts, the
 * reminders -- and the chat turn was answering as though it did not. Two things
 * had to be true for that, and this fixes the second: nothing fetched the day,
 * and nothing here recognized the question. "What's on my calendar today" hit
 * WEB_CURRENT on the word "today" and read as a WEB ask, so the closest this
 * came to answering was offering to search the internet for the user's own
 * schedule.
 *
 * SCHEDULE WORD PLUS THEIRS. "the calendar" on its own is a noun in a hundred
 * sentences that are not about their week ("put it on the shared calendar",
 * "what year is the Mayan calendar"); "my calendar", "my week", "am I free
 * Thursday", "what do I have tomorrow" are the shapes people actually use.
 */
const DAY_WORD =
  /\b(?:calendar|schedule|agenda|itinerary|day|week|weekend|morning|afternoon|evening|tonight|tomorrow|today|meetings?|appointments?|plans?|booked|free|busy|available|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b/i;

/** The half that makes it THEIRS rather than the world's. */
const DAY_MINE =
  /\b(?:my|mine|i\s+have|do\s+i\s+have|have\s+i|am\s+i|i'?m|do\s+i|what\s+do\s+i|whats?\s+on|what'?s\s+on|when\s+am\s+i|where\s+am\s+i|for\s+me|i\s+got)\b/i;

/**
 * Shapes that ARE the question even without a possessive, because nobody says
 * them about anything else.
 */
const DAY_DIRECT =
  /\b(?:what'?s\s+(?:on|going\s+on)\s+(?:my|the)\s+(?:calendar|schedule|agenda|day|week)|what\s+does\s+(?:my|the)\s+(?:day|week|schedule|calendar)\s+look\s+like|how\s+(?:does|is)\s+my\s+(?:day|week)\s+look(?:ing)?|anything\s+on\s+(?:my|the)\s+(?:calendar|schedule|books?)|what'?s\s+(?:my|the)\s+(?:day|week)\s+look\s+like)\b/i;

/**
 * Does this ask want the user's OWN day?
 *
 * Exported so the chat route asks the question once, in the same place every
 * other lane is decided, rather than growing a second private regex.
 */
export function asksAboutTheirDay(ask) {
  const text = String(ask || "");
  if (!text.trim()) return false;
  if (DAY_DIRECT.test(text)) return true;
  return DAY_WORD.test(text) && DAY_MINE.test(text);
}

/**
 * THE FIRST QUESTIONS ANYBODY ASKS, AND THE ONES THAT WENT WORST.
 *
 *   "Tell me about my contacts."   "Tell me about my network."
 *   "What is Amber?"               "What can Amber do for me?"
 *
 * Open-ended, unfiltered, and asked in the first minute by almost everybody.
 * All four used to be answered three different ways depending on what a Haiku
 * classifier decided in the moment: sometimes an overview with real counts,
 * sometimes the relationship ranker (which has nothing to rank, and ends at
 * "Nothing in your contacts answers that yet" for a user holding a thousand
 * people), sometimes a generic paragraph about what an assistant is.
 *
 * A question this common cannot be decided by a coin toss. Recognized here, in
 * code, so the same words get the same answer every time.
 *
 * TWO FLAVORS, because they want different emphasis from the same facts:
 *   "about_amber" -- what are you, what can you do, how does this work.
 *   "about_theirs" -- tell me about my contacts / network / people / circles.
 *
 * ANCHORED TO THE END OF THE ASK, and that is the whole defense against
 * stealing a real search. "Tell me about my contacts" is orientation; "tell me
 * about my contacts at Stripe" is a question with an answer in the address book
 * and belongs to the ranker. The difference is whether anything follows the
 * noun, so the pattern requires that nothing does.
 */
const ORIENT_THEIRS =
  /^(?:so\s+|ok(?:ay)?[,\s]+|hey[,\s]+|amber[,\s]+)?(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:tell\s+me\s+about|what(?:'?s| is| do you know about| have you got on| can you tell me about)|give\s+me\s+(?:an?\s+)?(?:overview|summary|rundown|snapshot)\s+of|describe|summar(?:ize|y\s+of)|how\s+(?:big|many)\s+is)?\s*(?:my|the)\s+(?:whole\s+|entire\s+|current\s+)?(?:contacts?|network|address\s+book|book|people|circles?|connections?|relationships?)(?:\s+list)?[\s.!?]*$/i;

/**
 * The bare noun on its own, which is how people actually type it into a fresh
 * screen: "my network", "my contacts?".
 */
const ORIENT_THEIRS_BARE = /^\s*my\s+(?:contacts?|network|address\s+book|people|circles?)[\s.!?]*$/i;

/**
 * ANCHORED AT THE END TOO, and for the same reason.
 *
 * "What can you do about the fact that Neel moved to Austin and I never
 * followed up with him" opens with the exact words of the orientation question
 * and is not one: it is a real ask about a real person. Only a short, closing
 * tail is allowed after the phrase, so "what can you help me with" still lands
 * and "what can you do about..." does not.
 */
const ORIENT_AMBER_TAIL = /(?:\s+(?:for|with|to|me|us|here|exactly|really|then|again)){0,3}[\s.!?]*$/
  .source;

const ORIENT_AMBER = new RegExp(
  "^(?:so\\s+|ok(?:ay)?[,\\s]+|hey[,\\s]+|amber[,\\s]+)?(?:tell\\s+me\\s+|explain\\s+)?" +
    "(?:what(?:'?s| is| are)?\\s+(?:this|amber|you)" +
    "|who\\s+are\\s+you" +
    "|what\\s+can\\s+(?:you|amber)\\s+(?:do|help)" +
    "|what\\s+do\\s+you\\s+do" +
    "|how\\s+(?:does|do)\\s+(?:this|amber|you)\\s+work" +
    "|how\\s+can\\s+(?:you|amber)\\s+help" +
    "|what\\s+(?:should|can)\\s+i\\s+ask\\s+you" +
    "|are\\s+you\\s+(?:chat\\s?gpt|an?\\s+(?:ai|bot|llm|assistant|language\\s+model))" +
    "|what\\s+are\\s+you\\s+(?:good\\s+)?for" +
    ")" +
    ORIENT_AMBER_TAIL,
  "i",
);

/**
 * Which orientation question this is, or null.
 *
 * Exported so the chat route decides it once, in the same file every other
 * routing question is decided in.
 */
export function orientationAsk(ask) {
  const text = String(ask || "").trim();
  if (!text) return null;
  /**
   * NO LENGTH CAP, THOUGH THE FIRST DRAFT HAD ONE.
   *
   * "A long message is not an orientation question" was true and useless: both
   * patterns are anchored at BOTH ends, so a message long enough to be a real
   * question cannot match one in the first place. Every mutation of the cap
   * survived, which is the tell -- a guard no test can distinguish is a safety
   * net that only looks like one. The anchors are the actual defense.
   */
  if (ORIENT_AMBER.test(text)) return "about_amber";
  if (ORIENT_THEIRS.test(text) || ORIENT_THEIRS_BARE.test(text)) return "about_theirs";
  return null;
}

/**
 * A clause that is only an instruction to the assistant, not an ask of its own.
 *
 * "and tell me" / "then also" are joins, and treating them as a fourth ask
 * would put an empty lane on the plan and a spinner next to nothing.
 */
const FILLER_ONLY = /^(?:and|then|also|plus|too|as\s+well|please|thanks?|ok(?:ay)?|so)\b[\s,.!?]*$/i;

/**
 * SPLIT ONE MESSAGE INTO THE THINGS IT ACTUALLY ASKS FOR.
 *
 * The separators are the ones people use when they stack asks in one breath: a
 * question mark, a semicolon, a comma, and the word "and" -- but "and" ONLY
 * where a new ask plausibly starts after it, because "VPs of engineering and
 * product" is one ask and "coffee shops and tell me who I know" is two. The
 * lookahead is a verb or question word, which is what the front of an ask looks
 * like.
 *
 * A fragment that classifies to no lane is not dropped: it is glued onto the
 * previous fragment, so a trailing "to talk to about hardware" stays attached
 * to the VPs it qualifies instead of becoming a lane of its own.
 */
export function splitAsks(message) {
  const text = String(message || "").trim();
  if (!text) return [];
  const NEW_ASK_AHEAD =
    "(?=\\s*(?:tell|find|show|give|list|get|look|search|recommend|suggest|who|what|where|which|how|any|also|then|i\\s+want|i\\s+need|can\\s+you|could\\s+you)\\b)";
  const parts = text
    .split(new RegExp(`(?:[?;]+|,\\s*(?:and\\s+|but\\s+|also\\s+)?|\\s+and\\s+${NEW_ASK_AHEAD}|\\s+then\\s+|\\s+also\\s+)`, "i"))
    .map((x) => String(x || "").trim().replace(/^[,;.\s]+|[,;\s]+$/g, ""))
    .filter((x) => x.length > 0 && !FILLER_ONLY.test(x));
  return parts.length > 0 ? parts : [text];
}

/**
 * The one lane an ask belongs to, or null for ordinary conversation.
 *
 * The order of these tests IS the design; each one is explained above its
 * signal. In short: an explicit claim to knowing them beats everything, an
 * explicit stranger marker beats a weak first-person one, a weak first-person
 * marker over people means his own book, and a role-shaped ask with no first
 * person at all is about the world.
 */
export function laneForAsk(ask) {
  const text = String(ask || "");
  if (!text.trim()) return null;
  /**
   * ORIENTATION IS NOT A LANE, AND FIRST OF ALL IT IS NOT A PEOPLE SEARCH.
   *
   * "Tell me about my network" is wall to wall people words, so every rule
   * below reads it as a request to go and rank the address book against the
   * word "network" -- which matches nothing, ranks nobody, and answers a
   * beginner's first question with "Nothing in your contacts answers that yet."
   * The account snapshot answers it, and that is fetched by the route.
   */
  if (orientationAsk(text)) return null;
  const placeish = wantsPlaces(text);
  const peopleish = PEOPLE_WORD.test(text) || PEOPLE_ROLE_RE.test(text);
  /**
   * BEING TOLD TO SEARCH SETTLES IT, and it settles it FIRST.
   *
   * "do a web search" on its own asks for no people and names no place, so it
   * used to fall through every test and return null -- a fragment carrying the
   * most explicit instruction in the message, contributing nothing to the plan.
   * With people words beside it, it means strangers; alone, it means the web.
   */
  const commanded = WEB_COMMAND.test(text);
  if (commanded && !peopleish && !placeish) return "web";
  if (peopleish) {
    const knows = KNOWS_THEM.test(text);
    // An explicit command outranks a first-person phrasing: "find me people I
    // can pitch to, do a web search" is first person all the way through and is
    // obviously not a question about his own address book.
    const strangers = commanded || STRANGERS.test(text);
    // "who I know", "my contacts", "haven't seen in a minute" -- the book, even
    // if the clause also mentions grabbing a bite somewhere.
    if (knows) return "network";
    // "on LinkedIn", "pull up a few names", "add their contact cards".
    if (strangers) return "web_people";
    // A first person and no claim either way: his own people is the reading that
    // can actually be checked, and getting it wrong costs one tap on "search the
    // web" rather than a wasted turn.
    if (FIRST_PERSON.test(text) && !placeish) return "network";
    if (looksLikePeopleSearch(text)) return "web_people";
  }
  if (placeish) return "places";
  /**
   * THEIR OWN DAY IS NEVER A WEB SEARCH, and it reached one on a single word.
   *
   * "What's on my calendar today" matches WEB_CURRENT on "today", so the plan
   * offered to go and look up the user's schedule on the internet. There is no
   * agenda LANE -- the day is fetched by the chat route from this same
   * predicate, not raced against Exa -- so the right answer here is no lane at
   * all, which is the plain chat turn the day gets attached to.
   *
   * After `placeish` on purpose: "any good coffee places open tomorrow morning"
   * is a place question wearing a day word.
   */
  if (asksAboutTheirDay(text)) return null;
  if (WEB_CURRENT.test(text)) return "web";
  return null;
}

const LANE_KEY = { network: "people", places: "places", web_people: "web_people", web: "web" };

/**
 * One clause, short enough to sit under a heading.
 *
 * Cut at a word boundary and ellipsised, with the leading filler that survives
 * the split ("and then tell me if", "also find me") trimmed off the front --
 * that is how people stack asks in one breath, and it carries no meaning into a
 * heading.
 */
export function shortAsk(text, max = 72) {
  let t = String(text || "").trim();
  if (!t) return null;
  t = t
    .replace(/^(?:and|then|also|plus|so|but)\b[\s,]*/i, "")
    .replace(/^(?:please|maybe|i\s+want\s+to|i\s+need\s+to|i'd\s+like\s+to|can\s+you|could\s+you|tell\s+me\s+if|tell\s+me)\b[\s,]*/i, "")
    .trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

/**
 * THE PLAN.
 *
 * @param {string} message
 * @param {object} [opts]
 * @param {boolean} [opts.isVoice]   a spoken note is a journal entry, never a search
 * @param {boolean} [opts.forceWeb]  the user tapped "Search the web"
 * @param {string[]} [opts.pastedUrls]
 */
export function planQuery(message, { isVoice = false, forceWeb = false, pastedUrls = [] } = {}) {
  const text = String(message || "");
  const asks = splitAsks(text);
  const segments = asks.map((t) => ({ text: t, lane: laneForAsk(t) }));

  // Glue an unclassified fragment onto the ask before it, so qualifiers travel
  // with what they qualify instead of being lost or becoming their own lane.
  const merged = [];
  for (const seg of segments) {
    if (seg.lane == null && merged.length > 0) {
      merged[merged.length - 1].text = `${merged[merged.length - 1].text} ${seg.text}`.trim();
      continue;
    }
    merged.push({ ...seg });
  }
  const classified = merged.filter((s) => s.lane != null);

  // One text per lane. Two asks that land in the same lane are answered by one
  // call over both -- two Exa calls for two clauses of the same kind would cost
  // double for a worse query.
  const byLane = new Map();
  for (const seg of classified) {
    const key = LANE_KEY[seg.lane];
    byLane.set(key, byLane.has(key) ? `${byLane.get(key)}. ${seg.text}` : seg.text);
  }

  // THE OLD GATE WAS THE WHOLE MESSAGE, AND THIS MUST NEVER BE NARROWER THAN IT.
  //
  // Splitting a message into asks can lose a signal that only the whole sentence
  // carried: "I want to find somewhere to work from, maybe in SoHo" is a place
  // question, and neither half of it is. Before the planner existed the gate was
  // wantsPlaces(whole message), so if that says yes and no single ask claimed the
  // lane, the lane is added with the whole message as its query. A place card
  // that used to appear must not stop appearing because a comma was typed.
  //
  // IT DOES NOT COUNT TOWARDS DECISIVENESS, and that distinction matters. A lane
  // inferred from the whole sentence is weaker evidence than one matched in its
  // own clause, and letting it make a message "multi-part" would skip the
  // classifier -- losing the structured filters that drive the cheap SQL path
  // for something like "which of my contacts likes Chinese food". So it is
  // recorded as a lane to RUN, not as a lane that was ASKED for.
  let placesFallback = false;
  if (!byLane.has("places") && wantsPlaces(text)) {
    byLane.set("places", text);
    placesFallback = true;
  }

  // A SPOKEN NOTE IS NOT A SEARCH. Dictation lands in the same field, and
  // routing a journal entry through the ranker scans the whole address book --
  // which is the actual cause of a multi-minute "Thinking...". This is the
  // pre-existing rule and the planner must not quietly repeal it.
  //
  // BUT IT KEEPS ITS PLACE CARDS. "Dinner at Mala with Meet and AJ" is the
  // typical spoken note, venueNameIn() exists precisely for that phrasing, and
  // the cards under it are not a search of anything the note is about -- they
  // are the venue it named. Suppressing them here would have quietly removed a
  // working feature from every voice note, which is not a planning decision.
  if (isVoice) {
    const placesAsk = byLane.get("places") ?? null;
    return {
      asks,
      segments: merged,
      lanes: placesAsk ? [{ key: "places", label: LANE_LABELS.places, q: placesAsk }] : [],
      laneQuery: (key) => (key === "places" ? placesAsk : null),
      askCount: asks.length,
      multi: false,
      needsPeople: false,
      needsWeb: false,
      needsPlaces: placesAsk != null,
      needsWebPeople: false,
      webGroundingQuery: null,
      networkOnly: false,
      routerNeeded: false,
      intent: "chat",
      reason: placesAsk ? "voice: journal, with a venue in it" : "voice: journal, not a search",
    };
  }

  // A PASTED LINK OR AN EXPLICIT "SEARCH THE WEB" IS NOT A CLASSIFICATION
  // PROBLEM -- the user named the source. Kept decisive, as it already was, but
  // it now also carries any network ask in the same message, which the old
  // single-intent shortcut threw away.
  const named = (Array.isArray(pastedUrls) && pastedUrls.length > 0) || forceWeb === true;

  const hasNetwork = byLane.has("people");
  const hasPlaces = byLane.has("places");
  const hasWebPeople = byLane.has("web_people");
  const hasWeb = byLane.has("web");
  // The lanes that were actually ASKED for, which is what decisiveness is judged
  // on -- see placesFallback above.
  const askedKeys = [...byLane.keys()].filter((k) => !(k === "places" && placesFallback));
  const laneKeys = [...byLane.keys()];
  const multi = askedKeys.length > 1;

  // WHAT THE WEB IS ASKED ABOUT: everything except the user's own people. This
  // is the "you do not need to look into the network information" half of the
  // rule, applied to the grounding query -- the network clause used to be
  // pasted into the Exa search along with everything else.
  const nonNetwork = classified.filter((s) => s.lane !== "network").map((s) => s.text);
  const webGroundingQuery = nonNetwork.length > 0 ? nonNetwork.join(". ") : null;

  let routerNeeded = true;
  let intent = null;
  let reason = "no clear signal: classifier decides";

  if (named) {
    routerNeeded = false;
    intent = hasNetwork ? "both" : "chat";
    reason = forceWeb ? "user asked for the web" : "user pasted a link";
  } else if (multi) {
    // The case this whole file exists for.
    routerNeeded = false;
    intent = hasNetwork ? "both" : "chat";
    reason = `${askedKeys.length} asks: ${askedKeys.join(" + ")}`;
  } else if (hasPlaces && !placesFallback) {
    routerNeeded = false;
    intent = "chat";
    reason = "a place question";
  } else if (hasWebPeople) {
    routerNeeded = false;
    intent = "chat";
    reason = "people on the open web, no first-person claim";
  } else if (hasNetwork) {
    // The router still runs, for its filters. The veto below is what the
    // planner contributes.
    routerNeeded = true;
    reason = "one ask, the user's own people: classifier for filters, no web";
  } else if (hasWeb) {
    routerNeeded = true;
    reason = "weak web hint: classifier decides";
  }

  // NEEDS, as the plan sees them. When the router runs it fills these in; when
  // it does not, these are the decision.
  const needsWeb = routerNeeded ? false : hasPlaces || hasWebPeople || hasWeb || named;
  const needsPeople = routerNeeded ? hasNetwork : hasNetwork;

  const lanes = orderLanesBySpeed(
    laneKeys.map((key) => ({
      key,
      label: LANE_LABELS[key] || key,
      q: byLane.get(key),
      // THE ASK, IN HIS OWN WORDS, for the heading over that section.
      //
      // "It should be clearly separated out so the user can say: okay, this is
      //  the answer to that question, this is the answer to that question."
      //
      // A category label ("Places") says what KIND of thing a section holds. It
      // does not say which part of a three-part question it answers, and with
      // three sections on screen that is the thing the reader needs. So each
      // section also carries the clause it came from -- quoted, not paraphrased,
      // because a paraphrase of the user's own sentence is a claim about what
      // they meant and this needs no claim at all.
      ask: shortAsk(byLane.get(key)),
    })),
  );

  return {
    asks,
    segments: merged,
    lanes,
    /** The text of one lane's own ask, or null if that lane was not asked for. */
    laneQuery: (key) => byLane.get(key) ?? null,
    askCount: asks.length,
    multi,
    needsPeople,
    needsWeb,
    needsPlaces: hasPlaces,
    needsWebPeople: hasWebPeople || (named && looksLikePeopleSearch(text)),
    webGroundingQuery,
    /**
     * Every ask in this message is about the user's own people, so a web call
     * cannot contribute to any of it. This is a VETO the planner keeps even when
     * the classifier runs.
     */
    /**
     * A SECOND GUARD HERE WOULD BE UNREACHABLE, and it was written before it was
     * tested. The first draft added `&& !WEB_COMMAND.test(text)` to this line as
     * belt and braces against the bug above -- and removing it again left every
     * test green, because laneForAsk now turns a commanded ask into `web` or
     * `web_people`, so hasWeb or hasWebPeople is already true and this can never
     * be the thing that saves it. Dead code that looks like the safety net is
     * worse than no safety net: the next reader trusts it.
     *
     * The rule lives in laneForAsk, once.
     */
    networkOnly: hasNetwork && !hasPlaces && !hasWebPeople && !hasWeb && !named,
    routerNeeded,
    intent,
    reason,
  };
}
