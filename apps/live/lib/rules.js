// What a client may read. These are Zeutara's standing rulings
// (zeutara-gtme/DECISIONS.json: client-register, interest-from-text,
// client-channel), applied in code to every sentence the model writes, because
// a prompt alone let a week-1 update promise Jonah something nobody had agreed.
//
//   full words: no "u", "ur", "w"
//   every number real: a numeral in prose must appear in the data it came from
//   interest only from reply text: "interested" survives only if a reply says so
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
const NEGATED = /\b(no|not|none|nobody|no one|never|neither|yet to)\b[^.!?]*\binterest|n't\b[^.!?]*\binterest/i;

export function sentences(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .filter(Boolean);
}

/** Every number a sentence states, normalized ("1,702" and "12.5%" too). */
export function numbersIn(text) {
  return (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));
}

/**
 * Clean model prose against the rules. `grounding` is every string and number
 * the answer's data holds; `replyText` is what investors actually wrote.
 * Sentences that break a rule are dropped, never rewritten into a claim.
 */
export function cleanProse(text, { grounding = "", replyText = "" } = {}) {
  const known = new Set(numbersIn(grounding));
  const kept = [];
  const dropped = [];
  for (let s of sentences(text)) {
    s = s.replace(/\s*[—–]\s*/g, ", ");
    for (const [re, rep] of SHORTHAND) s = s.replace(re, rep);
    if (CHATTER.test(s)) { dropped.push({ s, why: "process" }); continue; }
    // "Nobody has said they are interested" is the honest answer most weeks
    // (2026-10-10, "Is anyone interested in Ivy?" lost both such sentences),
    // so only an affirmative claim needs a reply that says it.
    if (INTEREST.test(s) && !NEGATED.test(s) && !INTEREST.test(replyText)) { dropped.push({ s, why: "interest" }); continue; }
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
