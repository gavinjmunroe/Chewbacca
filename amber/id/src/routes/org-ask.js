/**
 * THE ASK BAR. One question, answered from this company's own memory.
 *
 * WHY THE FIRST VERSION ANSWERED NOTHING, which is worth keeping written
 * down because it is the obvious mistake and it looked fine in review.
 *
 * It took the question and handed it to listPeople as `q`. listPeople does
 * what a search box does -- `WHERE name ILIKE '%' || q || '%'` -- so "Who
 * here knows someone at Paychex?" became a search for a person whose name
 * contains the words "who here knows someone at paychex?". Nobody is called
 * that. It returned zero rows, the route reported honestly that nothing
 * matched, and the screen said so while the Network tab two clicks away
 * showed Paychex with three people on it.
 *
 * A NATURAL-LANGUAGE QUESTION IS NOT A SEARCH NEEDLE. The fix is to pull the
 * NAMES out of it -- the capitalized words, the domains, the quoted strings
 * -- and look each of those up.
 *
 * AND IT NEVER SEARCHED FIRMS AT ALL. "Paychex" is an account, not a person,
 * and the one thing this product is for -- who here has a way in to that
 * company -- was the question it could not answer. Accounts are searched
 * now, and a matched account brings its knowers with it, which IS the
 * answer to "who here knows someone at X".
 *
 * A BASELINE GOES WITH EVERY QUESTION. Half of what people ask has no
 * subject at all: "what is going quiet", "what happened last week", "who
 * should I follow up with". Those need the roster and the recent timeline
 * rather than a lookup, so a modest slice of both is always included and the
 * model picks what is relevant.
 *
 * WHAT MAKES IT SAFE. Every read goes through the SAME viewer-aware
 * functions the screens use -- listPeople, listAccounts, history,
 * searchPages -- so the evidence is exactly what this person could have
 * found by clicking. A retrieval layer is the classic way a careful
 * permission model gets bypassed, and the model cannot know what it is not
 * allowed to repeat.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgMember } from "../lib/resolve-actor.js";
import { openTenantScope } from "../db/tenant.js";
import { callChat, streamChat } from "../lib/anthropic-chat.js";
import {
  listPeople,
  listAccounts,
  accountKnowers,
  history,
  goingCold,
} from "../db/org-memory-store.js";
import { searchPages } from "../db/org-knowledge-store.js";
import { listConnectors } from "../db/org-api-store.js";

const MAX_PEOPLE = 8;
const MAX_FIRMS = 5;
const MAX_PAGES = 5;
const MAX_TIMELINE = 10;

/**
 * Words that are never the subject of the question.
 *
 * Deliberately short. The job is to drop the scaffolding of a question --
 * who, what, when, does, anybody -- and keep everything that could be a name,
 * a firm or a topic. Over-filtering here loses the subject, which is the one
 * failure that matters.
 */
const STOP = new Set([
  "who", "what", "when", "where", "which", "why", "how", "whose", "whom",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "doing",
  "have", "has", "had", "can", "could", "should", "would", "will", "shall",
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this",
  "these", "those", "there", "here", "of", "in", "on", "at", "to", "for",
  "from", "with", "by", "about", "into", "over", "after", "before", "between",
  "my", "our", "your", "their", "his", "her", "its", "me", "us", "you", "we",
  "they", "them", "i", "it", "he", "she", "anyone", "anybody", "someone",
  "somebody", "everyone", "everybody", "know", "knows", "known", "meet",
  "met", "meeting", "meetings", "last", "recent", "recently", "going",
  "quiet", "cold", "warm", "any", "some", "all", "more", "most", "need",
  "want", "tell", "show", "find", "give", "get", "say", "said", "talk",
  "talked", "spoke", "speak", "happened", "happening", "happen", "up",
  "out", "down", "off", "back", "again", "still", "just", "also", "very",
  "much", "many", "few", "new", "old", "good", "bad", "best", "worst",
]);

/**
 * The things in a question that could name something.
 *
 * THREE SHAPES, in order of how confident they are: a quoted string is
 * certainly a name, a domain is certainly a firm, and a capitalized word in
 * the middle of a sentence is usually one. Everything else falls back to
 * content words, which is noisier and still far better than searching for
 * the whole sentence.
 */
