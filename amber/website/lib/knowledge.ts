/**
 * WHAT THE COMPANY KNOWS, FROM THE BROWSER.
 *
 * Backed by /v1/org/pages, /v1/org/feed and /v1/org/experts on amber-id. Same
 * rules as lib/org.ts: every call goes through `call`, nothing here ever sends
 * an organization id, and the token is read at the moment of the call rather
 * than held in a component.
 *
 * THE UPLOAD IS THREE STEPS AND THAT IS DELIBERATE. The browser asks for a
 * signed URL, PUTs the bytes straight to storage, then tells the server to look
 * and confirm. The file never passes through amber-id, so a 50MB deck does not
 * occupy a request worker for the length of somebody's hotel wifi, and the
 * server's record of the file is written only after it has seen it with its own
 * eyes.
 */

import { call, tokenNow } from "./amber";

/**
 * WHO CAN SEE A THING.
 *
 * `everyone` and the two lists are independent, which is the part worth
 * saying out loud: a file can be visible to the whole company AND filed under
 * the founding team, and that is the common case rather than a contradiction.
 * The lists are where it is filed; `everyone` is who may read it.
 */
export type Audience = {
  everyone: boolean;
  groups: { id: string; name: string }[];
  people: { id: string; name: string }[];
};

/**
 * WHO WOULD ACTUALLY SEE IT, counted from the roster.
 *
 * The author is always in their own audience and is never stored as a row, so
 * the one screen where this question cannot be answered is the screen of the
 * person doing the sharing. This comes from the server, computed over live
 * membership, so "it works on mine" stops being possible to conclude.
 */
export type Reach = {
  total: number;
  count: number;
  names: string[];
  excluded: string[];
};

/** What the browser sends. Names are the server's business, ids are ours. */
export type AudienceInput = {
  everyone: boolean;
  groups: string[];
  people: string[];
};

export const EVERYONE: AudienceInput = { everyone: true, groups: [], people: [] };

/** One line for a row: "Everyone", "Founding team", "Maya +2". */
export function audienceLabel(a: Audience | null | undefined): string {
  if (!a) return "Everyone";
  const named = [...a.groups, ...a.people];
  if (a.everyone) return named.length === 0 ? "Everyone" : `Everyone · ${named[0].name}`;
  if (named.length === 0) return "Only you";
  if (named.length === 1) return named[0].name;
  return `${named[0].name} +${named.length - 1}`;
}

export const toAudienceInput = (a: Audience | null | undefined): AudienceInput =>
  a
    ? { everyone: a.everyone, groups: a.groups.map((g) => g.id), people: a.people.map((p) => p.id) }
    : { ...EVERYONE };

export type PageKind = "page" | "runbook" | "brief" | "how_to" | "decision" | "handover";

/** Only a handover carries one. Null on every other kind. */
export type WorkStatus = "active" | "blocked" | "done";
export type PostKind = "update" | "question" | "answer" | "intro";

/*
 * Handover leads, because it is the one people reach for most and the one
 * that does not exist anywhere else: the state of a piece of work in
 * progress, written so somebody else can pick it up today. The other five
 * are all finished artifacts for a reader who arrives later.
 */
export const PAGE_KINDS: PageKind[] = ["handover", "page", "runbook", "brief", "how_to", "decision"];

export const PAGE_KIND_LABEL: Record<PageKind, string> = {
  handover: "Handover",
  page: "Page",
  runbook: "Runbook",
  brief: "Brief",
  how_to: "How-to",
  decision: "Decision",
};

/** What each kind is FOR, so the picker is a decision rather than a guess. */
export const PAGE_KIND_HINT: Record<PageKind, string> = {
  handover:
    "Work in progress, written so somebody else can pick it up. What you are trying to do, what you have tried, what is decided, what is still open.",
  page: "Anything that should be written down once and found later.",
  runbook: "Steps somebody follows under pressure. Written for the worst day.",
  brief: "What we know about a client, an account or a market.",
  how_to: "How a thing is done here, for somebody who has not done it.",
  decision: "What was decided, by whom, and what the alternatives were.",
};

