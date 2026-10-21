/**
 * WHERE A TEAM'S WORK LIVES, AND WHEN IT IS HAPPENING.
 *
 * Connections and the group calendar. Both solve the same problem —
 * information that already exists somewhere else, which the team keeps
 * re-finding and re-pasting — and both are deliberately thin.
 */

import { query } from "./sql.js";

/* ------------------------------------------------------------ connections */

/**
 * Which product a URL points at, from the host.
 *
 * DERIVED, NOT CHOSEN. Asking somebody to pick "GitHub" from a dropdown after
 * they have already pasted a github.com URL is asking them to do the
 * computer's job twice. It drives the icon and nothing else, so an
 * unrecognized host falls through to 'link' and the row works perfectly.
 *
 * Matched on the registrable host rather than anywhere in the string: a
 * Notion page whose title contains "github" is not a GitHub link, and a
 * substring match on the whole URL says it is.
 */
const PROVIDER_HOSTS = [
  ["github", ["github.com", "gist.github.com"]],
  ["gitlab", ["gitlab.com"]],
  ["clay", ["clay.com", "app.clay.com"]],
  ["drive", ["drive.google.com", "docs.google.com", "sheets.google.com"]],
  ["salesforce", ["salesforce.com", "force.com", "lightning.force.com"]],
  ["hubspot", ["hubspot.com", "app.hubspot.com"]],
  ["notion", ["notion.so", "notion.site"]],
  ["slack", ["slack.com"]],
  ["linear", ["linear.app"]],
  ["figma", ["figma.com"]],
  ["airtable", ["airtable.com"]],
  ["jira", ["atlassian.net", "atlassian.com"]],
  ["dropbox", ["dropbox.com"]],
  ["sheets", ["smartsheet.com"]],
  ["looker", ["looker.com", "lookerstudio.google.com"]],
  ["bigquery", ["console.cloud.google.com"]],
];

export function providerFor(url) {
  let host;
  try {
    host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "link";
  }
  for (const [name, hosts] of PROVIDER_HOSTS) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return name;
  }
  return "link";
}

/**
 * http and https only, normalized.
 *
 * A connection is rendered as an anchor somebody clicks, so `javascript:` in
 * an href is a script running in the next person's session. The database has
 * the same CHECK; this one exists so the refusal is a sentence rather than a
 * constraint violation.
 */
export function cleanUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Everything linked for this scope.
 *
 * `groupId` null means the company's own connections. A group's view shows
 * BOTH — the company's places are every team's places, and a team that has to
 * navigate to another screen for the shared drive will keep pasting the link
 * into chat instead.
 */
export async function listConnections({ orgId, groupId = null, includeOrg = true } = {}) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT c.id, c.group_id, c.label, c.url, c.provider, c.note, c.position,
            c.created_at, c.created_by,
            u.full_name AS created_by_name,
            g.name AS group_name
       FROM org_connections c
       LEFT JOIN users u ON u.amber_id = c.created_by
       LEFT JOIN org_groups g ON g.org_id = c.org_id AND g.id = c.group_id
      WHERE c.org_id = $1
        AND (
          ($2::uuid IS NULL AND c.group_id IS NULL)
          OR ($2::uuid IS NOT NULL AND (c.group_id = $2 OR ($3::boolean AND c.group_id IS NULL)))
        )
      ORDER BY (c.group_id IS NULL) DESC, c.position, c.created_at`,
    [orgId, groupId, includeOrg],
  );
  return rows;
}

export async function addConnection({
  orgId, groupId = null, label, url, note = null, createdBy = null,
} = {}) {
  const name = String(label ?? "").trim();
  const href = cleanUrl(url);
  if (!orgId || !name) return { ok: false, reason: "bad_input" };
  if (!href) return { ok: false, reason: "bad_url" };

  try {
    const { rows } = await query(
      `INSERT INTO org_connections (org_id, group_id, label, url, provider, note, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               COALESCE((SELECT max(position) + 1 FROM org_connections
                          WHERE org_id = $1 AND group_id IS NOT DISTINCT FROM $2), 0),
               $7)
       RETURNING *`,
      [orgId, groupId, name.slice(0, 120), href, providerFor(href), note, createdBy],
    );
    return { ok: true, connection: rows[0] };
  } catch (err) {
    if (err?.code === "23503") return { ok: false, reason: "no_such_group" };
    return { ok: false, reason: "write_failed" };
  }
}

export async function updateConnection({ orgId, id, label, url, note, position } = {}) {
  if (!orgId || !id) return { ok: false, reason: "bad_input" };
  const href = url === undefined ? undefined : cleanUrl(url);
  if (url !== undefined && !href) return { ok: false, reason: "bad_url" };

  const { rows } = await query(
    `UPDATE org_connections
        SET label    = CASE WHEN $3::boolean THEN $4 ELSE label END,
            url      = CASE WHEN $5::boolean THEN $6 ELSE url END,
            provider = CASE WHEN $5::boolean THEN $7 ELSE provider END,
            note     = CASE WHEN $8::boolean THEN $9 ELSE note END,
            position = CASE WHEN $10::boolean THEN $11 ELSE position END,
            updated_at = now()
      WHERE org_id = $1 AND id = $2
      RETURNING *`,
    [
      orgId, id,
      label !== undefined, String(label ?? "").trim().slice(0, 120) || null,
      href !== undefined, href ?? null, href ? providerFor(href) : null,
      note !== undefined, note ?? null,
      position !== undefined, Number(position) || 0,
    ],
  );
  return rows[0] ? { ok: true, connection: rows[0] } : { ok: false, reason: "not_found" };
}

export async function removeConnection({ orgId, id } = {}) {
  if (!orgId || !id) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `DELETE FROM org_connections WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/* -------------------------------------------------------------- calendars */

