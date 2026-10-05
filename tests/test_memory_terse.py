#!/usr/bin/env python3
"""memory_compact --terse: old pointers convert, terse ones pass through."""
import importlib.util, pathlib, sys

spec = importlib.util.spec_from_file_location(
    "mc", pathlib.Path(__file__).resolve().parent.parent / "tools/memory_compact.py")
mc = importlib.util.module_from_spec(spec); spec.loader.exec_module(mc)

fails = 0
def check(name, got, want):
    global fails
    ok = got == want
    fails += not ok
    print(f"  {'pass' if ok else 'FAIL'}  {name}" + ("" if ok else f"\n        got:  {got!r}\n        want: {want!r}"))

check("bold pointer keeps a ! and its date",
      mc.terse_line("- **[Never submit unasked (9/20)](feedback_never_submit.md)**, a hard gate now."),
      "- !feedback_never_submit (9/20): a hard gate now.")
check("plain pointer, date with a suffix",
      mc.terse_line("- [Brightspace (9/21, CLI 10/3)](reference_brightspace.md), run it first."),
      "- reference_brightspace (9/21): run it first.")
check("a pointer outside memory/ keeps its relative stem",
      mc.terse_line("- **[Timeline (9/4)](../domains/timeline.md)**, dated chronology."),
      "- !../domains/timeline (9/4): dated chronology.")
check("bold inside the hook is dropped, never left unclosed",
      mc.terse_line("- [X (1/2)](project_x.md), it is **live** now."),
      "- project_x (1/2): it is live now.")
check("a terse line passes through unchanged",
      mc.terse_line("- !feedback_never_submit (9/20): a hard gate now."),
      "- !feedback_never_submit (9/20): a hard gate now.")
check("a prose line with an inline link is left alone",
      mc.terse_line("- **Older pointers live in [ARCHIVE.md](ARCHIVE.md)** and are NOT loaded."),
      "- **Older pointers live in [ARCHIVE.md](ARCHIVE.md)** and are NOT loaded.")
once = mc.terse("- [A (1/1)](user_a.md), hook.\n")
check("rerunning is a no-op", mc.terse(once), once)
sys.exit(1 if fails else 0)
