/**
 * ORG KNOWLEDGE ROUTES — the wiki, the drive, the feed, and who knows what.
 *
 *   GET    /v1/org/knowledge                    the one call the console's front page makes
 *   GET    /v1/org/pages                        the index
 *   GET    /v1/org/pages/search?q=              full text, over everything
 *   POST   /v1/org/pages                        write one
 *   GET    /v1/org/pages/:pageId                a page, with its contributors and files
 *   PATCH  /v1/org/pages/:pageId                edit it; a revision is recorded
 *   DELETE /v1/org/pages/:pageId                archive it            (author or admin)
 *   GET    /v1/org/pages/:pageId/revisions      the history
 *   POST   /v1/org/pages/:pageId/files/upload-url
 *   POST   /v1/org/pages/:pageId/files/:attachmentId     finalize
 *   GET    /v1/org/pages/:pageId/files/:attachmentId     signed, short-lived GET
 *   DELETE /v1/org/pages/:pageId/files/:attachmentId
 *   GET    /v1/org/feed                         updates, questions, intros
 *   POST   /v1/org/feed
 *   GET    /v1/org/feed/:postId/answers
 *   POST   /v1/org/feed/:postId/answers
 *   POST   /v1/org/feed/:postId/answers/:answerId/accept   (asker only)
 *   DELETE /v1/org/feed/:postId                 (author or admin)
 *   GET    /v1/org/experts?topic=               who has written about this
 *   GET    /v1/org/people/:amberId              a profile and what they have contributed
 *   PUT    /v1/org/me/profile                   title, location, one line
 *
 * LIKE org.js, NO ROUTE HERE TAKES AN org_id. It comes from the membership row
 * resolveActor already found, and every store call is given it. A page id in a
 * path is therefore not a capability: it is only ever looked up alongside the
 * caller's own organization, so a valid id from another company is a 404.
 *
 * WRITING IS A MEMBER'S RIGHT, NOT AN ADMIN'S. A wiki that only admins can edit
 * is a policy document, and the entire premise here -- that what the company
 * knows can be derived from who wrote it down -- collapses if writing is
 * gated. Admins get exactly two extra powers: archiving somebody else's page
 * and deleting somebody else's post.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  makeResolveActor,
  requireOrgAdmin,
  requireOrgMember,
} from "../lib/resolve-actor.js";
import {
  acceptAnswer,
  addAttachment,
  archivePage,
  contributionsBy,
  createPage,
  createPost,
  deleteAttachment,
  deletePost,
  expertsOn,
  getAttachment,
  getPage,
  knowledgeStats,
  listAnswers,
  listAttachments,
  listContributors,
  listFeed,
  feedPulse,
  feedSeenAt,
  listPages,
  listRevisions,
  markAttachmentReady,
  markFeedSeen,
  searchPages,
  setMemberProfile,
  unreadFeedCount,
  updatePage,
} from "../db/org-knowledge-store.js";
import { listGroups, listMembers } from "../db/org-store.js";
import {
  deleteGcsObject,
  gcsConfigured,
  signGcsUrl,
  statGcsObject,
} from "../lib/gcs-signing.js";
import { ID_FIELDS, blankToNull } from "../lib/empty-uuid.js";
import { AUDIENCE_SCHEMA } from "../lib/audience-schema.js";
import { audienceReach, getAudience } from "../db/org-audience-store.js";
import {
  REACTIONS,
  attachToPost,
  clearMentions,
  decorateFeed,
  reactionDetail,
  setMentions,
  setPinned,
  toggleReaction,
  unreadMentions,
} from "../db/org-feed-social.js";
import { openTenantScope } from "../db/tenant.js";
import { normalizeTags } from "../lib/text-extract.js";
import crypto from "node:crypto";

const UPLOAD_TTL_SECONDS = 15 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

/**
 * 50 MB, and the number is here rather than in the store because it is a
 * statement about what this product is for. A company drive is slide decks,
 * spreadsheets and PDFs; the first person to try to put a video in it should
 * be told no by a number somebody chose, not by a timeout.
 */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * WHAT MAY BE UPLOADED, as an allowlist.
 *
 * A denylist of dangerous types is a list somebody has to keep up to date
 * forever, and the one entry nobody thought of is the one that matters. The
 * types below are the ones a company actually attaches to a runbook.
 *
 * text/html is deliberately absent. An HTML file served from the bucket runs
 * as a page, and a page somebody uploaded is a page somebody wrote.
 */
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** A filename a bucket key and a Content-Disposition header can both survive. */
function safeFilename(name) {
  return String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "-")
    .trim()
    .slice(0, 180) || "file";
}

