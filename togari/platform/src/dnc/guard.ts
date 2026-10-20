/**
 * DNC enforcement guard.
 *
 * Call `assertNotSuppressed(...)` before any outbound send (email, sequence,
 * dispatch). It throws `DncBlockedError` when the target is on the
 * do-not-contact list, and stays out of the way otherwise.
 *
 * Two deliberate safety properties:
 *   1. `DNC_ENFORCEMENT_ENABLED=false` turns the guard into a no-op (returns
 *      not-suppressed) so it can be disabled without a redeploy.
 *   2. FAIL-OPEN on infrastructure error: if BigQuery throws, we log LOUDLY
 *      and return not-suppressed, so a transient BQ blip never blocks every
 *      send in the system. (A stricter fail-closed mode can be added later
 *      behind its own flag if the risk profile changes.)
 *
 * `checkDncByEmail(...)` is the plain decision path the Clay flagship route
 * imports by name from "../../dnc".
 */

import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import { DncService } from "./service";
import type { DncCheckInput, DncDecision, DncMatch } from "./types";

const logger = createLogger("dnc/guard");

const NOT_SUPPRESSED: DncDecision = { suppressed: false, matches: [] };

/** Thrown when an outbound target is on the do-not-contact list. */
export class DncBlockedError extends Error {
  readonly matches: DncMatch[];
  constructor(reason: string | undefined, matches: DncMatch[]) {
    super(
      reason
        ? `Blocked by DNC: ${reason}`
        : "Blocked by DNC: target is on the do-not-contact list.",
    );
    this.name = "DncBlockedError";
    this.matches = matches;
  }
}

// ── Singleton service ─────────────────────────────────────────────

let _service: DncService | null = null;

function buildBqClient(): BigQueryClient {
  return new BigQueryClient(
    process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/** Lazily construct (and reuse) a DncService backed by a real BigQueryClient. */
export function getDncService(): DncService {
  if (!_service) {
    _service = new DncService({ bq: buildBqClient() });
  }
  return _service;
}

/** True unless DNC_ENFORCEMENT_ENABLED is explicitly "false". */
function enforcementEnabled(): boolean {
  return (process.env.DNC_ENFORCEMENT_ENABLED ?? "true") !== "false";
}

/**
 * Plain DNC decision for an email (and optionally its domain). Used by the
 * Clay flagship fan-out route. Honors the enforcement flag and fails open on
 * infrastructure error, same as the guard.
 */
export async function checkDncByEmail(
  input: { email: string; domain?: string },
  opts: { tenantId: string },
): Promise<DncDecision> {
  if (!enforcementEnabled()) return NOT_SUPPRESSED;
  try {
    return await getDncService().check(
      { email: input.email, domain: input.domain },
      opts,
    );
  } catch (err) {
    logger.error(
      "DNC check failed — FAILING OPEN (send allowed). Investigate BigQuery immediately.",
      err instanceof Error ? err : new Error(String(err)),
      { email: input.email, tenantId: opts.tenantId },
    );
    return NOT_SUPPRESSED;
  }
}

/**
 * Throw `DncBlockedError` when `input` resolves to a suppressed target.
 * No-op when enforcement is disabled; fail-open on infrastructure error.
 */
export async function assertNotSuppressed(
  input: DncCheckInput,
  opts: { tenantId: string },
): Promise<void> {
  if (!enforcementEnabled()) return;

  let decision: DncDecision;
  try {
    decision = await getDncService().check(input, opts);
  } catch (err) {
    logger.error(
      "DNC guard check failed — FAILING OPEN (send allowed). Investigate BigQuery immediately.",
      err instanceof Error ? err : new Error(String(err)),
      { tenantId: opts.tenantId },
    );
    return;
  }

  if (decision.suppressed) {
    throw new DncBlockedError(decision.reason, decision.matches);
  }
}
