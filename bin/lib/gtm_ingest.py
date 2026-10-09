"""GTM ingesters: every client's campaigns, sends, replies and meetings as OS graph facts.

Caleb, 2026-10-09: Chewbacca needs "perfect memory of diff client's tables
replies meetings and the whole gtm life cycle". Memory files went stale within a
day on Zeutara, so client state is synced from the systems that hold it and
answered from the graph (bin/lib/gtm_query.py), never from notes.

THREE SOURCES, each its own snapshot (`Graph.apply` replaces what that source
wrote last time, so a lead that left a campaign loses its edge):

  gtm-clay:<workspace>    the clay CLI: campaigns with analytics, per-lead sends
                          from Audiences activities, tables, audiences
  gtm-inbox:<workspace>   bin/clay-inbox: every reply with its thread, through the
                          signed-in Chrome tab. Skipped, never faked, when the tab
                          cannot be reached.
  gtm-calendar            Google Calendar through `gws` (every calendar he can
                          see) UNIONED with `mac calendar list --json`, deduped
                          by iCalUID and start, matched to leads by attendee
                          email only. One reader failing is recorded on its own
                          row (gtm-calendar:google, gtm-calendar:mac); the
                          union is refused whenever a reader that supplied
                          meetings last time cannot be read now.

BOOKING SIGNALS. Zeutara meetings book on Jonah's calendar, which this machine
cannot read, so the inbox snapshot also records `booking_signal` Signals from
the reply threads: a calendar invite or accept, a scheduler confirmation
(Calendly, cal.com, SavvyCal, HubSpot), or a message that proposes or confirms
a specific time. They are a separate class from calendar Meetings and are never
added to them, and a proposed time is never counted as confirmed.

READ ONLY. `ClayCLI` refuses any clay command outside READ_ONLY, so nothing here
can send, run a column, spend credits, add leads or change a campaign. `GwsCLI`
does the same for gws with GWS_READ_ONLY: no event is created, edited or
answered, and no file is written. Reply text
is email from strangers: it is stored as a clipped label and screened with the
untrusted-screen pattern layer, never read for instructions.

IDENTITY. A lead is a Person keyed by email through `osgraph.person_node`: the
people store when the address resolves, else a node for that exact address. The
same address in two clients' campaigns is one node. A name never merges anyone.

SENDS, NOT ENROLLMENT. A person in a campaign is an ENROLLED edge; whether they
were emailed is `last_sent_at` on it, read from Clay's "Email sent" activities.
On 2026-10-05 treating enrollment as sent hid ~1,400 never-emailed contacts, and
Clay's paused campaigns still show 140 leads and 12 sends each (2026-10-09).
"""
from __future__ import annotations

import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import osgraph  # noqa: E402
from osgraph import Edge, Graph, Identities, Node, node_key, person_node  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

# Every clay command this module may run, as an argv prefix. Anything else is
# refused before a process starts. Measured surface 2026-10-09 (clay 2.23):
# these are the reads; `campaigns update`, `sequence`, `variants`, `workflows`,
# `audiences records upsert` and anything that runs a column are writes.
READ_ONLY = (
    ("workspaces", "list"),
    ("campaigns", "list"),
    ("campaigns", "analytics"),
    ("audiences", "list"),
    ("audiences", "records", "search-ids"),
    ("audiences", "records", "get"),
    ("tables", "list"),
)
REPLY_CLASSES = ("positive", "neutral", "negative", "ooo", "bounce", "unsubscribe")
# Clay's own reply categories (analytics `replies.categories`), mapped by rule.
# A Clay "Interested" is NOT proof of interest: on 2026-10-05 it was Hustle
# Fund's canned apply-on-our-site redirect. The edge records by="clay" so a
# reader can tell a rule label from a person's.
CLAY_CATEGORY_CLASS = {
    "interested": "positive", "meeting request": "positive",
    "information request": "neutral", "wrong person": "neutral", "uncategorizable": "neutral",
    "not interested": "negative",
    "do not contact": "unsubscribe", "unsubscribed": "unsubscribe",
    "out of office": "ooo",
    "sender originated bounce": "bounce", "bounced": "bounce",
}
# togari reply-intent kinds (zeutara-gtme scripts/classify_inbox.ts), by rule.
INTENT_CLASS = {
    "deck": "positive", "question": "positive", "interested": "positive", "meeting": "positive",
    "later": "neutral", "referral": "neutral", "new_address": "neutral", "form": "neutral",
    "unclear": "neutral", "ignore": "neutral",
    "pass": "negative", "unsubscribe": "unsubscribe", "ooo": "ooo", "bounce": "bounce",
}
# Activity titles Clay writes, read off Jonah's workspace 2026-10-09.
SENT_TITLE = "Email sent"
REPLIED_TITLE = "Email replied"
BOUNCED_TITLE = "Email bounced"
STATUS_JOINED = "Campaign " + "enrolled"
# Clay pages Audiences id searches up to 10,000; 2,000 keeps one call quick.
PAGE = 2000
# records get takes at most 100 ids (clay audiences records get --help).
RECORD_BATCH = 100
# Four in flight: the activities budget is 60 calls a minute a workspace, and
# a 26-campaign sync makes ~180 calls. Rate-limited calls back off on Clay's
# own retryAfter.
WORKERS = 4
MAX_TRIES = 6
SNIPPET = 280
# C0 controls (ESC starts a terminal escape), DEL, the C1 block (U+009B is a
# one-character CSI that terminals honour in UTF-8 mode, so a reply body could
# still repaint the screen after ESC was stripped: security review 2026-10-09),
# zero-width and bidi overrides, line and paragraph separators, the BOM.
CONTROL = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]")
# An id Clay hands back goes into a clay argv as a positional. One that starts
# with "-" would be parsed as a flag, so anything outside this shape is refused.
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
# The only flags a read may carry. Values after them are not checked here.
FLAGS = frozenset({"--with-analytics", "--limit", "--cursor", "--query", "--entity-type", "--ids"})
UNSCREENED = "UNSCREENED: the untrusted-screen pattern layer could not run"
# Reply and label classes that mean "never email this address again", on top
# of the plain fact of a reply (any reply suppresses).
DNC_CLASSES = frozenset({"negative", "unsubscribe", "bounce"})

# Every gws command this module may run, as an argv prefix, and the only flags
# it may carry. Measured surface 2026-10-09 (gws 0.22.5): `+insert`, `events
# insert|patch|update|delete|move|quickAdd|import`, `acl`, `calendars` and
# `--output` (writes a file) are all outside it. RSVP is an events patch.
GWS_READ_ONLY = (
    ("calendar", "calendarList", "list"),
    ("calendar", "events", "list"),
)
GWS_FLAGS = frozenset({"--params", "--format"})
# Caleb's window, 2026-10-09: the past 90 days and the next 60.
CALENDAR_BACK_DAYS = 90
CALENDAR_AHEAD_DAYS = 60
# events.list caps maxResults at 2500 a page (Calendar API reference).
GOOGLE_PAGE = 2500
# 12 calendars on his account 2026-10-09, one page each; 50 pages is a runaway.
GOOGLE_MAX_PAGES = 50
# Calendars whose events carry attendees. freeBusyReader sees only busy blocks.
GOOGLE_ROLES = frozenset({"owner", "writer", "reader"})
CALENDAR_READERS = ("google", "mac")

# Booking evidence inside a reply thread. Confidences are guessed, never
# measured against labelled threads: an accept or a scheduler confirmation is
# a machine-written fact, an invite means an event exists on someone's
# calendar, and a human "Tuesday 2pm works" is the weakest of the confirmed.
BOOKING_CONFIDENCE = {
    "calendar_accept": 0.95, "scheduler_confirmation": 0.9, "calendar_invite": 0.85,
    "time_confirmed": 0.65, "time_confirmed_in_reply": 0.55, "time_proposed": 0.5,
}
BOOKING_SNIPPET = 200


class ReadOnlyViolation(RuntimeError):
    pass


class SourceUnavailable(RuntimeError):
    """The source could not be read. The sync records it and writes nothing."""


class WorkspaceMismatch(SourceUnavailable):
    """A clay answer named no workspace, or another one than the sync asked for."""


class ConfigError(RuntimeError):
    """clients.json exists but cannot be trusted: unparsable, or two clients claim one workspace."""


def config_path() -> Path:
    return Path(os.environ.get("GTM_CONFIG") or Path.home() / ".chewbacca" / "gtm" / "clients.json")


def load_config(path: Path | None = None) -> dict:
    """The client config. A missing file is an empty config; a file that
    exists and cannot be parsed is a ConfigError. The first version returned
    an empty config for both, so one stray comma made every workspace sync as
    an unnamed client with none of its do-not-contact entries (security
    review, 2026-10-09)."""
    path = path or config_path()
    if not path.exists():
        return {"clients": []}
    try:
        body = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        raise ConfigError(f"{path} could not be read as JSON: {e}") from e
    if not isinstance(body, dict) or not isinstance(body.get("clients", []), list):
        raise ConfigError(f'{path} must be an object with a "clients" list')
    validate_config(body)
    return body


def client_workspaces(client: dict) -> list[str]:
    return [str(w) for w in (client.get("workspaces") or [client.get("workspace")]) if w]


