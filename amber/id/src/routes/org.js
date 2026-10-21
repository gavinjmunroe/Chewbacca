/**
 * ORG ROUTES — enrolling a company, and running it.
 *
 *   POST   /v1/org                                   enrol; caller becomes admin
 *   GET    /v1/org/me                                who am I here, and what is the ceiling
 *   GET    /v1/org/members                           the roster
 *   PATCH  /v1/org/members/:amberId                  role / status            (admin)
 *   DELETE /v1/org/members/:amberId                  off the roster           (admin)
 *   GET    /v1/org/groups                            groups + member counts
 *   POST   /v1/org/groups                                                     (admin)
 *   DELETE /v1/org/groups/:groupId                                            (admin)
 *   GET    /v1/org/groups/:groupId/members
 *   POST   /v1/org/groups/:groupId/members                                    (admin)
 *   DELETE /v1/org/groups/:groupId/members/:amberId                           (admin)
 *   GET    /v1/org/policy                            the ceiling, complete
 *   PUT    /v1/org/policy                                                     (admin)
 *   GET    /v1/org/invites                           outstanding              (admin)
 *   POST   /v1/org/invites                           issue one                (admin)
 *   DELETE /v1/org/invites/:inviteId                 revoke                   (admin)
 *
 * NO ROUTE HERE TAKES AN org_id. The company a caller is acting in comes from
 * their membership row, resolved once by resolveActor, and nothing a client
 * sends can change it. An org_id in a path or a body would be a parameter an
 * attacker gets to choose, and every one of these handlers would have to be the
 * place that checks it -- which is the shape of bug this file was written to
 * make impossible rather than to catch.
 *
 * ACCEPTING AN INVITE AND SIGNING IN BY EMAIL ARE NOT HERE. They are the two
 * things a person does BEFORE they have a session, so they live in org-auth.js
 * with no requireAuth on them.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  makeResolveActor,
  requireOrgAdmin,
  requireOrgMember,
} from "../lib/resolve-actor.js";
import {
  createOrganization,
  getOrganizationById,
  updateOrganization,
  getPolicy,
  listGroups,
  listGroupMembers,
  listGroupsForMember,
  listMembers,
  listOrgShares,
  createGroup,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  setMemberRole,
  setMemberStatus,
  removeMember,
  setPolicyEntry,
  setGroupPosition,
  setGroupOrder,
  setGroupPinned,
  linkGroups,
  updateGroupLink,
  unlinkGroups,
  listGroupLinks,
} from "../db/org-store.js";
import { createInvite, listInvites, revokeInvite, rotateInviteToken } from "../db/org-invite-store.js";
import { emailConfigured, sendEmail, sendingDomain, webBaseUrl } from "../lib/email-delivery.js";
import { companyReach } from "../db/org-audience-store.js";
import { CLASSIFICATIONS, permittedScopes } from "../lib/org-scopes.js";
import { ID_FIELDS, blankToNull } from "../lib/empty-uuid.js";
import { openTenantScope } from "../db/tenant.js";
import { signSessionToken } from "../lib/amber-jwt.js";
import { webSessionScopeFor } from "../lib/token-scope.js";
import { hasPublicBaseUrl, publicBaseUrl } from "../oauth/lib/public-url.js";

/** Map a store refusal to a status code. Unknown reasons are 400, never 500. */
const REASON_STATUS = new Map([
  ["already_in_org", 409],
  ["slug_taken", 409],
  ["group_name_taken", 409],
  ["last_admin_or_missing", 409],
  ["not_a_member", 409],
  ["write_failed", 503],
  ["accept_failed", 503],
  ["already_invited", 409],
  ["wrong_domain", 422],
]);

function refuse(reply, reason, message) {
  return reply.code(REASON_STATUS.get(reason) ?? 400).send({ error: reason, message });
}

