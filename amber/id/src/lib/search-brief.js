/**
 * WHO IS ASKING, TURNED INTO WHAT TO SEARCH FOR.
 *
 *   "There should be understanding of the person asking. The user profile should
 *    be contextualized for the search. If the user is like, 'I'm looking for VPs
 *    of finance to talk to and meet with,' even if they don't say New York, it
 *    should be like, 'Okay, the user is in New York, so clearly they want people
 *    in New York.'"
 *
 * WHAT WAS ACTUALLY HAPPENING, and it is worse than a weak provider: nothing
 * rewrote the query at all. `webGroundingQuery` is the user's own sentence with
 * the clauses about their own people filtered out and the rest re-joined with a
 * period. That string went straight to Exa. "VPs of finance to talk to and meet
 * with" was sent, verbatim, as a search query -- no city, no industry, no
 * employer, no idea what the person had been talking about ninety seconds
 * earlier. There is no vendor whose results are good for that input, which is
 * why swapping the vendor was never going to fix it.
 *
 * SO THE BRIEF IS THE FIX. One cheap model pass, before the search, that sees:
 *
 *   - the ask, in the user's words
 *   - WHO THEY ARE: city, what they do, where they have worked and studied
 *   - WHAT IS GOING ON: the day in front of them and a digest of what they have
 *     been talking about in other threads
 *
 * and returns the queries a person who knew all that would actually type, plus
 * the levers Exa has always supported and this codebase has never set: a
 * location, a recency window, a category.
 *
 * IT SAYS WHAT IT ASSUMED, and that is not decoration. Adding "New York" to
 * somebody's search is putting words in their mouth; doing it silently means a
 * wrong guess is invisible and uncorrectable. The brief carries an `assumption`
 * line so the answer can say "I looked around New York, since that is where you
 * are" and the user can say no.
 *
 * AND IT FAILS OPEN. No key, a timeout, malformed JSON: the brief degrades to
 * exactly what the code did before it existed -- the user's own words, one
 * query, no levers. A search that is merely as good as yesterday's beats a turn
 * that errors.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const BRIEF_TIMEOUT_MS = 6000;

/** How many searches one ask may fan out into. */
const MAX_QUERIES = 3;

/** The recency windows Exa can express as a start date. */
const RECENCY = new Set(["day", "week", "month", "year"]);

/**
 * Exa's categories. Passing one narrows the index to a kind of page, which is
 * the difference between "VPs of finance" returning LinkedIn profiles and
 * returning listicles about what a VP of finance does.
 */
const CATEGORIES = new Set([
  "company",
  "research paper",
  "news",
  "linkedin profile",
  "github",
  "tweet",
  "movie",
  "song",
  "personal site",
  "pdf",
  "financial report",
]);

/**
 * WHO THEY ARE, in one line, from what the profile actually holds.
 *
 * There is no `company` or `title` column on this table -- the closest are
 * `occupation` and `profile_extra.employers` -- so this reads what exists rather
 * than what would be convenient. Empty when nothing is known, which is a real
 * state on day one and must not become a line of empty labels.
 */
export function profileLine(profile) {
  if (!profile || typeof profile !== "object") return "";
  const bits = [];
  const name = str(profile.displayName) || str(profile.name);
  if (name) bits.push(`Name: ${name}`);
  const city = str(profile.currentCity) || str(profile.city) || str(profile.hometown);
  if (city) bits.push(`Lives in: ${city}`);
  const occupation = str(profile.occupation);
  if (occupation) bits.push(`Does: ${occupation}`);
  const employers = list(profile.employers);
  if (employers) bits.push(`Has worked at: ${employers}`);
  const schools = list(profile.schools) || str(profile.school) || list(profile.almaMater);
  if (schools) bits.push(`Studied at: ${schools}`);
  const bio = str(profile.bio);
  if (bio) bits.push(`About them: ${bio.slice(0, 240)}`);
  return bits.join("\n");
}

/** The city to search around, or null. Reads the same ladder buildMe does. */
export function homeCityOf(profile) {
  if (!profile || typeof profile !== "object") return null;
  return (
    str(profile.currentCity) ||
    str(profile.city) ||
    str(profile.location) ||
    str(profile.region) ||
    str(profile.hometown) ||
    null
  );
}