def validate_config(cfg: dict) -> None:
    """One workspace belongs to exactly one client, and no two clients share
    an id. Either would file one client's sends and replies under the other,
    so both refuse instead of taking the first match."""
    owner: dict[str, str] = {}
    ids: dict[str, str] = {}
    for c in cfg.get("clients") or []:
        if not isinstance(c, dict) or not c.get("name"):
            raise ConfigError("every client needs a name")
        cid = client_id(c)
        if cid in ids:
            raise ConfigError(f"clients {ids[cid]!r} and {c['name']!r} both map to {cid}")
        ids[cid] = c["name"]
        for w in client_workspaces(c):
            if w in owner:
                raise ConfigError(f"workspace {w} is claimed by both {owner[w]!r} and {c['name']!r}")
            owner[w] = c["name"]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "unnamed"


def clip(text, limit: int) -> str:
    text = CONTROL.sub(" ", str(text or ""))
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── the clay CLI, read only ──────────────────────────────────────────────────


def _prefix(args: list[str]) -> tuple:
    return next((p for p in READ_ONLY if tuple(args[:len(p)]) == p), ())


def allowed(args: list[str]) -> bool:
    return bool(_prefix(args))


def _subprocess_runner(argv: list[str]) -> tuple[int, str, str]:
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as err:
        return 127, "", str(err)
    return p.returncode, p.stdout, p.stderr


class ClayCLI:
    def __init__(self, binary: str = "clay", runner=None, sleep=time.sleep):
        self.binary = binary
        self.runner = runner or _subprocess_runner
        self.sleep = sleep
        self.calls = 0
        self.workspace: dict | None = None
        # The workspace every answer must name while a fetch runs. The clay
        # CLI has no per-command workspace flag (it runs against `workspaces
        # current`), so the only proof of which workspace answered is the
        # `workspace` its output contract puts on every success.
        self.expect: str | None = None

    def run(self, args: list[str]) -> dict:
        if not allowed(args):
            raise ReadOnlyViolation(f"clay {' '.join(args[:3])} is not a read this module may run")
        rest = args[len(_prefix(args)):]
        for i, a in enumerate(rest):
            after_flag = i > 0 and rest[i - 1] in FLAGS and rest[i - 1] != "--with-analytics"
            if a.startswith("-") and not after_flag and a not in FLAGS:
                raise ReadOnlyViolation(f"clay {' '.join(args[:3])} carries {a[:40]!r}, not a read flag")
        wait = 2.0
        for _ in range(MAX_TRIES):
            self.calls += 1
            code, out, err = self.runner([self.binary, *args])
            if code == 0:
                try:
                    body = json.loads(out or "{}")
                except ValueError as e:
                    raise SourceUnavailable(f"clay {args[0]} {args[1]} printed non-JSON") from e
                if not isinstance(body, dict):
                    raise SourceUnavailable(f"clay {args[0]} {args[1]} printed {type(body).__name__}, not an object")
                ws = body.get("workspace")
                ws_id = str(ws["id"]) if isinstance(ws, dict) and ws.get("id") else None
                if self.expect is not None:
                    # Missing is a refusal, not a pass: an answer that names
                    # no workspace cannot be filed under the one we asked for.
                    if ws_id is None:
                        raise WorkspaceMismatch(f"clay {' '.join(args[:3])} named no workspace; expected {self.expect}")
                    if ws_id != self.expect:
                        raise WorkspaceMismatch(f"clay is signed in to workspace {ws_id}, not {self.expect}")
                if ws_id:
                    self.workspace = {"id": ws_id, "name": clip(ws.get("name"), 120)}
                return body
            if code == 4:  # rate_limited: back off on Clay's own number
                try:
                    detail = json.loads(err or "{}")["error"].get("details") or {}
                    wait = float(detail.get("retryAfter") or wait)
                except (ValueError, KeyError, TypeError, AttributeError):
                    pass
                self.sleep(min(wait, 60.0))
                wait = min(wait * 2, 60.0)
                continue
            raise SourceUnavailable(f"clay {' '.join(args[:3])} exited {code}: {clip(err, 240)}")
        raise SourceUnavailable(f"clay {' '.join(args[:3])} stayed rate limited after {MAX_TRIES} tries")

    def paged(self, args: list[str], key: str = "data") -> list:
        out, cursor = [], None
        for _ in range(500):
            body = self.run(args + (["--cursor", cursor] if cursor else []))
            page = body.get(key)
            # A success with no list where the list belongs is not "none":
            # reading it as empty would replace real data with nothing.
            if not isinstance(page, list):
                raise SourceUnavailable(f"clay {' '.join(args[:3])} returned no {key!r} list")
            out.extend(page)
            cursor = body.get("cursor")
            if not cursor:
                return out
            if not isinstance(cursor, str) or cursor.startswith("-") or len(cursor) > 4096:
                raise SourceUnavailable(f"clay {' '.join(args[:3])} returned a cursor this module will not pass on")
        raise SourceUnavailable(f"clay {' '.join(args[:3])} never stopped paging")

    def ids(self, query: str) -> list[int]:
        out = []
        for i in self.paged(["audiences", "records", "search-ids", "--query", query, "--limit", str(PAGE)]):
            try:
                out.append(int(i))
            except (TypeError, ValueError) as e:
                raise SourceUnavailable(f"clay search-ids returned a non-integer id {clip(i, 40)!r}") from e
        return out


def gws_allowed(args: list[str]) -> bool:
    return any(tuple(args[:len(p)]) == p for p in GWS_READ_ONLY)


def _gws_body(out: str):
    """gws prints JSON on stdout; a keyring note can share the stream when
    both are captured together, so fall back to the outermost object."""
    text = (out or "").strip()
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            return json.loads(text[start:end + 1])
        except ValueError:
            return None


class GwsCLI:
    """The Google Workspace CLI, read only. Anything outside GWS_READ_ONLY,
    or carrying a flag outside GWS_FLAGS, is refused before a process starts,
    the same way ClayCLI guards clay."""

    def __init__(self, binary: str | None = None, runner=None):
        self.binary = binary or os.environ.get("GWS_BIN") or shutil.which("gws") or "/opt/homebrew/bin/gws"
        self.runner = runner or _subprocess_runner
        self.calls = 0

    def run(self, args: list[str]) -> dict:
        if not gws_allowed(args):
            raise ReadOnlyViolation(f"gws {' '.join(args[:3])} is not a read this module may run")
        rest = args[3:]
        if len(rest) % 2:
            raise ReadOnlyViolation(f"gws {' '.join(args[:3])} carries a flag with no value")
        for flag, value in zip(rest[::2], rest[1::2]):
            if flag not in GWS_FLAGS:
                raise ReadOnlyViolation(f"gws {' '.join(args[:3])} carries {flag[:40]!r}, not a read flag")
            if flag == "--format" and value != "json":
                raise ReadOnlyViolation("gws output must be json")
        self.calls += 1
        code, out, err = self.runner([self.binary, *args])
        body = _gws_body(out)
        if isinstance(body, dict) and isinstance(body.get("error"), dict):
            raise SourceUnavailable(f"google calendar: gws {' '.join(args[1:3])} failed: "
                                    f"{clip(body['error'].get('message') or body['error'], 200)}")
        if code != 0:
            raise SourceUnavailable(f"google calendar: gws {' '.join(args[1:3])} exited {code}: {clip(err or out, 200)}")
        if not isinstance(body, dict):
            raise SourceUnavailable(f"google calendar: gws {' '.join(args[1:3])} printed no JSON object")
        return body

    def paged(self, args: list[str], params: dict) -> list:
        out, token = [], None
        for _ in range(GOOGLE_MAX_PAGES):
            page = dict(params, **({"pageToken": token} if token else {}))
            body = self.run(args + ["--params", json.dumps(page), "--format", "json"])
            items = body.get("items", [])
            if not isinstance(items, list):
                raise SourceUnavailable(f"google calendar: gws {' '.join(args[1:3])} returned no 'items' list")
            out.extend(items)
            token = body.get("nextPageToken")
            if not token:
                return out
            if not isinstance(token, str) or len(token) > 4096:
                raise SourceUnavailable("google calendar: gws returned a page token this module will not pass on")
        raise SourceUnavailable(f"google calendar: gws {' '.join(args[1:3])} never stopped paging")


def _q(text: str) -> str:
    return '"' + str(text).replace("\\", "\\\\").replace('"', '\\"') + '"'


def activity_query(campaign_id: str, kind: str, title: str, day: str | None = None) -> str:
    cond = f"activity_type = {_q(kind)} and source_id = {_q(campaign_id)} and title = {_q(title)}"
    if day:
        nxt = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
        cond += f" and activity_timestamp >= {_q(day)} and activity_timestamp < {_q(nxt)}"
    return f"select from people where activities.exists({cond})"


def fetch_clay(cli: ClayCLI, workspace_id: str, workers: int = WORKERS) -> dict:
    """Everything the clay snapshot needs, read through `cli`. Raises
    SourceUnavailable on a refused read, or when the CLI is signed in to a
    different workspace than the one asked for (writing client A's campaigns
    under client B is the failure this prevents).

    EVERY call is checked, not just the first, and an answer that names no
    workspace is refused: the first version checked only the campaign list
    and passed when `workspace` was absent, so a CLI that never reported its
    workspace had its campaigns filed under whichever id the sync asked for
    (security review, 2026-10-09)."""
    cli.workspace = None
    cli.expect = str(workspace_id)
    try:
        return _fetch_clay(cli, str(workspace_id), workers)
    finally:
        cli.expect = None


