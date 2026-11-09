---
name: project_mac_db
description: mac-db reads and writes every Apple database on the Mac (17 stores incl. Biome); screen-time charts usage; what was verified 2026-10-09/10 and the traps found
metadata:
  type: project
---

`bin/mac-db` (527d6d4d) and `bin/screen-time` (3fed812f) are Chewbacca's direct readers and writers for the databases macOS keeps. Before 2026-10-09 the kit read 5 directly (chat.db, knowledgeC, AddressBook, Reminders, TCC) and went through AppleScript for Calendar, Notes and Mail. Caleb asked if Chewbacca was "a master at pulling from any database the mac has", then "LOCK IN BE A MASTER OF ALL OF THEM". Skills: `mac-db`, `screen-time`; `your-data` points at `mac-db stores`.

Verified on his Mac that night, macOS 15.6, all from the Claude desktop app's Full Disk Access:
- 17 stores readable, every one returned real rows: messages, calls, contacts, mail, notes, calendar, reminders, safari, chrome (5 profiles), photos, voicememos, podcasts, downloads, interactions (interactionC, 59k rows), screentime, knowledge, biome (78 streams).
- Messages: 386 of 675 rows from one day had NULL text; the text lives in attributedBody after `NSString`.
- Notes bodies are gzip around protobuf, document(2) > note(3) > text(2).
- Biome is SEGB v2, not SQLite: 32-byte header, records of crc + u32 + protobuf padded to 4, index of (end offset, state, Cocoa ts) read backwards from the file end.
- Chrome History is locked while Chrome runs; a temp copy with its WAL must open without mode=ro or SQLite says "attempt to write a readonly database".
- Calendar OccurrenceCache stopped at 2026-05-11, so repeating events show at their first date only. Calendar keeps a 2222 sentinel date.

Writes, added 2026-10-10 after Caleb said "NOTHING on chewb should ever be read only that is stupid": app verbs (notes, reminders, calendar, contacts, messages) go through the `mac` CLI so iCloud syncs them; `mac-db sql` runs any statement and snapshots the db + WAL to ~/.chewbacca/mac-db/backups first (5 kept per store), `mac-db restore` undoes it. Verified live: a test row into the downloads db, read back, restored, count back to 10,887.

**Why:** "I can't see that" about something on this Mac is almost always false now.
**How to apply:** run `mac-db stores` first; use `mac-db sql <store>` for anything the presets don't cover. Related: [[project_chewbacca]], [[feedback_find_the_existing_thing_first]].
