---
name: project_chewbacca_installer_gutted_unresolved
description: On 2026-09-21 a narrow PATH stripped 5 tools from Chewbacca's toolkit.json and 116 lines from setup.sh mid-session; root cause found and fixed
metadata:
  type: project
---

**RESOLVED same day.** Found 2026-09-21 while doing unrelated startup work.

Partway through a session, three generated files in `chewbacca` changed on their
own, timestamped 21:31-21:33, with no one having asked:

- `settings/toolkit.json` lost five tools: **bd, cap, mac, mac-use, yt-transcript**
- `setup.sh` lost **116 lines**, the install blocks for exactly those tools
- `docs/REFERENCE.md` went from "9 installed alongside the kit" to "4"
- `SHA256SUMS.txt` was auto-regenerated to bless the smaller setup.sh

All nine tools are installed on this Mac, so it was not pruning by what is
missing locally. The five removed are the ones whose `install` is not a single
clean brew formula. **yt-transcript is his own tool** and his global
instructions promise it is on PATH, so a fresh install would have contradicted
his own CLAUDE.md.

All four files were restored with `git checkout` and none of it was ever
committed or pushed. `kit-autopush.sh` only pushes committed work, so nothing
shipped.

**Cause found.** `collect_cli()` in `tools/inventory.py` probed
`os.environ["PATH"]` alone, so the published catalog was a function of whichever
process ran the generator. The five that died live only in `~/.local/bin`.
peekaboo and summarize survived because they are **also** in `/opt/homebrew/bin`,
and Anki and Maccy because they probe `/Applications` instead. So the run had
Homebrew on PATH and not `~/.local/bin`.

Two earlier readings here were wrong. Exit 1 is **"nothing to do"**, documented
in the module docstring, not a silent failure. And the five were not selected by
their install style.

**Fixed in `54db658`.** The bin probe now searches PATH plus the directories
tools actually live in, and a catalog that shrinks is refused outright, naming
what went missing. Both proven: with `PATH=/usr/bin:/bin` all nine tools are
still found, and forcing a real loss makes the generator refuse and list the
seven it could not see.

**How to apply:** if `setup.sh`, `settings/toolkit.json` or `docs/REFERENCE.md`
show up modified without being asked for, do not commit them and do not let a
checksum regeneration bless them. Diff `toolkit.json` first and count the tools.
This is the second time the installer has been broken on main, after
[[project_chewbacca_install_broken_2026_09_19]].

See [[project_session_startup_profiled_2026_09_21]] for the session it surfaced in.
