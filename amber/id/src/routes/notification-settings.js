/**
 * Per-user notification channel preference.
 *
 *   GET   /v1/me/notification-settings  → { channels: { apple, imessage } }
 *   PATCH /v1/me/notification-settings  → merge + return { channels }
 *
 * Scope: reminders the user sets FOR THEMSELVES only (nothing social). A
 * reminder can be delivered via an Apple/lock-screen LOCAL notification
 * (scheduled ON-DEVICE by the app) and/or via iMessage (sent SERVER-SIDE by
 * the reminder scheduler at fire time). This endpoint is where the user picks
 * which channel(s) they want; the /v1/reminders/parse persist step reads it to
 * decide whether a server-side iMessage row is created.
 *
 * Storage: users.profile_extra jsonb (Chunk 4a overflow column) under the
 * `notificationSettings.channels` key — the same durable, owner-scoped pattern
 * the F5 profile priors use (mergeUserProfileExtra does an SQL-side `||` so a
 * partial patch never drops sibling keys). Wiped on account delete because
 * purge.js hard-deletes the owner's users row.
 *
 * Isolation: the owner is resolved from the caller's own verified session
 * (request.privyUser.phone → amber_id). The path never accepts a foreign id,
 * so no caller can read or write another tenant's settings.
 *
 * Sensible defaults: apple ON (free, private, on-device), imessage OFF until
 * the user explicitly opts in to server-side delivery.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { query } from "../db/sql.js";
import {
  resolveAmberIdByPhone,
  getUserProfileExtraByAmberId,
  mergeUserProfileExtra,
} from "../db/store.js";

export const NOTIFICATION_SETTINGS_KEY = "notificationSettings";
export const DEFAULT_NOTIFICATION_CHANNELS = Object.freeze({
  apple: true,
  imessage: false,
});

/**
 * WHAT AMBER IS ALLOWED TO INTERRUPT YOU ABOUT — the second half of "both:
 * Settings and each person".
 *
 * One switch for everything is the only control that existed, and it is the
 * wrong grain: somebody who does not want to hear about every note their
 * network shares still wants to hear that a reminder came due. These are the
 * categories the app actually sends, named after the `data.type` the push
 * carries, because that string is what the tap handler routes on and therefore
 * the only classification that is guaranteed to exist at send time.
 *
 * ALL DEFAULT ON. A category nobody has an opinion about behaves exactly as it
 * did before this existed, and an unreadable settings row can only ever mean
 * "send", never "mute" -- see notify.js.
 */
export const NOTIFICATION_CATEGORIES = Object.freeze([
  "reminder",
  "note",
  "circle",
  "connection",
  "question",
  "dm",
]);
export const DEFAULT_NOTIFICATION_CATEGORIES = Object.freeze(
  Object.fromEntries(NOTIFICATION_CATEGORIES.map((k) => [k, true])),
);

/** The category a push belongs to, from the `data.type` it carries. */
export function categoryForPushType(type) {
  const t = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (!t) return null;
  // 'share' is the older spelling of a note that arrived from somebody else;
  // both are the same decision to the person choosing.
  if (t === "share") return "note";
  return NOTIFICATION_CATEGORIES.includes(t) ? t : null;
}

/** Canonical { [category]: boolean }, every key present, missing = on. */
export function normalizeCategories(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of NOTIFICATION_CATEGORIES) {
    out[key] = typeof c[key] === "boolean" ? c[key] : true;
  }
  return out;
}

/**
 * The accounts this owner has muted, as a de-duplicated array of amber ids.
 *
 * Stored as amber ids rather than contact ids on purpose: a push is addressed
 * to an ACCOUNT and sent by an ACCOUNT, and the muting decision has to be
 * answerable at send time without a per-recipient contacts lookup. The mute
 * endpoint accepts a contactId and resolves it once, at write time.
 */
export function normalizeMuted(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    const id = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 500);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Coerce an arbitrary stored/incoming channels object into the canonical
 * { apple:boolean, imessage:boolean } shape, filling missing keys from the
 * defaults. Never throws.
 */
export function normalizeChannels(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    apple:
      typeof c.apple === "boolean" ? c.apple : DEFAULT_NOTIFICATION_CHANNELS.apple,
    imessage:
      typeof c.imessage === "boolean"
        ? c.imessage
        : DEFAULT_NOTIFICATION_CHANNELS.imessage,
  };
}

/**
 * Read the effective notification channels for an owner (amber_id). Falls back
 * to defaults for an unknown owner or on any read error. Shared with the
 * reminders parse-persist path so both agree on the same shape + defaults.
 */
