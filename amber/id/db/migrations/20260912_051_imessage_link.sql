-- A PHONE NUMBER ON AN INBOUND TEXT IS A CLAIM, NOT A CREDENTIAL.
--
-- The Photon webhook resolved the sender straight to an account:
--
--     let user = await getUserByPhone(senderE164);
--     ownerId = user?.amber_id;
--
-- and with DM_ENROLLMENT_OPEN=true nothing stood in front of that. Everything
-- downstream -- the contact graph, the notes, the research, and soon the write
-- paths -- keys off ownerId. So the whole of an account's identity rested on a
-- string in a webhook body that this service has no way to verify. Apple's
-- registration makes that string hard to forge in the ordinary case, but "hard
-- to forge" is not the same as "we checked", and it is not a thing we control.
--
-- WHAT THIS ADDS IS CONSENT, NOT VERIFICATION, because consent is the part we
-- can actually establish. The owner, signed in to the app on a session that
-- already proved this phone, arms the channel. Until they do, an inbound text
-- cannot drive their account -- it gets told how to turn it on, and nothing
-- else. Verification of the handle itself stays Apple's job; what stops being
-- true is that a bare claim is enough.
--
-- TWO COLUMNS, NOT A BOOLEAN, and the second one is the point. Pinning the link
-- to the exact number it was armed for means a later change of phone number
-- does not silently carry the channel over to a number nobody consented for.
-- Re-arming after a number change is one tap; inheriting a stranger's channel
-- is not recoverable.
--
-- They move as a unit or not at all. Two nullable columns that are supposed to
-- agree will eventually disagree -- the reminders repeat trio taught us that in
-- production -- so the database refuses the halfway state rather than leaving a
-- row that reads as linked-to-nothing.

ALTER TABLE users ADD COLUMN IF NOT EXISTS imessage_linked_at    timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS imessage_linked_phone text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_imessage_link_chk'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_imessage_link_chk
      CHECK ((imessage_linked_at IS NULL) = (imessage_linked_phone IS NULL));
  END IF;
END
$$;

COMMENT ON COLUMN users.imessage_linked_at IS
  'When the owner armed the iMessage channel from an authenticated app session. NULL = an inbound text from this account''s phone may not drive it.';
COMMENT ON COLUMN users.imessage_linked_phone IS
  'The exact E.164 the channel was armed for. The webhook requires an inbound sender to equal this, so changing your number requires re-arming.';

-- THE ONLY ACCOUNTS GRANDFATHERED IN ARE THE ONES iMESSAGE ITSELF CREATED.
--
-- status='awaiting_name' is written in exactly one place in the codebase --
-- the Photon enroll path -- so it is a reliable marker for "this account exists
-- only because somebody texted Amber from this number". There is no app account
-- behind it to protect and no prior owner to surprise; gating it would lock a
-- half-enrolled person out of the flow they are standing in the middle of.
--
-- Everyone else stays unlinked on purpose, including the numbers currently in
-- ALLOWED_TEST_NUMBERS. An allowlist entry is our decision about a number; this
-- column is the account owner's decision about their account, and quietly
-- writing the second one from the first would make the whole gate theater.
UPDATE users
   SET imessage_linked_at    = now(),
       imessage_linked_phone = phone
 WHERE status = 'awaiting_name'
   AND deleted_at IS NULL
   AND imessage_linked_at IS NULL
   AND phone LIKE '+%';
