/**
 * DNC (do-not-contact) public surface.
 *
 * Import from "../../dnc" (adjust depth) rather than reaching into the
 * individual files:
 *
 *   import { checkDncByEmail, assertNotSuppressed, DncBlockedError } from "../../dnc";
 */

export type {
  DncCheckInput,
  DncMatch,
  DncDecision,
  DncSuppressionInput,
} from "./types";

export { DncService } from "./service";
export type { DncServiceOptions, DncTenantOpts } from "./service";

export {
  DncBlockedError,
  getDncService,
  assertNotSuppressed,
  checkDncByEmail,
} from "./guard";
