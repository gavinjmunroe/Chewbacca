/**
 * Newsletter doctrine: Shirley's 4 rules + the hostile-stranger critique rubric.
 *
 * Tab 12 of the 2026-05-28 Medha parallel-tabs dispatch.
 *
 * Source: Shirley Park editorial review of Sagar's "Ignoring the Hype Is Its
 * Own Kind of Edge" piece, 2026-05-27. After Tab 3 lands the shared
 * BMA_WRITING_DOCTRINE, SHIRLEY_RULES here switches to importing from
 * `../writing-doctrines/bma.js` so the 4-rule text never forks.
 */

/**
 * Shirley's 4 universal rules for every long-form piece, regardless of org.
 * Verbatim from Part 0.10 of the dispatch doc.
 */
export const SHIRLEY_RULES = [
  "SHIRLEY'S 4 RULES (editorial review 2026-05-27):",
  "1. Write from the author's perspective. First person, in their voice. Not Medha's voice.",
  "2. Every piece stands alone. No assumed BMA-insider context. A stranger reads it cold and follows from line one.",
  "3. If a story can't land fully, cut it. Never half-tell it.",
  "4. The argument is clear and compelling to a general audience. A smart outsider can say back what was argued.",
].join("\n");

/**
 * Critique rubric. A "hostile stranger" reads the draft and scores it 1-10
 * across four dimensions, each mapped to one of Shirley's rules.
 */
export const CRITIQUE_RUBRIC = [
  "You are a hostile-but-fair editor. Read this draft as if you have never",
  "heard of BMA, Sagar, Clay, AI tooling, or the people involved.",
  "",
  "Score the draft 1-10 on each dimension. Be strict. 8 is the bar for ship.",
  "",
  "- voice_match (rule 1): does this read as the named author's first-person",
  "  voice, with their cadence and tells? If it reads like an assistant",
  "  ghost-writing in generic AI voice, score it below 6.",
  "- stands_alone (rule 2): can a stranger follow the argument from line one,",
  "  without needing to know who BMA / Medha / Sagar are? Any assumed insider",
  "  context drops the score.",
  "- story_completeness (rule 3): is every story told fully or cut entirely?",
  "  Half-told anecdotes (named without payoff, or hinted-at without scene)",
  "  must score low. Cutting a story counts as a 10 for this dimension.",
  "- argument_clarity (rule 4): could a smart outsider say back the argument",
  "  in one sentence? If the piece has no central claim, score it below 5.",
  "",
  "Also list 0-5 line-level fixes. Each fix MUST be concrete: a specific",
  "before/after rewrite tied to one rule. Vague advice is not allowed.",
  "",
  "Return strict JSON, no prose, no code fences:",
  "{",
  '  "scores": {',
  '    "voice_match": <int 1-10>,',
  '    "stands_alone": <int 1-10>,',
  '    "story_completeness": <int 1-10>,',
  '    "argument_clarity": <int 1-10>',
  "  },",
  '  "line_level_fixes": [',
  "    {",
  '      "before": "<exact line from draft>",',
  '      "after": "<rewrite>",',
  '      "reason": "<which rule + one-sentence why>"',
  "    }",
  "  ],",
  '  "what_to_cut": ["<half-told story or assumed-context paragraph to remove>"]',
  "}",
].join("\n");

/**
 * Minimum score per dimension. The dispatch decision (Q7) locked this at 8
 * for strict mode. Anything lower triggers a revision.
 */
export const MIN_PASS_SCORE = 8;

/**
 * Maximum revisions before we give up and emit best-of-N. Per the dispatch
 * doc's "no confirmation prompts" rule, we never ask the user; we ship.
 */
export const MAX_REVISIONS = 2;

/**
 * Builds the system prompt for the initial draft pass. Feeds the voice card,
 * Shirley's rules, and the section target word count into Sonnet 4.6.
 */
export function DRAFT_SYSTEM_PROMPT_TEMPLATE({
  voiceCard,
  targetWords,
  format,
}) {
  const wordTarget = targetWords
    ? `Target length: ${targetWords} words (hard cap).`
    : "Target length: tight. Cut everything that doesn't earn its place.";
  const formatLine = format
    ? `Output format: ${format}.`
    : "Output format: plain prose, no headers, no lists.";

  return [
    "You are ghost-writing for a named author. You are NOT Medha. You are NOT",
    "an assistant. You are the author. Your voice for this draft is THEIR",
    "voice, not yours.",
    "",
    SHIRLEY_RULES,
    "",
    "AUTHOR VOICE CARD:",
    voiceCard,
    "",
    wordTarget,
    formatLine,
    "",
    "Write the piece. No preamble, no meta-commentary, no 'here is the draft'.",
    "Just the piece. First word of your output is the first word of the draft.",
  ].join("\n");
}

/**
 * Builds the revision prompt. Feeds the previous draft + the critique JSON
 * back into Sonnet 4.6 and asks for a focused fix pass.
 */
export function REVISION_PROMPT_TEMPLATE({ draft, critiqueJson, voiceCard }) {
  return [
    "You wrote a draft. An editor scored it. Now revise.",
    "",
    SHIRLEY_RULES,
    "",
    "AUTHOR VOICE CARD:",
    voiceCard,
    "",
    "YOUR PREVIOUS DRAFT:",
    draft,
    "",
    "EDITOR CRITIQUE (JSON):",
    JSON.stringify(critiqueJson, null, 2),
    "",
    "Rewrite. Apply every line-level fix verbatim where the editor gave one.",
    "For dimensions scored below 8, restructure that aspect of the draft.",
    "For items in what_to_cut, remove them entirely; do not try to salvage.",
    "Stay in the author's voice. Stay under the original word budget.",
    "",
    "Output only the revised piece. No preamble.",
  ].join("\n");
}

/**
 * Returns true if every dimension scored >= MIN_PASS_SCORE.
 */
export function critiquePasses(critique) {
  if (!critique || typeof critique !== "object") return false;
  const s = critique.scores;
  if (!s || typeof s !== "object") return false;
  const dims = [
    "voice_match",
    "stands_alone",
    "story_completeness",
    "argument_clarity",
  ];
  return dims.every((d) => Number(s[d]) >= MIN_PASS_SCORE);
}
