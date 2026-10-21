/**
 * THE PART OF SOMEBODY'S AI HISTORY THAT IS ABOUT A RELATIONSHIP.
 *
 * Most of an export is not. It is debugging, drafting, recipes, travel. The
 * slice that matters is the conversations that name a person or a firm the
 * company already deals with: drafting a follow-up to a partner, preparing
 * for a renewal call, working out what to say about a delay.
 *
 * That slice is genuinely new information. It is not in the calendar, not in
 * the mailbox, not in the CRM. It is the THINKING about a relationship, which
 * no system of record has ever held, and it is the reason this is worth
 * building rather than a novelty.
 *
 * WHAT IS STORED IS A REFERENCE AND ONE LINE. The conversation does not
 * cross. What lands on a node is: this person was working on something about
 * you, on this date, titled this, and here is the link back to it in the tool
 * that owns it.
 *
 * The difference between "we read your AI chats" and "you were working on
 * something about Henderson CPA on the 14th" is the whole difference between
 * a feature people switch on and a vendor nobody lets near their tenant. The
 * second one is also more useful, because a timeline is for scanning and
 * nobody scans transcripts.
 *
 * THIS NEVER CREATES A PERSON, and that rule is doing a lot of work. Names in
 * free text are ambiguous, models hallucinate people, and a graph that grows
 * from chat text would fill with half-real contacts nobody can verify or
 * delete. So the import can only attach to somebody the graph already knows
 * from a calendar invite or a mailbox -- evidence that the relationship
 * actually exists. The AI history enriches a graph; it never seeds one.
 *
 * EVERY WRITE CARRIES A BATCH ID, so the whole import can be undone in one
 * delete. Dropping two years of history into a graph is exactly the thing
 * somebody wants to reverse five minutes after seeing it.
 */

import { query } from "./sql.js";
import { record } from "./org-memory-store.js";

/**
 * Tokens too generic to identify anything.
 *
 * "The Group" and "Data Co" are real company names, and matching on `the` or
 * `data` would tie half an export to them. An entity has to bring at least
 * one token that is not on this list, or it is not matchable at all.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "inc", "llc", "ltd", "co", "corp", "group", "company",
  "holdings", "partners", "associates", "services", "solutions", "systems",
  "data", "tech", "global", "international", "team", "new", "old", "one",
  "first", "best", "pro", "plus", "my", "our", "your", "a", "an", "of",
]);

/** Words in a string, lowercased, punctuation dropped. */
function tokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The link back to the conversation in the tool that owns it. */
function conversationUrl(provider, id) {
  if (!id) return null;
  if (provider === "chatgpt") return `https://chat.openai.com/c/${id}`;
  if (provider === "claude") return `https://claude.ai/chat/${id}`;
  return null;
}

/**
 * Everything in this company's graph that a conversation could name.
 *
 * Read once per import rather than per conversation: an export is thousands
 * of conversations and the graph does not change while one is being read.
 */
async function matchables(orgId) {
  const { rows: people } = await query(
    `SELECT p.id, p.display_name,
            COALESCE((
              SELECT array_agg(d.value) FROM org_person_identities d
               WHERE d.org_id = p.org_id AND d.person_id = p.id AND d.kind = 'email'
            ), ARRAY[]::text[]) AS emails
       FROM org_people p
      WHERE p.org_id = $1::uuid AND p.deleted_at IS NULL`,
    [orgId],
  );

  const { rows: accounts } = await query(
    `SELECT a.id, a.name, a.domain,
            (SELECT p.id FROM org_people p
              WHERE p.org_id = a.org_id AND p.account_id = a.id AND p.deleted_at IS NULL
              ORDER BY p.created_at
              LIMIT 1) AS lead_person_id
       FROM org_accounts a
      WHERE a.org_id = $1::uuid AND a.deleted_at IS NULL`,
    [orgId],
  );

  const entries = [];

  for (const p of people) {
    const name = tokens(p.display_name);
    const strong = name.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    entries.push({
      personId: p.id,
      label: p.display_name,
      via: "person",
      emails: (p.emails ?? []).map((e) => String(e).toLowerCase()),
      /*
       * A FULL NAME OR NOTHING. One token is not a match: "Dana" appears in
       * conversations that have nothing to do with Dana Whitfield, and a
       * timeline full of those is one nobody trusts again. Two tokens that
       * both appear is a weak signal made adequate by being specific.
       */
      tokens: strong.length >= 2 ? strong : null,
    });
  }

  for (const a of accounts) {
    // An account match lands on somebody at that firm, because interactions
    // attach to people. Without anybody there yet, there is nothing to
    // attach to and the firm is skipped rather than invented.
    if (!a.lead_person_id) continue;
    const name = tokens(a.name).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    entries.push({
      personId: a.lead_person_id,
      label: a.name,
      via: "account",
      emails: [],
      domain: a.domain ? String(a.domain).toLowerCase() : null,
      tokens: name.length >= 1 ? name : null,
    });
  }

  return entries;
}

