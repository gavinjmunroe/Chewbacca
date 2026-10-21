/**
 * CIRCLES AS ROOMS — one call per room, because a room is not five screens.
 *
 *   GET  /v1/org/circles              every circle you are in, with its last word
 *   GET  /v1/org/circles/:groupId     everything in one room, in one round trip
 *
 * WHY THIS EXISTS WHEN THE PARTS ALREADY DID. Messages were in the feed,
 * shared work was in pages, uploads were in the drive, people were in the
 * group, and meetings were in the ledger. Every piece of a circle existed
 * and a circle did not: using one meant five destinations and holding the
 * context in your head between them.
 *
 * A room is the opposite claim -- that these are one thing seen five ways --
 * and the API has to make that claim too, or the screen pays five round
 * trips to pretend. One request returns the room.
 *
 * WHAT A CIRCLE'S CONTENTS ACTUALLY ARE, said once:
 *   messages  posts on this group, newest conversation last, with replies
 *   work      pages addressed to this circle: projects, skills, artifacts
 *   files     uploads filed here
 *   links     the URLs people have put in messages, which nobody files and
 *             everybody loses
 *   people    the members
 *   calendar  what these people have actually been in a room for
 *
 * NOTHING HERE WIDENS WHAT ANYBODY CAN SEE. Every read goes through the same
 * viewer-aware store function the standalone screens use, with the same
 * viewerId. Being in a circle is being in a room, not holding a key: a
 * private page addressed to somebody else stays invisible in here exactly as
 * it is everywhere else.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgMember } from "../lib/resolve-actor.js";
import { openTenantScope } from "../db/tenant.js";
import { listFeed, listFiles, listPages, listAnswers } from "../db/org-knowledge-store.js";
import { decorateFeed } from "../db/org-feed-social.js";
import { listGroupMembers, listGroups, listGroupsForMember } from "../db/org-store.js";
import { circleCalendar } from "../db/org-memory-store.js";
import { createPage, updatePage, getPage, createPost } from "../db/org-knowledge-store.js";
import { callChat } from "../lib/anthropic-chat.js";

const org = (request) => request.actor.orgId;
const who = (request) => request.actor.amberId;

/**
 * WHAT KIND OF THING A PAGE IS, from the tag the importer left on it.
 *
 * A circle shows projects, skills and artifacts as different things because
 * they ARE different things to the person looking: an artifact is something
 * you run, a skill is something you follow, a project is something you join.
 * One undifferentiated list of "pages" makes somebody open each to find out.
 */
export function workKind(tags = []) {
  const t = new Set(tags ?? []);
  if (t.has("from:artifact")) return "artifact";
  if (t.has("from:skill")) return "skill";
  if (t.has("from:claude-project")) return "project";
  if (t.has("from:data")) return "record";
  return "page";
}

/**
 * THE URLS IN A ROOM'S MESSAGES.
 *
 * Nobody files a link. Somebody pastes a dashboard into a chat on a Tuesday
 * and by Friday the only way back to it is scrolling -- which is the actual
 * reason chat tools all grew a Links tab, and the reason this one is derived
 * rather than something else to maintain. Latest mention wins, because a
 * link posted twice is one link and the newer context is the useful one.
 */
export function linksIn(posts = []) {
  const found = new Map();
  for (const p of posts) {
    const body = String(p.body ?? "");
    for (const m of body.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      const at = m.index ?? 0;
      const url = m[0].replace(/[.,;:]+$/, "");
      if (url.length > 2048) continue;
      const prev = found.get(url);
      if (prev && new Date(prev.at) >= new Date(p.created_at)) continue;
      let host = null;
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        continue; // not a URL after all; a bracket or a trailing quote
      }
      /*
       * THE SENTENCE AROUND IT IS THE REASON ANYBODY KEPT THE LINK.
       *
       * A bare URL in a list is a thing somebody has to open to remember
       * why it is there -- which is the same cost as scrolling back for it,
       * so the tab saves nothing. The words on either side are what make
       * the row answer "is this the dashboard Sagar sent" without a click,
       * and they are already in the message.
       */
      const before = body.slice(Math.max(0, at - 120), at).trim();
      const after = body.slice(at + m[0].length, at + m[0].length + 120).trim();
      found.set(url, {
        url,
        host,
        at: p.created_at,
        by: p.author_name ?? null,
        postId: p.id,
        context: [before, after].filter(Boolean).join(" … ").slice(0, 220) || null,
      });
    }
  }
  return [...found.values()].sort((a, b) => new Date(b.at) - new Date(a.at));
}