export async function getNotificationChannels(amberId, deps = {}) {
  const getExtra =
    deps.getUserProfileExtraByAmberId || getUserProfileExtraByAmberId;
  if (!amberId) return { ...DEFAULT_NOTIFICATION_CHANNELS };
  const extra = await getExtra(amberId).catch(() => ({}));
  return normalizeChannels(extra?.[NOTIFICATION_SETTINGS_KEY]?.channels);
}

/**
 * Everything the sender needs to decide whether to send: the channel switch,
 * the per-category switches, and who this owner has muted.
 *
 * ONE READ, because notify.js asks per recipient and a circle share can have
 * fifteen of them. Falls back to "send everything" on any failure, for the same
 * reason getNotificationChannels falls back to the defaults: a settings lookup
 * that fails must not silently mute somebody.
 */
export async function getNotificationPrefs(amberId, deps = {}) {
  const getExtra =
    deps.getUserProfileExtraByAmberId || getUserProfileExtraByAmberId;
  const fallback = {
    channels: { ...DEFAULT_NOTIFICATION_CHANNELS },
    categories: { ...DEFAULT_NOTIFICATION_CATEGORIES },
    muted: [],
  };
  if (!amberId) return fallback;
  const extra = await getExtra(amberId).catch(() => null);
  if (!extra) return fallback;
  const node = extra?.[NOTIFICATION_SETTINGS_KEY] ?? {};
  return {
    channels: normalizeChannels(node.channels),
    categories: normalizeCategories(node.categories),
    muted: normalizeMuted(node.muted),
  };
}

