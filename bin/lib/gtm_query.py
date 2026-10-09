"""Answers about GTM clients, read only from the local OS graph.

Caleb, 2026-10-09: every answer in milliseconds. So nothing here touches the
network or imports the ingesters: it opens ~/.chewbacca/os-graph.sqlite read
only and walks the edges `gtm_ingest` wrote, through indexes on exactly what it
filters by (edges by src/verb and dst/verb, ENROLLED by email and lowercased
name, Reply by lead email, nodes by type). Every number carries the source it
came from, and every answer carries when each source last synced, because a
fast answer from a stale sync is still stale.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# Who decided a reply's class, strongest first. A person (Jonah judging fit)
# beats a model, a model beats Clay's own category, because Clay's
# "Interested" was a canned redirect on 2026-10-05.
SKIP_WHEN_UNANSWERED = frozenset({"negative", "unsubscribe", "ooo", "bounce"})


class NoGraph(RuntimeError):
    pass


def graph_path() -> Path:
    return Path(os.environ.get("KYBER_OS_GRAPH") or Path.home() / ".chewbacca" / "os-graph.sqlite")


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or graph_path()
    if not Path(path).exists():
        raise NoGraph(f"no OS graph at {path}: run `chewbacca gtm sync` first")
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    return db


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def _props(row) -> dict:
    try:
        return json.loads(row["props"] or "{}")
    except (ValueError, TypeError):
        return {}


def _marks(items) -> str:
    return ",".join("?" * len(items))


def rank(by: str) -> int:
    """A verdict's weight. Only a named person outranks a model. A missing
    or "unknown" author is the weakest of all: the first version ranked
    anything not clay or model as a person, so an edge with no author beat
    a real model verdict (security review, 2026-10-09)."""
    by = (by or "").strip().lower()
    if by in ("", "unknown", "none"):
        return -1
    if by == "clay":
        return 0
    if by.startswith("model"):
        return 1
    return 2


# ── sync state ────────────────────────────────────────────────────────────


def sync_state(db, workspaces: list[str] | None = None) -> list[dict]:
    """Each source's last sync, plus a "never synced" row for every source
    these workspaces should have, so a zero from a source that never ran
    reads as missing rather than as zero."""
    try:
        rows = db.execute("SELECT * FROM gtm_sync ORDER BY source").fetchall()
    except sqlite3.OperationalError:
        rows = []
    if workspaces is None:
        workspaces = [w for c in client_rows(db) for w in (c.get("workspaces") or [])]
    out = []
    for r in rows:
        if r["workspace"] and r["workspace"] not in workspaces:
            continue
        d = dict(r)
        d["ok"] = bool(d["ok"])
        d["report"] = json.loads(d["report"] or "{}")
        out.append(d)
    seen = {d["source"] for d in out}
    expected = [f"gtm-{k}:{w}" for w in workspaces for k in ("clay", "inbox")] + \
        ["gtm-calendar", "gtm-calendar:google", "gtm-calendar:mac"]
    for source in expected:
        if source not in seen:
            out.append({"source": source, "ok": None, "ran_at": None, "note": "never synced", "report": {}})
    return sorted(out, key=lambda d: d["source"])


def age(stamp: str, now: datetime | None = None) -> str:
    try:
        then = datetime.fromisoformat(stamp)
    except (ValueError, TypeError):
        return "unknown"
    secs = int(((now or datetime.now(timezone.utc)) - then).total_seconds())
    if secs < 90:
        return f"{secs}s ago"
    if secs < 5400:
        return f"{secs // 60}m ago"
    if secs < 172800:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


# ── clients and campaigns ─────────────────────────────────────────────────


def client_rows(db) -> list[dict]:
    return [{"id": r["id"], "name": r["label"], **_props(r)}
            for r in db.execute("SELECT id, label, props FROM nodes WHERE type = 'Client' ORDER BY label")]


def find_client(db, name: str) -> dict:
    """The one client whose name is exactly `name` (case and spacing aside),
    or whose id is exactly `name`. Never a substring: the first version fell
    back to one, so `gtm suppress --client Acme` quietly answered with the
    only client whose name CONTAINED "acme", and a refill would have been
    stamped against another client's list (security review, 2026-10-09).
    Two clients with one name refuse and print both ids."""
    want = " ".join((name or "").lower().split())
    rows = client_rows(db)
    hit = [c for c in rows if c["id"] == (name or "").strip()]
    if not hit:
        hit = [c for c in rows if want and " ".join(c["name"].lower().split()) == want]
    if not hit and want:
        hit = [c for c in rows if c["id"] == f"client:{slug(name)}"]
    if len(hit) == 1:
        return hit[0]
    if len(hit) > 1:
        raise LookupError(f"{len(hit)} clients are called {name!r}; pass one id: "
                          + ", ".join(c["id"] for c in hit))
    near = [c["name"] for c in rows if want and want in c["name"].lower()]
    names = ", ".join(c["name"] for c in rows) or "none synced yet"
    hint = f"; did you mean {', '.join(repr(n) for n in near)}?" if near else ""
    raise LookupError(f"no client is exactly {name!r} (clients: {names}){hint}")


def campaigns_of(db, client_id: str) -> list[dict]:
    rows = db.execute(
        "SELECT n.id, n.label, n.props FROM edges e JOIN nodes n ON n.id = e.src "
        "WHERE e.dst = ? AND e.verb = 'FOR_CLIENT'", (client_id,)).fetchall()
    return [{"id": r["id"], "name": r["label"], **_props(r)} for r in rows]


def offers_of(db, client_id: str) -> list[str]:
    return [r["label"] for r in db.execute(
        "SELECT n.label FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ? AND e.verb = 'OFFERS' "
        "ORDER BY n.label", (client_id,))]


def workspaces_of(db, client_id: str) -> list[str]:
    out = []
    for r in db.execute("SELECT n.props FROM edges e JOIN nodes n ON n.id = e.dst "
                        "WHERE e.src = ? AND e.verb = 'OWNS'", (client_id,)):
        ws = _props(r).get("workspace_id")
        if ws:
            out.append(str(ws))
    return out


def lead_stats(db, cams: list[str]) -> dict[str, dict]:
    if not cams:
        return {}
    out = {}
    for r in db.execute(
            "SELECT src, COUNT(*) AS people, "
            "SUM(json_extract(props, '$.last_sent_at') IS NOT NULL) AS emailed, "
            "MAX(json_extract(props, '$.last_sent_at')) AS last_sent "
            f"FROM edges WHERE verb = 'ENROLLED' AND src IN ({_marks(cams)}) GROUP BY src", cams):
        out[r["src"]] = {"people": r["people"], "emailed": r["emailed"] or 0, "last_sent": r["last_sent"]}
    return out


def verdicts(db, reply_ids: list[str]) -> dict[str, dict]:
    """reply id -> {"class", "by", "all": [(class, by)]}, strongest verdict wins."""
    out: dict[str, dict] = {}
    for i in range(0, len(reply_ids), 500):
        chunk = reply_ids[i:i + 500]
        for r in db.execute(
                f"SELECT src, dst, props FROM edges WHERE verb = 'CLASSIFIED_AS' AND src IN ({_marks(chunk)})",
                chunk):
            cls = r["dst"].removeprefix("replyclass:")
            for by in _props(r).get("by") or ["unknown"]:
                slot = out.setdefault(r["src"], {"class": None, "by": None, "all": []})
                slot["all"].append((cls, by))
                if slot["by"] is None or rank(by) > rank(slot["by"]):
                    slot["class"], slot["by"] = cls, by
    return out


def replies_in(db, cams: list[str]) -> list[dict]:
    """Every Reply in these campaigns with the person who sent it."""
    if not cams:
        return []
    rows = db.execute(
        "SELECT ic.dst AS campaign, r.id, r.props, rp.src AS person FROM edges ic "
        "JOIN nodes r ON r.id = ic.src "
        "LEFT JOIN edges rp ON rp.dst = ic.src AND rp.verb = 'REPLIED' "
        f"WHERE ic.verb = 'IN_CAMPAIGN' AND ic.dst IN ({_marks(cams)})", cams).fetchall()
    return [{"id": r["id"], "campaign": r["campaign"], "person": r["person"], **_props(r)} for r in rows]


def meetings_in(db, cams: list[str]) -> list[dict]:
    if not cams:
        return []
    return [dict(r) for r in db.execute(
        f"SELECT DISTINCT src AS meeting, dst AS campaign FROM edges WHERE verb = 'BOOKED_FROM' AND dst IN ({_marks(cams)})",
        cams)]


def per_campaign(db, cams: list[dict]) -> list[dict]:
    ids = [c["id"] for c in cams]
    stats = lead_stats(db, ids)
    reps = replies_in(db, ids)
    v = verdicts(db, [r["id"] for r in reps])
    meets = meetings_in(db, ids)
    rows = []
    for c in cams:
        mine = [r for r in reps if r["campaign"] == c["id"]]
        people = {r["person"] for r in mine if r["person"]}
        positive = {r["person"] for r in mine if r["person"] and (v.get(r["id"]) or {}).get("class") == "positive"}
        a = c.get("analytics") or {}
        s = stats.get(c["id"], {"people": 0, "emailed": 0, "last_sent": None})
        rows.append({
            "id": c["id"], "name": c["name"], "status": c.get("status"), "offer": c.get("offer"),
            "clay_leads": a.get("leads"), "clay_sent": a.get("sent"), "clay_replies": a.get("replies"),
            "clay_bounces": a.get("bounces"), "people": s["people"], "emailed": s["emailed"],
            "last_sent": s["last_sent"], "replied": len(people), "positive": len(positive),
            "booked": len({m["meeting"] for m in meets if m["campaign"] == c["id"]}),
            "analytics_as_of": c.get("analytics_as_of"),
        })
    rows.sort(key=lambda r: (r["status"] != "active", r["offer"] or "", r["name"]))
    return rows


def clients(db) -> dict:
    out = []
    for c in client_rows(db):
        cams = campaigns_of(db, c["id"])
        ids = [x["id"] for x in cams]
        f = funnel_numbers(db, cams, c["id"]) if ids else {}
        out.append({"name": c["name"], "id": c["id"], "principal": c.get("principal", ""),
                    "workspaces": workspaces_of(db, c["id"]), "offers": offers_of(db, c["id"]),
                    "campaigns": len(cams), "active": sum(1 for x in cams if x.get("status") == "active"),
                    "funnel": f})
    return {"clients": out, "sync": sync_state(db)}


def client(db, name: str) -> dict:
    c = find_client(db, name)
    cams = campaigns_of(db, c["id"])
    ws = workspaces_of(db, c["id"])
    return {"name": c["name"], "id": c["id"], "principal": c.get("principal", ""), "workspaces": ws,
            "offers": offers_of(db, c["id"]), "campaigns": per_campaign(db, cams),
            "funnel": funnel_numbers(db, cams, c["id"]), "sync": sync_state(db, ws)}


def booking_signals(db, client_id: str) -> dict:
    """Booking evidence from the client's inbox threads, by distinct lead:
    confirmed (an invite, an accept, a scheduler confirmation or a confirmed
    time) and proposed with nothing confirmed yet. Only signals credited to
    this client count. Never added to calendar meetings: a Zeutara meeting
    on Jonah's calendar shows here and nowhere else, and one also on Caleb's
    calendar would otherwise count twice."""
    confirmed: dict[str, str] = {}
    proposed: set[str] = set()
    evidence: dict[str, int] = {}
    for r in db.execute("SELECT props FROM nodes WHERE type = 'Signal' "
                        "AND json_extract(props, '$.kind') = 'booking_signal' "
                        "AND json_extract(props, '$.client_id') = ?", (client_id,)):
        p = _props(r)
        if not p.get("credited") or not p.get("email"):
            continue
        if p.get("status") == "confirmed":
            confirmed.setdefault(p["email"], p.get("evidence") or "")
        elif p.get("status") == "proposed":
            proposed.add(p["email"])
    for ev in confirmed.values():
        evidence[ev] = evidence.get(ev, 0) + 1
    return {"confirmed": len(confirmed), "proposed_only": len(proposed - set(confirmed)),
            "confirmed_by": evidence,
            "source": "clay inbox threads: calendar invite or accept, scheduler confirmation, or a stated time"}


def funnel_numbers(db, cams: list[dict], client_id: str | None = None) -> dict:
    ids = [c["id"] for c in cams]
    if not ids:
        return {}
    marks = _marks(ids)
    # One scan: each person once, emailed if any of their campaigns sent.
    people, emailed = db.execute(
        "SELECT COUNT(*), COALESCE(SUM(sent), 0) FROM (SELECT dst, "
        "MAX(json_extract(props, '$.last_sent_at') IS NOT NULL) AS sent FROM edges "
        f"WHERE verb = 'ENROLLED' AND src IN ({marks}) GROUP BY dst)", ids).fetchone()
    reps = replies_in(db, ids)
    v = verdicts(db, [r["id"] for r in reps])
    replied = {r["person"] for r in reps if r["person"]}
    pos_by: dict[str, str] = {}
    for r in reps:
        verdict = v.get(r["id"]) or {}
        if r["person"] and verdict.get("class") == "positive":
            pos_by.setdefault(r["person"], verdict["by"])
    meets = {m["meeting"] for m in meetings_in(db, ids)}
    analytics = {k: sum((c.get("analytics") or {}).get(k) or 0 for c in cams)
                 for k in ("leads", "sent", "replies", "repliesExcludingOoo", "bounces")}
    as_of = [c.get("analytics_as_of") for c in cams if c.get("analytics_as_of")]
    return {
        "campaigns": len(ids),
        "clay": {**analytics, "as_of": max(as_of) if as_of else None,
                 "source": "clay campaigns analytics, summed over the client's campaigns"},
        "people_in_campaigns": {"n": people, "source": "clay Audiences activities, distinct addresses"},
        "people_emailed": {"n": emailed, "source": "clay activities, addresses with an 'Email sent'"},
        "people_replied": {"n": len(replied), "of": emailed, "source": "clay inbox threads"},
        "people_positive": {"n": len(pos_by), "of": len(replied),
                            "by": {b: sum(1 for x in pos_by.values() if x == b) for b in set(pos_by.values())},
                            "source": "strongest reply verdict: person > model > clay category"},
        "meetings": {"n": len(meets), "of": emailed,
                     "source": "calendar events (Google and Mac, deduped) with a lead's address"},
        "booking_signals": booking_signals(db, client_id) if client_id else {},
    }


# ── one person ────────────────────────────────────────────────────────────


def find_people(db, who: str) -> list[dict]:
    """Every person matching an email exactly, or a full name exactly. Two
    addresses under one name stay two people; nothing is merged on a name."""
    who = (who or "").strip()
    if "@" in who:
        key = who.lower() if who.isascii() else ""
        rows = db.execute("SELECT DISTINCT dst AS person, json_extract(props, '$.email') AS email FROM edges "
                          "WHERE verb = 'ENROLLED' AND json_extract(props, '$.email') = ?", (key,)).fetchall()
        found = {r["person"]: r["email"] for r in rows}
        for r in db.execute("SELECT e.src AS person FROM nodes n JOIN edges e ON e.dst = n.id AND e.verb = 'REPLIED' "
                            "WHERE n.type = 'Reply' AND json_extract(n.props, '$.lead_email') = ?", (key,)):
            found.setdefault(r["person"], key)
        return [{"person": p, "email": e} for p, e in found.items()]
    want = " ".join(who.lower().split())
    rows = db.execute("SELECT DISTINCT dst AS person, json_extract(props, '$.email') AS email FROM edges "
                      "WHERE verb = 'ENROLLED' AND lower(json_extract(props, '$.name')) = ?", (want,)).fetchall()
    found = {r["person"]: r["email"] for r in rows}
    for r in db.execute("SELECT id FROM nodes WHERE type = 'Person' AND lower(label) = ?", (want,)):
        found.setdefault(r["id"], None)
    return [{"person": p, "email": e} for p, e in found.items()]


def lead(db, who: str) -> dict:
    matches = find_people(db, who)
    people = []
    client_of: dict[str, str] = {}
    for m in matches:
        pid = m["person"]
        node = db.execute("SELECT label, props, unresolved FROM nodes WHERE id = ?", (pid,)).fetchone()
        camps = []
        for e in db.execute("SELECT e.src, e.props, n.label, n.props AS cprops FROM edges e "
                            "JOIN nodes n ON n.id = e.src WHERE e.dst = ? AND e.verb = 'ENROLLED'", (pid,)):
            ep, cp = json.loads(e["props"]), json.loads(e["cprops"])
            if e["src"] not in client_of:
                row = db.execute("SELECT n.label FROM edges x JOIN nodes n ON n.id = x.dst "
                                 "WHERE x.src = ? AND x.verb = 'FOR_CLIENT'", (e["src"],)).fetchone()
                client_of[e["src"]] = row["label"] if row else ""
            camps.append({"campaign": e["label"], "client": client_of[e["src"]], "offer": cp.get("offer"),
                          "status": ep.get("status"), "sent_dates": ep.get("sent_dates") or [],
                          "last_sent_at": ep.get("last_sent_at"), "steps_sent": ep.get("steps_sent"),
                          "campaign_status": cp.get("status"), "email": ep.get("email"), "name": ep.get("name"),
                          "title": ep.get("title")})
        reps = []
        rows = db.execute("SELECT n.id, n.props FROM edges e JOIN nodes n ON n.id = e.dst "
                          "WHERE e.src = ? AND e.verb = 'REPLIED'", (pid,)).fetchall()
        v = verdicts(db, [r["id"] for r in rows])
        for r in rows:
            p = json.loads(r["props"])
            reps.append({"time": p.get("time"), "campaign": p.get("campaign_name"), "subject": p.get("subject"),
                         "snippet": p.get("snippet"), "answered": p.get("answered"), "forwarded": p.get("forwarded"),
                         "screen_flag": p.get("screen_flag"), "class": (v.get(r["id"]) or {}).get("class"),
                         "classified_by": (v.get(r["id"]) or {}).get("all", []),
                         "thread_sent_times": p.get("thread_sent_times") or []})
        meets = []
        for r in db.execute("SELECT n.label, n.props FROM edges e JOIN nodes n ON n.id = e.src "
                            "WHERE e.dst = ? AND e.verb = 'MEETING_WITH'", (pid,)):
            p = json.loads(r["props"])
            meets.append({"title": r["label"], "start": p.get("start"), "end": p.get("end")})
        names = sorted({c["name"] for c in camps if c.get("name")})
        people.append({"person": pid, "email": m["email"], "label": node["label"] if node else pid,
                       "resolved_in_people_store": bool(node) and not node["unresolved"],
                       "names_in_clay": names, "campaigns": sorted(camps, key=lambda c: c["last_sent_at"] or ""),
                       "replies": sorted(reps, key=lambda r: r["time"] or ""),
                       "meetings": sorted(meets, key=lambda r: r["start"] or "")})
    note = ""
    if len(people) > 1 and "@" not in who:
        note = (f"{len(people)} different people match {who!r}. They are separate addresses and are "
                "not merged on a name.")
    return {"query": who, "people": people, "note": note, "sync": sync_state(db)}


# ── lists ─────────────────────────────────────────────────────────────────


def replies(db, client_name: str | None = None, unanswered: bool = False, include_all: bool = False,
            all_clients: bool = False) -> dict:
    """Replies for one client. Every client's at once only when asked for by
    name (`all_clients`): the first version listed every client's reply text
    whenever --client was left off, so a list meant for one client carried
    the others' leads and what they wrote (security review, 2026-10-09)."""
    if not client_name and not all_clients:
        raise LookupError("replies needs --client NAME (or --all-clients to list every client's replies)")
    if client_name:
        c = find_client(db, client_name)
        cams = campaigns_of(db, c["id"])
        rows = replies_in(db, [x["id"] for x in cams])
        names = {x["id"]: x["name"] for x in cams}
        ws = workspaces_of(db, c["id"])
    else:
        rows = [{"id": r["id"], "campaign": r["campaign"], "person": r["person"], **_props(r)} for r in db.execute(
            "SELECT n.id, n.props, ic.dst AS campaign, rp.src AS person FROM nodes n "
            "LEFT JOIN edges ic ON ic.src = n.id AND ic.verb = 'IN_CAMPAIGN' "
            "LEFT JOIN edges rp ON rp.dst = n.id AND rp.verb = 'REPLIED' WHERE n.type = 'Reply'")]
        names, ws = {}, None
    v = verdicts(db, [r["id"] for r in rows])
    out, skipped, forwarded = [], 0, 0
    for r in rows:
        verdict = v.get(r["id"]) or {}
        cls = verdict.get("class")
        if unanswered:
            if not r.get("latest") or r.get("answered"):
                continue
            if r.get("forwarded") and not include_all:
                forwarded += 1
                continue
            if cls in SKIP_WHEN_UNANSWERED and not include_all:
                skipped += 1
                continue
        out.append({"time": r.get("time"), "email": r.get("lead_email"), "campaign": names.get(r["campaign"]) or
                    r.get("campaign_name"), "class": cls, "classified_by": verdict.get("by"),
                    "answered": r.get("answered"), "forwarded": r.get("forwarded"), "snippet": r.get("snippet"),
                    "screen_flag": r.get("screen_flag")})
    out.sort(key=lambda r: r["time"] or "", reverse=True)
    return {"client": client_name, "unanswered": unanswered, "replies": out, "skipped_closed": skipped,
            "skipped_forwarded": forwarded, "sync": sync_state(db, ws)}


