#!/usr/bin/env python3
"""Every guard, router and classifier ships with its replay or sealed eval.

Reengineer step 16. hookd landed with a replay of real calls (48050857) and
brain-recall's flip waits on a sealed set (recall_gate.py). Before this, the
habit was optional: of 39 guards, routers and classifiers first added to main
between 2026-09-28 and 2026-10-12, 1 had a replay when it landed (the gated
attribution-guard) and none had a sealed eval. This makes it the default:
`verify` fails when a decision component is on disk with no eval and isn't on
the frozen grandfathered list.

    tools/decision_evals.py count [--json]     the number step 16 names
    tools/decision_evals.py verify [--base REF] fail on a new component with no eval
    tools/decision_evals.py list                every component and what covers it

WHAT IS A COMPONENT (discover()):
  guard       a .claude/hooks file named *-guard or *-gate, or one that can refuse
              (exit 2, permissionDecision deny, decision block)
  router      a hook, bin/, bin/lib/, tools/ or crates/ file whose name says route,
              router or routing
  classifier  the same places, named classify, intent, judge, score or triage
  plus anything listed by hand under "components" in the registry.

WHAT COUNTS AS AN EVAL:
  replay  real recorded inputs run through the component in the suite. A hook
          with a `# gate:` header has one already: tests/test_hookd_replay.py
          replays the 800-call corpus through every gated guard. Anything else
          names its test and its corpus in the registry; the test must name the
          component and the corpus, and be wired into tests/run.sh or pre-push.
  sealed  a held-out labeled set scored by a script with a floor. The registry
          names the script (it must name the component) and where the set lives;
          private sets live outside the repo, so only an in-repo set is checked.

The grandfathered list is everything on main on 2026-10-12 that had neither.
It may only shrink: `verify --base origin/main` fails on a name the base
doesn't list, and on a grandfathered name that has since gained an eval.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY_REL = "docs/plans/decision-evals.json"
REPLAY_TEST = "tests/test_hookd_replay.py"
REPLAY_CORPUS = "tests/fixtures/hookd-replay/bash.jsonl"
KINDS = ("guard", "router", "classifier")
SCAN = (".claude/hooks/", "bin/", "tools/", "crates/")
# The HUD lane belongs to another overnight chain (reengineer plan, step 11);
# its files are neither read here nor gated, so this can't refuse its lands.
OTHER_LANE = re.compile(r"^(hud/|skills/hud/|bin/kyber-surfaces|bin/[^/]*-engine$|bin/lib/realm_ui/)")
# Every refusal spelling the kit's hooks use (review of 812b84a1, 2026-10-12):
# kit-debt.sh blocks with jq's unquoted `decision: "block"`, hookd-fallback.sh
# with Python's sys.exit(2), write-log.sh passes a tool's code on as `exit $?`.
REFUSES = re.compile(r"\bexit\s+(2\b|\"?\$)|sys\.exit\(\s*2\s*\)|permissionDecision\W{0,4}deny"
                     r"|\bdecision[\"']?\s*:\s*[\"']block")
ROUTER = re.compile(r"rout(e|er|ing)")
# score only as its own word: scoreboard.py is not a classifier.
CLASSIFIER = re.compile(r"classif|intent|judge|triage|(^|[-_])scor(e|er|ing)($|[-_])")
# A component's own eval or tuner is not a component.
NOT_A_COMPONENT = re.compile(r"eval|tune|test")
DATA = {".md", ".json", ".jsonl", ".toml", ".lock", ".txt", ".yml", ".yaml", ".tsv", ".csv"}


def tracked(root: Path) -> list:
    out = subprocess.run(["git", "-C", str(root), "ls-files", "--", *SCAN],
                         capture_output=True, text=True).stdout.split("\n")
    return [f for f in out if f]


def discover(root: Path = ROOT, files=None) -> dict:
    """{path: kind} for every guard, router and classifier on disk."""
    found = {}
    for f in files if files is not None else tracked(root):
        p = root / f
        stem = p.stem
        if OTHER_LANE.match(f) or "/tests/" in f or p.suffix in DATA or not p.is_file():
            continue
        if f.startswith(".claude/hooks/") and stem != "lib":
            # A hook that can refuse is a guard whatever its name says.
            # A comment that mentions exit 2 refuses nothing.
            text = "\n".join(line for line in p.read_text(errors="replace").splitlines()
                              if not line.lstrip().startswith("#"))
            if re.search(r"-(guard|gate)$", stem) or REFUSES.search(text):
                found[f] = "guard"
                continue
        if NOT_A_COMPONENT.search(stem):
            continue
        if ROUTER.search(stem):
            found[f] = "router"
        elif CLASSIFIER.search(stem):
            found[f] = "classifier"
    return found


def gated(root: Path, path: str) -> bool:
    """The same test hookd_replay.gated_hooks uses to pick what it replays:
    a .sh hook with a `# gate:` or `# gate-file:` line."""
    p = root / path
    if not path.startswith(".claude/hooks/") or p.suffix != ".sh" or not p.is_file():
        return False
    return re.search(r"^# gate(?:-file)?:", p.read_text(errors="replace"), re.M) is not None


def wired(root: Path, test: str) -> bool:
    """A test nothing runs proves nothing (feedback_built_but_never_fires)."""
    for runner in ("tests/run.sh", ".githooks/pre-push"):
        r = root / runner
        if r.is_file() and test in r.read_text(errors="replace"):
            return True
    return False


def load(root: Path = ROOT) -> dict:
    return json.loads((root / REGISTRY_REL).read_text())


def base_registry(root: Path, ref: str):
    out = subprocess.run(["git", "-C", str(root), "show", f"{ref}:{REGISTRY_REL}"],
                         capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout)


def eval_problems(root: Path, path: str, ev: dict) -> list:
    name = Path(path).name
    stem = Path(path).stem
    out = []
    kind = ev.get("type")
    if path in (ev.get("script"), ev.get("test")):
        return [f"{path}: names itself as its own eval"]
    if kind == "replay":
        test, corpus = ev.get("test", ""), ev.get("corpus", "")
        if not (root / test).is_file():
            return [f"{path}: replay test {test!r} does not exist"]
        body = (root / test).read_text(errors="replace")
        if name not in body and stem not in body and stem.replace("-", "_") not in body:
            out.append(f"{path}: {test} never names it")
        c = root / corpus
        if not corpus or not c.exists() or (c.is_file() and c.stat().st_size == 0):
            out.append(f"{path}: replay corpus {corpus!r} is missing or empty")
        elif Path(corpus).name not in body and corpus not in body:
            out.append(f"{path}: {test} never reads its corpus {corpus}")
        if not wired(root, test):
            out.append(f"{path}: {test} is not run by tests/run.sh or pre-push")
    elif kind == "sealed":
        script, where = ev.get("script", ""), ev.get("set", "")
        if not (root / script).is_file():
            return [f"{path}: sealed eval {script!r} does not exist"]
        body = (root / script).read_text(errors="replace")
        if name not in body and stem not in body and stem.replace("-", "_") not in body:
            out.append(f"{path}: {script} never names it")
        if not where:
            out.append(f"{path}: sealed eval names no set")
        elif not where.startswith("~") and not (root / where).exists():
            out.append(f"{path}: sealed set {where} does not exist")
        if not ev.get("floor"):
            out.append(f"{path}: sealed eval names no floor")
    else:
        out.append(f"{path}: eval type {kind!r} is neither replay nor sealed")
    return out


def coverage(root: Path, reg: dict) -> dict:
    """{path: (kind, how)} where how is gated, replay, sealed or None."""
    evals = reg.get("evals", {})
    # A component's own eval script is not a component.
    # Never a path that is itself under evals: a router named as its own
    # script would vanish from discovery (review of 812b84a1).
    scripts = {ev.get("script") or ev.get("test") for ev in evals.values()} - set(evals)
    found = {p: k for p, k in discover(root).items() if p not in scripts}
    for path, kind in reg.get("components", {}).items():
        if (root / path).exists():
            found.setdefault(path, kind)
    out = {}
    for path, kind in sorted(found.items()):
        if gated(root, path):
            out[path] = (kind, "gated")
        elif path in evals:
            out[path] = (kind, evals[path].get("type"))
        else:
            out[path] = (kind, None)
    return out


def problems(root: Path = ROOT, reg=None, base=None) -> list:
    reg = reg if reg is not None else load(root)
    out = []
    grand = set(reg.get("grandfathered", []))
    evals = reg.get("evals", {})
    cov = coverage(root, reg)
    for path, (kind, how) in cov.items():
        if how is None and path not in grand:
            out.append(f"{path}: a new {kind} with no replay or sealed eval. Give it a `# gate:` "
                       f"header (hooks on Bash) or add its replay test and corpus, or its sealed "
                       f"eval, under evals in {REGISTRY_REL}")
        if how is not None and path in grand:
            out.append(f"{path}: has an eval ({how}) now, take it off grandfathered")
    for path, ev in evals.items():
        if not (root / path).exists():
            out.append(f"{path}: listed under evals but gone")
            continue
        out += eval_problems(root, path, ev)
    for path in sorted(grand):
        if not (root / path).exists():
            out.append(f"{path}: grandfathered but gone, take it off the list")
    for path, kind in reg.get("components", {}).items():
        if kind not in KINDS:
            out.append(f"{path}: unknown kind {kind!r}")
    if base is not None:
        added = grand - set(base.get("grandfathered", []))
        for path in sorted(added):
            out.append(f"{path}: grandfathered here but not on the base; the list only shrinks")
        # A hand-listed component or eval can't quietly drop off either.
        for key in ("components", "evals"):
            for path in sorted(set(base.get(key, {})) - set(reg.get(key, {}))):
                if (root / path).exists():
                    out.append(f"{path}: listed under {key} on the base, dropped here")
    return out


def count(cov: dict) -> dict:
    by = {}
    for path, (kind, how) in cov.items():
        k = by.setdefault(kind, {"total": 0, "with_eval": 0})
        k["total"] += 1
        k["with_eval"] += how is not None
    total = len(cov)
    with_eval = sum(1 for _, how in cov.values() if how is not None)
    return {"components": total, "with_eval": with_eval, "without": total - with_eval, "by_kind": by}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["count", "verify", "list"])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--base", help="a git ref whose grandfathered list this one may only shrink")
    a = ap.parse_args(argv)
    reg = load(a.root)
    cov = coverage(a.root, reg)
    if a.cmd == "list":
        for path, (kind, how) in cov.items():
            print(f"{kind:10} {how or '-':7} {path}")
        return 0
    if a.cmd == "count":
        c = count(cov)
        if a.json:
            print(json.dumps(c))
        else:
            print(f"{c['with_eval']} of {c['components']} guards, routers and classifiers have a replay "
                  f"or sealed eval; {c['without']} grandfathered from before 2026-10-12")
        return 0
    base = None
    if a.base:
        base = base_registry(a.root, a.base)
        if base is None:
            print(f"decision-evals: {a.base} has no {REGISTRY_REL}, list not compared", file=sys.stderr)
    bad = problems(a.root, reg, base)
    for b in bad:
        print(f"decision-evals: {b}", file=sys.stderr)
    if not bad:
        c = count(cov)
        print(f"decision-evals: ok, {c['with_eval']} of {c['components']} with an eval, none new without one")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
