/**
 * THE WORK INSIDE AN AI EXPORT, TURNED INTO SOMETHING A TEAM CAN READ.
 *
 * WHAT WAS ALREADY HERE AND WHY IT IS NOT ENOUGH. org-ai-import files every
 * conversation that MENTIONS somebody as an interaction on that person's
 * node: a reference, a date and a title. That is the right shape for "what
 * happened with Dana", and it throws away the thing people actually want back.
 *
 * Most of a year's Claude or ChatGPT history is chat. A small part of it is
 * WORK -- the spec somebody wrote at 1am, the migration plan, the competitive
 * teardown, the onboarding doc. Those are documents that happen to live in a
 * chat log, and the reason they never get shared is that nobody is going to
 * scroll four thousand conversations to find eleven of them.
 *
 * So this finds them and makes them pages.
 *
 * HOW IT DECIDES, and the bar is deliberately high. A conversation becomes a
 * page when it produced something long, structured and self-contained --
 * headings, code, numbered steps -- not when it is merely long. A chatty
 * debugging session is longer than most specs and is worth nothing to a
 * colleague. Precision matters more than recall here: eleven real documents
 * is a feature, four hundred maybes is a mess somebody has to clean up, and
 * they will clean it up by deleting all of it.
 *
 * PRIVATE WHEN IT ARRIVES, ALWAYS. These came out of somebody's personal
 * assistant history. The entire premise only works if importing is safe --
 * if a single upload could publish half-finished thinking to a colleague,
 * nobody uploads anything, and the feature is dead on arrival. So every page
 * lands addressed to the importer alone, and sharing is a separate act they
 * take on a page they have looked at.
 *
 * NOTHING IS INVENTED. The body is the conversation's own text. The summary
 * is written by a model and labeled as such, and when the model is
 * unavailable the page still lands with its text -- a document you can read
 * beats a document that failed to import.
 */

import { createPage } from "./org-knowledge-store.js";
import { callChat } from "../lib/anthropic-chat.js";
import { query } from "./sql.js";

/** Below this, it is a chat. */
const MIN_CHARS = 1200;

/** Above this, we are storing a transcript rather than a document. */
const MAX_BODY = 40_000;

/** How many to make in one upload, so a first import cannot flood a wiki. */
const MAX_PAGES = 40;

/**
 * Does this look like work rather than conversation?
 *
 * THE SIGNALS ARE STRUCTURAL, not semantic, and that is on purpose: asking a
 * model to judge four thousand conversations costs real money and real
 * minutes before the person sees anything, and structure is most of the
 * signal anyway. A document has shape. A chat does not.
 */