export function subjectsOf(question) {
  const q = String(question ?? "");
  const out = [];

  for (const m of q.matchAll(/"([^"]{2,60})"|'([^']{2,60})'/g)) {
    const v = (m[1] ?? m[2] ?? "").trim();
    if (v) out.push(v);
  }
  for (const m of q.matchAll(/\b([a-z0-9-]+\.(?:com|ai|io|co|net|org|edu|vc|app|dev))\b/gi)) {
    out.push(m[1]);
  }

  const words = q.replace(/[?!.,;:]/g, " ").split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    // A capital that is not merely the first word of the sentence.
    if (i > 0 && /^[A-Z][A-Za-z'’-]{1,}$/.test(w) && !STOP.has(w.toLowerCase())) out.push(w);
  });

  if (out.length === 0) {
    for (const w of words) {
      const lower = w.toLowerCase().replace(/[^a-z0-9'’-]/g, "");
      if (lower.length >= 3 && !STOP.has(lower)) out.push(lower);
    }
  }

  // Longest first: "Blue Modern" should be tried before "Blue".
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);
}

/**
 * HOW IT IS ALLOWED TO SPEAK, which turned out to matter as much as what it
 * retrieves.
 *
 * TWO FAILURES, BOTH FROM THIS PROMPT RATHER THAN THE DATA.
 *
 * IT WROTE MARKDOWN INTO A PLAIN-TEXT BOX. "Who is going quiet?" came back as
 * `**Sagar Tiwari** - last seen *43 days ago*`, asterisks and all, because
 * nothing ever told it the answer is rendered as text. A simple question got
 * a reply that looked like source code.
 *
 * IT APOLOGIZED AND THEN ANSWERED. "I do not have specifics on your meetings,
 * but Karthik met Brian Vance on the 3rd..." -- a hedge about the evidence
 * followed immediately by the evidence. That is a model narrating its own
 * uncertainty, and it reads as broken even when the answer underneath is
 * right. If the answer is there, give it; say what is missing only when
 * something actually is.
 */
const SYSTEM = `You answer questions about a company's own relationships, firms and notes.

You are given evidence drawn from one person's view of their company's memory.

What you may say:
- Use ONLY the evidence given. Never invent a name, a date, a number or an outcome.
- Refer to people and firms by the names in the evidence.
- When the question is "who here knows X", name the colleagues and how many touches each has.
- When "theOnesOnScreen" is present, the question is about THOSE people. "These", "them" and "this list" mean exactly that set, not the whole roster.

How to say it:
- Plain sentences. NO markdown: no asterisks, no bold, no headings, no bullet characters.
- When you list people, write them as a short sentence or on their own lines as "Name, firm - detail".
- Answer first. Do not open by describing what you do or do not have.
- Never say you lack information and then give that information. If the evidence answers the question, just answer it.
- Two or three sentences unless the question needs a list.
- If the evidence truly does not answer it, say in one sentence what is there instead.`;

/**
 * MARKDOWN OUT. A BELT TO GO WITH THE PROMPT'S BRACES.
 *
 * The prompt says plain sentences, and a model mostly obeys a prompt. Mostly
 * is not a guarantee, and the cost of the exception is the literal string
 * `**Sagar Tiwari**` in front of somebody at a demo. The answer is rendered
 * as text, so anything that only means something to a markdown renderer is
 * noise by definition and is removed here rather than hoped away.
 *
 * Emphasis markers, heading hashes, bullet glyphs and code fences go. The
 * words, the line breaks and the punctuation stay exactly as written.
 */