def _fetch_clay(cli: ClayCLI, workspace_id: str, workers: int) -> dict:
    campaigns = cli.paged(["campaigns", "list", "--with-analytics", "--limit", "100"])
    for c in campaigns:
        if not isinstance(c, dict) or not SAFE_ID.match(str(c.get("id") or "")):
            raise SourceUnavailable(f"clay campaigns list returned an id this module will not pass on: "
                                    f"{clip((c or {}).get('id') if isinstance(c, dict) else c, 40)!r}")

    def analytics(c):
        body = cli.run(["campaigns", "analytics", c["id"]])
        return c["id"], body

    with ThreadPoolExecutor(max_workers=workers) as pool:
        stats = dict(pool.map(analytics, campaigns))

    jobs = []
    for c in campaigns:
        a = c.get("analytics") or {}
        if not (a.get("leads") or a.get("sent")):
            continue
        cid = c["id"]
        jobs.append((cid, "joined", None, activity_query(cid, "campaign_status", STATUS_JOINED)))
        jobs.append((cid, "replied", None, activity_query(cid, "email", REPLIED_TITLE)))
        jobs.append((cid, "bounced", None, activity_query(cid, "email", BOUNCED_TITLE)))
        daily = (stats[cid].get("stats") or {}).get("daily")
        sent_total = a.get("sent") or ((stats[cid].get("stats") or {}).get("totals") or {}).get("sent") or 0
        if sent_total and not isinstance(daily, list):
            # No per-day breakdown means no "Email sent" searches, so every
            # emailed lead would read as never emailed and drop out of
            # suppression. Refuse instead.
            raise SourceUnavailable(f"clay analytics for {cid} counts {sent_total} sends but has no daily breakdown")
        for d in daily or []:
            if d.get("sent"):
                try:
                    date.fromisoformat(str(d.get("date")))
                except ValueError as e:
                    raise SourceUnavailable(f"clay analytics for {cid} has a malformed day {clip(d.get('date'), 30)!r}") from e
                jobs.append((cid, "sent", d["date"], activity_query(cid, "email", SENT_TITLE, d["date"])))

    def search(job):
        cid, kind, day, query = job
        return cid, kind, day, cli.ids(query)

    activity: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for cid, kind, day, found in pool.map(search, jobs):
            slot = activity.setdefault(cid, {"joined": [], "replied": [], "bounced": [], "sent": {}})
            if kind == "sent":
                slot["sent"][day] = found
            else:
                slot[kind] = found

    for c in campaigns:
        sent_total = (c.get("analytics") or {}).get("sent") or 0
        found = sum(len(v) for v in ((activity.get(c["id"]) or {}).get("sent") or {}).values())
        if sent_total and not found:
            raise SourceUnavailable(f"clay counts {sent_total} sends on {c['id']} but its activities name nobody "
                                    "emailed; keeping the previous snapshot rather than unsuppressing them")

    wanted = sorted({i for a in activity.values() for k, v in a.items()
                     for i in (sum(v.values(), []) if k == "sent" else v)})
    batches = [wanted[i:i + RECORD_BATCH] for i in range(0, len(wanted), RECORD_BATCH)]

    def records(batch):
        rows = cli.run(["audiences", "records", "get", "--entity-type", "people",
                        "--ids", ",".join(map(str, batch))]).get("data")
        if not isinstance(rows, list):
            raise SourceUnavailable("clay audiences records get returned no 'data' list")
        return rows

    with ThreadPoolExecutor(max_workers=workers) as pool:
        people = {str(r["recordId"]): r.get("fields") or {} for rows in pool.map(records, batches)
                  for r in rows if isinstance(r, dict) and "recordId" in r}

    tables = cli.paged(["tables", "list", "--limit", "100"])
    audiences = cli.paged(["audiences", "list", "--entity-type", "people"])
    if (cli.workspace or {}).get("id") != workspace_id:
        raise WorkspaceMismatch(f"clay answered for {(cli.workspace or {}).get('id')}, not {workspace_id}")
    return {"workspace": cli.workspace,
            "campaigns": campaigns, "analytics": stats, "activity": activity,
            "records": people, "tables": tables, "audiences": audiences,
            "fetched_at": utc_now(), "calls": cli.calls}


# ── building snapshots ───────────────────────────────────────────────────────


def client_for(cfg: dict, workspace_id: str, workspace_name: str) -> dict:
    """The one configured client that owns this exact workspace id. Two
    owners refuse. An unconfigured workspace becomes its own client keyed by
    the workspace id, never by its display name: the first version keyed it
    by the name's slug, so two workspaces both called "Outbound", or one
    called "Acme" next to a configured client Acme, became ONE client node
    and each other's campaigns, sends and suppression list."""
    owners = [c for c in cfg.get("clients") or [] if str(workspace_id) in client_workspaces(c)]
    if len(owners) > 1:
        raise ConfigError(f"workspace {workspace_id} is claimed by {len(owners)} clients")
    if owners:
        return owners[0]
    return {"name": clip(workspace_name, 120) or f"Workspace {workspace_id}", "workspaces": [str(workspace_id)],
            "id": f"client:clay-ws:{workspace_id}", "unconfigured": True}


def offer_for(client: dict, campaign_name: str) -> str | None:
    """The offer a campaign sells: the second " | " part of its name
    ("Zeutara | Ivy | Pre-seed investors | Wave 2" sells Ivy), normalised to a
    configured offer's name when it matches one of its aliases."""
    parts = [p.strip() for p in (campaign_name or "").split("|")]
    if len(parts) < 2 or not parts[1]:
        return None
    raw = parts[1]
    for offer in client.get("offers") or []:
        names = [offer.get("name", "")] + list(offer.get("aliases") or [])
        if any(raw.lower() == n.lower() for n in names if n):
            return offer["name"]
    return clip(raw, 120)


def client_id(client: dict) -> str:
    return str(client.get("id") or f"client:{slug(client['name'])}")


def client_node(client: dict, ws_id: str) -> Node:
    """Written identically by the clay and inbox snapshots, so whichever ran
    last leaves the same row."""
    return Node(client_id(client), "Client", client["name"], {
        "principal": client.get("principal", ""), "workspaces": client_workspaces(client) or [ws_id],
        "unconfigured": bool(client.get("unconfigured"))})


def domain_key(value: str) -> str:
    """A bare domain, ASCII lowercased, or "" when it is not one."""
    value = (value or "").strip().lower().lstrip("@").removeprefix("*@")
    if not value.isascii() or not re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+", value):
        return ""
    return value


def dnc_entries(client: dict) -> list[dict]:
    """Every do-not-contact entry configured for a client, as {"email"|"domain", "reason"}.

    Two places: `do_not_contact` rows in clients.json, and `blocklist_files`
    (one address or domain per line, first CSV column), which is how Clay's
    global blocklist gets in: clay 1.8 has no read for it, so it is exported
    from the workspace settings page and named here. A configured file that
    cannot be read fails the sync rather than shrinking the list."""
    out = []

    def add(value, reason):
        value = str(value or "").strip().strip('"')
        if "@" in value and not value.startswith(("@", "*@")):
            key = osgraph.email_key(value)
            if key and key.isprintable():
                out.append({"email": key, "reason": reason})
        else:
            d = domain_key(value)
            if d:
                out.append({"domain": d, "reason": reason})

    for row in client.get("do_not_contact") or []:
        if isinstance(row, str):
            add(row, "do not contact (config)")
        elif isinstance(row, dict):
            add(row.get("email") or row.get("domain"), clip(row.get("reason") or "do not contact (config)", 120))
    for spec in client.get("blocklist_files") or []:
        spec = spec if isinstance(spec, dict) else {"path": spec}
        path = Path(os.path.expanduser(str(spec.get("path") or "")))
        reason = clip(spec.get("reason") or "blocklist", 120)
        try:
            text = path.read_text()
        except OSError as e:
            raise SourceUnavailable(f"blocklist file {path} could not be read: {e.strerror}") from e
        for line in text.splitlines():
            cell = line.split(",", 1)[0].strip()
            if cell and not cell.startswith("#") and cell.lower() not in ("email", "domain"):
                add(cell, reason)
    return out


def lead_person(ids: Identities, email: str, hint: str) -> tuple[Node | None, str]:
    """The Person for an address, and its comparison key. No key, no node: an
    address that is not plain ASCII never matches anyone (osgraph.email_key)."""
    key = osgraph.email_key(email or "")
    if not key or not str(email).isprintable():
        return None, ""
    return person_node(ids, key, source_hint=hint), key