export const POST_KIND_LABEL: Record<PostKind, string> = {
  update: "Update",
  question: "Question",
  answer: "Answer",
  intro: "Intro",
};

export type PageSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  kind: PageKind;
  group_id: string | null;
  group_name: string | null;
  /** Where an import left its provenance: from:artifact, from:skill, … */
  tags?: string[];
  visibility?: "org" | "restricted";
  audience?: Audience;
  updated_at: string;
  created_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  revisions: string | number;
  contributors: string | number;
  files: string | number;
  body_chars: number;
  /** Handovers only. Null everywhere else — see the migration. */
  work_status?: WorkStatus | null;
  owner_id?: string | null;
  owner_name?: string | null;
};

export type Page = PageSummary & {
  body: string;
  created_by: string | null;
  created_by_name: string | null;
};

export type Contributor = {
  author_id: string | null;
  name: string | null;
  title: string | null;
  edits: number;
  chars_added: number;
  chars_removed: number;
  first_edit: string;
  last_edit: string;
};

export type Revision = {
  id: string;
  author_id: string | null;
  author_name: string | null;
  title: string;
  change_note: string | null;
  chars_added: number;
  chars_removed: number;
  created_at: string;
};

export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number | null;
  status: "pending" | "ready" | "failed";
  created_at: string;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
};

export type Post = {
  id: string;
  kind: PostKind;
  title: string | null;
  body: string;
  group_id: string | null;
  group_name: string | null;
  created_at: string;
  edited_at: string | null;
  accepted_at: string | null;
  author_id: string | null;
  author_name: string | null;
  author_title: string | null;
  answers: number;
  visibility?: "org" | "restricted";
  audience?: Audience;

  /* ---- the cheap gestures, added so a thread stays readable ---- */

  pinned_at?: string | null;
  /** [{emoji, count, mine}] — everything the reaction row renders. */
  reactions?: PostReaction[];
  /** True when this post addresses the viewer by name. */
  mentions_me?: boolean;
  /** Who has replied, for faces on the thread rather than a bare count. */
  answer_names?: string[] | null;
  last_reply_at?: string | null;
  files?: number;
  files_list?: PostFile[];
  /**
   * Set when a machine wrote this, carrying the name of the key that did.
   *
   * author_id is null in that case and deliberately so: attributing an API
   * post to the admin who minted the key puts words in a person's mouth. The
   * chat renders this instead, with an "app" badge, so nobody replies to a
   * cron job expecting an answer.
   */
  source?: string | null;
};

export type PostReaction = { emoji: string; count: number; mine: boolean };
export type PostFile = {
  id: string;
  filename: string;
  title: string | null;
  contentType: string;
  byteSize: number | string | null;
};

/**
 * The six, and no more.
 *
 * Free-form emoji becomes a second messaging channel nobody can search. These
 * cover what a reaction is FOR at work — read it, agree, on it, nice, funny,
 * confused — and the server rejects anything else.
 */
export const REACTIONS = ["👍", "🎉", "❤️", "👀", "😄", "🤔"] as const;

export const REACTION_MEANING: Record<string, string> = {
  "👍": "Agree",
  "🎉": "Nice",
  "❤️": "Love it",
  "👀": "Looking at it",
  "😄": "Funny",
  "🤔": "Not sure",
};

export type Answer = {
  id: string;
  body: string;
  created_at: string;
  accepted_at: string | null;
  author_id: string | null;
  author_name: string | null;
  author_title: string | null;
  /** A reply is a post, so it reacts like one. */
  reactions?: PostReaction[];
};

export type Expert = {
  amber_id: string;
  name: string | null;
  title: string | null;
  bio: string | null;
  chars_written: number;
  accepted_answers: number;
  answers: number;
  score: string;
};