def _domain(address: str) -> str:
    return address.rsplit("@", 1)[-1] if "@" in address else ""


def live_suppressions(db, client_id: str) -> dict[str, dict]:
    """address -> {"last_sent", "reasons"} for everyone this client must never
    email again, from the graph as it stands. A domain block is the address
    "*@domain" and also marks every address of the client's at that domain.

    Reasons, any one of which suppresses: emailed (an "Email sent"
    activity), replied (any reply, any class, in any of the client's
    campaigns or its workspace inbox even when the campaign name matched
    nothing), unsubscribed, bounced, labelled not-a-fit, and do-not-contact
    entries (clients.json, blocklist exports, human labels). The first
    version listed only "Email sent" addresses plus reply threads that
    matched a campaign by name, so an unsubscribe, a bounce, a "not a fit"
    or a reply in an unmatched thread went back into the next refill
    (security review, 2026-10-09). Enrollment alone still never counts."""
    cams = [x["id"] for x in campaigns_of(db, client_id)]
    out: dict[str, dict] = {}
    known: set[str] = set()

    def mark(address, reason, sent=None):
        if not address:
            return
        slot = out.setdefault(address, {"last_sent": None, "reasons": []})
        if reason not in slot["reasons"]:
            slot["reasons"].append(reason)
        if sent and (slot["last_sent"] or "") < sent:
            slot["last_sent"] = sent

    if cams:
        for r in db.execute(
                "SELECT json_extract(props, '$.email') AS email, MAX(json_extract(props, '$.last_sent_at')) AS last, "
                "MAX(json_extract(props, '$.replied')) AS replied, MAX(json_extract(props, '$.bounced')) AS bounced "
                f"FROM edges WHERE verb = 'ENROLLED' AND src IN ({_marks(cams)}) GROUP BY email", cams):
            e = r["email"]
            known.add(e)
            if r["last"]:
                mark(e, "emailed", r["last"])
            if r["replied"]:
                mark(e, "replied")
            if r["bounced"]:
                mark(e, "bounced")
    reps = {r["id"]: r for r in replies_in(db, cams)}
    for r in db.execute("SELECT id, props FROM nodes WHERE type = 'Reply' "
                        "AND json_extract(props, '$.client_id') = ?", (client_id,)):
        reps.setdefault(r["id"], {"id": r["id"], **_props(r)})
    v = verdicts(db, list(reps))
    for rid, r in reps.items():
        e = r.get("lead_email")
        if not e:
            continue
        known.add(e)
        sent = [t for t in r.get("thread_sent_times") or [] if t]
        mark(e, "replied", max(sent)[:10] if sent else None)
        for cls, by in (v.get(rid) or {}).get("all", []):
            if cls == "unsubscribe":
                mark(e, "unsubscribed")
            elif cls == "bounce":
                mark(e, "bounced")
            elif cls == "negative":
                mark(e, f"not a fit (negative by {by})")
    domains: dict[str, str] = {}
    for r in db.execute("SELECT props FROM nodes WHERE type = 'Signal' AND json_extract(props, '$.client_id') = ?",
                        (client_id,)):
        p = _props(r)
        if p.get("kind") != "do_not_contact":
            continue
        if p.get("email"):
            mark(p["email"], p.get("reason") or "do not contact")
        elif p.get("domain"):
            domains[p["domain"]] = p.get("reason") or "domain blocked"
            mark(f"*@{p['domain']}", p.get("reason") or "domain blocked")
    for e in known:
        d = _domain(e)
        if d in domains:
            mark(e, f"domain {d} blocked: {domains[d]}")
    return out


