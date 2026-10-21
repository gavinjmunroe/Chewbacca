/**
 * WRITE-SIDE DIMENSION CLASSIFICATION — what a fact is ABOUT.
 *
 * This is not the same job as lib/dimension-classifier.js, and confusing the two
 * produces nonsense. That one scores a QUESTION and returns a distribution over
 * all six dimensions summing to 1: "who should I talk to when I feel anxious?"
 * leans emotional, and every dimension keeps a floor because retrieval should
 * never fully exclude one.
 *
 * A FACT IS NOT A DISTRIBUTION. "Maggie got laid off" is financial and
 * emotional. It is not one-sixth spiritual. Giving it a floor in every dimension
 * would mean every fact matches every dimension a little, and a dimension filter
 * that matches everything is not a filter. So this returns a SPARSE set: the
 * dimensions a fact actually bears on, and nothing else. A fact that bears on
 * none of them — "her flight lands at 4" — correctly gets none.
 *
 * THREE NUMBERS, THREE DIFFERENT QUESTIONS, and they are routinely conflated:
 *   confidence  how sure we are this fact belongs to this dimension
 *   weight      how strongly it bears on that dimension, given that it does
 *   salience    how much the fact matters at all — NOT here; it is a column on
 *               the observation, because it is a property of the fact and not
 *               of any one dimension
 * A confident reading of a trivial bearing is confidence 0.9, weight 0.2.
 *
 * TWO STAGES, AND THE SECOND ONE IS NOT ON THE CAPTURE PATH.
 *
 *   1. The lexicon runs synchronously, inside the same transaction as the
 *      insert. It is deterministic, costs nothing, and is right about the clear
 *      cases -- which are most cases. Every observation therefore has dimensions
 *      the instant it exists, and never sits unclassified.
 *
 *   2. When the lexicon is UNSURE, the row is left `dimension_status = 'pending'`
 *      with its best guess already written, and a worker picks it up and asks a
 *      model. That keeps an LLM round trip off the path where somebody is
 *      holding a phone waiting for a voice note to save, and it means an LLM
 *      outage degrades the quality of a minority of rows rather than blocking
 *      capture.
 *
 * WHAT "UNSURE" MEANS is spelled out in `isUncertain` below, because a threshold
 * nobody can find is a threshold nobody tunes.
 */

import { DIMENSIONS } from "./dimensions.js";

/** dimension_id values in the `dimensions` table (migration 006). */
export const DIMENSION_ID = Object.freeze({
  spiritual: 1,
  emotional: 2,
  physical: 3,
  intellectual: 4,
  social: 5,
  financial: 6,
});
export const DIMENSION_CODE = Object.freeze(
  Object.fromEntries(Object.entries(DIMENSION_ID).map(([k, v]) => [v, k])),
);

/**
 * THE LEXICON, and why every entry carries a strength.
 *
 * The query-side lexicon counts bare substring hits, which is fine for nudging a
 * retrieval weight and wrong for deciding what a fact is about. "work" appears in
 * "we worked out together" (physical), "working through the divorce" (emotional)
 * and "started work at Stripe" (financial). A flat count makes all three
 * financial.
 *
 * So terms are weighted by how much they actually settle the question, and the
 * strong ones are multi-word wherever a single word is ambiguous:
 *   1.0  decisive on its own -- "laid off", "chemotherapy", "got engaged"
 *   0.6  strong but context-dependent -- "promotion", "therapy", "marathon"
 *   0.3  weak; only counts when it stacks with something else -- "work", "friend"
 *
 * Matching is prefix-anchored at a word boundary, so "run" fires on "running"
 * and not inside "brunch".
 *
 * WHICH MEANS TERMS MUST BE STEMS WHERE INFLECTION CHANGES THE ENDING. This is
 * not a style note; it silently cost recall. "freelance" does not match
 * "freelancing" -- the shared prefix is "freelanc", and the two words differ at
 * the ninth character. An evaluation over a labeled corpus is what found it,
 * because the miss looks identical to a word simply not being in the list.
 * When adding a term, write the longest prefix common to its forms.
 */
