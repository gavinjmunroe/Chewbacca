---
name: feedback_denylist_gate_is_a_backstop
description: A word-list gate over app-supplied labels can't be made complete; fail closed, judge by context, never forward consent, then stop iterating and document it as a backstop
metadata:
  type: feedback
---

On 2026-10-09 the `chewie app` irreversible-action gate went through three security reviews in one night. Each fix (more words, every AX attribute, unlabeled buttons, commit keys, dialog context) drew a new finding, because the gate reads labels the app controls and any list of verbs has a next miss. Meanwhile Caleb asked "Wtf taking so long?????" twice.

**Why:** a denylist over untrusted text is inherently fail-open; chasing completeness burns hours and never converges.

**How to apply:** for any gate on UI actions, build the three structural pieces once: fail closed on anything unlabeled or inside a dialog, judge by the surrounding context (the dialog's text) not the button alone, and never let an automated pick (Jev, a batch) inherit the person's consent. Then write down that it is a backstop and that the real boundary is the person's explicit yes, and stop. Related: [[project_chewie_app_background_control]], [[feedback_a_silent_guard_proves_nothing]].