export function registerNotificationSettingsRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmber = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const getExtra =
    deps.getUserProfileExtraByAmberId || getUserProfileExtraByAmberId;
  const mergeExtra = deps.mergeUserProfileExtra || mergeUserProfileExtra;

  // ── GET /v1/me/notification-settings ──────────────────────────────────
  app.get(
    "/v1/me/notification-settings",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) {
        return reply.code(400).send({
          error: "no_phone_on_session",
          message: "Session carries no phone — cannot resolve settings owner.",
        });
      }
      const amberId = await resolveAmber(phone).catch(() => null);
      if (!amberId) {
        // Unknown owner: return defaults rather than error so the app can
        // render the toggle screen even mid-provisioning.
        return {
          channels: { ...DEFAULT_NOTIFICATION_CHANNELS },
          categories: { ...DEFAULT_NOTIFICATION_CATEGORIES },
          muted: [],
        };
      }
      const extra = await getExtra(amberId).catch(() => ({}));
      const node = extra?.[NOTIFICATION_SETTINGS_KEY] ?? {};
      return {
        channels: normalizeChannels(node.channels),
        categories: normalizeCategories(node.categories),
        muted: normalizeMuted(node.muted),
      };
    },
  );

  // ── PATCH /v1/me/notification-settings ────────────────────────────────
  app.patch(
    "/v1/me/notification-settings",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          properties: {
            channels: {
              type: "object",
              properties: {
                apple: { type: "boolean" },
                imessage: { type: "boolean" },
              },
              additionalProperties: false,
            },
            // The per-category switches. `required` dropped from `channels`
            // below: a caller changing only "tell me about shared notes" has no
            // business also having to restate its channel preferences.
            categories: {
              type: "object",
              properties: Object.fromEntries(
                NOTIFICATION_CATEGORIES.map((k) => [k, { type: "boolean" }]),
              ),
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) {
        return reply.code(400).send({
          error: "no_phone_on_session",
          message: "Session carries no phone — cannot resolve settings owner.",
        });
      }
      const amberId = await resolveAmber(phone).catch(() => null);
      if (!amberId) {
        return reply.code(500).send({
          error: "could_not_resolve_owner",
          message: "Could not resolve Cloud SQL owner for this session.",
        });
      }

      const extra = await getExtra(amberId).catch(() => ({}));
      const node = extra?.[NOTIFICATION_SETTINGS_KEY] ?? {};
      const current = normalizeChannels(node.channels);
      const currentCats = normalizeCategories(node.categories);
      const incoming =
        request.body?.channels && typeof request.body.channels === "object"
          ? request.body.channels
          : {};
      const incomingCats =
        request.body?.categories && typeof request.body.categories === "object"
          ? request.body.categories
          : {};
      // PATCH semantics: only the keys the caller sends change.
      const merged = {
        apple:
          typeof incoming.apple === "boolean" ? incoming.apple : current.apple,
        imessage:
          typeof incoming.imessage === "boolean"
            ? incoming.imessage
            : current.imessage,
      };
      const mergedCats = { ...currentCats };
      for (const key of NOTIFICATION_CATEGORIES) {
        if (typeof incomingCats[key] === "boolean") mergedCats[key] = incomingCats[key];
      }

      // WRITTEN WHOLE, BOTH OF THEM. mergeUserProfileExtra is an SQL-side `||`,
      // which is a SHALLOW merge: writing { channels } alone would leave the
      // stored categories and mute list intact only because they are siblings
      // one level down. Writing both explicitly keeps that true no matter how
      // the merge behaves, and `muted` is deliberately absent -- it has its own
      // endpoint, and echoing a stale copy of it here is how a mute gets undone
      // by somebody toggling an unrelated switch.
      await mergeExtra(amberId, {
        [NOTIFICATION_SETTINGS_KEY]: { channels: merged, categories: mergedCats },
      }).catch(() => null);

      request.log?.info?.(
        `NOTIFICATION_SETTINGS_UPDATED owner=${amberId} apple=${merged.apple} ` +
          `imessage=${merged.imessage} off=${
            NOTIFICATION_CATEGORIES.filter((k) => !mergedCats[k]).join(",") || "none"
          }`,
      );
      return { channels: merged, categories: mergedCats, muted: normalizeMuted(node.muted) };
    },
  );

  // ── POST /v1/me/notification-settings/mute ────────────────────────────
  //
  // "Both: Settings and each person." This is the each-person half: silence one
  // account without silencing the category it belongs to, because the reason
  // somebody mutes is almost always one person rather than one kind of event.
  //
  // Takes a contactId (what the person's card knows) or an amberId (what a DM
  // thread knows) and stores the AMBER ID, resolved here, once. Resolution is
  // owner-scoped, so a caller can only mute an account that is linked to a
  // contact in their OWN address book -- there is no way to use this endpoint to
  // learn whether an arbitrary contact id belongs to an Amber user.
  //
  // Muting is one-directional and invisible: it changes what THIS owner
  // receives, and the muted person is never told. That is the difference
  // between this and blocking, which is in the DM surface and says so.
  app.post(
    "/v1/me/notification-settings/mute",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["muted"],
          properties: {
            muted: { type: "boolean" },
            amberId: { type: "string", maxLength: 64 },
            contactId: { type: "string", maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) {
        return reply.code(400).send({ error: "no_phone_on_session" });
      }
      const amberId = await resolveAmber(phone).catch(() => null);
      if (!amberId) {
        return reply.code(500).send({ error: "could_not_resolve_owner" });
      }

      const body = request.body || {};
      let target = typeof body.amberId === "string" ? body.amberId.trim().toLowerCase() : "";
      if (!UUID_RE.test(target)) target = "";

      if (!target && typeof body.contactId === "string") {
        try {
          const { rows } = await query(
            `SELECT linked_amber_id FROM contacts
              WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
            [body.contactId, amberId],
          );
          if (rows.length === 0) {
            return reply.code(404).send({ error: "contact_not_found" });
          }
          const linked = rows[0].linked_amber_id;
          if (!linked) {
            // Nothing to mute: a contact with no account cannot send a push.
            // Said plainly rather than stored, so the app can hide the switch
            // instead of offering one that does nothing.
            return reply.code(409).send({
              error: "not_on_amber",
              message: "They do not have an Amber account, so they cannot notify you.",
            });
          }
          target = String(linked).toLowerCase();
        } catch (err) {
          request.log?.warn?.(`MUTE_LOOKUP_FAILED owner=${amberId}: ${err.message}`);
          return reply.code(503).send({ error: "lookup_failed" });
        }
      }

      if (!target) return reply.code(400).send({ error: "target_required" });
      if (target === String(amberId).toLowerCase()) {
        return reply.code(400).send({ error: "cannot_mute_yourself" });
      }

      const extra = await getExtra(amberId).catch(() => ({}));
      const current = normalizeMuted(extra?.[NOTIFICATION_SETTINGS_KEY]?.muted);
      const next = body.muted
        ? current.includes(target)
          ? current
          : [...current, target]
        : current.filter((id) => id !== target);

      await mergeExtra(amberId, {
        [NOTIFICATION_SETTINGS_KEY]: { muted: next },
      }).catch(() => null);

      request.log?.info?.(
        `NOTIFICATION_MUTE owner=${amberId} target=${target} muted=${Boolean(body.muted)} total=${next.length}`,
      );
      return { muted: next };
    },
  );
}
