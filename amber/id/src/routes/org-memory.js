/**
 * THE RELATIONSHIP LEDGER, OVER HTTP.
 *
 *   GET    /v1/org/memory/people                the roster, searchable
 *   GET    /v1/org/memory/people/:id            one person: node, who knows them, history
 *   PATCH  /v1/org/memory/people/:id            the written part: note, owner, visibility
 *   GET    /v1/org/memory/accounts              the firms, with the relationship summed
 *   GET    /v1/org/memory/accounts/:id          one firm: people, who knows them, timeline
 *   PATCH  /v1/org/memory/accounts/:id          rename, reclassify, assign an owner
 *   POST   /v1/org/memory/interactions          record one touch -- THE write path
 *   GET    /v1/org/memory/cold                  warm once, quiet since
 *   GET    /v1/org/memory/sources               what the caller has let feed this
 *   POST   /v1/org/memory/sources               grant one
 *   DELETE /v1/org/memory/sources/:id           revoke, and take the data back
 *
 * WHY THE WRITE PATH IS ONE ROUTE AND NOT SIX. Calendar, transcripts, CRM,
 * enrichment and an agent all want to say the same sentence: this person,
 * this kind of contact, at this time, from this source. Giving each producer
 * its own endpoint means each one gets its own idea of identity, and within a
 * quarter the same human is four people. One door, one normalizer, one place
 * where dedupe either works or is visibly broken.
 *
 * It also means a producer we have not written yet -- a script, a Clay table,
 * somebody's agent -- is a first-class source on day one rather than a feature
 * request. That is the difference between a product that has integrations and
 * one that can be integrated with.
 *
 * EVERY READ CARRIES THE VIEWER, and that is not a convenience. Content is
 * private to the member it belongs to while the aggregate rolls up to the
 * company, so a read without a viewer is not a read with slightly less
 * filtering, it is a read that shows one person's conversations to everybody.
 * The store takes viewerId explicitly for that reason: a missing argument is
 * visible at the call site rather than defaulting to permissive.
 *
 * WHAT A CALLER CANNOT DO HERE, DELIBERATELY:
 *
 *   Edit history. There is no PATCH and no DELETE on an interaction. The
 *   ledger is append-only because the moment it is editable it stops being
 *   evidence, and the compliance story this whole surface rests on quietly
 *   becomes untrue with nothing failing. A correction is another row.
 *
 *   Write an edge. Who-knows-whom is a fold over the ledger, recomputed,
 *   never asserted. An authored edge cannot be rebuilt when the scoring
 *   changes, and it is the one number people will want to tune for years.
 *
 *   Revoke somebody else's source. Consent is held per person, over their own
 *   connections, and an admin cannot grant it for them or keep it on their
 *   behalf. That is the no-admin-override rule the audience model already
 *   follows, applied to the thing it matters most for.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgAdmin, requireOrgMember } from "../lib/resolve-actor.js";
import {
  ALL_SOURCES,
  applyRetention,
  getPolicy,
  listRefusals,
  setPolicy,
} from "../db/org-memory-policy.js";
import { openTenantScope } from "../db/tenant.js";
import {
  listLinks,
  addLink,
  acceptLink,
  removeLink,
} from "../db/org-person-links.js";
import {
  extractContactSignalsLong,
  resolveContactByName,
} from "../lib/fact-capture.js";
import { transcribeWithOpenAI, transcribeWithGroq } from "./voice.js";
import { sendEmail } from "../lib/email-delivery.js";
import { query } from "../db/sql.js";
import { ID_FIELDS, blankToNull } from "../lib/empty-uuid.js";
import { readExportBuffer, parseExport } from "../lib/ai-export.js";
import { importExport, listImports, undoImport } from "../db/org-ai-import.js";
import { distillKnowledge } from "../db/org-ai-knowledge.js";
import { enrichNames, enrichFirms } from "../db/org-name-enrich.js";
import { reconcileNames, autoMerge, nameCoverage } from "../db/org-people-reconcile.js";
import { importProjects, importDocuments } from "../db/org-ai-projects.js";
import { bridgeMember } from "../db/org-memory-bridge.js";
import { searchPages } from "../db/org-knowledge-store.js";
import { listGroupsForMember } from "../db/org-store.js";
import { readSyncableAccounts } from "../db/calendar-accounts.js";
import { syncCalendarAccount } from "../lib/calendar-sync.js";
import {
  accountHistory,
  mergePeople,
  suggestMerges,
  unmergePerson,
  getAccount,
  getPerson,
  attachIdentities,
  goingCold,
  grantSource,
  history,
  listAccounts,
  listPeople,
  listSources,
  record,
  revokeSource,
  whoKnows,
} from "../db/org-memory-store.js";

/** Sources a person can connect to their own ledger today. */
const GRANTABLE = new Set(["calendar", "mail", "transcript", "crm", "enrichment", "manual"]);

const ACCOUNT_KINDS = new Set(["firm", "prospect", "client", "partner", "vendor", "other"]);


/**
 * The per-document sharing choices that came up with the file.
 *
 * ANY FAILURE HERE MEANS PRIVATE. A missing field, malformed JSON, a value
 * of the wrong shape -- every one of those resolves to nothing, and
 * distillKnowledge treats an absent choice as the importer alone. The
 * alternative is a parse error deciding who sees somebody's private
 * thinking.
 */
