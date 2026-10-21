/**
 * Cross-user public reads, gated by the F4a privacy policy engine.
 *
 *   GET /v1/users/:amberId/profile → the owner's profile filtered for the caller
 *   GET /v1/users/:amberId/network → the owner's contacts (baseline-only) when
 *                                    the caller is a sharing mutual; else []
 *
 * All routes require auth; the caller's amber_id is resolved the same way the
 * other /v1/me routes do (privyUser.phone → resolveAmberIdByPhone). Field
 * visibility is decided ENTIRELY by field-policy.js (default-deny): a non-self
 * viewer never receives phone/email/notes/enrichment of another user.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  resolveAmberIdByPhone,
  getUserProfileByAmberId,
  getUserProfileExtraByAmberId,
  getUserPhoneByAmberId,
  listContactsForOwnerAppShape,
} from "../db/store.js";
import { getViewerContext } from "../privacy/viewer-context.js";
import { filterForViewer } from "../privacy/field-policy.js";

const _UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveOwner(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone
    ? await resolveAmberIdByPhone(phone).catch(() => null)
    : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

// Drop null/undefined so a permitted viewer never receives empty scaffolding.
function _compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v != null) out[k] = v;
  return out;
}

/**
 * Assemble the owner's policy-relevant profile (baseline + contact fields) and
 * return the subset the viewer may see. Returns null when the owner has no
 * profile row (→ 404); otherwise the (possibly empty {}) filtered object.
 * Exported so the route stays thin and the logic is testable without HTTP.
 */
export async function getVisibleProfile(viewerId, ownerId) {
  const base = await getUserProfileByAmberId(ownerId);
  if (!base) return null;
  const [extra, phone, ctx] = await Promise.all([
    getUserProfileExtraByAmberId(ownerId).catch(() => ({})),
    getUserPhoneByAmberId(ownerId).catch(() => null),
    getViewerContext(viewerId, ownerId),
  ]);
  const ex = extra || {};
  const profile = _compact({
    // baseline
    name: base.name,
    username: base.username,
    occupation: base.occupation,
    city: base.currentCity,
    hometown: base.hometown,
    school: base.school,
    avatar_url: base.avatarUrl,
    bio: base.bio,
    linkedin_url: ex.linkedinUrl ?? ex.linkedin_url ?? null,
    twitter_url: ex.twitterUrl ?? ex.twitter_url ?? null,
    website: ex.website ?? null,
    // contact_method (only ever returned to the owner themselves)
    phone,
    email: ex.email ?? null,
  });
  return filterForViewer(profile, { viewerId, ownerId, ...ctx });
}

/**
 * The owner's contacts as a baseline-only network view. [] unless the caller is
 * a connected + sharing mutual. Each contact is passed through filterForViewer,
 * so name/company/title/city/linkedin show and phone/email/notes/enrichment are
 * stripped. Exported for the same reason as getVisibleProfile.
 */
export async function getVisibleNetwork(viewerId, ownerId) {
  const ctx = await getViewerContext(viewerId, ownerId);
  // DELIBERATELY STRICTER THAN canView, and not an oversight.
  //
  // A circle or cohort membership now opens the owner's baseline profile
  // fields, because being put in an audience is the owner saying "this person
  // may know things about me". This is a different grant: the owner's whole
  // CONTACT LIST. Being in somebody's derived Stanford cohort must not hand
  // over everyone else they know, and a cohort is derived -- nobody reviewed
  // that membership one by one. So this stays on the explicit
  // connected-and-sharing gate.
  if (!(ctx.connected && ctx.ownerShares)) return [];
  const contacts = await listContactsForOwnerAppShape(ownerId);
  return contacts.map((c) => filterForViewer(c, { viewerId, ownerId, ...ctx }));
}

export function registerPublicProfileRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── GET /v1/users/:amberId/profile ────────────────────────────────────────
  app.get(
    "/v1/users/:amberId/profile",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const viewerId = await resolveOwner(request, reply);
      if (!viewerId) return;
      const ownerId = String(request.params.amberId || "");
      if (!_UUID_RE.test(ownerId)) {
        return reply.code(400).send({ error: "invalid_amber_id" });
      }
      const profile = await getVisibleProfile(viewerId, ownerId);
      if (profile === null) {
        return reply.code(404).send({ error: "not_found" });
      }
      return { profile };
    },
  );

  // ── GET /v1/users/:amberId/network ─────────────────────────────────────────
  app.get(
    "/v1/users/:amberId/network",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const viewerId = await resolveOwner(request, reply);
      if (!viewerId) return;
      const ownerId = String(request.params.amberId || "");
      if (!_UUID_RE.test(ownerId)) {
        return reply.code(400).send({ error: "invalid_amber_id" });
      }
      const contacts = await getVisibleNetwork(viewerId, ownerId);
      return { contacts };
    },
  );
}
