/**
 * A TEAM'S WORKING CONTEXT — where its work lives, and when it is happening.
 *
 *   GET    /v1/org/connections            the company's, or one group's
 *   POST   /v1/org/connections            add a link
 *   PATCH  /v1/org/connections/:id        rename, repoint, reorder
 *   DELETE /v1/org/connections/:id
 *
 *   GET    /v1/org/groups/:groupId/calendar            the team's week
 *   GET    /v1/org/groups/:groupId/calendar/mine       my calendars, shared or not
 *   POST   /v1/org/groups/:groupId/calendar/share      share or unshare one
 *   POST   /v1/org/groups/:groupId/calendar/events     an event for the team
 *   DELETE /v1/org/groups/:groupId/calendar/events/:id
 *
 * MEMBER-WRITABLE, NOT ADMIN-ONLY. A team's own links and its own calendar
 * are the team's business, and a workspace where adding the repo link needs
 * an admin is a workspace where the repo link lives in chat forever. Deleting
 * somebody else's connection is the only thing worth gating, and even that is
 * gated on authorship rather than role.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgMember } from "../lib/resolve-actor.js";
import {
  addConnection,
  addGroupEvent,
  groupCalendar,
  listConnections,
  myCalendars,
  removeConnection,
  removeGroupEvent,
  shareCalendar,
  updateConnection,
} from "../db/org-workspace-store.js";
import { ID_FIELDS, blankToNull } from "../lib/empty-uuid.js";
import { openTenantScope } from "../db/tenant.js";

const REASON_STATUS = new Map([
  ["not_found", 404],
  ["no_such_group", 404],
  ["not_yours", 403],
  ["not_a_member", 403],
  ["write_failed", 503],
]);

function refuse(reply, reason, message) {
  return reply.code(REASON_STATUS.get(reason) ?? 400).send({ error: reason, message });
}

export function registerOrgWorkspaceRoutes(
  app,
  { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {},
) {
  const tidyIds = async (request) => {
    blankToNull(request.body, ID_FIELDS);
    blankToNull(request.query, ID_FIELDS);
  };

  const asMember = {
    preHandler: [tidyIds, requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };
  const org = (request) => request.actor.orgId;
  const who = (request) => request.actor.amberId;
  const isAdmin = (request) => request.actor.orgRole === "admin";

  /* ---------------------------------------------------------- connections */

  app.get("/v1/org/connections", asMember, async (request) => {
    const connections = await listConnections({
      orgId: org(request),
      groupId: request.query?.groupId ?? null,
    });
    return { connections, count: connections.length };
  });

  app.post(
    "/v1/org/connections",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["label", "url"],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 120 },
            url: { type: "string", minLength: 3, maxLength: 2000 },
            note: { type: ["string", "null"], maxLength: 300 },
            groupId: { type: ["string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const out = await addConnection({
        orgId: org(request),
        groupId: request.body.groupId ?? null,
        label: request.body.label,
        url: request.body.url,
        note: request.body.note ?? null,
        createdBy: who(request),
      });
      if (!out.ok) {
        return refuse(
          reply,
          out.reason,
          out.reason === "bad_url"
            ? "That is not a web address. Links must start with http:// or https://."
            : out.reason === "no_such_group"
              ? "That group is not in this company."
              : "Could not add that link.",
        );
      }
      reply.code(201);
      return { connection: out.connection };
    },
  );

  app.patch(
    "/v1/org/connections/:id",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          properties: {
            label: { type: "string", minLength: 1, maxLength: 120 },
            url: { type: "string", minLength: 3, maxLength: 2000 },
            note: { type: ["string", "null"], maxLength: 300 },
            position: { type: "integer", minimum: 0, maximum: 9999 },
          },
        },
      },
    },
    async (request, reply) => {
      const out = await updateConnection({
        orgId: org(request),
        id: request.params.id,
        ...request.body,
      });
      if (!out.ok) {
        return refuse(
          reply,
          out.reason,
          out.reason === "bad_url" ? "That is not a web address." : "Could not save that link.",
        );
      }
      return { connection: out.connection };
    },
  );

  /**
   * Remove a link.
   *
   * Gated on AUTHORSHIP rather than role, with admins able to remove any. A
   * team's links are the team's, and needing an admin to delete a dead URL is
   * how dead URLs stay.
   */
  app.delete("/v1/org/connections/:id", asMember, async (request, reply) => {
    const all = await listConnections({ orgId: org(request), groupId: null, includeOrg: true });
    const found = all.find((c) => String(c.id) === String(request.params.id));
    // Not in the org-level list means it is a group's; fetch that scope too.
    const mine =
      found ?? (await listConnections({ orgId: org(request), groupId: request.query?.groupId ?? null }))
        .find((c) => String(c.id) === String(request.params.id));

    if (mine && !isAdmin(request) && String(mine.created_by ?? "") !== String(who(request))) {
      return reply.code(403).send({
        error: "not_yours",
        message: "Only the person who added this link, or an admin, can remove it.",
      });
    }
    const out = await removeConnection({ orgId: org(request), id: request.params.id });
    if (!out.ok) return refuse(reply, out.reason, "Could not remove that link.");
    return { ok: true };
  });

  /* ------------------------------------------------------------ calendars */

  app.get("/v1/org/groups/:groupId/calendar", asMember, async (request) => {
    const events = await groupCalendar({
      orgId: org(request),
      groupId: request.params.groupId,
      from: request.query?.from ?? null,
      to: request.query?.to ?? null,
    });
    return { events, count: events.length };
  });

  /**
   * The calendars this person could share, and which they have.
   *
   * Every connected account is listed, not just the shared ones, so the UI is
   * a row of switches rather than a form that asks somebody to remember what
   * they own.
   */
  app.get("/v1/org/groups/:groupId/calendar/mine", asMember, async (request) => {
    const calendars = await myCalendars({
      orgId: org(request),
      groupId: request.params.groupId,
      amberId: who(request),
    });
    return { calendars, count: calendars.length };
  });

  app.post(
    "/v1/org/groups/:groupId/calendar/share",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["calendarAccountId"],
          properties: {
            calendarAccountId: { type: "string", maxLength: 64 },
            label: { type: ["string", "null"], maxLength: 80 },
            on: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const out = await shareCalendar({
        orgId: org(request),
        groupId: request.params.groupId,
        amberId: who(request),
        calendarAccountId: request.body.calendarAccountId,
        label: request.body.label ?? null,
        on: request.body.on !== false,
      });
      if (!out.ok) {
        return refuse(
          reply,
          out.reason,
          out.reason === "not_yours"
            ? "That calendar is not connected to your account."
            : "Could not change that.",
        );
      }
      return { ok: true, shared: out.shared };
    },
  );

  app.post(
    "/v1/org/groups/:groupId/calendar/events",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["title", "startsAt"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            note: { type: ["string", "null"], maxLength: 2000 },
            location: { type: ["string", "null"], maxLength: 200 },
            url: { type: ["string", "null"], maxLength: 2000 },
            startsAt: { type: "string", minLength: 4, maxLength: 40 },
            endsAt: { type: ["string", "null"], maxLength: 40 },
            allDay: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const out = await addGroupEvent({
        orgId: org(request),
        groupId: request.params.groupId,
        createdBy: who(request),
        ...request.body,
      });
      if (!out.ok) {
        return refuse(
          reply,
          out.reason,
          out.reason === "bad_range"
            ? "That event ends before it starts."
            : out.reason === "bad_url"
              ? "That is not a web address."
              : "Could not add that event.",
        );
      }
      reply.code(201);
      return { event: out.event };
    },
  );

  app.delete(
    "/v1/org/groups/:groupId/calendar/events/:eventId",
    asMember,
    async (request, reply) => {
      const out = await removeGroupEvent({ orgId: org(request), id: request.params.eventId });
      if (!out.ok) return refuse(reply, out.reason, "Could not remove that event.");
      return { ok: true };
    },
  );
}
