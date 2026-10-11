"""The agent card's editor half: find any file, search the code, open in place.

Caleb, 2026-10-11 2:55pm: "make chewb the world's best ide take all of
carlton's realm stuff and lock in bro we gotta mog every ide". He spent 18
hours in VS Code the week before, and the first thing that kept him there was
opening a file the agent had not touched. This is Realm's ⌘P and ⌘⇧F, run by
the engine (project.files, project.grep: git ls-files and git grep in the
session's checkout, ranked by realm's own ranker), drawn on the glass as
`Hits` rows (HitsView.swift) that open the file in the card's own File
editor, which already checks the version on disk, backs up what a save
replaces and keeps undo (FileSafety.swift).

ONE FIELD. Realm has two palettes; the glass has one field, "Find". A word
asks for file names at once and, from GREP_MIN characters, for the lines
that contain it, as two groups under one caption each. Nothing is drawn for
an empty field (hud/CLAUDE.md, Past the window 6).

AS YOU TYPE. A keystroke reaches model() (the daemon's on_value); a search
for that text starts on a thread unless one is running, and when it lands
the provider pokes the daemon to redraw. A search whose text is no longer
the field's is thrown away and the field's text searched next, so at most
one search runs and the last word typed always wins.

WHICH FILE A PRESS OPENS. A row id is `f<gen>:<i>` or `g<gen>:<i>`, an index
into the answer that was drawn, never a path. A press whose generation is
not the current answer's refuses, so a row that moved under the pointer
cannot open its neighbour. The path is the checkout root joined to realm's
repo-relative path and must resolve inside the root and outside .git
(session_tree.inside); it opens editable only when session_tree.editable
says it is a regular, text-sized file inside the repo.

THE @ PICKER. Realm's prompter grammar (packages/contracts mention-refs.ts,
read 2026-10-11): typing `@` and a word in the reply lists the session's files
ranked against the word; picking one puts `@[name]` in the text and the file
beside it, and "an entry lives while its token does", so deleting the token
drops the file. Send hands the live ones to sessions.send as mentionRefs, and
the engine attaches each file and says which chip was which. A file that
exists to hold a secret (.env, a key, ~/.ssh) is never listed and never sent,
the same rule realm's server applies again on its side.

READS ONLY. Searching runs git through the engine and changes nothing. The
only write here is the person's own Save in the File editor, which is Kyber's
(FileSafety), not this daemon's, and the mentions a Send carries, which go
with the press that sends them.
"""
from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

import realm_client
import session_tree

from . import ACTION_PREFIX, Bind, Context, Result, comp

# File names shown for a word. Realm's palette asks for 20 and its `@` list
# for 8 (MENTION_FILES_LIMIT); a card on the glass is narrower than either
# and is read, not scrolled, so it takes the `@` list's number. Guessed from
# his, never measured on the glass.
FIND_FILES = 8
# Lines shown for a word, the same bound for the same reason.
FIND_LINES = 8
# The shortest word that also searches file contents. One or two characters
# match nearly every line in a repo and git grep reads every file to say so;
# guessed, never measured.
GREP_MIN = 3
# The longest word sent: realm's SEARCH_QUERY_MAX is far larger, but a line
# typed into the field past this is a sentence, not a search. Guessed.
QUERY_CHARS = 200
# How long the engine has for a search. Realm bounds git itself
# (workspace/grep.ts); this only stops a hung socket holding the thread.
SEARCH_TIMEOUT = 15.0
# A path's folder as shown under its name, clipped in the middle by Kyber.
WHERE_CHARS = 90
# Files the `@` list shows, and the most one message may name: realm's own
# MENTION_FILES_LIMIT and MAX_MENTION_REFS ("a prompt that points at twelve
# files has stopped pointing").
MENTION_FILES = 8
MAX_REFS = 12
# realm's CHIP_LABEL_MAX: a chip's name, clipped.
LABEL_CHARS = 56
# The word being typed after an `@` at the end of the reply: no space,
# bracket or second `@` in it. Realm's own token grammar is `@[name]`.
MENTION_AT = re.compile(r"(?:^|(?<=\s))@([^\s@\[\]]{0,64})$")
TOKEN = re.compile(r"@\[([^\[\]\n]{1,56})\]")
# Files that exist to hold a secret, never listed and never handed to an
# agent. The same sets realm's isSecretPath checks, written out here as
# facts (mention-refs.ts at 59afd9e4): a name, an extension, or a folder.
SECRET_NAMES = frozenset({".env", ".envrc", ".netrc", ".npmrc", ".pypirc", ".pgpass", ".git-credentials",
                          ".htpasswd", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials",
                          "credentials.json"})
