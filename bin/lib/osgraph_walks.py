"""Walks: every surface is a query over the graph, never an app.

A row is {id, type, label, app, when, tier, why, chips}: `id` is the graph node,
so a press on a row can open THAT node's walk (navigation is traversal), and
`chips` are the people, threads and spaces one hop away, each a node id too.

    needs_you   Me <-AWAITS_REPLY_FROM, OWED_BY Me, DUE_ON within 72 h
    today       DUE_ON today
    person      one Person's 1-hop neighborhood across every source
    space       the subgraph that BELONGS_TO a space
    tasks       Tasks owed by me in four lanes, from real run status
    people      Persons ranked by the people CLI's score, with message counts
    conversations  Threads and mail as cards, ACTION or FYI

The three competency questions the ontology was designed against are walks
too: `owed_to` ("what do I owe Sagar"), `waiting_longest` ("who's waiting on me
longest"), `due_before` ("what's due before the ACAD 324 midterm").
"""
from __future__ import annotations

from datetime import datetime, timedelta

from osgraph import ME, Graph, Identities

BLOCKED, DUE, FYI = 0, 1, 2
TIER_WORD = {BLOCKED: "waiting on you", DUE: "due soon", FYI: "FYI"}
# Nine rows is the UX ceiling (CLAUDE.md, Miller's Law), and one source may
# take at most three before the others get theirs: on 2026-10-04 the backlog
# alone had eight P0/P1 decisions and pushed the one unanswered text off.
MOST_ROWS = 9
PER_SOURCE = 3
DUE_WINDOW_H = 72
PERSON_ROWS = 5
BACKLOG_BLOCKING = {"decision", "blocked"}


def when_of(value) -> float:
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return float("inf")
    if moment.tzinfo is None:
        moment = moment.astimezone()
    return moment.timestamp()


def chips(g: Graph, node: dict) -> list[dict]:
    """The people and space one hop from a row, as pressable node ids."""
    out = []
    nid = node["id"]
    for verb in ("PARTICIPANT", "SENT_BY", "OWED_TO"):
        for p in g.out(nid, verb):
            if p["id"] != ME:
                flag = " (unverified sender)" if p["props"].get("unverified") else (
                    " (unconfirmed)" if p["unresolved"] else "")
                out.append({"id": p["id"], "label": p["label"] + flag})
    for s in g.out(nid, "BELONGS_TO"):
        out.append({"id": s["id"], "label": s["label"]})
    seen, unique = set(), []
    for c in out:
        if c["id"] not in seen:
            seen.add(c["id"])
            unique.append(c)
    return unique[:4]


def row(g: Graph, node: dict, tier: int, when: str, why: str) -> dict:
    props = node.get("props") or {}
    app = props.get("app") or {"Task": "Task", "Assignment": "Class", "Event": "Calendar"}.get(node["type"], node["type"])
    if node["type"] == "Task":
        app = {"agent": "Agent", "backlog": props.get("lane") or "Backlog", "request": "Ask",
               "promise": "Promise"}.get(props.get("kind"), "Task")
    group = {"Thread": "texts", "MailItem": "mail", "Assignment": "class", "Event": "calendar"}.get(
        node["type"], props.get("kind") or "tasks")
    return {"id": node["id"], "type": node["type"], "label": node["label"], "app": app, "group": group, "when": when,
            "tier": tier, "why": why, "chips": chips(g, node), "props": props,
            "confidence": node.get("confidence", 1.0)}


def due_day(g: Graph, nid: str) -> str:
    days = g.out(nid, "DUE_ON")
    return days[0]["label"] if days else ""


def rank(rows: list[dict], most: int = MOST_ROWS, per_source: int = PER_SOURCE) -> list[dict]:
    ordered = sorted(rows, key=lambda r: (r["tier"], when_of(r["when"])))
    kept, spill, per = [], [], {}
    for r in ordered:
        if per.get(r["group"], 0) < per_source:
            per[r["group"]] = per.get(r["group"], 0) + 1
            kept.append(r)
        else:
            spill.append(r)
    kept += spill[: max(0, most - len(kept))]
    return sorted(kept, key=lambda r: (r["tier"], when_of(r["when"])))[:most]


