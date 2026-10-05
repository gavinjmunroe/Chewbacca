"""One local typed graph of the person's day, so a surface is a walk, not an app.

"graph engineer harder" (Caleb, 2026-10-04). A messages panel and a mail panel
rebuild the silos the OS is meant to dissolve: Karthik is one person whether he
texted, emailed or is on the calendar. So every source is an INGESTER that
writes typed facts here, and every surface is a query over them.

STORE. SQLite at ~/.chewbacca/os-graph.sqlite (KYBER_OS_GRAPH). Two tables,
nodes and edges, and every row carries `source`, `observed_at` and
`confidence` (graph-engineering skill, Working Rules: provenance on every fact).

ONTOLOGY. Minimal, verb-named, with domain and range enforced on every write
(stage 5: "reject edges whose endpoints have incompatible types. This one
validation step removes most hallucinated structure"). `Day` is the one type
beyond the brief: DUE_ON needs a range, and a day node is what lets "everything
due Tuesday" be one hop.

FUSION before storing (stage 8). A handle or address becomes a Person only
through the `people` store's `identities` table, which already resolved each
phone and email to one person. A value that maps to two people, or to none,
stays its own Person node flagged unresolved. Nothing is ever merged on a name:
Tyler Law and Tyler Larsen are two people (memory,
feedback_resolve_identity_before_writing).

SNAPSHOTS. An ingester replaces everything it wrote last time in one
transaction (`apply`), so a thread that got its reply loses its
AWAITS_REPLY_FROM edge on the next pass instead of lingering.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

NODE_TYPES = frozenset({
    "Person", "Thread", "Message", "MailItem", "Event", "Assignment", "Task",
    "Project", "Space", "Track", "File", "Day",
})
ANY = NODE_TYPES
# verb -> (domain, range)
EDGE_TYPES: dict[str, tuple[frozenset, frozenset]] = {
    "SENT_BY": (frozenset({"Message", "MailItem"}), frozenset({"Person"})),
    "IN_THREAD": (frozenset({"Message"}), frozenset({"Thread"})),
    "PARTICIPANT": (frozenset({"Thread"}), frozenset({"Person"})),
    "AWAITS_REPLY_FROM": (frozenset({"Thread", "MailItem"}), frozenset({"Person"})),
    "DUE_ON": (frozenset({"Assignment", "Task", "Event"}), frozenset({"Day"})),
    "OWED_BY": (frozenset({"Task", "Assignment"}), frozenset({"Person"})),
    "OWED_TO": (frozenset({"Task"}), frozenset({"Person"})),
    "BELONGS_TO": (ANY - {"Space"}, frozenset({"Space"})),
    "ABOUT": (ANY - {"Project"}, frozenset({"Project"})),
    "ATTENDS": (frozenset({"Person"}), frozenset({"Event"})),
    "MENTIONS": (ANY, ANY),
    "EXTRACTED_FROM": (frozenset({"Task"}), frozenset({"Message", "MailItem", "Event", "Thread"})),
}
ME = "person:me"


class OntologyError(ValueError):
    pass


def default_path() -> Path:
    return Path(os.environ.get("KYBER_OS_GRAPH") or Path.home() / ".chewbacca" / "os-graph.sqlite")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


@dataclass
class Node:
    id: str
    type: str
    label: str
    props: dict = field(default_factory=dict)
    confidence: float = 1.0
    unresolved: bool = False
    observed_at: str = ""


@dataclass
class Edge:
    src: str
    verb: str
    dst: str
    props: dict = field(default_factory=dict)
    confidence: float = 1.0
    observed_at: str = ""


def check_edge(edge: Edge, types: dict[str, str]) -> None:
    """Raise OntologyError unless the verb exists and both ends fit it."""
    if edge.verb not in EDGE_TYPES:
        raise OntologyError(f"unknown relation {edge.verb}")
    domain, rng = EDGE_TYPES[edge.verb]
    src_type, dst_type = types.get(edge.src), types.get(edge.dst)
    if src_type is None or dst_type is None:
        raise OntologyError(f"{edge.verb} names a node that does not exist: {edge.src} -> {edge.dst}")
    if src_type not in domain:
        raise OntologyError(f"{edge.verb} cannot start at a {src_type} ({edge.src})")
    if dst_type not in rng:
        raise OntologyError(f"{edge.verb} cannot end at a {dst_type} ({edge.dst})")


def check_node(node: Node) -> None:
    if node.type not in NODE_TYPES:
        raise OntologyError(f"unknown node type {node.type}")
    if not node.id or ":" not in node.id:
        raise OntologyError(f"node id must be '<kind>:<key>', got {node.id!r}")
    if not 0.0 <= node.confidence <= 1.0:
        raise OntologyError(f"confidence out of range on {node.id}")


SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL, observed_at TEXT NOT NULL, confidence REAL NOT NULL, unresolved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL, verb TEXT NOT NULL, dst TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL, observed_at TEXT NOT NULL, confidence REAL NOT NULL,
  PRIMARY KEY (src, verb, dst, source)
);
CREATE INDEX IF NOT EXISTS edges_dst ON edges (dst, verb);
CREATE INDEX IF NOT EXISTS edges_src ON edges (src, verb);
CREATE INDEX IF NOT EXISTS nodes_source ON nodes (source);
"""


