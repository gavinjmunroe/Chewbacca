---
name: feedback_guards_misfire_on_tab_prompts
description: Several Stop and PreToolUse guards misfired across one call-prep session and cost Caleb repeated re-sends; the cases to fix, all from 2026-10-28
metadata:
  type: feedback
---

Over one session on 2026-10-28 (Junto call prep and live coaching), these guards refused work that was correct. Each refusal re-sent a reply or blocked a write while a client call was minutes away.

- voice-guard measured prompts meant for other agent tabs as if they were texts to a person ("longer than 97% of your texts"). A pasteable tab prompt is not a text, so it should be skipped when it sits in a fenced block.
- scope-guard read "top 3" (rows to read aloud from a list he wrote himself), "for now" and "only the 1 to 3 questions" as scope cuts. Nothing had been cut.
- launch-guard refused `work-ledger add` and a Python heredoc as "mentions Clay" when neither command contained the word. The ledger entries for the Junto pilot never landed.
- skim-guard fired three times on the same three files, including after a whole read, and read "I didn't read X" as a claim that everything was read.
- ready-guard read "u're good to go" before a sales call as a Zeutara campaign launch.

**Why:** Caleb, mid-session: "Bro what is taking so long?????" from another tab, and the same pressure here, 15 minutes before the Junto call.

**How to apply:** Each case gets a test fixture in that guard's eval before the guard changes. Until then, answer a misfire in one plain line and don't rewrite correct work to satisfy it. Related: [[feedback_hooks_never_show_errors]], [[feedback_denylist_gate_is_a_backstop]].
