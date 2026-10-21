import { createHash } from "node:crypto";
import { query } from "../db/sql.js";
import {
  readSyncableAccounts,
  upsertSyncedEvent,
} from "../db/calendar-accounts.js";
import { accessTokenFor } from "./calendar-sync.js";
export const planVersion = (p) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        p.title || "",
        p.description || "",
        p.place || "",
        new Date(p.startsAt).toISOString(),
        p.endsAt ? new Date(p.endsAt).toISOString() : null,
      ]),
    )
    .digest("hex");
const shape = (r) => ({
  id: r.event_id,
  title: r.title || "",
  description: r.description || "",
  place: r.place || "",
  startsAt: r.scheduled_at,
  endsAt: r.ends_at,
  provider: r.source,
  accountId: r.calendar_account_id,
  externalId: r.external_id,
});
export async function findMemoPlans(owner, text) {
  const { rows } = await query(
    `SELECT event_id,title,description,place,scheduled_at,ends_at,source,calendar_account_id,external_id
    FROM events WHERE owner_id=$1 AND deleted_at IS NULL AND scheduled_at IS NOT NULL
    AND source IN ('capture','google') AND title ILIKE $2
    ORDER BY abs(extract(epoch from (scheduled_at-now()))) LIMIT 20`,
    [owner, `%${text.replace(/[\\%_]/g, "\\$&")}%`],
  );
  return rows.map((r) => {
    const p = shape(r);
    return { ...p, version: planVersion(p) };
  });
}
async function getPlan(owner, id) {
  const { rows } = await query(
    `SELECT event_id,title,description,place,scheduled_at,ends_at,source,calendar_account_id,external_id
    FROM events WHERE owner_id=$1 AND event_id=$2 AND deleted_at IS NULL AND scheduled_at IS NOT NULL`,
    [owner, id],
  );
  return rows[0] ? shape(rows[0]) : null;
}
const fail = (code, status = 409) =>
  Object.assign(Error(code), { code, status });
async function googleCall(token, path, options, fetchImpl) {
  const response = await fetchImpl(
    `https://www.googleapis.com/calendar/v3${path}`,
    {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw fail(
      response.status === 412 ? "plan_changed" : "google_update_unconfirmed",
      response.status === 412 ? 409 : 503,
    );
  return response.json();
}
async function updateGoogle(plan, input, deps) {
  const accounts = await (deps.accounts || readSyncableAccounts)(input.ownerId);
  const account = accounts.find(
    (a) =>
      a.id === plan.accountId &&
      a.owner_id === input.ownerId &&
      a.provider === "google",
  );
  if (!account) throw fail("google_not_connected");
  const token = await (deps.token || accessTokenFor)(account);
  if (!token) throw fail("google_reconnect");
  const fetchImpl = deps.fetch || fetch;
  // The sync namespaces secondary calendars as calendarId:eventId.
  const split = plan.externalId.lastIndexOf(":");
  const calendar = split < 0 ? "primary" : plan.externalId.slice(0, split);
  const eventId =
    split < 0 ? plan.externalId : plan.externalId.slice(split + 1);
  const path = `/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(eventId)}`;
  const current = await googleCall(token, path, {}, fetchImpl);
  if (
    current.status === "cancelled" ||
    current.recurrence ||
    current.recurringEventId ||
    !current.start?.dateTime ||
    !current.end?.dateTime ||
    !current.etag
  )
    throw fail("plan_not_editable");
  const remote = {
    title: current.summary,
    description: current.description,
    place: current.location || current.hangoutLink,
    startsAt: current.start.dateTime,
    endsAt: current.end.dateTime,
  };
  const replayed = planVersion(remote) === planVersion(input);
  if (!replayed && planVersion(remote) !== input.version)
    throw fail("plan_changed");
  const event = replayed
    ? current
    : await googleCall(
        token,
        `${path}?sendUpdates=none`,
        {
          method: "PATCH",
          headers: { "If-Match": current.etag },
          body: JSON.stringify({
            summary: input.title,
            description: input.description,
            location: input.place,
            start: { dateTime: input.startsAt },
            end: { dateTime: input.endsAt },
          }),
        },
        fetchImpl,
      );
  const saved = await (deps.mirror || upsertSyncedEvent)(
    input.ownerId,
    plan.accountId,
    {
      externalId: plan.externalId,
      title: event.summary,
      description: event.description,
      place: event.location,
      startsAt: event.start.dateTime,
      endsAt: event.end.dateTime,
      provider: "google",
      allDay: false,
    },
  );
  if (!saved?.eventId) throw fail("google_saved_amber_pending", 503);
  return { ok: true, id: saved.eventId, destination: "google", replayed };
}
async function updateLocal(plan, input) {
  // Compare and write atomically, including owner and source, to avoid a lost edit.
  const { rows } = await query(
    `UPDATE events SET title=$3,description=$4,place=$5,starts_at=$6,scheduled_at=$6,ends_at=$7
    WHERE owner_id=$1 AND event_id=$2 AND source='capture' AND deleted_at IS NULL
    AND coalesce(title,'')=$8 AND coalesce(description,'')=$9 AND coalesce(place,'')=$10
    AND scheduled_at=$11 AND ends_at IS NOT DISTINCT FROM $12::timestamptz RETURNING event_id`,
    [
      input.ownerId,
      input.id,
      input.title,
      input.description,
      input.place,
      input.startsAt,
      input.endsAt,
      plan.title,
      plan.description,
      plan.place,
      plan.startsAt,
      plan.endsAt,
    ],
  );
  return rows[0]?.event_id;
}
export async function updateMemoPlan(input, deps = {}) {
  if (
    !input.title?.trim() ||
    ![input.startsAt, input.endsAt].every(
      (t) =>
        typeof t === "string" &&
        /(Z|[+-]\d{2}:\d{2})$/.test(t) &&
        Number.isFinite(Date.parse(t)),
    ) ||
    Date.parse(input.endsAt) <= Date.parse(input.startsAt)
  )
    throw fail("invalid_plan", 400);
  const plan = await (deps.get || getPlan)(input.ownerId, input.id);
  if (!plan) throw fail("not_found", 404);
  const same = planVersion(plan) === planVersion(input);
  if (!same && planVersion(plan) !== input.version) throw fail("plan_changed");
  if (plan.provider === "google") return updateGoogle(plan, input, deps);
  if (plan.provider !== "capture") throw fail("plan_not_editable");
  if (!same && !(await (deps.update || updateLocal)(plan, input)))
    throw fail("plan_update_unconfirmed", 503);
  return { ok: true, id: input.id, destination: "amber", replayed: same };
}
