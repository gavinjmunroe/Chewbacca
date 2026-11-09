#!/usr/bin/env python3
"""Stranger install stopwatch: a new dev's first minutes with the kit, timed
and counted, on this Mac, without touching this Mac's own install.

    python3 tools/stranger_run.py [--kit <git url or path>] [--ref <ref>]
                                  [--sample <public repo url>] [--keep] [--json]

What it does, in a scratch HOME (mktemp -d) with no brain and no ~/.chewbacca:
  readme       asks GitHub for the README's install script, the way curl would
  clone        clones the kit (the public URL first; --kit when that fails)
  sample       clones a small public repo to work in
  setup        bash setup.sh --runtime claude-code, stdin closed
  first-session  runs the SessionStart hooks setup registered, as a first
               session would, and notes any folder they wrote nobody chose
  brakes       hands the registered PreToolUse hooks `rm -rf ~` and a force
               push to main, and notes which are allowed
  agents       runs the command setup printed for the agents page, with
               --print-url (a browser tab here would take the screen)
  first-turn   headless WebKit loads that address, starts an agent in the
               sample repo and asks it one thing, timing the first answer
  doctor       bash doctor.sh, exit code and what it says to fix

Every child runs under sandbox-exec: no writes to the real HOME or to the
host's Homebrew and /usr/local (where node and its global packages live), no
launchctl and no open, so the host's install, its daemon, its LaunchAgents
and its screen are out of reach. Writes elsewhere (temp folders) are allowed. The rig's own differences from a
stranger's Mac, and nothing else, are listed under `rig` in the result: the
fake agent (no model account in a scratch HOME) and a page port off the
host's own server.

The result is one JSON row, printed and appended to
~/.chewbacca/bench/stranger.jsonl, so runs accumulate toward the 30 the MOG
plan asks for before a latency is quoted (tools/proof_stats.py).
Exit codes: 0 reached a first answer, 1 did not, 2 usage.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
REAL_HOME = Path.home()
PUBLIC_KIT = "https://github.com/calebnewtonusc/Chewbacca"
README_INSTALL = "https://raw.githubusercontent.com/calebnewtonusc/Chewbacca/main/start.sh"
# Small, public, MIT, no build step: the 10/12 run used it too, so the two
# runs compare.
SAMPLE_REPO = "https://github.com/sindresorhus/slugify"
ASK = "Add a one-line note to the README saying where the tests live. Keep it small."
# The PATH a dev with Homebrew's node has. The host's nvm folders are left
# out on purpose: a stranger's pnpm is not on it, which is the corepack path.
STRANGER_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# Output lines that are a person being asked something. Stdin is closed, so
# any of these is a prompt a stranger would have had to answer.
PROMPT = re.compile(r"(\[y/n\]|\(y/n\)|\[Y/n\]|\[y/N\]|press enter|continue\?|proceed\?)", re.I)
ERROR = re.compile(r"(^|\W)(error|failed|traceback|command not found|no such file|fatal:)(\W|$)", re.I)
# Error-shaped lines that are not errors: setup's own summary words.
NOT_ERROR = re.compile(r"(0 failed|no errors|error states|errors? are|on error)", re.I)
# How long each step may take before it counts as hung. The 10/12 run built
# the engine in 23 s and the page in 55 s with warm caches; a cold pnpm and
# npm download on a home connection is guessed at under 10 minutes.
STEP_TIMEOUT_S = 900


def sandbox_profile(scratch: Path) -> str:
    """Writes only under scratch and the temp folders; no launchctl, no open."""
    tmp = Path(tempfile.gettempdir()).resolve()
    return "\n".join([
        "(version 1)",
        "(allow default)",
        f'(deny file-write* (subpath "{REAL_HOME.resolve()}"))',
        '(deny file-write* (subpath "/opt/homebrew"))',
        '(deny file-write* (subpath "/usr/local"))',
        f'(allow file-write* (subpath "{scratch.resolve()}"))',
        f'(allow file-write* (subpath "{tmp}"))',
        '(deny process-exec (literal "/bin/launchctl"))',
        '(deny process-exec (literal "/usr/bin/open"))',
    ])


def stranger_env(scratch: Path, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = {
        "HOME": str(scratch),
        "PATH": STRANGER_PATH,
        "TMPDIR": str(scratch / "tmp"),
        "LANG": "en_US.UTF-8",
        "USER": os.environ.get("USER", "stranger"),
        "SHELL": "/bin/zsh",
        "TERM": "dumb",
        "CHEWBACCA_NO_SEND": "1",
        "COREPACK_ENABLE_DOWNLOAD_PROMPT": "0",
    }
    env.update(extra or {})
    return env


def classify(text: str) -> Dict[str, List[str]]:
    """The prompts and errors in a step's output, one line each."""
    prompts, errors = [], []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if PROMPT.search(s):
            prompts.append(s[:200])
        if ERROR.search(s) and not NOT_ERROR.search(s):
            errors.append(s[:200])
    return {"prompts": prompts, "errors": errors}