const LEXICON = {
  spiritual: [
    [1.0, ["meditat", "prayer", "praying", "spiritual", "faith crisis", "found god",
           "sense of purpose", "soul searching", "existential", "dharma", "sabbath"]],
    [0.6, ["purpose", "meaning of", "values", "mindful", "retreat", "church",
           "temple", "mosque", "gratitude practice", "higher power"]],
    [0.3, ["pray", "faith", "belief", "meaning", "grounded", "centered"]],
  ],
  emotional: [
    [1.0, ["depress", "anxiety", "panic attack", "breakdown", "griev", "grief",
           "passed away", "his dad died", "her dad died", "his mum died",
           "her mum died", "dad died", "mom died", "mother died", "father died",
           "heartbroken", "burnt out", "burned out", "in therapy", "went through a divorce",
           "lost her mother", "lost his mother", "lost her father", "lost his father",
           "mental health"]],
    [0.6, ["therapy", "therapist", "lonely", "overwhelmed", "struggling", "stressed",
           "anxious", "upset", "angry", "crying", "cried", "excited about",
           "nervous", "scared", "resent", "guilt", "ashamed", "divorce", "breakup",
           "broke up", "grateful", "down about", "took it hard", "not speaking to",
           "fell out with", "cut off contact"]],
    [0.3, ["feel", "feeling", "mood", "happy", "sad", "stress", "worried", "hard time"]],
  ],
  physical: [
    [1.0, ["surgery", "chemotherapy", "diagnosed", "hospital", "injury", "injured",
           "physical therapy", "marathon", "half marathon", "triathlon", "pregnan",
           "gave birth", "concussion", "chronic pain", "insomnia", "cancer"]],
    [0.6, ["workout", "training for", "gym", "yoga", "pilates", "climb", "cycl",
           "sober", "quit drinking", "diet", "nutrition", "sleep schedule",
           "physio", "rehab", "sick", "illness", "recovery"]],
    [0.3, ["run", "running", "lift", "tired", "energy", "sleep", "eat", "food",
           "health", "pain", "sore", "walk"]],
  ],
  intellectual: [
    [1.0, ["phd", "dissertation", "thesis", "research paper", "published a paper",
           "went back to school", "grad school", "masters program", "bootcamp",
           "learning to code", "teaching herself", "teaching himself"]],
    [0.6, ["study", "reading", "course", "class", "curious about", "book club",
           "writing a book", "lecture", "conference talk", "learn", "mba",
           "night school", "evening class", "degree", "certification"]],
    [0.3, ["learn", "study", "read", "book", "idea", "think", "research", "school"]],
  ],
  social: [
    [1.0, ["got engaged", "getting married", "wedding", "new baby", "moved in together",
           "best friend", "fell out with", "not speaking to", "reconnected with",
           "housewarming", "godparent", "maid of honor", "best man"]],
    [0.6, ["dating", "girlfriend", "boyfriend", "partner", "roommate", "neighbor", "neighbour",
           "flatmate", "housemate",
           "neighbor", "dinner with", "hosted", "party", "reunion", "introduced",
           "family visit", "in town", "moving to", "moved to", "relocating"]],
    [0.3, ["friend", "family", "brother", "sister", "mother", "father", "hang",
           "together", "group", "met", "catch up", "community"]],
  ],
  financial: [
    [1.0, ["laid off", "got fired", "made redundant", "raised a round", "seed round",
           "series a", "series b", "ipo", "acquired", "bought a house", "mortgage",
           "took out a loan", "bankrupt", "back pay", "equity grant", "vesting",
           "bonus", "pay cut", "new job at", "started at", "promoted to"]],
    [0.6, ["promotion", "raise", "salary", "investor", "fundraising", "startup",
           "consult", "freelanc", "contract work", "invoice", "runway",
           "savings", "debt", "rent increase", "bought a car", "financial"]],
    [0.3, ["money", "job", "work", "career", "business", "client", "company",
           "invest", "cost", "expensive", "budget", "afford", "earn"]],
  ],
};

// A dimension is assigned when its score clears this: one 0.6 term ("anxious"),
// or two 0.3 terms stacking. A single 0.3 term never does, because "work" on its
// own is not evidence of anything.
const ASSIGN_AT = 0.6;

