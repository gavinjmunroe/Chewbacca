"""One SQLite file for the state tabs race on.

Every write is a read-modify-write inside BEGIN IMMEDIATE, so two tabs that
change the same thing take turns instead of each writing back the copy it read
before the other one's change landed.

WHY. 2026-10-12, a 10-tab stress test (tests/test_state_stress.py) on the JSON
stores: 10 tabs adding 50 text drafts at once lost 19 to 22 of them, and 5 to 7
calls in a run crashed on a shared .tmp name; killing 20 queued jobs while 10 tabs
ticked brought 1 back as paused in 2 of 3 runs. Each store read a JSON file,
changed its copy and wrote the whole file back.

Where the file lives: CHEWBACCA_STATE_DB when set; otherwise
~/.chewbacca/state.sqlite when the store is exactly its default folder
(~/.chewbacca/jobs, ~/.chewbacca/people), and a private .state.sqlite inside
the store's folder anywhere else. Both stores find their default folder from
HOME, not CHEWBACCA_HOME, so this does too: otherwise a tab with
CHEWBACCA_HOME set would split the queue in two. A scratch store must never
write rows into the real file (2026-10-10: a guessed PEOPLE_DB put a test
person in the real people store), including one beside it such as
~/.chewbacca/people-test, which a parent-folder check let through (review,
10/12).

The JSON files stay as read-only mirrors, written inside the same transaction,
because other readers (the HUD's agent checks, home_agent, meeting_actions,
tests) read them. The rows here are the truth.

Runs on /usr/bin/python3 3.9: no `X | None`, no match.
"""
import contextlib
import os
import pathlib
import sqlite3
import time

# How long a writer waits for another tab's transaction. Measured 10/12 at
# load 5: 10 tabs adding 50 drafts at once, the slowest add took 0.11 s end to
# end. A jobs tick holds the lock while it reads memory_pressure, which has its
# own 10 s timeout. 30 s is that worst case three times over, for a swamped Mac
# (load 100 on 10/10), without hanging a tab forever on a stuck writer.
BUSY_MS = 30000

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL, mirror_ns INTEGER);
CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, body TEXT NOT NULL);
"""


def home():
    return pathlib.Path.home() / ".chewbacca"


def path_for(store_dir, name):
    """The state file for a store kept in store_dir, whose default folder is
    ~/.chewbacca/<name>."""
    if os.environ.get("CHEWBACCA_STATE_DB"):
        return pathlib.Path(os.environ["CHEWBACCA_STATE_DB"]).expanduser()
    store_dir = pathlib.Path(store_dir).expanduser()
    try:
        default = store_dir.resolve() == (home() / name).resolve()
    except OSError:
        default = False
    return home() / "state.sqlite" if default else store_dir / ".state.sqlite"


def connect(path):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # The WAL and shm sidecars are created with the process umask; job
    # commands and draft texts are private, so none of the three is readable
    # by group staff.
    previous = os.umask(0o077)
    try:
        db = sqlite3.connect(str(path), timeout=BUSY_MS / 1000, isolation_level=None)
        db.execute("PRAGMA busy_timeout=%d" % BUSY_MS)
        _wal(db)
        db.executescript(SCHEMA)
    finally:
        os.umask(previous)
    return db


def _wal(db):
    # WAL is a property of the file, so once set it stays. Switching to it is
    # the one step SQLite's busy wait doesn't cover: 12 processes opening a
    # fresh file at once, 1 died on "database is locked" here (10/12). So the
    # switch retries until another opener has done it.
    deadline = time.time() + BUSY_MS / 1000
    while True:
        try:
            if db.execute("PRAGMA journal_mode").fetchone()[0] == "wal":
                return
            db.execute("PRAGMA journal_mode=WAL")
            return
        except sqlite3.OperationalError:
            if time.time() > deadline:
                raise
            time.sleep(0.02)


@contextlib.contextmanager
def write(db):
    """One writer at a time, from the first read to the commit."""
    db.execute("BEGIN IMMEDIATE")
    try:
        yield db
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")


def mirror(path, text):
    """Write a JSON mirror atomically and privately, and return its mtime.

    The tmp name is this process's own: a shared `.tmp` let one tab rename
    another's half-written file away and then crash on ENOENT (5 to 7 calls a run in
    the stress test). The mtime is read from the tmp file before the rename,
    so a write by someone else just after it can't be mistaken for ours."""
    path = pathlib.Path(path)
    tmp = path.with_name("%s.%d.tmp" % (path.name, os.getpid()))
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    stamp = os.stat(str(tmp)).st_mtime_ns
    os.replace(str(tmp), str(path))
    return stamp
