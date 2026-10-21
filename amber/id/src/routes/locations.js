/**
 * LOCATION ROUTES — where you are, where you want to be, and who you will run into.
 *
 *   GET    /v1/me/locations          — your own rows, uncoarsened, because they are yours
 *   POST   /v1/me/locations          — state one
 *   DELETE /v1/me/locations/:id      — retract one
 *   GET    /v1/me/map                — every dot you may see, already coarsened
 *   GET    /v1/me/map/overlaps       — who you will be in the same place as, and when
 *   GET    /v1/places/search?q=      — resolve what somebody typed into a real place
 *
 * THERE IS NO POST THAT TAKES COORDINATES. A location is chosen from `places`,
 * a table of named regions seeded before anybody stood in one. The client sends
 * a place_id it got from /v1/places/search, so the finest thing this API can be
 * told is the finest thing the seed contains, and "share my exact position" is
 * not a request it is possible to make.
 *
 * THE MAP IS COARSENED IN THE DATABASE. This file never sees a place its caller
 * was not allowed to see, so there is no filtering to get wrong here and no
 * ordering of statements that could leak one. See src/db/locations-store.js.
 *
 * Auth and owner resolution mirror cohorts.js (Privy JWT -> phone -> amber_id).
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import {
  listMyLocations,
  setLocation,
  removeLocation,
  mapFor,
  overlapsFor,
  searchPlaces,
  LOCATION_KINDS,
} from "../db/locations-store.js";
import { PRECISIONS } from "../lib/geo.js";

async function resolveOwner(request, reply) {
  if (!request.privyUser?.userId) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone ? await resolveAmberIdByPhone(phone).catch(() => null) : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

export function registerLocationRoutes(app, { requireAuth = defaultRequireAuth } = {}) {
  app.get("/v1/me/locations", { preHandler: [requireAuth] }, async (request, reply) => {
    const owner = await resolveOwner(request, reply);
    if (!owner) return;
    const locations = await listMyLocations(owner);
    // The vocabularies are returned with the list so a client builds its picker
    // from what the server actually accepts rather than from a hardcoded copy
    // that can fall behind. There is no 'exact' and there never will be.
    return { locations, count: locations.length, kinds: LOCATION_KINDS, precisions: PRECISIONS };
  });

  app.post("/v1/me/locations", { preHandler: [requireAuth] }, async (request, reply) => {
    const owner = await resolveOwner(request, reply);
    if (!owner) return;
    try {
      const id = await setLocation(owner, request.body ?? {});
      return { id, ok: true };
    } catch (err) {
      // Every throw from the store is a named client error; nothing here is a
      // 500 dressed as a 400, so an unnamed one is rethrown for the handler.
      const known = ["bad_place", "bad_kind", "bad_scope", "bad_dates", "no_owner"];
      if (!known.includes(err?.code)) throw err;
      reply.code(400).send({ error: err.code, message: err.message });
      return;
    }
  });

  app.delete("/v1/me/locations/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const owner = await resolveOwner(request, reply);
    if (!owner) return;
    const removed = await removeLocation(owner, request.params?.id);
    if (!removed) {
      reply.code(404).send({ error: "not_found", message: "No such location" });
      return;
    }
    return { ok: true };
  });

  app.get("/v1/me/map", { preHandler: [requireAuth] }, async (request, reply) => {
    const viewer = await resolveOwner(request, reply);
    if (!viewer) return;
    const at = request.query?.at ? new Date(String(request.query.at)) : new Date();
    if (Number.isNaN(at.getTime())) {
      reply.code(400).send({ error: "bad_at", message: "at must be a timestamp" });
      return;
    }
    // `all=1` drops the time filter entirely, for a map with a scrubber on it.
    const everything = String(request.query?.all ?? "") === "1";
    const dots = await mapFor(viewer, { at: everything ? null : at });
    return { dots, count: dots.length, at: everything ? null : at.toISOString() };
  });

  app.get("/v1/me/map/overlaps", { preHandler: [requireAuth] }, async (request, reply) => {
    const viewer = await resolveOwner(request, reply);
    if (!viewer) return;
    const days = Math.min(365, Math.max(1, Number(request.query?.days) || 90));
    const overlaps = await overlapsFor(viewer, { days });
    return { overlaps, count: overlaps.length, days };
  });

  app.get("/v1/places/search", { preHandler: [requireAuth] }, async (request, reply) => {
    const owner = await resolveOwner(request, reply);
    if (!owner) return;
    const q = String(request.query?.q ?? "").trim();
    // CANDIDATES, not a pick. An ambiguous match is a question for the person;
    // migration 008 put it best: missing someone beats filing them in the wrong
    // Austin.
    const places = await searchPlaces(q);
    return { places, count: places.length };
  });
}