function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function list(v) {
  if (Array.isArray(v)) {
    const names = v
      .map((x) => (typeof x === "string" ? x : str(x?.name) || str(x?.company) || str(x?.title)))
      .filter(Boolean);
    return names.length > 0 ? names.slice(0, 4).join(", ") : null;
  }
  return str(v);
}

const BRIEF_SYSTEM = `You turn one person's request into the web searches that will actually answer it.

You are given WHO IS ASKING and WHAT IS GOING ON WITH THEM. Use both. The whole point is that a search written by somebody who knows this person beats a search written from their words alone.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{"queries":["<search query>", ...],"location":"<city or region to bias toward, or null>","recency":"day"|"week"|"month"|"year"|null,"category":"<one of the listed categories, or null>","assumption":"<one short clause naming what you inferred, or null>"}

RULES:
- "queries": 1 to ${MAX_QUERIES} of them. Write what an expert would type into a search engine, not a sentence. Several queries only when the ask genuinely has several parts or one angle plainly will not cover it. ONE is the normal answer.
- USE WHERE THEY LIVE WHEN, AND ONLY WHEN, PLACE CHANGES THE ANSWER. "VPs of finance to talk to and meet with" from somebody in New York means VPs of finance in New York, because you cannot meet somebody in another city over coffee. "Who is the CEO of Stripe" means the same thing everywhere, so location is null there. Somewhere to eat, somebody to hire, a doctor, an event, a class, a service: those are local. A fact about the world is not.
- USE WHAT THEY DO WHEN IT DISAMBIGUATES. A designer asking about "type" means typography; an investor asking about "series A" means the round, not the car. Their employer and their school are how you tell which "Sequoia" or which "Anderson" they mean.
- USE WHAT IS GOING ON WITH THEM. This is the difference between a search engine and Amber. Somebody who says "I'm just looking for people that can help me right now, I'm so stressed out", and who has been talking all week about exams, is not asking you to search the phrase "people who can help". They are asking for a way through the week: search for what would actually decompress them where they live, and say that is what you did.
- NEVER INVENT A CONSTRAINT THEY WOULD REJECT. If they named a city, that city wins over the one they live in. If they said "anywhere" or "remote", location is null. When you are not sure place matters, leave it null: a search that is too broad returns extra results, and a search wrongly narrowed to the wrong city returns nothing and looks broken.
- "category": ONLY when the kind of page is obvious. People searches are "linkedin profile". Companies are "company". Anything about what happened recently is "news". Most asks get null.
- "recency": only when the answer changes with time. Prices, news, who currently holds a role, what is open now. A recipe or a definition gets null.
- "assumption": ONE clause, in plain words, naming what you added that they did not say -- "in New York, where they live", "for this week", "profiles rather than articles". Null when you added nothing. This gets shown to them, so write it as something a person would say.
- Output ONLY the JSON object.

EXAMPLES

WHO: Lives in: New York, NY | Does: partner at a search fund
WHAT IS GOING ON: (nothing in particular)
ASK: "I'm looking for VPs of finance to talk to and meet with"
{"queries":["VP of Finance New York City","VP Finance New York LinkedIn"],"location":"New York, NY","recency":null,"category":"linkedin profile","assumption":"in New York, since that is where you are and you want to meet them"}

WHO: Lives in: Seattle, WA | Studied at: University of Washington
WHAT IS GOING ON: Three reminders this week about the CPA exam. Yesterday: "the studying is crushing me".
ASK: "I'm just looking for people that can help me right now. I'm just so stressed out"
{"queries":["free walk-in mental health support Seattle","study burnout support groups Seattle","quiet places to decompress Seattle"],"location":"Seattle, WA","recency":null,"category":null,"assumption":"that this is about the exam you have been studying for, and looking near Seattle"}

WHO: Lives in: Austin, TX | Does: founder
WHAT IS GOING ON: (nothing in particular)
ASK: "who is the CEO of Stripe"
{"queries":["Stripe CEO"],"location":null,"recency":"year","category":null,"assumption":null}

WHO: Lives in: Brooklyn, NY
WHAT IS GOING ON: Dinner with Meet and AJ on Saturday, walking the West Village.
ASK: "somewhere good for dinner"
{"queries":["best restaurants West Village New York"],"location":"New York, NY","recency":null,"category":null,"assumption":"the West Village, since that is where Saturday's dinner is"}

WHO: Lives in: London
WHAT IS GOING ON: (nothing in particular)
ASK: "remote react contractors, anywhere in the world"
{"queries":["remote React contract developer for hire"],"location":null,"recency":null,"category":"linkedin profile","assumption":null}`;