// CERTAINTY IS NOT THE SAME AS TOTAL SCORE, and treating it as one was wrong.
// "Maggie got laid off" scores exactly 1.0 -- one decisive term and nothing else
// -- and a total-score threshold called that unsure, which would have sent the
// clearest sentences in the corpus to a paid API. A dimension is settled when a
// DECISIVE term fired for it, or when enough weaker ones piled up.
const DECISIVE = 1.0;
const SURE_AT = 1.4;

const MAX_DIMENSIONS = 3;

function normalize(text) {
  return ` ${String(text || "").toLowerCase().replace(/[^a-z0-9\s']+/g, " ").replace(/\s+/g, " ")} `;
}

function countTerm(haystack, term) {
  if (term.includes(" ")) return haystack.includes(term) ? 1 : 0;
  // Word-boundary match for single words, so "run" does not fire inside
  // "brunch" and "eat" does not fire inside "great".
  let n = 0;
  let from = 0;
  const needle = ` ${term}`;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    // Allow a suffix (run/running/runs) but not a different word start.
    n += 1;
    from = i + needle.length;
  }
  return n;
}

/**
 * Raw lexicon score per dimension. Exported for tuning: run it over a corpus and
 * look at what fires before changing a number.
 */
export function lexiconDetail(text) {
  const hay = normalize(text);
  const out = {};
  for (const code of DIMENSIONS) {
    let score = 0;
    let best = 0;
    for (const [strength, terms] of LEXICON[code]) {
      for (const term of terms) {
        const hits = countTerm(hay, term);
        if (!hits) continue;
        // Repeats count, with diminishing returns: saying "money" four times is
        // more financial than saying it once, but not four times more.
        score += strength * (1 + Math.log2(hits));
        if (strength > best) best = strength;
      }
    }
    out[code] = { score: Number(score.toFixed(3)), best };
  }
  return out;
}

/** Just the numbers, for tuning: run it over a corpus and read what fires. */
export function lexiconScores(text) {
  return Object.fromEntries(
    Object.entries(lexiconDetail(text)).map(([k, v]) => [k, v.score]),
  );
}

/**
 * IS THE LEXICON OUT OF ITS DEPTH? Three ways it can be, each a real failure
 * mode rather than a tuning knob for its own sake:
 *
 *   nothing fired          the sentence uses none of the vocabulary. Could be a
 *                          fact about nothing ("her flight lands at 4") or a fact
 *                          the lexicon has no words for. Only a model can tell.
 *   nothing is convincing  the best score is below SURE_AT: a couple of weak
 *                          words, which is exactly where "work" means three
 *                          different things.
 *   too much text, too     a long note with one weak hit is a note the lexicon
 *   little signal          mostly did not read.
 */
export function isUncertain(detail, text) {
  // Accepts either shape: the detailed map, or the plain score map, so a caller
  // tuning by hand can pass lexiconScores() output without ceremony.
  const entries = Object.values(detail).map((v) =>
    typeof v === "number" ? { score: v, best: 0 } : v,
  );
  const top = Math.max(0, ...entries.map((e) => e.score));
  if (top === 0) return true;
  const decisive = entries.some((e) => e.best >= DECISIVE && e.score >= ASSIGN_AT);
  if (!decisive && top < SURE_AT) return true;
  const words = String(text || "").trim().split(/\s+/).length;
  const total = entries.reduce((a, e) => a + e.score, 0);
  // A long note with almost nothing firing is a note the lexicon mostly did not
  // read, decisive term or not.
  if (words >= 40 && total < 2.5) return true;
  return false;
}

/**
 * STAGE ONE. Deterministic, synchronous, no network. Returns the sparse set plus
 * whether a model should look at it.
 *
 * `weight` comes from the score's share of the total, so a fact that is mostly
 * financial with a note of emotion gets 0.8 / 0.3 rather than 1.0 / 1.0.
 * `confidence` comes from the absolute score, because a big score means the
 * vocabulary was unambiguous -- share cannot say that, since a single weak hit
 * has a 100% share of a tiny total.
 */
