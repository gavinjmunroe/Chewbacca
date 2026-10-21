/**
 * THE DRIVE — files that do not need a page to exist.
 *
 *   GET    /v1/org/drive                  stats, tags, and the listing
 *   GET    /v1/org/files                  the listing alone, filtered
 *   POST   /v1/org/files/upload-url       reserve; page and team both optional
 *   POST   /v1/org/files/:fileId          finalize: verify, then read the text
 *   GET    /v1/org/files/:fileId/url      a signed, short-lived download
 *   PATCH  /v1/org/files/:fileId          rename, retag, refile
 *   DELETE /v1/org/files/:fileId
 *   GET    /v1/org/tags                   the shared vocabulary, with counts
 *
 * WHY THIS IS A SEPARATE FILE FROM org-knowledge.js. The routes there all hang
 * off a page and resolve it first, which is the right shape for an attachment
 * and the wrong one for a drive: the whole point here is the file that belongs
 * to a team, or to nobody, and has no page to resolve.
 *
 * THE UPLOAD IS STILL THREE STEPS and still signs the object name server-side.
 * A client that could name its own object could write over somebody else's.
 *
 * EXTRACTION HAPPENS ON FINALIZE, INLINE, AND IS ALLOWED TO FAIL. The file is
 * already in the bucket and the row is already correct by the time the parser
 * runs; all that is lost when it fails is that one file being findable by its
 * contents, which is not worth failing an upload over. Every outcome is
 * recorded as a status rather than as a missing value, because "still working"
 * and "this format has no text in it" are different things to tell somebody.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgMember } from "../lib/resolve-actor.js";
import {
  deleteAttachment,
  driveStats,
  getAttachment,
  listFiles,
  listTags,
  reserveFile,
  setExtraction,
  updateFile,
} from "../db/org-knowledge-store.js";
import { listGroups } from "../db/org-store.js";
import {
  MAX_EXTRACT_BYTES,
  extractText,
  extractable,
  normalizeTags,
} from "../lib/text-extract.js";
import { describable, describeImage } from "../lib/image-describe.js";
import {
  deleteGcsObject,
  gcsConfigured,
  signGcsUrl,
  statGcsObject,
} from "../lib/gcs-signing.js";
import { ID_FIELDS, blankToNull } from "../lib/empty-uuid.js";
import { AUDIENCE_SCHEMA } from "../lib/audience-schema.js";
import { audienceReach, getAudience } from "../db/org-audience-store.js";
import { openTenantScope } from "../db/tenant.js";
import crypto from "node:crypto";

const UPLOAD_TTL_SECONDS = 15 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * WHAT MAY BE UPLOADED, as an allowlist.
 *
 * A denylist of dangerous types is a list somebody has to keep current
 * forever, and the entry nobody thought of is the one that matters. This is
 * wider than the page-attachment list because a drive is where a company puts
 * its actual work, but it is still a list, and text/html is still not on it:
 * an HTML file served from the bucket runs as a page, and a page somebody
 * uploaded is a page somebody published.
 */
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/rtf",
  "application/zip",
  "application/json",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
]);

function safeFilename(name) {
  return (
    String(name ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[/\\]/g, "-")
      .trim()
      .slice(0, 200) || "file"
  );
}