/**
 * BUILDING SOMETHING IN THE ROOM, WITH THE ROOM AS CONTEXT.
 *
 * THIS IS THE PART THAT IS NOT A CHAT TOOL. Sharing work into a circle makes
 * a circle a folder. What makes it the thing people actually described --
 * collaborating on a project inside a team chat -- is that the room can
 * PRODUCE work, and that what it produces already knows what the room is
 * for, what has been said in it, and what it already holds.
 *
 * TWO THINGS COME OUT OF IT, and they are genuinely different objects.
 *
 * A PROJECT is instructions: the way this team wants a job done, written
 * down so a person or an assistant can follow it. It is prose, and it is
 * shared the same way an imported Claude project is, because it IS the same
 * kind of thing.
 *
 * AN ARTIFACT is a thing that runs. One self-contained HTML file, no build
 * step, no network -- which is not a stylistic preference: it is rendered in
 * a sandboxed frame with a null origin, so anything that reaches for a CDN
 * or an API simply does not work, and producing one that does would be
 * shipping somebody a broken tool.
 *
 * IT LANDS IN THE CIRCLE AND NOWHERE ELSE. The audience is this circle,
 * explicitly, rather than "everyone" -- a room that quietly publishes to the
 * company is a room nobody will use for anything real.
 */
const BUILD_SYSTEM = {
  project: `You write a team's working method down as a project brief.

You are given a circle's purpose, what has been said in it recently, and what it already holds. Write the brief that team asked for.

Shape it as: one short paragraph saying what this is for, then "## Instructions" with the steps, then "## What good looks like" if it helps. Markdown headings are fine; this is a document.

Be concrete and specific to what the team said. Never invent a fact about their business, a name, a number or a customer. Where something is unknown, say what has to be decided rather than filling it in.`,

  artifact: `You write ONE self-contained HTML file.

Hard constraints, because of where it runs:
- A single file. All CSS in a <style> tag, all JS in a <script> tag. No imports, no CDN links, no external fonts, no fetch, no network of any kind -- it runs in a sandboxed frame with a null origin and any request will fail.
- No localStorage or sessionStorage: it is sandboxed and they throw.
- Plain, readable design. System font stack. It should look deliberate, not decorated.
- Give it a <title>: that becomes its name.
- It must work the moment it loads, with sensible example data already in it.

Reply with the HTML file and nothing else. No explanation, no code fence.`,
};

function stripFence(text) {
  const t = String(text ?? "").trim();
  const m = t.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  return (m ? m[1] : t).trim();
}

/** The <title>, which is the name its author gave it. */
function htmlTitle(body) {
  const m = String(body ?? "").match(/<title[^>]*>([^<]{1,160})<\/title>/i);
  const v = m ? m[1].trim() : "";
  return v && !/^(document|untitled|index)$/i.test(v) ? v : null;
}

/**
 * ONE BUILDER, THREE DOORS.
 *
 * The Work tab's button, a revision of something already here, and @Amber
 * in a message all produce the same kinds of object and must obey the same
 * constraints -- above all the artifact ones, which are not stylistic: a
 * page that reaches for a CDN renders blank in a null-origin sandbox, so a
 * second copy of these rules that drifted would ship somebody a tool that
 * silently does not work.
 */
async function roomContext({ orgId, groupId, viewerId, circle }) {
  const [messages, pages] = await Promise.all([
    listFeed({ orgId, groupId, viewerId }).catch(() => []),
    listPages(orgId, { groupId, viewerId, limit: 60 }).catch(() => []),
  ]);
  return {
    circle: circle.name,
    purpose: circle.purpose ?? null,
    description: circle.description ?? null,
    recentlySaid: messages.slice(0, 20).map((m) => ({
      by: m.author_name ?? null,
      said: String(m.body ?? "").slice(0, 600),
    })),
    alreadyHere: pages.slice(0, 40).map((p) => ({ title: p.title, kind: workKind(p.tags) })),
  };
}

/** The page body for a built thing: fenced for an artifact, prose for a project. */
function bodyFor(want, content) {
  return want === "artifact" ? ["```html", content, "```"].join("\n") : content;
}

