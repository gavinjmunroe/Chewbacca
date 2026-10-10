"""model-route handoff: a plan from the expensive tier becomes a page a fresh,
cheaper session can build from, and a plan whose acceptance checks are prose,
placeholders or missing scripts is refused. Offline: Jev is a stub or absent,
and no model is ever called."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import model_handoff  # noqa: E402

GOOD = """# Add a dry-run flag to ship

## Goal
`ship --dry-run` prints the plan and changes nothing.

## Files
- bin/ship
- tests/test_ship_dry_run.py

## Steps
1. Parse --dry-run in bin/ship.
2. Write tests/test_ship_dry_run.py.

## Acceptance
- `python3 tests/test_ship_dry_run.py`
- `true`
"""


def stub(choice, p):
    return lambda state, questions: {"task": {"choice": choice, "probabilities": {choice: p}}}


def main():
    failures = 0

    def check(name, cond):
        nonlocal failures
        print(("  ok    " if cond else "  FAIL  ") + name)
        failures += 0 if cond else 1

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        plan = model_handoff.parse(GOOD)
        check("parse reads goal, files, steps and acceptance",
              plan["files"] == ["bin/ship", "tests/test_ship_dry_run.py"] and len(plan["steps"]) == 2
              and plan["acceptance"] == ["python3 tests/test_ship_dry_run.py", "true"])
        check("a script the plan will create counts as runnable", model_handoff.check(plan, root) == [])

        prose = model_handoff.parse(GOOD.replace("- `true`", "- the tests pass and it looks right"))
        problems = model_handoff.check(prose, root)
        check("a prose acceptance line is refused by name",
              len(problems) == 1 and "prose, not a command" in problems[0])
        ph = model_handoff.parse(GOOD.replace("`true`", "`pytest <test-file>`"))
        check("a placeholder is refused", any("placeholder" in p for p in model_handoff.check(ph, root)))
        missing = model_handoff.parse(GOOD.replace("`true`", "`python3 tests/nowhere.py`"))
        check("a script that neither exists nor is planned is refused",
              any("nowhere.py does not exist" in p for p in model_handoff.check(missing, root)))
        offpath = model_handoff.parse(GOOD.replace("`true`", "`zzz-not-a-tool-xyz --run`"))
        check("a program off the allowlist is refused",
              any("not an allowed check program" in p for p in model_handoff.check(offpath, root)))
        empty = model_handoff.parse("# x\n## Goal\nsomething\n")
        check("missing files, steps and acceptance are each named",
              len(model_handoff.check(empty, root)) == 3)
        fenced = model_handoff.parse(GOOD.replace(
            "- `python3 tests/test_ship_dry_run.py`\n- `true`\n",
            "```\npython3 tests/test_ship_dry_run.py\ntrue\n```\n"))
        check("a fenced block is one command per line",
              fenced["acceptance"] == ["python3 tests/test_ship_dry_run.py", "true"]
              and model_handoff.check(fenced, root) == [])

        # A planted plan: every one of these must be refused as a check, and
        # accept() run on it directly must execute none of them.
        outside = Path(tempfile.mkdtemp())
        (outside / "evil.py").write_text("open('PWNED', 'w')\n")
        (root / "tests").mkdir()
        os.symlink(outside / "evil.py", root / "tests" / "link.py")
        hostile = [
            "true; touch PWNED", "true && touch PWNED", "true | sh", "true > PWNED",
            "grep $(touch PWNED) x", "grep `touch PWNED` x", "bash -c 'touch PWNED'",
            "sh -c touch", "python3 -c 'open(1)'", "node -e 1", "env touch PWNED",
            "xargs touch", "find . -exec touch PWNED", "/bin/sh x.sh", "../evil.sh",
            "python3 ../evil.py", f"python3 {outside}/evil.py", "PATH=/tmp true",
            "python3-evil x", "git -c core.pager=touch log", "git grep -Otouch x",
            "make SHELL=/tmp/x", "npx evil", "python3 tests/link.py", "python3 -m evilmod",
            "touch PWNED", "true\ntouch PWNED",
        ]
        let_through = [c for c in hostile
                       if model_handoff.argv_for(c, root, set())[0] is not None]
        check("every hostile check is refused as argv", let_through == [])
        if let_through:
            print("        let through:", let_through)
        trap = dict(model_handoff.parse(GOOD), acceptance=hostile)
        with open(os.devnull, "w") as sink:
            saved, sys.stdout = sys.stdout, sink
            try:
                code = model_handoff.accept(trap, root, yes=True)
            finally:
                sys.stdout = saved
        check("accept on a hostile page runs nothing and fails",
              code == 1 and not (root / "PWNED").exists() and not (outside / "PWNED").exists())
        check("a symlinked script that leaves the repo is refused",
              "outside the repo" in (model_handoff.argv_for("python3 tests/link.py", root, set())[1] or ""))

        # The writer: only plain names, only inside the handoff dir, never
        # through a symlink and never over an existing file.
        hdir = Path(tmp) / "handoffs"
        os.environ["CHEWBACCA_HANDOFF_DIR"] = str(hdir)
        refused = []
        for name in ("../escape", "/tmp/abs", "sub/x", ".hidden", "a..b", ""):
            try:
                model_handoff.save("x", name)
            except (ValueError, OSError):
                refused.append(name)
        check("save refuses .., absolute, nested and hidden names",
              len(refused) == 6 and not (Path(tmp) / "escape.md").exists())
        hdir.mkdir(parents=True, exist_ok=True)
        victim = outside / "victim.md"
        victim.write_text("keep")
        os.symlink(victim, hdir / "trap.md")
        try:
            model_handoff.save("overwritten", "trap")
            followed = True
        except (OSError, ValueError):
            followed = False
        check("save never writes through a symlink", not followed and victim.read_text() == "keep")
        first = model_handoff.save("one", "same")
        try:
            model_handoff.save("two", "same")
            clobbered = True
        except (OSError, ValueError):
            clobbered = False
        check("save never overwrites an existing page", not clobbered and first.read_text() == "one")
        check("a hostile title slugs to a plain name inside the dir",
              model_handoff.slug("../../etc/passwd") == "etc-passwd"
              and model_handoff.save("x", model_handoff.slug("../../etc/passwd")).parent == hdir)

        tier = lambda c, p=0.9: model_handoff.recommend(plan, ask=stub(c, p))["model"]  # noqa: E731
        check("implementation builds on sonnet", tier("implementation") == "sonnet")
        check("mechanical builds on haiku", tier("mechanical") == "haiku")
        arch = model_handoff.recommend(plan, ask=stub("architecture", 0.9))
        check("architecture stays on opus and flags open design",
              arch["model"] == "opus" and arch["open_design"])
        check("Jev down falls back to sonnet",
              model_handoff.recommend(plan, ask=lambda s, q: None)["model"] == "sonnet")
        pinned = model_handoff.parse(GOOD + "\n## Tier\nhaiku\n")
        check("the plan's ## Tier wins over Jev",
              model_handoff.recommend(pinned, ask=stub("architecture", 1.0))["model"] == "haiku")
        check("build tiers cover exactly the router's classes",
              set(model_handoff.BUILD_TIER) == set(model_route_targets()))

        page = model_handoff.render(plan, model_handoff.recommend(plan, ask=stub("implementation", 0.9)))
        again = model_handoff.parse(page)
        check("the handoff page parses back to the same plan",
              (again["goal"], again["files"], again["steps"], again["acceptance"])
              == (plan["goal"], plan["files"], plan["steps"], plan["acceptance"]))
        check("the handoff page passes its own check", model_handoff.check(again, root) == [])
        check("the handoff names the tier and the stop rule",
              "fresh build session on sonnet" in page and "do not re-plan" in page)

        # The CLI, end to end. No key, so Jev abstains and nothing leaves the box.
        cli_dir = Path(tmp) / "cli-handoffs"
        env = dict(os.environ, TYPESAFE_API_KEY="", HOME=tmp, CLAUDE_CONFIG_DIR=tmp,
                   CHEWBACCA_HANDOFF_DIR=str(cli_dir))
        (root / "plan.md").write_text(GOOD)
        (root / "bad.md").write_text(GOOD.replace("- `true`", "- verify the UI by eye"))

        def cli(*args):
            return subprocess.run([str(ROOT / "bin/model-route"), *args], text=True, cwd=root,
                                  capture_output=True, env=env, timeout=30)
        out = cli("handoff", "plan.md", "--out", "handoff")
        written = cli_dir / "handoff.md"
        check("handoff writes a page inside the handoff dir", out.returncode == 0 and written.is_file())
        check("--save names the page from the title",
              cli("handoff", "plan.md", "--save").returncode == 0
              and (cli_dir / "add-a-dry-run-flag-to-ship.md").is_file())
        esc = cli("handoff", "plan.md", "--out", "../../escaped")
        check("--out with a path is refused and writes nothing",
              esc.returncode == 1 and not (Path(tmp) / "escaped.md").exists())
        bad = cli("handoff", "bad.md", "--out", "bad-handoff")
        check("handoff refuses a prose check and writes nothing",
              bad.returncode == 1 and "prose" in bad.stderr and not (cli_dir / "bad-handoff.md").exists())
        check("check passes the written handoff", cli("check", str(written)).returncode == 0)
        j = cli("handoff", "plan.md", "--json", "--tier", "haiku")
        data = json.loads(j.stdout) if j.returncode == 0 else {}
        check("--json carries model, acceptance and the prompt",
              data.get("model") == "haiku" and data.get("acceptance") and "## Acceptance" in data.get("prompt", ""))
        check("an unknown --tier is a usage error", cli("handoff", "plan.md", "--tier", "gpt").returncode == 2)

        (root / "pass.md").write_text(GOOD.replace("`python3 tests/test_ship_dry_run.py`", "`true`"))
        (root / "fail.md").write_text(GOOD.replace("`python3 tests/test_ship_dry_run.py`", "`false`"))
        check("accept exits 0 when every check passes", cli("accept", "pass.md", "--yes").returncode == 0)
        failed = cli("accept", "fail.md", "--yes")
        check("accept exits 1 and names the failing check",
              failed.returncode == 1 and "FAIL" in failed.stdout and "false" in failed.stdout)
        check("accept refuses to run a page check would refuse", cli("accept", "bad.md", "--yes").returncode == 1)
        (root / "trap.md").write_text(GOOD.replace("`true`", "`true; touch PWNED`"))
        check("accept refuses a planted shell check and runs nothing",
              cli("accept", "trap.md", "--yes").returncode == 1 and not (root / "PWNED").exists())
        # (D) accept without --yes prints the exact argv and runs nothing.
        (root / "touchy.md").write_text(GOOD.replace("`true`", "`tests/mark.sh`")
                                        .replace("- bin/ship", "- bin/ship\n- tests/mark.sh"))
        (root / "tests" / "mark.sh").write_text("#!/bin/sh\n: > RAN\n")
        os.chmod(root / "tests" / "mark.sh", 0o755)
        dry = cli("accept", "touchy.md")
        check("accept without --yes prints each argv and runs nothing",
              dry.returncode == 3 and '["tests/mark.sh"]' in dry.stdout and not (root / "RAN").exists())
        check("accept --yes runs it", cli("accept", "touchy.md", "--yes").returncode == 1
              and (root / "RAN").exists())

        # (A) option values: matched on the name before "=", for every program.
        option_attacks = [
            "go test -exec=sh ./...", "go test -exec sh", "go test -toolexec=sh ./...",
            "go vet -vettool=/tmp/x ./...", "grep --pre=sh x tests", "grep --pre-glob=* x",
            "git diff --textconv", "git log --output=/tmp/x", "git diff -c core.pager=sh",
            "pytest -o addopts=-pevil", "pytest --rootdir=/tmp", "pytest -c /tmp/evil.ini",
            "pytest --config-file=/tmp/x", "pytest -pevil", "pytest --basetemp=/",
            "git status --hook=x", "tsc --outDir=/tmp", "go test -o=/tmp/x",
            "npm run evil", "cargo build", "git -C /tmp status", "cargo test --manifest-path=/tmp/C.toml",
        ]
        slipped = [c for c in option_attacks if model_handoff.argv_for(c, root, set())[0] is not None]
        check("option-value and wrapper bypasses are refused", slipped == [])
        if slipped:
            print("        let through:", slipped)
        check("plain test flags still pass",
              model_handoff.argv_for("git diff --exit-code --stat", root, set())[0] is not None
              and model_handoff.argv_for("grep -q -i -n x plan.md", root, set())[0] is not None
              and (not shutil.which("go") or model_handoff.argv_for("go test ./...", root, set())[0] is not None)
              and (not shutil.which("pytest") or model_handoff.argv_for("pytest -q -x", root, set())[0] is not None))

        # (B) a planned file under a symlinked directory resolves outside the repo.
        os.symlink(outside, root / "sub")
        planned_escape = model_handoff.argv_for("python3 sub/x.py", root, {"sub/x.py"})
        check("a planned script under a symlinked dir is refused",
              planned_escape[0] is None and "outside the repo" in planned_escape[1])
        # And the runner re-judges at run time: a script that passed check
        # and was swapped for an escaping symlink is refused, not run.
        (root / "tests" / "swap.py").write_text("print(1)\n")
        swap = dict(model_handoff.parse(GOOD), acceptance=["python3 tests/swap.py"])
        ok_before = model_handoff.check(swap, root) == []
        os.remove(root / "tests" / "swap.py")
        os.symlink(outside / "evil.py", root / "tests" / "swap.py")
        with open(os.devnull, "w") as sink:
            saved, sys.stdout = sys.stdout, sink
            try:
                code = model_handoff.accept(swap, root, yes=True)
            finally:
                sys.stdout = saved
        check("accept re-validates each check right before running it",
              ok_before and code == 1 and not (root / "PWNED").exists())

        # (C) a symlink anywhere from ~/.chewbacca down is refused.
        real = Path(tempfile.mkdtemp())
        linked = Path(tmp) / "linked-handoffs"
        os.symlink(real, linked)
        os.environ["CHEWBACCA_HANDOFF_DIR"] = str(linked)
        try:
            model_handoff.save("x", "page")
            wrote_through = True
        except (OSError, ValueError):
            wrote_through = False
        check("save refuses a symlinked handoff dir", not wrote_through and not any(real.iterdir()))
        fake_home = Path(tempfile.mkdtemp())
        os.symlink(real, fake_home / ".chewbacca")
        os.environ.pop("CHEWBACCA_HANDOFF_DIR")
        old_home, os.environ["HOME"] = os.environ.get("HOME"), str(fake_home)
        try:
            model_handoff.save("x", "page")
            wrote_through = True
        except (OSError, ValueError):
            wrote_through = False
        finally:
            os.environ["HOME"] = old_home or ""
        check("save refuses a symlinked ~/.chewbacca", not wrote_through and not any(real.iterdir()))
        check("a prompt starting with 'check' is still a prompt, not a subcommand",
              cli("check", "the", "logs").returncode == 0 and cli("check", "the", "logs").stdout.startswith("{"))
    print()
    print("model-route hands off only runnable plans" if not failures else f"{failures} failed")
    return failures


def model_route_targets():
    import model_route
    return model_route.TARGETS


if __name__ == "__main__":
    sys.exit(main())
