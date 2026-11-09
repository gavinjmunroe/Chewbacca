"""Problems on the card: the repo's own checker, its errors on the file rows
and as lines that open where they are.

VS Code's red squiggles come from a language server; the card has none, so
it runs what the repo itself would be checked with and reads the errors:

- Python: every changed .py file is compiled in this process (`compile()`,
  what `python -m py_compile` runs, minus the .pyc it writes). Nothing from
  the repo runs, so this happens by itself whenever the changes are read.
- TypeScript: `tsc --noEmit` from the repo's own node_modules, when it has a
  tsconfig.json and a changed .ts or .tsx file.
- Swift: `swift build` in each package (the nearest Package.swift above a
  changed .swift file).

tsc and swift build run the repo's code (its compiler plugins, its
Package.swift), so they never run by themselves: a Check row names every
command and folder first, and its press queues them on the Mac's build queue
(`chewbacca-jobs submit --build`, one build at a time, at nice 10), so a check
never fights the other tabs' builds. The card reads each job's state as it
refreshes and its log once it ends.

WHAT IS DRAWN. Each changed file's row says how many errors it has, and a
"Problems" list shows each error as its message under `path · line`; a press
opens that file in the card's editor at that line. A checker that couldn't
run says why in one line, never as zero errors.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path, PurePosixPath

import session_tree

from . import ACTION_PREFIX, Bind, Context, Result, comp
from .agent_ide import WHERE_CHARS, _clean

JOBS = Path(__file__).resolve().parents[2] / "chewbacca-jobs"
# Changed .py files compiled per read. A refactor touching more is checked
# by its own test run, not on every refresh of a card. Guessed.
PY_FILES = 30
# Problems drawn; the caption counts all. The finder's row bound
# (agent_ide.FIND_LINES), since these rows are read the same way. Guessed.
PROBLEMS_SHOWN = 8
# The most of a job's log read for errors. A swift build that fails prints
# its errors near the end; 2 MB holds a full rebuild of the HUD (its build
# log on 2026-10-11 was about 40 KB), so this is generous. Guessed.
LOG_BYTES = 2 << 20
MESSAGE_CHARS = 140
TSC = re.compile(r"^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$")
SWIFT = re.compile(r"^(/[^:\n]+):(\d+):(\d+): error: (.*)$")


def python_errors(root: Path, rels: list[str]) -> list[dict]:
    out = []
    for rel in rels[:PY_FILES]:
        import ide_git  # noqa: PLC0415  bin/lib, beside session_tree

        data = ide_git.read_regular(root / rel)
        if data is None:
            continue
        try:
            compile(data, rel, "exec", dont_inherit=True)
        except SyntaxError as err:
            out.append({"path": rel, "line": int(err.lineno or 1), "message": f"{type(err).__name__}: {err.msg}",
                        "source": "python"})
        except ValueError as err:  # a null byte in the file
            out.append({"path": rel, "line": 1, "message": str(err), "source": "python"})
    return out


def checkers(root: Path, rels: list[str]) -> list[dict]:
    """The commands that check these changed files: [{key, argv, cwd, words}]."""
    out = []
    if any(r.endswith((".ts", ".tsx")) for r in rels) and (root / "tsconfig.json").is_file():
        tsc = root / "node_modules" / ".bin" / "tsc"
        if tsc.exists():
            out.append({"key": "tsc", "argv": [str(tsc), "--noEmit", "-p", "tsconfig.json", "--pretty", "false"],
                        "cwd": str(root), "words": f"tsc --noEmit in {root.name}"})
    packages: set[Path] = set()
    for rel in rels:
        if not rel.endswith(".swift"):
            continue
        d = (root / rel).parent
        while d != root.parent and d.is_relative_to(root):
            if (d / "Package.swift").is_file():
                packages.add(d)
                break
            d = d.parent
    for d in sorted(packages):
        rel = d.relative_to(root).as_posix()
        out.append({"key": f"swift:{rel}", "argv": ["swift", "build"], "cwd": str(d),
                    "words": f"swift build in {rel if rel != '.' else root.name}"})
    return out


def parse_log(text: str, root: Path, cwd: Path, key: str) -> list[dict]:
    out, seen = [], set()
    for line in text.splitlines():
        m = TSC.match(line) if key == "tsc" else SWIFT.match(line)
        if not m:
            continue
        path = m.group(1) if key != "tsc" else str(cwd / m.group(1))
        rel = session_tree.inside(root, path)
        if rel is None:
            continue
        msg = f"{m.group(4)}: {m.group(5)}" if key == "tsc" else m.group(4)
        item = (rel, int(m.group(2)), msg)
        if item in seen:
            continue
        seen.add(item)
        out.append({"path": rel, "line": int(m.group(2)), "message": msg, "source": key.split(":")[0]})
    return out


def check_id(cmds: list[dict]) -> str:
    return "check:" + hashlib.sha256(json.dumps([[c["cwd"], c["argv"]] for c in cmds]).encode()).hexdigest()[:16]


class Checks:
    """Mixed into surfaces.agents.Agents. Uses the host's _lock, pinned, p,
    cid, repo_of, _show_tab and _stale_changes."""

    def _checks_init(self) -> None:
        # {sid, root, gen, py: {key: (stamp, errors)}, jobs: {key: {...}}}
        self._checks: dict | None = None
        self.jobs_dir = lambda: Path(os.environ.get("JOBS_DIR") or Path.home() / ".chewbacca" / "jobs")
        self.submit_job = self._submit_job
        p = ACTION_PREFIX
        self.actions.update({f"{p}check": self.run_checks, f"{p}problem": self.open_problem})

    def _state(self, row: dict) -> dict:
        root = self.repo_of(row)
        with self._lock:
            if not self._checks or self._checks["sid"] != row["id"] or self._checks["root"] != root:
                self._checks = {"sid": row["id"], "root": root, "gen": 0, "py": {}, "jobs": {}}
            return self._checks

    def read_checks(self, row: dict, changes) -> None:
        """Compile the changed Python files that changed since the last read,
        and read any queued check that ended. Called by fetch."""
        root = self.repo_of(row)
        if not root.startswith("/") or not isinstance(changes, dict):
            return
        base = Path(root).resolve()
        state = self._state(row)
        rels = [f.get("path") for f in changes.get("files") or [] if isinstance(f, dict)
                and isinstance(f.get("path"), str) and f["path"].endswith(".py") and f.get("status") != "deleted"]
        py = {}
        for rel in rels[:PY_FILES]:
            inside = session_tree.inside(base, str(base / rel))
            if inside is None:
                continue
            try:
                st = os.stat(base / inside)
            except OSError:
                continue
            stamp = (st.st_mtime_ns, st.st_size)
            old = state["py"].get(inside)
            py[inside] = old if old and old[0] == stamp else (stamp, python_errors(base, [inside]))
        jobs = dict(state["jobs"])
        for key, job in jobs.items():
            if job.get("status") in ("done", "failed", "killed", "lost"):
                continue
            try:
                info = json.loads((self.jobs_dir() / job["id"] / "job.json").read_text())
            except (OSError, ValueError):
                jobs[key] = {**job, "status": "lost"}
                continue
            status = str(info.get("status") or "")
            if status in ("done", "failed", "killed"):
                try:
                    with open(self.jobs_dir() / job["id"] / "out.log", "rb") as f:
                        f.seek(0, os.SEEK_END)
                        f.seek(max(0, f.tell() - LOG_BYTES))
                        text = f.read().decode("utf-8", "replace")
                except OSError:
                    text = ""
                errors = parse_log(text, base, Path(job["cwd"]), key)
                ran = info.get("exit") is not None and status != "killed"
                jobs[key] = {**job, "status": status if ran else "killed", "exit": info.get("exit"),
                             "errors": errors}
            else:
                jobs[key] = {**job, "status": status}
        with self._lock:
            if self._checks is state:
                state["py"] = py
                state["jobs"] = jobs

    def checks_model(self, shown: dict, changes, out: dict) -> None:
        p = self.p
        root = self.repo_of(shown)
        with self._lock:
            state = dict(self._checks) if self._checks and self._checks["sid"] == shown["id"] \
                and self._checks["root"] == root else None
        if not state or not root.startswith("/"):
            return
        base = Path(root).resolve()
        errors = [e for _, errs in state["py"].values() for e in errs]
        notes = []
        for key, job in state["jobs"].items():
            if job.get("status") in ("done", "failed"):
                errors += job.get("errors") or []
                if job.get("exit") not in (0, None) and not job.get("errors"):
                    notes.append(f"{job['words']} failed without an error line; its log is in "
                                 f"chewbacca jobs log {job['id']}")
            elif job.get("status") in ("killed", "lost"):
                notes.append(f"{job['words']} didn't finish")
            else:
                notes.append(f"{job['words']} · {job.get('status') or 'queued'}")
        sources = sorted({e["source"] for e in errors})
        with self._lock:
            # A new error list is a new generation, so a row drawn from the
            # last one can't open the error now in its place.
            if self._checks and self._checks["sid"] == shown["id"]:
                if self._checks.get("drawn") != errors[:PROBLEMS_SHOWN]:
                    self._checks["gen"] += 1
                    self._checks["drawn"] = errors[:PROBLEMS_SHOWN]
                state["gen"] = self._checks["gen"]
        if errors:
            files = {e["path"] for e in errors}
            out[p("problemsCap")] = _clean(
                f"Problems · {len(errors)} error{'s' if len(errors) != 1 else ''} in {len(files)} "
                f"file{'s' if len(files) != 1 else ''} · from {', '.join(sources)}", 100)
            out[p("problems")] = [{"id": f"d{state['gen']}:{i}", "kind": "line",
                                   "segments": [{"text": _clean(e["message"], MESSAGE_CHARS), "match": False}],
                                   "where": _clean(f"{e['path']} · {e['line']}", WHERE_CHARS)}
                                  for i, e in enumerate(errors[:PROBLEMS_SHOWN])]
            count: dict[str, int] = {}
            for e in errors:
                count[e["path"]] = count.get(e["path"], 0) + 1
            for r in out.get(p("changed")) or []:
                n = count.get(r["id"])
                if n:
                    r["time"] = f"{r['time']} · {n} error{'s' if n != 1 else ''}"
        if notes:
            out[p("checkNote")] = _clean(" · ".join(notes), 160)
        rels = [f.get("path") for f in (changes or {}).get("files") or [] if isinstance(f, dict)
                and isinstance(f.get("path"), str)]
        cmds = checkers(base, rels)
        running = any(j.get("status") not in ("done", "failed", "killed", "lost") for j in state["jobs"].values())
        if cmds and not running:
            out[p("check")] = [{"id": check_id(cmds), "text": _clean(
                "Runs " + " and ".join(c["words"] for c in cmds)
                + " · queued with this Mac's builds, writes only build output", 140)}]

    # ── presses ──────────────────────────────────────────────────────────

    def _submit_job(self, cmd: dict) -> tuple[str, str]:
        try:
            done = subprocess.run([str(JOBS), "submit", "--build", "--title", f"check: {cmd['words']}", "--",
                                   *cmd["argv"]], cwd=cmd["cwd"], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError) as err:
            return "", str(err)
        first = (done.stdout.split() or [""])[0]
        if done.returncode != 0 or not re.match(r"^\d{4}-\d{6}-[0-9a-f]{4}$", first):
            return "", (done.stderr or done.stdout).strip()[:120]
        return first, ""

    def run_checks(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        changes = (data or {}).get("changes") or {}
        root = self.repo_of(row) if row else ""
        if not root.startswith("/"):
            return Result(False, "No agent's folder is open.", updates=bad)
        rels = [f.get("path") for f in changes.get("files") or [] if isinstance(f, dict)
                and isinstance(f.get("path"), str)]
        cmds = checkers(Path(root).resolve(), rels)
        if not cmds or check_id(cmds) != key:
            return Result(False, "Nothing was run: what would be checked changed since that was drawn.",
                          updates=bad, refetch=True)
        state = self._state(row)
        queued, why = [], ""
        for c in cmds:
            job, why = self.submit_job(c)
            if not job:
                break
            queued.append(c["words"])
            with self._lock:
                state["jobs"][c["key"]] = {"id": job, "words": c["words"], "cwd": c["cwd"], "status": "queued"}
        if not queued:
            return Result(False, f"Nothing was queued: {why or 'the build queue refused'}.", updates=bad)
        tail = f" Couldn't queue the rest: {why}." if why else ""
        return Result(True, f"Queued {' and '.join(queued)}.{tail}", updates={self.p("level"): "info"}, refetch=True)

    def open_problem(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
            state = self._checks if self._checks and self._checks["sid"] == sid else None
            drawn = list(state.get("drawn") or []) if state else []
            gen = state["gen"] if state else -1
            root = state["root"] if state else ""
        head, _, index = key.partition(":")
        if head != f"d{gen}" or not index.isdigit() or int(index) >= len(drawn):
            return Result(False, "That problem isn't in the list any more.", updates=bad)
        e = drawn[int(index)]
        base = Path(root).resolve()
        rel = session_tree.inside(base, str(base / e["path"]))
        if rel is None or not (base / rel).is_file():
            return Result(False, "That file isn't there any more.", updates=bad)
        self._show_tab((sid, str(base / rel), int(e["line"]), str(base)))
        return Result(True, f"{PurePosixPath(rel).name}, line {e['line']}.")

    # ── drawing ──────────────────────────────────────────────────────────

    def checks_blank(self) -> dict:
        p = self.p
        return {p("problems"): [], p("problemsCap"): "", p("check"): [], p("checkNote"): ""}

    def checks_plan(self, out: dict) -> dict:
        p = self.p
        return {"problems": bool(out.get(p("problems"))), "check": bool(out.get(p("check"))),
                "checkNote": bool(out.get(p("checkNote")))}

    def checks_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        p, c = self.p, self.cid
        parts: list[str] = []
        order: list[str] = []
        if plan.get("problems"):
            parts.append(comp(c("problems"), "Hits", caption=Bind(p("problemsCap")), items=Bind(p("problems")),
                              action=f"{ACTION_PREFIX}problem"))
            order.append("problems")
        if plan.get("checkNote"):
            parts.append(comp(c("checknote"), "Text", value=Bind(p("checkNote")), tone="muted"))
            order.append("checknote")
        if plan.get("check"):
            parts.append(comp(c("check"), "Events", caption="", items=Bind(p("check")),
                              action=f"{ACTION_PREFIX}check", actionLabel="Check"))
            order.append("check")
        return parts, order
