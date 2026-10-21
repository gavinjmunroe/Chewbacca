/**
 * Six-dimension ontology, barrel export.
 *
 * Import everything from one place:
 *   import { DIMENSIONS, isDimension, classify } from "./ontology/index.js";
 *
 * See dimensions.js for the const tuple and validators, classify.js for
 * the LLM-backed classifier. CLAUDE.md describes when to use which.
 */

export {
  DIMENSIONS,
  MASCULINE,
  FEMININE,
  isDimension,
  assertDimension,
} from "./dimensions.js";

export { classify, _resetCache } from "./classify.js";