export type KnowledgeStats = {
  pages: number;
  revisions: number;
  contributors: number;
  files: number;
  posts: number;
  open_questions: number;
  last_edit: string | null;
};

const t = () => tokenNow() ?? undefined;

/* ------------------------------------------------------------------ pages */

export const getKnowledge = () =>
  call<{
    unread?: {
      feed: number;
      /**
       * When this person last looked at the feed, or null if never.
       *
       * One timestamp is what lets the client work out WHICH groups have
       * something new without asking the server once per group.
       */
      seenAt?: string | null;
    };
    stats: KnowledgeStats;
    recent: PageSummary[];
    openQuestions: Post[];
    groups: { id: string; name: string; purpose: string | null }[];
    /**
     * One entry per day for the last fortnight, zeros included.
     *
     * Counted in SQL rather than derived from the feed, which is capped at
     * sixty rows — a busy company would otherwise see two accurate days and
     * twelve empty ones.
     */
    pulse?: { day: string; n: number }[];
    posts?: { fortnight: number; week: number };
  }>("/v1/org/knowledge", {}, t());

/** The feed has been looked at. Clears the rail badge. */
export const markFeedSeen = () =>
  call<{ ok: true; unread: number }>("/v1/org/feed/seen", { method: "POST" }, t());

export const getPages = (opts: { groupId?: string; tag?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.groupId) q.set("groupId", opts.groupId);
  if (opts.tag) q.set("tag", opts.tag);
  const qs = q.toString();
  return call<{ pages: PageSummary[]; count: number }>(
    `/v1/org/pages${qs ? `?${qs}` : ""}`, {}, t());
};

export const searchPages = (q: string) =>
  call<{
    results: (PageSummary & { excerpt: string | null; rank: number })[];
    count: number;
  }>(`/v1/org/pages/search?q=${encodeURIComponent(q)}`, {}, t());

export const getPage = (pageId: string) =>
  call<{
    page: Page;
    contributors: Contributor[];
    files: Attachment[];
    revisions: Revision[];
  }>(`/v1/org/pages/${pageId}`, {}, t());

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

/**
 * The prompts a handover starts with.
 *
 * A blank page is the reason handovers do not get written: somebody opens
 * it, cannot think where to start, and closes it. These five headings are
 * the questions anybody picking the work up will ask in this order, so
 * filling them in is answering rather than composing.
 */
export const HANDOVER_TEMPLATE = [
  "## What we are trying to do",
  "",
  "",
  "## Where it has got to",
  "",
  "",
  "## What has been tried, and what happened",
  "",
  "",
  "## Decisions already made",
  "",
  "(so nobody reopens them)",
  "",
  "## Still open",
  "",
  "",
  "## Where everything is",
  "",
  "Repos, docs, dashboards, the Claude project — whatever you need open to carry on.",
  "",
].join("\n");

export const createPage = (body: {
  title: string;
  summary?: string | null;
  body?: string;
  kind?: PageKind;
  groupId?: string | null;
  audience?: AudienceInput;
  /** Handovers only; the server ignores these on any other kind. */
  workStatus?: WorkStatus | null;
  ownerId?: string | null;
}) => call<{ page: Page }>("/v1/org/pages", { method: "POST", body: JSON.stringify(body) }, t());

export const savePage = (
  pageId: string,
  body: {
    title?: string;
    summary?: string | null;
    body?: string;
    kind?: PageKind;
    groupId?: string | null;
    changeNote?: string | null;
    audience?: AudienceInput;
    workStatus?: WorkStatus | null;
    ownerId?: string | null;
  },
) =>
  call<{ page: Page; recorded: boolean; contributors: Contributor[] }>(
    `/v1/org/pages/${pageId}`,
    { method: "PATCH", body: JSON.stringify(body) },
    t(),
  );

export const archivePage = (pageId: string) =>
  call<{ ok: true }>(`/v1/org/pages/${pageId}`, { method: "DELETE" }, t());

