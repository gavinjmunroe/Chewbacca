-- ---------------------------------------------------------------------------
-- EVERY NAME ANYBODY HAS EVER BEEN CALLED, BESIDE THE ADDRESS THAT CARRIED IT.
--
-- One Gmail thread with five people on it names all five, in the headers:
--   From: Ipsha Pandey <i.pandey@pnptc.com>
--   To: "Ryan, Jason" <jryan4@paychex.com>, "Vance, Beaumont" <bvance@...>
--   Cc: Nate Hinman <nate@pnptc.com>, Amit Patel <amit@pnptc.com>
--
-- All of that was read, used to decide who the message was with, and thrown
-- away. The name survived only if the sync happened to CREATE a contact card
-- for that address, which it does only past a message-count threshold and
-- never when a card already existed. So the people most clearly named -- the
-- ones on a single important introduction -- were exactly the ones left as
-- addresses, and a graph of thirteen people showed eleven of them as mailbox
-- strings.
--
-- A name is cheap. It is not personal data the ledger was avoiding: the
-- address was already stored. Keeping it costs one row and removes the entire
-- class of "we have the information and do not show it".
--
-- KEYED BY OWNER, because a name is something one mailbox observed. Two
-- people may know the same address under different names and both are true.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observed_names (
  owner_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  email      text        NOT NULL,
  name       text        NOT NULL,

  -- 'mail' | 'calendar' | 'directory'. Which wire carried it, so a later
  -- ranking can prefer one without re-reading the provider.
  source     text        NOT NULL DEFAULT 'mail',

  -- How many times this spelling has been seen, which settles a one-off
  -- "sagar (guest)" against the hundred messages signed "Sagar Tiwari".
  seen       int         NOT NULL DEFAULT 1,

  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (owner_id, email, name),

  CONSTRAINT observed_names_shape
    CHECK (btrim(email) <> '' AND btrim(name) <> '' AND email LIKE '%@%')
);

-- The only read: every name this owner has seen, or the names for one address.
CREATE INDEX IF NOT EXISTS observed_names_email_idx
  ON observed_names (email, seen DESC);
