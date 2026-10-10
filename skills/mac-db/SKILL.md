---
name: mac-db
description: "Read any database macOS keeps on this Mac, directly and read-only, with one command. Messages, call history, contacts, Mail, Notes with full text, Calendar, Reminders, Safari and Chrome history, Photos, Voice Memos, Podcasts, downloads, CoreDuet interactions, Screen Time, knowledgeC and Biome streams. Use when asked who called, what he browsed, what he downloaded, what a note says, what's on the calendar, who he talks to most, what he did on the Mac at some time, or to answer any question the Mac already logged. Also fires on: call history, browser history, chrome history, safari history, my notes, voice memos, photos from, downloads, biome, knowledgeC, interactionC, what was I doing, when did I, sqlite on the mac."
---

# mac-db

`bin/mac-db` reads the databases macOS writes about him. Run it before saying
something can't be known, and before driving an app's UI to read data the app
already stored.

    mac-db stores                         what's readable, rows, newest entry
    mac-db calls --days 3                 any store; --days 0 = all time
    mac-db chrome --search clay -n 20     --search matches the text columns
    mac-db notes  then  mac-db note <id>  full note text, decoded
    mac-db calendar --ahead 30            future events
    mac-db biome  then  mac-db biome App.InFocus
    mac-db schema mail                    columns, to write a query
    mac-db sql mail "select ..."          anything else, still read-only

Every row has a local time; phones and emails in calls, messages and
interactions come back with `who_name` from Contacts. `--json` for values.

## Never do

- Never answer "I can't see that" about something on this Mac before running
  `mac-db stores`. On 2026-10-09 Caleb asked "Is chewbs a master at pulling
  from any database the mac has? Like screen time", the honest answer was 5 of
  17, and his reply was "LOCK IN BE A MASTER OF ALL OF THEM".
- Never write to these files. Every store opens read-only and `sql` refuses
  writes; don't work around that with the sqlite3 CLI.
- Never paste raw rows from Messages, Mail or Notes into anything that leaves
  the Mac. Summarize, and only what the task needs.
- Calendar repeating events show once, at their first date: Apple's
  OccurrenceCache on this Mac stopped at 2026-05-11, so it isn't used. Say so
  when an answer depends on a repeating event.
- For texting work (who he owes, drafts, sending), `people texts` and the
  `texts` skill own it. mac-db messages is the raw read.