function readReach(file) {
  try {
    const raw = file?.fields?.reach?.value;
    if (!raw) return {};
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function registerOrgMemoryRoutes(
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
  const asAdmin = {
    preHandler: [tidyIds, requireAuth, resolveActor, requireOrgAdmin, openTenantScope],
  };

  const org = (request) => request.actor.orgId;
  const who = (request) => request.actor.amberId;
  const capped = (v, fallback, max) => Math.min(Number(v) || fallback, max);
  const isMine = (v) => v === "1" || v === "true";

  /* ------------------------------------------------------------- people */

  app.get("/v1/org/memory/people", asMember, async (request) => {
    const { q = null, owner = null, account = null, mine = null, scope = null } =
      request.query ?? {};
    const people = await listPeople({
      orgId: org(request),
      q,
      // `mine=1` is the common case and spares the client knowing its own id.
      ownerId: isMine(mine) ? who(request) : owner,
      accountId: account,
      viewerId: who(request),
      // 'internal' or 'external'. Derived from the company's email domain
      // rather than a field somebody maintains, so a colleague who turns up
      // on a calendar before accepting their invitation is already filed
      // correctly.
      scope,
      limit: capped(request.query?.limit, 100, 500),
    });
    return { people };
  });

  app.get("/v1/org/memory/people/:personId", asMember, async (request, reply) => {
    const orgId = org(request);
    const viewerId = who(request);
    const { personId } = request.params;

    const person = await getPerson({ orgId, personId, viewerId });
    if (!person) return reply.code(404).send({ error: "not_found" });

    /*
     * Three reads rather than one joined monster: the history is paged and
     * the edges are not, and a query that returns a person's whole timeline
     * to draw a face pile is the kind of thing that is fine until somebody
     * has four thousand interactions.
     */
    const [knows, timeline] = await Promise.all([
      whoKnows({ orgId, personId }),
      history({ orgId, personId, viewerId, limit: capped(request.query?.limit, 100, 500) }),
    ]);

    return {
      person,
      whoKnows: knows,
      history: timeline.items,
      // Said out loud rather than quietly truncated. A timeline that looks
      // complete and is not is how somebody concludes a relationship is cold
      // when a colleague spoke to them yesterday.
      hidden: timeline.hidden,
    };
  });

  /**
   * A PERSON'S WIKI PAGE.
   *
   * WHY THIS IS NOT THE ROUTE ABOVE. That one answers "what is this record":
   * the row, who knows them, the timeline. This answers "who is this person
   * to us", which is a different question and needs two things the record
   * does not carry -- what we have WRITTEN that mentions them, and which
   * rooms they are in.
   *
   * THE WRITING IS FOUND BY SEARCH, not by a link table, and that is a
   * deliberate trade. Nobody tags a page with the people it is about, so a
   * link table would be empty and honest and useless. Searching the pages
   * for their name finds the meeting notes, the brief and the account plan
   * that actually mention them, which is what somebody means by "what do we
   * know about her". It can over-match a common name; the page titles are
   * shown so a wrong one is visible rather than silently believed.
   *
   * CIRCLES ONLY WHEN THEY ARE ONE OF US. A counterparty is not in a
   * circle, and inventing "the circles of the colleagues who know them"
   * would be a relationship nobody asserted. Null means not a member, which
   * the screen says plainly.
   */
  app.get("/v1/org/memory/people/:personId/profile", asMember, async (request, reply) => {
    const orgId = org(request);
    const viewerId = who(request);
    const { personId } = request.params;

    const person = await getPerson({ orgId, personId, viewerId });
    if (!person) return reply.code(404).send({ error: "not_found" });

    const name = String(person.display_name ?? "").trim();
    const [knows, timeline, pages, circles] = await Promise.all([
      whoKnows({ orgId, personId }).catch(() => []),
      history({ orgId, personId, viewerId, limit: 40 }).catch(() => ({ items: [], hidden: 0 })),
      name.length >= 3
        ? searchPages({ orgId, q: name, viewerId, limit: 8 }).catch(() => [])
        : Promise.resolve([]),
      person.member_amber_id
        ? listGroupsForMember({ orgId, amberId: person.member_amber_id }).catch(() => [])
        : Promise.resolve(null),
    ]);

    return {
      person,
      whoKnows: knows,
      history: timeline.items,
      hidden: timeline.hidden,
      pages,
      /* null is "not one of us", which is different from "in no circles". */
      circles,
    };
  });

  /**
   * The written part of a person: a note, an owner, and who may see them.
   *
   * Everything else on the node is derived, which is why this route can exist
   * without contradicting the append-only rule: it touches org_people, not
   * the ledger.
   */
  app.patch("/v1/org/memory/people/:personId", asMember, async (request, reply) => {
    const orgId = org(request);
    const { personId } = request.params;
    const { note, ownerId, title, company, visibility, displayName } = request.body ?? {};

    if (visibility != null && !["org", "private"].includes(visibility)) {
      return reply.code(400).send({ error: "bad_visibility", allowed: ["org", "private"] });
    }

    const { rows } = await query(
      /*
       * display_name IS EDITABLE HERE and nowhere else. Of 515 guest entries
       * on a real calendar, 5 carried a name, so a node is usually titled
       * after an email address and somebody has to be able to say who that
       * actually is. A producer may only UPGRADE an address to a name; a
       * person may write whatever is true.
       */
      `UPDATE org_people
          SET display_name = COALESCE(NULLIF(btrim($8), ''), display_name),
              /*
               * AND IT IS NOW A HUMAN'S NAME, which outranks every producer.
               * Without this, somebody corrects "Caleb New" to "Caleb Newton"
               * and the next sync that finds any provider name puts the old
               * one back -- a correction that silently un-corrects itself is
               * worse than no edit at all.
               */
              name_source = CASE
                WHEN NULLIF(btrim($8), '') IS NOT NULL THEN 'human'
                ELSE name_source
              END,
              note       = COALESCE($3, note),
              owner_id   = COALESCE($4::uuid, owner_id),
              title      = COALESCE($5, title),
              company    = COALESCE($6, company),
              visibility = COALESCE($7, visibility),
              updated_at = now()
        WHERE org_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
        RETURNING id`,
      [orgId, personId, note ?? null, ownerId ?? null, title ?? null,
       company ?? null, visibility ?? null, displayName ?? null],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });

    return { person: await getPerson({ orgId, personId, viewerId: who(request) }) };
  });

  /* -------------------------------------------------------------- merging */

  /**
   * Nodes that look like one person.
   *
   * THE FIRST REAL BACKFILL PRODUCED THREE SAGARS. A calendar invite carries
   * one address per attendee and nothing joining a work address to a
   * university one, so no care at write time can prevent it. The join has to
   * happen later and on purpose.
   *
   * Suggested, never performed. A shared name is weak evidence and two real
   * people do share one; a wrong merge puts one customer's history on
   * another's record, which is not recoverable by apology.
   */
  /**
   * ADD AN ADDRESS TO SOMEBODY BY HAND.
   *
   * The graph learns an address by seeing it on a meeting or a message. That
   * is most of them and not all of them: a colleague's company address never
   * appears if every meeting with them used their university one, so they sit
   * outside "one of us" while plainly being one of us.
   *
   * Adding it here is the same claim as typing their name -- a person saying
   * what is true -- and it goes through attachIdentities, so it merges into
   * whoever already owns that address rather than creating a second row.
   */
  app.post("/v1/org/memory/people/:personId/identities", asMember, async (request, reply) => {
    const orgId = org(request);
    const { personId } = request.params;
    const value = String(request.body?.email ?? "").trim().toLowerCase();
    if (!value.includes("@") || value.length > 320) {
      return reply.code(400).send({ error: "bad_address" });
    }

    const person = await getPerson({ orgId, personId, viewerId: who(request) }).catch(() => null);
    if (!person) return reply.code(404).send({ error: "no_person" });

    const added = await attachIdentities({
      orgId,
      personId,
      identities: [{ kind: "email", value }],
      source: "human",
    }).catch(() => 0);

    /*
     * Nothing added means the address already belongs to somebody else. That
     * is a merge, not an error, and the duplicates screen is where merges
     * are decided -- so say so rather than silently doing nothing.
     */
    if (!added) return reply.code(409).send({ error: "address_taken" });
    return { ok: true, email: value };
  });

  /* --------------------------------------------------- writing to somebody */

  /**
   * SEND TO ONE OF THEIR ADDRESSES, FROM HERE.
   *
   * Clicking an address used to hand the whole thing to a mail client in
   * another window, which is the moment the context is lost: everything you
   * know about this person is on the screen you just left. The compose box
   * lives on the card instead.
   *
   * THE ADDRESS IS NOT TAKEN FROM THE REQUEST. The body names a person and
   * an address, and the address must be one of THAT person's identities, read
   * through the viewer-aware profile. Otherwise this route is an open relay
   * that writes from the company's domain to anywhere, on any member's
   * session -- which is how a product becomes a spam vector by accident.
   *
   * It sends from the company's own domain, which means the domain has to be
   * verified with the mail provider before anything leaves -- the same
   * verification invitations need. A refusal says which, rather than
   * reporting a generic failure.
   */
  app.post(
    "/v1/org/memory/people/:personId/email",
    { ...asMember, bodyLimit: 22 * 1024 * 1024 },
    async (request, reply) => {
    const orgId = org(request);
    const viewerId = who(request);
    const { to, subject, body, sendAt, attachments } = request.body ?? {};

    const clean = String(to ?? "").trim().toLowerCase();
    const subjectText = String(subject ?? "").trim();
    const bodyText = String(body ?? "").trim();
    if (!clean.includes("@")) return reply.code(400).send({ error: "bad_address" });
    if (!subjectText) return reply.code(400).send({ error: "no_subject" });
    if (!bodyText) return reply.code(400).send({ error: "no_body" });
    if (subjectText.length > 300 || bodyText.length > 20000) {
      return reply.code(400).send({ error: "too_long" });
    }

    const person = await getPerson({
      orgId,
      personId: request.params.personId,
      viewerId,
    }).catch(() => null);
    if (!person) return reply.code(404).send({ error: "no_person" });

    const theirs = (person.identities ?? []).some(
      (i) => i.kind === "email" && String(i.value ?? "").toLowerCase() === clean,
    );
    if (!theirs) return reply.code(400).send({ error: "not_their_address" });

    /* A schedule in the past is a send now, not an error worth refusing. */
    let when = null;
    if (sendAt) {
      const at = new Date(sendAt);
      if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now() + 30_000) {
        when = at.toISOString();
      }
    }

    /*
     * ATTACHMENTS, BOUNDED. Base64 inflates by a third, so a 20 MB body limit
     * is about 15 MB of files -- the same ceiling most mail providers
     * enforce anyway. Anything bigger is refused here with a sentence rather
     * than failing downstream as a generic send error.
     */
    const files = (Array.isArray(attachments) ? attachments : [])
      .filter((f) => f && typeof f.filename === "string" && typeof f.content === "string")
      .slice(0, 10)
      .map((f) => ({ filename: f.filename.slice(0, 200), content: f.content }));
    const totalBytes = files.reduce((n, f) => n + f.content.length * 0.75, 0);
    if (totalBytes > 15 * 1024 * 1024) {
      return reply.code(413).send({ error: "attachments_too_large" });
    }

    const result = await sendEmail({
      to: clean,
      subject: subjectText,
      text: bodyText,
      sendAt: when,
      attachments: files,
    });

    if (!result.ok) {
      return reply.code(502).send({
        error: "not_sent",
        reason: result.reason ?? null,
        detail: result.detail ?? null,
      });
    }

      return { ok: true, to: clean, scheduledFor: when };
    },
  );

  /* ------------------------------------------------- links between people */

  app.get("/v1/org/memory/links", asMember, async (request) => {
    return { links: await listLinks({ orgId: org(request) }) };
  });

  app.post("/v1/org/memory/links", asMember, async (request, reply) => {
    const { fromPerson, toPerson, kind, note } = request.body ?? {};
    const result = await addLink({
      orgId: org(request),
      fromPerson,
      toPerson,
      kind,
      note: typeof note === "string" ? note.slice(0, 500) : null,
      source: "human",
      byAmberId: who(request),
    });
    if (!result.ok) return refuse(reply, result.reason, "Could not link those two.");
    reply.code(201);
    return result;
  });

  app.post("/v1/org/memory/links/:linkId/accept", asMember, async (request, reply) => {
    const result = await acceptLink({ orgId: org(request), linkId: request.params.linkId });
    if (!result.ok) return refuse(reply, result.reason, "That link is not there.");
    return result;
  });

  app.delete("/v1/org/memory/links/:linkId", asMember, async (request, reply) => {
    const result = await removeLink({ orgId: org(request), linkId: request.params.linkId });
    if (!result.ok) return refuse(reply, result.reason, "That link is not there.");
    return result;
  });

  /* ------------------------------------------- saying it instead of typing */

  /**
   * SAY IT, AND IT LANDS ON THE RIGHT PEOPLE.
   *
   * THIS IS NOT A NEW PIPELINE. The personal app has had the hard half of
   * this for months and it is all in here already: extractContactSignalsLong
   * pulls every fact out of a spoken paragraph along with WHO each one is
   * about, and resolveContactByName matches a spoken name against a roster
   * with full-name precedence, nickname handling, phonetic fallback and --
   * the part that matters -- an honest "ambiguous" with the candidates
   * attached rather than a guess. That resolver carries the scar tissue of a
   * real bug: one in ten exact full names used to file against the wrong
   * person. None of that is worth rewriting against org_people.
   *
   * So the only new thing here is the roster it resolves against. Org people
   * are mapped into the shape those functions already take, and the answer
   * comes back in three piles: what matched, what was ambiguous and needs a
   * person to choose, and what matched nobody.
   *
   * IT PROPOSES AND WRITES NOTHING. Every pile is returned for confirmation.
   * A model that writes to the graph unasked is the exact failure that cost
   * us today.
   */
  app.post(
    "/v1/org/memory/capture",
    { ...asMember, bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      const orgId = org(request);
      const { text, audioBase64, mimeType } = request.body ?? {};

      let said = typeof text === "string" ? text.trim() : "";
      if (!said && audioBase64) {
        /*
         * GROQ FIRST, OPENAI SECOND -- the same order the voice route uses,
         * because Groq is the fast one and the fallback exists for when it
         * is not configured or is having a bad minute.
         *
         * AND THE FIELD IS `transcript`, NOT `text`. Reading the wrong key
         * made a successful transcription look like an empty one, which the
         * screen reported as "that recording could not be transcribed" --
         * a lie, and the kind that sends somebody looking at their
         * microphone.
         */
        const heard =
          (await transcribeWithGroq({ audioBase64, mimeType }).catch(() => null)) ??
          (await transcribeWithOpenAI({ audioBase64, mimeType }).catch(() => null));
        said = String(heard?.transcript ?? "").trim();
        if (!said) {
          const configured = Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
          console.warn(
            `[org-capture] no transcript; speech keys configured = ${configured}`,
          );
          return reply.code(502).send({
            error: "could_not_transcribe",
            reason: configured ? "nothing_heard" : "no_speech_key",
          });
        }
      }
      if (said.length < 2) return reply.code(400).send({ error: "nothing_said" });
      if (said.length > 8000) said = said.slice(0, 8000);

      /*
       * The candidates are the viewer's own roster, read through the same
       * viewer-aware function every screen uses, so a name can only ever
       * resolve to somebody this person is already allowed to see.
       */
      const roster = await listPeople({ orgId, viewerId: who(request), limit: 300 }).catch(
        () => [],
      );

      /*
       * Into the shape the resolver takes. It expects full_name and an
       * interaction count -- the count is what breaks a tie between two
       * people with the same name, by who is actually dealt with.
       */
      const candidates = roster.map((p) => ({
        id: String(p.id),
        full_name: String(p.display_name ?? ""),
        interaction_count: Number(p.interactions ?? 0),
      }));

      const signals = await extractContactSignalsLong({ message: said, owner: who(request) }).catch(
        () => [],
      );

      const notes = [];
      const ambiguous = [];
      const unmatched = new Map();
      const links = [];

      for (const sig of signals) {
        /* "self" is the speaker; a fact about them is not a contact note. */
        const named = (sig.subjects ?? []).filter(
          (x) => typeof x === "string" && x.trim() && x.toLowerCase() !== "self",
        );
        if (named.length === 0) continue;

        const resolvedHere = [];
        for (const name of named) {
          const hit = resolveContactByName(name, candidates);
          if (hit.status === "resolved") {
            resolvedHere.push({ id: String(hit.contactId), name: hit.matchedName ?? name });
            notes.push({
              personId: String(hit.contactId),
              personName: hit.matchedName ?? name,
              text: sig.content,
              category: sig.category ?? null,
            });
          } else if (hit.status === "ambiguous") {
            ambiguous.push({
              said: name,
              text: sig.content,
              candidates: (hit.candidateObjects ?? []).slice(0, 6),
            });
          } else {
            unmatched.set(name.toLowerCase(), { said: name, text: sig.content });
          }
        }

        /*
         * TWO PEOPLE IN ONE SENTENCE IS A CONNECTION BETWEEN THEM. The
         * extractor already marks these: is_shared_event, or simply more
         * than one subject. "Sagar introduced me to Jonah" names both, and
         * the sentence itself is the reason the line exists.
         */
        if (resolvedHere.length >= 2) {
          const introduced = /\bintroduc|\bconnect(ed)?\s+me|\bput me in touch\b/i.test(
            sig.content,
          );
          for (let i = 1; i < resolvedHere.length; i += 1) {
            links.push({
              fromId: resolvedHere[0].id,
              fromName: resolvedHere[0].name,
              toId: resolvedHere[i].id,
              toName: resolvedHere[i].name,
              kind: introduced ? "introduced" : sig.is_past ? "met_at" : "knows",
              note: sig.content.slice(0, 300),
            });
          }
        }
      }

      return {
        ok: true,
        transcript: said,
        notes: notes.slice(0, 20),
        links: links.slice(0, 20),
        ambiguous: ambiguous.slice(0, 10),
        unmatched: [...unmatched.values()].slice(0, 10),
      };
    },
  );

  app.get("/v1/org/memory/duplicates", asMember, async (request) => {
    return { groups: await suggestMerges({ orgId: org(request), limit: 50 }) };
  });

  app.post("/v1/org/memory/merge", asMember, async (request, reply) => {
    const { keepId, mergeIds } = request.body ?? {};
    const result = await mergePeople({
      orgId: org(request),
      keepId,
      mergeIds: Array.isArray(mergeIds) ? mergeIds : [],
      byAmberId: who(request),
    });
    if (!result.ok) {
      return reply.code(result.reason === "not_found" ? 404 : 400).send({ error: result.reason });
    }
    return result;
  });

  app.delete("/v1/org/memory/merge/:personId", asMember, async (request, reply) => {
    const result = await unmergePerson({
      orgId: org(request),
      personId: request.params.personId,
    });
    if (!result.ok) {
      return reply.code(result.reason === "not_found" ? 404 : 400).send({ error: result.reason });
    }
    return result;
  });

  /* ----------------------------------------------------------- accounts */

  app.get("/v1/org/memory/accounts", asMember, async (request) => {
    const { q = null, owner = null, mine = null } = request.query ?? {};
    const accounts = await listAccounts({
      orgId: org(request),
      q,
      ownerId: isMine(mine) ? who(request) : owner,
      limit: capped(request.query?.limit, 100, 500),
    });
    return { accounts };
  });

  app.get("/v1/org/memory/accounts/:accountId", asMember, async (request, reply) => {
    const orgId = org(request);
    const viewerId = who(request);
    const { accountId } = request.params;

    const found = await getAccount({ orgId, accountId, viewerId });
    if (!found) return reply.code(404).send({ error: "not_found" });

    const timeline = await accountHistory({
      orgId,
      accountId,
      viewerId,
      limit: capped(request.query?.limit, 100, 500),
    });

    return { ...found, history: timeline.items, hidden: timeline.hidden };
  });

  app.patch("/v1/org/memory/accounts/:accountId", asMember, async (request, reply) => {
    const orgId = org(request);
    const { accountId } = request.params;
    const { name, kind, note, ownerId } = request.body ?? {};

    if (kind != null && !ACCOUNT_KINDS.has(kind)) {
      return reply.code(400).send({ error: "bad_kind", allowed: [...ACCOUNT_KINDS] });
    }

    /*
     * The domain is not editable. It is the join key every producer resolves
     * against, so changing it does not move the firm, it orphans everyone
     * already under it and silently starts a second account on the next
     * calendar invite. Renaming is what people actually want here, and that
     * is the `name` field.
     */
    const { rows } = await query(
      `UPDATE org_accounts
          SET name       = COALESCE($3, name),
              kind       = COALESCE($4, kind),
              note       = COALESCE($5, note),
              owner_id   = COALESCE($6::uuid, owner_id),
              updated_at = now()
        WHERE org_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
        RETURNING id`,
      [orgId, accountId, name ?? null, kind ?? null, note ?? null, ownerId ?? null],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });

    return { account: (await getAccount({ orgId, accountId, viewerId: who(request) }))?.account };
  });

  /* -------------------------------------------------------- the write path */

  app.post("/v1/org/memory/interactions", asMember, async (request, reply) => {
    const body = request.body ?? {};

    /*
     * memberId is the ACTOR, and it is taken from the session rather than the
     * body on purpose. A route that accepts "this happened on behalf of Dana"
     * lets anybody build Dana a relationship history she never had, and the
     * edge strength that comes out of it is what the company will route warm
     * intros on. The one caller who legitimately needs to attribute to
     * someone else is a sync running as that person, which is exactly what
     * the source grant below is for.
     */
    const result = await record({
      orgId: org(request),
      memberId: who(request),
      kind: body.kind,
      source: body.source,
      externalId: body.externalId ?? null,
      summary: body.summary ?? null,
      artifactUrl: body.artifactUrl ?? null,
      occurredAt: body.occurredAt ?? null,
      connectionId: body.connectionId ?? null,
      // Private unless the caller says otherwise. The store defaults the same
      // way; repeating it here is so that reading this route tells you what
      // happens rather than requiring you to go and check.
      visibility: body.visibility === "org" ? "org" : "private",
      personId: body.personId ?? null,
      identities: Array.isArray(body.identities) ? body.identities : [],
      displayName: body.displayName ?? null,
      title: body.title ?? null,
      company: body.company ?? null,
    });

    if (!result.ok) {
      // `no_person` is the one a caller can act on: it means nothing in the
      // payload could identify a human, so say which field was missing rather
      // than returning a bare 400 that looks like a bug in their script.
      const code = result.reason === "no_person" ? 422 : 400;
      return reply.code(code).send({
        error: result.reason,
        hint:
          result.reason === "no_person"
            ? "Send personId, or identities: [{ kind: 'email' | 'phone' | ..., value }], or a displayName."
            : undefined,
      });
    }

    return result;
  });

  /* ----------------------------------------------------------- first run */

  /**
   * Pull everything this member has connected, and build their graph.
   *
   * ONE CALL, BECAUSE THE ALTERNATIVE IS A SETUP WIZARD. Connecting a
   * calendar and then being returned to an empty screen is how somebody
   * decides a product does not work: the consent succeeded, the sync
   * succeeded, and they were shown nothing. This is what the button presses
   * after they come back from Google.
   *
   * THREE YEARS, NOT SIXTY DAYS. The routine sync asks for a day view's
   * worth. The whole point of this graph is the person somebody has not
   * spoken to in eight months, and a sixty-day window cannot see one. Paid
   * once, here.
   *
   * Idempotent end to end: the upsert on the calendar side and the
   * (source, external_id) key on the ledger mean running it twice is a
   * no-op, so a double click costs time and nothing else.
   */
  app.post("/v1/org/memory/sync", asMember, async (request) => {
    const orgId = org(request);
    const amberId = who(request);

    // Consent first. Nothing may move without a grant, and the grant is what
    // revoking later deletes against.
    /*
     * BOTH SOURCES, AND MAIL WAS MISSING.
     *
     * bridgeMember runs every source the member has GRANTED -- the grant is
     * the authority -- and this route granted only the calendar. So the mail
     * bridge, which exists and works, never ran for anybody who pressed
     * Connect. The graph came back with the people who appeared on a meeting
     * invitation and nobody else, which reads as "my network is tiny" and is
     * actually "we only looked at half of it".
     *
     * A forbidden source is not a failure here: an administrator who turned
     * mail off meant it, and the calendar should still sync. Only BOTH being
     * refused is worth stopping for.
     */
    const grants = await Promise.all([
      grantSource({ orgId, amberId, source: "calendar" }),
      grantSource({ orgId, amberId, source: "mail" }),
    ]);

    if (grants.every((g) => !g.ok)) {
      return {
        ok: false,
        reason: "source_forbidden",
        hint: "Your administrator has turned off both the calendar and mail sources for this company.",
      };
    }

    const accounts = await readSyncableAccounts(amberId);
    const synced = [];
    for (const a of accounts) {
      const out = await syncCalendarAccount(
        a,
        {},
        { pastDays: 1095, futureDays: 120, maxEvents: 20000 },
      ).catch((err) => ({ written: 0, error: String(err?.message ?? err) }));
      synced.push({ account: a.account_email, events: out.written ?? 0, error: out.error ?? null });
    }

    const bridged = await bridgeMember({ orgId, amberId, limit: 20000 });

    /*
     * NAME THEM BEFORE ANYBODY SEES THEM.
     *
     * Google sends a display name for a handful of attendees and an address
     * for the rest, so a sync that stops here hands somebody a graph of
     * sagartiw@stanford.edu and bvance@paychex.com -- which is the moment
     * they decide the product does not know anything. The names are
     * recoverable from the addresses, so recovering them is part of the
     * sync rather than a script somebody has to be told to run.
     *
     * IT RUNS AFTER THE COUNTS MATTER AND BEFORE THE REPLY, which costs a
     * few seconds on a first sync and nothing afterwards -- there is nothing
     * left to name on the second run. A failure here is not a failed sync:
     * the people are in, addresses are what they were, and the next sync
     * tries again.
     */
    /*
     * THE PROVIDER FIRST, THE MODEL ONLY FOR WHAT IS LEFT.
     *
     * Google and Microsoft put the guest's own display name on every invite
     * and the sync has been storing it all along. Reading it is exact, free
     * and instant, so it runs before the model does and the model is left
     * with whoever genuinely arrived without a name. Doing this the other
     * way round is how a graph full of "Pandey" and "Sagartiw" survived a
     * week of syncs that each asked a model to guess.
     */
    const reconciled = await reconcileNames({ orgId }).catch(() => ({ renamed: 0 }));
    const named = await enrichNames({ orgId }).catch((err) => ({
      ok: false,
      reason: String(err?.message ?? err),
    }));
    const firmsNamed = await enrichFirms({ orgId }).catch(() => ({ ok: false }));
    /* Real names make the duplicate suggester fire, so apply what it finds. */
    const folded = await autoMerge({ orgId, byAmberId: amberId }).catch(() => ({ merged: 0 }));

    const { rows } = await query(
      `SELECT
         (SELECT count(*)::int FROM org_people
           WHERE org_id = $1::uuid AND deleted_at IS NULL AND merged_into IS NULL) AS people,
         (SELECT count(*)::int FROM org_accounts
           WHERE org_id = $1::uuid AND deleted_at IS NULL)                        AS accounts,
         (SELECT count(*)::int FROM org_person_edges
           WHERE org_id = $1::uuid AND member_id = $2::uuid)                      AS mine`,
      [orgId, amberId],
    );

    return {
      ok: true,
      calendars: accounts.length,
      synced,
      named: (named?.named ?? 0) + (reconciled?.renamed ?? 0),
      fromProvider: reconciled?.renamed ?? 0,
      mergedPeople: folded?.merged ?? 0,
      firmsNamed: firmsNamed?.named ?? 0,
      written: bridged.written ?? 0,
      ...rows[0],
    };
  });

  /*
   * NAME EVERYBODY, ON DEMAND.
   *
   * The sync does this already. This exists because a company that synced
   * last week has a graph full of addresses NOW, and telling them to
   * re-sync -- twenty thousand events, several minutes -- to fix a label is
   * not an answer. `?dry=1` lists what it would change and writes nothing.
   */
  /*
   * WHICH SOURCE HAS WHICH NAME, counted, changing nothing.
   *
   * "The names are not coming through" has three different causes that look
   * identical on screen: no source holds the name, a source holds it and the
   * pass has not run, or Google is refusing for want of a contacts consent.
   * This separates them.
   */
  app.get("/v1/org/memory/names/sources", asMember, async (request) => {
    return { ok: true, coverage: await nameCoverage({ orgId: org(request) }) };
  });

  app.post("/v1/org/memory/names", asMember, async (request) => {
    const orgId = org(request);
    const dryRun = request.query?.dry === "1" || request.query?.dry === "true";
    /* Exact names from the calendars first; the model only for the rest. */
    const provider = dryRun
      ? { renamed: 0, considered: 0 }
      : await reconcileNames({ orgId }).catch(() => ({ renamed: 0, considered: 0 }));

    const [people, firms] = await Promise.all([
      enrichNames({ orgId, dryRun }).catch((err) => ({
        ok: false,
        reason: String(err?.message ?? err),
      })),
      enrichFirms({ orgId, dryRun }).catch(() => ({ ok: false })),
    ]);

    const folded = dryRun
      ? { merged: 0 }
      : await autoMerge({ orgId, byAmberId: who(request) }).catch(() => ({ merged: 0 }));

    return { ok: true, dryRun, provider, people, firms, merged: folded.merged ?? 0 };
  });

  /* --------------------------------------------------------------- nudges */

  app.get("/v1/org/memory/cold", asMember, async (request) => {
    const { mine = null, days = null } = request.query ?? {};
    const people = await goingCold({
      orgId: org(request),
      memberId: isMine(mine) ? who(request) : null,
      viewerId: who(request),
      days: Math.min(Math.max(Number(days) || 21, 1), 365),
      limit: capped(request.query?.limit, 20, 100),
    });
    return { people };
  });

  /* ------------------------------------------------------------ AI history */

  /**
   * Import an export from an assistant.
   *
   * WHAT THIS DOES NOT DO is as important as what it does. It never creates a
   * person: it can only attach to somebody the graph already knows from a
   * calendar invite or a mailbox, which is evidence that the relationship is
   * real. Names in free text are ambiguous and models invent people, and a
   * graph grown from chat text fills with half-real contacts nobody can
   * verify or delete.
   *
   * The conversation itself never crosses. What lands is a reference, a date
   * and the conversation's own title, which both products already write as a
   * description of what it was about.
   */
  app.post("/v1/org/memory/import", asMember, async (request, reply) => {
    const file = typeof request.file === "function" ? await request.file() : null;
    if (!file) return reply.code(400).send({ error: "no_file" });

    let buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      // @fastify/multipart throws this when the stream passes the size limit,
      // which is a sentence on a screen rather than a 500.
      return reply.code(413).send({ error: "too_large" });
    }

    const read = readExportBuffer(buffer, file.filename ?? null);
    if (read.error) {
      /*
       * THE MANIFEST CASE CARRIES ITS OWN ANSWER. Claude's export is five
       * separate downloads now, and the file people receive first is a JSON
       * index of them. "Unrecognized format" is true and useless when the
       * thing they uploaded names exactly what to fetch instead.
       */
      if (read.error === "manifest_not_data") {
        return reply.code(400).send({
          error: "manifest_not_data",
          hint:
            "That is the index of your export, not the export. Open it, download " +
            "conversations-000.zip and projects-000.zip from the links inside, and drop those here.",
          parts: read.manifest ?? [],
        });
      }
      return reply.code(400).send({ error: read.error });
    }

    /*
     * DRY RUN BY DEFAULT, because the question everybody asks first is "what
     * would this put in my graph", and answering it by writing the rows and
     * showing the result is the same answer at a much worse price. The client
     * shows the sample, the person says go, and the second call writes.
     *
     * DECLARED HERE, ABOVE EVERY BRANCH THAT READS IT. It used to sit below
     * the projects branch, which referenced it: `const` is hoisted but not
     * initialized, so the reference was a temporal dead zone throw, and every
     * projects upload died with "Cannot access 'dryRun' before
     * initialization". It built green and no test caught it because nothing
     * exercised that branch.
     */
    const dryRun = request.query?.commit !== "1" && request.query?.commit !== "true";

    /*
     * EVERY PART OF THE ARCHIVE, IMPORTED TOGETHER.
     *
     * A zip is rarely one thing. The export somebody drops holds projects
     * AND the notes beside them AND the artifact they built last month, and
     * the first version of this took whichever shape it recognized first
     * and dropped the rest without saying so. The reader returns the whole
     * inventory now, and every part of it goes through its own importer.
     *
     * EACH PART KEEPS ITS OWN SHAPE on the way in. A project is a project
     * -- its instructions and its document list; a skill carries the files
     * that came with it; an artifact is kept byte for byte because it is a
     * thing that RUNS and a summary of it is useless. One preview list
     * comes back out, tagged by what each row is, so the screen shows the
     * archive rather than a number.
     */
    if (read.kind === "bundle") {
      const orgId = org(request);
      const amberId = who(request);
      const reach = readReach(file);

      const parts = [
        ["project", () =>
          importProjects({ orgId, amberId, projects: read.projects, dryRun, reach })],
        ["skill", () =>
          importDocuments({ orgId, amberId, items: read.skills, kind: "skill", dryRun, reach })],
        ["artifact", () =>
          importDocuments({
            orgId, amberId, items: read.artifacts, kind: "artifact", dryRun, reach,
          })],
        ["doc", () =>
          importDocuments({ orgId, amberId, items: read.docs, kind: "doc", dryRun, reach })],
        ["data", () =>
          importDocuments({ orgId, amberId, items: read.data, kind: "data", dryRun, reach })],
      ];

      const results = {};
      for (const [name, run] of parts) {
        const count =
          name === "project" ? read.projects.length
          : name === "skill" ? read.skills.length
          : name === "artifact" ? read.artifacts.length
          : name === "doc" ? read.docs.length
          : read.data.length;
        if (count === 0) continue;
        results[name] = await run().catch((err) => ({
          ok: false,
          reason: String(err?.message ?? err),
        }));
      }

      /*
       * THE CONVERSATIONS, WHEN THE ARCHIVE HAS THEM, through the path that
       * already exists: relationships onto the graph, documents into pages.
       * It is the one part that can legitimately find nothing -- an export
       * from somebody with no calendar connected has no graph to attach to
       * -- and that must not fail the rest.
       */
      let conversations = null;
      if (read.json) {
        const parsedConvos = parseExport(read.json);
        if (!parsedConvos.error && parsedConvos.conversations.length > 0) {
          const [rel, know] = await Promise.all([
            importExport({
              orgId, amberId,
              provider: parsedConvos.provider,
              conversations: parsedConvos.conversations,
              filename: file.filename ?? null,
              dryRun,
            }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) })),
            distillKnowledge({
              orgId, amberId,
              provider: parsedConvos.provider,
              conversations: parsedConvos.conversations,
              dryRun,
              reach,
            }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) })),
          ]);
          conversations = { relationships: rel, knowledge: know };
          if (know?.ok) results.conversation = know;
        }
      }

      const live = Object.entries(results).filter(([, r]) => r?.ok);
      if (live.length === 0 && !conversations) {
        return reply.code(400).send({ error: "nothing_importable" });
      }

      /*
       * ONE LIST, TAGGED. The screen shows a project next to a skill next
       * to an artifact in the order they are worth looking at, rather than
       * five separate sections somebody has to scroll between.
       */
      const preview = live.flatMap(([type, r]) =>
        (r.preview ?? []).map((item) => ({ ...item, type })),
      );

      return {
        ok: true,
        provider: "bundle",
        knowledge: {
          ok: true,
          dryRun,
          considered: read.files ?? 0,
          found: preview.length,
          wouldCreate: live.reduce((n, [, r]) => n + (r.wouldCreate ?? 0), 0),
          created: live.reduce((n, [, r]) => n + (r.created ?? 0), 0),
          alreadyHere: live.reduce((n, [, r]) => n + (r.alreadyHere ?? 0), 0),
          preview,
          byType: Object.fromEntries(
            live.map(([type, r]) => [type, r.wouldCreate ?? r.created ?? 0]),
          ),
          /* Images, binaries, fonts. Counted, so nobody has to wonder. */
          skipped: read.skipped ?? 0,
        },
        relationships: conversations?.relationships ?? null,
        unusable: 0,
      };
    }

    const parsed = parseExport(read.json);
    if (parsed.error) return reply.code(400).send({ error: parsed.error });
    if (parsed.conversations.length === 0) {
      return reply.code(400).send({ error: "no_conversations" });
    }

    /*
     * TWO THINGS COME OUT OF ONE EXPORT, and they are independent.
     *
     * RELATIONSHIPS: a conversation that mentions somebody becomes an entry
     * on that person's timeline. This needs a graph to attach to, so it is
     * the half that cannot run before a calendar is connected.
     *
     * KNOWLEDGE: a conversation that produced a document -- a spec, a plan,
     * a teardown -- becomes a page. This needs NOTHING but the file.
     *
     * THEY USED TO SHARE ONE FAILURE. An export from somebody who had not
     * connected a calendar was refused outright with empty_graph, which threw
     * away the entire second half: a year of written work, discarded because
     * we could not file the chat about it. The first thing a new customer
     * has is their own history, and the first thing we did was refuse it.
     */
    const [result, knowledge] = await Promise.all([
      importExport({
        orgId: org(request),
        amberId: who(request),
        provider: parsed.provider,
        conversations: parsed.conversations,
        filename: file.filename ?? null,
        dryRun,
      }),
      distillKnowledge({
        orgId: org(request),
        amberId: who(request),
        provider: parsed.provider,
        conversations: parsed.conversations,
        dryRun,
        /*
         * The per-document choices, keyed by conversation id. A multipart
         * field rather than a body, because the file is the body -- and
         * parsed defensively, since a malformed one must land everything
         * private rather than fail the whole upload.
         */
        reach: readReach(file),
      }).catch((err) => ({ ok: false, reason: String(err?.message ?? err) })),
    ]);

    /*
     * ONLY A TOTAL FAILURE IS A FAILURE. If the graph was empty but eleven
     * documents came out, that is a successful import with half its work
     * done, and it is reported as what it is.
     */
    if (!result.ok && !(knowledge?.ok && (knowledge.wouldCreate || knowledge.created))) {
      return reply.code(result.reason === "empty_graph" ? 409 : 400).send({
        error: result.reason,
        hint:
          result.reason === "empty_graph"
            ? "Connect a calendar first, or upload an export with written work in it — " +
              "documents become pages without needing a graph."
            : undefined,
      });
    }

    return {
      ...(result.ok ? result : { ok: true, matched: 0, people: 0, written: 0, sample: [] }),
      relationships: result.ok ? undefined : { skipped: result.reason },
      knowledge: knowledge?.ok ? knowledge : null,
      unusable: parsed.skipped,
    };
  });

  app.get("/v1/org/memory/imports", asMember, async (request) => {
    return { imports: await listImports({ orgId: org(request), amberId: who(request) }) };
  });

  app.delete("/v1/org/memory/imports/:importId", asMember, async (request, reply) => {
    const result = await undoImport({
      orgId: org(request),
      amberId: who(request),
      importId: request.params.importId,
    });
    if (!result.ok) {
      return reply.code(result.reason === "not_found" ? 404 : 400).send({ error: result.reason });
    }
    return result;
  });

  /* -------------------------------------------------------------- sharing */

  /**
   * Publish one of your own rows to the team.
   *
   * A SHARE IS A ROW OF ITS OWN, not a column on the interaction, and that is
   * what keeps the ledger append-only. Publishing is a decision made after
   * the fact and reversible by the person who made it: a different fact with
   * a different lifetime from the thing that happened.
   *
   * Only the member the interaction belongs to may share it. There is no
   * admin path and no column for one to set, so nobody can publish somebody
   * else's AI work or be pressured into having it published for them.
   */
  app.post("/v1/org/memory/interactions/:interactionId/share", asMember, async (request, reply) => {
    const orgId = org(request);
    const viewerId = who(request);
    const { interactionId } = request.params;
    const note = request.body?.note ?? null;

    const { rows } = await query(
      `INSERT INTO org_interaction_shares (org_id, interaction_id, shared_by, note)
       SELECT $1::uuid, i.id, $3::uuid, $4
         FROM org_interactions i
        WHERE i.org_id = $1::uuid AND i.id = $2::uuid AND i.member_id = $3::uuid
       ON CONFLICT (org_id, interaction_id) DO UPDATE SET note = EXCLUDED.note
       RETURNING interaction_id`,
      [orgId, interactionId, viewerId, note],
    );

    // No row means the interaction does not exist, or is not this member's.
    // Deliberately the same answer: telling somebody a row is real but not
    // theirs is a directory of what their colleagues have been doing.
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return { ok: true, shared: true };
  });

  app.delete("/v1/org/memory/interactions/:interactionId/share", asMember, async (request, reply) => {
    const { rowCount } = await query(
      `DELETE FROM org_interaction_shares
        WHERE org_id = $1::uuid AND interaction_id = $2::uuid AND shared_by = $3::uuid`,
      [org(request), request.params.interactionId, who(request)],
    );
    if (rowCount === 0) return reply.code(404).send({ error: "not_found" });
    return { ok: true, shared: false };
  });

  /* --------------------------------------------------------------- policy */

  /**
   * The ceiling, readable by anyone in the company.
   *
   * Not admin-gated on read, deliberately. A rep deciding whether to connect
   * their calendar is entitled to see the rules that will govern it, and a
   * privacy promise nobody can read is a privacy promise nobody believes.
   */
  app.get("/v1/org/memory/policy", asMember, async (request) => {
    return {
      policy: await getPolicy({ orgId: org(request) }),
      allSources: ALL_SOURCES,
      isAdmin: request.actor.orgRole === "admin",
    };
  });

  /**
   * Change it. Admin only, and every lever restricts.
   *
   * There is no field here that exposes one person's history to another, and
   * that is not an omission to be filled in later: the schema has no column
   * for it either, so a future handler cannot grow one by accident.
   */
  app.patch("/v1/org/memory/policy", asAdmin, async (request, reply) => {
    const body = request.body ?? {};
    const result = await setPolicy({
      orgId: org(request),
      byAmberId: who(request),
      patch: {
        sources: body.sources,
        allowExternal: body.allowExternal,
        requireGate: body.requireGate,
        ...(Object.prototype.hasOwnProperty.call(body, "retentionMonths")
          ? { retentionMonths: body.retentionMonths }
          : {}),
      },
    });
    if (!result.ok) {
      return reply.code(400).send({
        error: result.reason,
        hint:
          result.reason === "no_sources"
            ? "An empty source list would stop every sync in the company. Turn sources off individually."
            : undefined,
      });
    }
    return result;
  });

  /**
   * What the gate actually stopped.
   *
   * "We enforce at runtime" is a claim. A list of the writes that were
   * refused, with the rule and the version that refused them, is the proof,
   * and it is the artifact somebody asks for in a review rather than the
   * sentence.
   */
  app.get("/v1/org/memory/refusals", asMember, async (request) => {
    return { refusals: await listRefusals({ orgId: org(request), limit: 100 }) };
  });

  /**
   * Run the retention rule now.
   *
   * Deletes rather than hides. A retention promise that leaves the rows and
   * filters them out of reads is a report, and the first subpoena
   * establishes the difference.
   */
  app.post("/v1/org/memory/retention/apply", asAdmin, async (request) => {
    return applyRetention({ orgId: org(request) });
  });

  /* -------------------------------------------------------------- consent */

  app.get("/v1/org/memory/sources", asMember, async (request) => {
    return { sources: await listSources({ orgId: org(request), amberId: who(request) }) };
  });

  app.post("/v1/org/memory/sources", asMember, async (request, reply) => {
    const { source, scopeRef = null } = request.body ?? {};
    if (!GRANTABLE.has(String(source))) {
      return reply.code(400).send({ error: "unknown_source", allowed: [...GRANTABLE] });
    }
    const result = await grantSource({
      orgId: org(request),
      amberId: who(request),
      source,
      scopeRef,
    });
    if (!result.ok) return reply.code(400).send({ error: result.reason });
    return result;
  });

  app.delete("/v1/org/memory/sources/:sourceId", asMember, async (request, reply) => {
    /*
     * amberId comes from the session, and revokeSource checks that the grant
     * belongs to it before deleting anything. An admin hitting this route with
     * somebody else's grant id gets a 404, not a revocation -- the same answer
     * as a grant that does not exist, because telling an admin "that grant is
     * real, just not yours" is a directory of who has connected what.
     */
    const result = await revokeSource({
      orgId: org(request),
      amberId: who(request),
      sourceId: request.params.sourceId,
    });
    if (!result.ok) {
      return reply.code(result.reason === "not_found" ? 404 : 400).send({ error: result.reason });
    }
    return result;
  });
}
