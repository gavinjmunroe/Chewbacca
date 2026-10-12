---
name: feedback_fix_the_class_at_the_source
description: A lesson fixed for one surface gets beaten through the next one over; fix it where every path meets (the launch site, the one reader), with a test
metadata:
  type: feedback
---

On 2026-10-11, three of the night's misses had already been "learned". Each lesson covered the surface where it first happened, and each repeat came in through the surface next to it:

- **Asking the client for things he had already sent.** The 10/9 lesson said to check his sent texts and the channel before listing anything as still on him. On 10/11 Jonah's three decks and form answers sat a day in a Slack DM, a to-do post asked him for them again, and three investors waited two days for decks that were already on file. The DM was the one surface nobody checked.
- **The screen flashbang.** focus-guard refused `open` and browser activate, and on 10/11 it also closed the `open -g -n` loophole. The same night the web bridge's own Chrome launch, a windowed copy of the profile started by every `chewie web` call, still took the screen.
- **Replies sitting unanswered.** Togari drafted a Slack card for every reply that needed a person, and only Jonah could press Send. Sixteen investors waited a weekend while the draft-and-approve design matched the old "a person approves every send" rule exactly as written.

**Why:** a guard that matches commands, or a checklist that names surfaces, covers exactly the cases someone already listed. Any new path walks around it.

**How to apply:** when a lesson lands, list the neighboring surfaces before writing the fix (every client channel, every way to launch a window, every path to send), then put the fix at the point they all pass through:

- **Focus:** the bridge's one Chrome launch runs headless (`mac/bridge/web.js`, test `tests/web_headless.sh`), and the inbox read goes through the API with the browser behind `--browser`.
- **Client asks:** `chewbacca gtme done` reads every configured client conversation (`client_slack` in clients.json) and the whole reply inbox, and flags anything the client sent after our last message.
- **Replies:** Togari answers anything that doesn't need the client itself (togari-platform `src/replies/auto-send.ts`).

Each fix comes with a test that fails on the old path. See [[feedback_enforce_dont_document]] and [[feedback_fix_the_core_not_a_guard]].