export function registerOrgRoutes(app, { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {}) {
  /*
   * BLANK IDS BECOME NULL BEFORE ANYTHING READS THEM.
   *
   * Sat in front of the schema rather than inside each handler, because the
   * handler that forgets is the one that 500s, and "every handler remembers"
   * is not a property a codebase has, it is one it has so far.
   */
  const tidyIds = async (request) => {
    blankToNull(request.body, ID_FIELDS);
    blankToNull(request.query, ID_FIELDS);
  };

  const asMember = {
    preHandler: [tidyIds, requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };
  const asAdmin = {
    preHandler: [tidyIds, requireAuth, resolveActor, requireOrgAdmin, openTenantScope],
  };

  /**
   * ENROL A COMPANY. The caller becomes its first admin.
   *
   * Refused for an account that is already in one, which is the instance rule
   * the database also enforces: a second company is a second account.
   */
  app.post("/v1/org", { preHandler: [requireAuth, resolveActor] }, async (request, reply) => {
    if (request.actor.kind === "org") {
      return refuse(reply, "already_in_org", "This account already belongs to an organization.");
    }
    const { name, slug, emailDomain, restrictDomain, description, website, linkedinUrl } =
      request.body ?? {};
    const result = await createOrganization({
      name,
      slug,
      emailDomain,
      restrictDomain,
      description,
      website,
      linkedinUrl,
      createdBy: request.amberId,
    });
    if (!result.ok) return refuse(reply, result.reason, "Could not create the organization.");
    return reply.code(201).send({ org: result.org, role: "admin", ...reissued(request) });
  });

  /**
   * THE COMPANY'S OWN SETTINGS. Admin only.
   *
   * `emailDomain` IS NOW AN AUTO-JOIN, and this comment used to say the
   * opposite. Claiming a domain means anybody signing in from it becomes a
   * member of this company -- which is what claiming a domain means
   * everywhere else, and what people expect. Before that, signing up created
   * an account in no workspace at all and the product was empty for them.
   *
   * `restrictDomain` narrows the other direction: with it on, createInvite
   * refuses an address OUTSIDE the domain, so nobody can be invited in from
   * a personal address.
   *
   * A personal domain can never be claimed. One company setting gmail.com
   * would otherwise swallow every consumer signup on the platform.
   */
  app.patch(
    "/v1/org",
    {
      ...asAdmin,
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            emailDomain: { type: ["string", "null"], maxLength: 180 },
            restrictDomain: { type: "boolean" },
            description: { type: ["string", "null"], maxLength: 2000 },
            website: { type: ["string", "null"], maxLength: 500 },
            linkedinUrl: { type: ["string", "null"], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const out = await updateOrganization({
        orgId: request.actor.orgId,
        ...request.body,
      });
      if (!out.ok) {
        return refuse(
          reply,
          out.reason,
          out.reason === "domain_required"
            ? "Set the company's email domain before restricting joins to it."
            : "Could not save those settings.",
        );
      }
      return { org: out.org };
    },
  );

  /**
   * EVERYTHING THE SHARE SHEET NEEDS, IN ONE REQUEST.
   *
   * The roster, the groups, and WHICH PEOPLE ARE IN WHICH GROUP. That last
   * part is the whole reason this exists: without it the picker can show
   * somebody a list of group names and no idea how many humans are behind
   * them, so "share with the founding team" is a decision made blind. With
   * it the sheet can say "4 of 9 people" and update as chips are toggled,
   * including for a file that has not been uploaded yet and therefore has no
   * row to ask the server about.
   *
   * Member-visible, not admin-only: every member can already read the roster
   * and each group's members through the existing routes. This is those two
   * answers in one round trip instead of one per group.
   */
  app.get("/v1/org/audience-options", asMember, async (request) => {
    const orgId = request.actor.orgId;
    const [members, groups] = await Promise.all([
      listMembers(orgId).catch(() => []),
      listGroups(orgId).catch(() => []),
    ]);
    const active = members.filter((m) => m.status === "active");

    const withMembers = await Promise.all(
      groups.map(async (g) => ({
        id: g.id,
        name: g.name,
        memberIds: (await listGroupMembers({ orgId, groupId: g.id }).catch(() => []))
          .map((m) => String(m.amberId)),
      })),
    );

    return {
      people: active.map((m) => ({
        id: String(m.amberId),
        name: m.fullName || m.email || "Unnamed",
      })),
      groups: withMembers,
    };
  });

  /**
   * WHAT EVERY PERSON IN THIS COMPANY CAN ACTUALLY SEE.
   *
   * THE BUG CLASS THIS CLOSES IS "IT WORKS ON MINE", and it is the most
   * expensive one this product has, because nothing errors. The author of an
   * item is always in its audience and is never stored as a row, so the person
   * who shares something is the one person guaranteed to see it. They share,
   * look at their own screen, see it, and conclude it worked. Their team opens
   * the same drive and it is not there. Nobody finds out until somebody says
   * "what file?" in a meeting weeks later.
   *
   * A row here reading "Maya — 0 of 41 files" is that entire bug report,
   * visible before Maya has to write it.
   *
   * COUNTS ONLY, AND THAT IS NOT A HEDGE. An admin can already read the
   * roster; knowing how many things somebody can see says nothing about what
   * any of them are. This is a smoke alarm, not the admin override the model
   * deliberately does not have.
   */
  app.get("/v1/org/reach", asAdmin, async (request) => {
    const rows = await companyReach({ orgId: request.actor.orgId });
    return {
      members: rows.map((r) => ({
        amberId: r.amber_id,
        name: r.name,
        role: r.role,
        files: { visible: r.files_visible, total: r.files_total },
        pages: { visible: r.pages_visible, total: r.pages_total },
        posts: { visible: r.posts_visible, total: r.posts_total },
      })),
    };
  });

  /**
   * WHAT THIS DEPLOYMENT CAN ACTUALLY DO, for the admin who has to fix it.
   *
   * Both of the doors a company needs fail SILENTLY by design: the Google
   * button hides itself rather than leading somebody to "not configured", and
   * an invitation is created and then quietly not delivered. Each of those is
   * the right behavior for the person signing in and a dead end for the
   * person who has to turn it on -- "I still don't see Continue with Google"
   * has no answer anywhere in the product.
   *
   * ADMIN ONLY, AND IT CARRIES NO SECRETS: the names of unset variables and a
   * sending domain, never a value. What is set is reported as a boolean.
   */
  app.get("/v1/org/setup", asAdmin, async () => {
    const googleId = Boolean(process.env.GOOGLE_SIGNIN_CLIENT_ID);
    const googleSecret = Boolean(process.env.GOOGLE_SIGNIN_CLIENT_SECRET);
    const apiBase = (process.env.AMBER_API_BASE_URL || "").replace(/\/+$/, "");

    return {
      google: {
        ready: googleId && googleSecret && Boolean(apiBase),
        missing: [
          googleId ? null : "GOOGLE_SIGNIN_CLIENT_ID",
          googleSecret ? null : "GOOGLE_SIGNIN_CLIENT_SECRET",
          apiBase ? null : "AMBER_API_BASE_URL",
        ].filter(Boolean),
        // The URI Google itself has to be told about. Getting this wrong is
        // the other half of "the button does nothing".
        callbackUrl: apiBase ? `${apiBase}/v1/org/auth/google/callback` : null,
      },
      /*
       * CALENDAR SYNC IS A DIFFERENT OAUTH CLIENT FROM SIGN-IN, and that
       * has cost real time: sign-in uses GOOGLE_SIGNIN_* with
       * AMBER_API_BASE_URL, calendars use GOOGLE_OAUTH_* against the same
       * AMBER_API_BASE_URL, and they have different callback PATHS. A
       * redirect_uri_mismatch means Google has not been told about the exact
       * string below -- so the exact string is reported rather than
       * described, because "add the callback URL" is the instruction
       * everybody follows and still gets wrong by a trailing slash.
       */
      calendars: ["google", "microsoft"].map((provider) => {
        const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
        const id = Boolean(process.env[`${prefix}_OAUTH_CLIENT_ID`]);
        const secret = Boolean(process.env[`${prefix}_OAUTH_CLIENT_SECRET`]);
          const pub = hasPublicBaseUrl() ? publicBaseUrl() : "";
        return {
          provider,
          ready: id && secret && Boolean(pub),
          missing: [
            id ? null : `${prefix}_OAUTH_CLIENT_ID`,
            secret ? null : `${prefix}_OAUTH_CLIENT_SECRET`,
            pub ? null : "AMBER_API_BASE_URL",
          ].filter(Boolean),
          callbackUrl: pub ? `${pub}/v1/oauth/${provider}/callback` : null,
        };
      }),

      email: {
        ready: emailConfigured(),
        missing: process.env.RESEND_API_KEY ? [] : ["RESEND_API_KEY"],
        sendingDomain: sendingDomain(),
      },
    };
  });

  /**
   * THE CONTEXT EVERY ORG SCREEN LOADS FIRST.
   *
   * Answers for an individual too -- `{ org: null }` -- because the website
   * cannot know which fork it is rendering until it asks, and a 403 here would
   * make "I am not in a company" look like an error.
   */
  /*
   * THE CONSOLE'S FIRST REQUEST, and it reads the policy and the roster --
   * both policied tables -- so it needs a scope like every other org route.
   * It cannot use `asMember`, because an account with no company must get an
   * answer here rather than a 403: that answer is what sends them to /org/new.
   */
  app.get(
    "/v1/org/me",
    { preHandler: [requireAuth, resolveActor, openTenantScope] },
    async (request) => {
    const { actor } = request;
    if (actor.kind !== "org") return { org: null, kind: "individual" };
    const [groups, policy, roster, org] = await Promise.all([
      listGroupsForMember({ orgId: actor.orgId, amberId: actor.amberId }),
      getPolicy(actor.orgId),
      listMembers(actor.orgId).catch(() => []),
      getOrganizationById(actor.orgId).catch(() => null),
    ]);
    const me = roster.find((m) => String(m.amberId) === String(actor.amberId)) ?? null;
    return {
      kind: "org",
      // WHO THE CALLER IS, which the console needs in order to tell their own
      // page from somebody else's. It is not a capability -- it is the answer
      // to a question the caller already knows -- and without it the client
      // guesses, which is how an Edit button appears on a post you cannot edit.
      amberId: actor.amberId,
      profile: me ? { title: me.title, location: me.location, bio: me.bio } : null,
      org: {
        id: actor.orgId,
        name: actor.orgName,
        // The domain rule, so the settings screen can render its own state
        // rather than a toggle that always starts off.
        emailDomain: org?.emailDomain ?? null,
        restrictDomain: org?.restrictDomain === true,
        /*
         * The profile, so the console can tell a company that has been set up
         * from one that has not. A setup flow that cannot see whether setup
         * happened either runs twice or never runs at all.
         */
        description: org?.description ?? null,
        website: org?.website ?? null,
        linkedinUrl: org?.linkedinUrl ?? null,
      },
      role: actor.orgRole,
      status: actor.orgStatus,
      groups,
      policy,
      // What this member may actually pick, per classification. Saves the
      // client reimplementing the ladder and getting it subtly different.
      permittedScopes: Object.fromEntries(
        CLASSIFICATIONS.map((c) => [c, permittedScopes(policy, c)]),
      ),
    };
    },
  );

  app.get("/v1/org/members", asMember, async (request) => {
    const members = await listMembers(request.actor.orgId);
    return { members, count: members.length };
  });

  app.patch("/v1/org/members/:amberId", asAdmin, async (request, reply) => {
    const orgId = request.actor.orgId;
    const amberId = String(request.params.amberId || "");
    const { role, status } = request.body ?? {};
    if (role) {
      const out = await setMemberRole({ orgId, amberId, role });
      if (!out.ok) return refuse(reply, out.reason, "Could not change that role.");
    }
    if (status) {
      const out = await setMemberStatus({ orgId, amberId, status });
      if (!out.ok) return refuse(reply, out.reason, "Could not change that status.");
    }
    if (!role && !status) return refuse(reply, "nothing_to_change", "Send a role or a status.");
    return { ok: true };
  });

  app.delete("/v1/org/members/:amberId", asAdmin, async (request, reply) => {
    const out = await removeMember({
      orgId: request.actor.orgId,
      amberId: String(request.params.amberId || ""),
    });
    if (!out.ok) return refuse(reply, out.reason, "Could not remove that member.");
    return { ok: true };
  });

  /**
   * WHAT HAS ACTUALLY BEEN SHARED IN HERE, and what the ceiling makes of it.
   *
   * Admin-only, and it deliberately returns no CONTENT -- an item type, an
   * audience, a classification, an author and a date. An admin can see that
   * something private was addressed to the whole company; they cannot read it.
   * The ceiling governs where things travel, and this screen is about
   * governance, not about a manager reading their reports' notes.
   */
  app.get("/v1/org/shares", asAdmin, async (request) => {
    const shares = await listOrgShares(request.actor.orgId);
    return {
      shares,
      count: shares.length,
      blocked: shares.filter((s) => !s.permitted).length,
    };
  });

  registerGroupRoutes(app, { asMember, asAdmin });
  registerPolicyRoutes(app, { asMember, asAdmin });
  registerInviteRoutes(app, { asAdmin });
}

/**
 * A FRESH TOKEN FOR THE ACCOUNT THAT JUST BECAME AN ADMIN.
 *
 * The caller's token was minted before this company existed, so its scope says
 * org:create and not org:admin -- correct at the time, useless one millisecond
 * later. Without this the person who just enrolled their company is bounced
 * back to the sign-in screen before they can open the console they are already
 * an admin of.
 *
 * It re-mints only for a SCOPED token, which is to say only for a browser. An
 * unscoped token (the app's) is unaffected because it was never restricted, and
 * nothing here widens what the holder may do: the same account, the same
 * subject, the same eight hours, and a scope that now matches the role the
 * database already granted them.
 */
function reissued(request) {
  if (!Array.isArray(request.tokenScope)) return {};
  const scope = [...webSessionScopeFor({ role: "admin", status: "active" })];
  const { token, expiresAt } = signSessionToken({
    did: request.privyUser.userId,
    phone: request.privyUser.phone ?? null,
    scope,
    ttlSeconds: 8 * 60 * 60,
  });
  return { token, expiresAt, scope };
}

function registerGroupRoutes(app, { asMember, asAdmin }) {
  app.get("/v1/org/groups", asMember, async (request) => {
    const groups = await listGroups(request.actor.orgId);
    return { groups, count: groups.length };
  });

  app.post("/v1/org/groups", asAdmin, async (request, reply) => {
    const out = await createGroup({
      orgId: request.actor.orgId,
      name: request.body?.name,
      purpose: request.body?.purpose,
      description: request.body?.description,
      createdBy: request.amberId,
    });
    if (!out.ok) return refuse(reply, out.reason, "Could not create that group.");
    return reply.code(201).send({ group: out.group });
  });

  app.patch("/v1/org/groups/:groupId", asAdmin, async (request, reply) => {
    const out = await updateGroup({
      orgId: request.actor.orgId,
      groupId: String(request.params.groupId || ""),
      name: request.body?.name,
      purpose: request.body?.purpose,
      description: request.body?.description,
    });
    if (!out.ok) return refuse(reply, out.reason, "Could not update that group.");
    return { ok: true };
  });

  app.delete("/v1/org/groups/:groupId", asAdmin, async (request, reply) => {
    const gone = await deleteGroup({
      orgId: request.actor.orgId,
      groupId: String(request.params.groupId || ""),
    });
    if (!gone) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.get("/v1/org/groups/:groupId/members", asMember, async (request) => {
    const members = await listGroupMembers({
      orgId: request.actor.orgId,
      groupId: String(request.params.groupId || ""),
    });
    return { members, count: members.length };
  });

  app.post("/v1/org/groups/:groupId/members", asAdmin, async (request, reply) => {
    const out = await addGroupMember({
      orgId: request.actor.orgId,
      groupId: String(request.params.groupId || ""),
      amberId: String(request.body?.amberId || ""),
      addedBy: request.amberId,
    });
    if (!out.ok) return refuse(reply, out.reason, "Could not add that person to the group.");
    return { ok: true };
  });

  app.delete("/v1/org/groups/:groupId/members/:amberId", asAdmin, async (request, reply) => {
    const gone = await removeGroupMember({
      orgId: request.actor.orgId,
      groupId: String(request.params.groupId || ""),
      amberId: String(request.params.amberId || ""),
    });
    if (!gone) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}

function registerPolicyRoutes(app, { asMember, asAdmin }) {
  /* ───────────────────────────────────────────────── the company canvas */

  app.get("/v1/org/links", asMember, async (request) => ({
    links: await listGroupLinks(request.actor.orgId),
  }));

  /**
   * MOVING A GROUP IS A MEMBER'S RIGHT, NOT AN ADMIN'S.
   *
   * The canvas is how the company explains itself to itself, and a diagram
   * only one person may touch is a diagram that is wrong within a month. The
   * same argument the wiki is built on.
   */
  /**
   * THE ORDER OF THE LIST, AND WHAT SITS AT THE TOP.
   *
   * Member-writable like the canvas positions beside them: how a company
   * arranges its own teams is the company's business, and an arrangement
   * only an admin can change is one that stays wrong.
   *
   * The order takes the whole array rather than one group's new index --
   * a drag changes everything it moved past, and sending one position makes
   * the server guess at the rest.
   */
  app.put(
    "/v1/org/groups/order",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["ids"],
          properties: {
            ids: { type: "array", maxItems: 200, items: { type: "string", maxLength: 64 } },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await setGroupOrder({
        orgId: request.actor.orgId,
        ids: request.body.ids,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not reorder those groups.");
      return { ok: true, moved: result.moved };
    },
  );

  app.put(
    "/v1/org/groups/:groupId/pin",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["pinned"],
          properties: { pinned: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const result = await setGroupPinned({
        orgId: request.actor.orgId,
        groupId: request.params.groupId,
        pinned: request.body.pinned,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not pin that group.");
      return { ok: true, pinnedAt: result.pinnedAt };
    },
  );

  app.put(
    "/v1/org/groups/:groupId/position",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["x", "y"],
          properties: { x: { type: "number" }, y: { type: "number" } },
        },
      },
    },
    async (request, reply) => {
      const result = await setGroupPosition({
        orgId: request.actor.orgId,
        groupId: request.params.groupId,
        x: request.body.x,
        y: request.body.y,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not move that group.");
      return { ok: true };
    },
  );

  app.post(
    "/v1/org/links",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["fromGroupId", "toGroupId"],
          properties: {
            fromGroupId: { type: "string" },
            toGroupId: { type: "string" },
            label: { type: ["string", "null"], maxLength: 60 },
            description: { type: ["string", "null"], maxLength: 600 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await linkGroups({
        orgId: request.actor.orgId,
        a: request.body.fromGroupId,
        b: request.body.toGroupId,
        label: request.body.label ?? null,
        description: request.body.description ?? null,
        createdBy: request.actor.amberId,
      });
      if (!result.ok) {
        return refuse(
          reply,
          result.reason,
          result.reason === "same_group"
            ? "A group cannot be connected to itself."
            : "Could not connect those groups.",
        );
      }
      reply.code(201);
      return { link: result.link };
    },
  );

  app.patch(
    "/v1/org/links/:linkId",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          properties: {
            label: { type: ["string", "null"], maxLength: 60 },
            description: { type: ["string", "null"], maxLength: 600 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await updateGroupLink({
        orgId: request.actor.orgId,
        linkId: request.params.linkId,
        ...request.body,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not save that connection.");
      return { link: result.link };
    },
  );

  app.delete("/v1/org/links/:linkId", asMember, async (request, reply) => {
    const result = await unlinkGroups({ orgId: request.actor.orgId, linkId: request.params.linkId });
    if (!result.ok) return refuse(reply, result.reason, "Could not remove that connection.");
    return { ok: true };
  });

  app.get("/v1/org/policy", asMember, async (request) => {
    const policy = await getPolicy(request.actor.orgId);
    return {
      policy,
      permittedScopes: Object.fromEntries(
        CLASSIFICATIONS.map((c) => [c, permittedScopes(policy, c)]),
      ),
    };
  });

  /**
   * SET THE CEILING. A whole map, not one entry, because an admin editing a
   * policy is looking at all four classifications at once and a partial write
   * would leave the screen and the database disagreeing about the other three.
   */
  app.put("/v1/org/policy", asAdmin, async (request, reply) => {
    const incoming = request.body?.policy;
    if (!incoming || typeof incoming !== "object") {
      return refuse(reply, "bad_policy", "Send { policy: { classification: maxScope } }.");
    }
    for (const [classification, maxScope] of Object.entries(incoming)) {
      const out = await setPolicyEntry({
        orgId: request.actor.orgId,
        classification,
        maxScope,
        updatedBy: request.amberId,
      });
      if (!out.ok) return refuse(reply, out.reason, `Rejected ${classification}.`);
    }
    return { policy: await getPolicy(request.actor.orgId) };
  });
}

function registerInviteRoutes(app, { asAdmin }) {
  app.get("/v1/org/invites", asAdmin, async (request) => {
    const invites = await listInvites(request.actor.orgId);
    return { invites, count: invites.length };
  });

  /**
   * ISSUE AN INVITE, AND HAND THE LINK BACK TO THE ADMIN.
   *
   * Returning the token here is deliberate and is NOT the thing
   * email-login-store refuses to do. The difference is who is asking: this
   * caller is an authenticated admin of this company who has just asserted that
   * this address should be in it. Handing them the link so they can paste it
   * into Slack is a feature every tool of this kind has. The login endpoint's
   * caller is anonymous, and handing THEM a token would be a way to sign in as
   * somebody else.
   *
   * The email is sent too when mail is configured, and a send failure does not
   * fail the request -- the admin already has the link.
   */
  app.post("/v1/org/invites", asAdmin, async (request, reply) => {
    const { email, role = "member", groupId = null } = request.body ?? {};
    const out = await createInvite({
      orgId: request.actor.orgId,
      email,
      role,
      groupId,
      invitedBy: request.amberId,
    });
    if (!out.ok) {
      return refuse(
        reply,
        out.reason,
        out.reason === "already_invited"
          ? "There is already a live invitation to that address. Revoke it first, or send them the existing link."
          : out.reason === "no_such_group"
            ? "That group is not in this company."
            : out.reason === "wrong_domain"
              ? `This company only admits @${out.domain} addresses. An admin can turn that off in Sharing policy.`
              : out.reason === "bad_email"
                ? "That is not an email address."
                : "Could not create that invite.",
      );
    }

    const acceptUrl = `${webBaseUrl(request)}/join?token=${encodeURIComponent(out.token)}`;
    const delivery = await sendEmail({
      to: out.invite.email,
      subject: `Join ${request.actor.orgName} on Amber`,
      text:
        `${request.actor.orgName} invited you to Amber.\n\n` +
        `Accept here: ${acceptUrl}\n\n` +
        `The link works once and expires in 7 days.`,
    }).catch(() => ({ ok: false, reason: "send_failed" }));

    if (!delivery.ok) {
      request.log?.warn?.(
        { reason: delivery.reason, status: delivery.status, detail: delivery.detail },
        "[org.invite] the invitation was created but not delivered",
      );
    }

    return reply.code(201).send({
      invite: out.invite,
      acceptUrl,
      emailed: delivery.ok === true,
      /*
       * WHY IT WAS NOT EMAILED, when it was not. The console said "email is
       * not configured here yet" for every failure, including a configured
       * provider rejecting the send -- which sent somebody to check an
       * environment variable that was already correct.
       */
      deliveryReason: delivery.ok ? null : (delivery.reason ?? "send_failed"),
      deliveryDetail: delivery.ok ? null : (delivery.detail ?? null),
      // The domain Resend has to have verified. Naming it turns "the mail
      // provider refused it" into something somebody can go and fix.
      sendingDomain: delivery.ok ? null : sendingDomain(),
    });
  });

  /**
   * THE LINK AGAIN, WHICH MEANS A NEW ONE.
   *
   * Only the hash of an invite token is stored, so the plaintext genuinely
   * cannot be produced a second time -- "resend" has to mean "reissue". The
   * previous link stops working the moment this runs, which is the right
   * behavior and worth saying out loud on the button: an invitation pasted
   * into the wrong channel is revoked by the act of asking for a new one.
   *
   * It exists because without it an admin whose mail provider refused the
   * send had an invitation they could never deliver, and the only recovery
   * was to revoke and recreate -- which works, and which nobody discovers.
   */
  app.post("/v1/org/invites/:inviteId/link", asAdmin, async (request, reply) => {
    const out = await rotateInviteToken({
      orgId: request.actor.orgId,
      inviteId: request.params.inviteId,
    });
    if (!out.ok) {
      return refuse(
        reply,
        out.reason,
        out.reason === "not_found"
          ? "That invitation has already been accepted, or revoked."
          : "Could not reissue that invitation.",
      );
    }

    const acceptUrl = `${webBaseUrl(request)}/join?token=${encodeURIComponent(out.token)}`;
    const delivery = await sendEmail({
      to: out.invite.email,
      subject: `Join ${request.actor.orgName} on Amber`,
      text:
        `${request.actor.orgName} invited you to Amber.\n\n` +
        `Accept here: ${acceptUrl}\n\n` +
        `The link works once and expires in 7 days.`,
    }).catch(() => ({ ok: false, reason: "send_failed" }));

    if (!delivery.ok) {
      request.log?.warn?.(
        { reason: delivery.reason, status: delivery.status, detail: delivery.detail },
        "[org.invite] reissued but not delivered",
      );
    }

    return {
      invite: out.invite,
      acceptUrl,
      emailed: delivery.ok === true,
      deliveryReason: delivery.ok ? null : (delivery.reason ?? "send_failed"),
      deliveryDetail: delivery.ok ? null : (delivery.detail ?? null),
    };
  });

  app.delete("/v1/org/invites/:inviteId", asAdmin, async (request, reply) => {
    const gone = await revokeInvite({
      orgId: request.actor.orgId,
      inviteId: String(request.params.inviteId || ""),
    });
    if (!gone) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}
