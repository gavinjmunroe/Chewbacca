/**
 * ORG KNOWLEDGE — pages, their revision ledger, attachments, and the feed.
 *
 * Every function here takes an orgId and puts it in the WHERE clause of every
 * statement. That is redundant with the composite foreign keys the migration
 * installed, and deliberately so: the keys stop a row from being written across
 * a boundary, and these clauses stop one from being read across it. Neither
 * alone is the whole guarantee.
 *
 * WHAT IS NOT HERE. No function returns a page to a caller who has not already
 * been resolved to a membership in that organization -- that resolution lives
 * in the route layer, where the token is. A store that checked permissions
 * would be a store that sometimes forgot to.
 */

import { query } from "./sql.js";
import { slugify } from "./org-store.js";
import {
  decorateAudiences,
  filedUnderClause,
  normalizeAudience,
  setAudience,
  visibleClause,
} from "./org-audience-store.js";

/*
 * `handover` is a page about work IN PROGRESS rather than a finished thing:
 * what we are trying to do, what has been tried, what is decided, what is
 * still open. Same table and same audience rules as every other page,
 * because it is a page -- what differs is the prompts the editor shows and
 * the status it carries.
 */
const PAGE_KINDS = new Set(["page", "runbook", "brief", "how_to", "decision", "handover"]);
const WORK_STATUS = new Set(["active", "blocked", "done"]);
const POST_KINDS = new Set(["update", "question", "answer", "intro"]);

/**
 * A slug that is not already taken in this organization.
 *
 * Two people writing "Onboarding" in the same week is the normal case, not the
 * exceptional one, so this appends rather than failing. The suffix is the
 * shortest thing that is still unambiguous in a URL.
 */
