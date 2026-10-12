# Reengineer plan, flat

Written 2026-10-11 after the Daniel and Cole night. One list, in order. Each
step lands on main with a test that fails on the old code, and each step
names the number that says it worked. Work-ledger source key:
`reengineer-flat-2026-10-11`, one task per step.

1. Unstick the shared checkout: ~/code/chewbacca is 87 commits behind with 3
   dirty files from another tab. Save those 3 files to a backup, fast-forward,
   then put them back. Done when the checkout is at origin/main and setup has
   rerun. Number: the Pre write-log drops from 1.55 s to about 0.38 s of CPU.

2. Write-log on file events: A small Rust watcher on the brain (FSEvents)
   replaces `git status` before and after every call. Number: write-log under
   0.05 s a call, and the replay of 7 days logs the same rows as today.

3. Replay in CI: A sanitized corpus of real Bash shapes goes in
   tests/fixtures, and `hookd_replay parity` runs in the suite on every change
   to a gated guard. Number: a guard that gains a trigger without its gate
   word fails the suite.

4. hookd as one process: A long-running hookd answers every hook event over
   a socket, and the guards move into it one at a time, each switched only
   after its replay matches exactly. Number: hook CPU per Bash call under
   0.3 s, and the slowest hook adds under 20 ms.

5. A real bash parser: tree-sitter-bash replaces the regex shell reading in
   destructive-guard, launch-guard, zsh-guard and load-guard. Each one keeps
   its old check running alongside (the precise read only adds). Number: the
   23 bypasses from tonight's reviews stay refused, and the 7-day refusal
   replay shows fewer false positives per guard.

6. Every verdict logged: Each hook, router and send writes one row: what it
   decided, how long it took, and the session. `chewbacca why` reads them.
   Number: "why was this refused" is one command, not a transcript dig.

7. Weekly false-positive report: The refusal replay runs every Sunday and
   ranks guards by refusals a later call overrode or reran. Number: the top
   offender gets fixed that week.

8. One state layer: The JSON files tabs race on (jobs queue, tabs board,
   chat approvals, send receipts, ledger) move into one SQLite file the
   daemon owns. Number: zero lost writes in a 10-tab stress test that loses
   some today.

9. Supervisor generations: Each daemon service records the kit sha it
   started from, `status` shows stale ones, and doctor fails on one stale
   past a minute. Number: no process runs from a pruned snapshot (3 did on
   10/11).

10. Blue/green swaps: Keepalive services (realm-ui, bridge,
    people-dashboard) start the new generation, pass a health check, then
    stop the old one. Number: no gap in service across a kit move.

11. HUD children under the daemon (HUD lane, its own owner): The voice
    listener, speaker, room-capture and agent engine become daemon services.
    Number: none survive a kit move on old code.

12. The send Approval type: One `send_approval` module mints a token only
    from a press (HUD button, real terminal, six-digit code) and every sink
    takes it. people send.js first, then plans, mac mail, mac-db, gmail,
    slack, matrix, and Clay reply. Number: tests/test_send_paths.py flips to
    "every sink calls take()", and an agent shell can't send without a press.

13. Send policy as code: The rules about who, when and how much (quiet
    hours, caps, clients, the Clay gates) move into one Cedar policy file the
    sinks ask. Number: one file answers "could this send right now".

14. Context from the graph: The two memory indexes (15,126 tokens) stop
    loading whole, and brain-recall supplies the top 5 per prompt, gated on
    its sealed eval holding. Number: the first turn drops from 131,426 by
    about 20,000, and `context-budget --max` holds the new line.

15. Prose rules become checks or go: Each prose-only rule in
    docs/plans/context-budget.md gets a check or a deletion proposal for
    Caleb. Number: the share of rules with a check goes up every week.

16. Eval engineering as the habit: Every new router, classifier or guard
    ships with its replay or sealed eval, the way hookd did. Number: none
    lands without one.

What would prove this plan wrong: step 1 alone gets hooks under 0.3 s a
call, so steps 2 and 4 wait for a new number. Or the bash parser in step 5
refuses more real calls than the regex did, and then it stays a second
opinion only.
