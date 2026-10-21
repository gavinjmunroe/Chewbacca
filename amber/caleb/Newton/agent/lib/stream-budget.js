/**
 * stream-budget.js — per-turn timing budget for /api/v1/quick-call/stream.
 *
 * Why this exists (Tab 14, item 192): the stream route settles a "no-output"
 * timer (the run sent nothing, so report empty_response) and rides an absolute
 * hard cap so a silent run can't hold the socket forever. Those were a single
 * pair of constants (40s / 60s) tuned for the SLOWEST case — a calendar turn
 * that does a token refresh before its first segment. But a plain "what's 2+2"
 * turn never touches a tool and answers in ~2s; making it wait 40s before we
 * conclude "no reply" is the difference between a snappy product and a sluggish
 * one.
 *
 * This classifies the inbound text by the heaviest tool it is LIKELY to invoke
 * and returns a settle budget matched to that class. It is a heuristic on the
 * user's words, not a guarantee about which tools run, so the windows stay
 * conservative: the floor is comfortably above a fast model turn, and the cap
 * for tool turns stays where the old constants were. Worst case a
 * misclassified turn settles a little early or late; it never truncates a
 * reply that already arrived (a captured segment cancels the no-output timer
 * regardless of this budget).
 *
 * Pure and dependency-free for easy testing.
 */

/**
 * Heuristic turn classes, ordered slowest to fastest. The budgets below are
 * keyed on these.
 */
export const TURN_CLASS = Object.freeze({
  HEAVY_TOOL: "heavy_tool", // calendar write, web/deep research, multi-tool
  LIGHT_TOOL: "light_tool", // a quick read (reminders, contacts lookup)
  CONVERSATION: "conversation", // no tool expected, pure model turn
});

const HEAVY_PATTERNS = [
  /\b(schedul|calendar|meeting|invite|book|reschedul|availab)/i,
  /\bam i free\b/i,
  /\bfree (?:time|this|next|tomorrow|today|on|at)\b/i,
  /\b(research|look up|search the web|find out|google|latest|news)\b/i,
  /\b(email|inbox|draft|reply to|send (?:an? )?(?:email|message to))\b/i,
  /\b(drive|document|spreadsheet|sheet|doc|file)\b/i,
  /\b(deep dive|summari[sz]e|analy[sz]e|compare)\b/i,
];

const LIGHT_PATTERNS = [
  /\b(remind|reminder|todo|task)\b/i,
  /\b(who is|what'?s .*number|contact|phone|text|call)\b/i,
  /\b(remember when|do you remember|what did|recall)\b/i,
  /\b(weather|time in|timezone)\b/i,
];

/**
 * Classify a turn by the heaviest tool family its text is likely to invoke.
 *
 * @param {string} text
 * @returns {string} one of TURN_CLASS
 */
export function classifyTurn(text) {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return TURN_CLASS.CONVERSATION;
  for (const re of HEAVY_PATTERNS) if (re.test(t)) return TURN_CLASS.HEAVY_TOOL;
  for (const re of LIGHT_PATTERNS) if (re.test(t)) return TURN_CLASS.LIGHT_TOOL;
  return TURN_CLASS.CONVERSATION;
}

/**
 * Budget per class. `noOutputMs` is how long after dispatch resolves we wait
 * with zero captured output before concluding empty_response. `hardCapMs` is
 * the absolute ceiling. Invariant enforced by tests: hardCapMs > noOutputMs for
 * every class, and the heavy floor matches the historically-safe 40s/60s.
 */
const BUDGETS = Object.freeze({
  [TURN_CLASS.HEAVY_TOOL]: { noOutputMs: 40_000, hardCapMs: 60_000 },
  [TURN_CLASS.LIGHT_TOOL]: { noOutputMs: 22_000, hardCapMs: 40_000 },
  [TURN_CLASS.CONVERSATION]: { noOutputMs: 12_000, hardCapMs: 30_000 },
});

/**
 * Compute the settle budget for a turn from its inbound text.
 *
 * @param {string} text
 * @returns {{ turnClass: string, noOutputMs: number, hardCapMs: number }}
 */
export function computeStreamBudget(text) {
  const turnClass = classifyTurn(text);
  const b = BUDGETS[turnClass] || BUDGETS[TURN_CLASS.HEAVY_TOOL];
  return { turnClass, noOutputMs: b.noOutputMs, hardCapMs: b.hardCapMs };
}