def _attention(g: Graph, now: datetime, scope: set[str] | None = None) -> list[dict]:
    """Everything that needs the person, unranked. `scope` limits it to node ids
    (a space's members)."""
    horizon = (now + timedelta(hours=DUE_WINDOW_H)).date().isoformat()
    today = now.date().isoformat()
    rows: list[dict] = []

    def keep(nid: str) -> bool:
        return scope is None or nid in scope

    for e in g.edges(verb="AWAITS_REPLY_FROM", dst=ME):
        node = g.node(e["src"])
        if node and keep(node["id"]):
            tier = BLOCKED if node["type"] == "Thread" else DUE
            rows.append(row(g, node, tier, e["props"].get("since", ""), "waiting on your reply"))
    for e in g.edges(verb="OWED_BY", dst=ME):
        node = g.node(e["src"])
        if not node or not keep(node["id"]):
            continue
        props = node["props"]
        day = due_day(g, node["id"])
        if node["type"] == "Assignment":
            if props.get("overdue"):
                rows.append(row(g, node, BLOCKED, day, "overdue"))
            elif day and day <= horizon:
                rows.append(row(g, node, DUE, day, "due " + ("today" if day == today else day)))
            continue
        kind = props.get("kind")
        if kind == "agent":
            rows.append(row(g, node, BLOCKED, props.get("at", ""), "an agent needs a permission"))
        elif kind == "backlog":
            if props.get("status") in BACKLOG_BLOCKING and props.get("priority") in ("P0", "P1"):
                rows.append(row(g, node, BLOCKED, props.get("updated", ""), f"{props.get('status')} on you"))
            elif day and day <= horizon:
                rows.append(row(g, node, DUE, day, "due " + day))
        elif kind == "promise" and day and day <= horizon:
            rows.append(row(g, node, DUE, day, "you promised it"))
        # Requests extracted from a text ride on their thread's row, which is
        # already "waiting on your reply"; listing both says one thing twice.
    for e in g.edges(verb="DUE_ON"):
        node = g.node(e["src"])
        if node and node["type"] == "Event" and keep(node["id"]) and today <= e["dst"][4:] <= horizon:
            rows.append(row(g, node, DUE, node["props"].get("start", ""), "on your calendar"))
    for node in g.nodes("Task"):
        if node["props"].get("kind") == "agent" and node["props"].get("status") == "done" and keep(node["id"]):
            rows.append(row(g, node, FYI, node["props"].get("at", ""), "an agent finished"))
    return rows


def needs_you(g: Graph, now: datetime) -> dict:
    rows = _attention(g, now)
    return {"rows": rank(rows), "count": sum(1 for r in rows if r["tier"] in (BLOCKED, DUE)),
            "tiers": {TIER_WORD[t]: sum(1 for r in rows if r["tier"] == t) for t in (BLOCKED, DUE, FYI)}}


def today(g: Graph, now: datetime) -> dict:
    day = now.date().isoformat()
    rows = []
    for node in g.into(f"day:{day}", "DUE_ON"):
        # An action item Anarlog guessed out of a meeting can belong to anyone
        # in the room; on 2026-10-05 one assigned to Sagar drew on Caleb's
        # Today. A guess stays off the day until the person promotes it.
        if node["props"].get("guess"):
            continue
        start = node["props"].get("start", "")
        rows.append(row(g, node, DUE, start or day, "today"))
    for node in g.nodes("Assignment"):
        if node["props"].get("overdue"):
            rows.append(row(g, node, BLOCKED, due_day(g, node["id"]), "overdue"))
    rows.sort(key=lambda r: (r["type"] != "Event", when_of(r["when"])))
    return {"rows": rows[:MOST_ROWS], "day": day}


class Ambiguous(LookupError):
    def __init__(self, name: str, options: list[str]):
        super().__init__(f"{len(options)} people match {name!r}: {', '.join(options[:4])}. Say the full name.")
        self.options = options


def find_person(g: Graph, ids: Identities, name: str) -> tuple[str, str]:
    """(node id, how it was matched) for a RESOLVED person. Never fuzzy: an
    exact full name or nickname from the people store, an exact label of a
    resolved person, or a first name exactly one resolved person in the graph
    has. Two candidates raise Ambiguous, because picking between them is the
    Tyler Law / Tyler Larsen mistake. Unresolved name nodes (a first name in a
    backlog cell) are never the answer; `also_named` lists them separately."""
    if name.startswith("person:"):
        if g.node(name):
            return name, "id"
        raise LookupError(f"no person {name}")
    exact = ids.by_name(name)
    if len(exact) == 1:
        return f"person:{exact[0]['id']}", "people store"
    if len(exact) > 1:
        # The people store holds duplicate records (2026-10-04: two "Karthik
        # Devarakonda"). If exactly one of them is in this week's graph, that
        # is who the person is in touch with; the caption says there were two.
        active = [p for p in exact if g.node(f"person:{p['id']}")]
        if len(active) == 1:
            return f"person:{active[0]['id']}", f"name, the one of {len(exact)} records you're in touch with"
        raise Ambiguous(name, [p["name"] + (f" ({p['company']})" if p["company"] else "") for p in exact])
    want = " ".join(name.lower().split())
    people = [p for p in g.nodes("Person") if p["id"] != ME and not p["unresolved"]]
    labelled = [p for p in people if p["label"].lower() == want]
    if len(labelled) == 1:
        return labelled[0]["id"], "exact name"
    first = [p for p in people if p["label"].lower().split()[:1] == [want]]
    if len(first) == 1:
        return first[0]["id"], "first name, the only one you're in touch with"
    if len(first) > 1:
        raise Ambiguous(name, [p["label"] for p in first])
    raise LookupError(f"no one called {name} in the last week's texts, mail or calendar")