export function registerOrgDriveRoutes(
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
  const org = (request) => request.actor.orgId;
  const who = (request) => request.actor.amberId;
  const isAdmin = (request) => request.actor.orgRole === "admin";

  /** Everything the drive's first screen needs, in one request. */
  app.get("/v1/org/drive", asMember, async (request) => {
    const orgId = org(request);
    const [stats, tags, files, groups] = await Promise.all([
      driveStats(orgId, { viewerId: who(request) }),
      listTags(orgId),
      listFiles({
        orgId,
        groupId: request.query?.groupId ?? null,
        tag: request.query?.tag ?? null,
        q: request.query?.q ?? null,
        viewerId: who(request),
      }),
      listGroups(orgId).catch(() => []),
    ]);
    return {
      stats,
      tags,
      files,
      groups: groups.map((g) => ({ id: g.id, name: g.name, purpose: g.purpose ?? null })),
    };
  });

  app.get("/v1/org/files", asMember, async (request) => {
    const files = await listFiles({
      orgId: org(request),
      groupId: request.query?.groupId ?? null,
      tag: request.query?.tag ?? null,
      pageId: request.query?.pageId ?? null,
      q: request.query?.q ?? null,
      viewerId: who(request),
    });
    return { files, count: files.length };
  });

  app.get("/v1/org/tags", asMember, async (request) => ({ tags: await listTags(org(request)) }));

  /**
   * WHO CAN SEE THIS FILE.
   *
   * Behind the same read check as the file itself -- getAttachment returns
   * null for a file the caller is not in the audience for, so this cannot be
   * used to enumerate the audience of something they cannot open.
   */
  app.get("/v1/org/files/:fileId/audience", asMember, async (request, reply) => {
    const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.fileId,
      viewerId: who(request),
    });
    if (!row) return reply.code(404).send({ error: "not_found", message: "No such file." });
    const [audience, reach] = await Promise.all([
      getAudience({ orgId: org(request), itemType: "file", itemId: row.id }),
      // WHO WOULD ACTUALLY SEE IT, from the roster rather than from what the
      // caller can see. The author is always in their own audience, so their
      // own screen is the one place this question cannot be answered.
      audienceReach({ orgId: org(request), itemType: "file", itemId: row.id }),
    ]);
    return { audience, reach };
  });

  app.post(
    "/v1/org/files/upload-url",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["filename", "contentType"],
          properties: {
            filename: { type: "string", minLength: 1, maxLength: 220 },
            contentType: { type: "string", minLength: 1, maxLength: 180 },
            byteSize: { type: "integer", minimum: 0, maximum: MAX_FILE_BYTES },
            pageId: { type: ["string", "null"] },
            groupId: { type: ["string", "null"] },
            title: { type: ["string", "null"], maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 600 },
            tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } },
            audience: AUDIENCE_SCHEMA,
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
      const contentType = String(request.body.contentType).split(";")[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.has(contentType)) {
        return reply
          .code(415)
          .send({ error: "type_not_allowed", message: `${contentType} cannot be uploaded here.` });
      }

      const filename = safeFilename(request.body.filename);
      // The key is minted here and the client never names an object. It
      // carries the org id so an object found loose in the bucket can be
      // placed, and a random segment so two people uploading "notes.pdf" on
      // the same day do not overwrite each other.
      const storageKey = `org/${org(request)}/drive/${crypto.randomUUID()}/${encodeURIComponent(filename)}`;

      const reserved = await reserveFile({
        orgId: org(request),
        pageId: request.body.pageId ?? null,
        groupId: request.body.groupId ?? null,
        uploadedBy: who(request),
        filename,
        title: request.body.title ?? null,
        description: request.body.description ?? null,
        contentType,
        byteSize: request.body.byteSize ?? null,
        storageKey,
        tags: normalizeTags(request.body.tags),
        audience: request.body.audience ?? null,
      });
      if (!reserved.ok) {
        return reply.code(400).send({ error: reserved.reason, message: "Could not start that upload." });
      }

      return {
        fileId: reserved.attachment.id,
        uploadUrl: signGcsUrl({
          objectName: storageKey,
          method: "PUT",
          expiresSeconds: UPLOAD_TTL_SECONDS,
          contentType,
        }),
        contentType,
        expiresIn: UPLOAD_TTL_SECONDS,
        maxBytes: MAX_FILE_BYTES,
      };
    },
  );

  app.post("/v1/org/files/:fileId", asMember, async (request, reply) => {
    const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.fileId,
      viewerId: who(request),
    });
    if (!row) return reply.code(404).send({ error: "not_found", message: "No such upload." });

    // NEVER TRUST THE CLIENT FOR THE SIZE. Ask the bucket. A row pointing at a
    // 400MB object is a bill nobody agreed to.
    let stat;
    try {
      stat = await statGcsObject(row.storage_key);
    } catch (err) {
      request.log?.error?.({ err: err?.message }, "[org-drive] stat failed");
      return reply
        .code(502)
        .send({ error: "storage_unreachable", message: "Could not verify that upload." });
    }
    if (!stat.exists) {
      return reply
        .code(409)
        .send({ error: "upload_missing", message: "That file never finished uploading." });
    }
    if (stat.size > MAX_FILE_BYTES) {
      await deleteGcsObject(row.storage_key).catch(() => null);
      await deleteAttachment({ orgId: org(request), attachmentId: row.id });
      return reply.code(413).send({ error: "too_large", message: "That file is over the 100MB limit." });
    }

    const { markAttachmentReady } = await import("../db/org-knowledge-store.js");
    const ready = await markAttachmentReady({
      orgId: org(request),
      attachmentId: row.id,
      byteSize: stat.size,
    });
    if (!ready.ok) {
      return reply.code(400).send({ error: ready.reason, message: "Could not finish that upload." });
    }

    /*
     * AND NOW THE WORDS, if there are any to get.
     *
     * Everything from here is best-effort by design. The upload has already
     * succeeded; this only decides whether the file can later be found by what
     * is inside it.
     */
    let extraction = { status: "unsupported", text: null };
    const readable = extractable(row.content_type, stat.size);
    const viewable = describable(row.content_type, stat.size);

    if (readable || viewable) {
      try {
        const url = signGcsUrl({
          objectName: row.storage_key,
          method: "GET",
          expiresSeconds: 120,
        });
        const res = await fetch(url);
        if (res.ok) {
          const bytes = Buffer.from(await res.arrayBuffer());
          /*
           * A DOCUMENT IS READ. AN IMAGE IS LOOKED AT.
           *
           * Both end up as words in the same column, which is why the search,
           * the ranking and the "why this matched" fragment all work on
           * images without knowing images exist.
           */
          extraction = readable
            ? await extractText(bytes, row.content_type)
            : await describeImage(bytes, row.content_type, row.filename);
        } else {
          extraction = { status: "failed", text: null };
        }
      } catch (err) {
        request.log?.warn?.({ err: String(err) }, "[org-drive] extraction failed");
        extraction = { status: "failed", text: null };
      }
    } else if (stat.size > MAX_EXTRACT_BYTES) {
      extraction = { status: "too_large", text: null };
    }

    await setExtraction({
      orgId: org(request),
      attachmentId: row.id,
      status: extraction.status,
      text: extraction.text,
    }).catch(() => null);

    const [file] = await listFiles({
      orgId: org(request), limit: 1, pageId: row.page_id ?? null, viewerId: who(request),
    })
      .then((r) => r.filter((f) => String(f.id) === String(row.id)))
      .catch(() => []);

    return {
      file: file ?? { ...ready.attachment, extract_status: extraction.status },
      searchable: extraction.status === "ready",
    };
  });

  app.get("/v1/org/files/:fileId/url", asMember, async (request, reply) => {
    const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.fileId,
      viewerId: who(request),
    });
    if (!row || row.status !== "ready") {
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

  app.patch(
    "/v1/org/files/:fileId",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          properties: {
            title: { type: ["string", "null"], maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 600 },
            groupId: { type: ["string", "null"] },
            pageId: { type: ["string", "null"] },
            tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 40 } },
            audience: AUDIENCE_SCHEMA,
          },
        },
      },
    },
    async (request, reply) => {
      const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.fileId,
      viewerId: who(request),
    });
      if (!row) return reply.code(404).send({ error: "not_found", message: "No such file." });

      const body = { ...request.body };
      if (body.tags !== undefined) body.tags = normalizeTags(body.tags);

      const result = await updateFile({
        orgId: org(request),
        attachmentId: row.id,
        actorId: who(request),
        ...body,
      });
      if (!result.ok) {
        return reply.code(400).send({ error: result.reason, message: "Could not save that." });
      }
      return {
        file: result.attachment,
        audience: await getAudience({ orgId: org(request), itemType: "file", itemId: row.id }),
        reach: await audienceReach({ orgId: org(request), itemType: "file", itemId: row.id }),
      };
    },
  );

  app.delete("/v1/org/files/:fileId", asMember, async (request, reply) => {
    const row = await getAttachment({
      orgId: org(request),
      attachmentId: request.params.fileId,
      viewerId: who(request),
    });
    if (!row) return reply.code(404).send({ error: "not_found", message: "No such file." });
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
}