/** The people a single conversation is about. */
function mentionsIn(text, entries) {
  const lower = String(text ?? "").toLowerCase();
  const words = new Set(tokens(lower));
  const emails = new Set(lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []);

  const hits = new Map();   // personId -> { label, via }

  for (const e of entries) {
    let matched = null;

    // An address is unambiguous and worth checking first and cheaply.
    if (e.emails.some((addr) => emails.has(addr))) matched = "email";
    else if (e.domain && lower.includes(e.domain)) matched = "domain";
    else if (e.tokens && e.tokens.every((t) => words.has(t))) matched = e.via;

    if (!matched) continue;
    // A person already matched by address is not downgraded by a later,
    // weaker match on their firm's name.
    if (!hits.has(e.personId) || matched === "email") {
      hits.set(e.personId, { label: e.label, via: matched });
    }
  }

  return hits;
}

/**
 * One line for the timeline.
 *
 * The title, because both products already auto-title a conversation with a
 * description of what it was about, which is exactly the summary we would
 * otherwise pay a model to produce. Free, instant, deterministic, and written
 * by the tool the person actually used.
 */
function oneLine(convo) {
  const title = String(convo.title ?? "").trim();
  if (title && title.toLowerCase() !== "new chat") return title.slice(0, 200);
  const firstLine = String(convo.text ?? "").split("\n").find((l) => l.trim());
  return firstLine ? firstLine.trim().slice(0, 160) : "Untitled conversation";
}

/**
 * Match an export against the graph and write what it finds.
 *
 * `dryRun` reports what would be written without writing it, which is the
 * default everywhere else in this codebase for the same reason: the first
 * question about a bulk write is how much, and answering it by doing the
 * write is the same answer at a much worse price.
 */