def also_named(g: Graph, name: str) -> list[dict]:
    """Unresolved nodes whose whole label is `name`: shown beside a person as
    "named X in the backlog, unconfirmed", never merged into them."""
    want = " ".join(name.lower().split())
    return [p for p in g.nodes("Person") if p["unresolved"] and p["label"].lower() == want]


def person(g: Graph, ids: Identities, name: str, now: datetime) -> dict:
    pid, how = find_person(g, ids, name)
    me_node = g.node(pid) or {"label": name, "unresolved": False}
    rows: list[dict] = []
    for thread in g.into(pid, "PARTICIPANT"):
        waiting = any(e["dst"] == ME for e in g.edges(src=thread["id"], verb="AWAITS_REPLY_FROM"))
        on_them = any(e["dst"] == pid for e in g.edges(src=thread["id"], verb="AWAITS_REPLY_FROM"))
        last = thread["props"].get("last_at", "")
        why = "waiting on your reply" if waiting else ("waiting on them" if on_them else "texts")
        rows.append(row(g, thread, BLOCKED if waiting else FYI, last, why))
    for item in g.into(pid, "SENT_BY"):
        if item["type"] == "MailItem":
            waiting = any(e["dst"] == ME for e in g.edges(src=item["id"], verb="AWAITS_REPLY_FROM"))
            rows.append(row(g, item, DUE if waiting else FYI, item["props"].get("at", ""), "mail"))
    for task in g.into(pid, "OWED_TO"):
        rows.append(row(g, task, DUE, due_day(g, task["id"]) or task["props"].get("at", ""), "you owe them"))
    for task in g.into(pid, "OWED_BY"):
        if task["props"].get("kind") == "backlog":
            rows.append(row(g, task, FYI, task["props"].get("updated", ""), "they own it"))
    for event in g.out(pid, "ATTENDS"):
        rows.append(row(g, event, DUE, event["props"].get("start", ""), "you'll both be there"))
    first = (me_node["label"].split() or [name])[0]
    for alias in also_named(g, name) + (also_named(g, first) if first.lower() != name.lower() else []):
        for task in g.into(alias["id"], "OWED_BY"):
            rows.append(row(g, task, FYI, task["props"].get("updated", ""),
                            f"owner \"{alias['label']}\" in the backlog, unconfirmed as them"))
    # Five and five: on the first live run (2026-10-04) eight timeline lines
    # plus nine rows pushed the reply box below the bottom of the screen.
    line = timeline(g, pid, most=PERSON_ROWS)
    routes = reply_routes(g, pid)
    last = next((m["network"] for m in line if not m["from_me"] and m["network"] in routes), "")
    return {"id": pid, "name": me_node["label"], "matched": how, "unresolved": me_node.get("unresolved", False),
            "rows": rank(rows, most=PERSON_ROWS), "timeline": line, "routes": routes,
            "last_network": last or next(iter(routes), "")}


# The network a message node came over. An ingester for another network sets
# props.network on its nodes ("WhatsApp", "Slack") and needs nothing here.
NETWORK_BY_TYPE = {"Message": "iMessage", "MailItem": "Mail"}


def network_of(node: dict) -> str:
    return (node.get("props") or {}).get("network") or NETWORK_BY_TYPE.get(node["type"], node["type"])


