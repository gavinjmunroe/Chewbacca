---
name: project_chewbacca_install_broken_2026_09_19
description: The public one-line install was dead on main for everyone; Sagar and Karthik found it live on a call, and the cause was an auto-push hook that commits setup.sh without its checksums.
metadata:
  type: project
---

On 2026-09-19 Sagar and Karthik installed Chewbacca on their own Macs on a call
with Caleb. Both failed. Every failure was real and every one is now fixed and
pushed (`2bb282c`), but the important part is why nobody knew.

**The install was dead on main, not on their machines.** `SHA256SUMS.txt` did
not match `setup.sh`. `start.sh` verifies every downloaded file against that
list and aborts on a single mismatch, so the exact command in the README died
for everyone, while `bash -s -- --version 1.1.0` worked because that tag is
self-consistent. On the call this read as the testers' machines being wrong.

**The cause is a hook, not a person.** `~/.claude/hooks/sync-to-d1.sh` runs on
every Claude Stop event, regenerates the inventory, and does `git add README.md
setup.sh settings/toolkit.json`, commit, push to main. `SHA256SUMS.txt` was
never in that list, so every regeneration shipped a tree nobody could install
from. It pushes to main with no test run in front of it. It also committed a
half-finished manual edit of Caleb's as "chore: regenerate extension inventory".
The hook is untracked and lives only on his machine. Fixed there: checksums are
regenerated and included, and it refuses to push a stale tree.

**CI had been red since the morning and nobody looked.** `gh run list` showed
the failure. Red CI is the thing that would have caught this before the call.

Six other walls, all fixed: `gh api user` exits 4 unsigned-in and under `set -e`
killed every personal install silently at exit 4; bootstrap demanded a GitHub
account the personal profile never uses; nineteen plugins failed one red line
each because `command -v claude` does not prove the CLI is signed in; a mistyped
flag exited 2 with no install; `--version` silently meant "pin to this tag";
setup wrote its own adapters into the upstream macOS-use checkout. There is now
a `--fast` install, eight seconds instead of thirty-plus minutes.

**What Karthik asked for:** paste a link, one allow-once click, everything else
handled, a completely localized Chewbacca at the end, as few commands as
possible. Windows next, because a lot of private equity runs Windows. Daily
Chewbacca and Amber calls from here.

**Caleb held the positioning line on the call**, unprompted: "I don't think we
should confuse people with both yet, it's 2 different types of ICPs." Same split
as [[project_chewbacca_amber_positioning_2026_09_18]].

See [[project_chewbacca]], [[feedback_verify_the_generated_block]].

## Round two, same day: Windows and the missing skills

**There was no Windows path at all.** Sagar: "a lot of private equity uses
Windows." The README said "not yet". `start.ps1` is now a native Windows
installer: writes only inside the user's own account, never asks for
administrator, installs no system software, states all of that before doing
anything, verifies the same checksums `start.sh` does, and handles the same
three CLAUDE.md cases. It is honest that the macOS automation half does not run
there. Tested by being executed under pwsh into throwaway HOMEs, not by being
read.

**The first draft used `??`, which is PowerShell 7 only.** Windows ships 5.1, so
that one operator would have been a parse error on exactly the machines it was
written for. Caught before shipping only because the script was actually run.

**Skills were missing from every non-macOS install.** They lived inside the
`plugins` section, so `--profile portable` installed 57 commands, 14 rules and
ZERO skills. The largest single piece of the kit. Skills are their own section
now and portable gets all 29.

**CI caught a structural bug the local suite could not.** A `# ── Section ──`
header has to sit directly above `if should_run` or the previous guard closes
early and everything after runs on every invocation. That check lived only in
CI, so a wrong header passed 206 local tests and failed after the push. It is
`tests/check_sections.py` now and runs locally.

207 tests green, CI green, and both installers verified against the published
tarball rather than the working tree.

## Round three: the untested paths and the unattended push

**The Stop hook now runs tests before it pushes.** It was committing and
pushing to main unattended with nothing in front of it; the checksum gate added
earlier only stopped an uninstallable tree, not a broken one. It runs the
`installer` and `windows installer` groups, about 30 seconds, only on the runs
where generated files actually changed. Proved by feeding it a deliberately
broken setup.sh: it refused and named the failures.

**bootstrap.sh still had the dead end its own header says was fixed.** On a Mac
with nothing on it, it printed "run: brew install node" to someone with no brew
and "npm install -g ..." to someone with no node. It survived because the
bare-machine path had never been executed: every machine it ran on already had
those tools. `CHEWBACCA_NO_BREW` makes that path reachable and
`tests/bare_machine.sh` fails on any instruction naming a tool the machine
lacks.

**Renamed skills leave orphans and nothing looked.** `nova-brief` and
`nova-runtime` sat in `~/.claude/skills` for fifteen days after the rename to
`mac-*`, loading into every session and pointing at a command that no longer
exists. Every check asked "is what the repo has installed", never the reverse.
Doctor checks the reverse now.

**The always-on budget is Caleb's own number.** The default is 15,000; he raised
it to 28,000 in `~/.chewbacca/context-budget`. After removing 170 tokens of real
waste it sits at 28,036, so 36 over a number he chose. The remaining levers are
his calls, not mine: which MEMORY.md pointers stay loaded, whether the
ten-skill watch-skill pack stays, and whether `agent-neutral.md` (1,176 tokens,
written for Codex) should load in every Claude session.

Still not done, and named rather than hidden: the in-browser flow, photo and
video ingestion, and a test on Perplexity Computer, which is what Sagar actually
uses.

## Round four: a real kill bug, and three rules that never deferred

**The gateway could SIGKILL an unrelated process group.** `run_shell` calls
`stop_process` from the timeout, except and finally paths, so it ran up to three
times on one process. The first call reaps the child, and from then its pid
belongs to the OS and can be reused. Every later call still ran `killpg` on that
number. It looked like a flaky test: an intermittent
`PermissionError: Operation not permitted`, which is the lucky version, the
recycled pid landing on a process Caleb does not own. The unlucky version kills
somebody else's process group. **A test that fails once in a suite and passes
alone is a report, not noise.**

**`paths:` frontmatter is what defers a rule, not the table in CLAUDE.md.**
Three rules said in their own first paragraph that they load on demand and had
no frontmatter: `design-system.md`, `ai-features.md`, `deploy-gate.md`. Every
install paid for all three on every session. Only Caleb's machine had
design-system scoped, added by hand, and a reinstall overwrote it.
`agent-neutral.md` is written for Codex and says the standards already load for
the primary agent, yet cost 1,204 tokens per Claude session; it is scoped on the
way into `~/.claude/rules` so the AGENTS.md export stays clean.

**`context_cost.py` was measuring a proxy.** It read the CLAUDE.md table to
decide what was deferred. A number that can be fixed by editing prose is not a
measurement. Always-on went 28,206 over budget to 26,860 under it, with no
change to the budget.

**Mistake worth remembering:** running `setup.sh --only rules` without
`--profile personal` installed the developer standards over Caleb's global
CLAUDE.md, taking it from 14,897 to 44,273 chars, and added nine rules he never
had. The merge preserved his content and wrote a backup, so it was fully
reversible. **Always pass `--profile personal` when touching his machine.**

Doctor went from exit 2 to exit 1: no failures, two warnings left, both needing
him (a signed-in ChatGPT tab, and the coursework ledger).

