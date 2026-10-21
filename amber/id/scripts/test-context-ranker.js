// PURE unit test for the context ranker — NO DB, NO creds. Runs with plain
// `node scripts/test-context-ranker.js`. Verifies RANK-DON'T-FILTER behavior.

import { buildUserPrior, rankCandidates } from "../src/enrichment/context-ranker.js";

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

// A Chicago / University of Chicago user.
const prior = buildUserPrior({
  currentCity: "Chicago",
  hometown: "Chicago",
  school: "University of Chicago",
  occupation: "Acme Corp",
  profileExtra: { placesLived: ["Chicago"], schools: ["University of Chicago"] },
});
// Contact with a Chicago (312) area code.
const contact = { name: "John Doe", phone: "+13125550123" };

// ── Case 1: a clear Chicago+UChicago match dominates → 'auto', chosen = it. ──
const c1 = [
  { name: "John Doe", linkedinUrl: "u/chi", title: "Engineer", company: "Acme Corp", city: "Chicago", state: "IL", school: "University of Chicago" },
  { name: "John Doe", linkedinUrl: "u/ny", title: "PM", company: "Globex", city: "New York", state: "NY", school: "NYU" },
  { name: "John Doe", linkedinUrl: "u/pl", title: "Analyst", company: "Kowalski", city: "Warsaw", state: null, country: "PL" },
];
const r1 = rankCandidates(c1, prior, contact);
check("case1: resolution 'auto'", r1.resolution === "auto", `got ${r1.resolution}`);
check("case1: chosen is the Chicago/UChicago candidate", r1.chosen?.linkedinUrl === "u/chi", `chosen=${r1.chosen?.linkedinUrl}`);
check("case1: full ranked array (all 3, not truncated)", r1.ranked.length === 3, `len=${r1.ranked.length}`);
check("case1: Poland ranked LAST but present (not excluded)", r1.ranked[r1.ranked.length - 1].candidate.linkedinUrl === "u/pl", JSON.stringify(r1.ranked.map((x) => x.candidate.linkedinUrl)));
console.log(`   case1 scores: ${r1.ranked.map((x) => `${x.candidate.linkedinUrl}=${x.score}`).join(", ")}`);

// ── Case 2: two close candidates → 'ambiguous', full ranked array, order. ──
// Two Chicago people (both same_city+same_state+area_code), differing only in
// school/employer so scores are within GAP → ambiguous.
const c2 = [
  { name: "John Doe", linkedinUrl: "u/chiA", title: "Engineer", company: "Acme Corp", city: "Chicago", state: "IL", school: "DePaul" },
  { name: "John Doe", linkedinUrl: "u/chiB", title: "Engineer", company: "Northwestern Mutual", city: "Chicago", state: "IL", school: "University of Chicago" },
];
const r2 = rankCandidates(c2, prior, contact);
check("case2: resolution 'ambiguous'", r2.resolution === "ambiguous", `got ${r2.resolution}`);
check("case2: full ranked array returned (2)", r2.ranked.length === 2, `len=${r2.ranked.length}`);
check("case2: ranked desc by score", r2.ranked[0].score >= r2.ranked[1].score, JSON.stringify(r2.ranked.map((x) => x.score)));
check("case2: top is chiA (employer overlap) or chiB (school) — highest first", r2.ranked[0].score > 0, JSON.stringify(r2.ranked.map((x) => `${x.candidate.linkedinUrl}=${x.score}`)));
console.log(`   case2 scores: ${r2.ranked.map((x) => `${x.candidate.linkedinUrl}=${x.score}`).join(", ")}`);

// chiA: same_city(2)+same_state(1)+area(0.5)+employer(1.5)=5 ; chiB: same_city(2)+same_state(1)+area(0.5)+school(1.5)=5 → tie, both 5, gap 0 → ambiguous
check("case2: two 5.0 candidates tie → not auto (gap < 1.5)", r2.ranked[0].score === 5 && r2.ranked[1].score === 5, JSON.stringify(r2.ranked.map((x) => x.score)));

// ── Case 3: low-overlap 'Poland' candidate present but ranked last, kept. ──
const c3 = [
  { name: "John Doe", linkedinUrl: "u/pl", title: "Analyst", company: "Kowalski", city: "Warsaw", state: null, country: "PL" },
  { name: "John Doe", linkedinUrl: "u/chi", title: "Engineer", company: "Acme Corp", city: "Chicago", state: "IL", school: "University of Chicago" },
];
const r3 = rankCandidates(c3, prior, contact);
check("case3: low-overlap candidate NOT excluded (ranked array length 2)", r3.ranked.length === 2, `len=${r3.ranked.length}`);
check("case3: Poland is ranked last (score 0)", r3.ranked[1].candidate.linkedinUrl === "u/pl" && r3.ranked[1].score === 0, JSON.stringify(r3.ranked.map((x) => `${x.candidate.linkedinUrl}=${x.score}`)));
check("case3: Chicago candidate ranked first", r3.ranked[0].candidate.linkedinUrl === "u/chi", JSON.stringify(r3.ranked.map((x) => x.candidate.linkedinUrl)));

// ── Case 4: no candidates → 'none'. ──
const r4 = rankCandidates([], prior, contact);
check("case4: empty → resolution 'none'", r4.resolution === "none" && r4.ranked.length === 0, JSON.stringify(r4));

console.log(failed ? "\n❌ RANKER TEST FAILED" : "\n✅ RANKER TEST PASSED");
process.exit(failed ? 1 : 0);
