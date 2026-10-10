"""Hand a plan from the expensive tier to a fresh, cheaper build session.

    model-route handoff PLAN.md [--out FILE] [--tier haiku|sonnet|opus] [--json]
    model-route check PLAN_OR_HANDOFF.md
    model-route accept HANDOFF.md [--root DIR]

After Jordan Urbs' opencode milestone handoff: plan with a smart, expensive
model, save the plan to a file, and build it in a fresh session on a cheaper
one. The fresh session carries nothing but what is on the page, so the page
has to hold the goal, the files, the steps, and checks that prove it is done.

A check that is prose ("tests pass", "the UI looks right") is a judgment the
cheap tier makes about its own work, which is the one thing it should not be
trusted with. So `check` refuses any acceptance line that is not a command a
shell can run, and `handoff` refuses to write a page `check` would refuse.

Plan format, the same headings in and out so one parser reads both:

    # Title
    ## Goal        what done means, in a sentence or two
    ## Files       one path per line, "- path"
    ## Steps       numbered or bulleted
    ## Acceptance  one command per line, in backticks or a fenced block
    ## Tier        optional: haiku, sonnet or opus to pin the build model
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_route  # noqa: E402

SECTIONS = ("goal", "files", "steps", "acceptance", "tier")
TIERS = ("haiku", "sonnet", "opus")
# What Jev's class means for the build session once a plan exists. Planning
# already spent the deep reasoning, so implementation and debugging drop to
# sonnet. Architecture or extreme on a finished plan means the plan still
# leaves design open: the build tier stays opus and the handoff says so.
BUILD_TIER = {
    "mechanical": "haiku",
    "implementation": "sonnet",
    "debugging": "sonnet",
    "architecture": "opus",
    "extreme": "opus",
}
# Guessed, never measured: with Jev unavailable, sonnet is the cheaper tier
# that still writes code; haiku only when Jev or the plan says mechanical.
DEFAULT_TIER = "sonnet"
INTERPRETERS = {"python", "python3", "bash", "sh", "zsh", "node", "ruby", "perl"}
PLACEHOLDER = re.compile(r"<[^>\s]+>|\bTODO\b|\bTBD\b|\.\.\.|\bFIXME\b")
# A per-command bound for `accept`, so a hung check fails instead of wedging
# the build session. Guessed, never measured.
ACCEPT_TIMEOUT_S = 600


def parse(text: str) -> dict:
    """Split a plan into its sections. Unknown headings are kept as notes."""
    plan = {"title": "", "goal": "", "files": [], "steps": [], "acceptance": [], "tier": ""}
    current = None
    fenced = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.strip().startswith("```"):
            fenced = not fenced
            continue
        if not fenced and line.startswith("# ") and not plan["title"]:
            plan["title"] = line[2:].strip()
            continue
        if not fenced and line.startswith("## "):
            name = line[3:].strip().lower().split()[0] if line[3:].strip() else ""
            current = name if name in SECTIONS else None
            continue
        if current is None or not line.strip():
            continue
        body = line.strip()
        if current == "goal":
            plan["goal"] = (plan["goal"] + " " + body).strip()
        elif current == "tier":
            plan["tier"] = plan["tier"] or body.strip("`* ").lower()
        elif current == "files":
            item = re.sub(r"^[-*]\s+", "", body).strip()
            item = item.split()[0].strip("`") if item else ""
            if item:
                plan["files"].append(item)
        elif current == "steps":
            plan["steps"].append(re.sub(r"^([-*]|\d+[.)])\s+", "", body))
        elif current == "acceptance":
            plan["acceptance"].append(_command(body, fenced))
    return plan


def _command(body: str, fenced: bool) -> str:
    """The command an acceptance line names. A line with no backticks outside
    a fence stays as prose, so the checker can refuse it by name."""
    if fenced:
        return body
    body = re.sub(r"^([-*]|\d+[.)])\s+", "", body)
    ticks = re.findall(r"`([^`]+)`", body)
    return ticks[0].strip() if ticks else "PROSE: " + body


def _runnable(command: str, root: Path, planned: set) -> str | None:
    """None when the command can run; otherwise why it cannot."""
    if command.startswith("PROSE: "):
        return "prose, not a command: " + command[7:]
    if PLACEHOLDER.search(command):
        return "placeholder left in: " + command
    try:
        argv = shlex.split(command)
    except ValueError as exc:
        return f"does not parse as a shell command ({exc}): {command}"
    while argv and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", argv[0]):
        argv = argv[1:]
    if not argv:
        return "empty command"
    head = argv[0]
    if "/" in head:
        path = (root / head) if not os.path.isabs(head) else Path(head)
        if head not in planned and not (path.is_file() and os.access(path, os.X_OK)):
            return f"{head} is not an executable file and not in Files: {command}"
    elif shutil.which(head) is None and head not in {"cd", "test", "[", "true", "false"}:
        return f"{head} is not on PATH: {command}"
    if os.path.basename(head) in INTERPRETERS:
        script = next((a for a in argv[1:] if not a.startswith("-")), None)
        if script and ("/" in script or script.endswith((".py", ".sh", ".js"))):
            if script not in planned and not (root / script).exists():
                return f"{script} does not exist and is not in Files: {command}"
    return None


def check(plan: dict, root: Path) -> list:
    """Every reason a fresh session could not finish this plan unaided."""
    problems = []
    if not plan["goal"]:
        problems.append("no ## Goal: the build session cannot tell when it is done")
    if not plan["files"]:
        problems.append("no ## Files: the build session would have to re-plan where to work")
    if not plan["steps"]:
        problems.append("no ## Steps")
    if not plan["acceptance"]:
        problems.append("no ## Acceptance: nothing proves the build is done")
    if plan["tier"] and plan["tier"] not in TIERS:
        problems.append(f"## Tier is {plan['tier']!r}, expected one of {', '.join(TIERS)}")
    planned = set(plan["files"])
    for command in plan["acceptance"]:
        why = _runnable(command, root, planned)
        if why:
            problems.append("acceptance " + why)
    return problems


def recommend(plan: dict, ask=None, override: str = "") -> dict:
    """{"model", "why", "class", "open_design"}: the cheaper tier to build in."""
    if override:
        return {"model": override, "why": "pinned by --tier", "class": None, "open_design": False}
    if plan["tier"] in TIERS:
        return {"model": plan["tier"], "why": "pinned by the plan's ## Tier",
                "class": None, "open_design": False}
    text = plan["goal"] + "\n" + "\n".join(plan["steps"])
    judged = model_route.classify(text, ask=ask)
    cls = judged["class"]
    if cls is None:
        return {"model": DEFAULT_TIER, "why": "Jev abstained or is unavailable; default build tier",
                "class": None, "open_design": False}
    return {"model": BUILD_TIER[cls], "class": cls, "open_design": cls in ("architecture", "extreme"),
            "why": f"Jev reads the plan as {cls} work ({judged['confidence']:.2f})"}


def render(plan: dict, tier: dict) -> str:
    lines = [f"# {plan['title'] or 'Build handoff'}", "",
             f"<!-- model-route handoff v1 model={tier['model']} -->", "",
             f"You are a fresh build session on {tier['model']}. The plan below was written by a",
             "more expensive model and is settled. Build it; do not re-plan it. If a step turns",
             "out to be wrong, stop and report what contradicts the plan instead of redesigning.",
             "You are done only when every acceptance command exits 0, run from the repo root",
             "(`model-route accept` on this page runs them all).", ""]
    if tier["open_design"]:
        lines += ["Warning: Jev reads this plan as still carrying design work, so the build",
                  "tier stayed at opus. Finish the plan first if you can.", ""]
    lines += ["## Goal", "", plan["goal"], "", "## Files", ""]
    lines += [f"- {f}" for f in plan["files"]]
    lines += ["", "## Steps", ""]
    lines += [f"{i}. {s}" for i, s in enumerate(plan["steps"], 1)]
    lines += ["", "## Acceptance", "", "```"]
    lines += plan["acceptance"]
    lines += ["```", "", "## Tier", "", tier["model"], ""]
    return "\n".join(lines)


def accept(plan: dict, root: Path) -> int:
    failed = 0
    for command in plan["acceptance"]:
        try:
            code = subprocess.run(command, shell=True, cwd=root, timeout=ACCEPT_TIMEOUT_S).returncode
        except subprocess.TimeoutExpired:
            code = 124
        print(("  ok    " if code == 0 else f"  FAIL  ({code}) ") + command)
        failed += code != 0
    print(f"{len(plan['acceptance']) - failed}/{len(plan['acceptance'])} acceptance checks pass")
    return 1 if failed else 0


def _opt(argv: list, name: str) -> str:
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            value = argv[i + 1]
            del argv[i:i + 2]
            return value
    return ""


def main(argv: list, ask=None) -> int:
    argv = list(argv)
    cmd = argv.pop(0)
    out = _opt(argv, "--out")
    override = _opt(argv, "--tier").lower()
    root = Path(_opt(argv, "--root") or os.getcwd())
    as_json = "--json" in argv
    argv = [a for a in argv if a != "--json"]
    if not argv:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    if override and override not in TIERS:
        print(f"model-route: --tier must be one of {', '.join(TIERS)}", file=sys.stderr)
        return 2
    plan = parse(Path(argv[0]).read_text())
    problems = check(plan, root)
    if problems:
        print(f"model-route: refused, {len(problems)} problem(s) in {argv[0]}:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        return 1
    if cmd == "accept":
        # Only a page that passed check runs: these are the planner's own
        # shell commands, executed as written, which is the point of them.
        return accept(plan, root)
    if cmd == "check":
        print(f"model-route: {argv[0]} is a complete handoff "
              f"({len(plan['acceptance'])} runnable acceptance checks)")
        return 0
    tier = recommend(plan, ask=ask, override=override)
    page = render(plan, tier)
    if as_json:
        print(json.dumps({"model": tier["model"], "why": tier["why"], "class": tier["class"],
                          "open_design": tier["open_design"], "files": plan["files"],
                          "acceptance": plan["acceptance"], "prompt": page}))
    elif out:
        Path(out).write_text(page)
        print(f"model-route: wrote {out} for a fresh {tier['model']} session ({tier['why']})")
    else:
        print(page)
    return 0