def build_clay(raw: dict, cfg: dict, ids: Identities) -> tuple[list[Node], list[Edge], dict]:
    ws = raw["workspace"]
    ws_id = str(ws["id"])
    client = client_for(cfg, ws_id, ws.get("name", ""))
    cid = client_id(client)
    nodes: dict[str, Node] = {}
    edges: dict[tuple, Edge] = {}

    def add(n: Node):
        nodes.setdefault(n.id, n)
        return n.id

    def link(src, verb, dst, **props):
        edges[(src, verb, dst)] = Edge(src, verb, dst, props)

    ws_node = add(Node(f"workspace:clay:{ws_id}", "Workspace", clip(ws.get("name"), 120) or ws_id,
                       {"platform": "clay", "workspace_id": ws_id}))
    add(client_node(client, ws_id))
    link(cid, "OWNS", ws_node)
    for entry in dnc_entries(client):
        target = cid
        if entry.get("email"):
            person, _ = lead_person(ids, entry["email"], "gtm-config")
            if person is None:
                continue
            target = add(person)
        sig = add(Node(node_key("signal", f"clay:{ws_id}", cid, entry.get("email") or entry.get("domain"),
                                entry["reason"]), "Signal", f"Do not contact {entry.get('email') or entry.get('domain')}",
                       {"kind": "do_not_contact", "client_id": cid, "email": entry.get("email", ""),
                        "domain": entry.get("domain", ""), "reason": entry["reason"]}))
        link(sig, "SIGNAL_ON", target)
    categories: dict[str, str] = {}
    for o in client.get("offers") or []:
        oid = add(Node(f"offer:{slug(cid)}:{slug(o['name'])}", "Offer", o["name"], {}))
        link(cid, "OFFERS", oid)

    for a in raw.get("audiences") or []:
        aid = add(Node(f"audience:clay:{a['id']}", "Audience", clip(a.get("name"), 160) or a["id"],
                       {"workspace_id": ws_id, "entity": a.get("entityType")}))
        link(aid, "IN_WORKSPACE", ws_node)
    for t in raw.get("tables") or []:
        tid = add(Node(f"claytable:clay:{t['id']}", "ClayTable", clip(t.get("name"), 160) or t["id"],
                       {"workspace_id": ws_id, "workbook": (t.get("workbook") or {}).get("name"),
                        "created_at": t.get("createdAt")}))
        link(tid, "IN_WORKSPACE", ws_node)

    records = raw.get("records") or {}
    skipped = {"no_email": 0, "record_gone": 0}
    for c in raw.get("campaigns") or []:
        cam = c["id"]
        stats = (raw.get("analytics") or {}).get(cam) or {}
        totals = (stats.get("stats") or {}).get("totals") or {}
        cats = ((stats.get("replies") or {}).get("categories")) or []
        for cat in cats:
            if cat.get("categoryId") and cat.get("categoryName"):
                categories[str(cat["categoryId"])] = cat["categoryName"]
        steps = ((stats.get("funnel") or {}).get("conversion") or {}).get("steps") or []
        offer = offer_for(client, c.get("name", ""))
        cam_id = add(Node(f"campaign:clay:{cam}", "Campaign", clip(c.get("name"), 200) or cam, {
            "campaign_id": cam, "workspace_id": ws_id, "status": c.get("status"),
            "name": c.get("name"), "offer": offer, "created_at": c.get("createdAt"),
            "updated_at": c.get("updatedAt"),
            "analytics": {**(c.get("analytics") or {}), **{k: totals.get(k) for k in
                          ("sent", "replies", "repliesExcludingOoo", "bounces", "unsubscribes") if k in totals}},
            "steps": [{k: s.get(k) for k in ("step", "sentCount", "repliedCount", "bouncedCount")} for s in steps],
            "reply_categories": [{"name": x.get("categoryName"), "leads": x.get("leads")} for x in cats],
            "analytics_as_of": stats.get("generatedAt"),
        }))
        link(cam_id, "FOR_CLIENT", cid)
        link(cam_id, "IN_WORKSPACE", ws_node)
        if offer:
            oid = add(Node(f"offer:{slug(cid)}:{slug(offer)}", "Offer", offer, {}))
            link(cid, "OFFERS", oid)
            link(cam_id, "SELLS", oid)
        seg = (c.get("audience") or {}).get("id")
        if seg:
            aid = add(Node(f"audience:clay:{seg}", "Audience", seg, {"workspace_id": ws_id}))
            link(aid, "IN_WORKSPACE", ws_node)
            link(cam_id, "TARGETS", aid)

        act = (raw.get("activity") or {}).get(cam) or {}
        sent_by_record: dict[str, list[str]] = {}
        for day, found in (act.get("sent") or {}).items():
            for rid in found:
                sent_by_record.setdefault(str(rid), []).append(day)
        everyone = {str(r) for r in act.get("joined") or []} | set(sent_by_record) \
            | {str(r) for r in act.get("replied") or []} | {str(r) for r in act.get("bounced") or []}
        replied = {str(r) for r in act.get("replied") or []}
        bounced = {str(r) for r in act.get("bounced") or []}
        joined = {str(r) for r in act.get("joined") or []}
        leads: dict[str, dict] = {}
        for rid in sorted(everyone):
            rec = records.get(rid)
            if rec is None:
                skipped["record_gone"] += 1
                continue
            person, key = lead_person(ids, rec.get("email") or rec.get("normalized_email") or "", "clay")
            if person is None:
                skipped["no_email"] += 1
                continue
            add(person)
            lead = leads.setdefault(person.id, {
                "email": key, "name": clip(rec.get("name") or " ".join(
                    x for x in (rec.get("first_name"), rec.get("last_name")) if x), 120),
                "title": clip(rec.get("title"), 160), "linkedin_url": rec.get("linkedin_url") or "",
                "record_ids": [], "sent_dates": set(), "joined": False, "replied": False, "bounced": False})
            lead["record_ids"].append(rid)
            lead["sent_dates"].update(sent_by_record.get(rid, []))
            lead["joined"] |= rid in joined
            lead["replied"] |= rid in replied
            lead["bounced"] |= rid in bounced
        for pid, lead in leads.items():
            dates = sorted(lead.pop("sent_dates"))
            status = ("bounced" if lead["bounced"] else "replied" if lead["replied"]
                      else "sent" if dates else "not_sent")
            link(cam_id, "ENROLLED", pid, **lead, sent_dates=dates,
                 last_sent_at=dates[-1] if dates else None,
                 # One send per step per lead, so distinct send days approximate
                 # the step reached. Exact per-message times exist only for
                 # leads who replied (the inbox thread).
                 steps_sent=len(dates), status=status, enrolled_at=None)

    nodes[ws_node].props["reply_categories"] = categories
    report = {"client": client["name"], "workspace": ws_id, "campaigns": len(raw.get("campaigns") or []),
              "leads": sum(1 for e in edges.values() if e.verb == "ENROLLED"),
              "emailed": sum(1 for e in edges.values() if e.verb == "ENROLLED" and e.props.get("last_sent_at")),
              "tables": len(raw.get("tables") or []), "skipped": skipped, "clay_calls": raw.get("calls")}
    return list(nodes.values()), list(edges.values()), report


def screened(text: str) -> str | None:
    """The untrusted-screen pattern layer: deterministic, offline. Returns the
    pattern that matched, or None. Jev's judgment layer is a network call and
    stays out of a sync.

    A screen that cannot run is UNSCREENED, never clean: the first version
    returned None when the import failed, which every reader takes as
    "screened and nothing found" (security review, 2026-10-09)."""
    try:
        import screen  # bin/lib/screen.py
        hit = screen.pattern_hit(text or "")
    except Exception:
        return UNSCREENED
    return clip(hit.group(0), 120) if hit else None


def load_labels(paths: list[dict], dnc: list | None = None) -> dict[tuple[str, str], list[tuple[str, str, str]]]:
    """(lead email, reply time) -> [(class, by, raw label)] from label files.

    Two shapes are read: zeutara-gtme's classified.json (`lead`, `kind`,
    `reply.time`, labelled by togari reply-intent), and a JSONL a person
    writes ({"email", "reply_time", "class", "by"}) for a human verdict like
    Jonah's good fit / not a fit.

    Every row whose class means never-again (negative, unsubscribe, bounce)
    is also appended to `dnc` as (email, class, by, raw), with or without a
    reply time, so a "not a fit" that never joins to a reply still
    suppresses. A configured file that cannot be read fails the sync: the
    first version skipped it, which silently dropped every human verdict."""
    out: dict[tuple[str, str], list] = {}
    for spec in paths or []:
        path = Path(os.path.expanduser(str(spec.get("path", ""))))
        by = clip(spec.get("by") or "model", 60)
        try:
            text = path.read_text()
        except OSError as e:
            raise SourceUnavailable(f"reply label file {path} could not be read: {e.strerror}") from e
        try:
            rows = json.loads(text)
            # A one-line JSONL file parses as a single object; it is one row,
            # not none (the first version dropped it silently).
            rows = rows if isinstance(rows, list) else [rows]
        except ValueError:
            rows = []
            for line in text.splitlines():
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
        for r in rows:
            if not isinstance(r, dict):
                continue
            email = osgraph.email_key(r.get("lead") or r.get("email") or "")
            when = (r.get("reply") or {}).get("time") if isinstance(r.get("reply"), dict) else r.get("reply_time")
            raw_label = clip(r.get("class") or r.get("kind") or "", 60)
            cls = raw_label if raw_label in REPLY_CLASSES else INTENT_CLASS.get(str(raw_label).lower())
            row_by = clip(r.get("by") or by, 60)
            if email and when and cls:
                out.setdefault((email, _minute(when)), []).append((cls, row_by, raw_label))
            if email and cls in DNC_CLASSES and dnc is not None:
                dnc.append((email, cls, row_by, raw_label))
    return out


def _minute(stamp: str) -> str:
    """Reply times differ in precision between Clay's list and its thread
    (".000Z" vs ".361Z"), so labels join on the minute."""
    return str(stamp or "")[:16]


def campaigns_in(graph: Graph, workspace_id: str) -> dict[str, list[str]]:
    by_name: dict[str, list[str]] = {}
    for row in graph.query(
            "SELECT id, props FROM nodes WHERE type = 'Campaign' AND json_extract(props, '$.workspace_id') = ?",
            (str(workspace_id),)):
        name = json.loads(row["props"]).get("name") or ""
        by_name.setdefault(name, []).append(row["id"])
    return by_name


# ── booking signals in reply threads ─────────────────────────────────────────

