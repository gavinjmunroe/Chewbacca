---
name: project_chewbacca_pull_push_default
description: Pull and push are Chewbacca defaults as of 2026-09-22; six hooks were registered nowhere and chewbacca update had never installed anything it pulled.
metadata:
  type: project
---

**2026-09-22.** Caleb: *"Make sure that anyone using chewbacca by default always
pulls changes and pushes changes."* Doing it turned up three layers of things
that were built and never ran.

**Push already existed and was never on.** `kit-autopush.sh` is careful work:
never commits, main only, origin only, six CI gates first, a lock against
races, loud on failure. `setup.sh` had no `_register` call for it, so auto-push
itself was never a default. It fired on Caleb's Mac only because it had been
hand-added to `settings.json`.

**Pull did not exist at all.** `chewbacca update` could always pull and always
needed a person to remember, which is the exact sentence kit-autopush's own
header was written to retire. `kit-autopull.sh` is now a SessionStart hook:
fast-forward only, main only, origin only, throttled hourly, and it **refuses
outright on a dirty working tree**. It never commits, stashes, resets or cleans.
`tests/kit_autopull.sh` runs it against a real origin in four states and asserts
each refusal, because an automatic pull is only acceptable if it cannot eat
uncommitted work.

**Six hooks were on disk and registered nowhere.** `setup.sh` copies every
`.claude/hooks/*.sh` to `~/.claude/hooks`, so each one reported installed,
executable and present while never running: `ux-guard`, `skill-route` (the
other half of the `kit-route` bug fixed 9/21), `ask-capture`, `kit-autopush`,
`youtube-transcript-ready` (never registered on any machine, ever), and
**`kit-debt`**, which was built after Caleb asked four times whether the kit had
learned anything and had not fired once. `tests/hooks_registered.sh` now fails
on any unregistered hook, verified by adding one on purpose.

**`chewbacca update` pulled and then installed nothing.** It runs
`git pull --ff-only` then `setup.sh "$@"`, and with no arguments that hit an
unconditional `--name` guard and exited 2. Every time, on every machine. So
update fetched new hooks, skills and tools, installed none of them, and
`chewbacca version` reported the new version anyway. A manifest now means
"re-install": skip `repos` and run the rest. A new machine still demands
`--name`.

**Two defects that blocked every auto-push.** `checksums.py` had gained
`runtimes/*.json` and `committed_checksums.py` had not, though its own comment
said to keep them in step, so the verifier called HEAD undescribed while the
hash was byte-identical everywhere. And the README line count was stale.
`tests/checksum_patterns.sh` now asserts the two tuples are equal, because a
comment asking two lists to stay in step is not a mechanism.

Commits `50560b4` and `d4942ce`. 308 suite tests pass, `chewbacca update` now
exits 0 and installs 116 skills and the hooks.

Related: a private note, [[project_chewbacca_autopush]],
[[feedback_a_silent_guard_proves_nothing]], [[feedback_enforce_dont_document]],
[[project_ux_engine]], [[feedback_measure_exit_codes_directly]]
