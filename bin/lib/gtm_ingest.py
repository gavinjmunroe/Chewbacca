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
  gtm-calendar            `mac calendar list --json`, matched to leads by
                          attendee email only

READ ONLY. `ClayCLI` refuses any clay command outside READ_ONLY, so nothing here
can send, run a column, spend credits, add leads or change a campaign. Reply text
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

import json
import os
import re
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
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁦-⁩]")


class ReadOnlyViolation(RuntimeError):
    pass


class SourceUnavailable(RuntimeError):
    """The source could not be read. The sync records it and writes nothing."""


def config_path() -> Path:
    return Path(os.environ.get("GTM_CONFIG") or Path.home() / ".chewbacca" / "gtm" / "clients.json")


def load_config(path: Path | None = None) -> dict:
    path = path or config_path()
    try:
        body = json.loads(path.read_text())
    except (OSError, ValueError):
        return {"clients": []}
    return body if isinstance(body, dict) else {"clients": []}


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-") or "unnamed"


def clip(text, limit: int) -> str:
    text = CONTROL.sub(" ", str(text or ""))
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── the clay CLI, read only ──────────────────────────────────────────────────


def allowed(args: list[str]) -> bool:
    return any(tuple(args[:len(p)]) == p for p in READ_ONLY)


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

    def run(self, args: list[str]) -> dict:
        if not allowed(args):
            raise ReadOnlyViolation(f"clay {' '.join(args[:3])} is not a read this module may run")
        wait = 2.0
        for _ in range(MAX_TRIES):
            self.calls += 1
            code, out, err = self.runner([self.binary, *args])
            if code == 0:
                try:
                    body = json.loads(out or "{}")
                except ValueError as e:
                    raise SourceUnavailable(f"clay {args[0]} {args[1]} printed non-JSON") from e
                ws = body.get("workspace") if isinstance(body, dict) else None
                if isinstance(ws, dict) and ws.get("id"):
                    self.workspace = {"id": str(ws["id"]), "name": ws.get("name") or ""}
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
            out.extend(body.get(key) or [])
            cursor = body.get("cursor")
            if not cursor:
                return out
        raise SourceUnavailable(f"clay {' '.join(args[:3])} never stopped paging")

    def ids(self, query: str) -> list[int]:
        return [int(i) for i in self.paged(
            ["audiences", "records", "search-ids", "--query", query, "--limit", str(PAGE)])]


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
    under client B is the failure this prevents)."""
    campaigns = cli.paged(["campaigns", "list", "--with-analytics", "--limit", "100"])
    signed_in = (cli.workspace or {}).get("id")
    if signed_in and str(signed_in) != str(workspace_id):
        raise SourceUnavailable(f"clay is signed in to workspace {signed_in}, not {workspace_id}")

    def analytics(c):
        return c["id"], cli.run(["campaigns", "analytics", c["id"]])

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
        for d in (stats[cid].get("stats") or {}).get("daily") or []:
            if d.get("sent"):
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

    wanted = sorted({i for a in activity.values() for k, v in a.items()
                     for i in (sum(v.values(), []) if k == "sent" else v)})
    batches = [wanted[i:i + RECORD_BATCH] for i in range(0, len(wanted), RECORD_BATCH)]

    def records(batch):
        return cli.run(["audiences", "records", "get", "--entity-type", "people",
                        "--ids", ",".join(map(str, batch))]).get("data") or []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        people = {str(r["recordId"]): r.get("fields") or {} for rows in pool.map(records, batches) for r in rows}

    tables = cli.paged(["tables", "list", "--limit", "100"])
    audiences = cli.paged(["audiences", "list", "--entity-type", "people"])
    return {"workspace": cli.workspace or {"id": str(workspace_id), "name": ""},
            "campaigns": campaigns, "analytics": stats, "activity": activity,
            "records": people, "tables": tables, "audiences": audiences,
            "fetched_at": utc_now(), "calls": cli.calls}


# ── building snapshots ───────────────────────────────────────────────────────


def client_for(cfg: dict, workspace_id: str, workspace_name: str) -> dict:
    for c in cfg.get("clients") or []:
        spaces = [str(w) for w in (c.get("workspaces") or [c.get("workspace")]) if w]
        if str(workspace_id) in spaces:
            return c
    return {"name": workspace_name or f"Workspace {workspace_id}", "workspaces": [str(workspace_id)]}


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
    return raw


def client_id(client: dict) -> str:
    return f"client:{slug(client['name'])}"


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

    ws_node = add(Node(f"workspace:clay:{ws_id}", "Workspace", ws.get("name") or ws_id,
                       {"platform": "clay", "workspace_id": ws_id}))
    add(Node(cid, "Client", client["name"], {"principal": client.get("principal", ""),
                                             "workspaces": client.get("workspaces") or [ws_id]}))
    link(cid, "OWNS", ws_node)
    categories: dict[str, str] = {}
    for o in client.get("offers") or []:
        oid = add(Node(f"offer:{slug(client['name'])}:{slug(o['name'])}", "Offer", o["name"], {}))
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
            oid = add(Node(f"offer:{slug(client['name'])}:{slug(offer)}", "Offer", offer, {}))
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
    stays out of a sync."""
    try:
        import screen  # bin/lib/screen.py
    except Exception:
        return None
    hit = screen.pattern_hit(text or "")
    return hit.group(0) if hit else None


