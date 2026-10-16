---
name: feedback_ready_means_gtme_ready_passed
description: A launch is ready only when `chewbacca gtme ready` prints READY; on 2026-10-12 a Zeutara launch was called good "until Jonah responds" with 1 of 14 drafts graded, and ready-guard.sh now refuses the claim
metadata:
  type: feedback
---

`chewbacca gtme ready --client <name> --drafts <drafts.json>` is the only answer to "is the launch ready?". It runs `gtme-grade --action launch` on every draft with every input it can find, checks the pre-send gate receipt and owed replies (`gtme done`), counts NOT CHECKED as a blocker, and writes a signed result to `~/.chewbacca/state/gtme-ready/<client>.json`.

On 2026-10-12 an agent told Caleb the Zeutara launch was good "until Jonah responds", with only the footer address missing. In fact the new copy existed only as local files and the live drafts still graded 25 to 67 against the 85 bar, nobody had read it as a recipient, 104 of 746 firm names carried legal suffixes ("W Capital Partners, L.P.") the first line would print, 1 of 14 campaigns had been graded, gates 3 to 5 were NOT CHECKED, the pre-send receipt had expired and no START had ever gone to Clay. Caleb: "DONT TELL ME UR READY IF THIS SHIT IS HAPPENING? FIX CHEWBS BRO UR SUPPOSED TO BE A GTME".

**Why:** a readiness claim built from memory of which steps ran reads the plan, not the state. Every gap above was one command away.

**How to apply:**

- Before any "ready", "good to go", "good until X", "only waiting on X" or "just needs X" in GTM work, run `chewbacca gtme ready` and report its NOT READY list as it stands.
- The Stop hook `.claude/hooks/ready-guard.sh` refuses such a claim without a signed READY under 2 hours old for an unchanged drafts file. Tests: `tests/ready_guard.sh`, `tests/test_gtme_ready.py`.
- gtme-grade's render gate now fails firm names the copy prints that end in a legal form or carry an emoji; it used to warn and missed "L.P.".
- Inputs gtme ready cannot find (a per-draft leads file for a signal split, a recipient read in `reviews/<campaign>.json`, senders, suppress) are named in its table. Put them beside the drafts file or in the client's `ready` block in clients.json.

- ready-guard also fires on an all-clear about something else. On 2026-10-16 a
  tab that only fixed launch-guard answered Caleb's "We good?" with "Yeah we're
  good" and was refused for Zeutara (41 blockers). In a tab that isn't doing
  the launch, name the thing that's done ("the guard fix is on main") and say
  plainly that the client launch isn't ready, quoting the last NOT READY count.

Related: [[feedback_client_review_is_the_gate]], [[feedback_a_silent_guard_proves_nothing]].