export function classifyByLexicon(text) {
  const detail = lexiconDetail(text);
  const uncertain = isUncertain(detail, text);
  const entries = Object.entries(detail)
    .filter(([, v]) => v.score >= ASSIGN_AT)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_DIMENSIONS);

  const total = entries.reduce((a, [, v]) => a + v.score, 0) || 1;

  const dimensions = entries.map(([code, v]) => ({
    code,
    dimensionId: DIMENSION_ID[code],
    // CONFIDENCE COMES MOSTLY FROM THE STRONGEST TERM, not from the pile. One
    // "laid off" is more convincing than four mentions of "money", and a formula
    // driven by the total says the opposite. The log term is what lets a pile of
    // weak words still get there, saturating so a wordy sentence is not treated
    // as a truer one.
    confidence: Number(
      Math.min(0.92, 0.45 * v.best + 0.25 * Math.log2(1 + v.score)).toFixed(3),
    ),
    // WEIGHT IS THE SHARE. How strongly this fact bears on this dimension,
    // relative to the others it also bears on.
    weight: Number(Math.max(0.15, v.score / total).toFixed(3)),
  }));

  const scores = Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v.score]));
  return {
    dimensions,
    uncertain,
    method: dimensions.length ? "lexicon" : "none",
    peak: entries.length ? entries[0][1].score : 0,
    scores,
  };
}

// ── Stage two: the model ─────────────────────────────────────────────────────

/**
 * CLAUDE, AND 25 FACTS PER CALL.
 *
 * This was Perplexity sonar, one fact per request (Caleb Newton, 2026-04-18,
 * "swap dimension classifier to Perplexity sonar"). Two things were wrong with
 * that and neither is about the vendor being bad:
 *
 *   SONAR IS A WEB-SEARCH MODEL. It is built to search the internet and cite
 *   sources. Labeling a sentence with six fixed categories needs no search, so
 *   every call paid for a capability the task never used -- and it added a third
 *   AI vendor to a stack that is otherwise Claude.
 *
 *   ONE FACT PER CALL RESENT THE INSTRUCTIONS EVERY TIME. The system prompt is
 *   151 tokens and the fact is about 30. Nearly two thirds of every request was
 *   the same preamble, over and over. Twenty-five facts share one preamble.
 *
 * Together: about a quarter of the old cost, and 1,034 backlogged facts settle in
 * roughly two minutes instead of forty-eight, because it is 42 requests and not
 * 1,034.
 *
 * Both are env-overridable, so pointing this at a different model or endpoint is
 * configuration and not a code change.
 */
const CHAT_URL = process.env.DIMENSION_LLM_URL || "https://api.anthropic.com/v1/messages";
const MODEL = process.env.DIMENSION_MODEL || "claude-haiku-4-5";
const BATCH_MAX = 25;

// Below this, a dimension is a guess rather than a judgment. Overridable
// because the right value is an empirical question, not a constant.
const MIN_CONFIDENCE = Number(process.env.DIMENSION_MIN_CONFIDENCE) || 0.35;