SECRET_EXTS = frozenset({"pem", "key", "p12", "pfx", "jks", "keystore", "kdbx", "ppk"})
SECRET_DIRS = frozenset({".ssh", ".aws", ".gnupg"})
TEMPLATE = re.compile(r"\.(example|sample|template|dist)$")


def secret_path(path: str) -> bool:
    """A file that holds a secret, by its path alone. A template of one
    (.env.example) is not."""
    parts = [x for x in str(path).split("/") if x]
    if any(x in SECRET_DIRS for x in parts[:-1]):
        return True
    name = parts[-1] if parts else ""
    if TEMPLATE.search(name):
        return False
    if name in SECRET_NAMES or name.startswith(".env.") or re.match(r"^client_secret.*\.json$", name):
        return True
    dot = name.rfind(".")
    return dot > 0 and name[dot + 1:].lower() in SECRET_EXTS


def mention_word(draft: str) -> str | None:
    """The word after a trailing `@` in the reply, or None when the reply
    doesn't end in one."""
    m = MENTION_AT.search(draft or "")
    return m.group(1) if m else None


def live_refs(text: str, refs: dict) -> list[dict]:
    """The mentions a Send carries: each file whose `@[name]` is still in
    the text, once, in the order the tokens appear, at most MAX_REFS."""
    out, seen = [], set()
    for label in TOKEN.findall(text or ""):
        path = refs.get(label)
        if path and label not in seen and not secret_path(path):
            seen.add(label)
            out.append({"kind": "file", "label": label, "path": path})
    return out[:MAX_REFS]


def _clean(text, limit: int) -> str:
    return session_tree.clean(str(text or ""))[:limit]


def runs(segments, limit: int = 160) -> list[dict]:
    """Realm's SearchSnippet as Hits segments, cleaned and clipped, keeping
    which runs matched."""
    out, used = [], 0
    for seg in segments if isinstance(segments, list) else []:
        if not isinstance(seg, dict) or used >= limit:
            continue
        text = _clean(seg.get("text"), limit - used)
        if text:
            out.append({"text": text, "match": seg.get("match") is True})
            used += len(text)
    return out


def split_name(segments: list[dict]) -> tuple[list[dict], str]:
    """A path's runs split at its last "/": the name's runs, and the folder
    as plain text, so a row reads as the file with its place under it."""
    whole = "".join(s["text"] for s in segments)
    cut = whole.rfind("/") + 1
    if cut <= 0:
        return segments, ""
    name, pos = [], 0
    for s in segments:
        end = pos + len(s["text"])
        if end > cut:
            name.append({"text": s["text"][max(0, cut - pos):], "match": s["match"]})
        pos = end
    return name, whole[:cut - 1]


