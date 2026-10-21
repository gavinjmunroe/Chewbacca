import { createHash } from "node:crypto";
import { readSyncableAccounts, upsertSyncedEvent } from "../db/calendar-accounts.js";
import { accessTokenFor } from "./calendar-sync.js";

const ROOT = "https://www.googleapis.com/calendar/v3";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function calendarWriteError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}
const fail = calendarWriteError;
async function googleRequest(path, token, options, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${ROOT}${path}`, {
      ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw fail("google_unconfirmed", 503, "Google has not confirmed the save. Retry this unchanged draft safely.");
  }
  if (res.status === 401 || res.status === 403)
    throw fail("google_reconnect", 409, "Reconnect Google Calendar with permission to create events.");
  if (!res.ok && res.status !== 409)
    throw fail("google_unavailable", 502, "Google Calendar could not complete this request. Retry this unchanged draft.");
  return { status: res.status, data: await res.json().catch(() => null) };
}
function eventBody(input) {
  const { title, description, startsAt, endsAt, place } = input;
  if (!title?.trim() || ![startsAt, endsAt].every(v => typeof v === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))) || Date.parse(endsAt) <= Date.parse(startsAt))
    throw fail("invalid_event", 400, "Choose a title and an end time after the start.");
  return {
    summary: title.trim(), description: description?.trim() || "", location: place?.trim() || "",
    start: { dateTime: new Date(startsAt).toISOString() },
    end: { dateTime: new Date(endsAt).toISOString() },
    reminders: { useDefault: false },
  };
}
/** Explicit primary-calendar destination. Tokens remain server-side; never infer attendees. */
export async function createGoogleCalendarEvent(input, deps = {}) {
  const body = eventBody(input);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.requestId || ""))
    throw fail("invalid_request", 400, "A stable request ID is required.");
  const accounts = await (deps.readAccounts || readSyncableAccounts)(input.ownerId);
  const account = accounts.find(a => a.id === input.accountId && a.owner_id === input.ownerId && a.provider === "google");
  if (!account) throw fail("google_not_connected", 404, "Connect this Google Calendar account before saving.");
  const fetchImpl = deps.fetch || fetch;
  const token = await (deps.accessToken || accessTokenFor)(account, fetchImpl);
  if (!token) throw fail("google_reconnect", 409, "Reconnect Google Calendar before saving.");
  const calendar = (await googleRequest("/users/me/calendarList/primary", token, {}, fetchImpl)).data;
  if (!calendar?.id || !["owner", "writer"].includes(calendar.accessRole))
    throw fail("google_not_writable", 409, "This Google calendar does not allow event creation.");
  // A UUID-backed request ID plus owner/account namespace gives a stable Google-compatible ID.
  const id = digest([input.ownerId, account.id, input.requestId.toLowerCase()]);
  const fingerprint = digest(body);
  const resource = { ...body, id, extendedProperties: { private: { amberRequest: fingerprint } } };
  const path = `/calendars/${encodeURIComponent(calendar.id)}/events`;
  const result = await googleRequest(path, token, { method: "POST", body: JSON.stringify(resource) }, fetchImpl);
  const replayed = result.status === 409;
  const event = replayed
    ? (await googleRequest(`${path}/${id}`, token, {}, fetchImpl)).data
    : result.data;
  if (event?.id !== id || event?.status === "cancelled" || event?.extendedProperties?.private?.amberRequest !== fingerprint)
    throw fail("google_action_conflict", 409, "This action differs from an existing or removed Google event. Check Google Calendar before making another event.");
  // Mirror the provider response with the SAME key used by calendar-sync; no duplicate Amber row.
  const saved = await (deps.upsert || upsertSyncedEvent)(input.ownerId, account.id, {
    externalId: id, title: event.summary, description: event.description || null,
    place: event.location || null, startsAt: event.start?.dateTime, endsAt: event.end?.dateTime,
    provider: "google", allDay: false,
  });
  if (!saved?.eventId)
    throw fail("google_saved_amber_pending", 503, "Saved in Google Calendar. Amber is still syncing it; retry this unchanged draft to finish without a duplicate.");
  return { eventId: saved.eventId, googleEventId: id, accountEmail: account.account_email, replayed, destination: "google" };
}