export function looksLikeWork(text) {
  const t = String(text ?? "");
  if (t.length < MIN_CHARS) return { ok: false, why: "too_short" };

  const headings = (t.match(/^#{1,4}\s+\S/gm) ?? []).length;
  const fences = (t.match(/```/g) ?? []).length;
  const bullets = (t.match(/^\s*[-*]\s+\S/gm) ?? []).length;
  const numbered = (t.match(/^\s*\d+[.)]\s+\S/gm) ?? []).length;
  const tables = (t.match(/^\|.+\|$/gm) ?? []).length;

  /*
   * A WEIGHTED COUNT RATHER THAN ANY ONE SIGNAL. Three headings is a
   * document; three bullets is a reply. Code fences count double because an
   * assistant that wrote code wrote something somebody wanted to keep, and
   * tables count double because nobody makes a table casually.
   */
  const score = headings * 2 + Math.floor(fences / 2) * 2 + Math.min(bullets, 12) + numbered + Math.min(tables, 8) * 2;

  if (score < 6) return { ok: false, why: "no_structure" };
  return { ok: true, score, signals: { headings, fences: Math.floor(fences / 2), bullets, numbered, tables } };
}

/**
 * A stable key for one conversation, so a second upload of the same export
 * updates nothing and creates nothing.
 *
 * IDEMPOTENCE IS NOT A NICETY HERE. People re-upload: they add a file, they
 * try again after a failure, they forget they already did it. Without this
 * the second upload doubles their wiki, and the only way back is deleting
 * pages one at a time.
 */
export function pageKey(provider, conversationId) {
  return `ai:${provider}:${conversationId}`;
}

const SUMMARY_SYSTEM = `You write a one-paragraph summary of a working document so a colleague can tell, in five seconds, whether it is worth opening.

Rules:
- Say what the document IS and what it decides or explains.
- Use only what is in the text. Never add context you were not given.
- No preamble, no "this document", no restating the title. Start with the substance.
- Three sentences at most.`;

/**
 * Turn one choice into an audience.
 *
 * ANYTHING UNRECOGNIZED IS PRIVATE. A typo, a stale group id, a value from a
 * client version that has moved on -- every one of those resolves to the
 * narrowest answer, because the failure modes are not symmetrical. Treating
 * an unknown value as "company" publishes somebody's private thinking on a
 * guess.
 */
function audienceFor(choice, amberId) {
  if (choice === "company") return { everyone: true };
  if (typeof choice === "string" && /^[0-9a-f-]{36}$/i.test(choice)) {
    return { everyone: false, groups: [choice] };
  }
  return { everyone: false, people: [amberId] };
}

/**
 * Find the work in an export and file it.
 *
 * `dryRun` returns what WOULD be created and writes nothing. That is the
 * default on the first press for the same reason the interaction importer
 * has one: the first question anybody asks of a bulk import is what it is
 * about to do to their workspace, and the honest answer is a list, not a
 * promise.
 */
export async function distillKnowledge({
  orgId,
  amberId,
  provider,
  conversations = [],
  dryRun = true,
  summarize = true,
  /**
   * Per-document reach, keyed by conversation id: 'private' | 'company', or a
   * group id to address it to one circle.
   *
   * WHY IT IS KEYED BY CONVERSATION AND NOT BY POSITION. The preview the
   * person made their choices on was SORTED -- strongest first -- and a
   * second call re-derives that order from the same file. Keying by index
   * would survive every test and then, the one time an export parsed a
   * conversation differently, publish the wrong document to the company.
   * There is no recovering from that, so the key is the thing that cannot
   * reorder.
   */
  reach = {},
} = {}) {
  if (!orgId || !amberId || !provider) return { ok: false, reason: "bad_input" };

  const candidates = [];
  for (const convo of conversations) {
    const verdict = looksLikeWork(convo.text);
    if (!verdict.ok) continue;
    candidates.push({ convo, score: verdict.score, signals: verdict.signals });
  }

  // The strongest first, so a cap keeps the best rather than the earliest.
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, MAX_PAGES);

  /*
   * ALREADY THERE? Asked once for the whole batch rather than per page: a
   * four-thousand-conversation export would otherwise open four thousand
   * round trips to answer a question one query answers.
   */
  const keys = chosen.map((c) => pageKey(provider, c.convo.id));
  const { rows: existing } = keys.length
    ? await query(
        `SELECT tags FROM org_pages WHERE org_id = $1::uuid AND tags && $2::text[]`,
        [orgId, keys],
      )
    : { rows: [] };
  const seen = new Set(existing.flatMap((r) => r.tags ?? []).filter((t) => t.startsWith("ai:")));

  const fresh = chosen.filter((c) => !seen.has(pageKey(provider, c.convo.id)));

  const preview = fresh.map((c) => ({
    /*
     * THE ID IS IN THE PREVIEW because the choices come back keyed by it.
     * Without it the client can only key by position, and the order here is
     * derived -- sorted by score -- so a second parse that scored one
     * conversation differently would apply somebody's "share with the
     * company" to the wrong document.
     */
    id: c.convo.id,
    title: c.convo.title || "Untitled",
    at: c.convo.occurredAt ?? null,
    chars: String(c.convo.text ?? "").length,
    signals: c.signals,
  }));

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      considered: conversations.length,
      found: candidates.length,
      alreadyHere: chosen.length - fresh.length,
      wouldCreate: fresh.length,
      preview,
    };
  }

  let created = 0;
  const made = [];
  for (const c of fresh) {
    const body = String(c.convo.text ?? "").slice(0, MAX_BODY);
    const title = (c.convo.title || "Untitled").slice(0, 160);

    /*
     * The summary is best-effort and the page does not depend on it. A
     * document that arrived without a one-line description is still the
     * document; one that failed to import is nothing.
     */
    let summary = null;
    if (summarize) {
      summary = await callChat({
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: body.slice(0, 12_000) }],
        maxTokens: 220,
      }).catch(() => null);
    }

    const out = await createPage({
      orgId,
      title,
      body,
      summary: summary ? summary.trim().slice(0, 500) : null,
      kind: "page",
      createdBy: amberId,
      /*
       * The provenance tag is the idempotence key AND the only honest way to
       * show somebody where a page came from. A wiki that cannot say "this
       * came out of your ChatGPT history on the 14th" is a wiki people stop
       * trusting the moment they find something they do not remember writing.
       */
      tags: [pageKey(provider, c.convo.id), `from:${provider}`],
      /*
       * WHAT THE PERSON CHOSE, and the importer alone when they chose
       * nothing. See the note at the top of this file: the default leans
       * private because a default that leans the other way is discovered
       * after the fact, which is an apology rather than consent.
       */
      audience: audienceFor(reach[c.convo.id], amberId),
    }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));

    if (out?.ok && out.page) {
      created += 1;
      made.push({ id: out.page.id, slug: out.page.slug, title: out.page.title });
    }
  }

  return {
    ok: true,
    dryRun: false,
    considered: conversations.length,
    found: candidates.length,
    alreadyHere: chosen.length - fresh.length,
    created,
    pages: made,
  };
}

export const __test = { looksLikeWork, pageKey, MIN_CHARS, MAX_PAGES };