const SYSTEM = `You label a single observed fact about a person with Amber's six dimensions of health: ${DIMENSIONS.join(", ")}.

You are given a NUMBERED LIST of facts. Label each one independently.

Return ONLY a JSON object mapping each number to its array of labels:
{"1": [{"dimension": one of the six, "confidence": 0..1, "weight": 0..1}], "2": [], ...}

Rules:
- Every input number must appear as a key, even when its array is empty.
- [] when a fact touches none of them. Biographical detail -- job title, city,
  company, birthday, where someone lives or works -- is [], not a dimension of
  health. "Lives in New York" and "Works as a PM at Acme" are both [].

CONFIDENCE AND WEIGHT ARE DIFFERENT QUESTIONS. Use both.
- confidence = how sure you are this dimension genuinely applies at all.
- weight = how strongly the fact bears on that dimension, given that it does.
- A real but MINOR connection is high confidence and LOW weight, not low
  confidence. "Got dinner with Maya" is social (confidence 0.95, weight 0.9) and
  also financial (confidence 0.8 -- meals cost money -- weight 0.1, because a
  dinner says almost nothing about anyone's financial health). Encode it that
  way rather than dropping it or inflating it.
- Do NOT emit a dimension you are less than ~0.35 confident applies. A label at
  0.18 is a guess, and guesses accumulate into scores that look like signal.

WHAT BELONGS WHERE, where it is most often confused:
- FOOD AND DINING is social when it is about eating with people, hosting, or
  taste and preference. It is physical only when it is about diet, nutrition,
  fitness or a health condition. "Hates Greek food" is social taste, NOT
  physical.
- WORK, PROJECTS, STUDY, BUILDING OR SHIPPING SOMETHING are intellectual when
  the fact says something about a person's thinking, learning, craft or
  ambition. They are financial only when money is actually the subject: income,
  cost, price, funding, investment, debt, compensation. "Travels for work" and
  "applications due Friday" are not financial.
- RECORD-KEEPING AND APP ADMIN is []. "Her number is unsaved in my contacts",
  "Maggie needs to be invited to the app", "X is responsible for inviting Y".
  These are about the software and the address book, not about a person.
- PLANS AND SCHEDULING BETWEEN PEOPLE ARE SOCIAL. Not [], and not intellectual.
  Who is going where, with whom, who is coming to town, who is attending or
  missing something, who is traveling to see whom. This is future-tense
  logistics and it is ALSO the strongest social signal there is -- knowing who
  someone actually spends time with is the point. "Drew is not coming to the
  housewarming", "Beau and Spencer are in New York in October", "Spencer might
  come to the concert on the 2nd" and "the user met their parents in Pittsburgh
  today" are all social.
- A WORK TASK with no personal content in it is []. A work fact that shows what
  somebody is building, learning, or ambitious about is intellectual. "Ship by
  Friday" is []; "Shirley should focus on consumer go-to-market" is intellectual.
- A PREFERENCE OR OPINION about a place, food, film or thing is social when it
  is about taste. It is emotional only when the fact is about the person's
  feelings or state -- anxious, grieving, thrilled, burnt out. "Loves Prospect
  Park more than Central Park" is taste, NOT emotional.
- PHYSICAL means the body: training, sport, sleep, illness, injury, energy.
- SPIRITUAL means meaning, purpose, faith, values, practice -- not simply
  feeling good about something.
- Judge what the fact is ABOUT, not how it makes anyone feel.

Most facts touch one or two dimensions. Never list all six.
No prose, no markdown fence.`;

/**
 * STAGE TWO. Never called on the capture path -- the worker calls it.
 *
 * Returns null on any failure (no key, timeout, non-ok, unparseable, a model
 * that ignored the schema). Null means "the lexicon's answer stands", never "no
 * dimensions": downgrading a fact because an API was down would be a silent data
 * loss that looks exactly like a correct classification.
 */
/** Shape one model answer into the { code, dimensionId, confidence, weight } rows. */
function _shapeAnswer(parsed) {
  if (!Array.isArray(parsed)) return null;
  const seen = new Set();
  const dimensions = [];
  for (const item of parsed) {
    const code = String(item?.dimension || "").toLowerCase().trim();
    if (!(code in DIMENSION_ID) || seen.has(code)) continue;
    seen.add(code);
    const confidence = Number(item?.confidence);
    const weight = Number(item?.weight);
    // THE FLOOR IS ENFORCED HERE TOO, not only asked for in the prompt. The
    // sample that prompted this carried intellectual:0.18 on "hates Greek food"
    // and intellectual:0.20 on "training for a 5k" -- labels the model was not
    // really making, which still multiply into contact_dimension_state and read
    // as signal downstream. An instruction the model can ignore is not a
    // constraint; this is.
    if (Number.isFinite(confidence) && confidence < MIN_CONFIDENCE) continue;
    dimensions.push({
      code,
      dimensionId: DIMENSION_ID[code],
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.6,
      weight: Number.isFinite(weight) ? Math.min(1, Math.max(0.05, weight)) : 0.5,
    });
    if (dimensions.length >= MAX_DIMENSIONS) break;
  }
  // An empty array is a REAL ANSWER -- "this fact is about none of them" -- and is
  // returned as such, distinct from null.
  return { dimensions, method: "llm" };
}

