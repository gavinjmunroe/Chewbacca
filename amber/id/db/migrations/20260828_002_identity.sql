-- IDENTITY, CONTACTS AND CIRCLES -- ported from the live tables, not replaced.
--
-- The first draft of these three replaced 40-column tables with 11-column ones I
-- had designed from the product model. Measured against the code, that was wrong:
-- src/ references full_name 147 times, emails 236, c.id 110, tags 72,
-- phone_primary 65, external_id 70. Replacing the shape would have meant editing
-- roughly eight hundred call sites to gain nothing the real fix needs.
--
-- So every column survives. What changes is only what has to:
--
--   id           bigserial -> uuid. The one change that forces the retype pass,
--                and the reason uuid rather than bigint is that ids stop being
--                guessable by construction.
--   owner_id     uuid NOT NULL with a real foreign key to users. It was nullable
--                with no constraint, which is how a row could end up owned by
--                nobody.
--   UNIQUE (owner_id, id)
--                the target every composite foreign key in the schema points at.
--                This is the single line that makes a row whose owner disagrees
--                with its parent's owner impossible to write.
--
-- THE PRIMARY KEY STAYS NAMED `id`. Renaming it to contact_id would have been
-- tidier and would have broken 110 references for the sake of a word. Child
-- tables still call their column contact_id; a foreign key does not require the
-- names to match.

CREATE TABLE users (
  amber_id                   uuid DEFAULT gen_random_uuid() NOT NULL,
  phone                      text NOT NULL,
  full_name                  text,
  handle                     text,
  auth0_sub                  text,
  status                     text DEFAULT 'pending'::text NOT NULL,
  created_at                 timestamptz DEFAULT now() NOT NULL,
  updated_at                 timestamptz DEFAULT now() NOT NULL,
  deleted_at                 timestamptz,
  current_city               text,
  occupation                 text,
  bio                        text,
  mbti                       text,
  school                     text,
  hometown                   text,
  horoscope                  text,
  avatar_url                 text,
  privacy_tier               text,
  onboarding_completed_at    timestamptz,
  timezone                   text,
  username                   text,
  privy_did                  text,
  loop_sender_id             text,
  tenant_metadata            jsonb,
  profile_extra              jsonb,
  person_id                  text,
  discoverable               boolean NOT NULL DEFAULT false,
  contacts_synced_at         timestamptz,
  CONSTRAINT users_pkey PRIMARY KEY (amber_id),
  CONSTRAINT users_phone_key UNIQUE (phone),
  CONSTRAINT users_handle_key UNIQUE (handle)
);

CREATE INDEX users_privy_did_idx ON users (privy_did) WHERE privy_did IS NOT NULL;
CREATE INDEX users_person_id_idx ON users (person_id) WHERE person_id IS NOT NULL;

-- HOW YOU LOG IN. One row per external identity, so adding Apple Sign-In later
-- is an INSERT rather than a migration. privy_did stays on users as well, because
-- fifteen routes read it there and breaking them buys nothing today.
CREATE TABLE user_identities (
  provider    text        NOT NULL CHECK (provider IN ('privy','apple','google','phone','wallet')),
  subject     text        NOT NULL,
  amber_id    uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identities_amber_idx ON user_identities (amber_id);

-- HOW OTHERS FIND YOU. The only globally-indexed identity table in the system,
-- and it holds ONLY accounts that opted in -- never contacts, never people who
-- have not signed up. key_hash is HMAC(server pepper, E.164 or lowercased email)
-- truncated to 128 bits, with the pepper in KMS and never in this database, so a
-- stolen backup yields hashes that cannot be reversed. It does NOT make discovery
-- private against a compromised server, and the privacy policy should say so.
CREATE TABLE discovery_keys (
  key_hash   bytea       PRIMARY KEY,
  key_type   smallint    NOT NULL CHECK (key_type IN (1, 2)),
  amber_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_keys_len_chk CHECK (octet_length(key_hash) = 16)
);
CREATE INDEX discovery_keys_amber_idx ON discovery_keys (amber_id);
