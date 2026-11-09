// What a client may read. These are Zeutara's standing rulings
// (zeutara-gtme/DECISIONS.json: client-register, interest-from-text,
// client-channel), applied in code to every sentence the model writes, because
// a prompt alone let a week-1 update promise Jonah something nobody had agreed.
//
//   full words: no "u", "ur", "w"
//   every number real: a number in prose, in digits or in words, must be one a
//     source counted (numeric fields only, never text a stranger wrote)
//   interest only from reply text: the model never sees reply text, so it can
//     never call anyone interested; only "nobody has said so" survives
//   no process chatter: no tools, queries, databases or pipelines
//   no em or en dashes (house rule, and Maggie's: one dash reads as AI)

const SHORTHAND = [
  [/\bu\b/gi, "you"],
  [/\bur\b/gi, "your"],
  [/\bw\/(?=\s)/gi, "with"],
  [/\bw\b(?=\s+[a-z])/gi, "with"],
];
const CHATTER = /\b(tool|tools|query|queries|database|bigquery|json|api|endpoint|pipeline|webhook|prompt|model|llm|sync agent|cache|cached)\b/i;
const INTEREST = /\binterest(ed|ing)?\b/i;
// A negation must govern the interest claim: "nobody ... interested", "not
// interested", "hasn't said they are interested". A clause that only starts
// with a negation ("Not only did Accel answer, they are interested") is still
// affirmative (independent review, 2026-10-10), so the negation has to sit in
// the same clause, with no comma or "but" between it and the claim.
const NEGATED = /\b(no(?! (doubt|surprise|wonder)\b)|nobody|none|not|never|neither|yet to)\b[^.!?,;]*\binterest|n't\b[^.!?,;]*\binterest/i;
const BUT = /\b(but|however|although|though)\b[^.!?]*\binterest/i;

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export function sentences(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .filter(Boolean);
}

/** Every number a sentence states, in digits or in words, normalized. */
export function numbersIn(text) {
  const s = String(text);
  const digits = (s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));
  const words = [];
  const re = new RegExp(`\\b(${Object.keys(TENS).join("|")})(?:[- ](${UNITS.slice(1, 10).join("|")}))?\\b|\\b(${UNITS.slice(2).join("|")})\\b|\\b(hundred|thousand|dozen)s?\\b`, "gi");
  for (const m of s.matchAll(re)) {
    if (m[1]) words.push(String(TENS[m[1].toLowerCase()] + (m[2] ? UNITS.indexOf(m[2].toLowerCase()) : 0)));
    else if (m[3]) words.push(String(UNITS.indexOf(m[3].toLowerCase())));
    else words.push(m[4].toLowerCase()); // never grounded: "hundreds of investors" is a claim
  }
  return [...digits, ...words];
}

/**
 * Clean model prose against the rules. `grounding` is the list of numbers the
 * sources counted (lib/answer.js groundingOf). Sentences that break a rule are
 * dropped, never rewritten into a claim.
 */
export function cleanProse(text, { grounding = "" } = {}) {
  const known = new Set(numbersIn(grounding).filter((n) => /^\d/.test(n)));
  const kept = [];
  const dropped = [];
  for (let s of sentences(text)) {
    s = s.replace(/\s*[—–]\s*/g, ", ");
    for (const [re, rep] of SHORTHAND) s = s.replace(re, rep);
    if (CHATTER.test(s)) { dropped.push({ s, why: "process" }); continue; }
    if (INTEREST.test(s) && (!NEGATED.test(s) || BUT.test(s))) { dropped.push({ s, why: "interest" }); continue; }
    const unknown = numbersIn(s).filter((n) => !known.has(n) && !isYearOrDay(n, s));
    if (unknown.length) { dropped.push({ s, why: `numbers ${unknown.join(", ")}` }); continue; }
    kept.push(s);
  }
  return { text: kept.join(" "), dropped };
}

// A date in prose ("October 10", "2026") is not a metric claim.
function isYearOrDay(n, s) {
  const v = Number(n);
  if (/^20\d\d$/.test(n)) return true;
  return v >= 1 && v <= 31 && new RegExp(`\\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.? ${n}\\b`).test(s);
}

// What Togari did, in words Jonah reads. Anything that is not one of Togari's
// own outcomes is a Clay category ("Interested", "Not Interested"), and a
// category is never shown as a verdict (interest-from-text).
const DID = new Set([
  "blocklisted",
  "forwarded to their new address",
  "forwarded to the person they referred",
  "follow up scheduled",
  "logged as a pass",
  "logged",
]);
export function togariDid(raw) {
  const s = String(raw || "").trim();
  if (DID.has(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  return "Sent to you as a card in Slack";
}
export function isCardForClient(raw) {
  return !DID.has(String(raw || "").trim());
}