class Run:
    def __init__(self, scratch: Path, profile: Path, rig_env: Dict[str, str]):
        self.scratch = scratch
        self.profile = profile
        self.rig_env = rig_env
        self.steps: List[dict] = []

    def sh(self, step: str, argv: List[str], cwd: Optional[Path] = None, stdin: str = "",
           timeout: float = STEP_TIMEOUT_S, extra_env: Optional[Dict[str, str]] = None,
           expect_ok: bool = True) -> dict:
        env = stranger_env(self.scratch, {**self.rig_env, **(extra_env or {})})
        started = time.time()
        try:
            done = subprocess.run(["/usr/bin/sandbox-exec", "-f", str(self.profile)] + argv,
                                  cwd=str(cwd or self.scratch), env=env, input=stdin,
                                  capture_output=True, text=True, timeout=timeout)
            code, out = done.returncode, (done.stdout or "") + (done.stderr or "")
        except subprocess.TimeoutExpired as err:
            code = -1
            out = ((err.stdout or b"").decode("utf-8", "replace") if isinstance(err.stdout, bytes) else (err.stdout or ""))
            out += f"\nstranger_run: {step} hung past {timeout:.0f} s"
        row = {"step": step, "seconds": round(time.time() - started, 2), "exit": code, **classify(out),
               "tail": out.strip().splitlines()[-6:]}
        if expect_ok and code != 0 and not row["errors"]:
            row["errors"].append(f"exit {code}")
        self.steps.append(row)
        return {**row, "out": out}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def agents_command(setup_out: str, kit: Path) -> Optional[List[str]]:
    """The command setup told the stranger to run for the agents page."""
    m = re.search(r"^Agents page: (.+?) (?:puts|opens)", setup_out, re.M)
    if not m:
        return None
    words = m.group(1).strip().split()
    if words[0] == "chewbacca":
        words[0] = str(kit / "bin" / "chewbacca")
    return [w.strip("'") for w in words]


def folders_written(scratch: Path, before: set) -> List[str]:
    return sorted(p.name for p in scratch.iterdir() if p.name not in before)


def hook_commands(settings: Path, event: str) -> List[str]:
    try:
        data = json.loads(settings.read_text())
    except (OSError, ValueError):
        return []
    out = []
    for group in data.get("hooks", {}).get(event, []):
        for h in group.get("hooks", []):
            if h.get("type") == "command" and h.get("command"):
                out.append(h["command"])
    return out


def refused(code: int, out: str) -> bool:
    if code == 2:
        return True
    try:
        data = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
    except ValueError:
        return False
    spec = data.get("hookSpecificOutput", {}) if isinstance(data, dict) else {}
    return data.get("decision") == "block" or spec.get("permissionDecision") == "deny"