export const getPageAudience = (pageId: string) =>
  call<{ audience: Audience; reach: Reach | null }>(
    `/v1/org/pages/${pageId}/audience`, {}, t());

export const getRevisions = (pageId: string) =>
  call<{ revisions: Revision[] }>(`/v1/org/pages/${pageId}/revisions`, {}, t());

/* ------------------------------------------------------------------ files */

/**
 * Put a file on a page: reserve, PUT, confirm.
 *
 * `onStage` exists so the caller can say which of the three is happening. A
 * progress bar that sits at zero through the reserve and then jumps is worse
 * than a word that says "uploading".
 */
export async function uploadToPage(
  pageId: string,
  file: File,
  onStage?: (stage: "reserving" | "uploading" | "confirming") => void,
): Promise<Attachment> {
  onStage?.("reserving");
  const reserved = await call<{
    attachmentId: string;
    uploadUrl: string;
    contentType: string;
    maxBytes: number;
  }>(
    `/v1/org/pages/${pageId}/files/upload-url`,
    {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
      }),
    },
    t(),
  );

  onStage?.("uploading");
  // The signed URL signs content-type, so this header must be exactly the one
  // the server was given -- not the browser's idea of the file's type, which
  // can differ.
  const put = await fetch(reserved.uploadUrl, {
    method: "PUT",
    headers: { "content-type": reserved.contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

  onStage?.("confirming");
  const done = await call<{ attachment: Attachment }>(
    `/v1/org/pages/${pageId}/files/${reserved.attachmentId}`,
    { method: "POST" },
    t(),
  );
  return done.attachment;
}

export const getFiles = (pageId: string) =>
  call<{ files: Attachment[] }>(`/v1/org/pages/${pageId}`, {}, t()).then((r) => r.files);

export const fileUrl = (pageId: string, attachmentId: string) =>
  call<{ url: string; filename: string; expiresIn: number }>(
    `/v1/org/pages/${pageId}/files/${attachmentId}`,
    {},
    t(),
  );

export const removeFile = (pageId: string, attachmentId: string) =>
  call<{ ok: true }>(
    `/v1/org/pages/${pageId}/files/${attachmentId}`,
    { method: "DELETE" },
    t(),
  );

/* ------------------------------------------------------------------- feed */

export const getFeed = (opts: { kind?: PostKind; groupId?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.kind) q.set("kind", opts.kind);
  if (opts.groupId) q.set("groupId", opts.groupId);
  const qs = q.toString();
  return call<{ posts: Post[]; count: number; mentions: number }>(
    `/v1/org/feed${qs ? `?${qs}` : ""}`, {}, t());
};

/**
 * React, or take it back. The same call does both.
 *
 * Idempotent in the useful sense, so the client never has to know the current
 * state to act and a double-tap cannot strand a reaction.
 */
export const react = (postId: string, emoji: string) =>
  call<{ ok: true; on: boolean }>(
    `/v1/org/feed/${postId}/react`,
    { method: "POST", body: JSON.stringify({ emoji }) },
    t(),
  );

/** Who reacted, by name — "Maya, Sagar and 5 others" rather than "7". */
export const whoReacted = (postId: string) =>
  call<{ reactions: { emoji: string; names: string[] }[] }>(
    `/v1/org/feed/${postId}/reactions`, {}, t());

/** Admin only. Pinned posts sort above everything and survive the scroll. */
export const pinPost = (postId: string, pinned: boolean) =>
  call<{ ok: true; pinnedAt: string | null }>(
    `/v1/org/feed/${postId}/pin`,
    { method: "POST", body: JSON.stringify({ pinned }) },
    t(),
  );

export const post = (body: {
  body: string;
  title?: string | null;
  kind?: PostKind;
  groupId?: string | null;
  audience?: AudienceInput;
  /** amber_ids this post addresses by name. Grants nothing; drives the badge. */
  mentions?: string[];
  /** Already-uploaded drive files to hang off this message. */
  fileIds?: string[];
}) => call<{ post: Post }>("/v1/org/feed", { method: "POST", body: JSON.stringify(body) }, t());

export const getAnswers = (postId: string) =>
  call<{ answers: Answer[] }>(`/v1/org/feed/${postId}/answers`, {}, t());

export const answer = (postId: string, body: string) =>
  call<{ post: Post }>(
    `/v1/org/feed/${postId}/answers`,
    { method: "POST", body: JSON.stringify({ body }) },
    t(),
  );

export const acceptAnswer = (postId: string, answerId: string) =>
  call<{ ok: true }>(
    `/v1/org/feed/${postId}/answers/${answerId}/accept`,
    { method: "POST" },
    t(),
  );

export const removePost = (postId: string) =>
  call<{ ok: true }>(`/v1/org/feed/${postId}`, { method: "DELETE" }, t());

/* -------------------------------------------------------------- who knows */

export const getExperts = (topic: string) =>
  call<{ topic: string; experts: Expert[]; pages: PageSummary[] }>(
    `/v1/org/experts?topic=${encodeURIComponent(topic)}`,
    {},
    t(),
  );

export const getPerson = (amberId: string) =>
  call<{
    member: { amberId: string; fullName: string | null; title: string | null; bio: string | null; location: string | null; role: string };
    pages: { id: string; slug: string; title: string; chars_added: number; edits: number; last_edit: string }[];
    answers: { id: string; body: string; created_at: string; accepted_at: string | null; question_id: string; question_title: string | null }[];
    totals: { pages_touched: number; chars_written: number; answers: number; accepted_answers: number } | null;
  }>(`/v1/org/people/${amberId}`, {}, t());

export const saveMyProfile = (body: {
  title?: string | null;
  location?: string | null;
  bio?: string | null;
}) =>
  call<{ member: { title: string | null; location: string | null; bio: string | null } }>(
    "/v1/org/me/profile",
    { method: "PUT", body: JSON.stringify(body) },
    t(),
  );

/* ----------------------------------------------------------------- format */

export function bytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "3 days ago", and it stops being relative after a week.
 *
 * A wiki's whole value is knowing whether a page is current, and "47 weeks ago"
 * is a number somebody has to convert in their head to find out it is from last
 * March.
 */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** The initials an avatar falls back to. Two letters, never three. */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ------------------------------------------------------------------ drive */

export type DriveFile = {
  id: string;
  filename: string;
  title: string | null;
  description: string | null;
  content_type: string;
  byte_size: number | null;
  status: "pending" | "ready" | "failed";
  extract_status: "pending" | "ready" | "unsupported" | "too_large" | "failed";
  tags: string[];
  created_at: string;
  page_id: string | null;
  page_title: string | null;
  group_id: string | null;
  group_name: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  visibility?: "org" | "restricted";
  audience?: Audience;
  /** Set only on a search: the fragment that matched, with <<…>> around it. */
  why?: string | null;
};

export type DriveStats = {
  files: number;
  bytes: number | string;
  searchable: number;
  pending: number;
  contributors: number;
};

export type TagCount = { tag: string; files: number; pages: number };

export const getDrive = (opts: { groupId?: string; tag?: string; q?: string } = {}) => {
  const p = new URLSearchParams();
  if (opts.groupId) p.set("groupId", opts.groupId);
  if (opts.tag) p.set("tag", opts.tag);
  if (opts.q) p.set("q", opts.q);
  const qs = p.toString();
  return call<{
    stats: DriveStats;
    tags: TagCount[];
    files: DriveFile[];
    groups: { id: string; name: string; purpose: string | null }[];
  }>(`/v1/org/drive${qs ? `?${qs}` : ""}`, {}, t());
};

export const getTags = () => call<{ tags: TagCount[] }>("/v1/org/tags", {}, t());

/**
 * Put a file in the drive: reserve, PUT, confirm.
 *
 * The confirm step is where the server reads the file and pulls its text out,
 * so it is slower than the upload on a small PDF and that is the right trade:
 * a file that lands unsearchable is a file nobody finds again.
 */
export async function uploadToDrive(
  file: File,
  opts: {
    pageId?: string | null;
    groupId?: string | null;
    tags?: string[];
    /** A note written at upload, which search reads. See the upload dialog. */
    description?: string | null;
    audience?: AudienceInput;
  } = {},
  onStage?: (stage: "reserving" | "uploading" | "reading") => void,
): Promise<DriveFile> {
  onStage?.("reserving");
  const reserved = await call<{ fileId: string; uploadUrl: string; contentType: string }>(
    "/v1/org/files/upload-url",
    {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
        pageId: opts.pageId ?? null,
        groupId: opts.groupId ?? null,
        tags: opts.tags ?? [],
        description: opts.description ?? null,
        audience: opts.audience ?? EVERYONE,
      }),
    },
    t(),
  );

  onStage?.("uploading");
  // The signed URL signs content-type, so this header must be exactly the one
  // the server was given, not the browser's own idea of the file's type.
  const put = await fetch(reserved.uploadUrl, {
    method: "PUT",
    headers: { "content-type": reserved.contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

  onStage?.("reading");
  const done = await call<{ file: DriveFile; searchable: boolean }>(
    `/v1/org/files/${reserved.fileId}`,
    { method: "POST" },
    t(),
  );
  return done.file;
}

export const driveFileUrl = (fileId: string) =>
  call<{ url: string; filename: string }>(`/v1/org/files/${fileId}/url`, {}, t());

export const updateDriveFile = (
  fileId: string,
  body: {
    title?: string | null;
    description?: string | null;
    groupId?: string | null;
    pageId?: string | null;
    tags?: string[];
    audience?: AudienceInput;
  },
) => call<{ file: DriveFile; audience: Audience; reach: Reach | null }>(`/v1/org/files/${fileId}`, { method: "PATCH", body: JSON.stringify(body) }, t());

export const getFileAudience = (fileId: string) =>
  call<{ audience: Audience; reach: Reach | null }>(
    `/v1/org/files/${fileId}/audience`, {}, t());

export const removeDriveFile = (fileId: string) =>
  call<{ ok: true }>(`/v1/org/files/${fileId}`, { method: "DELETE" }, t());

/** What the extract status means to somebody looking at a row. */
export const EXTRACT_LABEL: Record<DriveFile["extract_status"], string> = {
  ready: "Searchable",
  pending: "Reading…",
  unsupported: "No text to read",
  too_large: "Too big to read",
  failed: "Could not read",
};

/* ------------------------------------------------------------- circles ---
 *
 * A CIRCLE AS A ROOM, IN ONE CALL.
 *
 * Messages, shared work, files, links, people and the calendar were six
 * reads across four screens. The room is one thing seen six ways, and asking
 * for it six times is how a chat ends up slower than the feed it replaced.
 */
export type CircleRow = {
  id: string;
  name: string;
  purpose: string | null;
  memberCount: number;
  /** Are you in it. Rooms you are in sort first. */
  mine: boolean;
  /** Set when somebody pinned it. Pinned rooms sit above the rest. */
  pinnedAt: string | null;
  last: { at: string; by: string | null; preview: string } | null;
};

export type CircleWork = PageSummary & {
  /** project, skill, artifact, record or page -- from the tag on it. */
  workKind: "project" | "skill" | "artifact" | "record" | "page";
};

export type CircleLink = {
  url: string;
  host: string;
  at: string;
  by: string | null;
  postId: string;
  /** What was said on either side of it, which is why it was kept. */
  context?: string | null;
};

export type CircleEvent = {
  id: string;
  kind: string;
  source: string;
  summary: string | null;
  occurred_at: string;
  member_id: string | null;
  member_name: string | null;
  person_name: string | null;
  firm: string | null;
  /** Everybody in the room, gathered from the per-person ledger rows. */
  people?: string[];
  /** Whose calendars this meeting came off. */
  members?: string[];
  /** Which connected accounts produced it, when the rows know. */
  accounts?: string[];
  /** How many ledger rows collapsed into this one entry. */
  rows_behind?: number;
};

export type CircleRoom = {
  circle: {
    id: string;
    name: string;
    purpose: string | null;
    description: string | null;
    memberCount: number;
  };
  messages: (Post & { replies: Answer[] })[];
  work: CircleWork[];
  files: DriveFile[];
  links: CircleLink[];
  people: { amberId: string; fullName: string | null }[];
  calendar: { past: CircleEvent[]; upcoming: CircleEvent[] };
};

export const getCircles = () => call<{ circles: CircleRow[] }>("/v1/org/circles", {}, t());

/**
 * `only: "messages"` fetches the chat and nothing else.
 *
 * The whole room is pages, files, the member list and a calendar query over
 * everybody in it. After sending a line, none of that has changed, and
 * asking for it anyway is what made sending feel slow.
 */
export const getCircle = (groupId: string, opts: { only?: "messages" } = {}) =>
  call<CircleRoom>(
    `/v1/org/circles/${groupId}${opts.only ? `?only=${opts.only}` : ""}`,
    {},
    t(),
  );

/**
 * BUILD SOMETHING IN A ROOM, FROM WHAT THE ROOM KNOWS.
 *
 * A project is instructions a team follows; an artifact is a single
 * self-contained HTML file that runs. Both land as a page addressed to this
 * circle and nowhere else.
 *
 * It calls a model, so it is slow in a way a click is not -- a minute is
 * normal for an artifact. The screen says so rather than looking stuck.
 */
export const buildInCircle = (
  groupId: string,
  want: "project" | "artifact",
  prompt: string,
) =>
  call<{ page: Page; want: "project" | "artifact" }>(
    `/v1/org/circles/${groupId}/build`,
    { method: "POST", body: JSON.stringify({ want, prompt }) },
    t(),
  );

/** Change something already in Work by saying what is wrong with it. */
export const reviseInCircle = (groupId: string, pageId: string, instruction: string) =>
  call<{ ok: true; page: Page }>(
    `/v1/org/circles/${groupId}/work/${pageId}/revise`,
    { method: "POST", body: JSON.stringify({ instruction }) },
    t(),
  );

/**
 * Tag the assistant in a room and it acts: builds a thing, writes a
 * document, or answers — and says in the room which it did.
 */
export const askAmberInCircle = (groupId: string, command: string, parentId?: string | null) =>
  call<{
    ok: true;
    did: "artifact" | "project" | "answered";
    page?: Page;
    answer?: string;
  }>(
    `/v1/org/circles/${groupId}/amber`,
    { method: "POST", body: JSON.stringify({ command, parentId: parentId ?? null }) },
    t(),
  );

/* --------------------------------------------------------- share links ---
 *
 * One page, one URL, anybody who has it. There is deliberately only one kind
 * of share: "anyone at the company with the link" is a sentence products
 * write and browsers do not enforce.
 */
export type PageLink = {
  id: string;
  token: string;
  created_at: string;
  views: number;
  last_seen: string | null;
};

export const createPageLink = (pageId: string) =>
  call<{ ok: true; link: PageLink; reused: boolean }>(
    `/v1/org/pages/${pageId}/link`,
    { method: "POST" },
    t(),
  );

export const getPageLinks = (pageId: string) =>
  call<{ links: PageLink[] }>(`/v1/org/pages/${pageId}/links`, {}, t());

export const revokePageLink = (linkId: string) =>
  call<{ ok: true }>(`/v1/org/share-links/${linkId}`, { method: "DELETE" }, t());