# Every pattern below runs on email a stranger wrote, so each one is linear:
# no quantifier nests inside another, every run of "anything" is bounded, and
# the text is cut to MATCH_LIMIT before any of them sees it. Security review
# 2026-10-09: the first version's TAG (<[^>]+>) and BREAK took quadratic time
# on a body of "<" characters, and QUOTE_TEXT scanned 400 characters after
# every "On " (test_booking_patterns_are_linear feeds each a 100k string).
#
# Booking evidence sits at the top of a message; 20,000 characters is several
# screens of email. Guessed, never measured against real threads.
MATCH_LIMIT = 20_000
# Where a quoted earlier message starts in an HTML body. Everything after it
# is history, and history carries "On Tue, Oct 6 at 3:00 PM ... wrote:", which
# has a day and a time in it and would read as a proposal.
QUOTE_HTML = re.compile(r"<div[^<>]{0,300}?(?:gmail_quote|yahoo_quoted|moz-cite-prefix|appendonsend|divRplyFwdMsg)"
                        r"|<blockquote|<hr\b", re.I)
WROTE = re.compile(r"\bwrote:", re.I)
# Leading space is allowed because "<b>From:</b>" and "<p>-----Original" leave
# one once the tags are stripped: on 2026-10-09 all 3 booking signals in
# Zeutara's 79 real replies were Outlook headers ("Sent: Friday, 09 October
# 2026 09:05:05") that slipped past an anchor with no room for it.
QUOTE_TEXT = re.compile(r"^[ \t\xa0]{0,10}-{2,40}[ \t]{0,5}Original Message[ \t]{0,5}-{2,40}"
                        r"|^[ \t\xa0]{0,10}_{5,80}[ \t]{0,5}$"
                        r"|^[ \t\xa0]{0,10}From:[ \t\xa0][^\n]{0,300}\n(?:[^\n]{0,300}\n){0,3}?"
                        r"[ \t\xa0]{0,10}(?:Sent|Date):[ \t\xa0]", re.I | re.M)
TAG = re.compile(r"<[^<>]{0,2000}>")
BREAK = re.compile(r"<[ \t]{0,3}(?:br|/p|/div|/li|/tr)\b[^<>]{0,500}>", re.I)
ICS = re.compile(r"text/calendar|BEGIN:VCALENDAR|\bMETHOD:(?:REQUEST|PUBLISH)\b|\binvite\.ics\b", re.I)
INVITE_SUBJECT = re.compile(r"^[ \t]{0,10}(?:re:[ \t]{0,3})?(?:updated[ \t]{1,3})?invitation:\s", re.I)
ACCEPT_SUBJECT = re.compile(r"^[ \t]{0,10}accepted:\s", re.I)
ACCEPT_BODY = re.compile(r"\bhas accepted\b", re.I)
DECLINE_SUBJECT = re.compile(r"^[ \t]{0,10}(?:declined|tentatively accepted|tentative):\s", re.I)
SCHEDULER = re.compile(r"calendly\.com|\bcal\.com\b|savvycal\.com|meetings\.hubspot\.com|hubspot meetings", re.I)
SCHEDULER_DONE = re.compile(r"\b(?:confirmed|is scheduled|has been scheduled|was scheduled|you are scheduled|"
                            r"you're scheduled|new event:|event scheduled|booking confirmed|meeting booked|"
                            r"has booked|booked a meeting|new meeting)\b", re.I)
OOO = re.compile(r"out of (?:the )?office|automatic reply|auto-?reply|\bOOO\b|away from (?:my|the) (?:desk|office)"
                 r"|on (?:parental |maternity |paternity |medical )?leave|limited access to (?:my )?email", re.I)
DAY = re.compile(r"\b(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b|tomorrow\b|today\b"
                 r"|tonight\b|next week\b"
                 r"|(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)[a-z]{0,6}\.?[ \t]{1,3}\d{1,2}\b"
                 r"|\d{1,2}/\d{1,2}\b)", re.I)
CLOCK = re.compile(r"\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?[ \t]{0,2}(?:am|pm|a\.m\.|p\.m\.)"
                   r"|\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\bnoon\b|\bat[ \t]{1,3}(?:[1-9]|1[0-2])\b", re.I)
PROPOSE = re.compile(r"\?|\b(?:how about|what about|are you (?:free|available)|could we|can we|let me know if"
                     r"|i'?m free|i am free|available\b|would\b[^\n]{0,40}?\bwork\b|does\b[^\n]{0,40}?\bwork\b)",
                     re.I)
CONFIRM = re.compile(r"\b(?:works (?:for me|great|perfectly|well)|that works|confirmed\b"
                     r"|see you (?:then|on|at|tomorrow|monday|tuesday|wednesday|thursday|friday)|talk (?:to you )?then"
                     r"|booked\b|locked in|sent (?:you )?(?:an |the )?invite|invite sent|it'?s a date)", re.I)
SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")


def _cut_on_wrote(text: str) -> str:
    """Cut at the first "On <date>, <name> wrote:", the attribution line every
    mail client puts above a quoted reply. Found from "wrote:" backwards over
    at most two lines and 400 characters, never by scanning after each "On"."""
    for m in WROTE.finditer(text):
        window = text[max(0, m.start() - 400):m.start()]
        window = "\n".join(window.split("\n")[-2:])
        at = window.find("On ")
        if at != -1:
            return text[:m.start() - len(window) + at]
    return text


def message_text(msg: dict) -> str:
    """A thread message as plain text, with any quoted history cut off."""
    body = str(msg.get("email_body") or "")[:MATCH_LIMIT]
    cut = QUOTE_HTML.search(body)
    if cut:
        body = body[:cut.start()]
    body = html.unescape(TAG.sub(" ", BREAK.sub("\n", body)))
    body = _cut_on_wrote(body)
    cut = QUOTE_TEXT.search(body)
    if cut:
        body = body[:cut.start()]
    lines = [ln for ln in body.splitlines() if not ln.lstrip().startswith(">")]
    return CONTROL.sub(" ", "\n".join(lines))


def _attachments(msg: dict) -> str:
    """Attachment names and MIME types, wherever the thread puts them."""
    parts = []
    for k, v in msg.items():
        if any(w in str(k).lower() for w in ("attach", "content_type", "mime", "part")):
            parts.append(json.dumps(v, default=str)[:2000])
    return " ".join(parts)[:MATCH_LIMIT]


