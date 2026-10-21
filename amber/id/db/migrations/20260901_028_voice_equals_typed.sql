-- SPEAKING A FACT AND TYPING IT ARE THE SAME FACT.
--
-- Migration 006 set source_voice_note to 0.90 and source_told_directly to 1.00,
-- and 027 followed that precedent by giving soundboard 0.90. The reasoning was
-- "transcription can mishear". That is real, but it is not what this column is
-- for: `confidence` on the observation already carries how sure we are of the
-- CONTENT. scoring_params.source_* carries how much we trust the CHANNEL, and a
-- person telling us something is a person telling us something whether their
-- thumbs or their mouth did it.
--
-- Karthik's call, and he is right: "just because someone types it versus voices
-- it doesn't mean it should be weighted differently." Discounting voice by 10%
-- also quietly penalises the surface the product is built around.
--
-- UPDATE, not INSERT ... ON CONFLICT DO NOTHING, because both rows already exist
-- and DO NOTHING would leave them exactly as they are -- which is the kind of
-- migration that runs clean and changes nothing.

UPDATE scoring_params SET value = 1.00,
  note = 'Voice capture (chat.js soundboard surface). Same weight as typed: the '
         'channel does not change how much the person meant it.'
 WHERE key = 'source_soundboard';

UPDATE scoring_params SET value = 1.00,
  note = 'A spoken note. Same weight as typed — see 028. Content confidence lives '
         'on observations.confidence, not here.'
 WHERE key = 'source_voice_note';

-- source_circle stays at 0.90 and that is a DIFFERENT judgement, not an oversight:
-- it is not about voice versus typing, it is about a fact stated to a group rather
-- than told to us. Change it if that distinction turns out not to matter either.
