"""model-route handoff: a plan from the expensive tier becomes a page a fresh,
cheaper session can build from, and a plan whose acceptance checks are prose,
placeholders or missing scripts is refused. Offline: Jev is a stub or absent,
and no model is ever called."""
import json
import os
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
        check("a tool not on PATH is refused",
              any("not on PATH" in p for p in model_handoff.check(offpath, root)))
        empty = model_handoff.parse("# x\n## Goal\nsomething\n")
        check("missing files, steps and acceptance are each named",
              len(model_handoff.check(empty, root)) == 3)
        fenced = model_handoff.parse(GOOD.replace(
            "- `python3 tests/test_ship_dry_run.py`\n- `true`\n",
            "```\nFOO=1 python3 tests/test_ship_dry_run.py\ntrue\n```\n"))
        check("a fenced block is one command per line, env prefix allowed",
              fenced["acceptance"] == ["FOO=1 python3 tests/test_ship_dry_run.py", "true"]
              and model_handoff.check(fenced, root) == [])

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
        env = dict(os.environ, TYPESAFE_API_KEY="", HOME=tmp, CLAUDE_CONFIG_DIR=tmp)
        (root / "plan.md").write_text(GOOD)
        (root / "bad.md").write_text(GOOD.replace("- `true`", "- verify the UI by eye"))

        def cli(*args):
            return subprocess.run([str(ROOT / "bin/model-route"), *args], text=True, cwd=root,
                                  capture_output=True, env=env, timeout=30)
        out = cli("handoff", "plan.md", "--out", "handoff.md")
        check("handoff writes a page for a fresh session",
              out.returncode == 0 and (root / "handoff.md").is_file())
        bad = cli("handoff", "bad.md", "--out", "bad-handoff.md")
        check("handoff refuses a prose check and writes nothing",
              bad.returncode == 1 and "prose" in bad.stderr and not (root / "bad-handoff.md").exists())
        check("check passes the written handoff", cli("check", "handoff.md").returncode == 0)
        j = cli("handoff", "plan.md", "--json", "--tier", "haiku")
        data = json.loads(j.stdout) if j.returncode == 0 else {}
        check("--json carries model, acceptance and the prompt",
              data.get("model") == "haiku" and data.get("acceptance") and "## Acceptance" in data.get("prompt", ""))
        check("an unknown --tier is a usage error", cli("handoff", "plan.md", "--tier", "gpt").returncode == 2)

        (root / "pass.md").write_text(GOOD.replace("`python3 tests/test_ship_dry_run.py`", "`true`"))
        (root / "fail.md").write_text(GOOD.replace("`python3 tests/test_ship_dry_run.py`", "`false`"))
        check("accept exits 0 when every check passes", cli("accept", "pass.md").returncode == 0)
        failed = cli("accept", "fail.md")
        check("accept exits 1 and names the failing check",
              failed.returncode == 1 and "FAIL" in failed.stdout and "false" in failed.stdout)
        check("accept refuses to run a page check would refuse", cli("accept", "bad.md").returncode == 1)
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