async function freeSlug(orgId, title) {
  const base = slugify(title) || "page";
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const { rows } = await query(
      `SELECT 1 FROM org_pages WHERE org_id = $1 AND slug = $2`,
      [orgId, candidate],
    );
    if (rows.length === 0) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * How much of a page changed, in characters.
 *
 * A character count is not a diff and does not pretend to be one. It is the
 * cheapest number that distinguishes the person who wrote the page from the
 * person who fixed a typo in it, which is the only distinction the contributor
 * bar has to make. A real diff would be more honest about moves and reorders
 * and would cost a dependency and a loop over every revision ever written.
 */
export function measureEdit(before, after) {
  const b = String(before ?? "");
  const a = String(after ?? "");
  if (b === a) return { chars_added: 0, chars_removed: 0 };
  // The common prefix and suffix are not the edit; what is left between them
  // is. For an append this correctly reports zero removed.
  let head = 0;
  while (head < b.length && head < a.length && b[head] === a[head]) head += 1;
  let tail = 0;
  while (
    tail < b.length - head &&
    tail < a.length - head &&
    b[b.length - 1 - tail] === a[a.length - 1 - tail]
  ) {
    tail += 1;
  }
  return {
    chars_added: Math.max(0, a.length - head - tail),
    chars_removed: Math.max(0, b.length - head - tail),
  };
}

/* ------------------------------------------------------------------ pages */

export async function createPage({
  orgId,
  title,
  body = "",
  summary = null,
  kind = "page",
  groupId = null,
  tags = [],
  createdBy = null,
  audience = null,
  workStatus = null,
  ownerId = null,
} = {}) {
  const name = String(title ?? "").trim();
  if (!orgId || !name) return { ok: false, reason: "bad_input" };
  const k = PAGE_KINDS.has(kind) ? kind : "page";

  // VALIDATED BEFORE ANYTHING IS WRITTEN. An audience that cannot be honored
  // should not produce a page that exists and is addressed to nobody.
  const want = audience ? normalizeAudience(audience) : null;
  if (want && !want.ok) return want;
  const slug = await freeSlug(orgId, name);

  const { rows } = await query(
    `INSERT INTO org_pages
       (org_id, slug, title, summary, body, kind, group_id, tags, created_by, updated_by,
        work_status, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)
     RETURNING *`,
    [
      orgId, slug, name, summary, String(body ?? ""), k, groupId, tags, createdBy,
      /*
       * A status only on a handover. Giving a runbook one would put a
       * meaningless word on every row in the wiki, which is why the column
       * is nullable rather than defaulted.
       */
      k === "handover" && WORK_STATUS.has(workStatus) ? workStatus : k === "handover" ? "active" : null,
      // Defaults to whoever created it: a handover with nobody to ask is a
      // document nobody picks up.
      k === "handover" ? (ownerId ?? createdBy) : null,
    ],
  );
  const page = rows[0];

  // THE FIRST REVISION IS WRITTEN HERE, not on the first edit. A page whose
  // ledger starts at its second version credits its author to nobody.
  const measure = measureEdit("", page.body);
  await query(
    `INSERT INTO org_page_revisions
       (org_id, page_id, author_id, title, body, change_note, chars_added, chars_removed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orgId, page.id, createdBy, page.title, page.body, "Created", measure.chars_added, 0],
  );

  if (want) {
    const set = await setAudience({
      orgId, itemType: "page", itemId: page.id, audience, actorId: createdBy,
    });
    if (!set.ok) return set;
    page.visibility = set.everyone ? "org" : "restricted";
  }
  return { ok: true, page };
}

export async function updatePage({
  orgId,
  pageId,
  title,
  summary,
  body,
  kind,
  groupId,
  tags,
  changeNote = null,
  authorId = null,
  audience = undefined,
  workStatus = undefined,
  ownerId = undefined,
} = {}) {
  if (!orgId || !pageId) return { ok: false, reason: "bad_input" };
  const want = audience === undefined ? null : normalizeAudience(audience);
  if (want && !want.ok) return want;
  const { rows: before } = await query(
    `SELECT * FROM org_pages WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
    [orgId, pageId],
  );
  if (before.length === 0) return { ok: false, reason: "not_found" };
  const prev = before[0];

  const nextTitle = title === undefined ? prev.title : String(title).trim() || prev.title;
  const nextBody = body === undefined ? prev.body : String(body ?? "");
  const nextSummary = summary === undefined ? prev.summary : summary;
  const nextKind = kind !== undefined && PAGE_KINDS.has(kind) ? kind : prev.kind;
  const nextGroup = groupId === undefined ? prev.group_id : groupId;
  const nextTags = tags === undefined ? prev.tags : tags;
  const nextStatus =
    nextKind !== "handover"
      ? null
      : workStatus !== undefined && WORK_STATUS.has(workStatus)
        ? workStatus
        : (prev.work_status ?? "active");
  const nextOwner =
    nextKind !== "handover" ? null : ownerId !== undefined ? ownerId : prev.owner_id;

  const { rows } = await query(
    `UPDATE org_pages
        SET title = $3, summary = $4, body = $5, kind = $6, group_id = $7,
            tags = $9, updated_by = $8, updated_at = now(),
            work_status = $10, owner_id = $11
      WHERE org_id = $1 AND id = $2
      RETURNING *`,
    [orgId, pageId, nextTitle, nextSummary, nextBody, nextKind, nextGroup, authorId, nextTags,
     nextStatus, nextOwner],
  );

  /*
   * A REVISION IS WRITTEN ONLY WHEN THE TEXT MOVED.
   *
   * Opening a page, touching nothing and pressing save is a thing people do
   * constantly, and recording it would put somebody at the top of the
   * contributor list for a page they have never written a word of.
   */
  const measure = measureEdit(prev.body, nextBody);
  const textChanged = measure.chars_added > 0 || measure.chars_removed > 0 || nextTitle !== prev.title;
  if (textChanged) {
    await query(
      `INSERT INTO org_page_revisions
         (org_id, page_id, author_id, title, body, change_note, chars_added, chars_removed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [orgId, pageId, authorId, nextTitle, nextBody, changeNote,
       measure.chars_added, measure.chars_removed],
    );
  }
  if (want) {
    const set = await setAudience({
      orgId, itemType: "page", itemId: pageId, audience, actorId: authorId,
    });
    if (!set.ok) return set;
    rows[0].visibility = set.everyone ? "org" : "restricted";
  }
  return { ok: true, page: rows[0], recorded: textChanged };
}

export async function archivePage({ orgId, pageId } = {}) {
  if (!orgId || !pageId) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE org_pages SET archived_at = now(), updated_at = now()
      WHERE org_id = $1 AND id = $2 AND archived_at IS NULL`,
    [orgId, pageId],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * The index.
 *
 * Ordered by when it last changed rather than by title, because a wiki's real
 * shape is "what is alive in here" and an alphabetical list hides that
 * completely. The body is not selected: an index that ships every page's full
 * text is a page load that grows with the company.
 */
export async function listPages(
  orgId,
  { groupIds = null, groupId = null, tag = null, limit = 200, viewerId = null } = {},
) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT p.id, p.slug, p.title, p.summary, p.kind, p.group_id, p.tags, p.visibility,
            p.created_at, p.updated_at,
            -- Null on everything that is not a handover, which is what lets a
            -- list show "who has this and is it moving" without a second read.
            p.work_status, p.owner_id,
            o.full_name AS owner_name,
            g.name AS group_name,
            u.amber_id AS updated_by, u.full_name AS updated_by_name,
            (SELECT count(*) FROM org_page_revisions r
              WHERE r.org_id = p.org_id AND r.page_id = p.id) AS revisions,
            (SELECT count(DISTINCT r.author_id) FROM org_page_revisions r
              WHERE r.org_id = p.org_id AND r.page_id = p.id) AS contributors,
            (SELECT count(*) FROM org_page_attachments a
              WHERE a.org_id = p.org_id AND a.page_id = p.id AND a.deleted_at IS NULL) AS files,
            length(p.body) AS body_chars
       FROM org_pages p
       LEFT JOIN org_groups g ON g.org_id = p.org_id AND g.id = p.group_id
       LEFT JOIN users u ON u.amber_id = p.updated_by
       LEFT JOIN users o ON o.amber_id = p.owner_id
      WHERE p.org_id = $1
        AND p.archived_at IS NULL
        AND ($2::uuid[] IS NULL OR p.group_id IS NULL OR p.group_id = ANY($2))
        AND ($4::text IS NULL OR $4 = ANY(p.tags))
        AND ${filedUnderClause({ alias: "p", itemType: "page", group: "$6" })}
        AND ${visibleClause({ alias: "p", itemType: "page", viewer: "$5" })}
      ORDER BY p.updated_at DESC
      LIMIT $3`,
    [orgId, groupIds, limit, tag, viewerId, groupId],
  );
  return decorateAudiences({ orgId, itemType: "page", rows });
}

export async function getPage({ orgId, pageId = null, slug = null, viewerId = null } = {}) {
  if (!orgId || (!pageId && !slug)) return null;
  const { rows } = await query(
    `SELECT p.*, g.name AS group_name,
            c.full_name AS created_by_name, u.full_name AS updated_by_name
       FROM org_pages p
       LEFT JOIN org_groups g ON g.org_id = p.org_id AND g.id = p.group_id
       LEFT JOIN users c ON c.amber_id = p.created_by
       LEFT JOIN users u ON u.amber_id = p.updated_by
      WHERE p.org_id = $1
        AND ($2::uuid IS NULL OR p.id = $2)
        AND ($3::text IS NULL OR p.slug = $3)
        AND p.archived_at IS NULL
        AND ${visibleClause({ alias: "p", itemType: "page", viewer: "$4" })}
      LIMIT 1`,
    [orgId, pageId, slug, viewerId],
  );
  if (!rows[0]) return null;
  await decorateAudiences({ orgId, itemType: "page", rows });
  return rows[0];
}

/**
 * WHO WROTE THIS PAGE.
 *
 * The question the header of every page should be able to answer without
 * anybody clicking anything. Ordered by characters contributed, not by edit
 * count, because somebody who made thirty one-word corrections did not write
 * the page and a count would say they did.
 */
export async function listContributors({ orgId, pageId } = {}) {
  if (!orgId || !pageId) return [];
  const { rows } = await query(
    `SELECT r.author_id,
            u.full_name AS name,
            m.title,
            count(*)::int                   AS edits,
            sum(r.chars_added)::int         AS chars_added,
            sum(r.chars_removed)::int       AS chars_removed,
            min(r.created_at)               AS first_edit,
            max(r.created_at)               AS last_edit
       FROM org_page_revisions r
       LEFT JOIN users u ON u.amber_id = r.author_id
       LEFT JOIN org_members m ON m.org_id = r.org_id AND m.amber_id = r.author_id
      WHERE r.org_id = $1 AND r.page_id = $2
      GROUP BY r.author_id, u.full_name, m.title
      ORDER BY sum(r.chars_added) DESC, max(r.created_at) DESC`,
    [orgId, pageId],
  );
  return rows;
}

export async function listRevisions({ orgId, pageId, limit = 50 } = {}) {
  if (!orgId || !pageId) return [];
  const { rows } = await query(
    `SELECT r.id, r.author_id, u.full_name AS author_name, r.title, r.change_note,
            r.chars_added, r.chars_removed, r.created_at
       FROM org_page_revisions r
       LEFT JOIN users u ON u.amber_id = r.author_id
      WHERE r.org_id = $1 AND r.page_id = $2
      ORDER BY r.created_at DESC
      LIMIT $3`,
    [orgId, pageId, limit],
  );
  return rows;
}

/**
 * SEARCH, over title, summary and body at once.
 *
 * plainto_tsquery rather than to_tsquery because the input is whatever
 * somebody typed into a box, and to_tsquery throws on an apostrophe.
 */
export async function searchPages({ orgId, q, limit = 25, viewerId = null } = {}) {
  const text = String(q ?? "").trim();
  if (!orgId || text.length < 2) return [];
  const { rows } = await query(
    `SELECT p.id, p.slug, p.title, p.summary, p.kind, p.tags, p.updated_at,
            g.name AS group_name,
            ts_headline('english', p.body, plainto_tsquery('english', $2),
                        'MaxFragments=1,MaxWords=28,MinWords=12,StartSel=<<,StopSel=>>') AS excerpt,
            ts_rank(to_tsvector('english',
                      coalesce(p.title,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.body,'')),
                    plainto_tsquery('english', $2)) AS rank
       FROM org_pages p
       LEFT JOIN org_groups g ON g.org_id = p.org_id AND g.id = p.group_id
      WHERE p.org_id = $1
        AND p.archived_at IS NULL
        AND to_tsvector('english',
              coalesce(p.title,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.body,''))
            @@ plainto_tsquery('english', $2)
        AND ${visibleClause({ alias: "p", itemType: "page", viewer: "$4" })}
      ORDER BY rank DESC, p.updated_at DESC
      LIMIT $3`,
    [orgId, text, limit, viewerId],
  );
  return rows;
}

/* ------------------------------------------------------------ attachments */

export async function addAttachment({
  orgId, pageId, uploadedBy = null, filename, contentType, byteSize = null, storageKey,
} = {}) {
  if (!orgId || !pageId || !filename || !storageKey) return { ok: false, reason: "bad_input" };
  const { rows } = await query(
    `INSERT INTO org_page_attachments
       (org_id, page_id, uploaded_by, filename, content_type, byte_size, storage_key, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [orgId, pageId, uploadedBy, filename,
     contentType || "application/octet-stream", byteSize, storageKey],
  );
  return { ok: true, attachment: rows[0] };
}

export async function markAttachmentReady({ orgId, attachmentId, byteSize = null } = {}) {
  const { rows } = await query(
    `UPDATE org_page_attachments
        SET status = 'ready', byte_size = COALESCE($3, byte_size)
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
      RETURNING *`,
    [orgId, attachmentId, byteSize],
  );
  return rows[0] ? { ok: true, attachment: rows[0] } : { ok: false, reason: "not_found" };
}

export async function listAttachments({ orgId, pageId, viewerId = null } = {}) {
  if (!orgId || !pageId) return [];
  const { rows } = await query(
    `SELECT a.id, a.filename, a.content_type, a.byte_size, a.storage_key, a.status,
            a.created_at, a.uploaded_by, u.full_name AS uploaded_by_name
       FROM org_page_attachments a
       LEFT JOIN users u ON u.amber_id = a.uploaded_by
      WHERE a.org_id = $1 AND a.page_id = $2 AND a.deleted_at IS NULL
        AND ${visibleClause({ alias: "a", itemType: "file", viewer: "$3" })}
      ORDER BY a.created_at DESC`,
    [orgId, pageId, viewerId],
  );
  return rows;
}

export async function getAttachment({ orgId, attachmentId, viewerId = null } = {}) {
  if (!orgId || !attachmentId) return null;
  const { rows } = await query(
    `SELECT a.* FROM org_page_attachments a
      WHERE a.org_id = $1 AND a.id = $2 AND a.deleted_at IS NULL
        AND ${visibleClause({ alias: "a", itemType: "file", viewer: "$3" })}`,
    [orgId, attachmentId, viewerId],
  );
  return rows[0] ?? null;
}

export async function deleteAttachment({ orgId, attachmentId } = {}) {
  const { rowCount } = await query(
    `UPDATE org_page_attachments SET deleted_at = now()
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, attachmentId],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/* ------------------------------------------------------------------ posts */

export async function createPost({
  orgId, authorId = null, kind = "update", title = null, body, groupId = null, parentId = null,
  audience = null,
} = {}) {
  const text = String(body ?? "").trim();
  if (!orgId || !text) return { ok: false, reason: "bad_input" };
  const k = POST_KINDS.has(kind) ? kind : "update";

  /*
   * AN ANSWER INHERITS ITS QUESTION'S AUDIENCE and cannot set its own. A reply
   * narrower than the thread is invisible under the post it answers; a reply
   * wider than it would quote a restricted question to people who were never
   * shown it.
   */
  const want = parentId || !audience ? null : normalizeAudience(audience);
  if (want && !want.ok) return want;

  // An answer is an answer to something. Anything else with a parent is a
  // reply shape this feed does not have.
  if (parentId && k !== "answer") return { ok: false, reason: "bad_kind" };
  if (parentId) {
    const { rows } = await query(
      `SELECT id, parent_id FROM org_posts
        WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [orgId, parentId],
    );
    if (rows.length === 0) return { ok: false, reason: "no_parent" };
    // One level. Replying to an answer would make this a thread.
    if (rows[0].parent_id) return { ok: false, reason: "too_deep" };
  }

  const { rows } = await query(
    `INSERT INTO org_posts (org_id, author_id, kind, title, body, group_id, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [orgId, authorId, k, title, text, groupId, parentId],
  );
  const post = rows[0];

  /*
   * THE AUTHOR'S NAME, BECAUSE THE CLIENT RENDERS THIS ROW DIRECTLY.
   *
   * RETURNING * gives the columns of org_posts, and author_name is a join in
   * listFeed rather than a column here. A client that showed the created post
   * without refetching -- which is the whole point of returning it -- showed
   * the sender's own message as "Someone", by their own name, in their own
   * workspace.
   *
   * One small select on a path that has already done an insert. The
   * alternative is every caller refetching the list to learn a name it
   * already knew, which is the round trip this exists to avoid.
   */
  if (post && authorId) {
    const { rows: who } = await query(
      `SELECT u.full_name, m.title
         FROM users u
         LEFT JOIN org_members m ON m.org_id = $2::uuid AND m.amber_id = u.amber_id
        WHERE u.amber_id = $1::uuid`,
      [authorId, orgId],
    );
    post.author_name = who[0]?.full_name ?? null;
    post.author_title = who[0]?.title ?? null;
  }
  // The shape listFeed returns, so a row from here renders identically.
  post.answers = 0;
  post.reactions = [];
  post.answer_names = [];
  post.files = 0;
  post.mentions_me = false;

  if (parentId) {
    // Copy the parent's audience verbatim, column and rows both.
    await query(
      `UPDATE org_posts SET visibility = (
         SELECT visibility FROM org_posts WHERE org_id = $1 AND id = $3)
        WHERE org_id = $1 AND id = $2`,
      [orgId, post.id, parentId],
    );
    await query(
      `INSERT INTO org_audiences (org_id, item_type, item_id, kind, ref, created_by)
       SELECT org_id, 'post', $2, kind, ref, $4
         FROM org_audiences
        WHERE org_id = $1 AND item_type = 'post' AND item_id = $3
       ON CONFLICT DO NOTHING`,
      [orgId, post.id, parentId, authorId],
    );
  } else if (want) {
    const set = await setAudience({
      orgId, itemType: "post", itemId: post.id, audience, actorId: authorId,
    });
    if (!set.ok) return set;
    post.visibility = set.everyone ? "org" : "restricted";
  }
  return { ok: true, post };
}

/**
 * The feed: top-level posts, newest first, each carrying its answer count.
 *
 * `answers` is selected here rather than fetched per post because a feed that
 * issues one query per row is a feed that is fine with twelve posts in it.
 */
export async function listFeed({
  orgId, groupId = null, kind = null, limit = 60, viewerId = null,
} = {}) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT p.id, p.kind, p.title, p.body, p.group_id, p.visibility, p.created_at, p.edited_at,
            p.accepted_at, p.author_id, p.pinned_at, p.source,
            u.full_name AS author_name, m.title AS author_title,
            g.name AS group_name,
            (SELECT count(*)::int FROM org_posts a
              WHERE a.org_id = p.org_id AND a.parent_id = p.id AND a.deleted_at IS NULL) AS answers,
            /*
             * WHO REPLIED, not just how many. A thread headed "3 replies" tells
             * somebody nothing about whether it is worth opening; the three
             * faces tell them whether the person who knows the answer is
             * already in it.
             */
            (SELECT array_agg(DISTINCT au.full_name)
               FROM org_posts a
               LEFT JOIN users au ON au.amber_id = a.author_id
              WHERE a.org_id = p.org_id AND a.parent_id = p.id AND a.deleted_at IS NULL
             ) AS answer_names,
            (SELECT max(a.created_at) FROM org_posts a
              WHERE a.org_id = p.org_id AND a.parent_id = p.id AND a.deleted_at IS NULL
             ) AS last_reply_at,
            /*
             * REACTIONS AS ONE AGGREGATED COLUMN rather than a second query
             * per post. {emoji, count, mine} is everything the row renders.
             */
            COALESCE((
              SELECT jsonb_agg(x ORDER BY x->>'emoji')
                FROM (
                  SELECT jsonb_build_object(
                           'emoji', r.emoji,
                           'count', count(*)::int,
                           'mine', bool_or(r.amber_id = $5::uuid)
                         ) AS x
                    FROM org_post_reactions r
                   WHERE r.org_id = p.org_id AND r.post_id = p.id
                   GROUP BY r.emoji
                ) agg
            ), '[]'::jsonb) AS reactions,
            EXISTS (
              SELECT 1 FROM org_post_mentions mn
               WHERE mn.org_id = p.org_id AND mn.post_id = p.id
                 AND mn.amber_id = $5::uuid
            ) AS mentions_me,
            (SELECT count(*)::int FROM org_page_attachments f
              WHERE f.org_id = p.org_id AND f.post_id = p.id AND f.deleted_at IS NULL
             ) AS files
       FROM org_posts p
       LEFT JOIN users u ON u.amber_id = p.author_id
       LEFT JOIN org_members m ON m.org_id = p.org_id AND m.amber_id = p.author_id
       LEFT JOIN org_groups g ON g.org_id = p.org_id AND g.id = p.group_id
      WHERE p.org_id = $1
        AND p.parent_id IS NULL
        AND p.deleted_at IS NULL
        AND ($3::text IS NULL OR p.kind = $3)
        AND ${filedUnderClause({ alias: "p", itemType: "post", group: "$2" })}
        AND ${visibleClause({ alias: "p", itemType: "post", viewer: "$5" })}
      /*
       * PINNED FIRST, THEN NEWEST. A pinned post is the announcement somebody
       * decided must not scroll away, so it has to survive the one thing a
       * feed does by default.
       */
      ORDER BY (p.pinned_at IS NOT NULL) DESC, p.pinned_at DESC, p.created_at DESC
      LIMIT $4`,
    [orgId, groupId, kind, limit, viewerId],
  );
  return decorateAudiences({ orgId, itemType: "post", rows });
}

/**
 * HOW MANY POSTS THIS PERSON HAS NOT SEEN.
 *
 * Their own posts are excluded -- a badge that appears the moment you post
 * something is a badge telling you about yourself -- and the audience
 * predicate is applied, so a restricted post nobody showed you does not show
 * up as a number you cannot clear by looking.
 *
 * A person with no watermark has never opened the feed, which is not the same
 * as having read everything: they get the full count, capped so the rail says
 * "99+" rather than a four-digit number.
 */
export async function unreadFeedCount({ orgId, viewerId } = {}) {
  if (!orgId || !viewerId) return 0;
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM org_posts p
      WHERE p.org_id = $1
        AND p.parent_id IS NULL
        AND p.deleted_at IS NULL
        AND p.author_id IS DISTINCT FROM $2::uuid
        AND p.created_at > COALESCE(
              (SELECT r.last_seen_at FROM org_feed_reads r
                WHERE r.org_id = $1 AND r.amber_id = $2),
              '-infinity'::timestamptz)
        AND ${visibleClause({ alias: "p", itemType: "post", viewer: "$2" })}`,
    [orgId, viewerId],
  );
  return rows[0]?.n ?? 0;
}

/** Called when somebody opens the feed. Idempotent, one round trip. */
export async function markFeedSeen({ orgId, viewerId } = {}) {
  if (!orgId || !viewerId) return { ok: false, reason: "bad_input" };
  await query(
    `INSERT INTO org_feed_reads (org_id, amber_id, last_seen_at)
     VALUES ($1, $2, now())
     ON CONFLICT (org_id, amber_id) DO UPDATE SET last_seen_at = now()`,
    [orgId, viewerId],
  );
  return { ok: true };
}

export async function listAnswers({ orgId, postId, viewerId = null } = {}) {
  if (!orgId || !postId) return [];
  const { rows } = await query(
    `SELECT p.id, p.body, p.created_at, p.accepted_at, p.author_id,
            u.full_name AS author_name, m.title AS author_title,
            /*
             * A REPLY CAN BE REACTED TO, SO IT HAS TO CARRY ITS REACTIONS.
             *
             * An answer is an org_posts row like any other, so the react
             * endpoint already worked on one -- but this read never returned
             * them, so a thumbs-up on a reply vanished on the next refresh
             * and looked like the button was broken. Same aggregate the feed
             * uses, so a reply renders with the same component as a message.
             */
            COALESCE((
              SELECT jsonb_agg(x ORDER BY x->>'emoji')
                FROM (
                  SELECT jsonb_build_object(
                           'emoji', r.emoji,
                           'count', count(*)::int,
                           'mine', bool_or(r.amber_id = $3::uuid)
                         ) AS x
                    FROM org_post_reactions r
                   WHERE r.org_id = p.org_id AND r.post_id = p.id
                   GROUP BY r.emoji
                ) agg
            ), '[]'::jsonb) AS reactions
       FROM org_posts p
       LEFT JOIN users u ON u.amber_id = p.author_id
       LEFT JOIN org_members m ON m.org_id = p.org_id AND m.amber_id = p.author_id
      WHERE p.org_id = $1 AND p.parent_id = $2 AND p.deleted_at IS NULL
        AND ${visibleClause({ alias: "p", itemType: "post", viewer: "$3" })}
      ORDER BY p.accepted_at NULLS LAST, p.created_at ASC`,
    [orgId, postId, viewerId],
  );
  return rows;
}

export async function acceptAnswer({ orgId, postId, answerId, askerId } = {}) {
  if (!orgId || !postId || !answerId) return { ok: false, reason: "bad_input" };
  // Only the person who asked closes their own question. An admin marking
  // somebody else's question answered is a judgment they are not in a
  // position to make.
  const { rows } = await query(
    `SELECT author_id FROM org_posts
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, postId],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  if (String(rows[0].author_id ?? "") !== String(askerId ?? "")) {
    return { ok: false, reason: "not_asker" };
  }
  await query(
    `UPDATE org_posts SET accepted_at = NULL
      WHERE org_id = $1 AND parent_id = $2`,
    [orgId, postId],
  );
  const { rowCount } = await query(
    `UPDATE org_posts SET accepted_at = now()
      WHERE org_id = $1 AND id = $2 AND parent_id = $3 AND deleted_at IS NULL`,
    [orgId, answerId, postId],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function deletePost({ orgId, postId, actorId, isAdmin = false } = {}) {
  const { rows } = await query(
    `SELECT author_id FROM org_posts
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, postId],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  if (!isAdmin && String(rows[0].author_id ?? "") !== String(actorId ?? "")) {
    return { ok: false, reason: "not_yours" };
  }
  await query(
    `UPDATE org_posts SET deleted_at = now() WHERE org_id = $1 AND id = $2`,
    [orgId, postId],
  );
  return { ok: true };
}

/* -------------------------------------------------------------- expertise */

/**
 * WHO KNOWS ABOUT THIS, derived from what people have actually written.
 *
 * The scoring is three numbers and a weight each, and the weights are an
 * opinion rather than a measurement -- which is why they are here, in one
 * place, named, instead of spread through a query somebody would have to
 * reverse-engineer:
 *
 *   characters written on a matching page   the strongest signal, because it is
 *                                           the most expensive to fake
 *   accepted answers to matching questions  somebody else said this helped
 *   answers at all                          weak, but not nothing
 *
 * It is capped per page so that one enormous document does not make its author
 * the company's expert on everything that document mentions.
 */
export async function expertsOn({ orgId, topic, limit = 8 } = {}) {
  const text = String(topic ?? "").trim();
  if (!orgId || text.length < 2) return [];
  const { rows } = await query(
    `WITH matched AS (
       SELECT p.id
         FROM org_pages p
        WHERE p.org_id = $1 AND p.archived_at IS NULL
          AND to_tsvector('english',
                coalesce(p.title,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.body,''))
              @@ plainto_tsquery('english', $2)
     ),
     written AS (
       SELECT r.author_id,
              sum(LEAST(sum_added, 4000)) AS weight
         FROM (
           SELECT r2.author_id, r2.page_id, sum(r2.chars_added) AS sum_added
             FROM org_page_revisions r2
             JOIN matched ON matched.id = r2.page_id
            WHERE r2.org_id = $1 AND r2.author_id IS NOT NULL
            GROUP BY r2.author_id, r2.page_id
         ) r
        GROUP BY r.author_id
     ),
     answered AS (
       SELECT a.author_id,
              count(*) FILTER (WHERE a.accepted_at IS NOT NULL) AS accepted,
              count(*)                                          AS total
         FROM org_posts a
         JOIN org_posts q
           ON q.org_id = a.org_id AND q.id = a.parent_id AND q.kind = 'question'
        WHERE a.org_id = $1 AND a.deleted_at IS NULL AND a.author_id IS NOT NULL
          AND to_tsvector('english', coalesce(q.title,'') || ' ' || coalesce(q.body,''))
              @@ plainto_tsquery('english', $2)
        GROUP BY a.author_id
     )
     SELECT m.amber_id, u.full_name AS name, m.title, m.bio,
            COALESCE(w.weight, 0)::int   AS chars_written,
            COALESCE(an.accepted, 0)::int AS accepted_answers,
            COALESCE(an.total, 0)::int    AS answers,
            (COALESCE(w.weight, 0) / 500.0
             + COALESCE(an.accepted, 0) * 6
             + COALESCE(an.total, 0) * 1.5)::numeric(10,2) AS score
       FROM org_members m
       JOIN users u ON u.amber_id = m.amber_id
       LEFT JOIN written  w  ON w.author_id  = m.amber_id
       LEFT JOIN answered an ON an.author_id = m.amber_id
      WHERE m.org_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL
        AND (w.weight IS NOT NULL OR an.total IS NOT NULL)
      ORDER BY score DESC
      LIMIT $3`,
    [orgId, text, limit],
  );
  return rows;
}

/** One person's visible contribution, for their profile. */
export async function contributionsBy({ orgId, amberId, limit = 20 } = {}) {
  if (!orgId || !amberId) return { pages: [], answers: [], totals: null };
  const [pages, answers, totals] = await Promise.all([
    query(
      `SELECT p.id, p.slug, p.title,
              sum(r.chars_added)::int AS chars_added,
              count(*)::int           AS edits,
              max(r.created_at)       AS last_edit
         FROM org_page_revisions r
         JOIN org_pages p ON p.org_id = r.org_id AND p.id = r.page_id
        WHERE r.org_id = $1 AND r.author_id = $2 AND p.archived_at IS NULL
        GROUP BY p.id, p.slug, p.title
        ORDER BY max(r.created_at) DESC
        LIMIT $3`,
      [orgId, amberId, limit],
    ),
    query(
      `SELECT a.id, a.body, a.created_at, a.accepted_at,
              q.id AS question_id, q.title AS question_title
         FROM org_posts a
         JOIN org_posts q ON q.org_id = a.org_id AND q.id = a.parent_id
        WHERE a.org_id = $1 AND a.author_id = $2 AND a.deleted_at IS NULL
        ORDER BY a.created_at DESC
        LIMIT $3`,
      [orgId, amberId, limit],
    ),
    query(
      `SELECT
         (SELECT count(DISTINCT page_id)::int FROM org_page_revisions
           WHERE org_id = $1 AND author_id = $2)                       AS pages_touched,
         (SELECT COALESCE(sum(chars_added), 0)::int FROM org_page_revisions
           WHERE org_id = $1 AND author_id = $2)                       AS chars_written,
         (SELECT count(*)::int FROM org_posts
           WHERE org_id = $1 AND author_id = $2 AND deleted_at IS NULL
             AND parent_id IS NOT NULL)                                AS answers,
         (SELECT count(*)::int FROM org_posts
           WHERE org_id = $1 AND author_id = $2 AND deleted_at IS NULL
             AND accepted_at IS NOT NULL)                              AS accepted_answers`,
      [orgId, amberId],
    ),
  ]);
  return { pages: pages.rows, answers: answers.rows, totals: totals.rows[0] ?? null };
}

/** The profile fields a member writes about themselves. */
export async function setMemberProfile({ orgId, amberId, title, location, bio } = {}) {
  if (!orgId || !amberId) return { ok: false, reason: "bad_input" };
  const { rows } = await query(
    `UPDATE org_members
        SET title    = COALESCE($3, title),
            location = COALESCE($4, location),
            bio      = COALESCE($5, bio),
            updated_at = now()
      WHERE org_id = $1 AND amber_id = $2 AND deleted_at IS NULL
      RETURNING amber_id, role, title, location, bio`,
    [orgId, amberId,
     title === undefined ? null : title,
     location === undefined ? null : location,
     bio === undefined ? null : bio],
  );
  return rows[0] ? { ok: true, member: rows[0] } : { ok: false, reason: "not_found" };
}

/**
 * THE NUMBERS ON THE FRONT PAGE.
 *
 * One round trip, because this renders above the fold and five sequential
 * counts is five sequential round trips to Cloud SQL.
 */
export async function knowledgeStats(orgId) {
  if (!orgId) return null;
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM org_pages
         WHERE org_id = $1 AND archived_at IS NULL)                     AS pages,
       (SELECT count(*)::int FROM org_page_revisions
         WHERE org_id = $1)                                             AS revisions,
       (SELECT count(DISTINCT author_id)::int FROM org_page_revisions
         WHERE org_id = $1 AND author_id IS NOT NULL)                   AS contributors,
       (SELECT count(*)::int FROM org_page_attachments
         WHERE org_id = $1 AND deleted_at IS NULL)                      AS files,
       (SELECT count(*)::int FROM org_posts
         WHERE org_id = $1 AND deleted_at IS NULL AND parent_id IS NULL) AS posts,
       (SELECT count(*)::int FROM org_posts q
         WHERE q.org_id = $1 AND q.deleted_at IS NULL AND q.kind = 'question'
           AND NOT EXISTS (SELECT 1 FROM org_posts a
                            WHERE a.org_id = q.org_id AND a.parent_id = q.id
                              AND a.deleted_at IS NULL))                AS open_questions,
       (SELECT max(updated_at) FROM org_pages WHERE org_id = $1)        AS last_edit`,
    [orgId],
  );
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ drive */

/**
 * THE DRIVE.
 *
 * A file has three independent facts about it -- the page it is attached to,
 * the team it is filed under, and its tags -- and none of them is required.
 * These functions exist because the attachment queries above assume a page,
 * and a drive is exactly the set of files that do not have one to assume.
 */

/** Create a file row that may have no page at all. */
export async function reserveFile({
  orgId,
  pageId = null,
  groupId = null,
  uploadedBy = null,
  filename,
  title = null,
  description = null,
  contentType,
  byteSize = null,
  storageKey,
  tags = [],
  audience = null,
} = {}) {
  if (!orgId || !filename || !storageKey) return { ok: false, reason: "bad_input" };
  const want = audience ? normalizeAudience(audience) : null;
  if (want && !want.ok) return want;
  const { rows } = await query(
    `INSERT INTO org_page_attachments
       (org_id, page_id, group_id, uploaded_by, filename, title, description,
        content_type, byte_size, storage_key, status, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
     RETURNING *`,
    [orgId, pageId, groupId, uploadedBy, filename, title, description,
     contentType || "application/octet-stream", byteSize, storageKey, tags],
  );
  const attachment = rows[0];
  if (want) {
    const set = await setAudience({
      orgId, itemType: "file", itemId: attachment.id, audience, actorId: uploadedBy,
    });
    if (!set.ok) return set;
    attachment.visibility = set.everyone ? "org" : "restricted";
  }
  return { ok: true, attachment };
}

/**
 * Record what came out of the parser.
 *
 * The status is written even when there is no text, because the four reasons
 * a file has no searchable contents need different things from the person
 * looking at it, and a NULL says none of them.
 */
export async function setExtraction({ orgId, attachmentId, status, text = null } = {}) {
  const { rows } = await query(
    `UPDATE org_page_attachments
        SET extract_status = $3, extracted_text = $4
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
      RETURNING id, extract_status`,
    [orgId, attachmentId, status, text],
  );
  return rows[0] ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function updateFile({
  orgId, attachmentId, title, description, groupId, tags, pageId,
  audience = undefined, actorId = null,
} = {}) {
  if (!orgId || !attachmentId) return { ok: false, reason: "bad_input" };
  const want = audience === undefined ? null : normalizeAudience(audience);
  if (want && !want.ok) return want;
  const { rows } = await query(
    `UPDATE org_page_attachments
        SET title       = CASE WHEN $3::boolean THEN $4 ELSE title END,
            description = CASE WHEN $5::boolean THEN $6 ELSE description END,
            group_id    = CASE WHEN $7::boolean THEN $8::uuid ELSE group_id END,
            tags        = CASE WHEN $9::boolean THEN $10::text[] ELSE tags END,
            page_id     = CASE WHEN $11::boolean THEN $12::uuid ELSE page_id END
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
      RETURNING *`,
    [
      orgId, attachmentId,
      title !== undefined, title ?? null,
      description !== undefined, description ?? null,
      groupId !== undefined, groupId ?? null,
      tags !== undefined, tags ?? null,
      pageId !== undefined, pageId ?? null,
    ],
  );
  if (!rows[0]) return { ok: false, reason: "not_found" };
  if (want) {
    const set = await setAudience({
      orgId, itemType: "file", itemId: attachmentId, audience, actorId,
    });
    if (!set.ok) return set;
    rows[0].visibility = set.everyone ? "org" : "restricted";
  }
  return { ok: true, attachment: rows[0] };
}

/**
 * EVERY FILE IN THE COMPANY, filtered.
 *
 * extracted_text is deliberately NOT selected. It is up to 200,000 characters
 * per row and the listing never shows it -- a drive that ships every file's
 * full text to render a list of filenames is a page load that grows with the
 * company.
 */
export async function listFiles({
  orgId, groupId = null, tag = null, pageId = null, q = null, limit = 300,
  viewerId = null,
} = {}) {
  if (!orgId) return [];
  const text = String(q ?? "").trim();
  const { rows } = await query(
    `SELECT a.id, a.filename, a.title, a.description, a.content_type, a.byte_size,
            a.status, a.extract_status, a.tags, a.visibility,
            a.created_at, a.page_id, a.group_id,
            a.uploaded_by, u.full_name AS uploaded_by_name,
            g.name AS group_name, p.title AS page_title, p.slug AS page_slug,
            /*
             * WHY THIS ROW IS HERE. A file surfacing on a phrase nobody can
             * see in its name looks like a bug; the fragment of its contents
             * that matched is the difference between a result and a surprise.
             */
            CASE
              WHEN $5::text IS NULL THEN NULL
              WHEN a.filename ILIKE '%' || $5 || '%'
                OR coalesce(a.title,'') ILIKE '%' || $5 || '%' THEN NULL
              WHEN coalesce(a.description,'') ILIKE '%' || $5 || '%'
                THEN 'note: ' || a.description
              WHEN EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE t ILIKE '%' || $5 || '%')
                THEN 'tagged'
              ELSE nullif(
                ts_headline('english', coalesce(a.extracted_text,''),
                            plainto_tsquery('english', $5),
                            'MaxFragments=1,MaxWords=20,MinWords=8,StartSel=<<,StopSel=>>'),
                '')
            END AS why
       FROM org_page_attachments a
       LEFT JOIN users u      ON u.amber_id = a.uploaded_by
       LEFT JOIN org_groups g ON g.org_id = a.org_id AND g.id = a.group_id
       LEFT JOIN org_pages p  ON p.org_id = a.org_id AND p.id = a.page_id
      WHERE a.org_id = $1
        AND a.deleted_at IS NULL
        AND a.status = 'ready'
        AND ${filedUnderClause({ alias: "a", itemType: "file", group: "$2" })}
        AND ${visibleClause({ alias: "a", itemType: "file", viewer: "$7" })}
        AND ($3::text IS NULL OR $3 = ANY(a.tags))
        AND ($4::uuid IS NULL OR a.page_id = $4)
        AND (
          $5::text IS NULL
          /*
           * THREE WAYS TO MATCH, AND THE SECOND TWO ARE WHY THIS IS USABLE.
           *
           * Full text handles whole words in the contents, which is the right
           * answer when somebody remembers a phrase from inside the document.
           * But it stems and it tokenizes: "paychex" will not find
           * "Paychex_2026" and "renew" will not find a filename at all, so a
           * search that was only this missed every half-remembered name --
           * which is most of them.
           *
           * ILIKE covers the fragment somebody actually types. It cannot use
           * the GIN index, and that is an acceptable trade on a company's
           * drive rather than a web index: the row count is thousands, the
           * query is already filtered by org_id, and a correct answer slowly
           * beats a fast empty one.
           *
           * The tag match is exact because tags are normalized on write, so
           * there is nothing to be fuzzy about.
           */
          OR to_tsvector('english',
               coalesce(a.title,'') || ' ' || coalesce(a.filename,'') || ' ' ||
               coalesce(a.description,'') || ' ' || array_to_string(a.tags, ' ') || ' ' ||
               coalesce(a.extracted_text,''))
             @@ plainto_tsquery('english', $5)
          OR a.filename ILIKE '%' || $5 || '%'
          OR coalesce(a.title, '') ILIKE '%' || $5 || '%'
          OR coalesce(a.description, '') ILIKE '%' || $5 || '%'
          OR coalesce(a.extracted_text, '') ILIKE '%' || $5 || '%'
          OR EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE t ILIKE '%' || $5 || '%')
        )
      ORDER BY a.created_at DESC
      LIMIT $6`,
    [orgId, groupId, tag, pageId, text.length >= 2 ? text : null, limit, viewerId],
  );
  return decorateAudiences({ orgId, itemType: "file", rows });
}

/**
 * Every tag in use, with how much is on it.
 *
 * Pages and files share one tag vocabulary on purpose, so a filter picked here
 * returns both kinds of thing. Two namespaces that looked alike and did not
 * match would be worse than having none.
 */
export async function listTags(orgId) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT tag,
            sum(files)::int AS files,
            sum(pages)::int AS pages
       FROM (
         SELECT unnest(tags) AS tag, 1 AS files, 0 AS pages
           FROM org_page_attachments
          WHERE org_id = $1 AND deleted_at IS NULL
         UNION ALL
         SELECT unnest(tags) AS tag, 0 AS files, 1 AS pages
           FROM org_pages
          WHERE org_id = $1 AND archived_at IS NULL
       ) t
      GROUP BY tag
      ORDER BY (sum(files) + sum(pages)) DESC, tag ASC
      LIMIT 120`,
    [orgId],
  );
  return rows;
}

/** What the drive's header counts. One round trip. */
export async function driveStats(orgId, { viewerId = null } = {}) {
  if (!orgId) return null;
  const { rows } = await query(
    `SELECT
       count(*)::int                                                   AS files,
       COALESCE(sum(a.byte_size), 0)::bigint                           AS bytes,
       count(*) FILTER (WHERE a.extract_status = 'ready')::int         AS searchable,
       count(*) FILTER (WHERE a.extract_status = 'pending')::int       AS pending,
       count(DISTINCT a.uploaded_by)::int                              AS contributors
     FROM org_page_attachments a
    WHERE a.org_id = $1 AND a.deleted_at IS NULL AND a.status = 'ready'
      AND ${visibleClause({ alias: "a", itemType: "file", viewer: "$2" })}`,
    [orgId, viewerId],
  );
  return rows[0] ?? null;
}

/**
 * HOW MUCH THIS COMPANY TALKED, PER DAY, FOR THE LAST FORTNIGHT.
 *
 * WHY THIS IS A QUERY AND NOT ARITHMETIC ON THE FEED. The obvious
 * implementation is to count the posts the feed already returned, and it is
 * wrong in a way that is invisible until the workspace gets busy: listFeed
 * caps at sixty rows, so a team posting thirty times a day would see two
 * accurate bars and twelve empty ones, and read that as "we stopped using
 * it". A histogram built from a truncated page is a chart that lies more the
 * better the product is doing.
 *
 * generate_series, so a day with nothing is a zero rather than a missing
 * column -- otherwise the strip silently closes the gaps and a quiet week
 * looks like a busy one.
 *
 * Company-wide posts only, for the same reason every other viewer-less count
 * is: a bar is shown to everybody, and a count that moves depending on which
 * private groups you happen to be in leaks their existence.
 */
export async function feedPulse({ orgId, days = 14 } = {}) {
  if (!orgId) return [];
  const { rows } = await query(
    `WITH span AS (
       SELECT generate_series(
         (date_trunc('day', now()) - make_interval(days => $2::int - 1)),
         date_trunc('day', now()),
         interval '1 day'
       ) AS day
     )
     /*
      * to_char, NOT ::date.
      *
      * node-postgres parses a DATE column into a JS Date in the server's
      * timezone, which then stringifies as "Sat Oct 17 2026 …" -- so the
      * browser got "Sat Oct 17" where it expected "2026-10-17", every label
      * read "Invalid Date", and the whole strip lost its axis. A calendar day
      * is a label, not an instant; sending it as text is the only way it
      * survives two timezones and a JSON round trip unchanged.
      */
     SELECT to_char(span.day, 'YYYY-MM-DD') AS day,
            count(p.id)::int AS n
       FROM span
       LEFT JOIN org_posts p
         ON p.org_id = $1::uuid
        AND p.deleted_at IS NULL
        AND p.parent_id IS NULL
        AND p.visibility = 'org'
        AND date_trunc('day', p.created_at) = span.day
      GROUP BY span.day
      ORDER BY span.day`,
    [orgId, days],
  );
  return rows.map((r) => ({ day: String(r.day), n: Number(r.n) }));
}

/**
 * When this person last looked at the feed.
 *
 * The count above answers "is there anything new"; this answers "new since
 * when", which is what a client needs to work out WHICH groups are new
 * without asking the server once per group. One timestamp replaces six
 * round trips, and the arithmetic is the same arithmetic the count does.
 *
 * Null means they have never marked it seen, so everything is new -- which
 * the caller must treat as "no watermark" rather than as the epoch, because
 * a brand new account should not see a badge on every group it can see.
 */
export async function feedSeenAt({ orgId, viewerId } = {}) {
  if (!orgId || !viewerId) return null;
  const { rows } = await query(
    `SELECT last_seen_at FROM org_feed_reads
      WHERE org_id = $1 AND amber_id = $2`,
    [orgId, viewerId],
  );
  return rows[0]?.last_seen_at ?? null;
}
