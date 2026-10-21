/**
 * Network intelligence routes — power the iOS visual experiences:
 *
 *   GET /v1/me/contacts/:contactId/profile
 *     One contact's intelligence card: dimension scores, recent timeline,
 *     relationship summary. iOS renders this verbatim.
 *
 *   GET /v1/me/inbox
 *     The proactive feed. Server-computed cards (birthdays, neglect signals,
 *     opportunity prompts). iOS shows them as a swipeable list.
 *
 *   GET /v1/me/network/edges
 *     Inferred relationships between the user's own contacts. Powers the
 *     force-directed graph visualization on iOS Home.
 *
 * Data lives in Firestore under users/{did}/contacts/{contactId}, accessed
 * through the existing user-store helpers. Hard rule: iOS never reproduces
 * this logic. Every "what should I see" decision lives here so a future ML
 * model can replace the heuristics without an app update.
 */

import { requireAuth } from "../lib/auth-session.js";
import { DIMENSIONS } from "../lib/dimensions.js";
import { DIMENSION_CODE } from "../lib/observation-dimensions.js";
import { listContacts, getContactById } from "../db/user-store.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { buildNetworkGraph } from "../lib/network-graph.js";
import { query } from "../db/sql.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function emailDomain(email) {
  if (!email || typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email
    .slice(at + 1)
    .toLowerCase()
    .trim();
  // Skip personal-email domains so we don't draw a hairball through everyone
  // who has a Gmail address.
  const PERSONAL = new Set([
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "me.com",
    "live.com",
    "aol.com",
    "proton.me",
    "protonmail.com",
  ]);
  if (PERSONAL.has(d)) return null;
  return d;
}

function organization(c) {
  const meta = c.metadata || {};
  return meta.company || meta.organization || null;
}

function asDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // Firestore Timestamp objects expose toDate()
  if (typeof v.toDate === "function") return v.toDate();
  return null;
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function nextBirthdayInDays(birthday) {
  const bd = asDate(birthday);
  if (!bd) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(bd);
  next.setFullYear(today.getFullYear());
  next.setHours(0, 0, 0, 0);
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return daysBetween(next, today);
}

function defaultDimensionScores() {
  const out = {};
  for (const d of DIMENSIONS) out[d] = 0;
  return out;
}

function dimensionScoresFor(contact) {
  const fromMeta = contact.metadata?.dimensionScores;
  if (fromMeta && typeof fromMeta === "object") {
    const out = defaultDimensionScores();
    for (const d of DIMENSIONS) {
      const v = fromMeta[d];
      out[d] = typeof v === "number" ? Math.max(0, Math.min(10, v)) : 0;
    }
    return out;
  }
  return defaultDimensionScores();
}

/**
 * THE SCORES THE ROLLUP ACTUALLY COMPUTED.
 *
 * `dimensionScoresFor` above reads contact.metadata.dimensionScores, which is
 * a field almost nothing writes -- so every card came back with six zeros and
 * the six dimensions rendered as an empty shape. The real numbers have been in
 * contact_dimension_state the whole time, keyed by the smallint ids in
 * src/lib/observation-dimensions.js.
 *
 * Stored 0-1 and served 0-10, which is the range the iOS card already draws.
 * The metadata path is kept as the fallback rather than deleted: a contact
 * carrying hand-set scores should keep showing them.
 */
async function dimensionScoresFromState(ownerId, contactId, fallback) {
  try {
    const { rows } = await query(
      `SELECT dimension_id, score, observation_count
         FROM contact_dimension_state
        WHERE owner_id = $1 AND contact_id = $2`,
      [ownerId, contactId],
    );
    if (rows.length === 0) return { scores: fallback, observed: 0, computed: false };
    const out = defaultDimensionScores();
    let observed = 0;
    for (const r of rows) {
      const name = DIMENSION_CODE[Number(r.dimension_id)];
      if (!name || !(name in out)) continue;
      out[name] = Math.max(0, Math.min(10, Number(r.score ?? 0) * 10));
      observed += Number(r.observation_count ?? 0);
    }
    return { scores: out, observed, computed: true };
  } catch {
    // A card that renders without its shape beats a card that 503s.
    return { scores: fallback, observed: 0, computed: false };
  }
}

function dominantDimension(scores) {
  let best = null;
  let bestVal = -1;
  for (const d of DIMENSIONS) {
    if (scores[d] > bestVal) {
      bestVal = scores[d];
      best = d;
    }
  }
  return bestVal > 0 ? best : null;
}

