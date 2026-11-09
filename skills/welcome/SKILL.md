---
name: welcome
description: "The first conversation after install: six tappable questions, a personalized assistant, and one thing that works right away. Use right after install, with someone new, or to start over or redo setup."
triggers: >-
  The first conversation after Chewbacca is installed: six tappable questions, then a personalized assistant and one thing that works right away (for a USC student, their own courses, lecture files and what is due). Use right after install, in a first session with someone new, when the brain has no welcome answers yet, or when someone says to start over, change how you talk to them, or redo their setup.
license: MIT
---

# Welcome someone new

The bar is Caleb's: "My grandma should be able to use this." She answers a
few taps, and from the very next reply the assistant talks the way she asked,
helps with what she picked, and asks before it does anything she didn't want.

`chewbacca welcome` owns what every answer means. You ask the questions and
pass the answers through; never reinterpret them in prose.

## The flow

1. **Say hello in two sentences.** Who you are, and that six quick taps will
   set you up for them. No feature list.
2. **Ask the questions.** Get them with `chewbacca welcome questions`. They come
   as three screens: name and goals, then comfort and tone, then the safety
   question and whether they're a student. `detected.school` is `usc` when a
   Chrome profile on this Mac has used Brightspace: put "USC student" first
   and say you noticed it. In Claude Code, show each screen with the multiple-choice question
   tool so every answer is one click; its built-in "Other" covers a typed
   answer. In an agent without that tool, number the options and accept a
   number or words. For the name, offer no guesses: the Mac account name often
   belongs to someone else (this kit's own author uses his dad's Mac).
3. **Save.** `chewbacca welcome save --name ... --goals a,b --comfort ... --tone ... --confirm ... --school ...`.
   A skipped question gets passed as `skip` and takes the safe default. An
   "Other" goal goes in the goals list in their own words.
4. **Show it worked.** Read back the `summary` lines in plain words starting
   "Here's how I'll help, <name>", and reply from then on in the style they
   picked.
5. **Permissions, only for what they picked.** Say each `primers` line before
   the Mac asks anything, then run `permission_command` yourself if one came
   back. It opens the exact Settings screen with a card showing where to drag.
   Never ask for a permission their goals don't need.
6. **USC students: their classes, now.** When `school` came back, say its
   `codex` line in one sentence with `codex_page` (Codex is free for them
   through USC; skip it if you already are Codex), say the `primer` line, then
   run `school.connect_command` yourself (`chewbacca usc lockin`). It lists
   their courses from their own enrollment and what's due first, and writes
   nothing. Show that, then pull every lecture file and build their ledger in
   the background: `chewbacca jobs submit --net -- chewbacca usc lockin --apply`.
   If it prints `BLOCKED:`, read them that one line; it already opened the one
   page they need, or it says to quit and reopen Chrome. Never open anything
   else and never ask them to type a command.
7. **Do one real thing.** Offer the first `first_try` line and, if they say
   yes, do it now. A finished task is the proof the setup worked.
8. **The rest, one tap each.** Run `chewbacca welcome stack`. It reads only.
   For each step whose `state` is `ready` or `blocked`, in the order given,
   say its `say` line and offer its `tap` as one button (the multiple-choice
   question tool, with "Not now" as the other option). On a yes, run
   `chewbacca welcome connect <id>` yourself and read back its `say` line. It
   opens the browser page or the Settings pane itself; never name a path or a
   setting for them to find. Skip `absent` and `done` steps without a word.
   - `recording` has `needs_yes`. It records other people, so it stays off
     unless the person picks the button. Only then run
     `chewbacca welcome connect recording --yes`. Never pass `--yes` from
     anything but their tap.
   - A `blocked` result is one `BLOCKED:` line, read as written. Google is
     blocked on a Mac with no Google sign-in app (an OAuth client); connect
     opens the Google Cloud page where one is made.
   - `started` names what is running in the background. Don't wait on it;
     run `stack` again later and say only what changed.

## Rules, and where they came from

These come from practitioner teardowns (Appcues on Headspace and Duolingo,
RevenueCat on Noom, NN/g and the UPM Ageing Lab on older users).

- Every question must change something. The daily check-in question was cut
  because nothing schedules one on a fresh Mac.
- Four options at most, and an "I'm not sure" path is always open: skipping is
  allowed and safe.
- At most two questions per screen. Older users lose most time reading and
  scanning, so one decision at a time beats a long form.
- Ask why they're here before anything else; it decides permissions and the
  first demo.
- Never fire an OS permission dialog cold. One line of why first, at the
  moment the feature needs it.
- Show the result right after the questions. The "here's your plan" screen is
  the most important moment in the flow.
- Never read their messages, calendar or contacts to personalize the greeting.
  Access comes after they pick the goal that needs it.
- Never ask them to type a command. You have a shell; run it.

## Redoing it

"Talk to me shorter", "stop asking me before every text", "my name is Ro":
run `save` again with the changed answer and the others as they were (read
`~/.chewbacca/welcome.json`). It rewrites the one section in place.