/**
 * Which of this person's connected calendars they have shared into this group.
 *
 * Returned alongside EVERY calendar they have connected, so the UI can render
 * a list of switches rather than making somebody remember what they own. The
 * accounts come from calendar_accounts, which has held Google and Microsoft
 * grants since migration 046 — nothing new is connected here.
 */
export async function myCalendars({ orgId, groupId, amberId } = {}) {
  if (!orgId || !groupId || !amberId) return [];
  const { rows } = await query(
    `SELECT a.id, a.provider, a.account_email, a.display_name, a.last_error,
            a.synced_at,
            (s.calendar_account_id IS NOT NULL) AS shared,
            s.label AS shared_label
       FROM calendar_accounts a
       LEFT JOIN org_group_calendars s
         ON s.org_id = $1 AND s.group_id = $2 AND s.calendar_account_id = a.id
      WHERE a.owner_id = $3::uuid AND a.disabled_at IS NULL
      ORDER BY a.provider, a.account_email`,
    [orgId, groupId, amberId],
  );
  return rows;
}

/**
 * Share or unshare one calendar with one group.
 *
 * THE ACCOUNT IS CHECKED AGAINST THE CALLER, not taken on trust. Without it
 * this is an endpoint for publishing somebody else's calendar to a team by
 * guessing an id.
 */
export async function shareCalendar({
  orgId, groupId, amberId, calendarAccountId, label = null, on = true,
} = {}) {
  if (!orgId || !groupId || !amberId || !calendarAccountId) {
    return { ok: false, reason: "bad_input" };
  }

  if (!on) {
    await query(
      `DELETE FROM org_group_calendars
        WHERE org_id = $1 AND group_id = $2 AND amber_id = $3::uuid
          AND calendar_account_id = $4::uuid`,
      [orgId, groupId, amberId, calendarAccountId],
    );
    return { ok: true, shared: false };
  }

  const { rows: own } = await query(
    `SELECT 1 FROM calendar_accounts
      WHERE id = $1::uuid AND owner_id = $2::uuid AND disabled_at IS NULL`,
    [calendarAccountId, amberId],
  );
  if (own.length === 0) return { ok: false, reason: "not_yours" };

  try {
    await query(
      `INSERT INTO org_group_calendars (org_id, group_id, amber_id, calendar_account_id, label)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5)
       ON CONFLICT (org_id, group_id, calendar_account_id)
         DO UPDATE SET label = EXCLUDED.label`,
      [orgId, groupId, amberId, calendarAccountId, label],
    );
    return { ok: true, shared: true };
  } catch (err) {
    if (err?.code === "23503") return { ok: false, reason: "not_a_member" };
    return { ok: false, reason: "write_failed" };
  }
}

