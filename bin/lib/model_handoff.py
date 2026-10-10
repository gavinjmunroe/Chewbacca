"""Hand a plan from the expensive tier to a fresh, cheaper build session.

    model-route handoff PLAN.md [--save | --out NAME] [--tier haiku|sonnet|opus] [--json]
    model-route check PLAN_OR_HANDOFF.md
    model-route accept HANDOFF.md [--root DIR] [--yes]

After Jordan Urbs' opencode milestone handoff: plan with a smart, expensive
model, save the plan to a file, and build it in a fresh session on a cheaper
one. The fresh session carries nothing but what is on the page, so the page
has to hold the goal, the files, the steps, and checks that prove it is done.

A check that is prose ("tests pass", "the UI looks right") is a judgment the
cheap tier makes about its own work, which is the one thing it should not be
trusted with. So `check` refuses any acceptance line that is not a command,
and `handoff` refuses to write a page `check` would refuse.

A plan is model-written, so a planted one can carry anything. Acceptance
checks are argv, never shell: no pipes, redirects, `;`, `&&`, substitutions or
env prefixes; argv[0] matches a fixed list exactly or is an executable inside
the repo; no interpreter -c, no wrapper that runs another program, and no
option that loads or writes elsewhere. Nothing runs at handoff time. `accept`
prints each argv and runs them without a shell only with --yes, because a
test is repo code: use it only in a repo you trust. Pages are
written only as new files inside ~/.chewbacca/handoffs: --save names the file
from the title, --out NAME picks a plain basename.

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
PLACEHOLDER = re.compile(r"<[^>\s]+>|\bTODO\b|\bTBD\b|(?<!/)\.\.\.|\bFIXME\b")
# Any of these means a shell would have to read the line. A check is an argv.
SHELL_META = re.compile(r"[;|&`$<>()\n\r\\*?{}~!#]")
# argv[0] must match one of these exactly. The value says what may follow:
# None is free arguments, a set is the allowed first argument, "script" means
# the first argument is a file inside the repo. Wrappers that run another
# program (env, xargs, find, sudo, npx, timeout) are deliberately absent, and
# so is make, whose VAR=value arguments can replace the shell it runs.
ALLOWED = {
    "true": None, "false": None, "test": None, "grep": None, "diff": None,
    "pytest": None, "tsc": None,
    "python3": "script", "python": "script", "bash": "script", "sh": "script",
    "zsh": "script", "node": "script",
    # npm run (any package.json script) and cargo build (build.rs only, no
    # tests) are left out. npm test and cargo test still run repo code, which
    # is what a test is: see accept().
    "npm": {"test"},
    "cargo": {"test", "check", "clippy"},
    "go": {"test", "vet"},
    "git": {"diff", "status", "grep", "log", "show"},
}
# Options that make an allowed program run, load or write something else.
# Matched on the option name before any "=", so -exec=sh and --pre=x are
# caught. A short option in OPT_SHORT is refused with an attached value too
# (-ofile, -cfoo, -Cdir). Interpreters never reach these: their first
# argument must be a repo script.
OPT_EXACT = {
    "-exec", "-execdir", "-ok", "-toolexec", "-vettool", "--ext-diff", "--textconv",
    "--pre", "--pre-glob", "--rootdir", "--basetemp", "--confcutdir", "--override-ini",
    "-modfile", "-overlay", "-pkgdir",
}
OPT_PREFIX = (
    "--exec", "--eval", "--out", "--config", "--hook", "--upload-pack", "--rcfile",
    "--init-file", "--command", "--require", "--import", "--loader",
    "--open-files-in-pager", "--junit", "--log-file", "--plugin", "--manifest-path",
    "--target-dir", "--project", "--outDir", "--outFile",
)
OPT_SHORT = ("-c", "-C", "-o", "-p", "-O", "-r")


def _forbidden_option(arg: str) -> bool:
    if not arg.startswith("-") or arg in ("-", "--"):
        return False
    name = arg.split("=", 1)[0]
    if name in OPT_EXACT or name.startswith(OPT_PREFIX):
        return True
    return not arg.startswith("--") and arg[:2] in OPT_SHORT
# python -m is allowed only for these test runners.
PYTHON_MODULES = {"pytest", "unittest", "py_compile"}
# A per-command bound for `accept`, so a hung check fails instead of wedging
# the build session. Guessed, never measured.
ACCEPT_TIMEOUT_S = 600
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def handoff_dir() -> Path:
    """The only place a page is written. CHEWBACCA_HANDOFF_DIR is for tests."""
    return Path(os.environ.get("CHEWBACCA_HANDOFF_DIR")
                or Path.home() / ".chewbacca" / "handoffs")


def parse(text: str) -> dict:
    """Split a plan into its sections. Unknown headings are ignored."""
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


def _repo_path(arg: str, root: Path, planned: set) -> str | None:
    """None when arg names a file inside root, or one the plan will create."""
    if not arg or os.path.isabs(arg) or ".." in Path(arg).parts or arg.startswith("-"):
        return f"{arg or 'the script'} is not a relative path inside the repo"
    target = root / arg
    # Resolve first, for planned files too: realpath follows every symlinked
    # directory on the way, so a planned sub/x.py under a sub -> /tmp link is
    # caught before it exists.
    if Path(os.path.realpath(root)) not in Path(os.path.realpath(target)).parents:
        return f"{arg} resolves outside the repo"
    if not target.exists() and not target.is_symlink():
        return None if arg in planned else f"{arg} does not exist and is not in Files"
    if not target.is_file():
        return f"{arg} is not a file"
    return None


def argv_for(command: str, root: Path, planned: set) -> tuple:
    """(argv, None) when the check is allowed, else (None, why)."""
    if command.startswith("PROSE: "):
        return None, "prose, not a command: " + command[7:]
    if PLACEHOLDER.search(command):
        return None, "placeholder left in: " + command
    if SHELL_META.search(command):
        return None, "shell syntax is not allowed, one plain command per line: " + command
    try:
        argv = shlex.split(command)
    except ValueError as exc:
        return None, f"does not parse as a command ({exc}): {command}"
    if not argv:
        return None, "empty command"
    head, rest = argv[0], argv[1:]
    if "=" in head:
        return None, "environment prefixes are not allowed: " + command
    bad = next((a for a in rest if _forbidden_option(a)), None)
    if bad:
        return None, f"{bad} lets {head} run something else: {command}"
    if "/" in head:
        why = _repo_path(head, root, planned)
        if why:
            return None, why + ": " + command
        if (root / head).exists() and not os.access(root / head, os.X_OK):
            return None, f"{head} is not executable: {command}"
        return argv, None
    if head not in ALLOWED:
        return None, f"{head} is not an allowed check program: {command}"
    if shutil.which(head) is None and head not in ("true", "false", "test"):
        return None, f"{head} is not on PATH: {command}"
    rule = ALLOWED[head]
    if isinstance(rule, set) and (not rest or rest[0] not in rule):
        return None, f"{head} allows only {', '.join(sorted(rule))}: {command}"
    if rule == "script":
        if head.startswith("python") and rest[:1] == ["-m"]:
            if rest[1:2] and rest[1] in PYTHON_MODULES:
                return argv, None
            return None, f"python -m allows only {', '.join(sorted(PYTHON_MODULES))}: {command}"
        why = _repo_path(rest[0] if rest else "", root, planned)
        if why:
            return None, why + ": " + command
    return argv, None


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
        _, why = argv_for(command, root, planned)
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
             "(`model-route accept PAGE --yes` runs them all as argv).", ""]
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


def accept(plan: dict, root: Path, yes: bool = False) -> int:
    """Run each check as an argv, never through a shell.

    This runs repo code by definition: an interpreter on a repo script, a
    pytest conftest, an npm test script. So it prints every argv first and
    runs nothing without yes. Each check goes through argv_for, the same
    function `check` uses, immediately before its own subprocess.run, so a
    page or a symlink changed after `check` is judged again at run time."""
    planned = set(plan["files"])
    print("model-route accept runs these as argv, no shell, in " + str(root) + ":")
    for command in plan["acceptance"]:
        argv, why = argv_for(command, root, planned)
        print("  " + (json.dumps(argv) if argv else "refused: " + str(why)))
    if not yes:
        print("model-route: nothing run. These execute repo code; pass --yes only in a repo you trust.")
        return 3
    failed = 0
    for command in plan["acceptance"]:
        argv, why = argv_for(command, root, planned)
        if argv is None:
            print(f"  FAIL  refused: {why}")
            failed += 1
            continue
        if "/" in argv[0]:
            argv[0] = str(root / argv[0])
        try:
            code = subprocess.run(argv, cwd=root, timeout=ACCEPT_TIMEOUT_S).returncode
        except FileNotFoundError:
            code = 127
        except subprocess.TimeoutExpired:
            code = 124
        print(("  ok    " if code == 0 else f"  FAIL  ({code}) ") + command)
        failed += code != 0
    print(f"{len(plan['acceptance']) - failed}/{len(plan['acceptance'])} acceptance checks pass")
    return 1 if failed else 0


def slug(title: str) -> str:
    words = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60].strip("-")
    return words or "handoff"


def save(page: str, name: str) -> Path:
    """Write the page as a new file directly inside handoff_dir(), the only
    file this tool writes. The name must be a plain basename. The directories
    from ~/.chewbacca down (or the override dir itself) are walked one at a
    time by file descriptor with O_NOFOLLOW, so a symlink anywhere on that
    path is refused, and the page is created O_EXCL so nothing is overwritten."""
    if not name.endswith(".md"):
        name += ".md"
    if not SAFE_NAME.match(name) or ".." in name:
        raise ValueError(f"handoff name {name!r} must be a plain file name")
    override = os.environ.get("CHEWBACCA_HANDOFF_DIR")
    if override:
        base, parts = Path(override).parent, [Path(override).name]
    else:
        base, parts = Path.home(), [".chewbacca", "handoffs"]
    dir_flags = os.O_RDONLY | os.O_DIRECTORY
    fd = os.open(base, dir_flags)
    try:
        for part in parts:
            try:
                os.mkdir(part, 0o700, dir_fd=fd)
            except FileExistsError:
                pass
            try:
                child = os.open(part, dir_flags | os.O_NOFOLLOW, dir_fd=fd)
            except OSError as exc:
                raise ValueError(f"{base / part} is a symlink or not a directory") from exc
            os.close(fd)
            fd, base = child, base / part
        out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    finally:
        os.close(fd)
    with os.fdopen(out, "w") as fh:
        fh.write(page)
    return base / name


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
    to_dir = "--save" in argv
    yes = "--yes" in argv
    argv = [a for a in argv if a not in ("--json", "--save", "--yes")]
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
        return accept(plan, root, yes=yes)
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
    elif out or to_dir:
        try:
            path = save(page, out or slug(plan["title"]))
        except (ValueError, OSError) as exc:
            print(f"model-route: refused to write: {exc}", file=sys.stderr)
            return 1
        print(f"model-route: wrote {path} for a fresh {tier['model']} session ({tier['why']})")
    else:
        print(page)
    return 0
