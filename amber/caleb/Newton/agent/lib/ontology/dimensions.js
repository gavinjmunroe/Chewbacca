/**
 * Six-dimension ontology, single source of truth.
 *
 * Every durable signal Medha captures is tagged with one of these six
 * health dimensions. The ontology is load-bearing: tools, ingest pipelines,
 * calendar sub-calendars, and wiki dimension pages all key off these exact
 * strings. See CLAUDE.md "Six-dimension ontology" for the canonical
 * description and the four files that must update together if a seventh
 * dimension is ever added.
 */

export const DIMENSIONS = Object.freeze([
  "spiritual",
  "emotional",
  "physical",
  "financial",
  "intellectual",
  "social",
]);

// Structural / outward dimensions.
export const MASCULINE = Object.freeze(["financial", "intellectual", "social"]);

// Vital / inward dimensions.
export const FEMININE = Object.freeze(["spiritual", "emotional", "physical"]);

const DIMENSION_SET = new Set(DIMENSIONS);

export function isDimension(s) {
  return typeof s === "string" && DIMENSION_SET.has(s);
}

export function assertDimension(s) {
  if (!isDimension(s)) {
    throw new Error(
      `invalid dimension: ${JSON.stringify(s)} (expected one of ${DIMENSIONS.join(", ")})`,
    );
  }
  return s;
}