def timeline(g: Graph, pid: str, most: int = 8) -> list[dict]:
    """One person's conversation across every network, newest first: what
    they sent anywhere, and what the person sent in their one-to-one threads."""
    items: dict[str, dict] = {}
    for node in g.into(pid, "SENT_BY"):
        if node["type"] in ("Message", "MailItem"):
            items[node["id"]] = node
    for thread in g.into(pid, "PARTICIPANT"):
        if thread["props"].get("group"):
            continue
        for msg in g.into(thread["id"], "IN_THREAD"):
            if msg["props"].get("from_me"):
                items[msg["id"]] = msg
    out = []
    for node in items.values():
        at = node["props"].get("at") or node.get("observed_at", "")
        threads = g.out(node["id"], "IN_THREAD")
        out.append({"id": node["id"], "network": network_of(node), "at": at,
                    "from_me": bool(node["props"].get("from_me")),
                    "text": node["label"], "thread": threads[0]["label"] if threads else "",
                    "group": bool(threads and threads[0]["props"].get("group"))})
    out.sort(key=lambda m: when_of(m["at"]) if when_of(m["at"]) != float("inf") else 0, reverse=True)
    return out[:most]


def reply_routes(g: Graph, pid: str) -> dict[str, dict]:
    """Where a reply to this person can go, by network: their newest
    one-to-one iMessage thread, their newest mail with a sender address. Only
    routes that exist are offered; a network missing here cannot be picked."""
    routes: dict[str, dict] = {}
    threads = [t for t in g.into(pid, "PARTICIPANT")
               if not t["props"].get("group") and t["props"].get("reply_to")]
    if threads:
        t = max(threads, key=lambda x: when_of(x["props"].get("last_at")))
        routes["iMessage"] = row(g, t, FYI, t["props"].get("last_at", ""), "")
    # Only mail whose sender passed authentication is a way to reach them;
    # an unverified sender is never fused to a person in the first place.
    mails = [m for m in g.into(pid, "SENT_BY")
             if m["type"] == "MailItem" and m["props"].get("address") and m["props"].get("verified")]
    if mails:
        m = max(mails, key=lambda x: when_of(x["props"].get("at")))
        routes["Mail"] = row(g, m, FYI, m["props"].get("at", ""), "")
    return routes


def space(g: Graph, name: str, now: datetime) -> dict:
    sid = f"space:{name.lower()}"
    members = {n["id"] for n in g.into(sid, "BELONGS_TO")}
    # A project in the space brings its tasks with it.
    for project in [g.node(m) for m in members if m.startswith("project:")]:
        if project:
            members |= {n["id"] for n in g.into(project["id"], "ABOUT")}
    rows = _attention(g, now, scope=members)
    return {"id": sid, "name": name.capitalize(), "rows": rank(rows), "members": len(members)}


def tasks(g: Graph, runs: dict, now: datetime) -> dict:
    """Four lanes. Ready: asks from texts and mail, promises in the people
    store, and backlog items that are the person's move. Cooking, Stuck and
    Done come only from a real run's process or a real agent session."""
    lanes: dict[str, list[dict]] = {"ready": [], "cooking": [], "stuck": [], "done": []}
    for e in g.edges(verb="OWED_BY", dst=ME):
        node = g.node(e["src"])
        if not node or node["type"] != "Task":
            continue
        props = node["props"]
        run = runs.get(node["id"])
        if props.get("kind") == "agent":
            lane = props.get("status") or "stuck"
        elif run:
            lane = run.get("status", "cooking")
        elif props.get("kind") in ("request", "promise") or (
                props.get("kind") == "backlog" and props.get("status") in BACKLOG_BLOCKING | {"open"}
                and props.get("priority") in ("P0", "P1")):
            lane = "ready"
        else:
            continue
        r = row(g, node, BLOCKED if lane == "stuck" else DUE, props.get("at") or props.get("updated", ""),
                props.get("provenance", ""))
        if run:
            r["run"] = {"status": run.get("status"), "why": run.get("why", ""), "log": run.get("log", "")}
        lanes.setdefault(lane, []).append(r)
    for agent in g.nodes("Task"):
        p = agent["props"]
        if p.get("kind") == "agent" and p.get("status") in ("cooking", "done") and not any(
                r["id"] == agent["id"] for lane in lanes.values() for r in lane):
            lanes[p["status"]].append(row(g, agent, FYI, p.get("at", ""), p.get("provenance", "")))
    for lane in lanes.values():
        lane.sort(key=lambda r: -when_of(r["when"]) if when_of(r["when"]) != float("inf") else 0)
    return {"lanes": lanes, "counts": {k: len(v) for k, v in lanes.items()}}


