/**
 * WHERE A TEAM'S WORK LIVES, AND WHEN IT IS HAPPENING.
 *
 * Connections (links) and the group calendar. Same `call` as everything else:
 * the token is read at the moment of the call, never held in a component.
 */

import { call, tokenNow } from "./amber";

const t = () => tokenNow() ?? undefined;

export type ConnectionProvider =
  | "github" | "gitlab" | "clay" | "drive" | "salesforce" | "hubspot"
  | "notion" | "slack" | "linear" | "figma" | "airtable" | "jira"
  | "dropbox" | "sheets" | "looker" | "bigquery" | "link";

export type Connection = {
  id: string;
  group_id: string | null;
  group_name: string | null;
  label: string;
  url: string;
  provider: ConnectionProvider;
  note: string | null;
  position: number;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

/**
 * What each provider is called, for the chip.
 *
 * The server derives the provider from the URL's host — nobody is asked to
 * classify github.com after already pasting it — so this map only has to
 * render what came back, and an unrecognized host arrives as "link".
 */
export const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  clay: "Clay",
  drive: "Google Drive",
  salesforce: "Salesforce",
  hubspot: "HubSpot",
  notion: "Notion",
  slack: "Slack",
  linear: "Linear",
  figma: "Figma",
  airtable: "Airtable",
  jira: "Jira",
  dropbox: "Dropbox",
  sheets: "Smartsheet",
  looker: "Looker",
  bigquery: "BigQuery",
  link: "Link",
};

/** A tint per provider, so a row of six is scannable without reading it. */
export const PROVIDER_HUE: Record<string, string> = {
  github: "#24292f",
  gitlab: "#fc6d26",
  clay: "#3b82f6",
  drive: "#188038",
  salesforce: "#00a1e0",
  hubspot: "#ff7a59",
  notion: "#111111",
  slack: "#4a154b",
  linear: "#5e6ad2",
  figma: "#a259ff",
  airtable: "#18bfff",
  jira: "#0052cc",
  dropbox: "#0061ff",
  sheets: "#0b7a4b",
  looker: "#4285f4",
  bigquery: "#669df6",
  link: "#6b7280",
};

export const getConnections = (groupId?: string | null) => {
  const q = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
  return call<{ connections: Connection[]; count: number }>(
    `/v1/org/connections${q}`, {}, t());
};

export const addConnection = (body: {
  label: string;
  url: string;
  note?: string | null;
  groupId?: string | null;
}) =>
  call<{ connection: Connection }>(
    "/v1/org/connections",
    { method: "POST", body: JSON.stringify(body) },
    t(),
  );

export const updateConnection = (
  id: string,
  body: { label?: string; url?: string; note?: string | null; position?: number },
) =>
  call<{ connection: Connection }>(
    `/v1/org/connections/${id}`,
    { method: "PATCH", body: JSON.stringify(body) },
    t(),
  );

export const removeConnection = (id: string) =>
  call<{ ok: true }>(`/v1/org/connections/${id}`, { method: "DELETE" }, t());

/* -------------------------------------------------------------- calendar */

export type GroupEvent = {
  id: string;
  /** "team" — somebody typed it for the group. "synced" — from a shared calendar. */
  kind: "team" | "synced";
  title: string;
  note: string | null;
  location: string | null;
  url: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  owner_name: string | null;
  calendar_label: string | null;
  owner_id: string | null;
  /**
   * Which connected account this came from. Null for a team event.
   *
   * One person can share three calendars with a team, and filtering by person
   * cannot tell those apart — which is the whole reason somebody shares more
   * than one.
   */
  calendar_account_id: string | null;
};

export type MyCalendar = {
  id: string;
  provider: "google" | "microsoft";
  account_email: string;
  display_name: string | null;
  last_error: string | null;
  synced_at: string | null;
  shared: boolean;
  shared_label: string | null;
};

export const getGroupCalendar = (
  groupId: string,
  opts: { from?: string; to?: string } = {},
) => {
  const q = new URLSearchParams();
  if (opts.from) q.set("from", opts.from);
  if (opts.to) q.set("to", opts.to);
  const qs = q.toString();
  return call<{ events: GroupEvent[]; count: number }>(
    `/v1/org/groups/${groupId}/calendar${qs ? `?${qs}` : ""}`, {}, t());
};

/** Every calendar this person has connected, and whether it is shared here. */
export const getMyCalendars = (groupId: string) =>
  call<{ calendars: MyCalendar[]; count: number }>(
    `/v1/org/groups/${groupId}/calendar/mine`, {}, t());

/**
 * Share or unshare one calendar with one group.
 *
 * Nothing is copied: the team view joins through to events already synced
 * under that account, so unsharing removes them from the team's week
 * immediately rather than leaving a stale copy behind.
 */
export const shareCalendar = (
  groupId: string,
  calendarAccountId: string,
  on: boolean,
  label?: string | null,
) =>
  call<{ ok: true; shared: boolean }>(
    `/v1/org/groups/${groupId}/calendar/share`,
    { method: "POST", body: JSON.stringify({ calendarAccountId, on, label: label ?? null }) },
    t(),
  );

export const addGroupEvent = (
  groupId: string,
  body: {
    title: string;
    startsAt: string;
    endsAt?: string | null;
    note?: string | null;
    location?: string | null;
    url?: string | null;
    allDay?: boolean;
  },
) =>
  call<{ event: GroupEvent }>(
    `/v1/org/groups/${groupId}/calendar/events`,
    { method: "POST", body: JSON.stringify(body) },
    t(),
  );

