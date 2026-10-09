"""GTM memory: the people store's architecture, applied to clients, accounts, contacts and Clay.

Caleb, 2026-10-09: GTM memory has to be as good as the relationship store, "if
not higher". docs/GTM-MEMORY.md maps each people-store capability to the piece
here that implements it. The short version:

  identity    contacts and accounts hold KEYS ONLY (email, LinkedIn slug, domain).
              A name is a veto, never a merge key.
  tenancy     every fact row carries client_id NOT NULL; client_contacts and
              client_accounts decide what a client can see; crossing clients
              needs an explicit all_clients.
  facts       observations with source, provider, cost and confidence. A newer
              value supersedes the old row, which stays.
  history     employment rows open and close (a job change is history), sends
              and replies are interactions with source ids, scores keep a
              history with the evidence that moved them.
  obligations commitments: what we owe, what the client owes, refills.
  assets      Clay tables, columns, config versions, auto-run state, and a
              credit ledger per sync.

STORE. SQLite at ~/.chewbacca/gtm/memory.db (GTM_MEMORY_DB), WAL, migrations on
every open. Sources are read only: the OS graph that `chewbacca gtm sync`
writes, and `chewbacca clay` reads. Nothing here sends, enriches or edits Clay.
People.db is joined read only for the warm path and nothing from it is stored.
"""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = 1

# Freemail domains never become an account: two investors on gmail.com are not
# colleagues. List is the common consumer providers, guessed, never measured
# against the client lists.
FREEMAIL = frozenset({
    "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
    "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
    "gmx.com", "yandex.com", "mail.com", "comcast.net", "att.net", "verizon.net", "qq.com",
    "163.com", "hey.com", "fastmail.com",
})

INTERACTION_KINDS = ("send", "reply", "forward", "bounce", "unsubscribe", "meeting",
                     "booking_signal", "slack_mention", "client_verdict")
SOURCE_KINDS = ("graph", "clay_column", "clay_record", "form_d", "website", "reply_text",
                "client_verdict", "config", "manual", "model")
SUBJECT_TYPES = ("contact", "account", "campaign", "clay_table", "clay_column")

# Playbook floors, skills/gtm-engineering/references/demand-gen-playbooks.md:
# "Under 500 sends per arm can't separate signal from noise", read results
# "after the whole sequence ends, around day 21", adopt at 20%+ lift, replicate
# at 10-20%, under 10% inconclusive.
MIN_SENDS_PER_ARM = 500
READ_AFTER_DAYS = 21
ADOPT_LIFT = 0.20
REPLICATE_LIFT = 0.10

# Jonah, Slack DM 2026-10-07: "Please send me every single reply and I will
# tell you if they are a good fit". So an unjudged reply is an approval HE
# owes. 24 hours because the reply-handling pack estimates a positive left 24
# hours loses about half its booking chance; 30 minutes for our answer after
# his verdict is the same pack's "answer positive replies within 30 minutes".
APPROVAL_SLA = timedelta(hours=24)
REPLY_SLA = timedelta(minutes=30)
OWED_CLASSES = frozenset({"positive", "neutral"})

# Opening guesses, every one a row in scoring_params so tuning is an UPDATE.
# None of these has been measured against booked meetings yet.
SEED_PARAMS = [
    ("intent_half_life_days", 30, "how fast a buying signal goes stale (guessed)"),
    ("engagement_half_life_days", 45, "how fast a reply stops counting (guessed)"),
    ("temperature_half_life_days", 21, "two-way recency half-life; sends never warm (guessed)"),
    ("saturation_k", 0.8, "score = 1 - exp(-k * sum of weights)"),
    ("w_positive", 1.0, "positive reply"),
    ("w_neutral", 0.5, "neutral reply: question, referral, new address"),
    ("w_meeting", 1.5, "meeting on the calendar"),
    ("w_forward", 0.3, "a reply that was forwarded"),
    ("w_booking_signal", 0.8, "a booking link click or similar"),
    ("w_signal", 1.0, "an intent signal observation (Form D, hiring)"),
    ("fit_grade_a", 0.9, "list grade A"),
    ("fit_grade_b", 0.7, "list grade B"),
    ("fit_grade_c", 0.4, "list grade C"),
    ("fit_senior_title", 0.6, "partner, principal, founder, director titles"),
    ("fit_other_title", 0.3, "any other known title"),
]
SENIOR = re.compile(r"\b(partner|principal|founder|co-?founder|managing|director|ceo|cio|gp|head)\b", re.I)
# The same set gtm_ingest.CONTROL strips: terminal escapes, bidi overrides,
# zero-width characters. Reply subjects are written by strangers.
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]")


class MemoryError_(RuntimeError):
    pass


class ScopeError(MemoryError_):
    pass


class NoMemory(MemoryError_):
    pass


# ── paths and time ───────────────────────────────────────────────────────────


def db_path() -> Path:
    return Path(os.environ.get("GTM_MEMORY_DB") or Path.home() / ".chewbacca" / "gtm" / "memory.db")


def graph_path() -> Path:
    return Path(os.environ.get("KYBER_OS_GRAPH") or Path.home() / ".chewbacca" / "os-graph.sqlite")


def people_db_path() -> Path:
    if os.environ.get("PEOPLE_DB"):
        return Path(os.environ["PEOPLE_DB"])
    return Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people") / "people.db"


def now() -> datetime:
    """GTM_MEMORY_NOW pins the clock, so decay math is testable."""
    pinned = os.environ.get("GTM_MEMORY_NOW")
    return parse_time(pinned) if pinned else datetime.now(timezone.utc)


def parse_time(value) -> datetime | None:
    if not value:
        return None
    s = str(value).strip()
    try:
        if len(s) == 10:
            return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def norm_time(value) -> str | None:
    return iso(parse_time(value))


def days_between(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 86400.0


def clip(text, limit: int) -> str:
    return CONTROL.sub("", str(text or "")).strip()[:limit]


def digest(text: str, n: int = 16) -> str:
    import hashlib

    return hashlib.sha256(text.encode()).hexdigest()[:n]


def new_id(prefix: str) -> str:
    return f"{prefix}_{os.urandom(8).hex()}"


# ── keys ─────────────────────────────────────────────────────────────────────


def email_key(value) -> str:
    """Same semantics as osgraph.email_key: trimmed, lowercased, ASCII, one @."""
    v = str(value or "").strip().lower()
    if v.startswith("mailto:"):
        v = v[7:]
    if not v.isascii() or v.count("@") != 1 or not v.isprintable() or " " in v:
        return ""
    local, _, dom = v.partition("@")
    return v if local and "." in dom else ""


def linkedin_key(value) -> str:
    v = str(value or "").strip()
    m = re.search(r"linkedin\.com/(?:in|pub)/([^/?#\s]+)", v, re.I)
    slug = m.group(1) if m else (v if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_%.-]{1,99}", v) else "")
    from urllib.parse import unquote
    slug = unquote(slug).strip().lower().rstrip("/")
    return slug if slug.isprintable() else ""


def domain_key(value) -> str:
    v = str(value or "").strip().lower()
    if "@" in v:
        v = v.rsplit("@", 1)[1]
    v = re.sub(r"^https?://", "", v).split("/")[0].removeprefix("www.")
    if not v.isascii() or not re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+", v):
        return ""
    return v


def account_domain(email: str) -> str:
    d = domain_key(email)
    return "" if not d or d in FREEMAIL else d


SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "phd", "md", "cfa", "cpa", "mba", "esq"}


def surname(name) -> str:
    import unicodedata

    text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    words = [w for w in re.findall(r"[a-z]+", text) if w not in SUFFIXES]
    return words[-1] if len(words) >= 2 else ""


def surnames_conflict(a, b) -> bool:
    """True only when both names carry a surname and they differ. Missing
    evidence never vetoes; a different surname always does (people/resolve.js:
    an embedded surname is a constraint, not a hint)."""
    sa, sb = surname(a), surname(b)
    return bool(sa and sb and sa != sb)


# ── schema ───────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, sources TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0, report TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, principal TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

-- IDENTITY HOLDS KEYS AND NOTHING ELSE. A name, a title, a reply all live in
-- client-scoped rows, so one investor emailed for two clients is one contact
-- with two histories and neither client can read the other's.
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS contact_keys (
  kind TEXT NOT NULL CHECK (kind IN ('email','linkedin')),
  value TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  joined_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);
CREATE INDEX IF NOT EXISTS ck_contact_idx ON contact_keys (contact_id);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS account_keys (
  kind TEXT NOT NULL CHECK (kind IN ('domain')),
  value TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);
CREATE INDEX IF NOT EXISTS ak_account_idx ON account_keys (account_id);
CREATE TABLE IF NOT EXISTS identity_conflicts (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  kind TEXT NOT NULL, value TEXT NOT NULL, claimed_by TEXT, holder TEXT,
  evidence TEXT NOT NULL, observed_at TEXT NOT NULL, resolved_at TEXT,
  UNIQUE (client_id, kind, value, claimed_by, holder)
);

CREATE TABLE IF NOT EXISTS client_contacts (
  client_id TEXT NOT NULL REFERENCES clients (id),
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, origin TEXT,
  PRIMARY KEY (client_id, contact_id)
);
CREATE INDEX IF NOT EXISTS cc_contact_idx ON client_contacts (contact_id);
CREATE TABLE IF NOT EXISTS client_accounts (
  client_id TEXT NOT NULL REFERENCES clients (id),
  account_id TEXT NOT NULL REFERENCES accounts (id),
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, origin TEXT,
  PRIMARY KEY (client_id, account_id)
);