class Graph:
    def __init__(self, path: Path | str | None = None):
        self.path = str(path or default_path())
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()

    # ── writing ──────────────────────────────────────────────────────────

    def apply(self, source: str, nodes: list[Node], edges: list[Edge]) -> dict:
        """Replace everything `source` wrote with this snapshot, atomically.

        A node another source also wrote keeps that source's row (the primary
        key is the id, so the newest writer's label wins; shared nodes like
        Person and Space are written identically by every source that needs
        them). Edges are validated against the ontology AFTER the snapshot's
        nodes exist, and an invalid edge fails the whole snapshot, because a
        half-written snapshot is how a graph quietly goes wrong."""
        stamp = now_iso()
        for n in nodes:
            check_node(n)
        with self.lock, self.db:
            self.db.execute("DELETE FROM edges WHERE source = ?", (source,))
            # A node is only removed when no other source still holds it.
            self.db.execute(
                "DELETE FROM nodes WHERE source = ? AND id NOT IN (SELECT src FROM edges) "
                "AND id NOT IN (SELECT dst FROM edges)", (source,))
            for n in nodes:
                self.db.execute(
                    "INSERT INTO nodes (id, type, label, props, source, observed_at, confidence, unresolved) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                    "type = excluded.type, label = excluded.label, props = excluded.props, "
                    "source = excluded.source, observed_at = excluded.observed_at, "
                    "confidence = excluded.confidence, unresolved = excluded.unresolved",
                    (n.id, n.type, n.label, json.dumps(n.props, default=str), source,
                     n.observed_at or stamp, n.confidence, int(n.unresolved)))
            ids = {e.src for e in edges} | {e.dst for e in edges}
            types = self.types(ids)
            for e in edges:
                check_edge(e, types)
                self.db.execute(
                    "INSERT OR REPLACE INTO edges (src, verb, dst, props, source, observed_at, confidence) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (e.src, e.verb, e.dst, json.dumps(e.props, default=str), source,
                     e.observed_at or stamp, e.confidence))
        return {"nodes": len(nodes), "edges": len(edges)}

    def types(self, ids) -> dict[str, str]:
        ids = list(ids)
        out: dict[str, str] = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            marks = ",".join("?" * len(chunk))
            for row in self.query(f"SELECT id, type FROM nodes WHERE id IN ({marks})", chunk):
                out[row["id"]] = row["type"]
        return out

    # ── reading ──────────────────────────────────────────────────────────

    def query(self, sql: str, args=()) -> list:
        """Every read goes through here, under the lock: the daemon ingests on
        one thread while surfaces walk on others, over one connection."""
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def node(self, node_id: str) -> dict | None:
        rows = self.query("SELECT * FROM nodes WHERE id = ?", (node_id,))
        return _node(rows[0]) if rows else None

    def nodes(self, type_: str | None = None) -> list[dict]:
        if type_:
            return [_node(r) for r in self.query("SELECT * FROM nodes WHERE type = ?", (type_,))]
        return [_node(r) for r in self.query("SELECT * FROM nodes")]

    def edges(self, src: str | None = None, verb: str | None = None, dst: str | None = None) -> list[dict]:
        where, args = [], []
        for col, val in (("src", src), ("verb", verb), ("dst", dst)):
            if val is not None:
                where.append(f"{col} = ?")
                args.append(val)
        sql = "SELECT * FROM edges" + (" WHERE " + " AND ".join(where) if where else "")
        return [_edge(r) for r in self.query(sql, args)]

    def out(self, src: str, verb: str) -> list[dict]:
        return [self.node(e["dst"]) for e in self.edges(src=src, verb=verb) if self.node(e["dst"])]

    def into(self, dst: str, verb: str) -> list[dict]:
        return [self.node(e["src"]) for e in self.edges(verb=verb, dst=dst) if self.node(e["src"])]

    def validate(self) -> list[str]:
        """Every stored edge re-checked against the ontology. Empty is clean."""
        problems = []
        types = {r["id"]: r["type"] for r in self.query("SELECT id, type FROM nodes")}
        for e in self.edges():
            try:
                check_edge(Edge(e["src"], e["verb"], e["dst"]), types)
            except OntologyError as err:
                problems.append(str(err))
        return problems

    def counts(self) -> dict:
        return {
            "nodes": {r[0]: r[1] for r in self.query("SELECT type, COUNT(*) FROM nodes GROUP BY type")},
            "edges": {r[0]: r[1] for r in self.query("SELECT verb, COUNT(*) FROM edges GROUP BY verb")},
        }