const REASON_STATUS = new Map([
  ["not_found", 404],
  ["no_parent", 404],
  ["not_yours", 403],
  ["not_asker", 403],
  ["too_deep", 409],
  ["bad_kind", 400],
  ["empty_audience", 400],
  ["write_failed", 503],
]);

function refuse(reply, reason, message) {
  return reply.code(REASON_STATUS.get(reason) ?? 400).send({ error: reason, message });
}

export function registerOrgKnowledgeRoutes(
  app,
  { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {},
) {
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

  const org = (request) => request.actor.orgId;
  const who = (request) => request.actor.amberId;
  const isAdmin = (request) => request.actor.orgRole === "admin";

  /**
   * A page the caller is allowed to see, or null.
   *
   * THIS USED TO GUESS. It fetched the page, compared its single group_id
   * against whatever group membership listGroups happened to carry, and -- if
   * that came back without member ids -- permitted the read anyway on the
   * grounds that filing is not a secret. That was true when a group_id was
   * filing. It stopped being true the moment a page could be addressed to
   * three people, and a fallback that permits is not a check.
   *
   * The audience predicate now lives in the query itself, so a page the caller
   * is not in the audience for does not come back at all. Not found and not
   * for you are deliberately the same answer: the alternative tells somebody
   * the exact title of every private page in the company.
   */
  async function readablePage(request, pageId) {
    return getPage({ orgId: org(request), pageId, viewerId: who(request) });
  }

  /* --------------------------------------------------------- the front page */

  /**
   * EVERYTHING THE COMBINED CONSOLE PAGE NEEDS, IN ONE REQUEST.
   *
   * The console used to be an overview tab and a policy tab, which meant the
   * first thing somebody saw on arriving was a page of numbers with nothing to
   * do on it, and the thing those numbers were about was one click away. Both
   * halves now render from this.
   */
  app.get("/v1/org/knowledge", asMember, async (request) => {
    const orgId = org(request);
    const [stats, recent, questions, groups, unread, pulse, seenAt] = await Promise.all([
      knowledgeStats(orgId),
      listPages(orgId, { limit: 8, viewerId: who(request) }),
      listFeed({ orgId, kind: "question", limit: 6, viewerId: who(request) }),
      listGroups(orgId).catch(() => []),
      unreadFeedCount({ orgId, viewerId: who(request) }).catch(() => 0),
      feedPulse({ orgId }).catch(() => []),
      feedSeenAt({ orgId, viewerId: who(request) }).catch(() => null),
    ]);
    const week = pulse.slice(-7).reduce((a, b) => a + b.n, 0);
    const totals = { fortnight: pulse.reduce((a, b) => a + b.n, 0), week };
    return {
      unread: { feed: unread, seenAt },
      stats,
      recent,
      openQuestions: questions.filter((q) => q.answers === 0),
      groups: groups.map((g) => ({ id: g.id, name: g.name, purpose: g.purpose ?? null })),
      /*
       * Counted in SQL rather than derived from the feed above, which is
       * capped at sixty rows: a busy company would otherwise see two accurate
       * days and twelve empty ones and conclude it had gone quiet.
       */
      pulse,
      posts: totals,
    };
  });

  /* --------------------------------------------------------------- the wiki */

  app.get("/v1/org/pages", asMember, async (request) => {
    const pages = await listPages(org(request), {
      limit: 300,
      tag: request.query?.tag ?? null,
      groupId: request.query?.groupId ?? null,
      viewerId: who(request),
    });
    return { pages, count: pages.length };
  });

  app.get("/v1/org/pages/search", asMember, async (request) => {
    const results = await searchPages({
      orgId: org(request), q: request.query?.q, viewerId: who(request),
    });
    return { results, count: results.length };
  });

  app.post(
    "/v1/org/pages",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            summary: { type: "string", maxLength: 400 },
            body: { type: "string", maxLength: 400000 },
            kind: { type: "string" },
            workStatus: { type: ["string", "null"], maxLength: 16 },
            ownerId: { type: ["string", "null"], maxLength: 64 },
            groupId: { type: ["string", "null"] },
            tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } },
            audience: AUDIENCE_SCHEMA,
          },
        },
      },
    },
    async (request, reply) => {
      const result = await createPage({
        orgId: org(request),
        createdBy: who(request),
        title: request.body.title,
        summary: request.body.summary ?? null,
        body: request.body.body ?? "",
        kind: request.body.kind,
        groupId: request.body.groupId ?? null,
        tags: normalizeTags(request.body.tags),
        audience: request.body.audience ?? null,
        // Ignored unless kind is 'handover'; the store enforces that rather
        // than trusting a body that could ask for a runbook with a status.
        workStatus: request.body.workStatus ?? null,
        ownerId: request.body.ownerId ?? null,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not create that page.");
      reply.code(201);
      return { page: result.page };
    },
  );

  app.get("/v1/org/pages/:pageId", asMember, async (request, reply) => {
    const page = await readablePage(request, request.params.pageId);
    if (!page) return reply.code(404).send({ error: "not_found", message: "No such page." });
    const [contributors, files, revisions] = await Promise.all([
      listContributors({ orgId: org(request), pageId: page.id }),
      listAttachments({ orgId: org(request), pageId: page.id, viewerId: who(request) }),
      listRevisions({ orgId: org(request), pageId: page.id, limit: 12 }),
    ]);
    return { page, contributors, files, revisions };
  });

  app.patch(
    "/v1/org/pages/:pageId",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            summary: { type: ["string", "null"], maxLength: 400 },
            body: { type: "string", maxLength: 400000 },
            kind: { type: "string" },
            groupId: { type: ["string", "null"] },
            tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } },
            changeNote: { type: ["string", "null"], maxLength: 200 },
            audience: AUDIENCE_SCHEMA,
            workStatus: { type: ["string", "null"], maxLength: 16 },
            ownerId: { type: ["string", "null"], maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const page = await readablePage(request, request.params.pageId);
      if (!page) return reply.code(404).send({ error: "not_found", message: "No such page." });
      const result = await updatePage({
        orgId: org(request),
        pageId: page.id,
        authorId: who(request),
        ...request.body,
        ...(request.body.tags !== undefined ? { tags: normalizeTags(request.body.tags) } : {}),
        workStatus: request.body.workStatus,
        ownerId: request.body.ownerId,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not save that page.");
      return {
        page: result.page,
        recorded: result.recorded,
        contributors: await listContributors({ orgId: org(request), pageId: page.id }),
      };
    },
  );

  /**
   * ARCHIVE, NOT DELETE, and the author can do it to their own.
   *
   * The revision ledger is the record of who contributed what, and a hard
   * delete would take a contributor's history with the page. Archiving takes it
   * out of the index and leaves the ledger standing.
   */
  app.delete("/v1/org/pages/:pageId", asMember, async (request, reply) => {
    const page = await getPage({
      orgId: org(request), pageId: request.params.pageId, viewerId: who(request),
    });
    if (!page) return reply.code(404).send({ error: "not_found", message: "No such page." });
    if (!isAdmin(request) && String(page.created_by ?? "") !== String(who(request))) {
      return reply.code(403).send({
        error: "not_yours",
        message: "Only the person who wrote this page, or an admin, can archive it.",
      });
    }
    const result = await archivePage({ orgId: org(request), pageId: page.id });
    if (!result.ok) return refuse(reply, result.reason, "Could not archive that page.");
    return { ok: true };
  });

  /** Who can see this page. Gated on the page being readable at all. */
  app.get("/v1/org/pages/:pageId/audience", asMember, async (request, reply) => {
    const page = await readablePage(request, request.params.pageId);
    if (!page) return reply.code(404).send({ error: "not_found", message: "No such page." });
    const [audience, reach] = await Promise.all([
      getAudience({ orgId: org(request), itemType: "page", itemId: page.id }),
      audienceReach({ orgId: org(request), itemType: "page", itemId: page.id }),
    ]);
    return { audience, reach };
  });

  app.get("/v1/org/pages/:pageId/revisions", asMember, async (request, reply) => {
    const page = await readablePage(request, request.params.pageId);
    if (!page) return reply.code(404).send({ error: "not_found", message: "No such page." });
    return { revisions: await listRevisions({ orgId: org(request), pageId: page.id }) };
  });

  /* ------------------------------------------------------------ attachments */

  app.post(
    "/v1/org/pages/:pageId/files/upload-url",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["filename", "contentType"],
          properties: {
            filename: { type: "string", minLength: 1, maxLength: 200 },
            contentType: { type: "string", minLength: 1, maxLength: 160 },
            byteSize: { type: "integer", minimum: 0, maximum: MAX_ATTACHMENT_BYTES },
          },
        },
      },
    },
    async (request, reply) => {
      if (!gcsConfigured()) {
        return reply.code(503).send({
          error: "storage_unconfigured",
          message: "File storage is not configured on this server.",
        });
      }
      const page = await readablePage(request, request.params.pageId);
      if (!page) return reply.code(404).send({ error: "not_found", message: "No such page." });

      const contentType = String(request.body.contentType).split(";")[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.has(contentType)) {
        return reply.code(415).send({
          error: "type_not_allowed",
          message: `${contentType} cannot be attached here.`,
        });
      }

      /*
       * THE KEY IS MINTED HERE AND THE CLIENT NEVER NAMES AN OBJECT. It carries
       * the org id so that an object found loose in the bucket can be placed,
       * and a random segment so that two people uploading "notes.pdf" to the
       * same page do not overwrite each other.
       */
      const filename = safeFilename(request.body.filename);
      const storageKey =
        `org/${org(request)}/pages/${page.id}/${crypto.randomUUID()}/${encodeURIComponent(filename)}`;

      const reserved = await addAttachment({
        orgId: org(request),
        pageId: page.id,
        uploadedBy: who(request),
        filename,
        contentType,
        byteSize: request.body.byteSize ?? null,
        storageKey,
      });
      if (!reserved.ok) return refuse(reply, reserved.reason, "Could not start that upload.");

      return {
        attachmentId: reserved.attachment.id,
        uploadUrl: signGcsUrl({
          objectName: storageKey,
          method: "PUT",
          expiresSeconds: UPLOAD_TTL_SECONDS,
          contentType,
        }),
        contentType,
        expiresIn: UPLOAD_TTL_SECONDS,
        maxBytes: MAX_ATTACHMENT_BYTES,
      };
    },
  );

  app.post("/v1/org/pages/:pageId/files/:attachmentId", asMember, async (request, reply) => {
    const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.attachmentId,
      viewerId: who(request),
    });
    if (!row || String(row.page_id) !== String(request.params.pageId)) {
      return reply.code(404).send({ error: "not_found", message: "No such upload." });
    }

    // NEVER TRUST THE CLIENT FOR THE SIZE. Ask the bucket. An upload that is
    // over the limit is removed rather than recorded, because a row pointing at
    // a 400MB object is a bill nobody agreed to.
    let stat;
    try {
      stat = await statGcsObject(row.storage_key);
    } catch (err) {
      request.log?.error?.({ err: err?.message }, "[org-knowledge] stat failed");
      return reply.code(502).send({
        error: "storage_unreachable",
        message: "Could not verify that upload.",
      });
    }
    if (!stat.exists) {
      return reply.code(409).send({
        error: "upload_missing",
        message: "That file never finished uploading.",
      });
    }
    if (stat.size > MAX_ATTACHMENT_BYTES) {
      await deleteGcsObject(row.storage_key).catch(() => null);
      await deleteAttachment({ orgId: org(request), attachmentId: row.id });
      return reply.code(413).send({
        error: "too_large",
        message: "That file is over the 50MB limit.",
      });
    }

    const result = await markAttachmentReady({
      orgId: org(request),
      attachmentId: row.id,
      byteSize: stat.size,
    });
    if (!result.ok) return refuse(reply, result.reason, "Could not finish that upload.");
    return { attachment: result.attachment };
  });

  app.get("/v1/org/pages/:pageId/files/:attachmentId", asMember, async (request, reply) => {
    const page = await readablePage(request, request.params.pageId);
    if (!page) return reply.code(404).send({ error: "not_found", message: "No such page." });
    const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.attachmentId,
      viewerId: who(request),
    });
    if (!row || String(row.page_id) !== String(page.id) || row.status !== "ready") {
      return reply.code(404).send({ error: "not_found", message: "No such file." });
    }
    // Short-lived and minted per request. A URL that lasts an hour is a URL
    // that outlives somebody's membership.
    return {
      url: signGcsUrl({
        objectName: row.storage_key,
        method: "GET",
        expiresSeconds: DOWNLOAD_TTL_SECONDS,
      }),
      filename: row.filename,
      contentType: row.content_type,
      byteSize: row.byte_size,
      expiresIn: DOWNLOAD_TTL_SECONDS,
    };
  });

  app.delete("/v1/org/pages/:pageId/files/:attachmentId", asMember, async (request, reply) => {
    const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.attachmentId,
      viewerId: who(request),
    });
    if (!row || String(row.page_id) !== String(request.params.pageId)) {
      return reply.code(404).send({ error: "not_found", message: "No such file." });
    }
    if (!isAdmin(request) && String(row.uploaded_by ?? "") !== String(who(request))) {
      return reply.code(403).send({
        error: "not_yours",
        message: "Only the person who uploaded this, or an admin, can remove it.",
      });
    }
    await deleteAttachment({ orgId: org(request), attachmentId: row.id });
    await deleteGcsObject(row.storage_key).catch(() => null);
    return { ok: true };
  });

  /* --------------------------------------------------------------- the feed */

  app.get("/v1/org/feed", asMember, async (request) => {
    const orgId = org(request);
    const posts = await listFeed({
      orgId,
      groupId: request.query?.groupId ?? null,
      kind: request.query?.kind ?? null,
      viewerId: who(request),
    });
    // Files for the whole page in one query rather than one per post.
    await decorateFeed({ orgId, rows: posts });
    return {
      posts,
      count: posts.length,
      mentions: await unreadMentions({ orgId, amberId: who(request) }).catch(() => 0),
      reactions: REACTIONS,
    };
  });

  /**
   * The feed has been looked at. Clears the rail badge.
   *
   * POST rather than a side effect of GET /v1/org/feed, because the overview
   * screen also loads the feed and opening the overview should not mark
   * everything read.
   */
  app.post("/v1/org/feed/seen", asMember, async (request) => {
    const orgId = org(request);
    await markFeedSeen({ orgId, viewerId: who(request) });
    // Opening the feed is also reading what was addressed to you in it.
    await clearMentions({ orgId, amberId: who(request) }).catch(() => null);
    return { ok: true, unread: 0 };
  });

  /**
   * REACT TO A POST. The cheap gesture, and the reason a thread stays readable.
   *
   * Idempotent in the useful sense: sending the same emoji twice takes it
   * back, so the client never has to know the current state to act and a
   * double-tap on a phone cannot leave a reaction somebody can't remove.
   */
  app.post(
    "/v1/org/feed/:postId/react",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["emoji"],
          properties: { emoji: { type: "string", maxLength: 8 } },
        },
      },
    },
    async (request, reply) => {
      const out = await toggleReaction({
        orgId: org(request),
        postId: request.params.postId,
        amberId: who(request),
        emoji: request.body.emoji,
      });
      if (!out.ok) {
        return refuse(
          reply,
          out.reason,
          out.reason === "bad_emoji" ? "That is not one of the reactions here." : "No such post.",
        );
      }
      return { ok: true, on: out.on };
    },
  );

  /** Who reacted, by name. "Maya, Sagar and 5 others" rather than "7". */
  app.get("/v1/org/feed/:postId/reactions", asMember, async (request) => ({
    reactions: await reactionDetail({ orgId: org(request), postId: request.params.postId }),
  }));

  /**
   * PIN OR UNPIN. Admin only.
   *
   * A feed where anybody can pin their own post to the top is a feed where
   * everybody does, and then pinning means nothing.
   */
  app.post("/v1/org/feed/:postId/pin", asMember, async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(403).send({
        error: "not_admin",
        message: "Only an admin can pin a post for the whole company.",
      });
    }
    const out = await setPinned({
      orgId: org(request),
      postId: request.params.postId,
      pinned: request.body?.pinned !== false,
      byId: who(request),
    });
    if (!out.ok) return refuse(reply, out.reason, "Could not pin that.");
    return { ok: true, pinnedAt: out.pinnedAt };
  });

  app.post(
    "/v1/org/feed",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["body"],
          properties: {
            body: { type: "string", minLength: 1, maxLength: 20000 },
            title: { type: ["string", "null"], maxLength: 200 },
            kind: { type: "string" },
            groupId: { type: ["string", "null"] },
            audience: AUDIENCE_SCHEMA,
            mentions: { type: "array", maxItems: 30, items: { type: "string", maxLength: 64 } },
            fileIds: { type: "array", maxItems: 10, items: { type: "string", maxLength: 64 } },
          },
        },
      },
    },
    async (request, reply) => {
      const orgId = org(request);
      const result = await createPost({
        orgId,
        authorId: who(request),
        kind: request.body.kind ?? "update",
        title: request.body.title ?? null,
        body: request.body.body,
        groupId: request.body.groupId ?? null,
        audience: request.body.audience ?? null,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not post that.");

      /*
       * MENTIONS AND FILES ARE BEST-EFFORT, DELIBERATELY. The post is already
       * written and visible; failing the whole request because a mention row
       * would not insert would lose somebody's writing to fix a badge.
       */
      const mentions = request.body.mentions ?? [];
      const fileIds = request.body.fileIds ?? [];
      /*
       * Together, and skipped entirely when there is nothing to do. An
       * ordinary chat message has neither, and it was paying two sequential
       * round trips to write nothing -- on the one request a person is
       * actually waiting on.
       */
      await Promise.all([
        mentions.length
          ? setMentions({ orgId, postId: result.post.id, amberIds: mentions }).catch(() => null)
          : null,
        fileIds.length
          ? attachToPost({ orgId, postId: result.post.id, fileIds }).catch(() => null)
          : null,
      ]);

      reply.code(201);
      return { post: result.post };
    },
  );

  app.get("/v1/org/feed/:postId/answers", asMember, async (request) => ({
    answers: await listAnswers({
      orgId: org(request), postId: request.params.postId, viewerId: who(request),
    }),
  }));

  app.post(
    "/v1/org/feed/:postId/answers",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["body"],
          properties: { body: { type: "string", minLength: 1, maxLength: 20000 } },
        },
      },
    },
    async (request, reply) => {
      const result = await createPost({
        orgId: org(request),
        authorId: who(request),
        kind: "answer",
        body: request.body.body,
        parentId: request.params.postId,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not post that answer.");
      reply.code(201);
      return { post: result.post };
    },
  );

  app.post("/v1/org/feed/:postId/answers/:answerId/accept", asMember, async (request, reply) => {
    const result = await acceptAnswer({
      orgId: org(request),
      postId: request.params.postId,
      answerId: request.params.answerId,
      askerId: who(request),
    });
    if (!result.ok) {
      return refuse(
        reply,
        result.reason,
        result.reason === "not_asker"
          ? "Only the person who asked can mark an answer accepted."
          : "Could not accept that answer.",
      );
    }
    return { ok: true };
  });

  app.delete("/v1/org/feed/:postId", asMember, async (request, reply) => {
    const result = await deletePost({
      orgId: org(request),
      postId: request.params.postId,
      actorId: who(request),
      isAdmin: isAdmin(request),
    });
    if (!result.ok) return refuse(reply, result.reason, "Could not remove that post.");
    return { ok: true };
  });

  /* ----------------------------------------------------------- who knows what */

  /**
   * WHO KNOWS ABOUT THIS.
   *
   * The score and the counts are both returned, deliberately. A ranking
   * somebody cannot audit is a ranking they will not act on, and "third,
   * because they wrote 6,000 characters of the pricing runbook" is a sentence
   * that survives being questioned in a way that a bare position does not.
   */
  app.get("/v1/org/experts", asMember, async (request) => {
    const topic = String(request.query?.topic ?? "").trim();
    const experts = await expertsOn({ orgId: org(request), topic });
    const pages = await searchPages({
      orgId: org(request), q: topic, limit: 6, viewerId: who(request),
    });
    return { topic, experts, pages };
  });

  app.get("/v1/org/people/:amberId", asMember, async (request, reply) => {
    const members = await listMembers(org(request));
    const member = members.find((m) => String(m.amberId) === String(request.params.amberId));
    if (!member) return reply.code(404).send({ error: "not_found", message: "Not in this company." });
    const contributions = await contributionsBy({
      orgId: org(request),
      amberId: member.amberId,
    });
    return { member, ...contributions };
  });

  app.put(
    "/v1/org/me/profile",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          properties: {
            title: { type: ["string", "null"], maxLength: 120 },
            location: { type: ["string", "null"], maxLength: 120 },
            bio: { type: ["string", "null"], maxLength: 400 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await setMemberProfile({
        orgId: org(request),
        amberId: who(request),
        ...request.body,
      });
      if (!result.ok) return refuse(reply, result.reason, "Could not save that.");
      return { member: result.member };
    },
  );

  /** The roster with the profile fields on it, for the people page. */
  app.get("/v1/org/directory", asMember, async (request) => {
    const [members, groups] = await Promise.all([
      listMembers(org(request)),
      listGroups(org(request)).catch(() => []),
    ]);
    return { members, groups };
  });

  // Kept so the admin console can archive anything without the author check
  // above having to grow a special case.
  app.post("/v1/org/pages/:pageId/archive", asAdmin, async (request, reply) => {
    const result = await archivePage({ orgId: org(request), pageId: request.params.pageId });
    if (!result.ok) return refuse(reply, result.reason, "Could not archive that page.");
    return { ok: true };
  });
}