export async function importExport({
  orgId,
  amberId,
  provider,
  conversations = [],
  filename = null,
  dryRun = false,
} = {}) {
  if (!orgId || !amberId || !provider) return { ok: false, reason: "bad_input" };

  const entries = await matchables(orgId);
  if (entries.length === 0) {
    /*
     * An empty graph cannot be enriched, and saying so is far better than
     * reporting zero matches against four thousand conversations and letting
     * somebody conclude the matcher is broken.
     */
    return { ok: false, reason: "empty_graph", conversations: conversations.length };
  }

  // Found first, written second, so a dry run is the same code path as a real
  // one minus the writes. Two code paths would mean a dry run that is
  // reassuring about something the real one does differently.
  const found = [];
  for (const convo of conversations) {
    const hits = mentionsIn(convo.text, entries);
    for (const [personId, hit] of hits) {
      found.push({ convo, personId, label: hit.label, via: hit.via });
    }
  }

  const people = new Set(found.map((f) => f.personId));
  const summary = {
    ok: true,
    provider,
    conversations: conversations.length,
    matched: found.length,
    people: people.size,
    sample: found.slice(0, 10).map((f) => ({
      person: f.label,
      via: f.via,
      title: oneLine(f.convo),
      at: f.convo.occurredAt ? f.convo.occurredAt.toISOString().slice(0, 10) : null,
    })),
  };

  if (dryRun) return { ...summary, dryRun: true, written: 0 };

  const { rows: batch } = await query(
    `INSERT INTO org_ai_imports (org_id, amber_id, provider, filename, conversations, matched)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
     RETURNING id`,
    [orgId, amberId, provider, filename, conversations.length, found.length],
  );
  const importId = batch[0].id;

  let written = 0;
  let duplicate = 0;
  const mine = [];
  for (const f of found) {
    const result = await record({
      orgId,
      memberId: amberId,
      kind: "ai",
      source: provider,
      /*
       * Keyed on the conversation AND the person. One conversation about two
       * people is two events in two relationships, and keying on the
       * conversation alone would record the first and drop the second as a
       * duplicate.
       */
      externalId: `${provider}:${f.convo.id}:${f.personId}`,
      summary: oneLine(f.convo),
      artifactUrl: conversationUrl(provider, f.convo.id),
      occurredAt: f.convo.occurredAt ?? new Date(),
      // Private, with no way for this route to say otherwise. Publishing one
      // is a separate, deliberate act by the person who owns it.
      visibility: "private",
      personId: f.personId,
    });
    if (result.ok && !result.duplicate) {
      written += 1;
      // The row this run actually created, so the stamp below can name it
      // rather than describing a set it hopes matches.
      if (result.interactionId) mine.push(result.interactionId);
    } else if (result.duplicate) duplicate += 1;
  }

  await query(
    `UPDATE org_ai_imports SET written = $3 WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, importId, written],
  );

  /*
   * STAMPED BY ID, AND THE PREVIOUS VERSION OF THIS COMMENT WAS WRONG ABOUT
   * ITS OWN QUERY.
   *
   * It said "scoped to this run's own rows by the external_id prefix it just
   * wrote". There was no external_id predicate. It stamped every unstamped
   * row this member had from this provider -- and since undoImport DELETES
   * by import_id, undoing one upload would have deleted interactions it did
   * not create.
   *
   * That is not hypothetical for Copilot specifically. The live connector
   * writes rows continuously under source='copilot' with no import_id,
   * because they did not come from an upload. The next export somebody
   * uploaded would have adopted all of them, and pressing Undo on that
   * upload would have taken the live history with it.
   *
   * Stamping the ids this run actually created cannot adopt anything.
   */
  if (mine.length > 0) {
    await query(
      `UPDATE org_interactions
          SET import_id = $2::uuid
        WHERE org_id = $1::uuid
          AND id = ANY($3::uuid[])
          AND import_id IS NULL`,
      [orgId, importId, mine],
    );
  }

  return { ...summary, importId, written, duplicate };
}

/**
 * Undo an import, whole.
 *
 * The same shape as revoking a consent grant, for the same reason: data that
 * arrived under one decision leaves under its reversal, and the edges derived
 * from it are rebuilt rather than left asserting a relationship whose evidence
 * is gone.
 */
export async function undoImport({ orgId, amberId, importId } = {}) {
  if (!orgId || !amberId || !importId) return { ok: false, reason: "bad_input" };

  const { rows: owned } = await query(
    `SELECT id FROM org_ai_imports
      WHERE org_id = $1::uuid AND id = $2::uuid AND amber_id = $3::uuid AND undone_at IS NULL`,
    [orgId, importId, amberId],
  );
  if (owned.length === 0) return { ok: false, reason: "not_found" };

  const { rows: touched } = await query(
    `SELECT DISTINCT person_id, member_id FROM org_interactions
      WHERE org_id = $1::uuid AND import_id = $2::uuid AND member_id IS NOT NULL`,
    [orgId, importId],
  );

  const { rowCount: removed } = await query(
    `DELETE FROM org_interactions WHERE org_id = $1::uuid AND import_id = $2::uuid`,
    [orgId, importId],
  );

  await query(
    `UPDATE org_ai_imports SET undone_at = now() WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, importId],
  );

  const { refreshEdge } = await import("./org-memory-store.js");
  for (const t of touched) {
    await refreshEdge({ orgId, personId: t.person_id, memberId: t.member_id }).catch(() => null);
  }

  await query(
    `DELETE FROM org_person_edges e
      WHERE e.org_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM org_interactions i
           WHERE i.org_id = e.org_id AND i.person_id = e.person_id
             AND i.member_id = e.member_id
        )`,
    [orgId],
  );

  return { ok: true, removed };
}

export async function listImports({ orgId, amberId } = {}) {
  if (!orgId || !amberId) return [];
  const { rows } = await query(
    `SELECT id, provider, filename, conversations, matched, written, created_at, undone_at
       FROM org_ai_imports
      WHERE org_id = $1::uuid AND amber_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 50`,
    [orgId, amberId],
  );
  return rows;
}

export const __test = { mentionsIn, matchables, tokens, oneLine, conversationUrl };
