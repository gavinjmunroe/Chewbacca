-- ============================================================================
-- THE TWO THINGS A TEAM NEEDS BESIDE ITS MESSAGES: WHERE ITS WORK LIVES, AND
-- WHEN IT IS HAPPENING.
--
-- A group in this product could talk, keep files and list its members, and a
-- real team's working context is neither of those. It is a short list of
-- places the work actually lives -- the repo, the Clay workspace, the shared
-- drive, the CRM -- and a calendar that says what the week looks like.
--
-- Both are the same shape of problem: information that already exists
-- somewhere else, which the team keeps re-finding and re-pasting.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CONNECTIONS: where this team's work lives.
--
-- A LINK, NOT AN INTEGRATION, AND THE DIFFERENCE IS DELIBERATE. A row here is
-- a URL with a name on it. It does not hold a token, call an API, or sync
-- anything, and that is what makes it useful on day one: a team can write
-- down its six places in a minute, with no OAuth consent screen and no admin
-- approval, and stop pasting the same repo link into chat every week.
--
-- `provider` is DERIVED FROM THE URL rather than chosen from a dropdown,
-- because asking somebody to classify github.com is asking them to do the
-- computer's job. It drives the icon and nothing else, so an unrecognized
-- host is 'link' and still works perfectly.
--
-- `scope` is how the same table serves both the company and one group. An
-- org-level connection is every team's (the HR drive, the company Notion); a
-- group-level one belongs to that group. Two tables would be two sets of
-- routes, two UIs and one of them forgotten.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_connections (
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  group_id    uuid        NULL,
  label       text        NOT NULL,
  url         text        NOT NULL,
  provider    text        NOT NULL DEFAULT 'link',
  note        text        NULL,
  -- Hand ordering. A team's six places have an order somebody cares about and
  -- it is never alphabetical.
  position    int         NOT NULL DEFAULT 0,
  created_by  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_connections_group_fk
    FOREIGN KEY (org_id, group_id)
    REFERENCES org_groups (org_id, id) ON DELETE CASCADE,

  -- http/https only. A link row is rendered as an anchor somebody clicks, and
  -- javascript: in an href is a script running in the next person's session.
  CONSTRAINT org_connections_url_shape
    CHECK (url ~* '^https?://'),

  CONSTRAINT org_connections_label_shape
    CHECK (btrim(label) <> '')
);

CREATE INDEX IF NOT EXISTS org_connections_scope_idx
  ON org_connections (org_id, group_id, position);

-- ---------------------------------------------------------------------------
-- THE TEAM CALENDAR, BUILT OUT OF CALENDARS THAT ALREADY EXIST.
--
-- calendar_accounts has held connected Google and Microsoft calendars, with
-- their tokens and their incremental sync cursors, since migration 046. Every
-- synced event already lands in `events` carrying the calendar_account_id it
-- came from.
--
-- So a shared team calendar does NOT need a copy of anybody's events. It
-- needs one fact: "this person has chosen to show THIS calendar to THIS
-- group". The read is then a join, and it has three properties worth having:
--
--   * nothing is duplicated, so nothing can go stale;
--   * revoking is one DELETE and the events vanish from the team view
--     immediately, because they were never copied anywhere;
--   * somebody with three calendars shares the two that are the team's
--     business and keeps the third to themselves, which is the actual
--     request -- a person with one all-or-nothing switch shares nothing.
--
-- WHAT IS NOT HERE: any notion of the group "owning" the calendar. The
-- account stays the person's, the tokens stay theirs, and leaving the group
-- ends the sharing without touching the connection.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_group_calendars (
  org_id              uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  group_id            uuid        NOT NULL,
  amber_id            uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  calendar_account_id uuid        NOT NULL REFERENCES calendar_accounts (id) ON DELETE CASCADE,
  -- What the team sees this calendar called. Somebody's three calendars are
  -- "Work", "Interviews" and "Personal" to them and all three are their email
  -- address to everybody else.
  label               text        NULL,
  shared_at           timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, group_id, calendar_account_id),

  CONSTRAINT org_group_calendars_group_fk
    FOREIGN KEY (org_id, group_id)
    REFERENCES org_groups (org_id, id) ON DELETE CASCADE,

  -- Only a member of the company can share into one of its groups.
  CONSTRAINT org_group_calendars_member_fk
    FOREIGN KEY (org_id, amber_id)
    REFERENCES org_members (org_id, amber_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS org_group_calendars_group_idx
  ON org_group_calendars (org_id, group_id);

-- ---------------------------------------------------------------------------
-- EVENTS THE TEAM CREATES ITSELF.
--
-- Separate from `events`, which is owner-scoped personal data with contact and
-- circle foreign keys on it. A team's standup belongs to the team, not to
-- whoever typed it, and must survive that person leaving -- which an
-- owner-scoped row with ON DELETE CASCADE does not.
--
-- The group calendar renders the union of these and the shared ones. Both
-- shapes are needed: "when is the retro" is written here, and "is Maya free
-- Thursday" comes from her shared calendar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_group_events (
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  group_id    uuid        NULL,
  title       text        NOT NULL,
  note        text        NULL,
  location    text        NULL,
  url         text        NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NULL,
  all_day     boolean     NOT NULL DEFAULT false,
  created_by  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_group_events_group_fk
    FOREIGN KEY (org_id, group_id)
    REFERENCES org_groups (org_id, id) ON DELETE CASCADE,

  CONSTRAINT org_group_events_range_chk
    CHECK (ends_at IS NULL OR starts_at <= ends_at),

  CONSTRAINT org_group_events_title_shape
    CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS org_group_events_window_idx
  ON org_group_events (org_id, group_id, starts_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- All three join the tenant policy. A table outside it is the one place a
-- cross-company read could come from.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_connections', 'org_group_calendars', 'org_group_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS amber_tenant ON %I', t);
    EXECUTE format($f$
      CREATE POLICY amber_tenant ON %I
        USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
        WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
    $f$, t);
  END LOOP;
END $$;