function titleFor(want, content, fallback) {
  const t =
    want === "artifact"
      ? htmlTitle(content)
      : (content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null);
  return String(t || fallback).slice(0, 160);
}

export function registerOrgCircleRoutes(
  app,
  { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {},
) {
  const asMember = {
    preHandler: [requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };

  /**
   * THE LEFT RAIL. Every circle, with enough to decide which to open.
   *
   * "Mine first" is the whole ordering: the rooms you are in are the rooms
   * you use, and a company's other circles belong below them rather than
   * hidden -- a circle you cannot see is a circle you cannot ask to join.
   */
  app.get("/v1/org/circles", asMember, async (request) => {
    const orgId = org(request);
    const viewerId = who(request);

    const [all, mine] = await Promise.all([
      listGroups(orgId),
      listGroupsForMember({ orgId, amberId: viewerId }),
    ]);
    const mineIds = new Set(mine.map((g) => String(g.id)));

    /*
     * THE LAST WORD IN EACH ROOM, which is the one thing that makes a list
     * of rooms readable. One feed read for the whole company rather than
     * one per circle: a company with thirty circles should cost one query,
     * not thirty.
     */
    const posts = await listFeed({ orgId, viewerId }).catch(() => []);
    const last = new Map();
    for (const p of posts) {
      const g = p.group_id ? String(p.group_id) : null;
      if (!g || last.has(g)) continue;
      last.set(g, {
        at: p.created_at,
        by: p.author_name ?? null,
        preview: String(p.body ?? "").slice(0, 120),
      });
    }

    const circles = all
      .map((g) => ({
        id: String(g.id),
        name: g.name,
        purpose: g.purpose ?? null,
        memberCount: Number(g.memberCount ?? 0),
        mine: mineIds.has(String(g.id)),
        /*
         * PINNED IS THE COMPANY'S CHOICE, NOT YOURS ALONE. pinned_at sits on
         * the group rather than on a per-person preference, which is
         * deliberate: a circle everybody should be looking at is a fact
         * about the company, and a pin only you can see is a bookmark.
         */
        pinnedAt: g.pinnedAt ?? null,
        last: last.get(String(g.id)) ?? null,
      }))
      .sort((a, b) => {
        /* Pinned above everything, newest pin first among them. */
        if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
        if (a.pinnedAt && b.pinnedAt) {
          const d = new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime();
          if (d !== 0) return d;
        }
        if (a.mine !== b.mine) return a.mine ? -1 : 1;
        const at = a.last ? new Date(a.last.at).getTime() : 0;
        const bt = b.last ? new Date(b.last.at).getTime() : 0;
        if (at !== bt) return bt - at;
        return a.name.localeCompare(b.name);
      });

    return { circles };
  });

  /**
   * One room, whole -- or just its messages.
   *
   * `?only=messages` exists because of what sending felt like. Posting a line
   * reloaded the ROOM: every page, every file, the member list and a calendar
   * query that walks the ledger for everybody in the circle. Two seconds,
   * every message, to learn one new row. The chat now asks for the part that
   * changed, and the rest is refetched when somebody actually opens a tab
   * that shows it.
   */
  app.get("/v1/org/circles/:groupId", asMember, async (request, reply) => {
    const orgId = org(request);
    const viewerId = who(request);
    const groupId = String(request.params.groupId);
    const only = String(request.query?.only ?? "");

    const groups = await listGroups(orgId);
    const circle = groups.find((g) => String(g.id) === groupId);
    /*
     * A circle from another company is a 404 and not a 403, for the same
     * reason every other id in this API is: an error that distinguishes
     * "does not exist" from "not yours" is an existence oracle.
     */
    if (!circle) return reply.code(404).send({ error: "no_circle" });

    const lean = only === "messages";

    const people = lean ? [] : await listGroupMembers({ orgId, groupId });

    const [messages, pages, files, calendar] = lean
      ? [await listFeed({ orgId, groupId, viewerId }).catch(() => []), [], [], { past: [], upcoming: [] }]
      : await Promise.all([
          listFeed({ orgId, groupId, viewerId }).catch(() => []),
          listPages(orgId, { groupId, viewerId, limit: 200 }).catch(() => []),
          listFiles({ orgId, groupId, viewerId, limit: 200 }).catch(() => []),
          circleCalendar({
            orgId,
            memberIds: people.map((p) => p.amberId),
            viewerId,
          }).catch(() => ({ past: [], upcoming: [] })),
        ]);

    // Attachments for the whole page in one query rather than one per post.
    await decorateFeed({ orgId, rows: messages }).catch(() => {});

    /*
     * REPLIES COME WITH THE MESSAGE. A chat where opening a thread is a
     * request is a chat that feels like a forum; the threads here are one
     * level deep by design, so fetching them all costs one query per
     * message that HAS replies and nothing for the ones that do not.
     */
    const withReplies = await Promise.all(
      messages.map(async (m) => {
        const n = Number(m.answers ?? 0);
        if (!n) return { ...m, replies: [] };
        const replies = await listAnswers({ orgId, postId: m.id, viewerId }).catch(() => []);
        return { ...m, replies };
      }),
    );

    const work = pages.map((p) => ({ ...p, workKind: workKind(p.tags) }));

    return {
      circle: {
        id: String(circle.id),
        name: circle.name,
        purpose: circle.purpose ?? null,
        description: circle.description ?? null,
        memberCount: Number(circle.memberCount ?? people.length),
      },
      // Oldest first: a chat reads downward, and a feed does not.
      messages: withReplies.slice().reverse(),
      work,
      files,
      links: linksIn(messages),
      people,
      calendar,
    };
  });

  /**
   * Build a project or an artifact in this room, from what the room knows.
   *
   * A MEMBER'S RIGHT, like writing a page -- which is what this produces.
   * Nothing here can read anything the caller could not already read: the
   * context is this circle's own purpose, its messages and the titles of
   * what it holds, every one of which came through the viewer-aware reads
   * above.
   */
  app.post(
    "/v1/org/circles/:groupId/build",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["want", "prompt"],
          properties: {
            want: { type: "string", enum: ["project", "artifact"] },
            prompt: { type: "string", minLength: 4, maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      const orgId = org(request);
      const viewerId = who(request);
      const groupId = String(request.params.groupId);
      const want = request.body.want;

      const groups = await listGroups(orgId);
      const circle = groups.find((g) => String(g.id) === groupId);
      if (!circle) return reply.code(404).send({ error: "no_circle" });

      if (!process.env.ANTHROPIC_API_KEY) {
        return reply.code(503).send({ error: "no_model" });
      }

      const [messages, pages] = await Promise.all([
        listFeed({ orgId, groupId, viewerId }).catch(() => []),
        listPages(orgId, { groupId, viewerId, limit: 60 }).catch(() => []),
      ]);

      /*
       * THE ROOM, COMPACTLY. Twenty messages rather than all of them and
       * titles rather than bodies: this is context for a brief, not a
       * transcript to summarize, and every token of it is time somebody
       * waits for the thing they asked for.
       */
      const context = {
        circle: circle.name,
        purpose: circle.purpose ?? null,
        description: circle.description ?? null,
        recentlySaid: messages.slice(0, 20).map((m) => ({
          by: m.author_name ?? null,
          said: String(m.body ?? "").slice(0, 600),
        })),
        alreadyHere: pages.slice(0, 40).map((p) => ({
          title: p.title,
          kind: workKind(p.tags),
        })),
      };

      const text = await callChat({
        system: BUILD_SYSTEM[want],
        messages: [
          {
            role: "user",
            content:
              `What the circle wants: ${request.body.prompt}\n\n` +
              `The circle, for context:\n${JSON.stringify(context)}`,
          },
        ],
        maxTokens: want === "artifact" ? 8000 : 2000,
        timeoutMs: 120000,
      }).catch(() => null);

      if (!text) return reply.code(502).send({ error: "model_unavailable" });

      const content = stripFence(text);

      if (want === "artifact" && !/<[a-z!]/i.test(content)) {
        /* Prose where a file was asked for: refuse rather than file it as a
           page that claims to be something you can run. */
        return reply.code(502).send({ error: "not_an_artifact" });
      }

      const title =
        want === "artifact"
          ? (htmlTitle(content) ?? String(request.body.prompt).slice(0, 80))
          : (content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? String(request.body.prompt).slice(0, 80));

      const out = await createPage({
        orgId,
        createdBy: viewerId,
        title: title.slice(0, 160),
        body: want === "artifact" ? ["```html", content, "```"].join("\n") : content,
        kind: "page",
        tags: [want === "artifact" ? "from:artifact" : "from:claude-project", "built:in-circle"],
        /* This circle, explicitly. A room that publishes to the company is
           a room nobody uses for anything real. */
        audience: { everyone: false, groups: [groupId], people: [] },
      }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));

      if (!out?.ok) return reply.code(400).send({ error: out?.reason ?? "could_not_save" });

      reply.code(201);
      return { page: out.page, want };
    },
  );

  /**
   * CHANGE SOMETHING THAT IS ALREADY HERE, BY SAYING WHAT IS WRONG WITH IT.
   *
   * WHY REVISION AND NOT A SECOND BUILD. The first artifact is never right.
   * Building again from the original prompt throws away everything that WAS
   * right and rolls the dice a second time, which is why "regenerate" feels
   * like gambling. This hands the model the file it already made plus one
   * sentence about what to change, and saves the result over the same page
   * -- so the revision history is the history of one thing rather than a
   * folder of near-identical attempts.
   */
  app.post(
    "/v1/org/circles/:groupId/work/:pageId/revise",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["instruction"],
          properties: { instruction: { type: "string", minLength: 2, maxLength: 4000 } },
        },
      },
    },
    async (request, reply) => {
      const orgId = org(request);
      const viewerId = who(request);
      const { groupId, pageId } = request.params;

      if (!process.env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: "no_model" });

      /* Read it the way the screen reads it, so a page this person may not
         see is a 404 here exactly as it is there. */
      const page = await getPage({ orgId, pageId, viewerId });
      if (!page) return reply.code(404).send({ error: "not_found" });

      const fenced = String(page.body ?? "").match(/^```(html|svg)\n([\s\S]*?)\n```\s*$/i);
      const want = fenced ? "artifact" : "project";
      const current = fenced ? fenced[2] : String(page.body ?? "");

      const text = await callChat({
        system: BUILD_SYSTEM[want],
        messages: [
          {
            role: "user",
            content:
              `Here is the current ${want}:\n\n${current}\n\n` +
              `Change it as follows, and reply with the whole ${
                want === "artifact" ? "file" : "document"
              } again:\n${request.body.instruction}`,
          },
        ],
        maxTokens: want === "artifact" ? 8000 : 2000,
        timeoutMs: 120000,
      }).catch(() => null);

      if (!text) return reply.code(502).send({ error: "model_unavailable" });
      const content = stripFence(text);
      if (want === "artifact" && !/<[a-z!]/i.test(content)) {
        return reply.code(502).send({ error: "not_an_artifact" });
      }

      const out = await updatePage({
        orgId,
        pageId,
        body: bodyFor(want, content),
        authorId: viewerId,
        /* The instruction IS the change note, which makes the history read
           as a conversation rather than as "edited, edited, edited". */
        changeNote: String(request.body.instruction).slice(0, 300),
      }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));

      if (!out?.ok) return reply.code(400).send({ error: out?.reason ?? "could_not_save" });
      return { ok: true, page: out.page, groupId };
    },
  );

  /**
   * @AMBER, IN THE ROOM, DOING THE THING.
   *
   * WHY A COMMAND IN A MESSAGE RATHER THAN A BUTTON. The moment somebody
   * knows what they want built is the moment they are describing it to the
   * team -- "we should have a one-pager for this" -- and making them stop,
   * find a tab and retype it is where the idea dies. Tagging the assistant
   * in the sentence they were writing anyway costs nothing.
   *
   * IT DECIDES WHAT IS BEING ASKED FOR, and there are only three answers: a
   * thing that runs, a document, or a question. Anything it builds lands in
   * Work addressed to this circle, and it replies in the thread saying what
   * it made -- because an assistant that acts silently is one nobody trusts
   * with a second command.
   */
  app.post(
    "/v1/org/circles/:groupId/amber",
    {
      ...asMember,
      schema: {
        body: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string", minLength: 2, maxLength: 4000 },
            /* The message that tagged it, so the answer lands under it. */
            parentId: { type: ["string", "null"], maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const orgId = org(request);
      const viewerId = who(request);
      const groupId = String(request.params.groupId);
      const command = String(request.body.command).trim();

      if (!process.env.ANTHROPIC_API_KEY) return reply.code(503).send({ error: "no_model" });

      const groups = await listGroups(orgId);
      const circle = groups.find((g) => String(g.id) === groupId);
      if (!circle) return reply.code(404).send({ error: "no_circle" });

      const context = await roomContext({ orgId, groupId, viewerId, circle });

      /*
       * ONE WORD BACK, so the decision is cheap and cannot wander. A model
       * asked to both classify and produce in one call will happily answer
       * the question instead of building the thing.
       */
      const intent = String(
        (await callChat({
          system:
            "Reply with exactly one word and nothing else: ARTIFACT if the person is asking for " +
            "something that runs or is looked at -- a slideshow, a calculator, a tracker, a page, " +
            "a chart, a one-pager. PROJECT if they are asking for instructions, a plan, a brief, a " +
            "process or a document to follow. ANSWER if they are asking a question about this " +
            "company's people, work or history and want a reply rather than a thing.",
          messages: [{ role: "user", content: command }],
          maxTokens: 8,
        }).catch(() => "")) ?? "",
      )
        .trim()
        .toUpperCase();

      if (intent.startsWith("ANSWER")) {
        const answer = await callChat({
          system:
            "You answer a colleague's question inside a team room, from the room's own context. " +
            "Plain sentences, no markdown, no asterisks. Two or three sentences. Use only what you " +
            "are given, and say plainly when the room does not contain the answer.",
          messages: [
            { role: "user", content: `Question: ${command}\n\nThe room:\n${JSON.stringify(context)}` },
          ],
          maxTokens: 600,
        }).catch(() => null);

        if (!answer) return reply.code(502).send({ error: "model_unavailable" });

        const said = await createPost({
          orgId,
          authorId: viewerId,
          kind: request.body.parentId ? "answer" : "update",
          body: `Amber: ${answer.trim()}`,
          parentId: request.body.parentId ?? null,
          groupId: request.body.parentId ? null : groupId,
          audience: request.body.parentId
            ? null
            : { everyone: false, groups: [groupId], people: [] },
        }).catch(() => ({ ok: false }));

        return { ok: true, did: "answered", answer: answer.trim(), post: said?.post ?? null };
      }

      const want = intent.startsWith("PROJECT") ? "project" : "artifact";

      const text = await callChat({
        system: BUILD_SYSTEM[want],
        messages: [
          {
            role: "user",
            content: `What the circle wants: ${command}\n\nThe circle, for context:\n${JSON.stringify(context)}`,
          },
        ],
        maxTokens: want === "artifact" ? 8000 : 2000,
        timeoutMs: 120000,
      }).catch(() => null);

      if (!text) return reply.code(502).send({ error: "model_unavailable" });
      const content = stripFence(text);
      if (want === "artifact" && !/<[a-z!]/i.test(content)) {
        return reply.code(502).send({ error: "not_an_artifact" });
      }

      const out = await createPage({
        orgId,
        createdBy: viewerId,
        title: titleFor(want, content, command),
        body: bodyFor(want, content),
        kind: "page",
        tags: [want === "artifact" ? "from:artifact" : "from:claude-project", "built:in-circle"],
        audience: { everyone: false, groups: [groupId], people: [] },
      }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));

      if (!out?.ok) return reply.code(400).send({ error: out?.reason ?? "could_not_save" });

      /*
       * AND IT SAYS SO, IN THE ROOM. An assistant that acts silently leaves
       * everybody but the person who asked wondering where the thing came
       * from -- and the point of doing this in a room is that the room sees
       * it happen.
       */
      /*
       * IT ANSWERS WHERE IT WAS ASKED.
       *
       * A top-level post meant the result floated at the bottom of the room
       * with nothing connecting it to the request, and anybody scrolling
       * past later had to work out which message it belonged to. parentId
       * is always set now: the client sends the id of the message that did
       * the tagging, so the answer hangs under the ask the way a reply from
       * a colleague would.
       *
       * THE PAGE ID GOES IN THE TEXT, in a marker the room's own renderer
       * turns into a link straight to that piece in Work. A sentence saying
       * "it is in Work" and leaving somebody to find it is a sentence that
       * makes them do the last step by hand.
       */
      await createPost({
        orgId,
        authorId: viewerId,
        kind: request.body.parentId ? "answer" : "update",
        body: `Amber built "${out.page.title}" [[work:${out.page.id}|Open it in Work]]`,
        parentId: request.body.parentId ?? null,
        groupId: request.body.parentId ? null : groupId,
        audience: request.body.parentId
          ? null
          : { everyone: false, groups: [groupId], people: [] },
      }).catch(() => null);

      return { ok: true, did: want, page: out.page };
    },
  );
}