/**
 * THE TEAM'S WEEK: shared calendar events and the team's own, as one list.
 *
 * Both shapes are needed and they answer different questions. "When is the
 * retro" is an event somebody typed for the team; "is Maya free Thursday"
 * comes from Maya's shared calendar. A calendar with only one of the two is
 * either an empty scheduling tool or a read-only availability view.
 *
 * Nothing is copied. The shared half is a join through
 * org_group_calendars to the events already synced under that person's
 * account, so unsharing removes them from this view instantly and a calendar
 * that stops syncing says so through `last_error` rather than quietly
 * flattening into an empty week.
 */
export async function groupCalendar({ orgId, groupId, from, to, limit = 200 } = {}) {
  if (!orgId || !groupId) return [];
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date(start.getTime() + 28 * 24 * 60 * 60 * 1000);

  const { rows } = await query(
    `(
       SELECT e.id::text          AS id,
              'team'::text        AS kind,
              e.title,
              e.note,
              e.location,
              e.url,
              e.starts_at,
              e.ends_at,
              e.all_day,
              NULL::text          AS owner_name,
              NULL::text          AS calendar_label,
              e.created_by        AS owner_id,
              NULL::uuid          AS calendar_account_id
         FROM org_group_events e
        WHERE e.org_id = $1 AND e.group_id = $2 AND e.deleted_at IS NULL
          AND e.starts_at >= $3 AND e.starts_at < $4
     )
     UNION ALL
     (
       SELECT ev.event_id::text   AS id,
              'synced'::text      AS kind,
              ev.title,
              NULL::text          AS note,
              NULL::text          AS location,
              NULL::text          AS url,
              ev.starts_at,
              ev.ends_at,
              false               AS all_day,
              COALESCE(u.full_name, 'Someone') AS owner_name,
              COALESCE(s.label, a.display_name, a.account_email) AS calendar_label,
              s.amber_id          AS owner_id,
              /*
               * WHICH ACCOUNT, not just whose.
               *
               * One person can share three calendars with a team -- work,
               * interviews, the one their partner also writes to -- and
               * filtering by person cannot tell those apart. The client needs
               * the account to offer "show me Maya's work calendar and not
               * her other two", which is the whole reason somebody shares
               * more than one.
               */
              s.calendar_account_id
         FROM org_group_calendars s
         JOIN calendar_accounts a ON a.id = s.calendar_account_id AND a.disabled_at IS NULL
         JOIN events ev
           ON ev.calendar_account_id = s.calendar_account_id
          AND ev.owner_id = s.amber_id
          AND ev.deleted_at IS NULL
         LEFT JOIN users u ON u.amber_id = s.amber_id
        WHERE s.org_id = $1 AND s.group_id = $2
          AND ev.starts_at >= $3 AND ev.starts_at < $4
     )
     ORDER BY starts_at
     LIMIT $5`,
    [orgId, groupId, start.toISOString(), end.toISOString(), limit],
  );
  return rows;
}

/** An event the team created. Survives whoever typed it leaving. */
export async function addGroupEvent({
  orgId, groupId, title, note = null, location = null, url = null,
  startsAt, endsAt = null, allDay = false, createdBy = null,
} = {}) {
  const name = String(title ?? "").trim();
  if (!orgId || !groupId || !name || !startsAt) return { ok: false, reason: "bad_input" };
  const href = url ? cleanUrl(url) : null;
  if (url && !href) return { ok: false, reason: "bad_url" };

  try {
    const { rows } = await query(
      `INSERT INTO org_group_events
         (org_id, group_id, title, note, location, url, starts_at, ends_at, all_day, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [orgId, groupId, name.slice(0, 200), note, location, href,
       startsAt, endsAt, Boolean(allDay), createdBy],
    );
    return { ok: true, event: rows[0] };
  } catch (err) {
    if (err?.code === "23514") return { ok: false, reason: "bad_range" };
    if (err?.code === "23503") return { ok: false, reason: "no_such_group" };
    return { ok: false, reason: "write_failed" };
  }
}

export async function removeGroupEvent({ orgId, id } = {}) {
  if (!orgId || !id) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE org_group_events SET deleted_at = now()
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, id],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}
