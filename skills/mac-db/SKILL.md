---
name: mac-db
description: "Read and write any database macOS keeps on this Mac with one command. Messages, call history, contacts, Mail, Notes with full text, Calendar, Reminders, Safari and Chrome history, Photos, Voice Memos, Podcasts, downloads, CoreDuet interactions, Screen Time, knowledgeC and Biome streams. Use when asked to add, change or delete something in an Apple app (note, reminder, event, contact, history row), who called, what he browsed, what he downloaded, what a note says, what's on the calendar, who he talks to most, what he did on the Mac at some time, or to answer any question the Mac already logged. Also fires on: call history, browser history, chrome history, safari history, my notes, voice memos, photos from, downloads, biome, knowledgeC, interactionC, what was I doing, when did I, sqlite on the mac."
---

# mac-db

`bin/mac-db` reads and writes the databases macOS keeps about him. Run it
before saying something can't be known or changed, and before driving an app's
UI for data the app already stored.

    mac-db stores                         what's readable, rows, newest entry
    mac-db calls --days 3                 any store; --days 0 = all time
    mac-db chrome --search clay -n 20     --search matches the text columns
    mac-db notes  then  mac-db note <id>  full note text, decoded
    mac-db calendar --ahead 30            future events
    mac-db biome  then  mac-db biome App.InFocus
    mac-db schema mail                    columns, to write a query
    mac-db sql mail "select ..."          any statement; a write snapshots first
    mac-db backups / restore <name>       undo a raw write
    mac-db notes add "Title" --body ...   app writes: notes add|append|edit|delete,
    mac-db reminders add "x" --due fri      reminders add|complete, calendar add|edit,
                                          contacts add, messages send
    mac-db biome <Stream> --clear         wipe a stream, backup kept

Every row has a local time; phones and emails in calls, messages and
interactions come back with `who_name` from Contacts. `--json` for values.

## Never do

- Never answer "I can't see that" about something on this Mac before running
  `mac-db stores`. On 2026-10-09 Caleb asked "Is chewbs a master at pulling
  from any database the mac has? Like screen time", the honest answer was 5 of
  17, and his reply was "LOCK IN BE A MASTER OF ALL OF THEM".
- Never call any of it read-only. 2026-10-10, on the first version: "NOTHING
  on chewb should ever be read only that is stupid". It writes.
- For anything iCloud syncs (Notes, Reminders, Calendar, Contacts, Messages),
  write with the app verb, not `sql`: the app verb syncs like a tap, and a raw
  row edit gets overwritten by the next sync. `sql` writes are for local stores
  (history, downloads, knowledgeC) or when the app has no verb for it.
- A raw write that says "locked" means the owning app holds the file (Chrome
  does while it runs); quit it and rerun. The backup is already taken.
- Never write a Reminders change through one API and undo it through another.
  2026-10-11, the MCP writes night ("Never read only, find a way to write
  too"): a tick through `mac` (EventKit) and an untick through AppleScript
  left the reminder done after its undo. The `mac` id is a bare UUID, and
  AppleScript only finds `x-apple-reminder://<UUID>`. Any new app write runs
  once live on a throwaway item and gets read back before it's called done;
  a fake that accepts every id passed both bugs.
- From an MCP agent, writes go through `kit_write` (undo id back) and sends
  through a draft plus `kit_confirm`; `config/data/mcp-writes.json` lists them.
- Sends follow CHEWBACCA_NO_SEND: set, `messages send` only prints.
- Never paste raw rows from Messages, Mail or Notes into anything that leaves
  the Mac. Summarize, and only what the task needs.
- Calendar repeating events show once, at their first date: Apple's
  OccurrenceCache on this Mac stopped at 2026-05-11, so it isn't used. Say so
  when an answer depends on a repeating event.
- For texting work (who he owes, drafts, sending), `people texts` and the
  `texts` skill own it. mac-db messages is the raw read.