async function resolveOwner(request, reply) {
  if (!request.privyUser?.userId) {
    reply.code(401).send({ error: "no_user" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const ownerId = phone
    ? await resolveAmberIdByPhone(phone).catch(() => null)
    : null;
  if (!ownerId) {
    reply.code(404).send({ error: "user_not_found" });
    return null;
  }
  return ownerId;
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerNetworkIntelligenceRoutes(app) {
  /**
   * GET /v1/me/contacts/:contactId/profile
   */
  app.get(
    "/v1/me/contacts/:contactId/profile",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = await resolveOwner(request, reply);
      if (!did) return;

      const contactId = String(request.params.contactId || "");
      if (!contactId) {
        return reply.code(400).send({ error: "bad_contact_id" });
      }

      let c;
      try {
        c = await getContactById(did, contactId);
      } catch (err) {
        request.log.error(err, "[ni] getContactById failed");
        return reply.code(503).send({ error: "store_unavailable" });
      }
      if (!c) {
        return reply.code(404).send({ error: "contact_not_found" });
      }

      const { scores, observed, computed } = await dimensionScoresFromState(
        did,
        contactId,
        dimensionScoresFor(c),
      );
      const dom = dominantDimension(scores);

      // THE PEOPLERANK SCORE, the same number the graph lays people out by, so
      // a card and a position can never tell two different stories about how
      // close somebody is.
      let rank = null;
      try {
        const { rows: sc } = await query(
          `SELECT base_score, warmth, completeness, observation_count
             FROM contact_scores WHERE owner_id = $1 AND contact_id = $2`,
          [did, contactId],
        );
        if (sc[0]) {
          rank = {
            score: Number(sc[0].base_score ?? 0),
            warmth: Number(sc[0].warmth ?? 0),
            completeness: Number(sc[0].completeness ?? 0),
            observationCount: Number(sc[0].observation_count ?? 0),
          };
        }
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] contact score unavailable");
      }
      const days = nextBirthdayInDays(c.birthday);

      const timeline = [];
      const createdAt = asDate(c.createdAt);
      if (createdAt) {
        timeline.push({
          kind: "added_to_network",
          at: createdAt.toISOString(),
          title: "Added to your network",
          body: "Imported from Apple Contacts.",
        });
      }
      const lastContacted = asDate(c.lastContactedAt);
      if (lastContacted) {
        timeline.push({
          kind: "last_contacted",
          at: lastContacted.toISOString(),
          title: "Last interaction",
          body: "Latest signal Amber tracked from your messages.",
        });
      }
      if (days !== null && days <= 30 && days >= 0) {
        const bd = asDate(c.birthday);
        timeline.push({
          kind: "upcoming_birthday",
          at: new Date().toISOString(),
          title: days === 0 ? "Birthday is today" : `Birthday in ${days} days`,
          body: bd ? bd.toISOString().slice(0, 10) : "",
        });
      }
      timeline.sort(
        (a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime(),
      );

      const summary = (() => {
        const bits = [];
        const phones = Array.isArray(c.phoneNumbers) ? c.phoneNumbers : [];
        const emails = Array.isArray(c.emails) ? c.emails : [];
        if (phones.length > 0) bits.push(`${phones.length} phone`);
        if (emails.length > 0) bits.push(`${emails.length} email`);
        if (organization(c)) bits.push(organization(c));
        return bits.length > 0 ? bits.join(" · ") : null;
      })();

      const bd = asDate(c.birthday);

      return {
        contact: {
          id: c.id,
          name: c.name,
          phoneNumbers: c.phoneNumbers || [],
          emails: c.emails || [],
          birthday: bd ? bd.toISOString() : null,
          organization: organization(c),
          messageFrequency: c.messageFrequency || 0,
          relationshipScore: c.relationshipScore || 0,
          lastContactedAt: lastContacted ? lastContacted.toISOString() : null,
          createdAt: createdAt ? createdAt.toISOString() : null,
        },
        dimensions: { scores, dominant: dom, observationCount: observed, computed },
        rank,
        timeline,
        summary,
        upcomingBirthdayInDays: days,
      };
    },
  );

  /**
   * GET /v1/me/inbox?limit=20
   */
  app.get(
    "/v1/me/inbox",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = await resolveOwner(request, reply);
      if (!did) return;

      const limit = Math.min(
        50,
        Math.max(1, Number(request.query?.limit) || 20),
      );

      let rows;
      try {
        rows = await listContacts(did);
      } catch (err) {
        request.log.error(err, "[ni] listContacts failed");
        return reply.code(503).send({ error: "store_unavailable" });
      }

      const cards = [];
      const now = new Date();

      for (const c of rows) {
        const days = nextBirthdayInDays(c.birthday);
        if (days !== null && days <= 14) {
          cards.push({
            id: `birthday:${c.id}:${days}`,
            kind: "birthday",
            urgency: Math.max(40, 100 - days * 5),
            createdAt: now.toISOString(),
            headline:
              days === 0
                ? `${c.name}'s birthday is today`
                : days === 1
                  ? `${c.name}'s birthday is tomorrow`
                  : `${c.name}'s birthday in ${days} days`,
            body:
              days <= 1
                ? "Wish them today. A short message lands further than you think."
                : "Plan something small. Amber can draft a thoughtful note.",
            personId: c.id,
            person: { id: c.id, name: c.name },
            suggestedPrompt:
              days <= 1
                ? `Draft a heartfelt birthday message for ${c.name}.`
                : `Help me plan something small for ${c.name}'s birthday in ${days} days.`,
          });
        }

        const lastContacted = asDate(c.lastContactedAt);
        if (lastContacted) {
          const ago = daysBetween(now, lastContacted);
          if (ago >= 30 && ago < 365) {
            cards.push({
              id: `neglect:${c.id}:${ago}`,
              kind: "neglect",
              urgency: Math.min(85, 30 + ago / 4),
              createdAt: now.toISOString(),
              headline: `It's been ${ago} days since ${c.name}`,
              body: "Quick check-in? Amber can write the first line.",
              personId: c.id,
              person: { id: c.id, name: c.name },
              suggestedPrompt: `Help me draft a thoughtful check-in to ${c.name}. We last talked ${ago} days ago.`,
            });
          }
        }
      }

      if (cards.length === 0 && rows.length > 0) {
        cards.push({
          id: `welcome:${did}`,
          kind: "welcome",
          urgency: 50,
          createdAt: now.toISOString(),
          headline: `${rows.length} people in your network`,
          body: "Amber will surface someone to invest in once she has more signal. Ask her anything in the meantime.",
          suggestedPrompt: "Who in my network should I prioritize this week?",
        });
      } else if (cards.length === 0) {
        cards.push({
          id: `empty:${did}`,
          kind: "empty",
          urgency: 100,
          createdAt: now.toISOString(),
          headline: "Bring your network in",
          body: "Import Apple Contacts to start receiving daily prompts.",
          suggestedPrompt: null,
        });
      }

      cards.sort((a, b) => b.urgency - a.urgency);
      return { cards: cards.slice(0, limit), count: cards.length };
    },
  );

  /**
   * GET /v1/me/network/edges
   *
   * THE OWNER IS IN THIS GRAPH. That is the whole of what changed, and it was
   * the whole of what was wrong: this used to return only contact-to-contact
   * edges derived from shared employers and shared mail domains, so on a real
   * address book most people had no edge at all and rendered as unconnected
   * dust -- while being, in fact, the owner's friends.
   *
   * Clusters are hubs now rather than cliques (see src/lib/network-graph.js),
   * and every edge carries a weight derived from contact_channel_stats, so the
   * people actually being spoken to are the ones that read as close.
   *
   * TWO CARDS FOR ONE PERSON COME BACK AS ONE NODE. Apple and Google each
   * describe the same job differently -- a company field on one, a mail domain
   * on the other -- so the same human arrives twice under two spellings of one
   * name. Those are folded on evidence (see foldDuplicates) and the surviving
   * node carries `aliases` and `mergedCount` so the merge is visible rather
   * than silent. `stats.cards` is how many rows went in, `stats.people` how
   * many humans came out.
   *
   * The response still carries `edges` and `count` exactly as before, so no
   * existing client breaks; `nodes`, `groups` and `stats` are additions.
   * `groups` is the one the web reads: a label, a count, and the member ids,
   * which the client colors instead of fencing.
   */
  app.get(
    "/v1/me/network/edges",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = await resolveOwner(request, reply);
      if (!did) return;

      let rows;
      try {
        rows = await listContacts(did);
      } catch (err) {
        request.log.error(err, "[ni] listContacts failed");
        return reply.code(503).send({ error: "store_unavailable" });
      }

      // Rolled-up interaction totals, one row per contact. Best effort: a
      // graph with no weights is still a usable graph, and an owner whose
      // rollup has never run must not get a 503 for it.
      const statsById = new Map();
      try {
        const { rows: stats } = await query(
          `SELECT contact_id, last_interaction_at AS last_at, count_90d
             FROM contact_interaction_stats WHERE owner_id = $1`,
          [did],
        );
        for (const r of stats) statsById.set(String(r.contact_id), r);
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] interaction stats unavailable");
      }

      // WHICH CHANNEL THE LAST CONTACT WAS ON, so a card can say "emailed
      // three weeks ago" instead of "spoke", which was a claim the data did
      // not support. contact_channel_stats carries the same windows and the
      // same reciprocity gate as the totals above, so the two cannot disagree
      // about whether a relationship exists.
      try {
        const { rows: channels } = await query(
          `SELECT DISTINCT ON (contact_id) contact_id, channel, last_at
             FROM contact_channel_stats
            WHERE owner_id = $1 AND last_at IS NOT NULL
            ORDER BY contact_id, last_at DESC`,
          [did],
        );
        for (const r of channels) {
          const existing = statsById.get(String(r.contact_id));
          if (existing) existing.channel = r.channel;
          else statsById.set(String(r.contact_id), { last_at: r.last_at, count_90d: 0, channel: r.channel });
        }
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] channel stats unavailable");
      }

      // WHO THE OWNER IS, so their own contact card is folded into the center
      // instead of being drawn as a second person standing next to themselves.
      //
      // EVERY IDENTITY THE ACCOUNT HAS, not just the connected calendars. The
      // first version asked calendar_accounts alone, and an owner who had never
      // connected a calendar got an empty list -- so the "me" card that Apple
      // gives everybody stayed drawn as a stranger with the owner's own name
      // on it. The sign-in identities are the addresses the person actually
      // proved they own, and users.phone is the number this session is for.
      const identity = { emails: [], phones: [], name: null };
      try {
        const { rows: u } = await query(
          `SELECT phone, imessage_linked_phone, full_name FROM users WHERE amber_id = $1`,
          [did],
        );
        if (u[0]) {
          identity.phones.push(u[0].phone, u[0].imessage_linked_phone);
          identity.name = u[0].full_name ?? null;
        }
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] owner row unavailable");
      }
      try {
        const { rows: ids } = await query(
          `SELECT email FROM user_identities
            WHERE amber_id = $1 AND email IS NOT NULL AND deleted_at IS NULL`,
          [did],
        );
        for (const r of ids) identity.emails.push(r.email);
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] owner identities unavailable");
      }
      try {
        const { rows: accounts } = await query(
          `SELECT account_email FROM calendar_accounts
            WHERE owner_id = $1 AND account_email IS NOT NULL`,
          [did],
        );
        for (const a of accounts) identity.emails.push(a.account_email);
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] owner accounts unavailable");
      }

      // HOW CLOSE EACH PERSON IS, from contact_scores rather than re-derived.
      // See strengthFor in src/lib/network-graph.js for why the graph is not
      // allowed its own opinion about this any more.
      const scoresById = new Map();
      try {
        const { rows: scores } = await query(
          `SELECT contact_id, base_score FROM contact_scores WHERE owner_id = $1`,
          [did],
        );
        for (const r of scores) scoresById.set(String(r.contact_id), Number(r.base_score));
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] contact scores unavailable");
      }

      // EVERY SOURCE THAT EVER CLAIMED EACH PERSON. contact_sources keeps one
      // row per (contact, source), so a card synced from the phone and later
      // seen in Gmail reports both -- which is what lets the outer field put
      // them on the seam between those two sectors rather than picking one.
      const sourcesById = new Map();
      try {
        const { rows: srcs } = await query(
          `SELECT contact_id, source FROM contact_sources
            WHERE owner_id = $1 AND deleted_at IS NULL AND source IS NOT NULL`,
          [did],
        );
        for (const r of srcs) {
          const key = String(r.contact_id);
          const list = sourcesById.get(key);
          if (list) list.push(r.source);
          else sourcesById.set(key, [r.source]);
        }
      } catch (err) {
        request.log.warn({ err: err?.message }, "[ni] contact sources unavailable");
      }

      const graph = buildNetworkGraph(rows, statsById, {
        scoresById,
        sourcesById,
        ownerName: request.privyUser?.name || identity.name || "You",
        ownerPhone: request.privyUser?.phone ?? null,
        ownerPhones: identity.phones.filter(Boolean),
        ownerEmails: identity.emails.filter(Boolean),
        ownerAmberId: did,
        ownerProfileName: identity.name,
      });

      return {
        nodes: graph.nodes,
        edges: graph.edges,
        groups: graph.groups,
        stats: graph.stats,
        count: graph.edges.length,
      };
    },
  );
}
