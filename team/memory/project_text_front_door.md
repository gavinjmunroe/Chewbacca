---
name: project_text_front_door
description: Chewbacca by text is a text to yourself on your own Mac; four everyday jobs answer with no model, others' texts are quoted never obeyed, sends are drafts only. Hosted numbers stay Amber's.
metadata:
  type: project
---

Chewbacca by text is a text a person sends to themselves in Messages on their own Mac. `bin/text-command` reads it (Kyber's `TextTrigger` wakes it on a chat.db write) and answers in the same thread. Built 2026-10-13 after the Pew finding that people who skip AI mostly aren't interested (83%) or worry about privacy (79%), so the front door is a job they already do in an app they already use.

Four jobs answer with no model, in `bin/lib/text_jobs.py`: "what did Mom say" (her last three texts; Mom is whoever the owner's own Contacts card names as Mother, or a contact called Mom), "remind me to X tomorrow at 5" (one reminder, exact time computed here), "what's due" (the coursework ledger, when there is one), and "text Mom I'm late" (a draft in `people texts drafts`, pinned to her Messages address). Everything else goes to the read-only model turn that was already there.

**The lines, and the tests that hold them (tests/test_text_jobs.py):**
- Only the owner's own iMessage handles command it. `text-command --setup` finds them from the account on sent texts in the last 90 days, because an older account on a family Mac can be a parent's, and a thread named by their address is a thread with them.
- Another person's text is quoted, never obeyed. No model reads it, and a quoting reply starts "Chewbacca: ", which text-command never treats as a command.
- Nothing reached by text sends to another person. "text X" is a draft that sends only from the Mac.
- CHEWBACCA_NO_SEND=1 writes replies to `~/.chewbacca/text-command.outbox.jsonl` and adds no reminder or draft. `text-command --ask "words"` prints one reply with no send and no model.

**Scope versus Amber:** the 2026-09-04 positioning said Chewbacca builds no text surface because the phone is Amber's. On 2026-10-13 Caleb asked for this one. The split that keeps both true: a text to your own Mac is Chewbacca's, a hosted number anyone can text (the Togari/Loop shape) stays Amber's.

**Not done yet:** nothing wakes text-command without the Kyber HUD, so a person with only the Setup app has no listener; "find that photo" goes to the model, which can't search Photos. See [[project_chewbacca_positioning]], [[project_togari_imessage_live]].
