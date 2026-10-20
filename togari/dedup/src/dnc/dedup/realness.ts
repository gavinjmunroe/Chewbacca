/**
 * Realness classifier — entry point used by WS-1 (matcher) and WS-3 (apple-sync).
 *
 * Decides whether a UnifiedContact describes a real individual person (true) or
 * an organization, role account, bot, or throwaway (false). Result is persisted
 * to togari_dnc.contacts as is_real_person + realness_score + realness_reason.
 *
 * Pipeline:
 *   1. Run heuristics (free, sync). If the score is clear-cut (outside the
 *      [30, 70] band) return immediately.
 *   2. If ambiguous, call Claude Haiku for a tighter verdict.
 *   3. Verdict: is_real = score >= 60.
 *
 * Cost guard: the Haiku call only fires for ambiguous cases. Clear-cut
 * heuristic results never hit the network.
 */

import type { UnifiedContact, RealnessVerdict } from "../types/index.js";
import {
  runHeuristics,
  isClearCut,
  type HeuristicResult,
} from "./realness.heuristics.js";
import { classifyWithHaiku, type HaikuClassifier } from "./realness.haiku.js";

/**
 * Internal options. The plan-spec public signature is
 *   classifyRealness(contact: UnifiedContact): Promise<RealnessVerdict>
 * but accepting an optional injected Haiku classifier here lets the test suite
 * verify the cost guard without making real network calls. Callers in
 * production should pass nothing.
 */
export interface ClassifyOptions {
  haiku?: HaikuClassifier;
}

function verdictFromHeuristic(h: HeuristicResult): RealnessVerdict {
  return {
    is_real: h.score >= 60,
    score: h.score,
    reason: `heuristic: ${h.reason}`,
  };
}

/**
 * Classify whether a contact describes a real individual person.
 *
 * Always returns a verdict — never throws on Haiku failure. If the Haiku
 * escalation errors out, the heuristic score is returned with the error
 * appended to the reason so callers can still persist a deterministic value.
 */
export async function classifyRealness(
  contact: UnifiedContact,
  opts: ClassifyOptions = {},
): Promise<RealnessVerdict> {
  const heuristic = runHeuristics(contact);

  if (isClearCut(heuristic.score)) {
    return verdictFromHeuristic(heuristic);
  }

  const haiku = opts.haiku ?? classifyWithHaiku;

  try {
    const verdict = await haiku(contact);
    return {
      is_real: verdict.is_real,
      score: verdict.score,
      reason: `haiku: ${verdict.reason}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      is_real: heuristic.score >= 60,
      score: heuristic.score,
      reason: `heuristic-fallback (haiku error: ${msg}): ${heuristic.reason}`,
    };
  }
}