export function plainText(answer) {
  let out = String(answer ?? "");
  out = out.replace(/```[a-z]*\n?/gi, "");
  out = out.replace(/\*\*\*(.+?)\*\*\*/gs, "$1");
  out = out.replace(/\*\*(.+?)\*\*/gs, "$1");
  out = out.replace(/(^|[\s(])\*(\S(?:.*?\S)?)\*(?=[\s).,;:!?]|$)/gs, "$1$2");
  out = out.replace(/(^|[\s(])_(\S(?:.*?\S)?)_(?=[\s).,;:!?]|$)/gs, "$1$2");
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/^\s*[-*•]\s+/gm, "");
  out = out.replace(/`([^`]+)`/g, "$1");
  return out.trim();
}

/**
 * EVERYTHING THIS QUESTION COULD BE ABOUT, retrieved in ONE wait.
 *
 * LIFTED OUT OF THE ROUTE because there are two routes now -- the plain one
 * and the streaming one -- and a second copy of the retrieval would be a
 * second place for the evidence rules to drift apart.
 *
 * WHAT MAKES IT SAFE. Every read goes through the SAME viewer-aware
 * functions the screens use: listPeople, listAccounts, searchPages,
 * history. The evidence is therefore exactly what this person could have
 * found by clicking. A retrieval layer is the classic way a careful
 * permission model gets bypassed, and a model cannot know what it is not
 * allowed to repeat.
 *
 * IT RETURNS TWO VIEWS OF THE SAME FACTS, deliberately.
 *
 * `evidence` is what the MODEL reads, and it is lean on purpose: no ids, no
 * fields nothing will use. Every token in it is time somebody waits.
 *
 * `index` is what the SCREEN reads -- the same people and firms with their
 * ids and addresses attached -- so a name or an address in the answer can
 * become something you click to open that person's record. The model never
 * sees a uuid, and the screen never has to guess who "Sagar" was.
 */
export async function gather({ orgId, viewerId, q, focus = [] }) {
  const subjects = subjectsOf(q);

  const peopleHits = new Map();
  const firmHits = new Map();
  const pageHits = new Map();

  /*
   * ONE WAVE, NOT TWO. The subject lookups and the baseline do not depend
   * on each other, and running them as two awaited groups meant every
   * question paid two round trips before anything else could start. The
   * slowest query sets the floor now, rather than the sum.
   */
  let roster = [];
  let cold = [];

  await Promise.all([
    ...subjects.flatMap((term) => [
      listPeople({ orgId, q: term, viewerId, limit: MAX_PEOPLE })
        .then((rows) => rows.forEach((r) => peopleHits.set(r.id, r)))
        .catch(() => {}),
      listAccounts({ orgId, q: term, limit: MAX_FIRMS })
        .then((rows) => rows.forEach((r) => firmHits.set(r.id, r)))
        .catch(() => {}),
      searchPages({ orgId, q: term, viewerId, limit: MAX_PAGES })
        .then((rows) => rows.forEach((r) => pageHits.set(r.id, r)))
        .catch(() => {}),
    ]),
    /*
     * THE BASELINE. Half of what people ask has no subject at all: "what is
     * going quiet", "who should I follow up with". Those need the roster
     * rather than a lookup, so a slice of it goes with every question and
     * the model picks what is relevant.
     */
    listPeople({ orgId, viewerId, limit: 18 })
      .then((rows) => {
        roster = rows;
      })
      .catch(() => {}),
    goingCold({ orgId, viewerId, limit: 8 })
      .then((rows) => {
        cold = rows;
      })
      .catch(() => {}),
  ]);

  /*
   * WHO HERE KNOWS SOMEBODY AT THIS FIRM -- the question this product exists
   * to answer. A matched firm brings its knowers with it. All at once: these
   * were a for-loop of awaits, which was most of the wait somebody felt.
   */
  const subject = [...peopleHits.values()][0] ?? null;
  const wanted = [...firmHits.values()].slice(0, MAX_FIRMS);

  /*
   * WHAT IS ON SCREEN IS PART OF THE QUESTION.
   *
   * Somebody filters the network to eleven people at two firms and then
   * asks "which of these should I chase". "These" is the filter, and a
   * retrieval that only knows the words of the question cannot see it --
   * it answers about the whole roster and is wrong in a way that looks
   * like the product not listening.
   *
   * The ids come from rows this viewer was already served, and they are
   * re-read here through the same viewer-aware function rather than
   * trusted: an id in a request body is a request, not a permission.
   */
  const focused = [];
  if (focus.length > 0) {
    const ids = new Set(focus.map(String).slice(0, 60));
    const everyone = await listPeople({ orgId, viewerId, limit: 500 }).catch(() => []);
    for (const p of everyone) if (ids.has(String(p.id))) focused.push(p);
  }

  const [knowersPerFirm, timelineRows] = await Promise.all([
    Promise.all(wanted.map((f) => accountKnowers({ orgId, accountId: f.id }).catch(() => []))),
    subject
      ? history({ orgId, personId: subject.id, viewerId, limit: MAX_TIMELINE })
          .then((h) => h.items ?? [])
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const firms = wanted.map((firm, i) => ({
    name: firm.name,
    domain: firm.domain,
    peopleWeKnow: Number(firm.people ?? 0),
    colleaguesWhoKnowThem: (knowersPerFirm[i] ?? []).map((k) => ({
      name: k.member_name,
      people: k.people,
      touches: k.interactions,
      lastAt: k.last_at,
    })),
  }));

  const person = (p) => ({
    name: p.display_name,
    title: p.title,
    firm: p.company ?? p.account_name,
    yourTouches: p.interactions,
    lastSeen: p.last_at,
    internal: p.internal === true,
  });

  const evidence = {
    question: q,
    lookedFor: subjects,
    matchedPeople: [...peopleHits.values()].map(person),
    matchedFirms: firms,
    timeline: timelineRows.map((i) => ({
      when: i.occurred_at,
      kind: i.kind,
      source: i.source,
      summary: i.summary,
    })),
    pages: [...pageHits.values()].map((p) => ({ title: p.title, excerpt: p.excerpt })),
    goingQuiet: (cold ?? []).map((p) => ({
      name: p.display_name,
      lastSeen: p.last_at,
      firm: p.company ?? p.account_name,
    })),
    everyoneYouKnow: roster.map(person),
  };

  /*
   * NAMED SEPARATELY SO THE MODEL CAN TELL THE DIFFERENCE between the
   * people the question is about and the roster that came along as
   * background. Merging them would make "these" mean everybody again.
   */
  if (focused.length > 0) evidence.theOnesOnScreen = focused.map(person);

  /*
   * THE INDEX. Everybody named anywhere in the evidence, once, with what the
   * screen needs to make them clickable. Deduplicated by id because the same
   * person is routinely both a match and a member of the roster.
   */
  const byId = new Map();
  for (const p of [...focused, ...peopleHits.values(), ...roster, ...(cold ?? [])]) {
    if (!p?.id || byId.has(p.id)) continue;
    byId.set(p.id, {
      id: p.id,
      name: p.display_name,
      email: p.email ?? null,
      title: p.title ?? null,
      firm: p.company ?? p.account_name ?? null,
      touches: Number(p.interactions ?? 0) || 0,
      lastAt: p.last_at ?? null,
      internal: p.internal === true,
    });
  }

  const index = {
    people: [...byId.values()],
    firms: wanted.map((f) => ({
      id: f.id,
      name: f.name,
      domain: f.domain,
      people: Number(f.people ?? 0),
      knowers: Number(f.knowers ?? 0),
    })),
  };

  const nothing =
    focused.length === 0 &&
    evidence.matchedPeople.length === 0 &&
    evidence.matchedFirms.length === 0 &&
    evidence.pages.length === 0 &&
    evidence.everyoneYouKnow.length === 0;

  return { evidence, index, subject, nothing };
}

const EMPTY_ANSWER =
  "There is nothing in your view of the company's memory yet. Connect a calendar and this " +
  "fills with everyone you have met.";

/** The one message the model gets. Compact JSON: pretty printing is latency. */
const askTurn = (q, evidence) => [
  {
    role: "user",
    content: `Question: ${q}\n\nEvidence (everything you may use):\n${JSON.stringify(evidence)}`,
  },
];

export function registerOrgAskRoutes(
  app,
  { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {},
) {
  const asMember = {
    preHandler: [requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };

  app.get("/v1/org/ask/available", asMember, async (request) => {
    const connectors = await listConnectors(request.actor.orgId).catch(() => []);
    const assistants = connectors
      .filter((c) => /copilot|chatgpt|claude|gemini/i.test(c.provider) && c.status !== "disabled")
      .map((c) => ({ provider: c.provider, label: c.label, connectedAt: c.created_at }));

    return {
      /*
       * AVAILABLE WHENEVER WE CAN SYNTHESIZE, not only once an assistant is
       * connected. What this is best at is answering from the calendar,
       * which lands long before Copilot does -- gating it on an unrelated
       * integration hid the one control that makes a graph useful.
       */
      available: Boolean(process.env.ANTHROPIC_API_KEY),
      assistants,
      synthesis: Boolean(process.env.ANTHROPIC_API_KEY),
    };
  });

  app.post("/v1/org/ask", asMember, async (request, reply) => {
    const orgId = request.actor.orgId;
    const viewerId = request.actor.amberId;
    const q = String(request.body?.q ?? "").trim();

    if (q.length < 2) return reply.code(400).send({ error: "bad_question" });
    if (q.length > 1000) return reply.code(400).send({ error: "question_too_long" });

    const focus = Array.isArray(request.body?.focus) ? request.body.focus : [];
    const { evidence, index, subject, nothing } = await gather({ orgId, viewerId, q, focus });

    if (nothing) return { answer: EMPTY_ANSWER, evidence, index, grounded: false };

    const answer = await callChat({
      system: SYSTEM,
      messages: askTurn(q, evidence),
      maxTokens: 500,
    });

    if (!answer) {
      return reply.code(200).send({
        answer: null,
        evidence,
        index,
        grounded: true,
        note: "Could not reach the model. These are the matching records.",
      });
    }

    return {
      answer: plainText(answer),
      evidence,
      index,
      grounded: true,
      subject: subject?.display_name ?? null,
    };
  });

  /**
   * THE SAME ANSWER, ARRIVING AS IT IS WRITTEN.
   *
   * WHY THIS IS THE FIX FOR "INSANE LATENCY". The retrieval takes a few
   * hundred milliseconds; the model takes two or three seconds. Nothing
   * makes the model instant, but the blocking route holds BOTH back until
   * the last token, so the screen sits empty for the whole of it and the
   * product feels broken rather than busy.
   *
   * Here the evidence goes out the moment it is read -- the firm cards, the
   * people, the counts, which is most of what somebody is actually looking
   * for -- and the sentences land word by word behind it. Same total time,
   * and the wait stops being a wait.
   *
   * SSE RATHER THAN A WEBSOCKET, because this is one request with a stream
   * of text coming back and nothing goes the other way. It rides the
   * existing auth and tenant preHandlers unchanged, which a socket would
   * not.
   */
  app.post("/v1/org/ask/stream", asMember, async (request, reply) => {
    const orgId = request.actor.orgId;
    const viewerId = request.actor.amberId;
    const q = String(request.body?.q ?? "").trim();

    if (q.length < 2) return reply.code(400).send({ error: "bad_question" });
    if (q.length > 1000) return reply.code(400).send({ error: "question_too_long" });

    const focus = Array.isArray(request.body?.focus) ? request.body.focus : [];
    const { evidence, index, subject, nothing } = await gather({ orgId, viewerId, q, focus });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      /*
       * Proxies buffer a response they think is a document, which turns a
       * stream back into a wait and is the classic way SSE silently stops
       * being SSE in production.
       */
      "x-accel-buffering": "no",
    });

    let open = true;
    const send = (event, data) => {
      if (!open) return;
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        open = false;
      }
    };
    /* Somebody closing the tab must not leave this writing into nothing. */
    reply.raw.on("close", () => {
      open = false;
    });

    send("evidence", { evidence, index, subject: subject?.display_name ?? null });

    if (nothing) {
      send("token", { t: EMPTY_ANSWER });
      send("done", { grounded: false });
      reply.raw.end();
      return reply;
    }

    const full = await streamChat({
      system: SYSTEM,
      messages: askTurn(q, evidence),
      maxTokens: 500,
      onToken: (t) => send("token", { t }),
    }).catch(() => null);

    /*
     * THE MARKDOWN STRIP CANNOT RUN ON A TOKEN. `**Sagar` arrives before
     * `Tiwari**` does, and a stripper that sees half a pair either eats a
     * real asterisk or leaves a stray one. So the finished text is sent once
     * at the end, cleaned, and the client replaces what it was showing with
     * it. The streamed tokens are the progress; this is the answer.
     */
    send("done", { grounded: Boolean(full), answer: full ? plainText(full) : null });
    reply.raw.end();
    return reply;
  });
}
