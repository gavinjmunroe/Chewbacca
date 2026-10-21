-- THE SIX SOURCES THE CUTOVER FOUND, AND WHY THEY GET WEIGHTS INSTEAD OF RENAMES.
--
-- contact_dimension_state multiplies every observation's contribution by
--
--     COALESCE((SELECT value FROM scoring_params WHERE key = 'source_' || o.source), 0.5)
--
-- so a source string with no row scores 0.5 -- not an error, just quietly average,
-- forever. Migration 006 seeded five: told_directly, voice_note, imessage,
-- enrichment, manual. The live data uses six others, 243 rows in total, and every
-- one of them has been scoring 0.5:
--
--     soundboard    161    app_chat  55    app_favorite  17
--     circle          5    contact_note 4  imessage_dm    1
--
-- THE ALTERNATIVE WAS REWRITING THE STRINGS, and it is worse. Mapping soundboard
-- to voice_note in the migration script would make 161 rows claim they came from
-- somewhere they did not. `source` is provenance: it should say where a fact
-- actually entered the system, and scoring_params should say how much that entry
-- point is trusted. Two different questions, two different columns. Adding the
-- rows also fixes the observations ALREADY written, with no data rewrite at all.
--
-- WHAT EACH ONE IS, from the code rather than from memory:
--
--   soundboard    src/routes/chat.js:1958 -- `body.source === "soundboard"` is the
--                 VOICE surface, and line 1959 sets isVoice from it. Same
--                 provenance as voice_note: a person spoke and we transcribed it.
--                 0.90, matching voice_note, because transcription can mishear.
--
--   app_chat      the same route's other branch: typed by the person, in the app.
--                 That is told_directly, so 1.00.
--
--   contact_note  a note the owner wrote on a contact by hand. Also 1.00.
--
--   app_favorite  the owner deliberately favourited someone. A user action, not an
--                 inference. 1.00.
--
--   circle        stated in a circle context. Still first-hand, but about a group
--                 rather than to us specifically, so 0.90.
--
--   imessage_dm   a direct message. Same trust as imessage, which migration 006 set
--                 at 0.60: real, but we are inferring meaning from conversation
--                 rather than being told a fact.
--
-- ON CONFLICT DO NOTHING so re-running never overwrites a weight somebody tuned.

INSERT INTO scoring_params (key, value, note) VALUES
  ('source_soundboard',   0.90, 'Voice capture (chat.js soundboard surface). Same as voice_note: spoken, transcribed.'),
  ('source_app_chat',     1.00, 'Typed by the owner in the app. Told directly.'),
  ('source_contact_note', 1.00, 'A note the owner wrote on a contact by hand.'),
  ('source_app_favorite', 1.00, 'The owner favourited someone. A deliberate action, not an inference.'),
  ('source_circle',       0.90, 'Stated in a circle context — first-hand, but to a group.'),
  ('source_imessage_dm',  0.60, 'A direct message. Matches source_imessage: inferred from conversation.'),

  -- THE IMPORT PROVIDERS. These used to be RENAMED to 'enrichment' by the cutover
  -- script, which lost which importer a contact actually came from -- the one
  -- thing you want when an import turns out to be wrong. They keep their names and
  -- get enrichment's weight. Split them apart later if one proves less reliable
  -- than another; that is a scoring_params edit, not a data migration.
  ('source_google',       0.40, 'Google Contacts import. Enrichment-grade: a field, not a statement.'),
  ('source_apple',        0.40, 'Apple Contacts import.'),
  ('source_linkedin',     0.40, 'LinkedIn import.'),
  ('source_clay',         0.40, 'Clay enrichment.'),
  ('source_chat',         1.00, 'Typed by the owner in chat. Predates the app_chat spelling.'),
  ('source_note',         1.00, 'A note the owner wrote. Predates the contact_note spelling.'),
  ('source_user',         1.00, 'Stated by the owner.'),
  ('source_import',       1.00, 'A bulk import the owner initiated.')
ON CONFLICT (key) DO NOTHING;