def suppress(db, client_name: str) -> dict:
    """Everyone this client must never email again: the live graph
    (`live_suppressions`) plus the gtm_suppressed ledger, which keeps an
    address after its campaign is deleted in Clay and drops out of the
    snapshot. Each row says why."""
    c = find_client(db, client_name)
    cams = campaigns_of(db, c["id"])
    rows = live_suppressions(db, c["id"])
    ledger_only = 0
    try:
        for r in db.execute("SELECT address, reason, last_sent FROM gtm_suppressed WHERE client = ?", (c["id"],)):
            if r["address"] not in rows:
                ledger_only += 1
            slot = rows.setdefault(r["address"], {"last_sent": None, "reasons": []})
            if r["reason"] not in slot["reasons"]:
                slot["reasons"].append(r["reason"])
            if r["last_sent"] and (slot["last_sent"] or "") < r["last_sent"]:
                slot["last_sent"] = r["last_sent"]
    except sqlite3.OperationalError:
        pass  # no ledger table yet: a graph that has never completed a sync
    domains = {a[2:] for a in rows if a.startswith("*@")}
    for a, slot in rows.items():
        d = _domain(a)
        if not a.startswith("*@") and d in domains and not any(x.startswith("domain ") for x in slot["reasons"]):
            slot["reasons"].append(f"domain {d} blocked")
    in_only = 0
    if cams:
        ids = [x["id"] for x in cams]
        for r in db.execute("SELECT DISTINCT json_extract(props, '$.email') AS email FROM edges "
                            f"WHERE verb = 'ENROLLED' AND src IN ({_marks(ids)})", ids):
            if r["email"] not in rows:
                in_only += 1
    clay_sent = sum((x.get("analytics") or {}).get("sent") or 0 for x in cams)
    emails = [{"email": a, "last_sent": s["last_sent"], "reasons": sorted(s["reasons"])}
              for a, s in sorted(rows.items())]
    return {"client": c["name"], "emails": emails,
            "from_reply_threads": sum(1 for r in emails if "replied" in r["reasons"] and "emailed" not in r["reasons"]),
            "domains_blocked": len(domains), "from_ledger_only": ledger_only,
            "in_campaign_never_emailed": in_only,
            "clay_sends_total": clay_sent, "sync": sync_state(db, workspaces_of(db, c["id"]))}


def funnel(db, client_name: str) -> dict:
    c = find_client(db, client_name)
    cams = campaigns_of(db, c["id"])
    return {"client": c["name"], "funnel": funnel_numbers(db, cams, c["id"]),
            "sync": sync_state(db, workspaces_of(db, c["id"]))}
