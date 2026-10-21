/**
 * HOW WELL AMBER KNOWS THE OWNER, DIMENSION BY DIMENSION.
 *
 *   GET /v1/me/dimensions → { dimensions: [{code,label,score,evidence,facts,questions}], summary }
 *
 * Owner-scoped and read-only: nothing here accepts an owner id from the body or
 * the path, and there is no write route. The only thing that writes coverage is
 * living your life through the app -- self-facts as you state them, and the
 * dimensions of the questions you ask, recorded off the retrieval path.
 *
 * THE CARD THIS FEEDS SAYS "KNOWN", NEVER "GOOD". The numbers describe Amber's
 * read on somebody, not the somebody. See the long note at the top of
 * src/db/self-dimensions.js for why that distinction is not decoration.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone as defaultResolveAmberIdByPhone } from "../db/store.js";
import {
  getSelfDimensionCoverage,
  coverageSummary,
  KNOWN_AT,
} from "../db/self-dimensions.js";

export function registerSelfDimensionRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone = deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const coverage = deps.getSelfDimensionCoverage || getSelfDimensionCoverage;

  app.get("/v1/me/dimensions", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return;
    }
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({ error: "no_phone_on_session", message: "Session carries no phone." });
      return;
    }
    const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
    if (!amberId) {
      reply
        .code(400)
        .send({ error: "could_not_resolve_owner", message: "Could not resolve owner." });
      return;
    }

    /**
     * A FAILURE HERE IS SIX ZEROS, NOT A 500.
     *
     * Unlike a contact list, this card is decoration on a screen full of other
     * things. Somebody whose coverage query times out should see an unfilled
     * radar on an otherwise working profile, not a profile that refuses to
     * render. The store already degrades this way; this is the belt.
     */
    try {
      const dimensions = await coverage(amberId);
      return { dimensions, summary: coverageSummary(dimensions), knownAt: KNOWN_AT };
    } catch (e) {
      request.log?.warn?.(`SELF_DIMENSIONS_ROUTE_ERR ${e?.message || e}`);
      const dimensions = await coverage(null);
      return { dimensions, summary: coverageSummary(dimensions), knownAt: KNOWN_AT };
    }
  });
}