/**
 * Turn one model response's content blocks into positional answers.
 *
 * Shared by the live path and the Batch API path so the two can never disagree
 * about what a valid answer looks like -- which is the whole risk of adding a
 * second transport for the same prompt.
 *
 * Returns an array of length `count`: { dimensions, method } or null per slot.
 * Every failure yields nulls, never empty dimension arrays, because "the model
 * did not answer" and "this fact has no dimensions" mean opposite things to the
 * queue.
 */
function _answersFromContent(content, count) {
  const nulls = () => new Array(count).fill(null);
  const blocks = Array.isArray(content) ? content : [];
  const raw = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) {
    console.error(`DIMENSION_LLM_UNPARSEABLE model=${MODEL} got=${String(raw).slice(0, 200)}`);
    return nulls();
  }
  let parsed;
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    console.error(`DIMENSION_LLM_BAD_JSON ${e.message} got=${m[0].slice(0, 200)}`);
    return nulls();
  }
  if (!parsed || typeof parsed !== "object") return nulls();
  return Array.from({ length: count }, (_, i) => {
    const answer = parsed[String(i + 1)];
    return answer === undefined ? null : _shapeAnswer(answer);
  });
}

/** The numbered user turn and token ceiling, identical on both transports. */
function _chunkRequestParams(chunk) {
  return {
    model: MODEL,
    max_tokens: 64 * chunk.length + 200,
    temperature: 0,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: chunk.map((t, i) => `${i + 1}. ${String(t).slice(0, 2000)}`).join("\n"),
      },
    ],
  };
}

/**
 * Label up to 25 facts in ONE request. Returns an array positionally matching the
 * input: each entry is { dimensions, method } or null.
 *
 * null NEVER MEANS "no dimensions". It means the model did not answer for that
 * fact -- no key, a timeout, a non-ok response, unparseable JSON, or a key the
 * model simply omitted. The caller keeps the lexicon's guess and leaves the row
 * pending, because downgrading a fact because an API was down is a silent data
 * loss that looks exactly like a correct classification.
 *
 * A PARTIAL ANSWER IS KEPT. If the model returns 23 of 25 keys, those 23 are
 * applied and the two missing ones come back null and retry. An all-or-nothing
 * batch would throw away good work because of one bad row.
 */
export async function classifyBatchByModel(texts, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? "").trim());
  if (list.length === 0) return [];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return list.map(() => null);
  if (list.length > BATCH_MAX) {
    // Split rather than truncate: silently dropping the tail would leave rows
    // pending forever while the worker reported success.
    const head = await classifyBatchByModel(list.slice(0, BATCH_MAX), { fetchImpl, timeoutMs });
    const tail = await classifyBatchByModel(list.slice(BATCH_MAX), { fetchImpl, timeoutMs });
    return [...head, ...tail];
  }

  const numbered = list.map((t, i) => `${i + 1}. ${t.slice(0, 2000)}`).join("\n");
  try {
    const res = await fetchImpl(CHAT_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 64 * list.length + 200,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: "user", content: numbered }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // LOUD, because the alternative already cost a day. A wrong model name is a
      // 404 and a bad key is a 401, and both used to come back as a quiet array of
      // nulls -- indistinguishable from "the model had no opinion". Each such pass
      // burns an attempt, and after MAX_ATTEMPTS the row settles for the lexicon's
      // guess PERMANENTLY. Three silent passes and a thousand facts are wrong
      // forever, with nothing in the log to say why.
      const body = await res.text().catch(() => "");
      console.error(
        `DIMENSION_LLM_HTTP_${res.status} model=${MODEL} url=${CHAT_URL} ` +
          `${body.slice(0, 300)}`,
      );
      return list.map(() => null);
    }
    const data = await res.json().catch(() => null);
    return _answersFromContent(data?.content, list.length);
  } catch (err) {
    // A timeout or a network error. Also loud: silence here looks identical to a
    // model that considered every fact and found nothing.
    console.error(`DIMENSION_LLM_THREW model=${MODEL} ${err?.name || ""} ${err?.message || err}`);
    return list.map(() => null);
  }
}

