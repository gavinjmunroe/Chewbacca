/**
 * LEXICON EVALUATION — measured, not asserted.
 *
 * I told Karthik four of six dimensions never fire. That came from a scratch
 * database holding two facts, one emotional and one financial, and it was a
 * statement about the test data rather than about the lexicon. This is the thing
 * I should have run before saying it.
 *
 * A labeled corpus of sentences of the kind Amber actually captures, with the
 * dimensions a person would assign. Reports precision and recall per dimension,
 * and every disagreement, so a change to the lexicon can be judged rather than
 * guessed at.
 *
 *     node scripts/lexicon-eval.mjs            summary
 *     node scripts/lexicon-eval.mjs --misses   every disagreement
 *
 * NO DATABASE. The lexicon is a pure function; this runs anywhere.
 */
import { classifyByLexicon, lexiconScores } from "../src/lib/observation-dimensions.js";

// [text, expected dimensions]. Empty means "about none of them" -- logistics and
// scheduling, which the classifier must NOT force into a dimension.
const CORPUS = [
  // spiritual
  ["Maggie started meditating every morning", ["spiritual"]],
  ["He's been going to church again since his dad died", ["spiritual", "emotional"]],
  ["She's doing a ten-day silent retreat in December", ["spiritual"]],
  ["Sagar says he's been having a bit of a faith crisis", ["spiritual"]],
  ["He keeps talking about wanting more of a sense of purpose in his work", ["spiritual"]],
  ["She has a gratitude practice she does before bed", ["spiritual"]],

  // emotional
  ["Maggie has been crying most evenings", ["emotional"]],
  ["He's burnt out and thinking about quitting", ["emotional"]],
  ["She's in therapy for the first time", ["emotional"]],
  ["They went through a divorce last year", ["emotional"]],
  ["He's been really anxious about the move", ["emotional"]],
  ["She lost her mother in March and is still grieving", ["emotional"]],

  // physical
  ["Sagar is training for the Boston marathon", ["physical"]],
  ["She's having knee surgery in March", ["physical"]],
  ["He quit drinking six months ago", ["physical"]],
  ["Maggie was diagnosed with celiac", ["physical"]],
  ["He's been doing yoga three times a week", ["physical"]],
  ["She's pregnant, due in the spring", ["physical"]],

  // intellectual
  ["She's doing a PhD in computational linguistics", ["intellectual"]],
  ["He's teaching himself Rust on the weekends", ["intellectual"]],
  ["She published a paper on protein folding", ["intellectual"]],
  ["He went back to school for a masters program", ["intellectual"]],
  ["She's in a book club that meets on Thursdays", ["intellectual"]],
  ["He's been reading a lot about urban planning lately", ["intellectual"]],

  // social
  ["Maggie got engaged over the weekend", ["social"]],
  ["They just had a new baby", ["social"]],
  ["He moved in together with his girlfriend", ["social"]],
  ["She's not speaking to her sister at the moment", ["social", "emotional"]],
  ["We had dinner with Sagar and his roommate", ["social"]],
  ["She's moving to San Francisco in the spring", ["social"]],

  // financial
  ["Maggie got laid off from Stripe", ["financial"]],
  ["He raised a seed round last month", ["financial"]],
  ["She bought a house in Oakland", ["financial"]],
  ["He got promoted to VP and a big raise", ["financial"]],
  ["She's freelancing while she figures out the next thing", ["financial"]],
  ["They took out a loan to cover the renovation", ["financial"]],

  // genuinely about nothing
  ["Her flight lands at 4", []],
  ["He's in town next Tuesday", ["social"]],
  ["Her number changed", []],
  ["Meeting moved to 3pm", []],
  ["He drives a blue Subaru", []],

  // multi-dimensional, the interesting cases
  ["Maggie got laid off and has been really down about it", ["financial", "emotional"]],
  ["He's training for a marathon to cope with the divorce", ["physical", "emotional"]],
  ["She's doing an MBA at night while working full time", ["intellectual", "financial"]],
];

const DIMS = ["spiritual", "emotional", "physical", "intellectual", "social", "financial"];
const SHOW_MISSES = process.argv.includes("--misses");

const stat = Object.fromEntries(DIMS.map((d) => [d, { tp: 0, fp: 0, fn: 0 }]));
const misses = [];
let uncertainCount = 0;
let exact = 0;

for (const [text, expected] of CORPUS) {
  const got = classifyByLexicon(text);
  if (got.uncertain) uncertainCount += 1;
  const predicted = new Set(got.dimensions.map((d) => d.code));
  const want = new Set(expected);
  for (const d of DIMS) {
    if (want.has(d) && predicted.has(d)) stat[d].tp += 1;
    else if (!want.has(d) && predicted.has(d)) stat[d].fp += 1;
    else if (want.has(d) && !predicted.has(d)) stat[d].fn += 1;
  }
  const same = predicted.size === want.size && [...want].every((d) => predicted.has(d));
  if (same) exact += 1;
  else misses.push({ text, want: [...want], got: [...predicted], uncertain: got.uncertain,
                     scores: lexiconScores(text) });
}

const f1 = (s) => {
  const p = s.tp + s.fp === 0 ? null : s.tp / (s.tp + s.fp);
  const r = s.tp + s.fn === 0 ? null : s.tp / (s.tp + s.fn);
  if (p === null || r === null || p + r === 0) return { p, r, f: null };
  return { p, r, f: (2 * p * r) / (p + r) };
};
const fmt = (v) => (v === null ? "  -- " : (v * 100).toFixed(0).padStart(4) + "%");

console.log(`\n  LEXICON over ${CORPUS.length} labeled sentences\n`);
console.log(`  ${"dimension".padEnd(14)}${"prec".padStart(7)}${"recall".padStart(8)}${"F1".padStart(7)}   tp/fp/fn`);
let macro = 0;
let counted = 0;
for (const d of DIMS) {
  const s = stat[d];
  const { p, r, f } = f1(s);
  if (f !== null) { macro += f; counted += 1; }
  console.log(`  ${d.padEnd(14)}${fmt(p)}${fmt(r)}${fmt(f)}   ${s.tp}/${s.fp}/${s.fn}`);
}
console.log(`\n  exact-set match ..... ${exact}/${CORPUS.length}  (${((exact / CORPUS.length) * 100).toFixed(0)}%)`);
console.log(`  macro F1 ............ ${counted ? ((macro / counted) * 100).toFixed(0) + "%" : "--"}`);
console.log(`  sent to the model ... ${uncertainCount}/${CORPUS.length}  (${((uncertainCount / CORPUS.length) * 100).toFixed(0)}% — each one is an API call)`);
console.log(`  every dimension fires: ${DIMS.every((d) => stat[d].tp + stat[d].fp > 0) ? "yes" : "NO — " + DIMS.filter((d) => stat[d].tp + stat[d].fp === 0).join(", ")}`);

if (SHOW_MISSES && misses.length) {
  console.log(`\n  DISAGREEMENTS (${misses.length})\n`);
  for (const m of misses) {
    console.log(`    ${JSON.stringify(m.text)}`);
    console.log(`      want ${JSON.stringify(m.want)}  got ${JSON.stringify(m.got)}${m.uncertain ? "  (would ask the model)" : ""}`);
    const nonzero = Object.entries(m.scores).filter(([, v]) => v > 0);
    if (nonzero.length) console.log(`      scores ${JSON.stringify(Object.fromEntries(nonzero))}`);
  }
}
console.log("");
