-- THE TWO SOURCES ADDED THIS WEEK ARE SCORING 0.5 BY DEFAULT.
--
-- contact_dimension_state multiplies every observation's contribution by
--
--     COALESCE((SELECT value FROM scoring_params WHERE key = 'source_' || o.source), 0.5)
--
-- so a source string with no row is not an error. It is quietly average, forever
-- -- which is the same trap migration 027 was written to close, and two new
-- writers have walked into it since:
--
--   dm         src/db/interaction-observations.js -- both sides of a direct
--              message inside Amber, filed for sender and recipient
--   reminder   src/db/reminder-observations.js -- the intention behind a
--              reminder about a person
--
-- WHAT EACH ONE IS WORTH, and these are judgements, stated so they can be argued
-- with rather than discovered later in a query plan:
--
--   source_dm = 0.60, matching source_imessage and source_imessage_dm. It is a
--   real message between two real people, but the FACT is inferred from
--   conversation rather than told to us: "I'm moving to Denver" in a thread is
--   evidence, not a statement made to Amber. The precedent is already set at
--   0.60 for exactly this kind of evidence, and a DM inside Amber is not more
--   trustworthy than the same sentence over iMessage.
--
--   source_reminder = 1.00, matching source_manual and source_app_chat, and this
--   one deserves its argument. A reminder is TYPED BY THE OWNER, deliberately,
--   about a person they picked -- that is as first-hand as it gets, and the
--   channel is what this column measures. What makes a reminder weaker evidence
--   is not the channel, it is that it describes an INTENTION rather than
--   something that happened, and that is already carried elsewhere: the
--   observation is written with modality 'planned', which the dimension
--   classifier and the ranker both read. Discounting it here as well would
--   penalise it twice for the same reason -- the mistake migration 028 corrected
--   for voice.
--
-- ON CONFLICT DO NOTHING so re-running never overwrites a weight somebody tuned.

INSERT INTO scoring_params (key, value, note) VALUES
  ('source_dm',       0.60, 'A direct message in Amber. Matches source_imessage: inferred from conversation, not told to us.'),
  ('source_reminder', 1.00, 'The owner typed it about a person they picked. Its being an intention is carried by modality=planned, not by this weight.')
ON CONFLICT (key) DO NOTHING;