def _node(row) -> dict:
    d = dict(row)
    d["props"] = json.loads(d["props"] or "{}")
    d["unresolved"] = bool(d["unresolved"])
    return d


def _edge(row) -> dict:
    d = dict(row)
    d["props"] = json.loads(d["props"] or "{}")
    return d


# ── fusion: who a handle is ──────────────────────────────────────────────


def phone_key(value: str) -> str:
    """The last ten digits, so "+1 (310) 555-0100" and "3105550100" meet.
    Numbers shorter than ten digits are kept whole."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


class Identities:
    """Read-only view of the people store's resolved handles.

    One phone or email belongs to one person there (its primary key is
    (kind, value)), but formats differ ("(626) ..." vs "+1626..."), so phones
    meet on their last ten digits. A key that two people share is AMBIGUOUS and
    resolves to nobody: guessing between them is the merge this refuses."""

    def __init__(self, db_path: Path | str | None = None):
        path = Path(db_path or os.environ.get("PEOPLE_DB")
                    or Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people") / "people.db")
        self.people: dict[str, dict] = {}
        self.by_key: dict[str, set[str]] = {}
        self.tasks: list[dict] = []
        self.scores: dict[str, float] = {}
        self.ok = path.exists()
        if not self.ok:
            return
        try:
            db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
        except sqlite3.Error:
            self.ok = False
            return
        try:
            for pid, name, company, nickname in db.execute(
                    "SELECT id, name, company, nickname FROM people WHERE deleted_at IS NULL"):
                self.people[pid] = {"id": pid, "name": name, "company": company or "", "nickname": nickname or ""}
            for pid, kind, value in db.execute("SELECT person_id, kind, value FROM identities"):
                if pid not in self.people:
                    continue
                key = ("phone:" + phone_key(value)) if kind == "phone" else ("email:" + value.strip().lower())
                self.by_key.setdefault(key, set()).add(pid)
            try:
                self.tasks = [dict(zip(("id", "person_id", "title", "due_at"), r)) for r in db.execute(
                    "SELECT id, person_id, title, due_at FROM tasks WHERE done_at IS NULL")]
            except sqlite3.Error:
                self.tasks = []
            try:
                # The people CLI's own ranking: base score plus warmth.
                self.scores = {pid: (base or 0.0) + (warmth or 0.0) for pid, base, warmth in db.execute(
                    "SELECT person_id, base_score, warmth FROM person_scores")}
            except sqlite3.Error:
                self.scores = {}
        except sqlite3.Error:
            self.ok = False
        finally:
            db.close()

    def resolve(self, handle: str) -> str | None:
        """people id for an iMessage handle or email address, or None."""
        handle = (handle or "").strip()
        key = ("email:" + handle.lower()) if "@" in handle else ("phone:" + phone_key(handle))
        found = self.by_key.get(key) or set()
        return next(iter(found)) if len(found) == 1 else None

    def by_name(self, name: str) -> list[dict]:
        """Exact full-name or nickname match, case-insensitive. A first name
        alone matches only when it IS someone's whole recorded name or
        nickname; callers get every match and must refuse when there are two."""
        want = " ".join((name or "").lower().split())
        return [p for p in self.people.values()
                if want and (p["name"].lower() == want or p["nickname"].lower() == want)]


def person_node(ids: Identities, handle: str, label: str = "", source_hint: str = "") -> Node:
    """The Person a handle is: the people-store person when it resolves, else
    a node of its own for that exact handle, flagged unresolved."""
    pid = ids.resolve(handle)
    if pid:
        p = ids.people[pid]
        return Node(f"person:{pid}", "Person", p["name"], {"company": p["company"]}, 1.0, False)
    clean = handle.strip().lower() if "@" in handle else (phone_key(handle) or handle.strip())
    return Node(f"person:handle:{clean}", "Person", label or handle.strip(),
                {"handle": handle.strip(), "seen_as": source_hint}, 0.5, True)


def me_node() -> Node:
    return Node(ME, "Person", os.environ.get("KYBER_SURFACES_OWNER") or "Me", {"me": True}, 1.0, False)


def day_node(day: str) -> Node:
    return Node(f"day:{day}", "Day", day)


def space_node(name: str) -> Node:
    return Node(f"space:{name}", "Space", name.capitalize())
