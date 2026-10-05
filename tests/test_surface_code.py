#!/usr/bin/env python3
"""code surface: the repos under a code root with uncommitted changes or a live
agent session, a file's diff and its preview, and nothing that writes or runs
a program a repo's config names.

Real git on throwaway repos in a temp dir (no network, no remote), a faked
`kyber-sessions --json`, and a fake display for the one end-to-end press. No
real HUD, no real ~/code.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.dont_write_bytecode = True
os.environ["KYBER_OS_GRAPH_NO_TM"] = "1"

import surfaces  # noqa: E402
from surfaces import Context, run_cli  # noqa: E402
from surfaces import code as code_mod  # noqa: E402
from surfaces.code import Code, file_id, parse_status, render_diff  # noqa: E402

COMPONENTS = {"Screen", "Stack", "Heading", "Text", "List", "Metric", "Table", "Status", "Sparkline", "Bars",
              "Ring", "Events", "Diagram", "File", "Button", "Field", "Select", "Checkbox", "Diff"}
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PROP = re.compile(r'(\w+)=("(?:[^"\\]|\\.)*"|\S+)')
# Anything a read-only panel must never ask git to do.
WRITES = {"add", "commit", "checkout", "switch", "reset", "restore", "stash", "clean", "rm", "mv", "push",
          "pull", "fetch", "merge", "rebase", "apply", "am", "cherry-pick", "revert", "tag", "branch"}
BIDI = "‮"
ESC = "\x1b[31m"
# Format characters a hand-written list missed (verifier, 2026-10-05): the
# Arabic letter mark, word joiner, invisible times, soft hyphen, Mongolian
# vowel separator, line and paragraph separators, and a tag character.
SNEAKY = "؜⁠⁢­᠎  󠀁"

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def git(repo: Path, *args: str) -> str:
    # No global hooks, no signing: the machine's own git config must not
    # change what the fixture is.
    argv = ["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=t",
            "-c", "user.email=t@example.invalid", "-C", str(repo)] + list(args)
    return subprocess.run(argv, capture_output=True, text=True, check=True).stdout


def make_repo(path: Path, files: dict) -> Path:
    path.mkdir(parents=True)
    git(path, "init", "-q", "-b", "main")
    for rel, body in files.items():
        p = path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body if isinstance(body, bytes) else body.encode())
    git(path, "add", "-A")
    git(path, "commit", "-q", "--no-verify", "-m", "start")
    return path


class World:
    """A code root: two groups, an archive, and a secret outside the root."""

    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.root = tmp / "code"
        self.secret = tmp / "secret.txt"
        self.secret.write_text("SECRET-KEY-MATERIAL\n")
        self.app = make_repo(self.root / "work" / "app", {
            "src/main.py": "print('one')\n", "README.md": "hello\n", "logo.bin": b"\x00\x01\x02" * 50,
            "gone.txt": "bye\n", "big.txt": "x\n"})
        (self.app / "src" / "main.py").write_text("print('two')\nprint('three')\n")
        (self.app / "notes.md").write_text(f"plain line\n{ESC}red{BIDI}evil\n")
        (self.app / "logo.bin").write_bytes(b"\x00\x09\x09" * 60)
        (self.app / "gone.txt").unlink()
        (self.app / "big.txt").write_text("".join(f"line {i}\n" for i in range(2000)))
        (self.app / f"odd{BIDI}name.txt").write_text("odd\n")
        (self.app / f"alm{SNEAKY}x.txt").write_text(f"a{SNEAKY}b\n")
        os.symlink(self.secret, self.app / "leak.txt")
        # A repo nested in this one: git lists it as one "nested/" entry.
        make_repo(self.app / "nested", {"n.txt": "n\n"})
        # A config filter driver, picked by an attribute, that leaves a mark
        # if git ever runs it; also one reached through include.path.
        self.mark = tmp / "PWNED"
        self.hostile = make_repo(self.root / "work" / "hostile", {
            "a.txt": "one\n", ".gitattributes": "* filter=pwn\n*.inc filter=inc.x\n", "b.inc": "b\n"})
        git(self.hostile, "config", "filter.pwn.clean", f"touch {self.mark}; cat")
        git(self.hostile, "config", "filter.pwn.process", f"touch {self.mark}")
        git(self.hostile, "config", "filter.pwn.required", "true")
        inc = tmp / "inc.cfg"
        inc.write_text(f'[filter "inc.x"]\n\tclean = touch {self.mark}; cat\n')
        git(self.hostile, "config", "include.path", str(inc))
        (self.hostile / "a.txt").write_text("two\n")
        (self.hostile / "b.inc").write_text("b2\n")
        if self.mark.exists():
            self.mark.unlink()
        # Big tracked files: one grown past the bar, one shrunk from past it.
        mb = code_mod.DIFF_MAX_BYTES
        self.huge = make_repo(self.root / "work" / "huge", {
            "grow.txt": "g\n", "shrink.txt": "s\n" * (mb // 2 + 10), "latin.txt": "plain\n"})
        (self.huge / "grow.txt").write_text("g\n" * (mb // 2 + 10))
        (self.huge / "shrink.txt").write_text("small now\n")
        (self.huge / "latin.txt").write_bytes(b"caf\xe9\n")
        self.clean = make_repo(self.root / "tools" / "quiet", {"a.txt": "a\n"})
        self.busy = make_repo(self.root / "tools" / "busy", {"a.txt": "a\n"})
        self.top = make_repo(self.root / "toprepo", {"t.txt": "t\n"})
        (self.top / "t.txt").write_text("t2\n")
        self.archived = make_repo(self.root / "archive" / "old", {"a.txt": "a\n"})
        (self.archived / "a.txt").write_text("changed\n")
        self.outside = make_repo(tmp / "elsewhere", {"a.txt": "a\n"})
        (self.outside / "a.txt").write_text("changed\n")
        self.sessions = [
            {"state": "working", "agent": "claude", "cwd": str(self.busy / "sub-dir-that-is-missing")},
            {"state": "working", "agent": "claude", "cwd": str(self.busy)},
            {"state": "needs", "agent": "claude", "cwd": str(self.outside)},
            {"state": "finished", "agent": "claude", "cwd": str(self.clean)},
            {"state": "working", "agent": "claude", "cwd": "/etc"},
            {"state": "needs", "agent": "codex", "cwd": str(self.top)},
        ]
        self.sessions_fail = False
        self.calls: list[list[str]] = []

    def run(self, argv):
        argv = [str(a) for a in argv]
        self.calls.append(argv)
        if argv[0].endswith("kyber-sessions"):
            if self.sessions_fail:
                return 1, "", f"board {ESC}explo{BIDI}ded{SNEAKY}"
            return 0, json.dumps(self.sessions), ""
        return run_cli(argv)

    def ctx(self) -> Context:
        return Context(run=self.run, home=self.tmp, env={"KYBER_CODE_ROOT": str(self.root)})


def validate(lines: list[str]) -> list[str]:
    problems, made, bound, roots = [], set(), set(), []
    for line in lines:
        op = line.split(" ", 1)[0]
        if op == "c":
            parts = line.split(" ", 3)
            if len(parts) < 3 or not ID.match(parts[1]) or parts[2] not in COMPONENTS:
                problems.append(f"bad component: {line[:60]}")
                continue
            made.add(parts[1])
            for key, raw in PROP.findall(parts[3] if len(parts) > 3 else ""):
                if raw.startswith("@/"):
                    bound.add(raw[1:])
                    continue
                try:
                    json.loads(raw)
                except json.JSONDecodeError:
                    problems.append(f"{parts[1]}.{key} is not JSON")
            if "editable" in line:
                problems.append("a File is editable: its save would overwrite the repo")
        elif op == ">":
            problems += [f"> names {c} before its c" for c in line.split()[1:] if c not in made]
        elif op == "r":
            roots.append(line.split()[1])
        else:
            problems.append(f"unknown op {line[:30]}")
    if not roots:
        problems.append("no r")
    return problems, bound


def git_calls(world: World) -> list[list[str]]:
    return [c for c in world.calls if c[0] == "git"]


def subcommand(argv: list[str]) -> str:
    """The git subcommand in an argv: the first word after the global options."""
    i = 1
    while i < len(argv):
        a = argv[i]
        if a in ("-C", "-c"):
            i += 2
            continue
        if a.startswith("-"):
            i += 1
            continue
        return a
    return ""


# ── the tests ───────────────────────────────────────────────────────────────

def drawing(w: World) -> None:
    c = Code()
    problems, bound = validate(c.layout())
    check("layout is valid Kyber Lines with no editable File", problems == [], problems)
    ctx = w.ctx()
    for name, data, error in (("loading", None, None), ("error", None, "There's no /x to read."),
                              ("empty", {"repos": [], "more": 0, "unread": 0, "sessions": ""}, None)):
        model = {**c.initial(), **c.model(data, error, {}, ctx)}
        missing = {p for p in bound if p not in model}
        check(f"{name}: every bound pointer is set", not missing, missing)
    check("loading says Loading", c.model(None, None, {}, ctx)["/code/note"] == "Loading…")
    check("error says what is wrong", "no /x" in c.model(None, "There's no /x to read.", {}, ctx)["/code/note"])
    empty = c.model({"repos": [], "more": 0, "unread": 0, "sessions": ""}, None, {}, ctx)
    check("empty says nothing is uncommitted", "Nothing uncommitted" in empty["/code/note"], empty["/code/note"])
    check("the kind is code and every component id carries it",
          c.name == "code" and all(x.split()[1].startswith("code-") for x in c.layout() if x.startswith("c ")))


def listing(w: World) -> dict:
    c = Code()
    data = c.fetch(w.ctx())
    keys = [r["key"] for r in data["repos"]]
    check("a repo with changes is listed", "work/app" in keys, keys)
    check("a repo at the root's top level is listed", "toprepo" in keys, keys)
    check("a clean repo with a working session is listed", "tools/busy" in keys, keys)
    check("a clean repo with only a finished session is not", "tools/quiet" not in keys, keys)
    check("the archive group is skipped", not any(k.startswith("archive") for k in keys), keys)
    check("a session outside the code root adds nothing", not any("elsewhere" in k for k in keys), keys)
    check("the session's repos sort first", set(keys[:2]) == {"tools/busy", "toprepo"}, keys)
    app = next(r for r in data["repos"] if r["key"] == "work/app")
    rels = {f["rel"]: f["code"] for f in app["files"]}
    check("modified, deleted and new files are read from git",
          rels.get("src/main.py") == "M" and rels.get("gone.txt") == "D" and rels.get("notes.md") == "?", rels)
    check("a new folder's files are listed one by one, not as the folder",
          not any(r.endswith("/") for r in rels), list(rels))
    check("a repo nested inside a repo is not listed as a change in it",
          not any(r.startswith("nested") for r in rels) and app["total"] == len(rels) and "nested/" not in rels,
          list(rels))
    model = c.model(data, None, {}, w.ctx())
    table = {r["id"]: r for r in model["/code/repos"]}
    check("the table shows branch and the agent", table["tools/busy"]["branch"] == "main"
          and table["tools/busy"]["agent"] == "Claude working", table["tools/busy"])
    check("a Codex session is labelled Codex, not Claude",
          table["toprepo"]["agent"] == "Codex needs you", table["toprepo"])
    check("a repo with no upstream says so", table["work/app"]["sync"] == "no upstream", table["work/app"])
    picked = c.model(data, None, {"/code/repo": "work/app"}, w.ctx())
    texts = [i["text"] for i in picked["/code/files"]]
    check("picking a repo lists its files", any("src/main.py" in t for t in texts), texts)
    check("no file label carries a bidi override or escape",
          not any(BIDI in t or "\x1b" in t for t in texts), texts)
    check("no file label carries a format character (U+061C, U+2060, tags...)",
          any("almx.txt" in t for t in texts) and not any(ch in t for t in texts for ch in SNEAKY), texts)
    check("a needs-you session's repo is picked first when none is",
          model.get("/code/repo") in ("tools/busy", "toprepo"), model.get("/code/repo"))
    return data


def presses(w: World, data: dict) -> None:
    c = Code()
    ctx = w.ctx()
    row = file_id("work/app", "src/main.py")
    r = c.diff(ctx, data, {"row": row})
    text = r.updates.get("/code/diff", "")
    check("Diff on a modified file draws git's diff", r.ok and "+print('three')" in text and "-print('one')" in text,
          (r.line, text[:200]))
    check("Diff clears the preview and remembers the file",
          r.updates.get("/code/path") == "" and r.updates.get("/code/file") == row, r.updates)
    p = c.preview(ctx, data, {"/code/file": row})
    check("Preview draws the file itself, resolved inside the repo",
          p.ok and p.updates.get("/code/path") == str((w.app / "src" / "main.py").resolve())
          and p.updates.get("/code/diff") == "", (p.line, p.updates))

    new = c.diff(ctx, data, {"row": file_id("work/app", "notes.md")})
    body = new.updates.get("/code/diff", "")
    check("Diff on a new text file shows it as added", new.ok and "+plain line" in body, (new.line, body[:120]))
    check("control characters and bidi overrides never reach the HUD",
          "\x1b" not in body and BIDI not in body and "redevil" in body, body)
    sneaky = c.diff(ctx, data, {"row": file_id("work/app", f"alm{SNEAKY}x.txt")})
    sbody = sneaky.updates.get("/code/diff", "")
    check("format characters in a diff never reach the HUD",
          sneaky.ok and "+ab" in sbody and not any(ch in sbody for ch in SNEAKY), (sneaky.line, sbody))

    leak = file_id("work/app", "leak.txt")
    for name, fn, values in (("Diff", c.diff, {"row": leak}), ("Preview", c.preview, {"/code/file": leak})):
        res = fn(ctx, data, values)
        shown = json.dumps(res.updates)
        check(f"{name} refuses a symlink that leaves the repo", not res.ok and "SECRET" not in shown
              and str(w.secret) not in shown, (res.line, shown))

    # The File view draws the path's last component raw, so Preview must
    # refuse a name clean() would change rather than hand it over.
    for rel in (f"odd{BIDI}name.txt", f"alm{SNEAKY}x.txt"):
        pv = c.preview(ctx, data, {"/code/file": file_id("work/app", rel)})
        shown = json.dumps(pv.updates, ensure_ascii=False) + pv.line
        check(f"Preview refuses a path with a control or format character ({rel.encode('unicode_escape').decode()})",
              not pv.ok and pv.updates.get("/code/path") == ""
              and BIDI not in shown and not any(ch in shown for ch in SNEAKY), (pv.line, pv.updates))

    binary = file_id("work/app", "logo.bin")
    pb = c.preview(ctx, data, {"/code/file": binary})
    check("Preview refuses a binary file", not pb.ok and "binary" in pb.line, pb.line)
    db = c.diff(ctx, data, {"row": binary})
    check("Diff of a binary file is git's one line, not bytes",
          db.ok and "Binary files" in db.updates.get("/code/diff", ""), db.updates.get("/code/diff", "")[:200])

    gone = file_id("work/app", "gone.txt")
    dg = c.diff(ctx, data, {"row": gone})
    check("Diff of a deleted file shows the deletion", dg.ok and "-bye" in dg.updates.get("/code/diff", ""), dg.line)
    check("Preview of a deleted file says so", not c.preview(ctx, data, {"/code/file": gone}).ok)

    big = c.diff(ctx, data, {"row": file_id("work/app", "big.txt")})
    lines = big.updates.get("/code/diff", "").split("\n")
    check("a long diff is cut to the Diff view's 600 lines, note included, and says so",
          len(lines) == code_mod.DIFF_LINES and lines[-1].endswith("more lines not drawn"), len(lines))
    check("the cut diff still starts with the header that names the file",
          lines[0].startswith("diff --git") and "big.txt" in lines[0], lines[:1])

    before = len(git_calls(w))
    forged = [
        file_id("work/app", "../../secret.txt"),
        file_id("work/app", ".git/config"),
        file_id("work/app", "src/missing.py"),
        file_id("elsewhere", "a.txt"),
        file_id("archive/old", "a.txt"),
        "work/app::src/main.py",
        '["work/app"]',
        '{"key":"work/app"}',
        "",
    ]
    results = [c.diff(ctx, data, {"row": f}) for f in forged]
    results += [c.preview(ctx, data, {"/code/file": f}) for f in forged]
    check("a row id git never listed runs nothing and is refused",
          all(not x.ok for x in results) and len(git_calls(w)) == before,
          [x.line for x in results if x.ok])
    check("Preview with nothing diffed says what to press", "Diff" in c.preview(ctx, data, {}).line)

    pr = c.pick_repo(ctx, data, {"row": "work/app"})
    check("a repo row opens that repo and clears the old diff",
          pr.ok and pr.updates == {"/code/repo": "work/app", "/code/file": "", "/code/diff": "", "/code/path": ""},
          pr.updates)
    check("a repo row that isn't listed is refused",
          not c.pick_repo(ctx, data, {"row": "../elsewhere"}).ok and not c.pick_repo(ctx, data, {}).ok)


def read_only(w: World) -> None:
    index = (w.app / ".git" / "index").read_bytes()
    head = (w.app / ".git" / "HEAD").read_bytes()
    c = Code()
    data = c.fetch(w.ctx())
    c.diff(w.ctx(), data, {"row": file_id("work/app", "src/main.py")})
    calls = git_calls(w)
    subs = {subcommand(a) for a in calls}
    check("git is only ever asked to read: status, diff, config --list, ls-tree, ls-files",
          subs <= {"status", "diff", "config", "ls-tree", "ls-files"} and not (subs & WRITES), subs)
    check("config is only ever listed, never set",
          all("--list" in a for a in calls if subcommand(a) == "config"))
    check("every git call disables optional locks and fsmonitor",
          all("--no-optional-locks" in a and "core.fsmonitor=false" in a for a in calls))
    check("status and diff never look inside a submodule",
          all("--ignore-submodules=dirty" in a for a in calls if subcommand(a) in ("status", "diff")))
    diffs = [a for a in calls if subcommand(a) == "diff"]
    check("every diff refuses external diff drivers and textconv",
          diffs and all("--no-ext-diff" in a and "--no-textconv" in a for a in diffs))
    check("a fetch and a diff leave the index and HEAD byte for byte",
          (w.app / ".git" / "index").read_bytes() == index and (w.app / ".git" / "HEAD").read_bytes() == head)
    check("no handler is named for anything but repo, diff and preview",
          set(c.actions) == {"ks-repo", "ks-diff", "ks-preview"}, set(c.actions))


def hostile_config(w: World) -> None:
    """A filter driver in the repo's own config never runs, on the background
    status or on a press."""
    c = Code()
    data = c.fetch(w.ctx())
    keys = [r["key"] for r in data["repos"]]
    check("a repo with a config filter is still listed", "work/hostile" in keys, keys)
    for rel in ("a.txt", "b.inc"):
        r = c.diff(w.ctx(), data, {"row": file_id("work/hostile", rel)})
        check(f"Diff of {rel} under a hostile filter still draws", r.ok and "+" in r.updates.get("/code/diff", ""),
              r.line)
    check("no config filter ran on the status or the diffs", not w.mark.exists())
    calls = [a for a in git_calls(w) if str(w.hostile) in a]
    check("every call in that repo blanks the local filters and keeps nothing of them",
          all("filter.pwn.clean=" in a and "filter.inc.x.clean=" in a and "filter.pwn.required=false" in a
              for a in calls if subcommand(a) in ("status", "diff")), calls[-1:])
    # Proof the fixture is live: plain git runs the filter.
    subprocess.run(["git", "-C", str(w.hostile), "diff", "HEAD"], capture_output=True)
    check("the same repo without the guard does run the filter (the fixture is real)", w.mark.exists())
    w.mark.unlink(missing_ok=True)


def guard_parsing() -> None:
    def fake(out, code=0):
        return Context(run=lambda argv: (code, out, ""))
    listing = "\0".join([
        "global", "filter.lfs.clean\ngit-lfs clean -- %f",
        "global", "filter.lfs.required\ntrue",
        "local", "filter.pwn.clean\ntouch /tmp/x",
        "worktree", "filter.Mixed.Case.smudge\nx",
        "local", "filter.noSubsection\nx",
        "local", "core.editor\nvim", ""])
    guard = code_mod.filter_guard(fake(listing), "/r")
    check("Caleb's global filters (git-lfs) stay on, the repo's own are blanked",
          guard is not None and "filter.pwn.clean=" in guard and "filter.Mixed.Case.process=" in guard
          and not any("lfs" in g for g in guard), guard)
    check("a driver name a -c line can't carry fails the repo closed",
          code_mod.filter_guard(fake("local\0filter.a=b.clean\nx\0"), "/r") is None)
    check("config that can't be listed fails the repo closed",
          code_mod.filter_guard(fake("", code=1), "/r") is None)


def size_bars(w: World) -> None:
    c = Code()
    data = c.fetch(w.ctx())
    keys = [r["key"] for r in data["repos"]]
    check("the repo with big files is listed", "work/huge" in keys, keys)
    for rel, word in (("grow.txt", "is "), ("shrink.txt", "was ")):
        before = len([a for a in git_calls(w) if subcommand(a) == "diff"])
        r = c.diff(w.ctx(), data, {"row": file_id("work/huge", rel)})
        after = len([a for a in git_calls(w) if subcommand(a) == "diff"])
        check(f"a tracked file over the bar ({rel}) is named, not diffed",
              not r.ok and word in r.line and "too big" in r.line and after == before
              and r.updates.get("/code/diff") == "", (r.line, after - before))
    lat = c.diff(w.ctx(), data, {"row": file_id("work/huge", "latin.txt")})
    check("a diff that isn't UTF-8 fails cleanly instead of crashing", not lat.ok and "UTF-8" in lat.line, lat.line)


def sessions_down(w: World) -> None:
    w.sessions_fail = True
    c = Code()
    data = c.fetch(w.ctx())
    note = c.model(data, None, {}, w.ctx())["/code/note"]
    check("sessions failing still lists the repos and says so",
          any(r["key"] == "work/app" for r in data["repos"]) and "sessions unavailable" in note, note)
    check("the sessions error is cleaned before it reaches the glass",
          "\x1b" not in note and BIDI not in note and not any(ch in note for ch in SNEAKY) and "exploded" in note,
          note)
    w.sessions_fail = False


def parsing() -> None:
    raw = "\0".join([
        "# branch.oid abc", "# branch.head feat/x", "# branch.upstream origin/feat/x", "# branch.ab +3 -1",
        "1 .M N... 100644 100644 100644 aaa bbb dir/has space.py",
        "2 R. N... 100644 100644 100644 aaa bbb R100 new name.py", "old name.py",
        "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
        "? fresh.txt", "1 M. SC.. 160000 160000 160000 a b vendor/sub", "",
    ])
    info = parse_status(raw)
    check("branch, upstream, ahead and behind are read",
          (info["branch"], info["upstream"], info["ahead"], info["behind"]) == ("feat/x", "origin/feat/x", 3, 1), info)
    by = {f["rel"]: f for f in info["files"]}
    check("a path with spaces survives", "dir/has space.py" in by, list(by))
    check("a rename keeps its old path from the next token",
          by.get("new name.py", {}).get("orig") == "old name.py" and "old name.py" not in by, by.get("new name.py"))
    check("a conflict and a submodule are told apart",
          by["conflict.txt"]["code"] == "U" and by["vendor/sub"]["sub"] is True, by)
    c = Code()
    r = {"upstream": "origin/x", "ahead": 2, "behind": 1}
    check("sync reads as arrows", c.sync(r) == "↑2 ↓1" and c.sync({**r, "ahead": 0, "behind": 0}) == "even")
    check("a diff ending in newlines draws no blank tail", render_diff("a\nb\n\n") == "a\nb")
    drawn = render_diff("\n".join(["diff --git a/x b/x"] + [f"+{i}" for i in range(700)]))
    out = drawn.split("\n")
    check("700 lines draw as 599 plus the note, so suffix(600) keeps the header",
          len(out) == 600 and out[0] == "diff --git a/x b/x" and out[-1] == "… 102 more lines not drawn", out[-1])
    check("a line exactly at the cap is not marked cut", render_diff("x" * code_mod.LINE_CHARS) == "x" * 400)


def end_to_end(w: World) -> None:
    """The real daemon, a fake display, and the exact row-action line."""
    loader = SourceFileLoader("kyber_surfaces_code", str(ROOT / "bin" / "kyber-surfaces"))
    ks = module_from_spec(spec_from_loader("kyber_surfaces_code", loader))
    loader.exec_module(ks)

    class Hud:
        def __init__(self):
            self.lines = []

        def send(self, lines):
            for line in lines:
                assert "\n" not in line and "\r" not in line, line
            self.lines += lines
            return True

    hud = Hud()
    real_make, real_resolve = surfaces.make, surfaces.resolve

    def make(kind, arg=""):
        return Code() if kind == "code" else real_make(kind, arg)

    surfaces.resolve = lambda word: "code" if word == "code" else real_resolve(word)
    try:
        d = ks.Daemon(hud, ctx=w.ctx(), state_path=w.tmp / "state.json", activity_path=w.tmp / "act.jsonl",
                      badges_path=w.tmp / "badges.json", spaces={}, clock=lambda: 0.0, spawn=lambda fn: fn(),
                      ingest=lambda c: {}, make=make)
        d.open_surface("code")
        drawn = list(hud.lines)
        check("the daemon draws the surface", any(x.startswith("@ code") for x in drawn), drawn[:2])
        hud.lines.clear()
        row = json.dumps(file_id("work/app", "src/main.py"))
        d.handle_line(f'e action ks-diff row={row} surface="code"')
        sent = [x for x in hud.lines if x.startswith("d /code/diff ")]
        check("a row's Diff press puts the diff on the glass", sent and "print('three')" in sent[-1], hud.lines[-3:])
        hud.lines.clear()
        d.handle_line('e ks-preview code-preview surface="code"')
        sent = [x for x in hud.lines if x.startswith("d /code/path ")]
        check("Preview puts the file on the glass", sent and "main.py" in sent[-1], hud.lines[-3:])
        log = (w.tmp / "act.jsonl").read_text()
        check("both presses are in the activity log", '"diff"' in log and '"preview"' in log, log)
    finally:
        surfaces.make, surfaces.resolve = real_make, real_resolve


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw).resolve()
        w = World(tmp)
        drawing(w)
        data = listing(w)
        presses(w, data)
        read_only(w)
        hostile_config(w)
        size_bars(w)
        sessions_down(w)
        parsing()
        guard_parsing()
        end_to_end(w)
    print(f"\n{'all passed' if not failed else f'{failed} failed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