/**
 * Everything the brief is allowed to be, checked rather than trusted.
 *
 * A model that returns a category Exa does not have, or eleven queries, or a
 * recency of "soonish", would otherwise reach the request body and be rejected
 * by the API -- turning a slightly-off brief into no search at all.
 */
export function normalizeBrief(raw, { message }) {
  const fallback = { queries: [String(message || "").trim()].filter(Boolean), location: null, recency: null, category: null, assumption: null };
  if (!raw || typeof raw !== "object") return fallback;

  const queries = (Array.isArray(raw.queries) ? raw.queries : [])
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter((q) => q.length > 1)
    .slice(0, MAX_QUERIES);
  if (queries.length === 0) return fallback;

  const category = typeof raw.category === "string" ? raw.category.trim().toLowerCase() : "";
  const recency = typeof raw.recency === "string" ? raw.recency.trim().toLowerCase() : "";

  return {
    queries,
    location: str(raw.location),
    recency: RECENCY.has(recency) ? recency : null,
    category: CATEGORIES.has(category) ? category : null,
    // Capped: this is shown to the user in one line, and a model that decided
    // to explain itself at length would push the answer off the screen.
    assumption: str(raw.assumption)?.slice(0, 160) ?? null,
  };
}

/** The start date for a recency window, as Exa wants it. */
export function startDateFor(recency, now = new Date()) {
  const days = { day: 1, week: 7, month: 31, year: 366 }[recency];
  if (!days) return null;
  return new Date(now.getTime() - days * 86400000).toISOString();
}

/**
 * Build the brief. Fails open to the user's own words.
 *
 * @param {object} args
 * @param {string} args.message      what they asked, verbatim
 * @param {object|null} args.profile getProfile's shape
 * @param {string} args.situation    what is going on with them, already rendered
 */
export async function buildSearchBrief({
  message,
  profile = null,
  situation = "",
  model = process.env.CHAT_ROUTER_MODEL || "claude-haiku-4-5-20251001",
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  const ask = String(message || "").trim();
  const bare = normalizeBrief(null, { message: ask });
  if (!ask) return bare;
  if (!apiKey || typeof fetchImpl !== "function") return bare;

  const who = profileLine(profile) || "(nothing known about them yet)";
  const going = String(situation || "").trim().slice(0, 1200) || "(nothing in particular)";
  const user = `WHO: ${who}\nWHAT IS GOING ON: ${going}\nASK: "${ask}"\n\nJSON:`;

  try {
    const resp = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        temperature: 0,
        system: BRIEF_SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(BRIEF_TIMEOUT_MS),
    });
    if (!resp.ok) return bare;
    const data = await resp.json();
    const text = (data?.content || [])
      .map((b) => (b && typeof b.text === "string" ? b.text : ""))
      .join(" ");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return bare;
    return normalizeBrief(JSON.parse(text.slice(start, end + 1)), { message: ask });
  } catch {
    return bare; // fail open: yesterday's search beats an error
  }
}

/**
 * The line the answer can say out loud.
 *
 * Adding a city to somebody's search is putting words in their mouth. Doing it
 * silently means a wrong guess cannot be corrected, so the model is told to
 * mention it -- and told to mention it ONCE, because a paragraph of hedging
 * about how the search was constructed is not what anybody asked for.
 */
export function assumptionInstruction(brief) {
  if (!brief?.assumption) return "";
  return (
    `You searched with one thing assumed: ${brief.assumption}. Say so in ONE short clause ` +
    `inside your answer, in your own words, so they can correct you. Do not explain how you ` +
    `searched beyond that clause.`
  );
}
