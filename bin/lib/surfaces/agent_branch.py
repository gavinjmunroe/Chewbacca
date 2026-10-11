"""Branches on the card: make one, switch to one, and never lose a change.

Realm reads the branch (workspace.gitInfo) and ships it, but has no switch:
its git write path has "no reset, no checkout" so that nothing it does can
lose work. The card adds the one write VS Code's branch picker makes, `git
switch`, under the same rule.

WHAT IS DRAWN. "Branches": the checkout's local branches, newest first, the
current one marked, and a "New branch" field. A press on a branch selects it,
and the verbs that can act on it appear under the list, each saying what
happens to the checkout's changed files before it is pressed:

- nothing changed: "Switch to X";
- something changed, two choices and never a plain switch:
  "Bring N changed files along", git's own switch, which refuses rather
  than overwrite one; or "Put N changed files away first", `git stash push
  --include-untracked`, then the switch, with an Undo that applies exactly
  that stash entry back and drops it.

A new branch is `git switch -c` from where the checkout is, which carries
every changed file and can't conflict; its row says so.

WHICH STATE. Every verb's id carries the branch, the commit the checkout is
on and a digest of `git status`, read again at the press: anything that moved
refuses. Nothing switches while the agent is working, since it is writing in
this checkout.

GIT. ide_git's hardened git with the repo's attributes on (a checkout needs
its eol rules), its own filter drivers blanked and its hooks off. The stash
is found again by the unique message it was given, never as stash@{0}: other
worktrees of the same repo share the stash list.
"""
from __future__ import annotations

import hashlib
import secrets

import ide_git
import realm_client

from . import ACTION_PREFIX, Bind, Context, Result, comp
from .agent_ide import _clean

# Branches listed, newest commit first. VS Code's picker lists every one; a
# card shows the ones a person goes back to. Guessed, never measured.
BRANCHES_SHOWN = 8
# How often the list is read while a card is open, the same as its changes
# (agents.DIFF_EVERY).
BRANCH_EVERY = 10.0
NAME_CHARS = 100


def plural(n: int, word: str) -> str:
    return f"1 {word}" if n == 1 else f"{n} {word}s"


def status_digest(status: bytes) -> str:
    return hashlib.sha256(status).hexdigest()[:12]


def read_state(git: ide_git.Git) -> dict | None:
    """{head, branch, branches, changed, digest} or None when it isn't a repo."""
    code, head, _ = git.text("rev-parse", "--verify", "-q", "HEAD")
    if code != 0:
        return None
    _, branch, _ = git.text("symbolic-ref", "-q", "--short", "HEAD")
    code, out, _ = git.text("for-each-ref", "--sort=-committerdate", "--format=%(refname:short)",
                            f"--count={BRANCHES_SHOWN + 1}", "refs/heads")
    branches = [b for b in out.splitlines() if b][:BRANCHES_SHOWN + 1] if code == 0 else []
    code, status, _ = git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=dirty")
    if code != 0:
        return None
    changed = len([x for x in status.split(b"\0") if len(x) > 3 and x[2:3] == b" "])
    return {"head": head.strip(), "branch": branch.strip(), "branches": branches, "changed": changed,
            "digest": status_digest(status)}


def valid_name(git: ide_git.Git, name: str) -> bool:
    if not name or len(name) > NAME_CHARS or name.startswith("-") or any(c.isspace() for c in name):
        return False
    code, _, _ = git.text("check-ref-format", "--branch", name)
    return code == 0