-- A JOB CHANGE IS HISTORY, NOT AN EDIT. A new account closes the open row.
CREATE TABLE IF NOT EXISTS employment (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  account_id TEXT NOT NULL REFERENCES accounts (id),
  title TEXT, started_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT,
  source_kind TEXT NOT NULL, source_ref TEXT, origin TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS emp_contact_idx ON employment (client_id, contact_id, started_at);
CREATE INDEX IF NOT EXISTS emp_account_idx ON employment (client_id, account_id);

-- EVERY ENRICHED OR INFERRED FACT. A newer value supersedes, never erases.
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('contact','account','campaign','clay_table','clay_column')),
  subject_id TEXT NOT NULL, attribute TEXT NOT NULL, value TEXT NOT NULL,
  source_kind TEXT NOT NULL, source_ref TEXT, provider TEXT,
  observed_at TEXT NOT NULL, last_confirmed_at TEXT,
  cost_credits REAL, confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  superseded_by TEXT, superseded_at TEXT, origin TEXT,
  created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS obs_subject_idx ON observations (client_id, subject_type, subject_id, attribute)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  contact_id TEXT REFERENCES contacts (id), account_id TEXT REFERENCES accounts (id),
  kind TEXT NOT NULL CHECK (kind IN ('send','reply','forward','bounce','unsubscribe','meeting',
                                     'booking_signal','slack_mention','client_verdict')),
  happened_at TEXT NOT NULL, campaign_id TEXT, step INTEGER, variant TEXT,
  reply_class TEXT, classified_by TEXT, detail TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL, source_id TEXT NOT NULL, origin TEXT, deleted_at TEXT,
  UNIQUE (client_id, source, source_id)
);
CREATE INDEX IF NOT EXISTS int_contact_idx ON interactions (client_id, contact_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS int_time_idx ON interactions (client_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS int_campaign_idx ON interactions (campaign_id, kind);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  workspace_id TEXT, name TEXT NOT NULL, offer TEXT, status TEXT, audience_id TEXT,
  created_at TEXT, updated_at TEXT, analytics TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL, origin TEXT, deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  name TEXT NOT NULL, offer TEXT, wave TEXT,
  hypothesis TEXT, lever TEXT, list_ref TEXT, copy_ref TEXT,
  verdict TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS experiment_arms (
  experiment_id TEXT NOT NULL REFERENCES experiments (id),
  campaign_id TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES clients (id),
  arm TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, bounces INTEGER NOT NULL DEFAULT 0,
  ooo INTEGER NOT NULL DEFAULT 0, replies INTEGER NOT NULL DEFAULT 0,
  positives INTEGER NOT NULL DEFAULT 0, meetings INTEGER NOT NULL DEFAULT 0,
  first_sent_at TEXT, observed_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS scoring_params (
  key TEXT PRIMARY KEY, value REAL NOT NULL, note TEXT, updated_at TEXT NOT NULL
);
-- DERIVED. Truncating is always safe; an ingest rebuilds it.
CREATE TABLE IF NOT EXISTS scores (
  client_id TEXT NOT NULL REFERENCES clients (id),
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  fit REAL NOT NULL, intent REAL NOT NULL, engagement REAL NOT NULL, temperature REAL NOT NULL,
  drivers TEXT NOT NULL DEFAULT '[]', computed_at TEXT NOT NULL,
  PRIMARY KEY (client_id, subject_type, subject_id)
);
CREATE TABLE IF NOT EXISTS score_history (
  client_id TEXT NOT NULL REFERENCES clients (id),
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, as_of TEXT NOT NULL,
  fit REAL NOT NULL, intent REAL NOT NULL, engagement REAL NOT NULL, temperature REAL NOT NULL,
  drivers TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'snapshot' CHECK (kind IN ('computed','snapshot')),
  PRIMARY KEY (client_id, subject_type, subject_id, as_of, kind)
);

CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  kind TEXT NOT NULL CHECK (kind IN ('reply_owed','approval_owed','follow_up','refill','deliverable')),
  owed_by TEXT NOT NULL CHECK (owed_by IN ('us','client','contact')),
  contact_id TEXT, campaign_id TEXT, title TEXT NOT NULL,
  due_at TEXT, done_at TEXT, done_reason TEXT,
  source TEXT, source_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('derived','manual')),
  created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS commit_derived_idx ON commitments (client_id, kind, source_id)
  WHERE origin = 'derived';

CREATE TABLE IF NOT EXISTS clay_workspaces (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  name TEXT, observed_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS clay_tables (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  workspace_id TEXT, workbook_id TEXT, workbook TEXT, name TEXT, entity_type TEXT,
  auto_run INTEGER, auto_run_mode TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS clay_columns (
  table_id TEXT NOT NULL, id TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES clients (id),
  name TEXT, type TEXT, action_key TEXT, provider TEXT, conditional_run INTEGER,
  config_hash TEXT, clay_updated_at TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (table_id, id)
);
CREATE TABLE IF NOT EXISTS clay_column_versions (
  table_id TEXT NOT NULL, column_id TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES clients (id),
  config_hash TEXT NOT NULL, config TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY (table_id, column_id, config_hash)
);
-- WHAT CLAY SAYS WAS SPENT, PER SYNC. Clay reports credits per table, not
-- per column, so a column row exists only when it was measured.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients (id),
  workspace_id TEXT, table_id TEXT, column_id TEXT,
  credits REAL NOT NULL, action_executions REAL, rows INTEGER, window_days INTEGER,
  as_of TEXT NOT NULL,
  attribution TEXT NOT NULL CHECK (attribution IN ('table','workbook','unattributed','column_measured')),
  source TEXT NOT NULL, note TEXT, origin TEXT,
  UNIQUE (client_id, workspace_id, table_id, column_id, attribution, window_days, as_of)
);
CREATE INDEX IF NOT EXISTS ledger_table_idx ON credit_ledger (client_id, table_id, as_of);

CREATE TABLE IF NOT EXISTS summaries (
  client_id TEXT NOT NULL REFERENCES clients (id),
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  body TEXT NOT NULL, sources TEXT NOT NULL, input_hash TEXT NOT NULL, generated_at TEXT NOT NULL,
  PRIMARY KEY (client_id, subject_type, subject_id)
);
"""

# Ordered migrations: (version, sql). Run once each on open, recorded in meta.
MIGRATIONS: list[tuple[int, str]] = []


def open_db(path: Path | str | None = None, readonly: bool = False) -> sqlite3.Connection:
    path = Path(path or db_path())
    if readonly:
        if not path.exists():
            raise NoMemory(f"no GTM memory at {path}: run `chewbacca gtm-memory ingest` first")
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        db.row_factory = sqlite3.Row
        return db
    path.parent.mkdir(parents=True, exist_ok=True)
    # Autocommit, so ingest owns its one explicit transaction (BEGIN IMMEDIATE
    # ... COMMIT) and a dry run can roll every write back.
    db = sqlite3.connect(str(path), timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA busy_timeout = 15000")
    db.execute("PRAGMA synchronous = NORMAL")
    db.executescript(SCHEMA)
    migrate(db)
    seed(db)
    return db


def migrate(db) -> None:
    row = db.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    have = int(row["value"]) if row else 0
    for version, sql in MIGRATIONS:
        if version > have:
            db.executescript(sql)
            have = version
    with db:
        db.execute("INSERT INTO meta (key, value) VALUES ('schema_version', ?) "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (str(max(have, SCHEMA_VERSION)),))


def seed(db) -> None:
    stamp = iso(now())
    with db:
        for key, value, note in SEED_PARAMS:
            db.execute("INSERT INTO scoring_params (key, value, note, updated_at) VALUES (?, ?, ?, ?) "
                       "ON CONFLICT(key) DO NOTHING", (key, value, note, stamp))


def params(db) -> dict:
    return {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM scoring_params")}


# ── scope ────────────────────────────────────────────────────────────────────


class Scope:
    """The clients a query may read. Built only by resolve_scope."""

    def __init__(self, clients: list[dict], crossed: bool):
        self.clients = clients
        self.ids = [c["id"] for c in clients]
        self.crossed = crossed

    def sql(self, column: str = "client_id") -> tuple[str, list]:
        return f"{column} IN ({','.join('?' * len(self.ids))})", list(self.ids)

    def name(self, client_id: str) -> str:
        return next((c["name"] for c in self.clients if c["id"] == client_id), client_id)


def live_clients(db) -> list[dict]:
    return [dict(r) for r in db.execute(
        "SELECT id, name, principal FROM clients WHERE deleted_at IS NULL ORDER BY name")]


def resolve_scope(db, client: str | None = None, all_clients: bool = False) -> Scope:
    clients = live_clients(db)
    if not clients:
        raise ScopeError("no clients in GTM memory yet: run `chewbacca gtm-memory ingest`")
    if all_clients:
        return Scope(clients, crossed=True)
    if client:
        want = client.strip().lower()
        hits = [c for c in clients if want in (c["id"].lower(), c["name"].lower(),
                                                re.sub(r"[^a-z0-9]+", "-", c["name"].lower()).strip("-"))]
        if not hits:
            raise ScopeError(f"no client called {client!r}. On file: {', '.join(c['name'] for c in clients)}")
        return Scope(hits[:1], crossed=False)
    if len(clients) == 1:
        return Scope(clients, crossed=False)
    raise ScopeError(f"{len(clients)} clients on file ({', '.join(c['name'] for c in clients)}): "
                     "pass --client NAME, or --all-clients to read across them")


# ── writes: identity ─────────────────────────────────────────────────────────


def ensure_client(db, client_id: str, name: str, principal: str = "") -> None:
    stamp = iso(now())
    db.execute("INSERT INTO clients (id, name, principal, created_at, updated_at) VALUES (?, ?, ?, ?, ?) "
               "ON CONFLICT(id) DO UPDATE SET name = excluded.name, "
               "principal = COALESCE(NULLIF(excluded.principal, ''), clients.principal), "
               "updated_at = excluded.updated_at, deleted_at = NULL",
               (client_id, clip(name, 120) or client_id, principal or "", stamp, stamp))


def key_owner(db, kind: str, value: str) -> str | None:
    if not value:
        return None
    row = db.execute("SELECT contact_id FROM contact_keys WHERE kind = ? AND value = ?", (kind, value)).fetchone()
    return row["contact_id"] if row else None


def bind_key(db, contact_id: str, kind: str, value: str, joined_by: str) -> None:
    db.execute("INSERT OR IGNORE INTO contact_keys (kind, value, contact_id, joined_by, created_at) "
               "VALUES (?, ?, ?, ?, ?)", (kind, value, contact_id, joined_by, iso(now())))


def known_name(db, contact_id: str) -> str:
    """The newest name observed for a contact in ANY client. Used only inside
    identity resolution, as a veto. It is never returned to a caller."""
    row = db.execute("SELECT value FROM observations WHERE subject_type = 'contact' AND subject_id = ? "
                     "AND attribute = 'name' AND superseded_by IS NULL AND deleted_at IS NULL "
                     "ORDER BY observed_at DESC LIMIT 1", (contact_id,)).fetchone()
    return row["value"] if row else ""


def conflict(db, client_id, kind, value, claimed_by, holder, evidence, observed_at) -> None:
    db.execute("INSERT OR IGNORE INTO identity_conflicts (id, client_id, kind, value, claimed_by, holder, "
               "evidence, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
               (new_id("conf"), client_id, kind, value, claimed_by, holder, clip(evidence, 300), observed_at))


def resolve_contact(db, client_id: str, email: str = "", linkedin: str = "", name: str = "",
                    observed_at: str | None = None) -> tuple[str | None, str]:
    """The one contact an email and LinkedIn slug belong to, creating it when
    neither key is known. Returns (contact_id, how).

    Email is the primary key. A slug joins a NEW email to an existing contact
    (that is what a job change looks like) only when the surnames agree,
    because the Prometheus file carried 43,543 rows whose slug was somebody
    else's. A slug already held by a different contact than the email's is a
    conflict, logged, never merged. A name alone never creates or joins."""
    ek, lk = email_key(email), linkedin_key(linkedin)
    if not ek and not lk:
        return None, "no key"
    at = observed_at or iso(now())
    ce, cl = key_owner(db, "email", ek), key_owner(db, "linkedin", lk)
    if ce and cl and ce != cl:
        conflict(db, client_id, "linkedin", lk, ce, cl,
                 f"{ek} belongs to one contact and slug {lk} to another", at)
        return ce, "email (slug conflict logged)"
    if ce:
        if lk and not cl:
            if surnames_conflict(name, known_name(db, ce)):
                conflict(db, client_id, "linkedin", lk, ce, None,
                         f"slug {lk} arrived with {ek} under a different surname", at)
            else:
                bind_key(db, ce, "linkedin", lk, "same record as email")
        return ce, "email"
    if cl:
        if ek:
            if surnames_conflict(name, known_name(db, cl)):
                conflict(db, client_id, "linkedin", lk, None, cl,
                         f"{ek} arrived with slug {lk} under a different surname", at)
                cid = new_id("ct")
                db.execute("INSERT INTO contacts (id, created_at) VALUES (?, ?)", (cid, at))
                bind_key(db, cid, "email", ek, "new email, slug refused by surname")
                return cid, "new (slug refused)"
            bind_key(db, cl, "email", ek, "linkedin slug, surname agrees")
            return cl, "linkedin"
        return cl, "linkedin"
    cid = new_id("ct")
    db.execute("INSERT INTO contacts (id, created_at) VALUES (?, ?)", (cid, at))
    if ek:
        bind_key(db, cid, "email", ek, "first seen")
    if lk:
        bind_key(db, cid, "linkedin", lk, "first seen")
    return cid, "new"


def resolve_account(db, domain: str) -> str | None:
    d = domain_key(domain)
    if not d or d in FREEMAIL:
        return None
    row = db.execute("SELECT account_id FROM account_keys WHERE kind = 'domain' AND value = ?", (d,)).fetchone()
    if row:
        return row["account_id"]
    aid = new_id("acct")
    stamp = iso(now())
    db.execute("INSERT INTO accounts (id, created_at) VALUES (?, ?)", (aid, stamp))
    db.execute("INSERT INTO account_keys (kind, value, account_id, created_at) VALUES ('domain', ?, ?, ?)",
               (d, aid, stamp))
    return aid


def admit(db, client_id: str, contact_id: str | None = None, account_id: str | None = None,
          at: str | None = None, origin: str | None = None) -> None:
    at = at or iso(now())
    if contact_id:
        db.execute("INSERT INTO client_contacts (client_id, contact_id, first_seen, last_seen, origin) "
                   "VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_id, contact_id) DO UPDATE SET "
                   "first_seen = MIN(client_contacts.first_seen, excluded.first_seen), "
                   "last_seen = MAX(client_contacts.last_seen, excluded.last_seen)",
                   (client_id, contact_id, at, at, origin))
    if account_id:
        db.execute("INSERT INTO client_accounts (client_id, account_id, first_seen, last_seen, origin) "
                   "VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_id, account_id) DO UPDATE SET "
                   "first_seen = MIN(client_accounts.first_seen, excluded.first_seen), "
                   "last_seen = MAX(client_accounts.last_seen, excluded.last_seen)",
                   (client_id, account_id, at, at, origin))


# ── writes: facts ────────────────────────────────────────────────────────────


def observe(db, client_id: str, subject_type: str, subject_id: str, attribute: str, value,
            source_kind: str, source_ref: str = "", observed_at: str | None = None,
            provider: str | None = None, cost_credits: float | None = None,
            confidence: float = 1.0, origin: str | None = None) -> str | None:
    """Record a fact. The same value again confirms the current row; a new
    value supersedes it; an OLDER value arriving late is stored already
    superseded, so out-of-order ingests cannot roll a fact back."""
    if value is None or str(value).strip() == "":
        return None
    if subject_type not in SUBJECT_TYPES:
        raise ValueError(f"unknown subject type {subject_type}")
    value = clip(value, 2000)
    at = norm_time(observed_at) or iso(now())
    cur = db.execute("SELECT id, value, observed_at FROM observations WHERE client_id = ? AND subject_type = ? "
                     "AND subject_id = ? AND attribute = ? AND superseded_by IS NULL AND deleted_at IS NULL "
                     "ORDER BY observed_at DESC LIMIT 1",
                     (client_id, subject_type, subject_id, attribute)).fetchone()
    if cur and cur["value"] == value:
        db.execute("UPDATE observations SET last_confirmed_at = MAX(COALESCE(last_confirmed_at, ''), ?) "
                   "WHERE id = ?", (at, cur["id"]))
        return cur["id"]
    same = db.execute("SELECT id FROM observations WHERE client_id = ? AND subject_type = ? AND subject_id = ? "
                      "AND attribute = ? AND value = ? AND observed_at = ? AND deleted_at IS NULL",
                      (client_id, subject_type, subject_id, attribute, value, at)).fetchone()
    if same:
        return same["id"]
    oid = new_id("obs")
    late = bool(cur and cur["observed_at"] > at)
    db.execute("INSERT INTO observations (id, client_id, subject_type, subject_id, attribute, value, source_kind, "
               "source_ref, provider, observed_at, last_confirmed_at, cost_credits, confidence, superseded_by, "
               "superseded_at, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (oid, client_id, subject_type, subject_id, attribute, value, source_kind, source_ref or None,
                provider, at, at, cost_credits, max(0.0, min(1.0, confidence)),
                cur["id"] if late else None, cur["observed_at"] if late else None, origin, iso(now())))
    if cur and not late:
        db.execute("UPDATE observations SET superseded_by = ?, superseded_at = ? WHERE id = ?", (oid, at, cur["id"]))
    return oid


def record_employment(db, client_id: str, contact_id: str, account_id: str, title: str,
                      observed_at: str, source_kind: str, source_ref: str = "", origin: str | None = None) -> str:
    at = norm_time(observed_at) or iso(now())
    rows = [dict(r) for r in db.execute(
        "SELECT * FROM employment WHERE client_id = ? AND contact_id = ? AND deleted_at IS NULL "
        "ORDER BY started_at", (client_id, contact_id))]
    open_rows = [r for r in rows if not r["ended_at"]]
    cur = open_rows[-1] if open_rows else None
    if cur and cur["account_id"] == account_id:
        if at < cur["started_at"]:
            db.execute("UPDATE employment SET started_at = ? WHERE id = ?", (at, cur["id"]))
        return cur["id"]
    if any(r["account_id"] == account_id for r in rows):
        # Seen at this account before; an old record arriving late is not a
        # move back. Keep history as it is.
        if cur and at < cur["started_at"]:
            return next(r["id"] for r in rows if r["account_id"] == account_id)
    eid = new_id("emp")
    if cur and at < cur["started_at"]:
        db.execute("INSERT INTO employment (id, client_id, contact_id, account_id, title, started_at, ended_at, "
                   "end_reason, source_kind, source_ref, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   (eid, client_id, contact_id, account_id, clip(title, 200) or None, at, cur["started_at"],
                    "seen elsewhere later", source_kind, source_ref, origin))
        return eid
    if cur:
        dom = db.execute("SELECT value FROM account_keys WHERE account_id = ?", (account_id,)).fetchone()
        db.execute("UPDATE employment SET ended_at = ?, end_reason = ? WHERE id = ?",
                   (at, f"seen at {dom['value'] if dom else account_id}", cur["id"]))
    db.execute("INSERT INTO employment (id, client_id, contact_id, account_id, title, started_at, source_kind, "
               "source_ref, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (eid, client_id, contact_id, account_id, clip(title, 200) or None, at, source_kind, source_ref,
                origin))
    return eid


def interact(db, client_id: str, kind: str, happened_at, source: str, source_id: str,
             contact_id: str | None = None, account_id: str | None = None, campaign_id: str | None = None,
             step: int | None = None, variant: str | None = None, reply_class: str | None = None,
             classified_by: str | None = None, detail: dict | None = None, origin: str | None = None) -> None:
    if kind not in INTERACTION_KINDS:
        raise ValueError(f"unknown interaction kind {kind}")
    at = norm_time(happened_at)
    if not at:
        return
    db.execute(
        "INSERT INTO interactions (id, client_id, contact_id, account_id, kind, happened_at, campaign_id, step, "
        "variant, reply_class, classified_by, detail, source, source_id, origin) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(client_id, source, source_id) DO UPDATE SET reply_class = excluded.reply_class, "
        "classified_by = excluded.classified_by, detail = excluded.detail, step = excluded.step, "
        "variant = excluded.variant, contact_id = excluded.contact_id, account_id = excluded.account_id, "
        "deleted_at = NULL",
        (new_id("int"), client_id, contact_id, account_id, kind, at, campaign_id, step, variant, reply_class,
         classified_by, json.dumps(detail or {}, sort_keys=True), source, source_id, origin))


# ── scoring ──────────────────────────────────────────────────────────────────


def saturate(total: float, k: float) -> float:
    return 1.0 - math.exp(-k * max(0.0, total))


def decay(age_days: float, half_life: float) -> float:
    return 2.0 ** (-max(0.0, age_days) / half_life)


def score_evidence(interactions: list[dict], facts: list[dict], P: dict, as_of: datetime) -> dict:
    """fit, intent, engagement and temperature from evidence observed by as_of.

    The rule from people/history.js: at a past date you only see what had
    happened by then, else a future reply has a negative age and decay
    amplifies it. Sends never warm anyone: a blast is not a conversation."""
    k = P["saturation_k"]
    drivers = []
    eng = intent = 0.0
    last_two_way = None
    unsubscribed = False
    verdict = None
    for it in interactions:
        at = parse_time(it["happened_at"])
        if at is None or at > as_of:
            continue
        age = days_between(at, as_of)
        kind, cls = it["kind"], it.get("reply_class")
        w = 0.0
        if kind == "reply":
            if cls == "unsubscribe":
                unsubscribed = True
            if cls in ("positive", "neutral"):
                w = P[f"w_{cls}"]
            if cls not in ("ooo", "bounce", None):
                last_two_way = max(last_two_way or at, at)
        elif kind == "unsubscribe":
            unsubscribed = True
        elif kind == "meeting":
            w = P["w_meeting"]
            last_two_way = max(last_two_way or at, at)
        elif kind == "forward":
            w = P["w_forward"]
        elif kind == "booking_signal":
            w = P["w_booking_signal"]
        elif kind == "client_verdict":
            verdict = (at, json.loads(it.get("detail") or "{}").get("verdict"))
        if w:
            wd = w * decay(age, P["engagement_half_life_days"])
            eng += wd
            drivers.append({"kind": kind, "class": cls, "at": it["happened_at"], "weight": round(wd, 3),
                            "dimension": "engagement", "id": it["id"], "source": it["source"]})
    fit, fit_why = 0.0, None
    for f in facts:
        at = parse_time(f["observed_at"])
        if at is None or at > as_of:
            continue
        if f["attribute"].startswith("signal:"):
            wd = P["w_signal"] * decay(days_between(at, as_of), P["intent_half_life_days"])
            intent += wd
            drivers.append({"kind": "signal", "class": f["attribute"][7:], "at": f["observed_at"],
                            "weight": round(wd, 3), "dimension": "intent", "id": f["id"],
                            "source": f["source_kind"]})
        elif f["attribute"] == "grade" and f["value"].strip().upper() in ("A", "B", "C"):
            g = P[f"fit_grade_{f['value'].strip().lower()}"]
            if g >= fit:
                fit, fit_why = g, f
        elif f["attribute"] == "title" and fit < P["fit_senior_title"]:
            g = P["fit_senior_title"] if SENIOR.search(f["value"]) else P["fit_other_title"]
            if g > fit:
                fit, fit_why = g, f
    if verdict and verdict[1] in ("good_fit", "not_fit"):
        fit = 1.0 if verdict[1] == "good_fit" else 0.0
        fit_why = {"id": "verdict", "attribute": "client_verdict", "value": verdict[1],
                   "observed_at": iso(verdict[0]), "source_kind": "client_verdict"}
    if fit_why:
        drivers.append({"kind": "fit", "class": f"{fit_why['attribute']}={fit_why['value']}",
                        "at": fit_why["observed_at"], "weight": round(fit, 3), "dimension": "fit",
                        "id": fit_why["id"], "source": fit_why["source_kind"]})
    temperature = decay(days_between(last_two_way, as_of), P["temperature_half_life_days"]) if last_two_way else 0.0
    engagement = 0.0 if unsubscribed else saturate(eng, k)
    drivers.sort(key=lambda d: -d["weight"])
    return {"fit": round(fit, 4), "intent": round(saturate(intent, k), 4), "engagement": round(engagement, 4),
            "temperature": round(temperature, 4), "drivers": drivers[:8]}


def combine(parts: list[dict]) -> dict:
    """An account from its contacts: fit and temperature are the best contact,
    intent and engagement accumulate (1 - product of misses)."""
    if not parts:
        return {"fit": 0.0, "intent": 0.0, "engagement": 0.0, "temperature": 0.0, "drivers": []}
    miss_i = miss_e = 1.0
    drivers = []
    for p in parts:
        miss_i *= 1 - p["intent"]
        miss_e *= 1 - p["engagement"]
        drivers.extend(p["drivers"])
    drivers.sort(key=lambda d: -d["weight"])
    return {"fit": max(p["fit"] for p in parts), "intent": round(1 - miss_i, 4),
            "engagement": round(1 - miss_e, 4), "temperature": max(p["temperature"] for p in parts),
            "drivers": drivers[:8]}


def evidence_for(db, client_id: str, contact_ids: list[str]) -> tuple[dict, dict]:
    ints: dict[str, list] = {c: [] for c in contact_ids}
    facts: dict[str, list] = {c: [] for c in contact_ids}
    if not contact_ids:
        return ints, facts
    for chunk in (contact_ids[i:i + 500] for i in range(0, len(contact_ids), 500)):
        marks = ",".join("?" * len(chunk))
        for r in db.execute(f"SELECT id, contact_id, kind, happened_at, reply_class, detail, source FROM interactions "
                            f"WHERE client_id = ? AND deleted_at IS NULL AND contact_id IN ({marks})",
                            (client_id, *chunk)):
            ints[r["contact_id"]].append(dict(r))
        for r in db.execute(f"SELECT id, subject_id, attribute, value, observed_at, source_kind FROM observations "
                            f"WHERE client_id = ? AND subject_type = 'contact' AND deleted_at IS NULL "
                            f"AND subject_id IN ({marks}) AND (attribute IN ('title','grade') OR attribute LIKE 'signal:%')",
                            (client_id, *chunk)):
            facts[r["subject_id"]].append(dict(r))
    return ints, facts


def recompute_scores(db, client_id: str, as_of: datetime | None = None) -> int:
    as_of = as_of or now()
    P = params(db)
    stamp = iso(as_of)
    contacts = [r["contact_id"] for r in db.execute(
        "SELECT contact_id FROM client_contacts WHERE client_id = ?", (client_id,))]
    ints, facts = evidence_for(db, client_id, contacts)
    per_contact = {}
    for c in contacts:
        s = score_evidence(ints[c], facts[c], P, as_of)
        per_contact[c] = s
        write_score(db, client_id, "contact", c, s, stamp)
    by_account: dict[str, list] = {}
    for r in db.execute("SELECT DISTINCT contact_id, account_id FROM employment WHERE client_id = ? "
                        "AND deleted_at IS NULL AND ended_at IS NULL", (client_id,)):
        if r["contact_id"] in per_contact:
            by_account.setdefault(r["account_id"], []).append(per_contact[r["contact_id"]])
    for aid, parts in by_account.items():
        write_score(db, client_id, "account", aid, combine(parts), stamp)
    return len(contacts) + len(by_account)


def write_score(db, client_id, stype, sid, s, stamp) -> None:
    vals = (s["fit"], s["intent"], s["engagement"], s["temperature"], json.dumps(s["drivers"]))
    db.execute("INSERT INTO scores (client_id, subject_type, subject_id, fit, intent, engagement, temperature, "
               "drivers, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id, subject_type, "
               "subject_id) DO UPDATE SET fit = excluded.fit, intent = excluded.intent, "
               "engagement = excluded.engagement, temperature = excluded.temperature, drivers = excluded.drivers, "
               "computed_at = excluded.computed_at", (client_id, stype, sid, *vals, stamp))
    # One snapshot per subject per day. A snapshot freezes what was known
    # then, so the curve survives a later correction (people/schema.js V4).
    db.execute("INSERT INTO score_history (client_id, subject_type, subject_id, as_of, fit, intent, engagement, "
               "temperature, drivers, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'snapshot') "
               "ON CONFLICT(client_id, subject_type, subject_id, as_of, kind) DO UPDATE SET fit = excluded.fit, "
               "intent = excluded.intent, engagement = excluded.engagement, temperature = excluded.temperature, "
               "drivers = excluded.drivers", (client_id, stype, sid, stamp[:10], *vals))


# ── experiments ──────────────────────────────────────────────────────────────


def arm_rate(arm: dict) -> float | None:
    """Positive replies over sends, bounces and out-of-office removed (the
    playbook's north-star metric)."""
    base = arm["sent"] - arm["bounces"] - arm["ooo"]
    return arm["positives"] / base if base > 0 else None


def verdict(arms: list[dict], as_of: datetime | None = None) -> dict:
    as_of = as_of or now()
    if len(arms) < 2:
        return {"call": "single arm", "why": "one campaign in this wave, nothing to compare against"}
    short = [a for a in arms if a["sent"] < MIN_SENDS_PER_ARM]
    if short:
        return {"call": "don't know yet",
                "why": "under the playbook's 500 sends per arm: " +
                       ", ".join(f"{a['arm']} {a['sent']}/{MIN_SENDS_PER_ARM}" for a in short)}
    starts = [parse_time(a.get("first_sent_at")) for a in arms if a.get("first_sent_at")]
    if starts:
        ready = max(starts) + timedelta(days=READ_AFTER_DAYS)
        if ready > as_of:
            return {"call": "too early", "why": f"read after day {READ_AFTER_DAYS}, on {iso(ready)[:10]}"}
    rated = sorted(((arm_rate(a), a) for a in arms if arm_rate(a) is not None), key=lambda x: -x[0])
    if len(rated) < 2:
        return {"call": "don't know yet", "why": "an arm has no deliverable sends"}
    (best, a1), (second, _) = rated[0], rated[1]
    if second == 0:
        lift = math.inf if best > 0 else 0.0
    else:
        lift = (best - second) / second
    pct = "inf" if lift == math.inf else f"{lift * 100:.0f}%"
    if lift >= ADOPT_LIFT:
        return {"call": "adopt", "winner": a1["arm"], "lift": pct,
                "why": f"{a1['arm']} leads by {pct}, at or over the 20% bar"}
    if lift >= REPLICATE_LIFT:
        return {"call": "replicate", "winner": a1["arm"], "lift": pct,
                "why": f"{pct} lift is in the 10-20% band: rerun on fresh leads"}
    return {"call": "inconclusive", "lift": pct, "why": f"{pct} lift is under the 10% floor"}


def campaign_parts(name: str) -> tuple[str, str]:
    """(wave, arm) from a campaign name like
    "Zeutara | Ivy | Pre-seed investors | Midweek founder story"."""
    parts = [p.strip() for p in (name or "").split("|")]
    tail = parts[3] if len(parts) > 3 and parts[3] else ""
    if not tail:
        return "Launch", "(base)"
    return tail.split()[0], tail


def rebuild_experiments(db, client_id: str) -> int:
    stamp = iso(now())
    groups: dict[tuple, list] = {}
    for c in db.execute("SELECT * FROM campaigns WHERE client_id = ? AND deleted_at IS NULL", (client_id,)):
        wave, arm = campaign_parts(c["name"])
        groups.setdefault((c["offer"] or "(no offer)", wave), []).append((dict(c), arm))
    n = 0
    for (offer, wave), members in groups.items():
        eid = "exp_" + digest(f"{client_id}|{offer}|{wave}", 12)
        db.execute("INSERT INTO experiments (id, client_id, name, offer, wave, created_at, updated_at) "
                   "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, "
                   "deleted_at = NULL", (eid, client_id, f"{offer} | {wave}", offer, wave, stamp, stamp))
        arms = []
        for camp, arm in members:
            a = json.loads(camp["analytics"] or "{}")
            counts = {r["k"]: r["n"] for r in db.execute(
                "SELECT COALESCE(reply_class, kind) AS k, COUNT(DISTINCT contact_id) AS n FROM interactions "
                "WHERE client_id = ? AND campaign_id = ? AND kind IN ('reply','meeting') AND deleted_at IS NULL "
                "GROUP BY 1", (client_id, camp["id"]))}
            first = db.execute("SELECT MIN(happened_at) AS t FROM interactions WHERE client_id = ? AND "
                               "campaign_id = ? AND kind = 'send'", (client_id, camp["id"])).fetchone()["t"]
            row = {"arm": arm, "campaign_id": camp["id"], "sent": int(a.get("sent") or 0),
                   "bounces": int(a.get("bounces") or 0), "ooo": int(counts.get("ooo", 0)),
                   "replies": int(a.get("replies") or 0), "positives": int(counts.get("positive", 0)),
                   "meetings": int(counts.get("meeting", 0)), "first_sent_at": first}
            arms.append(row)
            db.execute("INSERT INTO experiment_arms (experiment_id, campaign_id, client_id, arm, sent, bounces, ooo, "
                       "replies, positives, meetings, first_sent_at, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "
                       "?, ?, ?) ON CONFLICT(experiment_id, campaign_id) DO UPDATE SET arm = excluded.arm, "
                       "sent = excluded.sent, bounces = excluded.bounces, ooo = excluded.ooo, "
                       "replies = excluded.replies, positives = excluded.positives, meetings = excluded.meetings, "
                       "first_sent_at = excluded.first_sent_at, observed_at = excluded.observed_at",
                       (eid, camp["id"], client_id, arm, row["sent"], row["bounces"], row["ooo"], row["replies"],
                        row["positives"], row["meetings"], first, stamp))
        aud = sorted({c["audience_id"] for c, _ in members if c["audience_id"]})
        db.execute("UPDATE experiments SET verdict = ?, list_ref = COALESCE(list_ref, ?) WHERE id = ?",
                   (json.dumps(verdict(arms)), ",".join(aud) or None, eid))
        n += 1
    return n


# ── commitments ──────────────────────────────────────────────────────────────


def derive_commitments(db, client_id: str) -> dict:
    """Rebuild every derived commitment for a client. One whose condition is
    gone is closed with a reason, never deleted; manual ones are untouched."""
    stamp = iso(now())
    want: dict[tuple, dict] = {}
    verdicts: dict[str, tuple] = {}
    for v in db.execute("SELECT contact_id, happened_at, detail FROM interactions WHERE client_id = ? "
                        "AND kind = 'client_verdict' AND deleted_at IS NULL ORDER BY happened_at", (client_id,)):
        verdicts[v["contact_id"]] = (v["happened_at"], json.loads(v["detail"] or "{}").get("verdict"))
    latest: dict[str, dict] = {}
    for r in db.execute("SELECT * FROM interactions WHERE client_id = ? AND kind = 'reply' AND deleted_at IS NULL "
                        "ORDER BY happened_at", (client_id,)):
        latest[r["contact_id"]] = dict(r)
    for cid, r in latest.items():
        detail = json.loads(r["detail"] or "{}")
        if r["reply_class"] not in OWED_CLASSES or detail.get("answered"):
            continue
        who = contact_label(db, client_id, cid)
        v = verdicts.get(cid)
        if v and v[0] >= r["happened_at"]:
            if v[1] == "good_fit":
                due = iso(parse_time(v[0]) + REPLY_SLA)
                want[("reply_owed", r["id"])] = {"owed_by": "us", "contact_id": cid, "campaign_id": r["campaign_id"],
                                                 "title": f"Answer {who} (client said good fit)", "due_at": due}
            continue
        due = iso(parse_time(r["happened_at"]) + APPROVAL_SLA)
        want[("approval_owed", r["id"])] = {"owed_by": "client", "contact_id": cid, "campaign_id": r["campaign_id"],
                                            "title": f"Verdict on {who}'s {r['reply_class']} reply", "due_at": due}
    for c in db.execute("SELECT * FROM campaigns WHERE client_id = ? AND deleted_at IS NULL AND status = 'active'",
                        (client_id,)):
        a = json.loads(c["analytics"] or "{}")
        leads, sent = int(a.get("leads") or 0), int(a.get("sent") or 0)
        if leads and sent >= leads:
            last = db.execute("SELECT MAX(happened_at) AS t FROM interactions WHERE client_id = ? AND campaign_id = ? "
                              "AND kind = 'send' AND step = 1", (client_id, c["id"])).fetchone()["t"]
            due = iso(parse_time(last) + timedelta(days=1)) if last else stamp
            want[("refill", c["id"])] = {"owed_by": "us", "contact_id": None, "campaign_id": c["id"],
                                         "title": f"Refill {c['name']}: all {leads} leads have had step 1",
                                         "due_at": due}
    have = {(r["kind"], r["source_id"]): dict(r) for r in db.execute(
        "SELECT * FROM commitments WHERE client_id = ? AND origin = 'derived' AND deleted_at IS NULL", (client_id,))}
    opened = closed = 0
    for key, w in want.items():
        if key in have:
            db.execute("UPDATE commitments SET title = ?, due_at = ?, done_at = NULL, done_reason = NULL "
                       "WHERE id = ?", (w["title"], w["due_at"], have[key]["id"]))
        else:
            db.execute("INSERT INTO commitments (id, client_id, kind, owed_by, contact_id, campaign_id, title, due_at, "
                       "source, source_id, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'derived', ?)",
                       (new_id("cmt"), client_id, key[0], w["owed_by"], w["contact_id"], w["campaign_id"],
                        w["title"], w["due_at"], "derived:" + key[0], key[1], stamp))
            opened += 1
    for key, row in have.items():
        if key not in want and not row["done_at"]:
            db.execute("UPDATE commitments SET done_at = ?, done_reason = 'condition cleared on ingest' WHERE id = ?",
                       (stamp, row["id"]))
            closed += 1
    return {"open": len(want), "opened": opened, "closed": closed}


# ── reads shared by queries and summaries ────────────────────────────────────


def current_facts(db, client_id: str, subject_type: str, subject_id: str) -> dict:
    out = {}
    for r in db.execute("SELECT * FROM observations WHERE client_id = ? AND subject_type = ? AND subject_id = ? "
                        "AND superseded_by IS NULL AND deleted_at IS NULL ORDER BY observed_at",
                        (client_id, subject_type, subject_id)):
        out[r["attribute"]] = dict(r)
    return out


def contact_label(db, client_id: str, contact_id: str) -> str:
    row = db.execute("SELECT value FROM observations WHERE client_id = ? AND subject_type = 'contact' AND "
                     "subject_id = ? AND attribute = 'name' AND superseded_by IS NULL AND deleted_at IS NULL",
                     (client_id, contact_id)).fetchone()
    if row:
        return row["value"]
    key = db.execute("SELECT value FROM contact_keys WHERE contact_id = ? ORDER BY kind LIMIT 1",
                     (contact_id,)).fetchone()
    return key["value"] if key else contact_id


def account_domains(db, account_id: str) -> list[str]:
    return [r["value"] for r in db.execute("SELECT value FROM account_keys WHERE account_id = ?", (account_id,))]


# ── summaries ────────────────────────────────────────────────────────────────


def account_summary_text(db, client_id: str, account_id: str) -> tuple[str, list[str]]:
    dom = ", ".join(account_domains(db, account_id)) or account_id
    staff = [dict(r) for r in db.execute(
        "SELECT contact_id, title, started_at, ended_at FROM employment WHERE client_id = ? AND account_id = ? "
        "AND deleted_at IS NULL ORDER BY started_at", (client_id, account_id))]
    cur = [s for s in staff if not s["ended_at"]]
    ids = [s["contact_id"] for s in staff]
    marks = ",".join("?" * len(ids)) or "''"
    counts = {r["kind"]: r["n"] for r in db.execute(
        f"SELECT kind, COUNT(*) AS n FROM interactions WHERE client_id = ? AND contact_id IN ({marks}) "
        f"AND deleted_at IS NULL GROUP BY kind", (client_id, *ids))}
    replies = [dict(r) for r in db.execute(
        f"SELECT id, contact_id, reply_class, classified_by, happened_at FROM interactions WHERE client_id = ? "
        f"AND contact_id IN ({marks}) AND kind = 'reply' AND deleted_at IS NULL ORDER BY happened_at DESC LIMIT 3",
        (client_id, *ids))]
    owed = [dict(r) for r in db.execute(
        f"SELECT id, title, due_at, owed_by FROM commitments WHERE client_id = ? AND contact_id IN ({marks}) "
        f"AND done_at IS NULL AND deleted_at IS NULL ORDER BY due_at", (client_id, *ids))]
    lines = [f"{dom}: {len(cur)} current contact(s), {len(staff) - len(cur)} past; "
             f"{counts.get('send', 0)} sends, {counts.get('reply', 0)} replies, {counts.get('meeting', 0)} meetings."]
    for r in replies:
        lines.append(f"Reply from {contact_label(db, client_id, r['contact_id'])} on {r['happened_at'][:10]}: "
                     f"{r['reply_class'] or 'unclassified'} (classified by {r['classified_by'] or 'nobody'}).")
    for o in owed:
        lines.append(f"Open: {o['title']}, owed by {o['owed_by']}, due {(o['due_at'] or '')[:16]}.")
    return "\n".join(lines), [r["id"] for r in replies] + [o["id"] for o in owed]


def client_summary_text(db, client_id: str) -> tuple[str, list[str]]:
    c = db.execute("SELECT name FROM clients WHERE id = ?", (client_id,)).fetchone()
    n = lambda q, *a: db.execute(q, (client_id, *a)).fetchone()[0]  # noqa: E731
    camps = n("SELECT COUNT(*) FROM campaigns WHERE client_id = ? AND deleted_at IS NULL")
    active = n("SELECT COUNT(*) FROM campaigns WHERE client_id = ? AND status = 'active' AND deleted_at IS NULL")
    contacts = n("SELECT COUNT(*) FROM client_contacts WHERE client_id = ?")
    sends = n("SELECT COUNT(*) FROM interactions WHERE client_id = ? AND kind = 'send' AND deleted_at IS NULL")
    by_class = {r[0]: r[1] for r in db.execute(
        "SELECT reply_class, COUNT(*) FROM interactions WHERE client_id = ? AND kind = 'reply' AND deleted_at IS NULL "
        "GROUP BY reply_class", (client_id,))}
    owed = [dict(r) for r in db.execute(
        "SELECT id, owed_by FROM commitments WHERE client_id = ? AND done_at IS NULL AND deleted_at IS NULL",
        (client_id,))]
    spend = db.execute("SELECT SUM(credits) FROM credit_ledger l WHERE client_id = ? AND attribution <> "
                       "'column_measured' AND as_of = (SELECT MAX(as_of) FROM credit_ledger WHERE client_id = ? "
                       "AND attribution <> 'column_measured')", (client_id, client_id)).fetchone()[0]
    text = (f"{c['name'] if c else client_id}: {camps} campaigns ({active} active), {contacts} contacts, "
            f"{sends} sends; replies " + ", ".join(f"{k or 'unclassified'} {v}" for k, v in sorted(
                by_class.items(), key=lambda kv: str(kv[0]))) +
            f"; {sum(1 for o in owed if o['owed_by'] == 'client')} owed by the client, "
            f"{sum(1 for o in owed if o['owed_by'] == 'us')} owed by us" +
            (f"; Clay credits in the last window: {spend:.1f}." if spend is not None else "; no Clay credit sync yet."))
    return text, [o["id"] for o in owed]


def refresh_summaries(db, client_id: str) -> int:
    """Regenerate a summary only when its inputs changed (people/distill.js
    keeps a watermark for the same reason: rerunning reads only what is new)."""
    changed = 0
    stamp = iso(now())
    subjects = [("client", client_id)] + [("account", r["account_id"]) for r in db.execute(
        "SELECT DISTINCT account_id FROM employment WHERE client_id = ? AND deleted_at IS NULL", (client_id,))]
    for stype, sid in subjects:
        body, sources = (client_summary_text(db, client_id) if stype == "client"
                         else account_summary_text(db, client_id, sid))
        h = digest(body)
        old = db.execute("SELECT input_hash FROM summaries WHERE client_id = ? AND subject_type = ? AND "
                         "subject_id = ?", (client_id, stype, sid)).fetchone()
        if old and old["input_hash"] == h:
            continue
        db.execute("INSERT INTO summaries (client_id, subject_type, subject_id, body, sources, input_hash, "
                   "generated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id, subject_type, subject_id) "
                   "DO UPDATE SET body = excluded.body, sources = excluded.sources, "
                   "input_hash = excluded.input_hash, generated_at = excluded.generated_at",
                   (client_id, stype, sid, body, json.dumps(sources), h, stamp))
        changed += 1
    return changed


# ── ingest: the OS graph ─────────────────────────────────────────────────────


def _props(row) -> dict:
    try:
        return json.loads(row["props"] or "{}")
    except (ValueError, TypeError):
        return {}


VERDICT_RANK = {"clay": 0}


def by_rank(by: str) -> int:
    """gtm_query.rank: a named person beats a model beats Clay's category."""
    b = (by or "").strip().lower()
    if b in ("", "unknown", "none"):
        return -1
    if b == "clay":
        return 0
    if b.startswith("model"):
        return 1
    return 2


def ingest_graph(db, graph: sqlite3.Connection, run_id: str) -> dict:
    g = graph
    report = {"clients": 0, "campaigns": 0, "contacts_new": 0, "sends": 0, "replies": 0, "meetings": 0,
              "skipped_no_key": 0, "conflicts_before": db.execute("SELECT COUNT(*) FROM identity_conflicts").fetchone()[0]}
    ws_client: dict[str, str] = {}
    for c in g.execute("SELECT id, label, props FROM nodes WHERE type = 'Client'"):
        p = _props(c)
        ensure_client(db, c["id"], c["label"], p.get("principal", ""))
        for w in p.get("workspaces") or []:
            ws_client[str(w)] = c["id"]
        report["clients"] += 1
    for e in g.execute("SELECT src, dst FROM edges WHERE verb = 'OWNS'"):
        ws = e["dst"].split(":")[-1]
        ws_client.setdefault(ws, e["src"])
    for w in g.execute("SELECT id, label, props, observed_at FROM nodes WHERE type = 'Workspace'"):
        wid = str(_props(w).get("workspace_id") or w["id"].split(":")[-1])
        if wid in ws_client:
            db.execute("INSERT INTO clay_workspaces (id, client_id, name, observed_at) VALUES (?, ?, ?, ?) "
                       "ON CONFLICT(id) DO UPDATE SET name = excluded.name, observed_at = excluded.observed_at",
                       (wid, ws_client[wid], clip(w["label"], 120), norm_time(w["observed_at"])))
    cam_client: dict[str, str] = {}
    for e in g.execute("SELECT src, dst FROM edges WHERE verb = 'FOR_CLIENT'"):
        cam_client[e["src"]] = e["dst"]
    targets = {e["src"]: e["dst"] for e in g.execute("SELECT src, dst FROM edges WHERE verb = 'TARGETS'")}
    for c in g.execute("SELECT id, label, props, observed_at FROM nodes WHERE type = 'Campaign'"):
        p = _props(c)
        client = cam_client.get(c["id"]) or ws_client.get(str(p.get("workspace_id")))
        if not client:
            continue
        db.execute("INSERT INTO campaigns (id, client_id, workspace_id, name, offer, status, audience_id, created_at, "
                   "updated_at, analytics, observed_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                   "ON CONFLICT(id) DO UPDATE SET name = excluded.name, offer = excluded.offer, "
                   "status = excluded.status, audience_id = excluded.audience_id, updated_at = excluded.updated_at, "
                   "analytics = excluded.analytics, observed_at = excluded.observed_at, deleted_at = NULL",
                   (c["id"], client, str(p.get("workspace_id") or ""), clip(p.get("name") or c["label"], 200),
                    p.get("offer"), p.get("status"), targets.get(c["id"]), p.get("created_at"), p.get("updated_at"),
                    json.dumps(p.get("analytics") or {}), norm_time(p.get("analytics_as_of") or c["observed_at"]),
                    run_id))
        if p.get("status"):
            observe(db, client, "campaign", c["id"], "status", p["status"], "graph", "gtm-clay",
                    p.get("analytics_as_of") or c["observed_at"], origin=run_id)
        report["campaigns"] += 1
    before = db.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]

    # Enrollment: identity, facts, jobs and sends.
    email_contact: dict[tuple, str] = {}
    for e in g.execute("SELECT src, dst, props, observed_at FROM edges WHERE verb = 'ENROLLED' ORDER BY observed_at"):
        client = cam_client.get(e["src"])
        if not client:
            continue
        p = _props(e)
        at = norm_time(e["observed_at"])
        dates = sorted(p.get("sent_dates") or [])
        first_seen = norm_time(dates[0]) if dates else at
        cid, how = resolve_contact(db, client, p.get("email", ""), p.get("linkedin_url", ""), p.get("name", ""), at)
        if not cid:
            report["skipped_no_key"] += 1
            continue
        email_contact[(client, email_key(p.get("email")))] = cid
        ref = f"{e['src']}:{','.join(p.get('record_ids') or [])}"
        observe(db, client, "contact", cid, "email", email_key(p.get("email")), "clay_record", ref, at,
                provider="clay", origin=run_id)
        observe(db, client, "contact", cid, "name", p.get("name"), "clay_record", ref, at, provider="clay", origin=run_id)
        observe(db, client, "contact", cid, "title", p.get("title"), "clay_record", ref, at, provider="clay",
                origin=run_id)
        observe(db, client, "contact", cid, "linkedin_url", p.get("linkedin_url"), "clay_record", ref, at,
                provider="clay", confidence=0.6, origin=run_id)
        acct = resolve_account(db, account_domain(p.get("email", "")))
        admit(db, client, cid, acct, first_seen, run_id)
        if acct:
            record_employment(db, client, cid, acct, p.get("title", ""), first_seen, "clay_record", ref, run_id)
        cam_name = db.execute("SELECT name FROM campaigns WHERE id = ?", (e["src"],)).fetchone()
        _, arm = campaign_parts(cam_name["name"] if cam_name else "")
        for i, day in enumerate(dates, start=1):
            interact(db, client, "send", day, "clay-activity", f"{e['src']}:{email_key(p.get('email'))}:{day}",
                     cid, acct, e["src"], step=i, variant=arm, origin=run_id)
            report["sends"] += 1
        if p.get("bounced"):
            interact(db, client, "bounce", dates[-1] if dates else at, "clay-activity",
                     f"{e['src']}:{email_key(p.get('email'))}:bounced", cid, acct, e["src"], origin=run_id)

    # Replies, with the strongest classification.
    classes: dict[str, tuple] = {}
    for e in g.execute("SELECT src, dst, props FROM edges WHERE verb = 'CLASSIFIED_AS'"):
        p = _props(e)
        bys = p.get("by") or []
        bys = bys if isinstance(bys, list) else [bys]
        for by in bys or [""]:
            cls = e["dst"].split(":")[-1]
            if e["src"] not in classes or by_rank(by) > by_rank(classes[e["src"]][1]):
                classes[e["src"]] = (cls, by)
    reply_cam = {e["src"]: e["dst"] for e in g.execute("SELECT src, dst FROM edges WHERE verb = 'IN_CAMPAIGN'")}
    for r in g.execute("SELECT id, props, observed_at FROM nodes WHERE type = 'Reply'"):
        p = _props(r)
        cam = reply_cam.get(r["id"])
        client = cam_client.get(cam) if cam else ws_client.get(str(p.get("workspace_id") or ""))
        if not client and len(ws_client) == 1:
            client = next(iter(ws_client.values()))
        if not client:
            continue
        ek = email_key(p.get("lead_email"))
        cid = email_contact.get((client, ek))
        if not cid:
            cid, _ = resolve_contact(db, client, ek, "", "", norm_time(p.get("time")))
        if not cid:
            report["skipped_no_key"] += 1
            continue
        acct = resolve_account(db, account_domain(ek))
        admit(db, client, cid, acct, norm_time(p.get("time")), run_id)
        observe(db, client, "contact", cid, "email", ek, "reply_text", r["id"], p.get("time") or r["observed_at"],
                origin=run_id)
        cls, by = classes.get(r["id"], (None, None))
        subject = clip(p.get("subject"), 120)
        bounce = cls == "bounce" or subject.lower().startswith(("delivery status notification", "undeliverable"))
        interact(db, client, "reply", p.get("time") or r["observed_at"], "clay-inbox", r["id"], cid, acct, cam,
                 reply_class="bounce" if bounce and not cls else cls, classified_by=by,
                 detail={"answered": bool(p.get("answered")), "forwarded": bool(p.get("forwarded")),
                         "subject": subject, "screen_flag": p.get("screen_flag")}, origin=run_id)
        report["replies"] += 1
        if p.get("forwarded"):
            interact(db, client, "forward", p.get("time") or r["observed_at"], "clay-inbox", r["id"] + ":fwd",
                     cid, acct, cam, origin=run_id)
        if cls == "unsubscribe":
            interact(db, client, "unsubscribe", p.get("time") or r["observed_at"], "clay-inbox", r["id"] + ":unsub",
                     cid, acct, cam, origin=run_id)
        if by and by_rank(by) == 2:
            interact(db, client, "client_verdict", p.get("time") or r["observed_at"], "clay-inbox",
                     r["id"] + ":verdict", cid, acct, cam, classified_by=by,
                     detail={"verdict": "good_fit" if cls == "positive" else "not_fit" if cls == "negative" else cls},
                     origin=run_id)

    # Meetings.
    with_person = {}
    for e in g.execute("SELECT src, dst FROM edges WHERE verb = 'MEETING_WITH'"):
        with_person.setdefault(e["src"], []).append(e["dst"])
    booked = {e["src"]: e["dst"] for e in g.execute("SELECT src, dst FROM edges WHERE verb = 'BOOKED_FROM'")}
    for m in g.execute("SELECT id, props, observed_at FROM nodes WHERE type = 'Meeting'"):
        p = _props(m)
        cam = booked.get(m["id"])
        client = cam_client.get(cam) if cam else None
        if not client:
            continue
        for person in with_person.get(m["id"], []):
            pe = g.execute("SELECT props FROM nodes WHERE id = ?", (person,)).fetchone()
            ek = email_key((_props(pe) if pe else {}).get("handle") or person.split(":")[-1])
            cid = email_contact.get((client, ek)) or resolve_contact(db, client, ek)[0]
            if not cid:
                continue
            interact(db, client, "meeting", p.get("start") or p.get("time") or m["observed_at"], "calendar",
                     f"{m['id']}:{ek}", cid, resolve_account(db, account_domain(ek)), cam,
                     detail={"title": clip(p.get("title"), 120)}, origin=run_id)
            report["meetings"] += 1

    # Do-not-contact signals become observations with their reason.
    for s in g.execute("SELECT id, props, observed_at FROM nodes WHERE type = 'Signal'"):
        p = _props(s)
        client = p.get("client_id")
        if p.get("kind") != "do_not_contact" or not client or not db.execute(
                "SELECT 1 FROM clients WHERE id = ?", (client,)).fetchone():
            continue
        if p.get("email"):
            cid, _ = resolve_contact(db, client, p["email"])
            if cid:
                admit(db, client, cid, None, norm_time(s["observed_at"]), run_id)
                observe(db, client, "contact", cid, "email", email_key(p["email"]), "config", s["id"],
                        s["observed_at"], origin=run_id)
                observe(db, client, "contact", cid, "do_not_contact", p.get("reason") or "do not contact", "config",
                        s["id"], s["observed_at"], origin=run_id)
        elif p.get("domain"):
            aid = resolve_account(db, p["domain"])
            if aid:
                admit(db, client, None, aid, norm_time(s["observed_at"]), run_id)
                observe(db, client, "account", aid, "do_not_contact", p.get("reason") or "do not contact", "config",
                        s["id"], s["observed_at"], origin=run_id)
    report["contacts_new"] = db.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] - before
    report["conflicts_new"] = db.execute("SELECT COUNT(*) FROM identity_conflicts").fetchone()[0] - report.pop(
        "conflicts_before")
    return report


# ── ingest: Clay assets and credits ──────────────────────────────────────────


def clay_runner(op: str, **args) -> dict:
    """One read through `chewbacca clay`. Only reads are ever named here."""
    import subprocess
    if op not in CLAY_READS:
        raise MemoryError_(f"refusing clay op {op}: GTM memory only reads")
    argv = ["node", str(ROOT / "bin" / "chewbacca-clay"), op] + [f"{k}={v}" for k, v in args.items()]
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired as e:
        raise MemoryError_(f"clay {op} timed out after 90s") from e
    try:
        body = json.loads(out.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as e:
        raise MemoryError_(f"clay {op} returned no JSON (exit {out.returncode})") from e
    if not body.get("ok"):
        raise MemoryError_(f"clay {op} failed: {clip(body.get('reason') or body.get('class'), 200)}")
    return body


CLAY_READS = frozenset({"tables", "columns", "table", "credit-usage", "credits"})


def column_config(col: dict) -> dict:
    """The column's settings in one shape, whichever surface answered (the
    CLI says `settings`, the frontend API says `typeSettings`). The auth
    account id is dropped: it names a connected credential."""
    settings = dict(col.get("settings") or col.get("typeSettings") or {})
    settings.pop("authAccountId", None)
    return settings


def ingest_clay(db, run_id: str, runner=None, window_days: int = 30) -> dict:
    runner = runner or clay_runner
    stamp = iso(now())
    report = {"tables": 0, "columns": 0, "column_versions_new": 0, "ledger_rows": 0, "errors": []}
    for ws in db.execute("SELECT id, client_id FROM clay_workspaces WHERE deleted_at IS NULL").fetchall():
        client = ws["client_id"]
        try:
            tables = runner("tables", ws=ws["id"]).get("data") or []
        except MemoryError_ as e:
            report["errors"].append(str(e))
            continue
        seen = set()
        for t in tables:
            tid = str(t.get("id") or "")
            if not tid:
                continue
            seen.add(tid)
            wb = t.get("workbook") or {}
            settings, entity = {}, None
            try:
                meta = runner("table", table=tid).get("data") or {}
                settings = meta.get("tableSettings") or {}
                entity = meta.get("type")
            except MemoryError_ as e:
                report["errors"].append(str(e))
            db.execute("INSERT INTO clay_tables (id, client_id, workspace_id, workbook_id, workbook, name, entity_type, "
                       "auto_run, auto_run_mode, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                       "ON CONFLICT(id) DO UPDATE SET name = excluded.name, workbook = excluded.workbook, "
                       "entity_type = COALESCE(excluded.entity_type, clay_tables.entity_type), "
                       "auto_run = COALESCE(excluded.auto_run, clay_tables.auto_run), "
                       "auto_run_mode = COALESCE(excluded.auto_run_mode, clay_tables.auto_run_mode), "
                       "last_seen = excluded.last_seen, deleted_at = NULL",
                       (tid, client, ws["id"], wb.get("id"), clip(wb.get("name"), 160), clip(t.get("name"), 200),
                        entity, None if "AUTO_RUN_ON" not in settings else int(bool(settings["AUTO_RUN_ON"])),
                        settings.get("AUTO_RUN_MODE"), stamp, stamp))
            if "AUTO_RUN_ON" in settings:
                observe(db, client, "clay_table", tid, "auto_run", "on" if settings["AUTO_RUN_ON"] else "off",
                        "clay_column", "chewbacca clay table", stamp, provider="clay", origin=run_id)
            report["tables"] += 1
            try:
                cols = runner("columns", table=tid).get("data") or []
            except MemoryError_ as e:
                report["errors"].append(str(e))
                continue
            live = set()
            for col in cols:
                cid = str(col.get("id") or "")
                if not cid:
                    continue
                live.add(cid)
                cfg = column_config(col)
                action = cfg.get("actionKey")
                h = digest(json.dumps(cfg, sort_keys=True))
                db.execute("INSERT INTO clay_columns (table_id, id, client_id, name, type, action_key, provider, "
                           "conditional_run, config_hash, clay_updated_at, first_seen, last_seen) VALUES "
                           "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(table_id, id) DO UPDATE SET "
                           "name = excluded.name, type = excluded.type, action_key = excluded.action_key, "
                           "provider = excluded.provider, conditional_run = excluded.conditional_run, "
                           "config_hash = excluded.config_hash, clay_updated_at = excluded.clay_updated_at, "
                           "last_seen = excluded.last_seen, deleted_at = NULL",
                           (tid, cid, client, clip(col.get("name"), 160), col.get("type"), action,
                            action.split("-")[0] if action else None, int(bool(cfg.get("conditionalRunFormulaText"))),
                            h, col.get("updatedAt"), stamp, stamp))
                cur = db.execute("INSERT OR IGNORE INTO clay_column_versions (table_id, column_id, client_id, "
                                 "config_hash, config, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
                                 (tid, cid, client, h, json.dumps(cfg, sort_keys=True)[:20000], stamp))
                report["column_versions_new"] += cur.rowcount
                report["columns"] += 1
            for gone in db.execute("SELECT id FROM clay_columns WHERE table_id = ? AND deleted_at IS NULL",
                                   (tid,)).fetchall():
                if gone["id"] not in live:
                    db.execute("UPDATE clay_columns SET deleted_at = ? WHERE table_id = ? AND id = ?",
                               (stamp, tid, gone["id"]))
        for gone in db.execute("SELECT id FROM clay_tables WHERE workspace_id = ? AND deleted_at IS NULL",
                               (ws["id"],)).fetchall():
            if gone["id"] not in seen:
                db.execute("UPDATE clay_tables SET deleted_at = ? WHERE id = ?", (stamp, gone["id"]))
        try:
            usage = runner("credit-usage", ws=ws["id"], days=window_days).get("data") or {}
        except MemoryError_ as e:
            report["errors"].append(str(e))
            continue
        report["ledger_rows"] += write_ledger(db, client, ws["id"], usage, window_days, stamp, run_id)
    return report


def write_ledger(db, client: str, ws: str, usage: dict, window_days: int, stamp: str, run_id: str) -> int:
    rows = 0

    def add(table_id, credits, ax, attribution, note=None):
        nonlocal rows
        db.execute("INSERT OR IGNORE INTO credit_ledger (id, client_id, workspace_id, table_id, column_id, credits, "
                   "action_executions, window_days, as_of, attribution, source, note, origin) "
                   "VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'chewbacca clay credit-usage', ?, ?)",
                   (new_id("cr"), client, ws, table_id, round(float(credits or 0), 3), ax, window_days, stamp,
                    attribution, note, run_id))
        rows += 1

    def walk(e, parent_name=""):
        ent = e.get("entity") or {}
        kind = ent.get("__kind")
        subs = e.get("subentities") or []
        if kind == "table":
            add(str(e.get("id")), e.get("credits"), e.get("actionExecutions"), "table", clip(ent.get("name"), 200))
            if not db.execute("SELECT 1 FROM clay_tables WHERE id = ?", (str(e.get("id")),)).fetchone():
                db.execute("INSERT INTO clay_tables (id, client_id, workspace_id, name, first_seen, last_seen) "
                           "VALUES (?, ?, ?, ?, ?, ?)", (str(e.get("id")), client, ws, clip(ent.get("name"), 200),
                                                         stamp, stamp))
            return
        child = sum(float(s.get("credits") or 0) for s in subs)
        rest = float(e.get("credits") or 0) - child
        if kind == "workbook" and rest > 0.01:
            add(None, rest, None, "workbook", f"{clip(ent.get('name'), 160)}: spent outside any listed table")
        for s in subs:
            walk(s, ent.get("name") or parent_name)

    for e in usage.get("entities") or []:
        walk(e)
    if float(usage.get("unattributedCredits") or 0) > 0:
        add(None, usage["unattributedCredits"], usage.get("unattributedActionExecutions"), "unattributed",
            "Clay could not attribute these")
    return rows


# ── ingest orchestration ─────────────────────────────────────────────────────


def ingest(db, graph_file: Path | str | None = None, clay: bool = False, dry_run: bool = False,
           runner=None) -> dict:
    """Read the graph (and Clay assets when asked) into memory. A dry run does
    all the work inside a transaction and rolls it back, so the counts it
    prints are exactly what an apply would write."""
    run_id = new_id("run")
    started = iso(now())
    gpath = Path(graph_file or graph_path())
    if not gpath.exists():
        raise MemoryError_(f"no OS graph at {gpath}: run `chewbacca gtm sync` first")
    graph = sqlite3.connect(f"file:{gpath}?mode=ro", uri=True, timeout=5)
    graph.row_factory = sqlite3.Row
    sources = ["graph"] + (["clay"] if clay else [])
    report: dict = {"run": run_id, "dry_run": dry_run}
    db.execute("BEGIN IMMEDIATE")
    try:
        report["graph"] = ingest_graph(db, graph, run_id)
        if clay:
            report["clay"] = ingest_clay(db, run_id, runner)
        derived = {}
        for c in live_clients(db):
            derived[c["name"]] = {
                "scored": recompute_scores(db, c["id"]),
                "experiments": rebuild_experiments(db, c["id"]),
                "commitments": derive_commitments(db, c["id"]),
                "summaries_changed": refresh_summaries(db, c["id"]),
            }
        report["derived"] = derived
        if dry_run:
            db.execute("ROLLBACK")
            return report
        db.execute("INSERT INTO ingest_runs (id, started_at, finished_at, sources, ok, report) VALUES (?, ?, ?, ?, 1, ?)",
                   (run_id, started, iso(now()), ",".join(sources), json.dumps(report, default=str)))
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise
    finally:
        graph.close()
    return report


def last_ingest(db) -> dict | None:
    row = db.execute("SELECT id, finished_at, sources FROM ingest_runs WHERE ok = 1 "
                     "ORDER BY finished_at DESC LIMIT 1").fetchone()
    return dict(row) if row else None
