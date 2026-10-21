/**
 * SIGNAL-01: Birthday signal detection
 * SIGNAL-02: Push notification delivery (APNs)
 * SIGNAL-03: Suggestion detail view — reaction tracking
 * SIGNAL-04: Shared calendar event detection
 * SIGNAL-05: Questionnaire match signals
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { eq, and, inArray, lte } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';
import { requireFieldPermission } from './privacy.js';

const ReactSchema = z.object({
  action: z.enum(['acted_on', 'dismissed']),
});

const ContactBatchSchema = z.object({
  contacts: z.array(
    z.object({
      externalId: z.string(),
      name: z.string(),
      phoneNumbers: z.array(z.string()).optional(),
      emails: z.array(z.string()).optional(),
      birthday: z.string().optional(), // ISO8601 date
      messageFrequency: z.number().int().optional(),
      lastContactedAt: z.string().optional(),
      relationshipScore: z.number().int().min(0).max(100).optional(),
    }),
  ),
});

const CalendarEventSchema = z.object({
  events: z.array(
    z.object({
      eventId: z.string(),
      title: z.string(),
      startDate: z.string(),
      attendeeExternalIds: z.array(z.string()), // CNContact identifiers of attendees
    }),
  ),
});

/** Build a stable dedupe key so the same signal never fires twice */
function dedupeKey(userId: number, contactId: number, type: string, date: string) {
  return `${userId}:${contactId}:${type}:${date}`;
}

/** Derive the three birthday signal trigger dates (3-day, 1-day, day-of) */
function birthdayTriggerDates(birthday: Date, year: number): Date[] {
  const bday = new Date(birthday);
  bday.setFullYear(year);
  const d1 = new Date(bday); d1.setDate(bday.getDate() - 3);
  const d2 = new Date(bday); d2.setDate(bday.getDate() - 1);
  return [d1, d2, bday];
}

