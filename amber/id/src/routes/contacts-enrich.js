/**
 * Enrichment HTTP surface — thin wrappers over the F1 lifecycle helpers and the
 * F2 orchestrator (resolveContactsBatch). No enrichment logic lives here.
 *
 *   GET  /v1/me/contacts/summary                    overview counts
 *   POST /v1/me/contacts/enrich                      batch resolve { contactIds }
 *   POST /v1/me/contacts/:id/enrichment/resolve      swipe-confirm commit
 *   GET  /v1/me/people/:id/enrich                    ONE contact's live brief
 *   POST /v1/me/people/:id/enrich                    the same, cache bypassed
 *
 * All require auth; owner = privyUser.phone → resolveAmberIdByPhone.
 *
 * WHY THE LAST TWO ARE UNDER /people AND NOT /contacts. Because that is what
 * the app asks for. It has been calling GET /v1/me/people/:id/enrich since the
 * person screen was written, the route did not exist, and every open of a
 * person's card logged
 *
 *   Route GET:/v1/me/people/<uuid>/enrich not found
 *
 * The client reads a 404 there as "not in your book yet" and shows an empty
 * card, so the whole What's New panel has quietly never worked -- against an
 * enrichment engine that is fully built and tested (src/enrichment/enrich-person.js,
 * whose only callers were its own tests). Matching the path the shipped app uses
 * costs nothing; renaming it would need an app release to fix a server-side gap.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  resolveAmberIdByPhone,
  getContactById,
  getContactEnrichmentSummary,
  resolveContactEnrichment,
  tagContactFromEnrichment,
  clearContactEnrichmentCandidates,
  getContactsForResolution,
} from "../db/store.js";
import {
  resolveContactsBatch,
  mapChosenToColumns,
  tagFieldsFromChosen,
} from "../enrichment/resolve-contact.js";
import { enrichPerson } from "../enrichment/enrich-person.js";
import { phoneticPool } from "../lib/fact-capture.js";
import { judgeNameMatches } from "../lib/name-judge.js";

// A contact id is a uuid. Declared here rather than inlined so the checks in
// this file cannot drift apart.
const _CONTACT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;




const MAX_BATCH = 200;

async function resolveOwner(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone
    ? await resolveAmberIdByPhone(phone).catch(() => null)
    : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

export function registerContactEnrichmentRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── GET|POST /v1/me/people/:id/enrich ───────────────────────────────────────
  //
  // What is new about ONE person, from the open web: a short brief, the pages it
  // came from, their social links, and a couple of signals (how recent, how much
  // momentum). enrichPerson owns all of it -- caching, the TTL, the flag and
  // key checks, and the never-throws contract -- so this really is a wrapper.
  //
  // GET honors the cache; POST forces a re-pull, which is the refresh button on
  // the card. Both return the SAME fully-shaped object, including when the
  // feature is off ({status:"disabled"}) or unkeyed ({status:"no_key"}), because
  // the client renders that shape and a bare error would blank the panel.
  //
  // NO EMBEDDING FROM HERE. enrichPerson can also write the brief into the
  // contact's vector, but embedding on a screen open would put a billed call on
  // a read path; the write paths already re-embed (reembedContactSoon), so this
  // deliberately passes neither embed nor upsert and reports embed_status "off".
  // Injected for tests, defaulting to the real thing. The three seams are the
  // three things this handler does that need a database or the network: who the
  // caller is, whether the contact is theirs, and the enrichment itself.
  const resolveOwnerByPhone = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const loadContact = deps.getContactById || getContactById;
  const enrich = deps.enrichPerson || enrichPerson;
  const ownerFor = async (request, reply) => {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return null;
    }
    const phone = request.privyUser?.phone;
    const ownerId = phone ? await resolveOwnerByPhone(phone).catch(() => null) : null;
    if (!ownerId) {
      reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
      return null;
    }
    return ownerId;
  };

  const enrichOne = async (request, reply, { force }) => {
    const ownerId = await ownerFor(request, reply);
    if (!ownerId) return;
    const id = String(request.params?.id || "").trim();
    if (!_CONTACT_ID_RE.test(id)) {
      return reply
        .code(400)
        .send({ error: "invalid_contact", message: "Malformed contact id." });
    }
    const contact = await loadContact(ownerId, id).catch(() => null);
    if (!contact) {
      // 404 is what the client already treats as "not in your book yet".
      return reply
        .code(404)
        .send({ error: "contact_not_found", message: "No such contact." });
    }
    // THE OWNER ID IS THE CACHE KEY *AND* THE VECTOR OWNER inside enrichPerson,
    // so it must be the durable account id rather than the privy did -- contact
    // ids are owner-scoped, and a did can change when an auth provider does.
    const result = await enrich(
      ownerId,
      { id: contact.id, name: contact.name, company: contact.company, title: contact.title },
      { force, log: request.log },
    );
    request.log?.info?.(
      {
        contactId: id,
        status: result?.status,
        cached: result?.from_cache === true,
        sources: result?.sources?.length ?? 0,
        force,
      },
      "[enrich] one person",
    );
    return result;
  };

  app.get(
    "/v1/me/people/:id/enrich",
    {
      preHandler: [requireAuth],
      // Opening a person's card is common; the cache absorbs most of these.
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => enrichOne(request, reply, { force: false }),
  );

  app.post(
    "/v1/me/people/:id/enrich",
    {
      preHandler: [requireAuth],
      // A forced refresh is a web search and a model call every time, so it is
      // held to a much lower ceiling than the cached read.
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (request, reply) => enrichOne(request, reply, { force: true }),
  );

  // ── GET /v1/me/contacts/summary ─────────────────────────────────────────────
  app.get(
    "/v1/me/contacts/summary",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      return await getContactEnrichmentSummary(ownerId);
    },
  );

  // ── POST /v1/me/contacts/enrich ─────────────────────────────────────────────
  // Runs the F2 batch orchestrator over the given contact ids.
  app.post(
    "/v1/me/contacts/enrich",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["contactIds"],
          properties: {
            contactIds: {
              type: "array",
              items: { type: ["string", "integer"] },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;

      const raw = Array.isArray(request.body?.contactIds) ? request.body.contactIds : [];
      // The filter used to be /^\d+$/, which discarded every uuid -- so the batch
      // was always empty and the endpoint enriched nothing while reporting success.
      const ids = raw.map((x) => String(x).trim()).filter((x) => _CONTACT_ID_RE.test(x));
      if (ids.length > MAX_BATCH) {
        return reply.code(400).send({
          error: "batch_too_large",
          message: `At most ${MAX_BATCH} contactIds per request`,
        });
      }

      const { auto, ambiguous, none, results } = await resolveContactsBatch(ownerId, ids);
      return { results, tally: { auto, ambiguous, none } };
    },
  );

  // ── POST /v1/me/contacts/resolve-names ──────────────────────────────────────
  // Turn a spoken/typed list of names into contacts, so a user can just SAY who
  // they want to enrich ("enrich Kshitij, Maya, and Drew Dunson"). Reuses the
  // same phonetic pool + Claude judge as reconciliation, so cross-accent and
  // hard-to-spell names resolve. Returns three buckets the app renders:
  //   resolved[]  — one confident contact (auto-select for enrichment)
  //   ambiguous[] — several candidates (show a quick pick)
  //   unknown[]   — no match (offer search / add)
  // Body: { names: string[] } OR { text: "kshitij, maya and drew" }.
  app.post(
    "/v1/me/contacts/resolve-names",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;

      const body = request.body || {};
      let names = Array.isArray(body.names) ? body.names : [];
      if (names.length === 0 && typeof body.text === "string") {
        names = body.text.split(/,|\band\b|;|\n/gi);
      }
      names = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))].slice(0, 30);
      if (names.length === 0) return { resolved: [], ambiguous: [], unknown: [] };

      const contacts = await getContactsForResolution(ownerId).catch(() => []);
      const resolved = [];
      const ambiguous = [];
      const unknown = [];

      await Promise.all(
        names.map(async (name) => {
          const pool = phoneticPool(name, contacts, 25);
          if (pool.length === 0) {
            unknown.push(name);
            return;
          }
          const ids = await judgeNameMatches({ spoken: name, candidates: pool });
          const byId = new Map(pool.map((p) => [p.id, p]));
          const picks = ids.map((id) => byId.get(id)).filter(Boolean);
          if (picks.length === 1) {
            resolved.push({ name, contactId: picks[0].id, contactName: picks[0].name });
          } else if (picks.length > 1) {
            ambiguous.push({ name, candidates: picks.slice(0, 8) });
          } else {
            // Judge pruned everything — offer the closest pool matches to pick from.
            ambiguous.push({ name, candidates: pool.slice(0, 6) });
          }
        }),
      );

      return { resolved, ambiguous, unknown };
    },
  );

  // ── POST /v1/me/contacts/:id/enrichment/resolve ─────────────────────────────
  // Swipe-confirm commit. Body: { candidateIndex } | { candidateLinkedinUrl } |
  // { none:true }. Resolves ONLY to a candidate that was actually offered.
  app.post(
    "/v1/me/contacts/:id/enrichment/resolve",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;

      const id = String(request.params.id || "");
      // uuid, not digits: this 400d on every real id.
      if (!_CONTACT_ID_RE.test(id)) {
        return reply.code(400).send({ error: "invalid_contact_id", message: "id must be a uuid" });
      }

      const contact = await getContactById(ownerId, id);
      if (!contact) return reply.code(404).send({ error: "contact_not_found" });

      const candidates = Array.isArray(contact.enrichmentCandidates)
        ? contact.enrichmentCandidates
        : null;
      if (!candidates || candidates.length === 0) {
        return reply.code(409).send({ error: "no_candidates", message: "No stored candidates to resolve" });
      }

      const body = request.body || {};

      // ── No-match dismissal ──
      if (body.none === true) {
        await clearContactEnrichmentCandidates(ownerId, id);
        return { contact: await getContactById(ownerId, id) };
      }

      // ── Pick a candidate — ONLY one that was actually offered ──
      // Stored candidates are the ranked array [{ candidate, score, signals }];
      // tolerate a flattened array too.
      const candOf = (el) => (el && typeof el === "object" && el.candidate ? el.candidate : el);

      let el = null;
      if (body.candidateIndex !== undefined) {
        const idx = Number(body.candidateIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) {
          return reply.code(400).send({ error: "candidate_not_found", message: "candidateIndex out of range" });
        }
        el = candidates[idx];
      } else if (typeof body.candidateLinkedinUrl === "string" && body.candidateLinkedinUrl.trim()) {
        const url = body.candidateLinkedinUrl.trim();
        el = candidates.find((e) => (candOf(e)?.linkedinUrl || null) === url) || null;
        if (!el) {
          return reply.code(400).send({ error: "candidate_not_found", message: "candidateLinkedinUrl not among offered candidates" });
        }
      } else {
        return reply.code(400).send({
          error: "invalid_choice",
          message: "Provide candidateIndex, candidateLinkedinUrl, or none:true",
        });
      }

      const chosen = candOf(el);
      if (!chosen) {
        return reply.code(400).send({ error: "candidate_not_found", message: "Chosen candidate is empty" });
      }

      // Commit via the SAME store paths the auto/resolved path uses: verified
      // columns + enrichment jsonb, then synthesize verified tags/facts.
      const now = new Date().toISOString();
      const enrichment = {
        provider: "manual_confirm",
        confidence: "confirmed",
        signals: (el && el.signals) || [],
        candidate: chosen,
        fetched_at: now,
        confirmed_at: now,
      };
      await resolveContactEnrichment(ownerId, id, {
        fields: mapChosenToColumns(chosen),
        enrichment,
      });
      await tagContactFromEnrichment(ownerId, id, tagFieldsFromChosen(chosen));

      return { contact: await getContactById(ownerId, id) };
    },
  );
}
