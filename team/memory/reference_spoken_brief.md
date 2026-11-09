---
name: reference_spoken_brief
description: "`chewie brief --speak` reads the brief aloud, off until `--speak-auto on`; silent on any Focus, a call or other audio; private lines never spoken; what it measured about macOS audio and the calendar."
metadata:
  node_type: memory
  type: reference
  modified: 2026-11-06T20:00:00.000Z
---

The code is in `mac/lib/brief_speak.py`, behind `chewie brief --speak`, `--print` for the words alone, `--hush` and `--speak-auto on|off|status [--at HH:MM]`, and `chewbacca brief` runs the same command. Nothing is registered with the daemon until someone turns it on, and the tick rereads the setting, so a leftover registration can't talk.

Three things measured on 2026-11-06 that aren't obvious:

- `corespeechd` (Siri) opens the mic input within 2 s of anything playing, and lets go when it stops. A plain "is anyone on the mic" check hears your own voice as a call. `SYSTEM_LISTENERS` carries it.
- `CalendarItem` holds a repeating event once, on its first day. The old query found 0 rows on a day with 4 events and said "nothing on the calendar". `OccurrenceCache` joined to it is the right source. `mac calendar` needs a Calendar grant the host doesn't have.
- A Focus schedule writes no assertion, so `Assertions.json` alone misses it: read `ModeConfigurations.json` triggers too (schedule class, `enabledSetting` 2). The value 2 meaning on comes from a public script and the trigger data, never from Apple, so it reads silent when wrong.

Speech length: count a token with a digit as two. Kokoro ran 2.39 a second and `say` 2.74 to 2.86, where plain words swung 2.25 to 2.67 on one voice.

Not spoken on purpose: message bodies, WHOOP, Mail (touching it opens Mail.app) and the morning-brief job's prose, which is free text from private notes. `--from` will read that prose through the line filter if asked. The filter is a word list and misses a counselor's bare name, which is what `private_words` in `~/.chewbacca/spoken-brief.json` is for.
