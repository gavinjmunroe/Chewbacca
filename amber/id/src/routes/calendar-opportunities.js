/**
 * POST /v1/me/opportunities/upcoming
 *
 * Takes the user's upcoming calendar events (read client-side via EventKit)
 * and returns one tailored "what should I prep / say / do" prompt per event,
 * matched against the user's contact graph in Firestore.
 *
 * iOS sends:
 *   { events: [{ id, title, attendees: ["Sagar Tiwari", "sagar@..."], start }] }
 *
 * Server returns:
 *   { overlays: [{
 *       eventId, kind, prompt,
 *       person?: { id, name, email?, phone? }
 *     }, ...] }
 *
 * Design rules:
 *   - Free-tier, no entitlement gate (calendar overlays are core value)
 *   - One round-trip for the whole calendar (no N+1 LLM calls)
 *   - Pure heuristic match today; the prompt template is the "opportunity
 *     agent" surface. Future replacement: per-event LLM call against the
 *     person's Pinecone namespace, gated to paid tiers.
 */

import { requireAuth } from "../lib/auth-session.js";
import { listContacts } from "../db/user-store.js";
import { resolveAmberIdByPhone } from "../db/store.js";

function emailLower(s) {
  return typeof s === "string" ? s.trim().toLowerCase() : null;
}

function nameNormalized(s) {
  if (typeof s !== "string") return null;
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function buildIndex(contacts) {
  const byEmail = new Map();
  const byName = new Map();
  for (const c of contacts) {
    if (!c?.id || !c?.name) continue;
    const emails = Array.isArray(c.emails) ? c.emails : [];
    for (const e of emails) {
      const k = emailLower(e);
      if (k && !byEmail.has(k)) byEmail.set(k, c);
    }
    const n = nameNormalized(c.name);
    if (n && !byName.has(n)) byName.set(n, c);
  }
  return { byEmail, byName };
}

function matchAttendee(attendee, idx) {
  if (!attendee || typeof attendee !== "string") return null;
  const trimmed = attendee.trim();
  if (!trimmed) return null;

  // Email-shaped attendee → exact lower-case email match
  if (trimmed.includes("@")) {
    return idx.byEmail.get(emailLower(trimmed)) || null;
  }
  // Name-shaped → match against normalized contact names
  const n = nameNormalized(trimmed);
  if (!n) return null;
  // Exact normalized match first
  if (idx.byName.has(n)) return idx.byName.get(n);
  // First-name partial: try matching against any contact whose normalized
  // first token equals the attendee's normalized first token
  const firstToken = nameNormalized(trimmed.split(/\s+/)[0]);
  if (!firstToken) return null;
  for (const [k, c] of idx.byName) {
    const contactFirst = nameNormalized(c.name.split(/\s+/)[0]);
    if (contactFirst === firstToken) return c;
    if (k.startsWith(firstToken) && firstToken.length >= 3) return c;
  }
  return null;
}

function shapePerson(c) {
  return {
    id: c.id,
    name: c.name,
    email: Array.isArray(c.emails) && c.emails[0] ? c.emails[0] : null,
    phone:
      Array.isArray(c.phoneNumbers) && c.phoneNumbers[0]
        ? c.phoneNumbers[0]
        : null,
  };
}

function isMealOrCoffee(title) {
  const t = (title || "").toLowerCase();
  return /\b(coffee|lunch|dinner|breakfast|drinks|brunch|tea)\b/.test(t);
}

function isInterview(title) {
  const t = (title || "").toLowerCase();
  return /\b(interview|recruiter|screen|phone screen|chat with)\b/.test(t);
}

function isOneOnOne(title, attendeeCount) {
  const t = (title || "").toLowerCase();
  return (
    /\b1:?1|one[- ]on[- ]one|sync|catch[- ]?up|check[- ]?in\b/.test(t) ||
    attendeeCount === 1
  );
}

function generateOverlay(event, idx) {
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  let matchedPerson = null;
  for (const a of attendees) {
    const m = matchAttendee(a, idx);
    if (m) {
      matchedPerson = m;
      break;
    }
  }

  const title = (event.title || "").trim();

  // Person-matched: high-signal, mention by name + their context
  if (matchedPerson) {
    if (isMealOrCoffee(title)) {
      return {
        eventId: event.id,
        kind: "meal_with_person",
        prompt: `What should I bring up over ${title.toLowerCase()} with ${matchedPerson.name}?`,
        person: shapePerson(matchedPerson),
      };
    }
    if (isInterview(title)) {
      return {
        eventId: event.id,
        kind: "interview_prep",
        prompt: `Prep me for the interview with ${matchedPerson.name} — what do I know about them?`,
        person: shapePerson(matchedPerson),
      };
    }
    if (isOneOnOne(title, attendees.length)) {
      return {
        eventId: event.id,
        kind: "one_on_one_prep",
        prompt: `Draft an agenda for my 1:1 with ${matchedPerson.name}. What's open between us?`,
        person: shapePerson(matchedPerson),
      };
    }
    return {
      eventId: event.id,
      kind: "person_prep",
      prompt: `What should I prep for "${title || "this meeting"}" with ${matchedPerson.name}?`,
      person: shapePerson(matchedPerson),
    };
  }

  // Title-matched, no person: still useful generic prep
  if (isInterview(title)) {
    return {
      eventId: event.id,
      kind: "interview_prep_generic",
      prompt: `Help me prep for "${title}". What questions should I expect?`,
    };
  }
  if (isMealOrCoffee(title) && attendees.length > 0) {
    return {
      eventId: event.id,
      kind: "meal_generic",
      prompt: `Suggest 3 conversation topics for ${title.toLowerCase()} today.`,
    };
  }
  if (title) {
    return {
      eventId: event.id,
      kind: "event_prep",
      prompt: `What's the best use of my time during "${title}"?`,
    };
  }
  return null;
}

export function registerCalendarOpportunitiesRoutes(app) {
  app.post(
    "/v1/me/opportunities/upcoming",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["events"],
          properties: {
            events: {
              type: "array",
              maxItems: 200,
              items: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  attendees: {
                    type: "array",
                    items: { type: "string" },
                  },
                  start: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.privyUser?.userId)
        return reply.code(401).send({ error: "no_user" });

      const phone = request.privyUser?.phone;
      const ownerId = phone
        ? await resolveAmberIdByPhone(phone).catch(() => null)
        : null;

      let contacts = [];
      try {
        if (ownerId) contacts = await listContacts(ownerId);
      } catch (err) {
        request.log.warn(err, "[opportunities] listContacts failed");
      }

      const idx = buildIndex(contacts);
      const events = request.body?.events || [];
      const overlays = [];
      for (const ev of events) {
        const overlay = generateOverlay(ev, idx);
        if (overlay) overlays.push(overlay);
      }

      return {
        overlays,
        count: overlays.length,
        contactsConsidered: contacts.length,
      };
    },
  );
}