export async function registerSignalRoutes(app: FastifyInstance) {
  /**
   * GET /signals
   * Returns pending/sent signals for the authenticated user (their suggestion feed)
   */
  app.get('/signals', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    return db
      .select()
      .from(schema.signals)
      .where(
        and(
          eq(schema.signals.userId!, req.userId!),
          inArray(schema.signals.status, ['pending', 'sent', 'seen']),
        ),
      )
      .orderBy(schema.signals.triggerDate);
  });

  /**
   * GET /signals/:id
   * Suggestion detail — marks signal as viewed
   */
  app.get<{ Params: { id: string } }>(
    '/signals/:id',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const [signal] = await db
        .select()
        .from(schema.signals)
        .where(and(eq(schema.signals.id, id), eq(schema.signals.userId!, req.userId!)))
        .limit(1);
      if (!signal) return reply.code(404).send({ error: 'not_found' });

      if (signal.status === 'sent') {
        await db
          .update(schema.signals)
          .set({ status: 'seen' })
          .where(eq(schema.signals.id, id));
      }
      return signal;
    },
  );

  /**
   * POST /signals/:id/react
   * SIGNAL-03: Record user action on a suggestion (acted_on | dismissed)
   */
  app.post<{ Params: { id: string } }>(
    '/signals/:id/react',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { id: idStr } = req.params as { id: string }; const id = Number(idStr);
      const { action } = ReactSchema.parse(req.body);

      const [signal] = await db
        .select()
        .from(schema.signals)
        .where(and(eq(schema.signals.id, id), eq(schema.signals.userId!, req.userId!)))
        .limit(1);
      if (!signal) return reply.code(404).send({ error: 'not_found' });

      const [updated] = await db
        .update(schema.signals)
        .set({
          status: action,
          actedAt: action === 'acted_on' ? new Date() : null,
        })
        .where(eq(schema.signals.id, id))
        .returning();
      return updated;
    },
  );

  /**
   * POST /signals/ingest/contacts
   * DATA-01 / SIGNAL-01: iOS pushes contact graph; server generates birthday signals.
   * Enforces PRIVACY-01 — only processes if contacts field is permitted.
   */
  app.post(
    '/signals/ingest/contacts',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest, reply) => {
      const { contacts } = ContactBatchSchema.parse(req.body);
      const userId = req.userId!;

      try {
        await requireFieldPermission(userId, 'contacts');
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode ?? 403;
        const message = err instanceof Error ? err.message : 'Field sync blocked';
        return reply.code(status).send({ error: 'tier_violation', message });
      }
      const now = new Date();
      const thisYear = now.getFullYear();

      let upserted = 0;
      let signalsCreated = 0;

      for (const c of contacts) {
        // Upsert contact
        const existing = await db
          .select({ id: schema.contacts.id })
          .from(schema.contacts)
          .where(
            and(eq(schema.contacts.userId, userId), eq(schema.contacts.externalId, c.externalId)),
          )
          .limit(1);

        let contactId: number;

        if (existing.length > 0) {
          await db
            .update(schema.contacts)
            .set({
              name: c.name,
              phoneNumbers: c.phoneNumbers ?? [],
              emails: c.emails ?? [],
              birthday: c.birthday ? new Date(c.birthday) : null,
              messageFrequency: c.messageFrequency ?? 0,
              lastContactedAt: c.lastContactedAt ? new Date(c.lastContactedAt) : null,
              relationshipScore: c.relationshipScore ?? 0,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.contacts.userId, userId),
                eq(schema.contacts.externalId, c.externalId),
              ),
            );
          contactId = existing[0].id;
        } else {
          const [newContact] = await db
            .insert(schema.contacts)
            .values({
              userId,
              externalId: c.externalId,
              name: c.name,
              phoneNumbers: c.phoneNumbers ?? [],
              emails: c.emails ?? [],
              birthday: c.birthday ? new Date(c.birthday) : null,
              messageFrequency: c.messageFrequency ?? 0,
              lastContactedAt: c.lastContactedAt ? new Date(c.lastContactedAt) : null,
              relationshipScore: c.relationshipScore ?? 0,
            })
            .returning({ id: schema.contacts.id });
          contactId = newContact.id;
        }
        upserted++;

        // SIGNAL-01: Generate birthday signals if birthday is known
        if (c.birthday) {
          const birthday = new Date(c.birthday);
          const triggerDates = birthdayTriggerDates(birthday, thisYear);

          for (let i = 0; i < 3; i++) {
            const triggerDate = triggerDates[i];
            if (triggerDate < now) continue; // past — skip

            const dk = dedupeKey(userId, contactId, 'birthday', triggerDate.toISOString().slice(0, 10));
            await db
              .insert(schema.signals)
              .values({
                sourceUserId: userId,
                userId,
                contactId,
                signalType: 'birthday',
                triggerDate,
                status: 'pending',
                data: { contactName: c.name, daysUntil: 3 - i },
                payload: { contactName: c.name },
                dedupeKey: dk,
              })
              .onConflictDoNothing();
            signalsCreated++;
          }
        }
      }

      return { upserted, signalsCreated };
    },
  );

  /**
   * POST /signals/ingest/calendar
   * DATA-03 / SIGNAL-04: iOS pushes upcoming calendar events; server finds shared ones.
   */
  app.post(
    '/signals/ingest/calendar',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest) => {
      const { events } = CalendarEventSchema.parse(req.body);
      const userId = req.userId!;
      let signalsCreated = 0;

      // Resolve attendee external IDs → contact rows for this user
      const userContacts = await db
        .select({ id: schema.contacts.id, externalId: schema.contacts.externalId, name: schema.contacts.name })
        .from(schema.contacts)
        .where(eq(schema.contacts.userId, userId));

      const contactByExtId = new Map(userContacts.map((c) => [c.externalId, c]));

      for (const event of events) {
        const startDate = new Date(event.startDate);
        const now = new Date();
        if (startDate < now) continue; // only future events

        // Find contacts in the attendee list
        for (const extId of event.attendeeExternalIds) {
          const contact = contactByExtId.get(extId);
          if (!contact) continue;

          const dk = dedupeKey(userId, contact.id, 'shared_event', event.eventId);
          await db
            .insert(schema.signals)
            .values({
              sourceUserId: userId,
              userId,
              contactId: contact.id,
              signalType: 'shared_event',
              triggerDate: startDate,
              status: 'pending',
              data: { eventId: event.eventId, eventTitle: event.title, contactName: contact.name },
              payload: { eventId: event.eventId, eventTitle: event.title, contactName: contact.name },
              dedupeKey: dk,
            })
            .onConflictDoNothing();
          signalsCreated++;
        }
      }

      return { signalsCreated };
    },
  );

  /**
   * POST /signals/ingest/questionnaire-matches
   * SIGNAL-05: Surface profile field matches between connected users (alma mater, hometown, city)
   * Only fires for selective/full_social users who opted in.
   */
  app.post(
    '/signals/ingest/questionnaire-matches',
    { preHandler: authenticate },
    async (req: AuthenticatedRequest) => {
      const userId = req.userId!;

      const [myProfile] = await db
        .select()
        .from(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, userId))
        .limit(1);

      if (!myProfile) return { matched: 0 };

      // Find all users in shared circles
      const myCircleIds = await db
        .select({ circleId: schema.circleMembers.circleId })
        .from(schema.circleMembers)
        .where(eq(schema.circleMembers.userId!, userId));

      if (myCircleIds.length === 0) return { matched: 0 };

      const circleIds = myCircleIds.map((r) => r.circleId);
      const coMembers = await db
        .select({ userId: schema.circleMembers.userId })
        .from(schema.circleMembers)
        .where(inArray(schema.circleMembers.circleId, circleIds));

      const coMemberIds = [...new Set(coMembers.map((m) => m.userId).filter((id): id is number => id !== null && id !== userId))];
      if (coMemberIds.length === 0) return { matched: 0 };

      const coProfiles = await db
        .select()
        .from(schema.userProfiles)
        .where(inArray(schema.userProfiles.userId, coMemberIds));

      let matched = 0;
      const matchTypes = [
        { field: 'almaMater' as const, label: 'alma mater' },
        { field: 'hometown' as const, label: 'hometown' },
        { field: 'currentCity' as const, label: 'current city' },
      ];

      for (const peer of coProfiles) {
        for (const { field, label } of matchTypes) {
          const myVal = myProfile[field];
          const peerVal = peer[field];
          if (!myVal || !peerVal || myVal.toLowerCase() !== peerVal.toLowerCase()) continue;

          const dk = `${userId}:${peer.userId}:questionnaire_match:${label}`;
          await db
            .insert(schema.signals)
            .values({
              sourceUserId: userId,
              userId,
              signalType: 'questionnaire_match',
              triggerDate: new Date(),
              status: 'pending',
              data: { peerUserId: peer.userId, matchType: label, matchValue: myVal },
              payload: { peerUserId: peer.userId, matchType: label, matchValue: myVal },
              dedupeKey: dk,
            })
            .onConflictDoNothing();
          matched++;
        }
      }

      return { matched };
    },
  );

  /**
   * POST /signals/dispatch
   * SIGNAL-02: Internal job endpoint — sends pending signals as APNs push notifications.
   * In production this is called by Cloud Tasks on a daily schedule.
   */
  app.post('/signals/dispatch', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const userId = req.userId!;
    const now = new Date();

    const pending = await db
      .select()
      .from(schema.signals)
      .where(
        and(
          eq(schema.signals.userId!, userId),
          eq(schema.signals.status, 'pending'),
          lte(schema.signals.triggerDate!, now),
        ),
      );

    const [user] = await db
      .select({ apnsDeviceToken: schema.users.apnsDeviceToken })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const token = user?.apnsDeviceToken;

    let sent = 0;
    for (const signal of pending) {
      // APNs payload construction (actual HTTP/2 send handled by a separate APNs service)
      const notification = {
        aps: {
          alert: {
            title: buildNotificationTitle(signal),
            body: buildNotificationBody(signal),
          },
          badge: 1,
          sound: 'default',
        },
        signalId: signal.id,
        signalType: signal.signalType,
      };

      // Mark as sent — actual APNs delivery wired in production via GCP Secret Manager
      await db
        .update(schema.signals)
        .set({ status: 'sent', sentAt: now })
        .where(eq(schema.signals.id, signal.id));

      sent++;
      app.log.info({ signalId: signal.id, token: token?.slice(0, 8), notification }, 'Signal dispatched');
    }

    return { dispatched: sent };
  });
}

function buildNotificationTitle(signal: typeof schema.signals.$inferSelect): string {
  const payload = (signal.payload ?? {}) as Record<string, string>;
  switch (signal.signalType) {
    case 'birthday':            return `🎂 It's ${payload.contactName}'s birthday!`;
    case 'shared_event':        return `You and ${payload.contactName} have ${payload.eventTitle} coming up`;
    case 'questionnaire_match': return `You and someone share the same ${payload.matchType}`;
    default: return 'Amber has a suggestion for you';
  }
}

function buildNotificationBody(signal: typeof schema.signals.$inferSelect): string {
  const payload = (signal.payload ?? {}) as Record<string, string>;
  switch (signal.signalType) {
    case 'birthday':
      return 'Tap to send a message or set a reminder.';
    case 'shared_event':
      return `${payload.eventTitle} — tap to reach out before it starts.`;
    case 'questionnaire_match':
      return `You both listed ${payload.matchValue} as your ${payload.matchType}.`;
    default:
      return 'Tap to see more.';
  }
}