/**
 * ONE TEST CALL, BEFORE ANY ROW IS CLAIMED.
 *
 * The queue burns an attempt per row per pass, and a row that runs out settles for
 * the lexicon's guess and never asks again. So a misconfiguration -- wrong model
 * name, missing key, wrong endpoint -- must be caught BEFORE the first claim, not
 * discovered after it has quietly wrecked a thousand rows.
 *
 * Returns { ok: true } or { ok: false, reason }. Costs one call on two words.
 */
export async function preflightModel(opts = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
  }
  const probe = await classifyBatchByModel(["He just ran a marathon"], opts);
  if (!Array.isArray(probe) || probe.length !== 1) {
    return { ok: false, reason: "classifier returned the wrong shape" };
  }
  if (probe[0] === null) {
    return {
      ok: false,
      reason: `the model did not answer — see the DIMENSION_LLM_* line above for ` +
              `the status and body. model=${MODEL} url=${CHAT_URL}`,
    };
  }
  return { ok: true, model: MODEL, dimensions: probe[0].dimensions.map((d) => d.code) };
}

/** One fact. Kept for callers and tests that classify a single observation. */
export async function classifyByModel(text, opts = {}) {
  if (!String(text || "").trim()) return null;
  const [one] = await classifyBatchByModel([text], opts);
  return one ?? null;
}

/**
 * Both stages, for callers that want the finished answer and can afford to wait
 * (the worker, a backfill, a test). The capture path uses classifyByLexicon
 * directly and lets the worker do this part.
 */
export async function classifyObservation(text, opts = {}) {
  const lex = classifyByLexicon(text);
  if (!lex.uncertain || opts.lexiconOnly) return lex;
  const llm = await classifyByModel(text, opts);
  if (!llm) return { ...lex, method: lex.method === "none" ? "none" : "lexicon", llmFailed: true };
  return { ...llm, uncertain: false, scores: lex.scores };
}

// ── THE BATCH API TRANSPORT (opt-in, background only) ────────────────────────
//
// Same prompt, same parser, same return contract as classifyBatchByModel. The
// only difference is that Anthropic processes the requests asynchronously and
// charges HALF. In exchange, results arrive within a 24-hour window rather than
// in seconds, which is why this is only ever correct for the backfill worker and
// never for anything a person is waiting on.
//
// WHY THIS IS NOT THE DEFAULT. Two reasons, both about failure rather than cost:
//
//   THE QUEUE BURNS AN ATTEMPT AT CLAIM TIME. Rows are claimed before the batch
//   is submitted, so a batch that never completes costs every row in it one of
//   its three attempts. On the live path a failure costs seconds; here it can
//   cost a long wait first. Fine for a nightly backfill, wrong for a default.
//
//   A LONG WAIT IN A SHORT-LIVED PROCESS IS A LIE. Railway restarts, a laptop
//   sleeping, Ctrl-C -- any of them abandons a batch that has already been paid
//   for. So the wait is CAPPED (DIMENSION_BATCH_MAX_WAIT_MS, default 30 min) and
//   a timeout returns nulls, which leaves the rows pending for an ordinary pass.
//   Nothing is lost except that batch's money.
//
// Persisting the batch id so a later run could collect an in-flight batch would
// fix both, and needs a table. That is Karthik's call, not something to slip in.

const BATCH_API_URL = "https://api.anthropic.com/v1/messages/batches";
const BATCH_MAX_WAIT_MS = Number(process.env.DIMENSION_BATCH_MAX_WAIT_MS) || 30 * 60 * 1000;
const BATCH_POLL_START_MS = 5000;
const BATCH_POLL_MAX_MS = 60000;

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Label any number of facts through the Message Batches API, at half price.
 *
 * Returns an array positionally matching `texts`: { dimensions, method } or
 * null. Identical contract to classifyBatchByModel, so it drops straight into
 * runDimensionPass({ classify }).
 *
 * Facts are split into chunks of BATCH_MAX and each chunk becomes ONE request in
 * the batch, so the instruction preamble is still amortised 25 ways -- the batch
 * discount is on top of that, not instead of it.
 */
