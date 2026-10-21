-- F4c: intro requests — the ONLY cross-user contact-method release path. A
-- requester asks the owner of a contact for an introduction; the phone/email is
-- released only after the owner approves. Idempotent.

CREATE TABLE IF NOT EXISTS intro_requests (
  id                  bigserial   PRIMARY KEY,
  requester_amber_id  uuid        NOT NULL,
  owner_amber_id      uuid        NOT NULL,
  contact_id          bigint      NOT NULL,   -- the owner's contact the requester wants to reach
  message             text,
  status              text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','declined')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  responded_at        timestamptz,
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS intro_requests_owner_status_idx
  ON intro_requests (owner_amber_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS intro_requests_requester_status_idx
  ON intro_requests (requester_amber_id, status) WHERE deleted_at IS NULL;

-- No duplicate pending asks for the same (requester, owner, contact).
CREATE UNIQUE INDEX IF NOT EXISTS intro_requests_pending_uidx
  ON intro_requests (requester_amber_id, owner_amber_id, contact_id)
  WHERE status = 'pending' AND deleted_at IS NULL;
