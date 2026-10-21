-- WHEN A REMINDER STARTS, WHICH IS NOT THE SAME AS WHEN IT WAS SET.
--
-- "Remind me tomorrow and Sunday to find a place for deep work" produced an
-- untimed reminder that showed up on EVERY day -- including today, which the
-- user did not ask for, and including last Saturday, which is nonsense. An
-- untimed reminder had only two bounds: repeat (which day of the week it falls
-- on) and repeat_until (when it stops). Nothing said when it BEGINS.
--
-- A LOCAL DATE, NOT A TIMESTAMP, and that is deliberate. The obvious version of
-- this is `created_at::date <= $onDate`, and it is wrong every evening west of
-- Greenwich: a reminder set at 9pm in New York has a created_at whose UTC date
-- is already tomorrow, so it would be hidden on the very day it was set. The
-- client knows what day it is where the user is standing; it sends that date and
-- we store it as a date.
--
-- NULL MEANS "from whenever", which is what every reminder written before this
-- migration meant, so the backfill is no backfill at all.
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS starts_on date;

COMMENT ON COLUMN reminders.starts_on IS
  'First LOCAL date this reminder appears at the top of Notes & Journal. NULL = no lower bound. Paired with repeat_until, which is the upper one.';