export const removeGroupEvent = (groupId: string, eventId: string) =>
  call<{ ok: true }>(
    `/v1/org/groups/${groupId}/calendar/events/${eventId}`,
    { method: "DELETE" },
    t(),
  );

/* ------------------------------------------------- connecting a calendar */

/**
 * Begin connecting a Google or Microsoft calendar.
 *
 * Returns an authorize URL to send the browser to. It does NOT redirect here:
 * the caller decides when to leave the page, and a function that navigates as
 * a side effect of being called is one nobody can use from a confirmation
 * dialog.
 *
 * A 503 `platform_not_configured` means this deployment has no OAuth client
 * for that provider — an environment problem on our side, not something the
 * person did, and the UI has to say so rather than showing a dead button.
 */
/**
 * WHAT IS ACTUALLY FEEDING THE GRAPH RIGHT NOW.
 *
 * The connector screen hard-coded "Connect" on every row, so somebody could
 * complete the whole Google flow, come back, and be told to connect the thing
 * they had just connected -- which reads as the connection having failed. The
 * grant rows are the truth: they are what the server reads before it syncs
 * anything, so they are what the screen should show.
 */
export type MemorySource = {
  id: string;
  source: string;
  scope_ref: string | null;
  granted_at: string;
  revoked_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

/** Turn one source on for the signed-in member, in their own org. */
export const grantMemorySource = (source: "calendar" | "mail") =>
  call<{ ok: boolean; reason?: string }>(
    "/v1/org/memory/sources",
    { method: "POST", body: JSON.stringify({ source }) },
    t(),
  );

/** Pull everything in now: calendars, mailboxes, names, merges. */
export const syncMemoryNow = () =>
  call<{ ok: true; named?: number; mergedPeople?: number; people?: number }>(
    "/v1/org/memory/sync",
    { method: "POST", body: "{}" },
    t(),
  );

export const listMemorySources = () =>
  call<{ sources: MemorySource[] }>("/v1/org/memory/sources", {}, t());

/**
 * CONNECT GOOGLE FOR THE RELATIONSHIP GRAPH, which is a different consent
 * from the agenda.
 *
 * `purpose=calendar` asks for the calendar and nothing else, and every
 * connect in this product used it -- which is why the graph was a wall of
 * email addresses. A calendar invite names a guest only when the organizer
 * had them saved; the names are in the mail headers and in the contact
 * buckets Google itself resolves from, and neither was ever granted.
 *
 * This asks for the calendar read-only, the mailbox READ-ONLY, and the two
 * contact buckets. No Drive, no sending, no modifying anything.
 */
export const startRelationshipConnect = (returnTo: string) =>
  call<{ authorize_url: string }>(
    `/v1/oauth/google/init?purpose=relationships&return_to=${encodeURIComponent(returnTo)}`,
    {},
    t(),
  );

export const startCalendarConnect = (
  provider: "google" | "microsoft",
  returnTo: string,
) =>
  call<{ authorize_url: string }>(
    `/v1/oauth/${provider}/init?purpose=calendar&return_to=${encodeURIComponent(returnTo)}`,
    {},
    t(),
  );

/**
 * Every calendar this account has connected, independent of any group.
 *
 * THE SERVER CALLS THEM `accounts` AND THIS CALLED THEM `calendars`, so
 * every caller read undefined, decided nothing was connected, and showed
 * somebody a Connect button for a calendar they had connected weeks ago --
 * which is the whole reason the calendar appeared to have failed. Both keys
 * are accepted and the caller gets one shape.
 */
export const listMyCalendars = async () => {
  const r = await call<{ accounts?: MyCalendar[]; calendars?: MyCalendar[] }>(
    "/v1/me/calendars",
    {},
    t(),
  );
  return { calendars: r.accounts ?? r.calendars ?? [] };
};

/* ------------------------------------------------------- the calendar ---
 *
 * What is actually on the calendars somebody connected, and the button that
 * pulls them again. The org routes rather than the personal ones, because
 * the sync here also has to feed the company's graph: a refresh that updates
 * a private event store and leaves the network unchanged is indistinguishable
 * from one that did nothing.
 */
export type CalendarEvent = {
  event_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  place: string | null;
  kind: string | null;
  attendees: string[] | null;
  organizer: string | null;
  calendar_account_id: string | null;
};

export const getOrgCalendar = (days = 30) =>
  call<{ accounts: MyCalendar[] | null; upcoming: CalendarEvent[]; past: CalendarEvent[] }>(
    `/v1/org/calendar?days=${days}`,
    {},
    t(),
  );

export const syncOrgCalendar = () =>
  call<{
    ok: true;
    calendars: number;
    events: number;
    intoTheGraph?: number;
    synced: { account: string; provider: string; events: number; error: string | null }[];
  }>("/v1/org/calendar/sync", { method: "POST" }, t());

export const disconnectOrgCalendar = (accountId: string) =>
  call<{ ok: true }>(`/v1/org/calendar/${accountId}`, { method: "DELETE" }, t());

export const disconnectCalendar = (id: string) =>
  call<{ ok: true }>(`/v1/me/calendars/${id}`, { method: "DELETE" }, t());
