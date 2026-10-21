/**
 * calendar/provider.js — Calendar provider adapter seam.
 *
 * One stable interface that the calendar runtime executes against. The
 * concrete backing can be:
 *
 *   - `gcal` (default): the existing native Google Calendar client at
 *     Newton/agent/lib/tools/gcal/. Today the only production path.
 *   - `perplexity-connector` (placeholder): a future broker that routes
 *     through Perplexity's native connector unlock. Credentials never live
 *     in this repo; the broker holds them. Auth posture is Privy /
 *     blockchain-first, Perplexity as the native-connector unlock, Apple
 *     as the third polished auth path.
 *   - `mock`: in-memory implementation for tests.
 *
 * The runtime never imports `gcal/client.js` directly — it goes through
 * `getCalendarProvider(tenant)` so the slice of behavior we ship here can
 * be re-pointed without rewriting callers.
 *
 * NOTE: Perplexity credentials must never be committed to this repo. The
 * connector broker option here is an interface placeholder — wiring it to
 * a real broker is a follow-up PR once the broker exists.
 */

/**
 * @typedef {Object} CalendarProvider
 * @property {string} name
 * @property {(args: { tenant: object, dimension?: string, timeMin?: string, timeMax?: string }) => Promise<{ events: Array<object> }>} listEvents
 * @property {(args: { tenant: object, calendarIds: string[], timeMin: string, timeMax: string }) => Promise<{ busy: Array<{calendarId: string, busy: Array<{start: string, end: string}>}> }>} freeBusy
 * @property {(args: { tenant: object, dimension: string, event: object }) => Promise<{ id: string, htmlLink?: string }>} createEvent
 * @property {(args: { tenant: object, dimension: string, eventId: string, patch: object }) => Promise<{ id: string }>} updateEvent
 * @property {(args: { tenant: object, dimension: string, eventId: string, notifyAttendees?: boolean }) => Promise<{ ok: true }>} deleteEvent
 */

const REGISTRY = new Map();

/**
 * Register a provider implementation by name. Idempotent.
 */
export function registerCalendarProvider(name, impl) {
  if (!name || typeof name !== "string") {
    throw new TypeError("provider name required");
  }
  if (!impl || typeof impl !== "object") {
    throw new TypeError("provider impl required");
  }
  const required = [
    "listEvents",
    "freeBusy",
    "createEvent",
    "updateEvent",
    "deleteEvent",
  ];
  for (const m of required) {
    if (typeof impl[m] !== "function") {
      throw new TypeError(`provider "${name}" missing method ${m}`);
    }
  }
  REGISTRY.set(name, { name, ...impl });
}

/**
 * Resolve which provider to use for a given tenant. Today this honors:
 *   1. `tenant.preferences?.calendar?.provider` if set and registered
 *   2. process.env.AMBER_CALENDAR_PROVIDER if set and registered
 *   3. `gcal` (default, lazy-loaded on first use)
 *
 * @param {object} [tenant]
 * @returns {Promise<CalendarProvider>}
 */
export async function getCalendarProvider(tenant) {
  const explicit =
    tenant?.preferences?.calendar?.provider ||
    process.env.AMBER_CALENDAR_PROVIDER ||
    "gcal";

  if (REGISTRY.has(explicit)) return REGISTRY.get(explicit);

  if (explicit === "gcal") {
    await registerDefaultGcalProvider();
    return REGISTRY.get("gcal");
  }

  throw new Error(`no calendar provider registered for "${explicit}"`);
}

/**
 * Register the gcal-backed provider on first use. Lazy so that test
 * environments that swap in `mock` never load the real client.
 */
