/**
 * The Six Dimensions of Health — Amber's canonical ontology.
 *
 * Mirror of Newton/agent/lib/health.js. Never invent new dimensions. Never
 * rename. Never merge. See amber-id/ARCHITECTURE-SIX-DIMENSIONS.md.
 */

export const DIMENSIONS = Object.freeze([
  "spiritual",
  "emotional",
  "physical",
  "intellectual",
  "social",
  "financial",
]);

export const DIMENSION_META = Object.freeze({
  spiritual:    { color: "purple", gender: "feminine" },
  emotional:    { color: "red",    gender: "feminine" },
  physical:     { color: "green",  gender: "feminine" },
  intellectual: { color: "orange", gender: "masculine" },
  social:       { color: "blue",   gender: "masculine" },
  financial:    { color: "teal",   gender: "masculine" },
});

export const CROSS_DIMENSION = "*";

const VALID_SET = new Set([...DIMENSIONS, CROSS_DIMENSION]);

export function isValidDimension(d) {
  return typeof d === "string" && VALID_SET.has(d);
}

/**
 * Throws if `d` is not a recognized dimension (or "*").
 * Used at every ingestion boundary.
 */
export function assertDimension(d, { field = "health_dimension" } = {}) {
  if (!isValidDimension(d)) {
    const err = new Error(
      `${field} must be one of [${DIMENSIONS.join(", ")}, "*"] — got ${JSON.stringify(d)}`
    );
    err.statusCode = 400;
    err.code = "invalid_dimension";
    throw err;
  }
  return d;
}

/**
 * Trust score by ingest pipe. These feed /ask retrieval ranking — see
 * ARCHITECTURE-SIX-DIMENSIONS.md. A check-in at 1.00 will outrank a
 * scraped LinkedIn note at 0.65 for the same query.
 */
export const PIPE_TRUST = Object.freeze({
  agent:        0.65,
  health:       0.95,
  checkin:      1.00,
  relationship: 0.50,
});

export function trustForPipe(pipe) {
  return PIPE_TRUST[pipe] ?? 0.50;
}