def people(g: Graph, ids: Identities, query: str = "", most: int = MOST_ROWS) -> dict:
    """Persons in the graph ranked by the people CLI's score, with how many
    messages they sent in the window. Unresolved identities are listed and
    marked, never folded into someone."""
    want = " ".join((query or "").lower().split())
    rows = []
    for p in g.nodes("Person"):
        if p["id"] == ME:
            continue
        if want and want not in p["label"].lower():
            continue
        sent = sum(1 for _ in g.into(p["id"], "SENT_BY"))
        threads = sum(1 for _ in g.into(p["id"], "PARTICIPANT"))
        if not sent and not threads and not want:
            continue
        pid = p["id"].removeprefix("person:")
        score = ids.scores.get(pid, 0.0)
        rows.append({"id": p["id"], "label": p["label"], "unresolved": p["unresolved"], "score": score,
                     "messages": sent, "company": (p.get("props") or {}).get("company", "")})
    rows.sort(key=lambda r: (r["unresolved"], -r["score"], -r["messages"]))
    return {"rows": rows[:most], "total": len(rows)}


def conversations(g: Graph, now: datetime, most: int = MOST_ROWS) -> dict:
    """Threads and mail as cards. ACTION when it waits on the person or a task
    owed by the person was extracted from it; FYI otherwise."""
    owed_from_thread: set[str] = set()
    for e in g.edges(verb="EXTRACTED_FROM"):
        if any(o["dst"] == ME for o in g.edges(src=e["src"], verb="OWED_BY")):
            for t in g.out(e["dst"], "IN_THREAD"):
                owed_from_thread.add(t["id"])
    cards = []
    for node in g.nodes("Thread") + g.nodes("MailItem"):
        if node["type"] == "MailItem" and node["props"].get("automated"):
            continue
        waiting = any(e["dst"] == ME for e in g.edges(src=node["id"], verb="AWAITS_REPLY_FROM"))
        action = waiting or node["id"] in owed_from_thread
        when = node["props"].get("last_at") or node["props"].get("at", "")
        last = ""
        if node["type"] == "Thread":
            msgs = sorted(g.into(node["id"], "IN_THREAD"), key=lambda m: when_of(m["props"].get("at")))
            last = msgs[-1]["label"] if msgs else ""
        cards.append({**row(g, node, BLOCKED if action else FYI, when, "ACTION" if action else "FYI"),
                      "tag": "ACTION" if action else "FYI", "last": last})
    acting = sum(1 for c in cards if c["tag"] == "ACTION")
    cards.sort(key=lambda c: (c["tag"] != "ACTION", -when_of(c["when"]) if when_of(c["when"]) != float("inf") else 0))
    return {"rows": cards[:most], "to_act": acting, "total": len(cards)}


# ── competency questions ─────────────────────────────────────────────────


def owed_to(g: Graph, ids: Identities, name: str) -> list[dict]:
    """What do I owe <name>: Tasks OWED_BY me and OWED_TO them, plus threads
    with them that wait on my reply."""
    pid, _ = find_person(g, ids, name)
    out = [t for t in g.into(pid, "OWED_TO") if any(e["dst"] == ME for e in g.edges(src=t["id"], verb="OWED_BY"))]
    for thread in g.into(pid, "PARTICIPANT"):
        if any(e["dst"] == ME for e in g.edges(src=thread["id"], verb="AWAITS_REPLY_FROM")):
            out.append(thread)
    return out


def waiting_longest(g: Graph) -> list[tuple[dict, str]]:
    """Who has been waiting on me longest: threads AWAITING me, oldest first,
    with the people in them."""
    rows = []
    for e in g.edges(verb="AWAITS_REPLY_FROM", dst=ME):
        node = g.node(e["src"])
        if node:
            rows.append((node, e["props"].get("since", "")))
    rows.sort(key=lambda r: when_of(r[1]))
    return rows


def due_before(g: Graph, anchor_label: str) -> list[dict]:
    """What's due before <anchor>: the anchor is a node found by its exact
    label (an Assignment or Event); everything else owed by me and DUE_ON an
    earlier day, soonest first."""
    want = anchor_label.lower()
    anchors = [n for n in g.nodes() if n["type"] in ("Assignment", "Event", "Task") and n["label"].lower() == want]
    if len(anchors) != 1:
        raise LookupError(f"{len(anchors)} things are called {anchor_label!r}")
    cutoff = due_day(g, anchors[0]["id"])
    if not cutoff:
        raise LookupError(f"{anchor_label} has no due date")
    out = []
    for e in g.edges(verb="DUE_ON"):
        if e["src"] == anchors[0]["id"] or e["dst"][4:] >= cutoff:
            continue
        node = g.node(e["src"])
        if node and node["props"].get("guess"):
            continue
        if node and any(o["dst"] == ME for o in g.edges(src=node["id"], verb="OWED_BY")):
            out.append((e["dst"][4:], node))
    return [n for _, n in sorted(out, key=lambda x: x[0])]