async function registerDefaultGcalProvider() {
  if (REGISTRY.has("gcal")) return;
  const [{ listEvents, insertEvent, patchEvent, deleteEvent, queryFreebusy }, provisioner] =
    await Promise.all([
      import("../tools/gcal/client.js"),
      import("../tools/gcal/provisioner.js"),
    ]);

  const { resolveCalendarId } = provisioner;

  registerCalendarProvider("gcal", {
    async listEvents({ tenant, dimension, timeMin, timeMax }) {
      const calendarId = dimension
        ? await resolveCalendarId(tenant, dimension)
        : "primary";
      if (!calendarId) return { events: [] };
      const query = {};
      if (timeMin) query.timeMin = timeMin;
      if (timeMax) query.timeMax = timeMax;
      const res = await listEvents(tenant, calendarId, query);
      return { events: res?.items ?? res ?? [] };
    },
    async freeBusy({ tenant, calendarIds, timeMin, timeMax }) {
      const res = await queryFreebusy(tenant, calendarIds, timeMin, timeMax);
      return { busy: normalizeFreebusy(res) };
    },
    async createEvent({ tenant, dimension, event }) {
      const calendarId = await resolveCalendarId(tenant, dimension);
      if (!calendarId) throw new Error(`no calendar for dimension "${dimension}"`);
      const res = await insertEvent(tenant, calendarId, event);
      return { id: res.id, htmlLink: res.htmlLink };
    },
    async updateEvent({ tenant, dimension, eventId, patch }) {
      const calendarId = await resolveCalendarId(tenant, dimension);
      if (!calendarId) throw new Error(`no calendar for dimension "${dimension}"`);
      const res = await patchEvent(tenant, calendarId, eventId, patch);
      return { id: res.id };
    },
    async deleteEvent({ tenant, dimension, eventId }) {
      const calendarId = await resolveCalendarId(tenant, dimension);
      if (!calendarId) throw new Error(`no calendar for dimension "${dimension}"`);
      await deleteEvent(tenant, calendarId, eventId);
      return { ok: true };
    },
  });
}

function normalizeFreebusy(res) {
  if (!res || !res.calendars) return [];
  return Object.entries(res.calendars).map(([calendarId, info]) => ({
    calendarId,
    busy: info?.busy ?? [],
  }));
}

// ── Mock provider for tests ───────────────────────────────────────────────────

/**
 * Build an in-memory mock provider. Useful for tests and for the agent's
 * conversation-replay harness so we don't hit real Google.
 *
 * @param {object} [seed]
 * @param {Array<object>} [seed.events]
 * @returns {CalendarProvider & { _state: { events: Map<string, object> } }}
 */
export function buildMockCalendarProvider(seed = {}) {
  const events = new Map();
  for (const e of seed.events ?? []) {
    if (e?.id) events.set(e.id, { ...e });
  }
  let idCounter = 1;

  const provider = {
    name: "mock",
    _state: { events },
    async listEvents({ dimension, timeMin, timeMax }) {
      const all = Array.from(events.values());
      return {
        events: all.filter((e) => {
          if (dimension && e.dimension && e.dimension !== dimension) return false;
          if (timeMin && e.end && e.end < timeMin) return false;
          if (timeMax && e.start && e.start > timeMax) return false;
          return true;
        }),
      };
    },
    async freeBusy({ calendarIds, timeMin, timeMax }) {
      return {
        busy: (calendarIds ?? []).map((calendarId) => ({
          calendarId,
          busy: Array.from(events.values())
            .filter((e) => e.calendarId === calendarId)
            .filter((e) => !(e.end <= timeMin || e.start >= timeMax))
            .map((e) => ({ start: e.start, end: e.end })),
        })),
      };
    },
    async createEvent({ dimension, event }) {
      const id = event.id || `mock-evt-${idCounter++}`;
      const rec = { id, dimension, ...event };
      events.set(id, rec);
      return { id };
    },
    async updateEvent({ eventId, patch }) {
      const existing = events.get(eventId);
      if (!existing) throw new Error(`no event ${eventId}`);
      events.set(eventId, { ...existing, ...patch });
      return { id: eventId };
    },
    async deleteEvent({ eventId }) {
      events.delete(eventId);
      return { ok: true };
    },
  };
  registerCalendarProvider("mock", provider);
  return provider;
}

/**
 * Test-only: clear the registry. Not exported via the package index.
 */
export function _resetCalendarProviderRegistry() {
  REGISTRY.clear();
}