class Branches:
    """Mixed into surfaces.agents.Agents. Uses the host's spawn, connect,
    _lock, pinned, p, cid, clock, _claim, _release, _fresh, repo_of,
    _stale_changes and git_for."""

    def _branch_init(self) -> None:
        # (sid, root, at, state) of the open card's checkout.
        self._branch: tuple | None = None
        # The branch row pressed: (sid, name).
        self._branch_pick: tuple | None = None
        # The last stash this card made, for Undo: {sid, root, sha, tag, words}.
        self._branch_undo: dict | None = None
        self.branch_git = lambda root: ide_git.Git(root, attrs=True)
        p = ACTION_PREFIX
        self.actions.update({f"{p}branchpick": self.pick_branch, f"{p}switch": self.switch,
                             f"{p}branchnew": self.new_branch, f"{p}branchundo": self.branch_undo})

    def read_branches(self, row: dict, force: bool = False) -> None:
        root = self.repo_of(row)
        with self._lock:
            fresh = (self._branch and self._branch[0] == row["id"] and self._branch[1] == root
                     and self.clock() - self._branch[2] < BRANCH_EVERY)
        if (fresh and not force) or not root.startswith("/"):
            return
        state = read_state(self.branch_git(root))
        with self._lock:
            self._branch = (row["id"], root, self.clock(), state)

    def branch_model(self, shown: dict, values: dict, out: dict) -> None:
        p = self.p
        with self._lock:
            got = self._branch if self._branch and self._branch[0] == shown["id"] else None
            pick = self._branch_pick if self._branch_pick and self._branch_pick[0] == shown["id"] else None
            undo = dict(self._branch_undo) if self._branch_undo and self._branch_undo["sid"] == shown["id"] else None
        if undo:
            out[p("branchUndo")] = [{"id": undo["id"], "text": undo["words"]}]
        state = got[3] if got else None
        if not state:
            return
        cur = state["branch"]
        rows = []
        for name in state["branches"][:BRANCHES_SHOWN]:
            rows.append({"id": f"b:{name}", "kind": "branch", "segments": [
                {"text": _clean(name, 60), "match": name == cur}],
                "where": "checked out here" if name == cur else "", "selected": bool(pick and pick[1] == name)})
        out[p("branches")] = rows
        n = state["changed"]
        out[p("branchCap")] = _clean(f"Branches · on {cur or 'a detached commit'}"
                                     + (f" · {plural(n, 'changed file')}" if n else ""), 80)
        out[p("branchOn")] = True
        stamp = f"{state['head'][:12]}:{state['digest']}"
        if pick and pick[1] != cur and pick[1] in state["branches"]:
            name = _clean(pick[1], 60)
            if shown["status"] in ("running", "waiting_permission"):
                out[p("branchNote")] = "Switching waits until the agent stops: it's writing in this checkout."
            elif not n:
                out[p("switch")] = [{"id": f"clean:{stamp}:{pick[1]}", "accent": True,
                                     "text": f"Switch to {name} · nothing is changed here, so nothing is left behind"}]
            else:
                out[p("switch")] = [
                    {"id": f"carry:{stamp}:{pick[1]}", "accent": True, "text": _clean(
                        f"Switch to {name} and bring {plural(n, 'changed file')} along · git refuses if one "
                        "would be overwritten", 120)},
                    {"id": f"stash:{stamp}:{pick[1]}", "text": _clean(
                        f"Put {plural(n, 'changed file')} away first, then switch to {name} · Undo brings them "
                        "back", 120)}]
        new = str(values.get(p("branchName")) or "").strip()
        if new and shown["status"] not in ("running", "waiting_permission"):
            if new in state["branches"] or not valid_name(self.branch_git(got[1]), new):
                out[p("branchNote")] = "That can't be a new branch's name: it exists or git refuses it."
            else:
                carry = f" · {plural(n, 'changed file')} come along" if n else ""
                out[p("branchNew")] = [{"id": f"new:{stamp}:{new}", "accent": True, "text": _clean(
                    f"Make {new} from {cur or state['head'][:8]} and switch to it{carry}", 120)}]

    # ── presses ──────────────────────────────────────────────────────────

    def pick_branch(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        with self._lock:
            sid = self.pinned
            got = self._branch if self._branch and self._branch[0] == sid else None
        state = got[3] if got else None
        if not state or not key.startswith("b:") or key[2:] not in state["branches"]:
            return Result(False, "That branch isn't in the list any more.", updates={self.p("level"): "error"})
        with self._lock:
            self._branch_pick = (sid, key[2:])
        return Result(True, f"{_clean(key[2:], 60)}.")

    def _branch_press(self, ctx: Context, data, key: str, kinds: tuple):
        """(row, git, kind, name, state) after checking the press against
        the checkout as it is now, or a Result saying why not."""
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
            got = self._branch if self._branch and self._branch[0] == sid else None
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        kind, _, rest = key.partition(":")
        head, _, rest = rest.partition(":")
        digest, _, name = rest.partition(":")
        if row is None or not got or kind not in kinds or not name:
            return Result(False, "Nothing was switched: that row isn't the drawn one.", updates=bad)
        git = self.branch_git(got[1])
        state = read_state(git)
        if not state or f"{state['head'][:12]}" != head or state["digest"] != digest:
            self.read_branches(row, force=True)
            return Result(False, "Nothing was switched: the checkout changed since that was drawn. Look again.",
                          updates=bad, refetch=True)
        try:
            with self.connect(ctx) as conn:
                busy = self._fresh(conn, sid).get("status") in ("running", "waiting_permission")
        except realm_client.RealmError:
            busy = True
        if busy:
            return Result(False, "Nothing was switched: the agent is working in this checkout.", updates=bad)
        return row, git, kind, name, state

    def switch(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        got = self._branch_press(ctx, data, key, ("clean", "carry", "stash"))
        if isinstance(got, Result):
            return got
        row, git, kind, name, state = got
        bad = {self.p("level"): "error"}
        if name not in state["branches"] or name == state["branch"] or name.startswith("-"):
            return Result(False, "Nothing was switched: that branch isn't one to switch to.", updates=bad)
        if kind == "clean" and state["changed"]:
            return Result(False, "Nothing was switched: files changed since.", updates=bad)
        if not self._claim("branch", row["id"]):
            return Result(False, "Still switching.")
        try:
            stash = None
            if kind == "stash":
                tag = f"kyber: before switching to {name} {secrets.token_hex(3)}"
                code, _, err = git.text("stash", "push", "--include-untracked", "-m", tag)
                sha = find_stash(git, tag)
                if code != 0 or not sha:
                    return Result(False, f"Nothing was switched: git couldn't put the changes away ({first(err)}).",
                                  updates=bad, refetch=True)
                stash = {"sid": row["id"], "root": git.root, "sha": sha, "tag": tag, "id": f"unstash:{sha[:12]}",
                         "words": _clean(f"Brings back the {plural(state['changed'], 'file')} put away before "
                                         f"switching to {name}", 100)}
            code, _, err = git.text("switch", "--no-guess", "--no-recurse-submodules", name)
        finally:
            self._release("branch", row["id"])
        self.read_branches(row, force=True)
        self._stale_changes()
        with self._lock:
            self._branch_pick = None
            if stash:
                self._branch_undo = stash
        if code != 0:
            kept = " The changes are put away; Undo brings them back." if stash else ""
            return Result(False, f"git didn't switch to {name}: {first(err)}.{kept}", updates=bad, refetch=True)
        said = {"clean": "", "carry": f" Your {plural(state['changed'], 'changed file')} came along.",
                "stash": " The changes are put away; Undo brings them back."}[kind]
        return Result(True, f"On {name}.{said}", updates={self.p("level"): "success"}, refetch=True)

    def new_branch(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        got = self._branch_press(ctx, data, key, ("new",))
        if isinstance(got, Result):
            return got
        row, git, _, name, state = got
        bad = {self.p("level"): "error"}
        typed = str(values.get(self.p("branchName")) or "").strip()
        if typed != name or name in state["branches"] or not valid_name(git, name):
            return Result(False, "Nothing was made: the name changed or git refuses it.", updates=bad)
        if not self._claim("branch", row["id"]):
            return Result(False, "Still switching.")
        try:
            code, _, err = git.text("switch", "--no-recurse-submodules", "-c", name)
        finally:
            self._release("branch", row["id"])
        self.read_branches(row, force=True)
        self._stale_changes()
        if code != 0:
            return Result(False, f"git didn't make {name}: {first(err)}.", updates=bad, refetch=True)
        return Result(True, f"On {name}, new from {state['branch'] or state['head'][:8]}.",
                      updates={self.p("level"): "success", self.p("branchName"): ""}, refetch=True)

    def branch_undo(self, ctx: Context, data, values: dict) -> Result:
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            undo = dict(self._branch_undo) if self._branch_undo else None
            sid = self.pinned
        if not undo or undo["sid"] != sid or undo["id"] != key:
            return Result(False, "There's nothing to undo there any more.", updates=bad)
        git = self.branch_git(undo["root"])
        if find_stash(git, undo["tag"]) != undo["sha"]:
            with self._lock:
                self._branch_undo = None
            return Result(False, "Those put-away changes aren't in git's stash any more.", updates=bad)
        code, _, err = git.text("stash", "apply", "--index", undo["sha"])
        if code != 0:
            # The staged half can't always be put back as staged; the files
            # themselves can, which is what was promised.
            code, _, err = git.text("stash", "apply", undo["sha"])
        if code != 0:
            return Result(False, f"git couldn't bring them back here ({first(err)}). They're still put away as "
                                 f"“{undo['tag']}”.", updates=bad, refetch=True)
        drop_stash(git, undo["tag"], undo["sha"])
        with self._lock:
            self._branch_undo = None
        row = next((r for r in (data or {}).get("rows") or [] if r["id"] == sid), None)
        if row:
            self.read_branches(row, force=True)
        self._stale_changes()
        return Result(True, "Brought the changes back.", updates={self.p("level"): "success"}, refetch=True)

    # ── drawing ──────────────────────────────────────────────────────────

    def branch_blank(self) -> dict:
        p = self.p
        return {p("branchOn"): False, p("branches"): [], p("branchCap"): "", p("switch"): [], p("branchNew"): [],
                p("branchNote"): "", p("branchUndo"): []}

    def branch_plan(self, out: dict) -> dict:
        p = self.p
        return {"branch": bool(out.get(p("branchOn"))), "switch": bool(out.get(p("switch"))),
                "branchNew": bool(out.get(p("branchNew"))), "branchNote": bool(out.get(p("branchNote"))),
                "branchUndo": bool(out.get(p("branchUndo")))}

    def branch_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        p, c = self.p, self.cid
        parts: list[str] = []
        order: list[str] = []
        if plan.get("branch"):
            parts += [comp(c("branches"), "Hits", caption=Bind(p("branchCap")), items=Bind(p("branches")),
                           action=f"{ACTION_PREFIX}branchpick")]
            order.append("branches")
        if plan.get("switch"):
            parts.append(comp(c("switch"), "Events", caption="", items=Bind(p("switch")),
                              action=f"{ACTION_PREFIX}switch", actionLabel="Switch"))
            order.append("switch")
        if plan.get("branch"):
            parts.append(comp(c("branchname"), "Field", label="New branch", placeholder="A name for a new branch",
                              value=Bind(p("branchName"))))
            order.append("branchname")
        if plan.get("branchNote"):
            parts.append(comp(c("branchnote"), "Text", value=Bind(p("branchNote")), tone="muted"))
            order.append("branchnote")
        if plan.get("branchNew"):
            parts.append(comp(c("branchnew"), "Events", caption="", items=Bind(p("branchNew")),
                              action=f"{ACTION_PREFIX}branchnew", actionLabel="Make"))
            order.append("branchnew")
        if plan.get("branchUndo"):
            parts.append(comp(c("branchundo"), "Events", caption="", items=Bind(p("branchUndo")),
                              action=f"{ACTION_PREFIX}branchundo", actionLabel="Undo"))
            order.append("branchundo")
        return parts, order


def first(err: str) -> str:
    line = next((x.strip() for x in (err or "").splitlines() if x.strip()), "")
    return _clean(line.removeprefix("error: ").removeprefix("fatal: "), 120) or "no reason given"


def find_stash(git: ide_git.Git, tag: str) -> str:
    """The stash commit carrying exactly this message, or ""."""
    code, out, _ = git.text("stash", "list", "--format=%H %gs")
    if code != 0:
        return ""
    for line in out.splitlines():
        sha, _, subject = line.partition(" ")
        if subject.endswith(tag):
            return sha
    return ""


def drop_stash(git: ide_git.Git, tag: str, sha: str) -> None:
    """Drop the stash entry that is `sha`, found again by position now."""
    code, out, _ = git.text("stash", "list", "--format=%gd %H %gs")
    for line in out.splitlines() if code == 0 else []:
        ref, _, rest = line.partition(" ")
        got, _, subject = rest.partition(" ")
        if got == sha and subject.endswith(tag):
            git.text("stash", "drop", "-q", ref)
            return
