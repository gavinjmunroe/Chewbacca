#!/usr/bin/env python3
"""The stranger stopwatch and the proof layer's statistics.

No install runs here: the rig's own judgments (what counts as a prompt or an
error, which command setup told the stranger to run, whether a hook
refused, what the sandbox lets through) and proof_stats against values
worked by hand. The sandbox half runs only where sandbox-exec exists.
Run: python3 tests/test_stranger_run.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import proof_stats as ps  # noqa: E402
import stranger_run as sr  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


# ── proof_stats ──────────────────────────────────────────────────────────────
lo, hi = ps.wilson(41, 55)
check("Wilson 41/55 is the 62% to 84% MOG-PLAN quotes", round(lo, 2) == 0.62 and round(hi, 2) == 0.84, (lo, hi))
lo, hi = ps.wilson(25, 500)
check("Wilson 25/500 is about 3.4% to 7.3%", round(lo, 3) == 0.034 and round(hi, 3) == 0.073, (lo, hi))
check("Wilson 0/10 starts at 0", ps.wilson(0, 10)[0] == 0.0)
check("exact McNemar: 0 vs 6 discordant is p = 2/64", abs(ps.mcnemar_exact(0, 6) - 2 / 64) < 1e-12)
check("exact McNemar: no discordant pairs is p = 1", ps.mcnemar_exact(0, 0) == 1.0)
check("median of an even count averages the middle two", ps.median([4, 1, 3, 2]) == 2.5)
med, a, b = ps.median_ci([5, 1, 4, 2, 3])
check("five runs give a median and no interval", med == 3 and a is None and b is None, (med, a, b))
med, a, b = ps.median_ci(list(range(1, 7)))
check("six runs give the min-max interval (96.9% coverage)", (a, b) == (1, 6), (a, b))
med, a, b = ps.median_ci(list(range(1, 31)))
check("thirty runs narrow it to the 10th and 21st", (a, b) == (10, 21), (a, b))
try:
    ps.wilson(3, 2)
    check("an impossible count is refused", False)
except ValueError:
    check("an impossible count is refused", True)

# ── what counts ──────────────────────────────────────────────────────────────
c = sr.classify("Continue? [y/N]\nfatal: could not read Username\nall 12 passed, 0 failed\nerror states are drawn\nok\n")
check("a y/N line is a prompt", c["prompts"] == ["Continue? [y/N]"], c)
check("a fatal line is an error, a summary with 0 failed is not", c["errors"] == ["fatal: could not read Username"], c)

kit = Path("/k/Chewbacca")
out = "Shared context: /x\nAgents page: '/k/Chewbacca/bin/chewbacca' agents puts it in a browser tab (no Kyber)\n"
check("the agents command is read from what setup printed",
      sr.agents_command(out, kit) == ["/k/Chewbacca/bin/chewbacca", "agents"], sr.agents_command(out, kit))
check("a bare chewbacca is the checkout's own",
      sr.agents_command("Agents page: chewbacca agents puts it", kit) == [str(kit / "bin" / "chewbacca"), "agents"])
check("no line means setup never said", sr.agents_command("Shared context: /x\n", kit) is None)

check("exit 2 is a refusal", sr.refused(2, ""))
check("a deny decision is a refusal",
      sr.refused(0, json.dumps({"hookSpecificOutput": {"permissionDecision": "deny"}})))
check("a context note is not", not sr.refused(0, json.dumps({"hookSpecificOutput": {"additionalContext": "x"}})))

tmp = Path(tempfile.mkdtemp(prefix="stranger-test-"))
settings = tmp / "settings.json"
settings.write_text(json.dumps({"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
    {"type": "command", "command": "a"}, {"type": "command", "command": "b"}]}]}}))
check("hook commands are read in order", sr.hook_commands(settings, "PreToolUse") == ["a", "b"])
check("a missing event is empty", sr.hook_commands(settings, "Stop") == [])

env = sr.stranger_env(tmp, {"X": "1"})
check("the stranger has the scratch HOME, a stock PATH and no sends",
      env["HOME"] == str(tmp) and env["PATH"] == sr.STRANGER_PATH and env["CHEWBACCA_NO_SEND"] == "1"
      and env["X"] == "1" and "nvm" not in env["PATH"], env)

# ── the sandbox keeps the host's own install out of reach ────────────────────
sb = shutil.which("sandbox-exec")
if sys.platform != "darwin" or not sb:
    print("skip the sandbox half: no sandbox-exec here")
else:
    scratch = Path(tempfile.mkdtemp(prefix="stranger-home-"))
    prof = scratch.parent / (scratch.name + ".sb")
    prof.write_text(sr.sandbox_profile(scratch))
    probe = Path.home() / f".stranger-probe-{os.getpid()}"
    script = (f"echo ok > {scratch}/w && echo wrote; echo x > {probe} 2>/dev/null || echo home-denied; "
              "/bin/launchctl list >/dev/null 2>&1 || echo launchctl-denied; "
              "/usr/bin/open -g about:blank >/dev/null 2>&1 || echo open-denied")
    done = subprocess.run([sb, "-f", str(prof), "/bin/sh", "-c", script], capture_output=True, text=True, timeout=30)
    said = done.stdout.split()
    check("the scratch HOME is writable", "wrote" in said, done.stdout + done.stderr)
    check("the real HOME is not", "home-denied" in said and not probe.exists(), said)
    check("launchctl can't reach the host's LaunchAgents", "launchctl-denied" in said, said)
    check("open can't take the screen", "open-denied" in said, said)
    if probe.exists():
        probe.unlink()
    shutil.rmtree(scratch, ignore_errors=True)
    prof.unlink()

shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