def _around(text: str, m: re.Match | None) -> str:
    if m is None:
        return clip(text, BOOKING_SNIPPET)
    start = max(0, m.start() - BOOKING_SNIPPET // 2)
    return clip(text[start:start + BOOKING_SNIPPET], BOOKING_SNIPPET)


def _timed_sentences(text: str):
    """(sentence, proposes, confirms) for each sentence naming a day AND a time."""
    for s in SENTENCE.split(text):
        if DAY.search(s) and CLOCK.search(s):
            yield s, bool(PROPOSE.search(s)), bool(CONFIRM.search(s))


def detect_booking(msg: dict, previous: dict | None = None) -> dict | None:
    """The strongest booking evidence in one thread message, or None.

    {"status": "confirmed"|"proposed", "evidence", "snippet", "confidence"}.
    A specific time in a question is a proposal. A confirmation with no time
    of its own confirms only when the message before it, from the other side,
    proposed one. An out-of-office ("back Monday at 9am") is never a booking."""
    subject = clip(msg.get("subject"), 500)
    text = message_text(msg)
    raw = text + " " + _attachments(msg)
    if DECLINE_SUBJECT.search(subject):
        return None

    def hit(status, evidence, m=None, source=None):
        return {"status": status, "evidence": evidence, "confidence": BOOKING_CONFIDENCE[evidence],
                "snippet": _around(source if source is not None else text, m)}

    m = ACCEPT_SUBJECT.search(subject)
    if m:
        return hit("confirmed", "calendar_accept", None, subject + " " + text)
    m = ACCEPT_BODY.search(text)
    if m:
        return hit("confirmed", "calendar_accept", m)
    if INVITE_SUBJECT.search(subject):
        return hit("confirmed", "calendar_invite", None, subject + " " + text)
    m = ICS.search(raw)
    if m:
        return hit("confirmed", "calendar_invite", None, subject + " " + text)
    sched = SCHEDULER.search(text) or SCHEDULER.search(subject)
    if sched:
        both = subject + " " + text
        done = SCHEDULER_DONE.search(both)
        if done:
            return hit("confirmed", "scheduler_confirmation", done, both)
    if OOO.search(subject) or OOO.search(text):
        return None
    proposal = None
    for s, proposes, confirms in _timed_sentences(text):
        if confirms and not proposes:
            return hit("confirmed", "time_confirmed", None, s)
        proposal = proposal or s
    if proposal is not None:
        return hit("proposed", "time_proposed", None, proposal)
    m = CONFIRM.search(text)
    if m and previous is not None and previous.get("type") != msg.get("type"):
        before = list(_timed_sentences(message_text(previous)))
        if before and not PROPOSE.search(text[max(0, m.start() - 40):m.end() + 40]):
            return hit("confirmed", "time_confirmed_in_reply", None, before[0][0] + " / " + text[m.start():m.end() + 80])
    return None


def thread_bookings(history: list[dict]) -> list[tuple[dict, dict]]:
    """(message, finding) for every lead or our-side message with booking evidence."""
    out = []
    prev = None
    for msg in history:
        if msg.get("type") not in ("REPLY", "SENT"):
            continue
        found = detect_booking(msg, prev)
        if found:
            out.append((msg, found))
        prev = msg
    return out


def client_lead_emails(graph: Graph, client_id_: str) -> set[str]:
    """Every address enrolled in one of this client's campaigns."""
    return {r["email"] for r in graph.query(
        "SELECT json_extract(e.props, '$.email') AS email FROM edges e JOIN edges fc "
        "ON fc.src = e.src AND fc.verb = 'FOR_CLIENT' WHERE e.verb = 'ENROLLED' AND fc.dst = ?",
        (client_id_,)) if r["email"]}


def add_bookings(history, reply_ids, item, person, key, cam, name, workspace_id, cid, own_leads,
                 nodes, edges, report, screen_fn) -> None:
    """Booking signals from one thread, written as Signals of kind
    booking_signal next to the replies that carry them.

    Credited to this client only when the thread is in one of its campaigns
    or the lead is in one: a thread whose lead only another client emailed is
    recorded, marked not credited, and counted nowhere."""
    credited = cam is not None or key in own_leads
    for msg, found in thread_bookings(history):
        when = clip(msg.get("time"), 40)
        before = [rid for t, rid in reply_ids if t <= when]
        evidence_reply = before[-1] if before else reply_ids[0][1]
        flag = screen_fn(found["snippet"])
        sig = node_key("signal", f"clay-inbox:{workspace_id}", "booking", cid, key,
                       msg.get("message_id") or when, found["evidence"])
        nodes[sig] = Node(sig, "Signal", f"Booking {found['status']} with {key} {when[:10]}", {
            "kind": "booking_signal", "client_id": cid, "workspace_id": str(workspace_id), "email": key,
            "status": found["status"], "evidence": found["evidence"], "confidence": found["confidence"],
            "snippet": found["snippet"], "screen_flag": flag, "message_time": when,
            "direction": "lead" if msg.get("type") == "REPLY" else "us",
            "campaign_name": clip(name, 200), "credited": credited,
            "attribution": ("thread in this client's campaign" if cam is not None
                            else "lead is in this client's campaigns" if credited
                            else "not credited: the lead is in none of this client's campaigns"),
            "smartlead_campaign_id": clip(item.get("email_campaign_id"), 40)}, confidence=found["confidence"])
        edges[(sig, "SIGNAL_ON", person.id)] = Edge(sig, "SIGNAL_ON", person.id, {})
        edges[(sig, "EVIDENCE_IN", evidence_reply)] = Edge(sig, "EVIDENCE_IN", evidence_reply, {})
        if not credited:
            report["booking_not_credited"] += 1
        else:
            report["booking_" + found["status"]] += 1


def build_inbox(replies: list, workspace_id: str, graph: Graph, ids: Identities, cfg: dict,
                screen_fn=screened) -> tuple[list[Node], list[Edge], dict]:
    ws_row = graph.node(f"workspace:clay:{workspace_id}") or {}
    categories = (ws_row.get("props") or {}).get("reply_categories") or {}
    client = client_for(cfg, str(workspace_id), ws_row.get("label", ""))
    cid = client_id(client)
    dnc: list = []
    labels = load_labels(client.get("reply_labels") or [], dnc)
    # Campaigns are matched by exact name inside THIS workspace only; a name
    # two campaigns share matches neither.
    by_name = campaigns_in(graph, workspace_id)
    nodes: dict[str, Node] = {}
    edges: dict[tuple, Edge] = {}
    report = {"threads": 0, "replies": 0, "unmatched_campaign": 0, "no_email": 0, "flagged": 0,
              "unscreened": 0, "dnc_labels": 0, "booking_confirmed": 0, "booking_proposed": 0,
              "booking_not_credited": 0}
    own_leads = client_lead_emails(graph, cid)
    for cls in REPLY_CLASSES:
        nodes[f"replyclass:{cls}"] = Node(f"replyclass:{cls}", "ReplyClass", cls)
    for item in replies or []:
        if not isinstance(item, dict):
            continue
        person, key = lead_person(ids, item.get("lead_email") or "", "clay-inbox")
        if person is None:
            report["no_email"] += 1
            continue
        report["threads"] += 1
        nodes.setdefault(person.id, person)
        name = item.get("email_campaign_name") or ""
        matches = by_name.get(name) or []
        cam = matches[0] if len(matches) == 1 else None
        if cam is None:
            report["unmatched_campaign"] += 1
        history = ((item.get("history") or {}).get("history")) or []
        history = sorted((m for m in history if isinstance(m, dict)), key=lambda m: str(m.get("time") or ""))
        reply_msgs = [m for m in history if m.get("type") == "REPLY"]
        reply_ids: list[tuple[str, str]] = []  # (time, reply node id), oldest first
        cat_name = clip(categories.get(str(item.get("lead_category_id")), ""), 80)
        for n, msg in enumerate(reply_msgs):
            when = clip(msg.get("time"), 40)
            later = [m for m in history if str(m.get("time") or "") > when]
            text = msg.get("email_body") or ""
            flag = screen_fn(text)
            report["flagged"] += bool(flag) and flag != UNSCREENED
            report["unscreened"] += flag == UNSCREENED
            rid = node_key("reply", f"clay:{workspace_id}", item.get("email_lead_map_id") or key,
                           msg.get("message_id") or when)
            reply_ids.append((when, rid))
            nodes[rid] = Node(rid, "Reply", f"Reply from {key} {when[:10]}", {
                "lead_email": key, "time": when, "campaign_name": clip(name, 200),
                # The workspace and client the read was made against, so a
                # reply whose campaign name matched nothing still belongs to
                # exactly one client (and still suppresses its sender there).
                "workspace_id": str(workspace_id), "client_id": cid,
                "smartlead_campaign_id": clip(item.get("email_campaign_id"), 40),
                "lead_status": clip(item.get("lead_status"), 40), "subject": clip(msg.get("subject"), 160),
                "snippet": clip(text, SNIPPET), "screen_flag": flag,
                "answered": any(m.get("type") == "SENT" for m in later),
                "forwarded": any(m.get("type") == "FORWARD" for m in later),
                "latest": n == len(reply_msgs) - 1,
                "thread_sent_times": [clip(m.get("time"), 40) for m in history if m.get("type") == "SENT"],
                "clay_category": cat_name if n == len(reply_msgs) - 1 else "",
            })
            report["replies"] += 1
            edges[(person.id, "REPLIED", rid)] = Edge(person.id, "REPLIED", rid, {"time": when})
            if cam:
                edges[(rid, "IN_CAMPAIGN", cam)] = Edge(rid, "IN_CAMPAIGN", cam, {})
            verdicts = list(labels.get((key, _minute(when)), []))
            if n == len(reply_msgs) - 1 and cat_name:
                cls = CLAY_CATEGORY_CLASS.get(cat_name.lower(), "neutral")
                verdicts.append((cls, "clay", cat_name))
            for cls, by, raw_label in verdicts:
                k = (rid, "CLASSIFIED_AS", f"replyclass:{cls}")
                e = edges.get(k) or Edge(rid, "CLASSIFIED_AS", f"replyclass:{cls}", {"by": [], "raw": []})
                if by not in e.props["by"]:
                    e.props["by"].append(by)
                    e.props["raw"].append(raw_label)
                edges[k] = e
        if reply_ids:
            add_bookings(history, reply_ids, item, person, key, cam, name, workspace_id, cid, own_leads,
                         nodes, edges, report, screen_fn)
    for email, cls, by, raw_label in dnc:
        person, key = lead_person(ids, email, "gtm-labels")
        if person is None:
            continue
        nodes.setdefault(person.id, person)
        reason = f"labelled {raw_label or cls} by {by}"
        sig = node_key("signal", f"clay-inbox:{workspace_id}", cid, key, reason)
        nodes[sig] = Node(sig, "Signal", f"Do not contact {key}", {
            "kind": "do_not_contact", "client_id": cid, "email": key, "domain": "", "reason": reason})
        edges[(sig, "SIGNAL_ON", person.id)] = Edge(sig, "SIGNAL_ON", person.id, {})
        report["dnc_labels"] += 1
    return list(nodes.values()), list(edges.values()), report


def calendar_window(today: date, back: int = CALENDAR_BACK_DAYS, ahead: int = CALENDAR_AHEAD_DAYS) -> tuple[str, str]:
    return (today - timedelta(days=back)).isoformat(), (today + timedelta(days=ahead)).isoformat()


def _attendees(raw) -> list[dict]:
    out = []
    for a in raw or []:
        if isinstance(a, dict):
            email = a.get("email") or a.get("address") or a.get("url") or ""
            response = a.get("responseStatus") or a.get("status") or a.get("participantStatus") or ""
        else:
            email, response = a, ""
        email = str(email or "").strip()
        if email.lower().startswith("mailto:"):
            email = email[7:]
        out.append({"email": email, "response": clip(str(response).lower(), 30)})
    return out


def normalize_mac(ev: dict) -> dict:
    """A `mac calendar list` event in the shape both readers share. EventKit's
    external identifier is the iCalendar UID for a synced Google event, which
    is what lets the union drop the copy Google already gave."""
    uid = (ev.get("externalId") or ev.get("externalIdentifier") or ev.get("calendarItemExternalIdentifier")
           or ev.get("iCalUID") or ev.get("uid") or "")
    return {"reader": "mac", "id": str(ev.get("id") or ev.get("eventIdentifier") or ""), "uid": str(uid),
            "title": clip(ev.get("title"), 160), "start": str(ev.get("start") or ev.get("startDate") or ""),
            "end": str(ev.get("end") or ev.get("endDate") or ""), "calendar": clip(ev.get("calendar"), 80),
            "status": str(ev.get("status") or "").lower(), "attendees": _attendees(ev.get("attendees"))}


def normalize_google(ev: dict, calendar: str) -> dict:
    start, end = ev.get("start") or {}, ev.get("end") or {}
    return {"reader": "google", "id": str(ev.get("id") or ""), "uid": str(ev.get("iCalUID") or ""),
            "title": clip(ev.get("summary"), 160),
            "start": str(start.get("dateTime") or start.get("date") or ""),
            "end": str(end.get("dateTime") or end.get("date") or ""), "calendar": clip(calendar, 80),
            "status": str(ev.get("status") or "").lower(), "attendees": _attendees(ev.get("attendees"))}


def fetch_calendar(runner=None, today: date | None = None) -> list[dict]:
    """`mac calendar list`, which needs the Calendars privacy grant for the
    process that runs it. Without it mac answers permissionDenied."""
    runner = runner or _subprocess_runner
    start, end = calendar_window(today or date.today())
    code, out, err = runner(["mac", "calendar", "list", "--from", start, "--to", end, "--json"])
    try:
        body = json.loads(out or err or "null")
    except ValueError:
        body = None
    if isinstance(body, dict) and body.get("error"):
        raise SourceUnavailable(f"calendar (mac): {clip(body['error'].get('message'), 200)}")
    if code != 0 or not isinstance(body, list):
        raise SourceUnavailable(f"calendar (mac): mac exited {code}: {clip(err or out, 200)}")
    return [normalize_mac(e) for e in body if isinstance(e, dict)]


def fetch_google_calendar(gws: GwsCLI | None = None, today: date | None = None) -> list[dict]:
    """Every event in the window on every calendar the signed-in Google account
    can read, through gws. One calendar failing fails the read: a union missing
    a calendar would drop its meetings from the snapshot."""
    gws = gws or GwsCLI()
    start, end = calendar_window(today or date.today())
    calendars = gws.paged(["calendar", "calendarList", "list"], {"maxResults": 250})
    out = []
    for cal in calendars:
        if not isinstance(cal, dict) or cal.get("accessRole") not in GOOGLE_ROLES:
            continue
        cal_id = cal.get("id")
        if not isinstance(cal_id, str) or not cal_id or len(cal_id) > 512:
            continue
        events = gws.paged(["calendar", "events", "list"], {
            "calendarId": cal_id, "timeMin": f"{start}T00:00:00Z", "timeMax": f"{end}T00:00:00Z",
            "singleEvents": True, "showDeleted": False, "maxResults": GOOGLE_PAGE})
        out.extend(normalize_google(e, cal.get("summary") or cal_id) for e in events if isinstance(e, dict))
    return out


def start_instant(stamp: str) -> str:
    """A start time as a UTC minute, or the bare date of an all-day event, so
    the two readers' spellings of one moment compare equal."""
    stamp = str(stamp or "").strip()
    try:
        when = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return stamp[:16]
    if len(stamp) <= 10:
        return stamp
    if when.tzinfo is not None:
        when = when.astimezone(timezone.utc)
    return when.strftime("%Y-%m-%dT%H:%M")


def merge_events(*lists: list[dict]) -> list[dict]:
    """The union of every reader's events, one per real event. Two copies are
    one event when they share an iCalUID and start (a recurring series shares
    its UID across instances, so the start is part of the key), or, when a
    copy carries no UID, the same title at the same start."""
    merged: list[dict] = []
    index: dict[tuple, dict] = {}
    for events in lists:
        for ev in events:
            instant = start_instant(ev.get("start"))
            keys = [("title", (ev.get("title") or "").strip().lower(), instant)]
            if ev.get("uid"):
                keys.insert(0, ("uid", ev["uid"], instant))
            same = next((index[k] for k in keys if k in index), None)
            if same is None:
                same = dict(ev, readers=[], calendars=[], ids=[])
                same["attendees"] = list(ev.get("attendees") or [])
                merged.append(same)
            else:
                seen = {a["email"].lower() for a in same["attendees"]}
                same["attendees"] += [a for a in ev.get("attendees") or [] if a["email"].lower() not in seen]
                same["uid"] = same.get("uid") or ev.get("uid") or ""
            for field, value in (("readers", ev.get("reader")), ("calendars", ev.get("calendar")), ("ids", ev.get("id"))):
                if value and value not in same[field]:
                    same[field].append(value)
            for k in keys + ([("uid", same["uid"], instant)] if same.get("uid") else []):
                index.setdefault(k, same)
    return merged


def read_calendars(readers: dict) -> tuple[list[dict], dict]:
    """Run every calendar reader. Returns (events, {reader: None | failure})."""
    got, status = {}, {}
    for name, fn in readers.items():
        try:
            events = fn()
            if not isinstance(events, list):
                raise SourceUnavailable(f"calendar ({name}): the reader did not return a list of events")
            # A reader that hands back raw events (a test, or a future
            # reader) is shaped like mac's; normalized ones keep their shape.
            got[name] = [dict(e if "reader" in e else normalize_mac(e), reader=e.get("reader") or name)
                         for e in events if isinstance(e, dict)]
            status[name] = None
        except Exception as err:  # noqa: BLE001  recorded per reader, never swallowed
            status[name] = _failed(err)
    return merge_events(*got.values()), status


def lead_index(graph: Graph) -> dict[str, list[tuple[str, str, str | None, str]]]:
    """email key -> [(person id, campaign id, last_sent_at, client id)] for every lead."""
    out: dict[str, list] = {}
    for row in graph.query(
            "SELECT e.src, e.dst, json_extract(e.props, '$.email') AS email, "
            "json_extract(e.props, '$.last_sent_at') AS last, fc.dst AS client FROM edges e "
            "LEFT JOIN edges fc ON fc.src = e.src AND fc.verb = 'FOR_CLIENT' WHERE e.verb = 'ENROLLED'"):
        if row["email"]:
            out.setdefault(row["email"], []).append((row["dst"], row["src"], row["last"], row["client"] or ""))
    return out


def build_calendar(events: list[dict], graph: Graph) -> tuple[list[Node], list[Edge], dict]:
    leads = lead_index(graph)
    nodes: dict[str, Node] = {}
    edges: dict[tuple, Edge] = {}
    report = {"events": len(events), "meetings": 0, "ambiguous_client": 0, "declined_or_cancelled": 0}
    for ev in events:
        if "reader" in ev and "readers" not in ev:
            ev = merge_events([ev])[0]
        elif "readers" not in ev:  # a raw event handed straight in
            ev = merge_events([normalize_mac(ev)])[0]
        attendees = []
        for a in ev.get("attendees") or []:
            raw = a["email"]
            if raw.isprintable():
                key = osgraph.email_key(raw)
                # A lead who declined did not book a meeting.
                if key in leads and a.get("response") != "declined":
                    attendees.append(key)
        if not attendees:
            continue
        if ev.get("status") == "cancelled":
            report["declined_or_cancelled"] += 1
            continue
        start = ev.get("start") or ""
        mid = node_key("meeting", "calendar", ev.get("uid") or (ev.get("ids") or [""])[0] or ev.get("title") or "",
                       start_instant(start))
        nodes[mid] = Node(mid, "Meeting", ev.get("title") or "Meeting", {
            "start": start, "end": ev.get("end") or "", "calendar": ", ".join(ev.get("calendars") or []),
            "readers": sorted(ev.get("readers") or []), "uid": clip(ev.get("uid"), 200),
            "attendee_emails": sorted(set(attendees))})
        report["meetings"] += 1
        # Attributed to a campaign only when that campaign emailed this person
        # on or before the meeting's day, and only when every such campaign
        # belongs to ONE client. A meeting with someone two clients both
        # emailed is booked from neither: the first version credited it to
        # both, so one client's meeting showed in another's funnel.
        booked = []
        for key in sorted(set(attendees)):
            for pid, cam, last, owner in leads[key]:
                edges[(mid, "MEETING_WITH", pid)] = Edge(mid, "MEETING_WITH", pid, {"email": key})
                if last and start and last <= start[:10]:
                    booked.append((cam, last, owner))
        if len({owner for _, _, owner in booked}) > 1:
            report["ambiguous_client"] += 1
            nodes[mid].props["attribution"] = "ambiguous: emailed by more than one client"
            booked = []
        for cam, last, _ in booked:
            edges[(mid, "BOOKED_FROM", cam)] = Edge(mid, "BOOKED_FROM", cam,
                                                    {"attribution": "emailed on or before the meeting day",
                                                     "last_sent_at": last})
    return list(nodes.values()), list(edges.values()), report


def readers_in_snapshot(graph: Graph) -> dict[str, int]:
    """reader -> how many stored meetings it supplied last time."""
    out: dict[str, int] = {}
    for row in graph.query("SELECT props FROM nodes WHERE source = 'gtm-calendar' AND type = 'Meeting'"):
        for r in json.loads(row["props"] or "{}").get("readers") or ["mac"]:
            out[r] = out.get(r, 0) + 1
    return out


def sync_calendar(graph: Graph, readers: dict) -> dict:
    """Read every calendar, record each reader on its own row, and apply the
    union. Refused, keeping the previous snapshot, when every reader failed
    or when a reader that supplied stored meetings failed now: applying the
    others alone would delete that reader's meetings."""
    events, status = read_calendars(readers)
    for name, failure in status.items():
        n = sum(1 for e in events if name in (e.get("readers") or []))
        record_sync(graph, f"gtm-calendar:{name}", "calendar", failure is None, failure or "", {"events": n})
    failed = {n: f for n, f in status.items() if f}
    if len(failed) == len(status):
        raise SourceUnavailable("calendar: every reader failed: " + "; ".join(failed.values()))
    before = readers_in_snapshot(graph)
    lost = [n for n in failed if before.get(n)]
    if lost:
        raise SourceUnavailable(f"calendar: {', '.join(lost)} could not be read and the last snapshot has "
                                f"{sum(before[n] for n in lost)} meetings from it; keeping the previous snapshot")
    refuse_empty(graph, "gtm-calendar", "Meeting", len(events), "the calendar")
    nodes, edges, report = build_calendar(events, graph)
    graph.apply("gtm-calendar", nodes, edges)
    report["readers"] = {n: ("ok" if f is None else "FAILED") for n, f in status.items()}
    return report


# ── sync bookkeeping ─────────────────────────────────────────────────────────

GTM_SCHEMA = """
CREATE TABLE IF NOT EXISTS gtm_sync (
  source TEXT PRIMARY KEY, kind TEXT NOT NULL, workspace TEXT, client TEXT,
  ran_at TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT, report TEXT
);
CREATE TABLE IF NOT EXISTS gtm_suppressed (
  client TEXT NOT NULL, address TEXT NOT NULL, reason TEXT NOT NULL,
  last_sent TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (client, address, reason)
);
CREATE INDEX IF NOT EXISTS edges_enrolled_email ON edges (json_extract(props, '$.email')) WHERE verb = 'ENROLLED';
CREATE INDEX IF NOT EXISTS edges_enrolled_name ON edges (lower(json_extract(props, '$.name'))) WHERE verb = 'ENROLLED';
CREATE INDEX IF NOT EXISTS nodes_reply_email ON nodes (json_extract(props, '$.lead_email')) WHERE type = 'Reply';
CREATE INDEX IF NOT EXISTS nodes_reply_workspace ON nodes (json_extract(props, '$.workspace_id')) WHERE type = 'Reply';
"""


def ensure_schema(graph: Graph) -> None:
    with graph.lock, graph.db:
        graph.db.executescript(GTM_SCHEMA)


def record_sync(graph: Graph, source: str, kind: str, ok: bool, note: str, report: dict,
                workspace: str = "", client: str = "") -> None:
    ensure_schema(graph)
    with graph.lock, graph.db:
        graph.db.execute(
            "INSERT OR REPLACE INTO gtm_sync (source, kind, workspace, client, ran_at, ok, note, report) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (source, kind, workspace, client, utc_now(), int(ok), note, json.dumps(report, default=str)))


def remember_suppressions(graph: Graph, client: str) -> int:
    """Copy every address the live graph says this client must never email
    again into gtm_suppressed, which no snapshot ever deletes from.

    Snapshots replace: a campaign deleted in Clay takes its ENROLLED edges,
    and with them the proof those people were emailed, out of the graph. A
    suppression list rebuilt only from the live graph would then hand them
    back as fresh leads. The ledger keeps them."""
    import gtm_query  # read-side helpers; the query side never imports this module
    stamp = utc_now()
    with graph.lock:
        live = gtm_query.live_suppressions(graph.db, client)
        with graph.db:
            for address, row in live.items():
                for reason in row["reasons"]:
                    graph.db.execute(
                        "INSERT INTO gtm_suppressed (client, address, reason, last_sent, first_seen, last_seen) "
                        "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(client, address, reason) DO UPDATE SET "
                        "last_seen = excluded.last_seen, "
                        "last_sent = MAX(COALESCE(gtm_suppressed.last_sent, ''), COALESCE(excluded.last_sent, ''))",
                        (client, address, reason, row["last_sent"], stamp, stamp))
    return len(live)


def previous_count(graph: Graph, source: str, node_type: str) -> int:
    return graph.query("SELECT COUNT(*) AS n FROM nodes WHERE source = ? AND type = ?",
                       (source, node_type))[0]["n"]


def refuse_empty(graph: Graph, source: str, node_type: str, got: int, what: str) -> None:
    """An empty answer where the last good sync had data is a failed read,
    not a cleared inbox: the first version applied it, which replaced every
    stored reply with nothing and unsuppressed everyone who had replied."""
    had = previous_count(graph, source, node_type)
    if got == 0 and had:
        raise SourceUnavailable(f"{what} came back empty where the last sync had {had}; "
                                "keeping the previous snapshot")


def workspaces_to_sync(cfg: dict, cli: ClayCLI) -> list[str]:
    configured = [w for c in cfg.get("clients") or [] for w in client_workspaces(c)]
    if configured:
        return list(dict.fromkeys(configured))
    rows = cli.run(["workspaces", "list"]).get("data")
    if not isinstance(rows, list):
        raise SourceUnavailable("clay workspaces list returned no 'data' list")
    return [str(w["id"]) for w in rows if isinstance(w, dict) and w.get("id") and w.get("active", True)]


def _failed(err: BaseException) -> str:
    """What a failed source records. A SourceUnavailable already says what
    happened; anything else is a bug and says so, by type, so a KeyError on
    a malformed answer never reads as a clean sync."""
    if isinstance(err, (SourceUnavailable, ConfigError, osgraph.OntologyError)):
        return clip(str(err), 400)
    return clip(f"FAILED with {type(err).__name__}: {err}", 400)


def default_calendar_readers() -> dict:
    return {"google": fetch_google_calendar, "mac": fetch_calendar}


def sync(graph: Graph, sources: list[str], cfg: dict | None = None, ids: Identities | None = None,
         cli: ClayCLI | None = None, inbox_fn=None, calendar_fn=None, log=print,
         calendar_readers: dict | None = None) -> list[dict]:
    """Run the named ingesters. Each one that cannot read its source, or that
    fails for ANY reason, records FAILED with the reason and leaves its
    previous snapshot in place. The first version caught only the expected
    errors, so a KeyError aborted the run with the last row still saying ok.

    The calendar reads every reader in `calendar_readers` (default: Google
    through gws, then mac). `calendar_fn` alone is the mac reader by itself,
    which is how the hermetic tests hand in a list of events."""
    ensure_schema(graph)
    results = []
    try:
        cfg = cfg if cfg is not None else load_config()
        validate_config(cfg)
        ids = ids or Identities()
        cli = cli or ClayCLI()
        spaces = workspaces_to_sync(cfg, cli) if {"clay", "inbox"} & set(sources) else []
    except Exception as err:  # noqa: BLE001  recorded, never swallowed
        note = _failed(err)
        for kind in sources:
            record_sync(graph, f"gtm-{kind}:config", kind, False, note, {})
            results.append({"source": f"gtm-{kind}", "ok": False, "note": note})
        return results
    for ws in spaces:
        if "clay" in sources:
            source = f"gtm-clay:{ws}"
            try:
                raw = fetch_clay(cli, ws)
                refuse_empty(graph, source, "Campaign", len(raw.get("campaigns") or []), "clay campaigns list")
                nodes, edges, report = build_clay(raw, cfg, ids)
                graph.apply(source, nodes, edges)
                report["suppressed"] = remember_suppressions(graph, client_id(client_for(cfg, ws, "")))
                record_sync(graph, source, "clay", True, "", report, ws, report["client"])
                results.append({"source": source, "ok": True, **report})
            except Exception as err:  # noqa: BLE001  recorded, never swallowed
                record_sync(graph, source, "clay", False, _failed(err), {}, ws)
                results.append({"source": source, "ok": False, "note": _failed(err)})
        if "inbox" in sources:
            source = f"gtm-inbox:{ws}"
            try:
                client = client_for(cfg, ws, "")
                replies = (inbox_fn or (lambda w: fetch_inbox(w, profile=client.get("chrome_profile"))))(ws)
                if not isinstance(replies, list):
                    raise SourceUnavailable("inbox: the reader did not return a list of replies")
                refuse_empty(graph, source, "Reply", len(replies), "the Clay inbox")
                nodes, edges, report = build_inbox(replies, ws, graph, ids, cfg)
                graph.apply(source, nodes, edges)
                report["suppressed"] = remember_suppressions(graph, client_id(client))
                record_sync(graph, source, "inbox", True, "", report, ws)
                results.append({"source": source, "ok": True, **report})
            except Exception as err:  # noqa: BLE001  recorded, never swallowed
                record_sync(graph, source, "inbox", False, _failed(err), {}, ws)
                results.append({"source": source, "ok": False, "note": _failed(err)})
    if "calendar" in sources:
        source = "gtm-calendar"
        try:
            readers = calendar_readers or ({"mac": calendar_fn} if calendar_fn else default_calendar_readers())
            report = sync_calendar(graph, readers)
            record_sync(graph, source, "calendar", True, "", report)
            results.append({"source": source, "ok": True, **report})
        except Exception as err:  # noqa: BLE001  recorded, never swallowed
            record_sync(graph, source, "calendar", False, _failed(err), {})
            results.append({"source": source, "ok": False, "note": _failed(err)})
    return results


def fetch_inbox(workspace_id: str, runner=None, profile: str | None = None) -> list:
    """bin/clay-inbox, which reads Clay's sequencer inbox from inside the
    signed-in Chrome tab. Anything short of a JSON list is unavailable.

    The workspace is always passed (clay-inbox's own default is one client's
    workspace), and so is the client's `chrome_profile` when configured, so a
    read never falls back to whichever profile the environment names."""
    runner = runner or _subprocess_runner
    if not SAFE_ID.match(str(workspace_id)):
        raise SourceUnavailable(f"inbox: {clip(workspace_id, 40)!r} is not a workspace id")
    tool = str(ROOT / "bin" / "clay-inbox")
    argv = [sys.executable, tool, "--workspace", str(workspace_id)]
    if profile:
        argv += ["--profile", str(profile)]
    code, out, err = runner(argv)
    if code != 0:
        raise SourceUnavailable(f"inbox: clay-inbox could not read the signed-in Clay tab: {clip(err or out, 240)}")
    try:
        body = json.loads(out)
    except ValueError as e:
        raise SourceUnavailable("inbox: clay-inbox printed non-JSON") from e
    if not isinstance(body, list):
        raise SourceUnavailable("inbox: clay-inbox did not return a list of replies")
    return body
