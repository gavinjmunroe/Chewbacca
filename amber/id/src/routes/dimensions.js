/**
 * Dimensions route — exposes the canonical six-dimension ontology to clients
 * (iOS, web, visionOS) so they never hardcode the names, colors, or order.
 *
 * The source of truth is `src/lib/dimensions.js`. Mutations to that module
 * automatically ripple to every interface via this endpoint.
 *
 * Public route (no auth) because the ontology is not user-specific. We still
 * cache aggressively at the CDN level via Cache-Control.
 */

import { DIMENSIONS, DIMENSION_META } from "../lib/dimensions.js";

const DESCRIPTIONS = Object.freeze({
  spiritual: "Purpose, faith, alignment, inner peace, mindfulness.",
  emotional: "Mood, regulation, distress signals, peace.",
  physical: "Energy, sleep, movement, nutrition, rest.",
  intellectual: "Learning, curiosity, mental engagement, growth.",
  social: "Connection quality, community, belonging, relationships.",
  financial: "Career momentum, stability, professional networking, abundance.",
});

// Tailwind-safe hex equivalents of the named colors used across Amber UIs.
const COLOR_HEX = Object.freeze({
  purple: "#a78bfa",
  red: "#f87171",
  green: "#4ade80",
  orange: "#ff9420",
  blue: "#60a5fa",
  teal: "#2dd4bf",
});

export function registerDimensionsRoutes(app) {
  /**
   * GET /v1/dimensions
   *
   * Returns the canonical six-dimension ontology. Stable, public, cacheable.
   *
   * Response shape:
   * {
   *   dimensions: [
   *     {
   *       key: "spiritual" | ...,
   *       label: "Spiritual" | ...,
   *       color: "purple" | ...,
   *       colorHex: "#a78bfa" | ...,
   *       hemisphere: "feminine" | "masculine",
   *       description: string
   *     }
   *   ]
   * }
   */
  app.get("/v1/dimensions", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");

    const dimensions = DIMENSIONS.map((key) => {
      const meta = DIMENSION_META[key];
      return {
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        color: meta.color,
        colorHex: COLOR_HEX[meta.color] || null,
        hemisphere: meta.gender,
        description: DESCRIPTIONS[key],
      };
    });

    return { dimensions };
  });
}