def kill_scratch_procs(scratch: Path) -> int:
    """Anything still running from the scratch HOME, by command line."""
    out = subprocess.run(["ps", "-axww", "-o", "pid=,command="], capture_output=True, text=True).stdout
    n = 0
    for line in out.splitlines():
        pid_s, _, cmd = line.strip().partition(" ")
        if str(scratch) in cmd and pid_s.isdigit() and int(pid_s) != os.getpid():
            try:
                os.kill(int(pid_s), 15)
                n += 1
            except OSError:
                pass
    return n


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--kit", default=str(ROOT), help="where to clone the kit from when the public URL fails")
    ap.add_argument("--ref", default="main", help="the branch of --kit to clone")
    ap.add_argument("--sample", default=SAMPLE_REPO)
    ap.add_argument("--playwright", default=os.environ.get("STRANGER_PLAYWRIGHT", ""),
                    help="a folder whose node_modules has playwright (headless WebKit)")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    scratch = Path(tempfile.mkdtemp(prefix="stranger-home-")).resolve()
    if scratch == REAL_HOME.resolve() or REAL_HOME.resolve() in scratch.parents:
        print("stranger_run: the scratch HOME must not be inside the real one", file=sys.stderr)
        return 2
    (scratch / "tmp").mkdir()
    profile = scratch.parent / f"{scratch.name}.sb"
    profile.write_text(sandbox_profile(scratch))
    rig_env = {"REALM_ENABLE_FAKE_AGENT": "1", "CHEWBACCA_REALM_UI_PORT": str(free_port())}
    run = Run(scratch, profile, rig_env)
    result: dict = {"when": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "scratch": str(scratch),
                    "load": os.getloadavg()[0], "manual": [], "surprises": [],
                    "rig": ["fake agent (REALM_ENABLE_FAKE_AGENT=1): a scratch HOME has no model account",
                            f"page port {rig_env['CHEWBACCA_REALM_UI_PORT']}: the host's own page holds 47317"]}
    kit = scratch / "Chewbacca"
    t0 = time.time()
    first_answer = None
    try:
        r = run.sh("readme", ["/usr/bin/curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", README_INSTALL],
                   expect_ok=False)
        code = r["out"].strip()[-3:]
        if code != "200":
            # 404 from GitHub is a private (or missing) repo; 000 is no network.
            why = "the repo is private" if code == "404" else "no network?"
            run.steps[-1]["errors"] = [f"the README install answers {code}: {why}"]

        r = run.sh("clone", ["/usr/bin/git", "clone", "--quiet", PUBLIC_KIT, str(kit)], expect_ok=False,
                   extra_env={"GIT_TERMINAL_PROMPT": "0"})
        if r["exit"] != 0:
            run.steps[-1]["errors"] = ["the public clone fails: " + ("the repo is private" if code == "404"
                                                                     else r["out"].strip()[-120:])]
            shutil.rmtree(kit, ignore_errors=True)
            r = run.sh("clone-local", ["/usr/bin/git", "clone", "--quiet", "--no-local", "--branch", args.ref,
                                       args.kit, str(kit)])
            result["manual"].append("cloned from a local copy, since the public URL is private")
        result["kit_commit"] = subprocess.run(["git", "-C", str(kit), "rev-parse", "--short", "HEAD"],
                                              capture_output=True, text=True).stdout.strip()

        run.sh("sample", ["/usr/bin/git", "clone", "--quiet", "--depth", "1", args.sample,
                          str(scratch / "code" / Path(args.sample).name)])
        before = {p.name for p in scratch.iterdir()}
        r = run.sh("setup", ["/bin/bash", "setup.sh", "--runtime", "claude-code"], cwd=kit)
        setup_out = r["out"]
        made = folders_written(scratch, before)
        result["setup_wrote"] = made

        before = {p.name for p in scratch.iterdir()}
        settings = scratch / ".claude" / "settings.json"
        for cmd in hook_commands(settings, "SessionStart"):
            r = run.sh("first-session", ["/bin/bash", "-c", cmd], cwd=scratch / "code" / Path(args.sample).name,
                       stdin=json.dumps({"hook_event_name": "SessionStart", "source": "startup",
                                         "session_id": "stranger", "cwd": str(scratch)}),
                       timeout=60, expect_ok=False)
            # A SessionStart hook prints context for the model, and that text
            # is full of words like "failed": only its exit code is an error.
            run.steps[-1]["errors"] = [] if r["exit"] == 0 else [f"a SessionStart hook exited {r['exit']}"]
        unasked = [d for d in folders_written(scratch, before) if d in (".codex", ".cursor", ".gemini", ".windsurf")]
        if unasked:
            result["surprises"].append("a first session wrote configs for runtimes nobody chose: " + ", ".join(unasked))

        brakes = {"rm -rf ~": "rm -rf ~", "force push to main": "git push --force origin main"}
        allowed = []
        pre = hook_commands(settings, "PreToolUse")
        for label, command in brakes.items():
            payload = json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                                  "tool_input": {"command": command}, "session_id": "stranger",
                                  "cwd": str(scratch / "code" / Path(args.sample).name)})
            stopped = False
            for cmd in pre:
                r = run.sh("brakes", ["/bin/bash", "-c", cmd], stdin=payload, timeout=30, expect_ok=False)
                run.steps.pop()
                if refused(r["exit"], r["out"]):
                    stopped = True
                    break
            if not stopped:
                allowed.append(label)
        result["brakes_allowed"] = allowed

        cmd = agents_command(setup_out, kit)
        if cmd is None:
            run.steps.append({"step": "agents", "seconds": 0, "exit": None, "prompts": [],
                              "errors": ["setup never says how to open the agents page"], "tail": []})
            result["manual"].append("found the agents page commands by reading the code")
            for step, argv in (("engine-build", ["python3", "bin/realm-engine", "build"]),
                               ("page-build", ["python3", "bin/realm-ui", "build"]),
                               ("engine-start", ["python3", "bin/realm-engine", "start"]),
                               ("page-start", ["python3", "bin/realm-ui", "start"])):
                r = run.sh(step, argv, cwd=kit)
            url = r["out"].strip().splitlines()[-1] if r["exit"] == 0 else ""
        else:
            r = run.sh("agents", cmd + ["--print-url"], cwd=kit)
            lines = [line for line in r["out"].splitlines() if line.startswith("http")]
            url = lines[-1] if lines else ""
        result["agents_command"] = " ".join(cmd) if cmd else None

        if url and args.playwright:
            driver = ROOT / "tools" / "stranger_first_turn.mjs"
            env = dict(os.environ, NODE_PATH=str(Path(args.playwright) / "node_modules"),
                       STRANGER_REALM_HOME=str(scratch / ".chewbacca" / "realm"), STRANGER_HOME=str(scratch),
                       STRANGER_REPO=str(scratch / "code" / Path(args.sample).name), STRANGER_ASK=ASK,
                       STRANGER_SHOTS=str(scratch.parent))
            started = time.time()
            try:
                done = subprocess.run(["node", str(driver), url], env=env, capture_output=True, text=True,
                                      timeout=300)
                said, code_ = done.stdout, done.returncode
            except subprocess.TimeoutExpired:
                said, code_ = "", -1
            try:
                turn = json.loads(said.strip().splitlines()[-1])
            except (ValueError, IndexError):
                turn = {"errors": ["the WebKit driver hung or said nothing"]}
            run.steps.append({"step": "first-turn", "seconds": round(time.time() - started, 2),
                              "exit": code_, "prompts": [], "errors": turn.get("errors", []),
                              "tail": [], "detail": {k: v for k, v in turn.items() if k != "errors"}})
            if turn.get("answered"):
                first_answer = time.time()
        elif not url:
            result["surprises"].append("no page address to load")

        r = run.sh("doctor", ["/bin/bash", "doctor.sh"], cwd=kit, timeout=300, expect_ok=False)
        clean = re.sub(r"\x1b\[[0-9;]*m", "", r["out"])
        fails = re.search(r"(\d+) things? needs? fixing", clean)
        passed = re.search(r"(\d+) checks passed", clean)
        skipped = re.search(r"so (\d+) findings about", clean)
        wrong = [x.strip()[2:] for x in clean.split("What is wrong:", 1)[-1].splitlines()
                 if x.strip().startswith("- [")] if "What is wrong:" in clean else []
        result["doctor"] = {"exit": r["exit"], "passed": int(passed.group(1)) if passed else None,
                            "failures": int(fails.group(1)) if fails else 0,
                            "skipped": int(skipped.group(1)) if skipped else 0, "what_is_wrong": wrong[:25]}
        run.steps[-1]["errors"] = [] if r["exit"] == 0 else [f"doctor exit {r['exit']}: " + "; ".join(wrong[:6])]
    finally:
        for argv in (["python3", "bin/realm-ui", "stop"], ["python3", "bin/realm-engine", "stop"]):
            if kit.is_dir():
                subprocess.run(["/usr/bin/sandbox-exec", "-f", str(profile)] + argv, cwd=str(kit),
                               env=stranger_env(scratch, rig_env), capture_output=True, timeout=60)
        result["left_running"] = kill_scratch_procs(scratch)
        if not args.keep:
            shutil.rmtree(scratch, ignore_errors=True)
            profile.unlink(missing_ok=True)

    result["steps"] = run.steps
    machine = [s["seconds"] for s in run.steps if s["step"] not in ("readme", "doctor", "first-session", "brakes")]
    result["clone_to_first_answer_s"] = round(sum(machine), 1) if first_answer else None
    result["wall_s"] = round(time.time() - t0, 1)
    result["counts"] = {"prompts": sum(len(s["prompts"]) for s in run.steps),
                        "errors": sum(len(s["errors"]) for s in run.steps),
                        "manual": len(result["manual"]), "surprises": len(result["surprises"]),
                        "brakes_allowed": len(result.get("brakes_allowed", []))}
    bench = REAL_HOME / ".chewbacca" / "bench"
    bench.mkdir(parents=True, exist_ok=True)
    with open(bench / "stranger.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(result) + "\n")
    print(json.dumps(result, indent=None if args.json else 1))
    return 0 if first_answer else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