export async function classifyViaBatchApi(
  texts,
  {
    fetchImpl = fetch,
    maxWaitMs = BATCH_MAX_WAIT_MS,
    // Injectable so tests do not have to wait real seconds to exercise the poll
    // loop. Nothing in production passes these.
    pollStartMs = BATCH_POLL_START_MS,
    pollMaxMs = BATCH_POLL_MAX_MS,
    log = console,
  } = {},
) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? "").trim());
  if (list.length === 0) return [];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    log.error?.("DIMENSION_BATCH_NO_KEY ANTHROPIC_API_KEY is not set");
    return list.map(() => null);
  }

  // custom_id -> the slice of `list` that request covers, so results can be put
  // back in the caller's order no matter what order they come out in.
  const chunks = [];
  for (let i = 0; i < list.length; i += BATCH_MAX) {
    chunks.push({ id: `c${chunks.length}`, offset: i, texts: list.slice(i, i + BATCH_MAX) });
  }

  const headers = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  const out = new Array(list.length).fill(null);

  try {
    // ── submit ────────────────────────────────────────────────────────────────
    const createRes = await fetchImpl(BATCH_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requests: chunks.map((c) => ({
          custom_id: c.id,
          params: _chunkRequestParams(c.texts),
        })),
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      log.error?.(
        `DIMENSION_BATCH_HTTP_${createRes.status} model=${MODEL} ${body.slice(0, 300)}`,
      );
      return out;
    }
    const created = await createRes.json().catch(() => null);
    const batchId = created?.id;
    if (!batchId) {
      log.error?.("DIMENSION_BATCH_NO_ID the create call returned no batch id");
      return out;
    }
    log.log?.(
      `  batch: submitted ${chunks.length} request(s) covering ${list.length} facts (${batchId})`,
    );

    // ── poll ──────────────────────────────────────────────────────────────────
    const deadline = Date.now() + maxWaitMs;
    let wait = pollStartMs;
    let resultsUrl = null;
    while (Date.now() < deadline) {
      await _sleep(wait);
      wait = Math.min(Math.round(wait * 1.5), pollMaxMs);
      const pollRes = await fetchImpl(`${BATCH_API_URL}/${batchId}`, { headers });
      if (!pollRes.ok) continue; // transient; keep waiting until the deadline
      const status = await pollRes.json().catch(() => null);
      if (status?.processing_status === "ended") {
        resultsUrl = status?.results_url ?? `${BATCH_API_URL}/${batchId}/results`;
        break;
      }
    }
    if (!resultsUrl) {
      log.error?.(
        `DIMENSION_BATCH_TIMEOUT ${batchId} did not end within ${maxWaitMs}ms. ` +
          `Rows stay pending; re-run without --batch to settle them now.`,
      );
      return out;
    }

    // ── collect ───────────────────────────────────────────────────────────────
    const resultsRes = await fetchImpl(resultsUrl, { headers });
    if (!resultsRes.ok) {
      log.error?.(`DIMENSION_BATCH_RESULTS_HTTP_${resultsRes.status} ${batchId}`);
      return out;
    }
    const body = await resultsRes.text();
    const byId = new Map(chunks.map((c) => [c.id, c]));
    let succeeded = 0;
    let failed = 0;
    // JSONL: one result object per line, in no guaranteed order.
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const chunk = byId.get(row?.custom_id);
      if (!chunk) continue;
      if (row?.result?.type !== "succeeded") {
        // errored / canceled / expired. Leave this chunk's slots null so those
        // rows retry rather than settling on nothing.
        failed += 1;
        continue;
      }
      succeeded += 1;
      const answers = _answersFromContent(row.result.message?.content, chunk.texts.length);
      for (let i = 0; i < answers.length; i++) out[chunk.offset + i] = answers[i];
    }
    log.log?.(
      `  batch: ${succeeded} request(s) succeeded, ${failed} failed (${batchId})`,
    );
    return out;
  } catch (err) {
    log.error?.(
      `DIMENSION_BATCH_THREW model=${MODEL} ${err?.name || ""} ${err?.message || err}`,
    );
    return out;
  }
}
