---
name: feedback_denylist_gate_is_a_backstop
description: A word-list gate over app-supplied labels can't be made complete; fail closed, judge by context, never forward consent, then stop iterating and document it as a backstop
metadata:
  type: feedback
---

On 2026-10-09 the `chewie app` irreversible-action gate went through three security reviews in one night. Each fix (more words, every AX attribute, unlabeled buttons, commit keys, dialog context) drew a new finding, because the gate reads labels the app controls and any list of verbs has a next miss. Meanwhile Caleb asked "Wtf taking so long?????" twice.

**Why:** a denylist over untrusted text is inherently fail-open; chasing completeness burns hours and never converges.

**How to apply:** for any gate on UI actions, build the three structural pieces once: fail closed on anything unlabeled or inside a dialog, judge by the surrounding context (the dialog's text) not the button alone, and never let an automated pick (Jev, a batch) inherit the person's consent. Then write down that it is a backstop and that the real boundary is the person's explicit yes, and stop. Related: [[project_chewie_app_background_control]], [[feedback_a_silent_guard_proves_nothing]].

Same shape, second time, 2026-10-10: `main-ci` ran the suite on whatever landed on main from launchd, which a review called unattended remote code execution. A sandbox-exec blocklist (no network, no secret reads, no persistence writes) passed its own probes, and the next review found three escapes anyway: Apple events and other IPC to unsandboxed apps, persistence paths the list missed, and egress through local services. The fix was structural: `main-ci install` refuses, runs are on demand, and an unattended run belongs in GitHub Actions or a throwaway VM. Open and unowned: `kit-autopull` already syncs hooks from origin/main at every session start, so anyone with push access already gets code execution on Caleb's Mac; that trust call is his.
