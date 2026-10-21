-- Repair every one of Amber's replies that was written as the user's own message.
--
-- src/db/csql-conversation-store.js coerced any role it did not recognise to
-- 'user', and every reply in routes/chat.js passes role:"assistant". So since
-- the conversations cutover, every assistant row in this table has role='user'.
-- The store is fixed; this repairs what it already wrote, because otherwise
-- every existing note reopens as a wall of gold bubbles with no answer under
-- them, and the model keeps being fed its own words back as the user's.
--
-- THE PREDICATE IS EXACT, not a heuristic. There is exactly one user append in
-- the whole codebase (routes/chat.js, the transcript) and its metadata is
-- {source}. Every assistant append -- all nine of them -- passes metadata
-- containing `model`. So a row that claims to be from the user while carrying
-- the name of the model that wrote it is, with certainty, Amber's.
--
-- Rows with no metadata are left alone: those predate the field, and there is
-- nothing to tell them apart with. Guessing would be worse than leaving them.

-- The runner wraps each file in its own transaction (scripts/migrate.js), so
-- there is deliberately no BEGIN/COMMIT here.

UPDATE conversation_messages
   SET role = 'amber'
 WHERE role = 'user'
   AND metadata IS NOT NULL
   AND metadata ? 'model';
