-- ============================================================================
-- TWO WORKSPACES, TWO ACCOUNTS, AND NOTHING IN BETWEEN.
--
-- This migration exists because of a specific bug, and the bug is worth writing
-- down because the shape of it will come back otherwise.
--
-- Creating an organization added an org_members row for THE ACCOUNT THAT ASKED.
-- So somebody signs in with the phone number they use for their own Amber --
-- their friends, their family, five thousand contacts out of their address book
-- -- clicks "set up my company", and that personal account IS the company
-- account now. Their personal relationship graph renders inside the company
-- console. Their private contacts are the company's rows. Nothing was copied
-- and nothing was leaked, which is almost worse: the account simply changed
-- what it was, silently, because of one button.
--
-- THE MODEL IS A WORKSPACE PICKER, NOT A PROMOTION. One human may hold a
-- personal Amber and a work Amber. They are different accounts with different
-- amber_ids, different contacts, different everything, and the human moves
-- between them the way they move between two Notion workspaces. No row is
-- shared, no graph is merged, and there is no operation anywhere that turns one
-- into the other.
--
--   PERSONAL  is the consumer product: the iOS app, the personal web views,
--             synced from a phone's address book, keyed on a phone number.
--             The app only ever sees this one.
--   WORK      is the enterprise product: created by a work email, lives on the
--             website, belongs to a company, governed by that company's
--             ceiling. The app does not see it at all.
--
-- `workspace_kind` is how an account says which it is, and it is immutable in
-- practice: there is deliberately no route that changes it. An account that
-- wants to be the other kind is a different account.
--
-- EVERY EXISTING ACCOUNT IS PERSONAL. That is the correct backfill -- every one
-- of them was created by a phone OTP from the app or the consumer website --
-- and it also un-does the bug: an account that was wrongly enrolled in a
-- company reads as personal again, and the org routes refuse it.
-- ============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workspace_kind text NOT NULL DEFAULT 'personal';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_workspace_kind_check;
ALTER TABLE users ADD CONSTRAINT users_workspace_kind_check
  CHECK (workspace_kind IN ('personal', 'work'));

COMMENT ON COLUMN users.workspace_kind IS
  'Which product this account IS. personal = the app and the consumer web
   views, keyed on a phone. work = the enterprise website, created by a work
   email, belongs to a company. Nothing converts between them; a person who
   wants both has two accounts.';

CREATE INDEX IF NOT EXISTS users_work_idx
  ON users (workspace_kind) WHERE workspace_kind = 'work' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- THE SWITCHER, AND THE ONLY THING THAT CROSSES.
--
-- When the same human proves they hold both accounts -- the phone number on
-- their personal account, verified again from inside their work one -- the two
-- are linked. The link grants EXACTLY ONE THING: the other workspace appears in
-- the picker and a session can be minted for it.
--
-- IT IS NOT A JOIN AND IT MUST NEVER BECOME ONE. No read path consults this
-- table. No contact, note, share, graph edge or feed row is reachable across
-- it. If a future query joins through account_links to show somebody their
-- personal contacts inside a company, that is this migration's bug coming back
-- wearing a new table.
--
-- Rows are symmetric and written in pairs, so "what else can this account open"
-- is one indexed lookup from either side rather than an OR across two columns.
--
-- `linked_via` records what proved it. Today that is always a phone OTP
-- answered while holding a session for the other account, which is the only
-- evidence that actually demonstrates one human holds both.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_links (
  amber_id        uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  linked_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  linked_via      text        NOT NULL DEFAULT 'phone'
                              CHECK (linked_via IN ('phone', 'email')),
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (amber_id, linked_amber_id),

  -- An account linked to itself would put a workspace in its own picker.
  CONSTRAINT account_links_not_self CHECK (amber_id <> linked_amber_id)
);

CREATE INDEX IF NOT EXISTS account_links_reverse_idx ON account_links (linked_amber_id);

COMMIT;