def load_labels(paths: list[dict]) -> dict[tuple[str, str], list[tuple[str, str, str]]]:
    """(lead email, reply time) -> [(class, by, raw label)] from label files.

    Two shapes are read: zeutara-gtme's classified.json (`lead`, `kind`,
    `reply.time`, labelled by togari reply-intent), and a JSONL a person
    writes ({"email", "reply_time", "class", "by"}) for a human verdict like
    Jonah's good fit / not a fit."""
    out: dict[tuple[str, str], list] = {}
    for spec in paths or []:
        path = Path(os.path.expanduser(spec.get("path", "")))
        by = spec.get("by") or "model"
        try:
            text = path.read_text()
        except OSError:
            continue
        try:
            rows = json.loads(text)
            rows = rows if isinstance(rows, list) else []
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
            raw_label = r.get("class") or r.get("kind") or ""
            cls = raw_label if raw_label in REPLY_CLASSES else INTENT_CLASS.get(str(raw_label).lower())
            if email and when and cls:
                out.setdefault((email, _minute(when)), []).append((cls, r.get("by") or by, str(raw_label)))
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


def build_inbox(replies: list, workspace_id: str, graph: Graph, ids: Identities, cfg: dict,
                screen_fn=screened) -> tuple[list[Node], list[Edge], dict]:
    ws_row = graph.node(f"workspace:clay:{workspace_id}") or {}
    categories = (ws_row.get("props") or {}).get("reply_categories") or {}
    client = client_for(cfg, str(workspace_id), ws_row.get("label", ""))
    labels = load_labels(client.get("reply_labels") or [])
    by_name = campaigns_in(graph, workspace_id)
    nodes: dict[str, Node] = {}
    edges: dict[tuple, Edge] = {}
    report = {"threads": 0, "replies": 0, "unmatched_campaign": 0, "no_email": 0, "flagged": 0}
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
        cat_name = categories.get(str(item.get("lead_category_id")), "")
        for n, msg in enumerate(reply_msgs):
            when = str(msg.get("time") or "")
            later = [m for m in history if str(m.get("time") or "") > when]
            text = msg.get("email_body") or ""
            flag = screen_fn(text)
            report["flagged"] += bool(flag)
            rid = node_key("reply", f"clay:{workspace_id}", item.get("email_lead_map_id") or key,
                           msg.get("message_id") or when)
            nodes[rid] = Node(rid, "Reply", f"Reply from {key} {when[:10]}", {
                "lead_email": key, "time": when, "campaign_name": clip(name, 200),
                "smartlead_campaign_id": item.get("email_campaign_id"),
                "lead_status": item.get("lead_status"), "subject": clip(msg.get("subject"), 160),
                "snippet": clip(text, SNIPPET), "screen_flag": flag,
                "answered": any(m.get("type") == "SENT" for m in later),
                "forwarded": any(m.get("type") == "FORWARD" for m in later),
                "latest": n == len(reply_msgs) - 1,
                "thread_sent_times": [m.get("time") for m in history if m.get("type") == "SENT"],
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
    return list(nodes.values()), list(edges.values()), report


def calendar_window(today: date, back: int = 120, ahead: int = 60) -> tuple[str, str]:
    return (today - timedelta(days=back)).isoformat(), (today + timedelta(days=ahead)).isoformat()


def fetch_calendar(runner=None, today: date | None = None) -> list[dict]:
    runner = runner or _subprocess_runner
    start, end = calendar_window(today or date.today())
    code, out, err = runner(["mac", "calendar", "list", "--from", start, "--to", end, "--json"])
    try:
        body = json.loads(out or err or "null")
    except ValueError:
        body = None
    if isinstance(body, dict) and body.get("error"):
        raise SourceUnavailable(f"calendar: {clip(body['error'].get('message'), 200)}")
    if code != 0 or not isinstance(body, list):
        raise SourceUnavailable(f"calendar: mac exited {code}: {clip(err or out, 200)}")
    return [e for e in body if isinstance(e, dict)]


def lead_index(graph: Graph) -> dict[str, list[tuple[str, str, str | None]]]:
    """email key -> [(person id, campaign id, last_sent_at)] for every lead."""
    out: dict[str, list] = {}
    for row in graph.query(
            "SELECT src, dst, json_extract(props, '$.email') AS email, "
            "json_extract(props, '$.last_sent_at') AS last FROM edges WHERE verb = 'ENROLLED'"):
        if row["email"]:
            out.setdefault(row["email"], []).append((row["dst"], row["src"], row["last"]))
    return out


def build_calendar(events: list[dict], graph: Graph) -> tuple[list[Node], list[Edge], dict]:
    leads = lead_index(graph)
    nodes: dict[str, Node] = {}
    edges: dict[tuple, Edge] = {}
    report = {"events": len(events), "meetings": 0}
    for ev in events:
        attendees = []
        for a in ev.get("attendees") or []:
            raw = str((a.get("email") if isinstance(a, dict) else a) or "").strip()
            if raw.lower().startswith("mailto:"):
                raw = raw[7:]
            if raw.isprintable():
                key = osgraph.email_key(raw)
                if key in leads:
                    attendees.append(key)
        if not attendees:
            continue
        start = str(ev.get("start") or ev.get("startDate") or "")
        mid = node_key("meeting", "calendar", ev.get("id") or ev.get("eventIdentifier") or "", ev.get("title") or "", start)
        nodes[mid] = Node(mid, "Meeting", clip(ev.get("title"), 160) or "Meeting", {
            "start": start, "end": str(ev.get("end") or ev.get("endDate") or ""),
            "calendar": clip(ev.get("calendar"), 80), "attendee_emails": sorted(set(attendees))})
        report["meetings"] += 1
        for key in sorted(set(attendees)):
            for pid, cam, last in leads[key]:
                edges[(mid, "MEETING_WITH", pid)] = Edge(mid, "MEETING_WITH", pid, {"email": key})
                # Attributed to a campaign only when that campaign emailed this
                # person on or before the meeting's day.
                if last and start and last <= start[:10]:
                    edges[(mid, "BOOKED_FROM", cam)] = Edge(mid, "BOOKED_FROM", cam,
                                                            {"attribution": "emailed on or before the meeting day",
                                                             "last_sent_at": last})
    return list(nodes.values()), list(edges.values()), report


# ── sync bookkeeping ─────────────────────────────────────────────────────────

GTM_SCHEMA = """
CREATE TABLE IF NOT EXISTS gtm_sync (
  source TEXT PRIMARY KEY, kind TEXT NOT NULL, workspace TEXT, client TEXT,
  ran_at TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT, report TEXT
);
CREATE INDEX IF NOT EXISTS edges_enrolled_email ON edges (json_extract(props, '$.email')) WHERE verb = 'ENROLLED';
CREATE INDEX IF NOT EXISTS edges_enrolled_name ON edges (lower(json_extract(props, '$.name'))) WHERE verb = 'ENROLLED';
CREATE INDEX IF NOT EXISTS nodes_reply_email ON nodes (json_extract(props, '$.lead_email')) WHERE type = 'Reply';
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


def workspaces_to_sync(cfg: dict, cli: ClayCLI) -> list[str]:
    configured = [str(w) for c in cfg.get("clients") or [] for w in (c.get("workspaces") or [c.get("workspace")]) if w]
    if configured:
        return list(dict.fromkeys(configured))
    return [str(w["id"]) for w in cli.run(["workspaces", "list"]).get("data") or [] if w.get("active", True)]


def sync(graph: Graph, sources: list[str], cfg: dict | None = None, ids: Identities | None = None,
         cli: ClayCLI | None = None, inbox_fn=None, calendar_fn=None, log=print) -> list[dict]:
    """Run the named ingesters. Each one that cannot read its source records
    the reason and leaves its previous snapshot in place."""
    cfg = cfg if cfg is not None else load_config()
    ids = ids or Identities()
    cli = cli or ClayCLI()
    ensure_schema(graph)
    results = []
    spaces = workspaces_to_sync(cfg, cli) if {"clay", "inbox"} & set(sources) else []
    for ws in spaces:
        if "clay" in sources:
            source = f"gtm-clay:{ws}"
            try:
                raw = fetch_clay(cli, ws)
                nodes, edges, report = build_clay(raw, cfg, ids)
                graph.apply(source, nodes, edges)
                record_sync(graph, source, "clay", True, "", report, ws, report["client"])
                results.append({"source": source, "ok": True, **report})
            except (SourceUnavailable, osgraph.OntologyError) as err:
                record_sync(graph, source, "clay", False, str(err), {}, ws)
                results.append({"source": source, "ok": False, "note": str(err)})
        if "inbox" in sources:
            source = f"gtm-inbox:{ws}"
            try:
                replies = (inbox_fn or fetch_inbox)(ws)
                nodes, edges, report = build_inbox(replies, ws, graph, ids, cfg)
                graph.apply(source, nodes, edges)
                record_sync(graph, source, "inbox", True, "", report, ws)
                results.append({"source": source, "ok": True, **report})
            except (SourceUnavailable, osgraph.OntologyError) as err:
                record_sync(graph, source, "inbox", False, str(err), {}, ws)
                results.append({"source": source, "ok": False, "note": str(err)})
    if "calendar" in sources:
        source = "gtm-calendar"
        try:
            events = (calendar_fn or fetch_calendar)()
            nodes, edges, report = build_calendar(events, graph)
            graph.apply(source, nodes, edges)
            record_sync(graph, source, "calendar", True, "", report)
            results.append({"source": source, "ok": True, **report})
        except (SourceUnavailable, osgraph.OntologyError) as err:
            record_sync(graph, source, "calendar", False, str(err), {})
            results.append({"source": source, "ok": False, "note": str(err)})
    return results


def fetch_inbox(workspace_id: str, runner=None) -> list:
    """bin/clay-inbox, which reads Clay's sequencer inbox from inside the
    signed-in Chrome tab. Anything short of a JSON list is unavailable."""
    runner = runner or _subprocess_runner
    tool = str(ROOT / "bin" / "clay-inbox")
    code, out, err = runner([sys.executable, tool, "--workspace", str(workspace_id)])
    if code != 0:
        raise SourceUnavailable(f"inbox: clay-inbox could not read the signed-in Clay tab: {clip(err or out, 240)}")
    try:
        body = json.loads(out)
    except ValueError as e:
        raise SourceUnavailable("inbox: clay-inbox printed non-JSON") from e
    if not isinstance(body, list):
        raise SourceUnavailable("inbox: clay-inbox did not return a list of replies")
    return body
