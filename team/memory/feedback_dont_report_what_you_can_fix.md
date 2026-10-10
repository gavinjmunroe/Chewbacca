---
name: feedback-dont-report-what-you-can-fix
description: Never list a fixable gap as something for Caleb to handle; fix it and report it done
metadata:
  type: feedback
---

Caleb, 2026-10-08: "Bro never ask for permission of course I want you to always be able to use slack 24/7 and don't tell me something you can fix save jonah as a contact bro". I'd ended a reply with "Jonah isn't a saved contact" and "your call on slackcli" as open items. Both were mine to just do.

**Why:** a "still needs you" list is supposed to hold only what truly needs his hands: a sign-in click, a phone code, a 2FA prompt. Padding it with fixable items makes him do triage, and it reads like I stopped early.

**How to apply:** before writing any "needs you" or "your call" line, ask whether I could do it myself. If I can, do it. Capability he obviously wants (Slack sending, saving a client's contact) isn't a decision for him. For the things that truly need him, open the window or page and pre-fill it first, then name the one click. Related: a private note, a private note.

**A lookup counts too (2026-10-09).** A reply ended "Check the $500 edu price on apple.com before u send it". Caleb: "never tell me to do smth you can do fix chewb". The price was a guess and wrong: Apple's edu Mac mini is $799. handoff-check now refuses a sentence that opens on check/verify/confirm and points at a send (b46dedf1).

**Cleanup counts too (2026-10-10).** A reply called three stray Togari test posts in a Zeutara channel "still open" to delete. Caleb: "Delete them urself fucker never make me do manual work". The bot can delete its own posts: SLACK_BOT_TOKEN from `railway variables --kv` in togari-platform, find the ts with conversations.history, delete each thread reply then the parent with chat.delete, then read history back to confirm zero left.