class Ide:
    """Mixed into surfaces.agents.Agents: state, model, layout parts and
    presses for the card's finder. Uses the host's connect, spawn, _lock,
    pinned, p and cid."""

    def _ide_init(self) -> None:
        # The last answer: {sid, root, query, gen, files, lines, truncated, source}.
        self._found: dict | None = None
        self._searching = False
        self._find_gen = 0
        # The open file: (sid, absolute path, line, root).
        self._file: tuple | None = None
        # The `@` list's last answer: {sid, root, query, gen, hits}.
        self._mention_found: dict | None = None
        self._mentioning = False
        # session id -> {chip label: absolute path} picked from the `@` list.
        self._refs: dict = {}
        p = ACTION_PREFIX
        self.actions.update({f"{p}open": self.open_hit, f"{p}fileclose": self.close_file,
                             f"{p}mention": self.pick_mention})

    # ── where a session's code is ────────────────────────────────────────

    @staticmethod
    def repo_of(row: dict) -> str:
        """The checkout a session's files live in: realm's own cwd for now."""
        return str(row.get("repo") or row.get("cwd_raw") or "")

    # ── searching ────────────────────────────────────────────────────────

    def _search_soon(self, ctx: Context, sid: str, root: str, query: str) -> None:
        """Start a search for `query` unless one is running; the one running
        starts the next when it lands, if the field moved on."""
        with self._lock:
            if self._searching:
                return
            self._searching = True

        def work() -> None:
            files, lines, truncated, source, why = [], [], False, "git", ""
            try:
                with self.connect(ctx) as conn:
                    got = conn.call("project.files", {"cwd": root, "query": query, "limit": FIND_FILES},
                                    timeout=SEARCH_TIMEOUT, allow_exec=True)
                    if isinstance(got, dict):
                        files = [h for h in got.get("hits") or [] if isinstance(h, dict)
                                 and isinstance(h.get("path"), str)][:FIND_FILES]
                        truncated = bool(got.get("truncated"))
                        source = "walk" if got.get("source") == "walk" else "git"
                    if len(query) >= GREP_MIN:
                        got = conn.call("project.grep", {"cwd": root, "query": query, "limit": FIND_LINES},
                                        timeout=SEARCH_TIMEOUT, allow_exec=True)
                        if isinstance(got, dict):
                            lines = [h for h in got.get("hits") or [] if isinstance(h, dict)
                                     and isinstance(h.get("path"), str)][:FIND_LINES]
                            truncated = truncated or bool(got.get("truncated"))
            except realm_client.RealmError as err:
                why = "the engine couldn't search it" if not isinstance(err, realm_client.RealmRpcError) \
                    else f"the engine said {_clean(err.message, 80)}"
            with self._lock:
                self._find_gen += 1
                self._found = {"sid": sid, "root": root, "query": query, "gen": self._find_gen, "files": files,
                               "lines": lines, "truncated": truncated, "source": source, "why": why}
                self._searching = False
            self.poke()

        self.spawn(work)

    def find_model(self, shown: dict, values: dict, out: dict, ctx: Context) -> None:
        """The Find field's answer, and the open file, for the open card."""
        p = self.p
        root = self.repo_of(shown)
        if not root.startswith("/"):
            return
        out[p("findOn")] = True
        query = str(values.get(p("find")) or "").strip()[:QUERY_CHARS]
        with self._lock:
            found = dict(self._found) if self._found else None
            opened = self._file if self._file and self._file[0] == shown["id"] else None
            searching = self._searching
        current = bool(found and found["sid"] == shown["id"] and found["root"] == root
                       and found["query"] == query)
        if query and not current and not searching:
            self._search_soon(ctx, shown["id"], root, query)
        if query and current:
            gen = found["gen"]
            base = Path(root).resolve()
            open_path = opened[1] if opened else ""
            file_rows = []
            for i, hit in enumerate(found["files"]):
                name, where = split_name(runs(hit.get("segments")) or [{"text": hit["path"], "match": False}])
                file_rows.append({"id": f"f{gen}:{i}", "kind": "file", "segments": name,
                                  "where": _clean(where, WHERE_CHARS),
                                  "selected": open_path == str(base / hit["path"])})
            line_rows = []
            for i, hit in enumerate(found["lines"]):
                line = hit.get("line") if isinstance(hit.get("line"), int) else 0
                line_rows.append({"id": f"g{gen}:{i}", "kind": "line", "segments": runs(hit.get("segments")),
                                  "where": _clean(f"{hit['path']} · {line}", WHERE_CHARS),
                                  "selected": bool(opened and open_path == str(base / hit["path"])
                                                   and opened[2] == line)})
            out[p("findFiles")] = [r for r in file_rows if r["segments"]]
            out[p("findLines")] = [r for r in line_rows if r["segments"]]
            # A cap hit is said, so "these are the matches" is never claimed
            # for a first N (realm's own palette says "first N").
            more = " · first few" if found["truncated"] else ""
            walk = " · not a git repo, so a slower walk" if found["source"] == "walk" else ""
            if out[p("findFiles")]:
                out[p("findFilesCap")] = f"Files{more}{walk}"
            if out[p("findLines")]:
                out[p("findLinesCap")] = f"In the code{more}"
            if found.get("why"):
                out[p("findNote")] = f"Couldn't search {Path(root).name}: {found['why']}."
            elif not out[p("findFiles")] and not out[p("findLines")]:
                out[p("findNote")] = f"Nothing in {Path(root).name} matches that."
        if opened:
            out[p("filePath")] = opened[1]
            out[p("fileLine")] = opened[2]
            out[p("fileEdit")] = session_tree.editable(opened[1], opened[3])
            out[p("fileClose")] = [{"id": f"close:{opened[1]}", "text": _clean(
                f"{Path(opened[1]).name} · an unsaved edit is kept as a draft", 90)}]

    # ── the @ picker ─────────────────────────────────────────────────────

    def _mention_soon(self, ctx: Context, row: dict, root: str, query: str) -> None:
        """Ask for the files an `@` word names: realm's own `@` list
        (mentions.files) when the session's checkout is its cwd, else
        project.files over the checkout the session really works in, with
        the secret files left out here since realm's list would have."""
        with self._lock:
            if self._mentioning:
                return
            self._mentioning = True
        sid = row["id"]
        native = root == row.get("cwd_raw")

        def work() -> None:
            hits: list = []
            try:
                with self.connect(ctx) as conn:
                    if native:
                        got = conn.call("mentions.files", {"sessionId": sid, "query": query,
                                                           "limit": MENTION_FILES},
                                        timeout=SEARCH_TIMEOUT, allow_exec=True)
                    else:
                        got = conn.call("project.files", {"cwd": root, "query": query,
                                                          "limit": MENTION_FILES * 2},
                                        timeout=SEARCH_TIMEOUT, allow_exec=True)
                hits = [h for h in (got.get("hits") or [] if isinstance(got, dict) else [])
                        if isinstance(h, dict) and isinstance(h.get("path"), str)
                        and not secret_path(h["path"])][:MENTION_FILES]
            except realm_client.RealmError:
                hits = []  # no list: the `@` stays plain text, and Send sends it as typed
            with self._lock:
                self._find_gen += 1
                self._mention_found = {"sid": sid, "root": root, "query": query, "gen": self._find_gen,
                                       "hits": hits}
                self._mentioning = False
            self.poke()

        self.spawn(work)

    def mention_model(self, shown: dict, values: dict, out: dict, ctx: Context) -> None:
        """The `@` list under the reply while it ends in `@word`, and the
        files the Send row will carry."""
        p = self.p
        root = self.repo_of(shown)
        draft = str(values.get(p("draft")) or "")
        with self._lock:
            refs = dict(self._refs.get(shown["id"]) or {})
            found = dict(self._mention_found) if self._mention_found else None
            busy = self._mentioning
        carried = live_refs(draft, refs)
        if carried and out.get(p("send")):
            names = ", ".join(r["label"] for r in carried[:3]) + (f" and {len(carried) - 3} more"
                                                                    if len(carried) > 3 else "")
            row = dict(out[p("send")][0])
            row["text"] = _clean(f"{row['text'].split(' · ')[0]} · with {names} · can't be unsent", 120)
            out[p("send")] = [row]
        word = mention_word(draft)
        if word is None or not root.startswith("/"):
            return
        current = bool(found and found["sid"] == shown["id"] and found["root"] == root and found["query"] == word)
        if not current:
            if not busy:
                self._mention_soon(ctx, shown, root, word)
            return
        rows = []
        for i, hit in enumerate(found["hits"]):
            name, where = split_name(runs(hit.get("segments")) or [{"text": hit["path"], "match": False}])
            if name:
                rows.append({"id": f"m{found['gen']}:{i}", "kind": "file", "segments": name,
                             "where": _clean(where, WHERE_CHARS)})
        out[p("mentions")] = rows
        if rows:
            out[p("mentionsCap")] = "Attach a file"

    def pick_mention(self, ctx: Context, data, values: dict) -> Result:
        """Put the picked file's `@[name]` in place of the `@word` typed,
        and keep the file beside the text until Send or until its token goes."""
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        draft = str(values.get(self.p("draft")) or "")
        with self._lock:
            sid = self.pinned
            found = dict(self._mention_found) if self._mention_found else None
        head, _, index = key.partition(":")
        word = mention_word(draft)
        if (not found or found["sid"] != sid or head != f"m{found['gen']}" or not index.isdigit()
                or int(index) >= len(found["hits"]) or word is None or word != found["query"]):
            return Result(False, "That list changed under the press. Type the @ again.", updates=bad)
        hit = found["hits"][int(index)]
        root = Path(found["root"]).resolve()
        rel = session_tree.inside(root, str(root / str(hit["path"])))
        if rel is None or secret_path(rel) or not (root / rel).is_file():
            return Result(False, "That file can't be attached.", updates=bad)
        path = str(root / rel)
        with self._lock:
            refs = self._refs.setdefault(sid, {})
            label = _clean(PurePosixPath(rel).name, LABEL_CHARS).replace("[", "(").replace("]", ")")
            if refs.get(label, path) != path:
                # Two files with one name: the second chip carries its folder.
                label = _clean(rel, LABEL_CHARS).replace("[", "(").replace("]", ")")
            refs[label] = path
        text = draft[: len(draft) - len(word) - 1] + f"@[{label}] "
        return Result(True, f"Attaches {label} when you send.", updates={self.p("draft"): text})

    def mentions_for(self, sid: str, text: str) -> list[dict]:
        """What Send hands sessions.send as mentionRefs for this text."""
        with self._lock:
            refs = dict(self._refs.get(sid) or {})
        return live_refs(text, refs)

    def forget_mentions(self, sid: str) -> None:
        with self._lock:
            self._refs.pop(sid, None)

    # ── drawing ──────────────────────────────────────────────────────────

    def mention_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        if not plan.get("mentions"):
            return [], []
        return ([comp(self.cid("mentions"), "Hits", caption=Bind(self.p("mentionsCap")),
                      items=Bind(self.p("mentions")), action=f"{ACTION_PREFIX}mention")], ["mentions"])

    def find_parts(self, plan: dict) -> tuple[list[str], list[str]]:
        """The card's finder components and their order, from the plan."""
        p, c = self.p, self.cid
        parts: list[str] = []
        order: list[str] = []
        if not plan.get("find"):
            return parts, order
        parts.append(comp(c("find"), "Field", label="Find", placeholder="A file's name, or code to search for",
                          value=Bind(p("find"))))
        order.append("find")
        if plan.get("findNote"):
            parts.append(comp(c("findnote"), "Text", value=Bind(p("findNote")), tone="muted"))
            order.append("findnote")
        if plan.get("findFiles"):
            parts.append(comp(c("findfiles"), "Hits", caption=Bind(p("findFilesCap")), items=Bind(p("findFiles")),
                              action=f"{ACTION_PREFIX}open"))
            order.append("findfiles")
        if plan.get("findLines"):
            parts.append(comp(c("findlines"), "Hits", caption=Bind(p("findLinesCap")), items=Bind(p("findLines")),
                              action=f"{ACTION_PREFIX}open"))
            order.append("findlines")
        if plan.get("file"):
            # The editable flag is fixed per draw: a File reads `editable`
            # once, so the plan carries it and a change redraws the card.
            parts += [comp(c("file"), "File", path=Bind(p("filePath")), line=Bind(p("fileLine")),
                           editable=bool(plan.get("fileEdit"))),
                      comp(c("fileclose"), "Events", caption="", items=Bind(p("fileClose")),
                           action=f"{ACTION_PREFIX}fileclose", actionLabel="Close")]
            order += ["file", "fileclose"]
        return parts, order

    def find_plan(self, out: dict) -> dict:
        p = self.p
        return {"find": bool(out.get(p("findOn"))), "findNote": bool(out.get(p("findNote"))),
                "mentions": bool(out.get(p("mentions"))),
                "findFiles": bool(out.get(p("findFiles"))), "findLines": bool(out.get(p("findLines"))),
                "file": bool(out.get(p("filePath"))), "fileEdit": bool(out.get(p("fileEdit")))}

    def find_blank(self) -> dict:
        p = self.p
        return {p("findOn"): False, p("findNote"): "", p("findFiles"): [], p("findLines"): [],
                p("findFilesCap"): "", p("findLinesCap"): "", p("filePath"): "", p("fileLine"): 0,
                p("fileEdit"): False, p("fileClose"): [], p("mentions"): [], p("mentionsCap"): ""}

    # ── presses ──────────────────────────────────────────────────────────

    def open_hit(self, ctx: Context, data, values: dict) -> Result:
        """Open the file a Hits row named, in the card, at its line."""
        key = str(values.get("row") or "")
        bad = {self.p("level"): "error"}
        with self._lock:
            sid = self.pinned
            found = dict(self._found) if self._found else None
        head, _, index = key.partition(":")
        if not found or found["sid"] != sid or len(head) < 2 or head[0] not in "fg" \
                or head[1:] != str(found["gen"]) or not index.isdigit():
            return Result(False, "Those results changed under the press. Press the row again.", updates=bad)
        hits = found["files"] if head[0] == "f" else found["lines"]
        if int(index) >= len(hits):
            return Result(False, "That result isn't there any more.", updates=bad)
        hit = hits[int(index)]
        root = Path(found["root"])
        rel = session_tree.inside(root.resolve(), str(root / str(hit["path"])))
        if rel is None:
            return Result(False, "That path is outside the project, so it wasn't opened.", updates=bad)
        path = str(root.resolve() / rel)
        if not Path(path).is_file():
            return Result(False, f"{PurePosixPath(rel).name} isn't on disk any more.", updates=bad)
        line = hit.get("line") if head[0] == "g" and isinstance(hit.get("line"), int) else 0
        with self._lock:
            self._file = (sid, path, line, str(root.resolve()))
        name = PurePosixPath(rel).name
        return Result(True, f"{name}, line {line}." if line else f"{name}.", updates={self.p("level"): "info"})

    def close_file(self, ctx: Context, data, values: dict) -> Result:
        """Take the open file off the card. Kyber keeps an unsaved draft
        (FileSafety.rescue) and offers it the next time that file opens."""
        key = str(values.get("row") or "")
        with self._lock:
            if not self._file or key != f"close:{self._file[1]}":
                return Result(False, "That file isn't the open one.")
            name = Path(self._file[1]).name
            self._file = None
        return Result(True, f"Closed {name}.")
