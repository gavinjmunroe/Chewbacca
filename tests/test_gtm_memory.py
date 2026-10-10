#!/usr/bin/env python3
"""GTM memory: tenancy, identity, history, decay, credits, warm path and speed.

Synthetic only. The OS graph, Clay answers and people.db here are built in a
temp directory with fake names on example domains; nothing reads Clay, Chrome
or the real stores. Every query must answer in under 100 ms in process.
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
os.environ["GTM_MEMORY_NOW"] = "2026-10-09T12:00:00Z"
import gtm_memory as m  # noqa: E402
import gtm_memory_query as q  # noqa: E402

TOOL = ROOT / "bin" / "gtm-memory"
QUERY_BUDGET_MS = 100.0
CHECKS = 0


def ok(cond, msg=""):
    global CHECKS
    if not cond:
        raise AssertionError(msg or "check failed")
    CHECKS += 1


def raises(exc, fn, msg=""):
    try:
        fn()
    except exc:
        ok(True)
        return
    raise AssertionError(msg or f"expected {exc.__name__}")


# ── a synthetic OS graph ─────────────────────────────────────────────────────

GRAPH_DDL = """
CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL, observed_at TEXT NOT NULL, confidence REAL NOT NULL, unresolved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edges (src TEXT NOT NULL, verb TEXT NOT NULL, dst TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL, observed_at TEXT NOT NULL, confidence REAL NOT NULL, PRIMARY KEY (src, verb, dst, source));
"""


class G:
    def __init__(self, path: Path):
        self.path = path
        if path.exists():
            path.unlink()
        self.db = sqlite3.connect(path)
        self.db.executescript(GRAPH_DDL)

    def node(self, nid, typ, label, props=None, at="2026-10-08T10:00:00Z"):
        self.db.execute("INSERT OR REPLACE INTO nodes VALUES (?, ?, ?, ?, 'test', ?, 1.0, 0)",
                        (nid, typ, label, json.dumps(props or {}), at))

    def edge(self, src, verb, dst, props=None, at="2026-10-08T10:00:00Z"):
        self.db.execute("INSERT OR REPLACE INTO edges VALUES (?, ?, ?, ?, 'test', ?, 1.0)",
                        (src, verb, dst, json.dumps(props or {}), at))

    def client(self, cid, name, ws):
        self.node(cid, "Client", name, {"principal": "P", "workspaces": [ws]})
        self.node(f"workspace:clay:{ws}", "Workspace", f"{name} ws", {"workspace_id": ws})
        self.edge(cid, "OWNS", f"workspace:clay:{ws}")

    def campaign(self, cam, client, ws, name, leads, sent, status="active", offer="Offer"):
        self.node(f"campaign:clay:{cam}", "Campaign", name, {
            "campaign_id": cam, "workspace_id": ws, "status": status, "name": name, "offer": offer,
            "analytics": {"leads": leads, "sent": sent, "replies": 0, "bounces": 0},
            "analytics_as_of": "2026-10-08T10:00:00Z"})
        self.edge(f"campaign:clay:{cam}", "FOR_CLIENT", client)
        return f"campaign:clay:{cam}"

    def enroll(self, cam, email, name, title="Partner", linkedin="", dates=("2026-10-01",), at=None):
        pid = f"person:handle:{email}"
        self.node(pid, "Person", email, {"handle": email})
        self.edge(cam, "ENROLLED", pid, {"email": email, "name": name, "title": title, "linkedin_url": linkedin,
                                         "record_ids": ["r1"], "sent_dates": list(dates), "replied": False,
                                         "bounced": False}, at=at or "2026-10-08T10:00:00Z")

    def reply(self, rid, cam, email, at, cls, by="model:reply-intent", answered=False, ws="1"):
        self.node(rid, "Reply", f"reply {email}", {"lead_email": email, "time": at, "answered": answered,
                                                   "forwarded": False, "subject": "Re: hello", "workspace_id": ws})
        self.edge(rid, "IN_CAMPAIGN", cam)
        self.node(f"replyclass:{cls}", "ReplyClass", cls)
        self.edge(rid, "CLASSIFIED_AS", f"replyclass:{cls}", {"by": [by], "raw": [cls]})

    def close(self):
        self.db.commit()
        self.db.close()


def two_client_graph(path: Path) -> Path:
    g = G(path)
    g.client("client:alpha", "Alpha Fund", "1")
    g.client("client:beta", "Beta Raise", "2")
    a = g.campaign("ca1", "client:alpha", "1", "Alpha | Ivy | Seed | Wave 2", 3, 3)
    b = g.campaign("cb1", "client:beta", "2", "Beta | Qube | Seed | Jonah list", 2, 2)
    # One investor, emailed for both clients, under a different title each.
    g.enroll(a, "pat@shared.example", "Pat Rivera", "Partner")
    g.enroll(b, "pat@shared.example", "Pat Rivera", "General Partner")
    # Same name, different people: never one contact.
    g.enroll(a, "jordan.lee@one.example", "Jordan Lee", "Principal")
    g.enroll(a, "jordan.lee@two.example", "Jordan Lee", "Analyst")
    g.enroll(b, "beta.only@betafirm.example", "Morgan Beta", "Partner")
    g.reply("reply:a1", a, "pat@shared.example", "2026-10-07T09:00:00Z", "positive")
    g.reply("reply:b1", b, "beta.only@betafirm.example", "2026-10-07T10:00:00Z", "neutral", ws="2")
    g.close()
    return path


def fresh_db(tmp: Path, name: str) -> sqlite3.Connection:
    p = tmp / f"{name}.db"
    for suffix in ("", "-wal", "-shm"):
        Path(str(p) + suffix).unlink(missing_ok=True)
    return m.open_db(p)


# ── tests ────────────────────────────────────────────────────────────────────


def test_tenancy(tmp: Path):
    gpath = two_client_graph(tmp / "g2.sqlite")
    db = fresh_db(tmp, "tenancy")
    m.ingest(db, gpath)
    raises(m.ScopeError, lambda: m.resolve_scope(db), "two clients and no flag must refuse")
    alpha = m.resolve_scope(db, "Alpha Fund")
    beta = m.resolve_scope(db, "beta-raise")
    both = m.resolve_scope(db, all_clients=True)
    ok(both.crossed and len(both.ids) == 2)

    # One identity, two client-scoped histories.
    owners = db.execute("SELECT COUNT(DISTINCT contact_id) FROM contact_keys WHERE value = 'pat@shared.example'").fetchone()[0]
    ok(owners == 1, "a shared investor is one contact")
    va = q.contact(db, alpha, "pat@shared.example")
    vb = q.contact(db, beta, "pat@shared.example")
    ok(va["contact_id"] == vb["contact_id"])
    ok([v["client"] for v in va["clients"]] == ["Alpha Fund"], va["clients"])
    ok(va["clients"][0]["facts"]["title"]["value"] == "Partner")
    ok(vb["clients"][0]["facts"]["title"]["value"] == "General Partner", "beta's title stays beta's")
    ok(all(e["kind"] != "reply" or e["reply_class"] == "positive" for e in va["clients"][0]["timeline"]))
    ok(not any("General Partner" in json.dumps(v) for v in va["clients"]), "alpha never reads beta's facts")
    raises(q.NotFound, lambda: q.contact(db, alpha, "beta.only@betafirm.example"),
           "a contact only beta knows is not found under alpha")
    tl = q.timeline(db, alpha)
    ok(tl["events"] and all(e["client"] == "Alpha Fund" for e in tl["events"]))
    ov = q.overdue(db, alpha)
    ok(all(r["client"] == "Alpha Fund" for r in ov["late"] + ov["upcoming"]))
    ok(len(q.timeline(db, both)["events"]) > len(tl["events"]), "all-clients crosses on purpose")
    # Every fact row carries a client.
    for table in ("observations", "interactions", "employment", "commitments", "scores", "summaries"):
        ok(db.execute(f"SELECT COUNT(*) FROM {table} WHERE client_id IS NULL").fetchone()[0] == 0, table)
    # CLI: no flag with two clients exits 2, --client works.
    env = dict(os.environ, GTM_MEMORY_DB=str(tmp / "tenancy.db"))
    out = subprocess.run([sys.executable, str(TOOL), "overdue"], capture_output=True, text=True, env=env, timeout=60)
    ok(out.returncode == 2 and "--client" in out.stderr, out.stderr)
    out = subprocess.run([sys.executable, str(TOOL), "contact", "pat@shared.example", "--client", "Alpha Fund",
                          "--json"], capture_output=True, text=True, env=env, timeout=60)
    ok(out.returncode == 0, out.stderr)
    ok(json.loads(out.stdout)["clients"][0]["client"] == "Alpha Fund")
    db.close()


def test_no_name_merges(tmp: Path):
    db = fresh_db(tmp, "names")
    m.ensure_client(db, "client:x", "X")
    a, _ = m.resolve_contact(db, "client:x", "jordan.lee@one.example", "", "Jordan Lee")
    b, _ = m.resolve_contact(db, "client:x", "jordan.lee@two.example", "", "Jordan Lee")
    ok(a != b, "two emails under one name are two contacts")
    none, how = m.resolve_contact(db, "client:x", "", "", "Jordan Lee")
    ok(none is None and how == "no key", "a name alone never creates a contact")
    # A slug joins a new email only when the surname agrees.
    c, _ = m.resolve_contact(db, "client:x", "sam.okafor@old.example", "https://linkedin.com/in/sam-o", "Sam Okafor")
    m.observe(db, "client:x", "contact", c, "name", "Sam Okafor", "manual")
    d, how = m.resolve_contact(db, "client:x", "sam@other.example", "linkedin.com/in/sam-o", "Sam Whitfield")
    ok(d != c and how == "new (slug refused)", "a different surname refuses the slug join")
    ok(db.execute("SELECT COUNT(*) FROM identity_conflicts WHERE value = 'sam-o'").fetchone()[0] == 1,
       "the refusal is logged")
    e, how = m.resolve_contact(db, "client:x", "sam@new.example", "linkedin.com/in/sam-o", "Sam Okafor")
    ok(e == c and how == "linkedin", "same slug and surname join the new email")
    # Through the graph: the two Jordan Lees stay apart.
    gpath = two_client_graph(tmp / "g3.sqlite")
    db2 = fresh_db(tmp, "names2")
    m.ingest(db2, gpath)
    n = db2.execute("SELECT COUNT(DISTINCT contact_id) FROM contact_keys WHERE value LIKE 'jordan.lee@%'").fetchone()[0]
    ok(n == 2, n)
    db.close()
    db2.close()


def test_job_change_history(tmp: Path):
    g = G(tmp / "g4.sqlite")
    g.client("client:alpha", "Alpha Fund", "1")
    c1 = g.campaign("w1", "client:alpha", "1", "Alpha | Ivy | Seed | Wave 1", 1, 1)
    c2 = g.campaign("w2", "client:alpha", "1", "Alpha | Ivy | Seed | Wave 2", 1, 1)
    g.enroll(c1, "riley@oldfund.example", "Riley Chen", "Associate", "https://linkedin.com/in/rileychen",
             dates=("2026-09-01",), at="2026-09-01T10:00:00Z")
    g.enroll(c2, "riley@newfund.example", "Riley Chen", "Partner", "https://www.linkedin.com/in/RileyChen/",
             dates=("2026-10-01",), at="2026-10-01T10:00:00Z")
    g.close()
    db = fresh_db(tmp, "jobs")
    m.ingest(db, g.path)
    scope = m.resolve_scope(db)
    v = q.contact(db, scope, "riley@newfund.example")["clients"][0]
    jobs = v["employment"]
    ok([j["domain"] for j in jobs] == ["oldfund.example", "newfund.example"], jobs)
    ok(jobs[0]["ended_at"] == jobs[1]["started_at"] and jobs[1]["ended_at"] is None, "the old job closes, not vanishes")
    ok(v["facts"]["email"]["value"] == "riley@newfund.example")
    ok(any(h["attribute"] == "email" and h["value"] == "riley@oldfund.example" for h in v["superseded"]),
       "the old address is kept as history")
    ok(any(h["attribute"] == "title" and h["value"] == "Associate" for h in v["superseded"]))
    ok(q.contact(db, scope, "riley@oldfund.example")["contact_id"] == q.contact(db, scope, "linkedin.com/in/rileychen")["contact_id"])
    # Re-ingesting is a no-op for history.
    m.ingest(db, g.path)
    ok(db.execute("SELECT COUNT(*) FROM employment").fetchone()[0] == 2)
    db.close()


def test_supersede_not_erase(tmp: Path):
    db = fresh_db(tmp, "obs")
    m.ensure_client(db, "client:x", "X")
    first = m.observe(db, "client:x", "contact", "ct_1", "title", "Analyst", "clay_column", "t1/f1",
                      "2026-09-01T00:00:00Z", provider="leadmagic", cost_credits=2.0, confidence=0.7)
    again = m.observe(db, "client:x", "contact", "ct_1", "title", "Analyst", "clay_column", "t1/f1",
                      "2026-09-05T00:00:00Z")
    ok(first == again, "the same value confirms, not duplicates")
    second = m.observe(db, "client:x", "contact", "ct_1", "title", "Partner", "website", "https://firm.example/team",
                       "2026-10-01T00:00:00Z", confidence=0.9)
    rows = {r["id"]: dict(r) for r in db.execute("SELECT * FROM observations WHERE subject_id = 'ct_1'")}
    ok(len(rows) == 2 and rows[first]["superseded_by"] == second, "old value kept, pointing at its replacement")
    ok(rows[first]["cost_credits"] == 2.0 and rows[first]["provider"] == "leadmagic", "provenance survives")
    late = m.observe(db, "client:x", "contact", "ct_1", "title", "Senior Analyst", "clay_column", "t1/f1",
                     "2026-09-15T00:00:00Z")
    ok(m.current_facts(db, "client:x", "contact", "ct_1")["title"]["value"] == "Partner",
       "an older value arriving late never rolls the fact back")
    ok(db.execute("SELECT superseded_by FROM observations WHERE id = ?", (late,)).fetchone()[0] == second)
    ok(db.execute("SELECT COUNT(*) FROM observations WHERE subject_id = 'ct_1'").fetchone()[0] == 3)
    db.close()


def test_score_decay():
    P = {k: v for k, v, _ in m.SEED_PARAMS}
    as_of = m.parse_time("2026-10-09T12:00:00Z")

    def it(kind, at, cls=None, iid="i"):
        return {"id": iid, "kind": kind, "happened_at": at, "reply_class": cls, "detail": "{}", "source": "t"}

    s = m.score_evidence([it("reply", "2026-08-25T12:00:00Z", "positive")], [], P, as_of)  # 45 days
    ok(abs(s["engagement"] - (1 - math.exp(-0.8 * 0.5))) < 1e-3, s)
    s = m.score_evidence([it("reply", "2026-09-18T12:00:00Z", "neutral")], [], P, as_of)  # 21 days
    ok(abs(s["temperature"] - 0.5) < 1e-3, s)
    sends = [it("send", f"2026-10-0{d}T12:00:00Z", iid=f"s{d}") for d in range(1, 9)]
    s = m.score_evidence(sends, [], P, as_of)
    ok(s["temperature"] == 0 and s["engagement"] == 0, "sends never warm anyone")
    s = m.score_evidence([it("reply", "2026-10-20T12:00:00Z", "positive")], [], P, as_of)
    ok(s["engagement"] == 0, "evidence after as_of is invisible")
    s = m.score_evidence([it("reply", "2026-10-08T12:00:00Z", "positive"),
                          it("reply", "2026-10-09T00:00:00Z", "unsubscribe", "u")], [], P, as_of)
    ok(s["engagement"] == 0, "an unsubscribe zeroes engagement")
    fact = {"id": "f", "attribute": "signal:form_d", "value": "raised", "observed_at": "2026-09-09T12:00:00Z",
            "source_kind": "form_d"}
    s = m.score_evidence([], [fact], P, as_of)
    ok(abs(s["intent"] - (1 - math.exp(-0.8 * 0.5))) < 1e-3, s)
    combined = m.combine([{"fit": 0.3, "intent": 0.5, "engagement": 0.5, "temperature": 0.2, "drivers": []},
                          {"fit": 0.9, "intent": 0.5, "engagement": 0.0, "temperature": 0.7, "drivers": []}])
    ok(combined["fit"] == 0.9 and combined["intent"] == 0.75 and combined["temperature"] == 0.7, combined)


def test_why_and_commitments(tmp: Path):
    gpath = two_client_graph(tmp / "g5.sqlite")
    db = fresh_db(tmp, "why")
    m.ingest(db, gpath)
    alpha = m.resolve_scope(db, "Alpha Fund")
    ov = q.overdue(db, alpha)
    appr = [r for r in ov["late"] if r["kind"] == "approval_owed"]
    ok(len(appr) == 1 and appr[0]["owed_by"] == "client", ov)
    w = q.why(db, alpha, "shared.example")["clients"][0]
    ok(w["jump"]["dimension"] in ("engagement", "temperature") and w["jump"]["delta"] > 0, w["jump"])
    ok(any(e["kind"] == "reply" for e in w["evidence"]), "the reply that moved it is named")
    # A good-fit verdict turns the client's approval into our reply, due in 30 minutes.
    cid = q.find_contact(db, alpha, "pat@shared.example")[0]
    db.execute("BEGIN")
    m.interact(db, "client:alpha", "client_verdict", "2026-10-08T09:00:00Z", "manual", "v1", cid,
               classified_by="Jonah", detail={"verdict": "good_fit"})
    stats = m.derive_commitments(db, "client:alpha")
    db.execute("COMMIT")
    ok(stats["closed"] == 1 and stats["opened"] == 1, stats)
    owed = db.execute("SELECT kind, owed_by, due_at FROM commitments WHERE client_id = 'client:alpha' AND done_at IS NULL "
                      "AND kind = 'reply_owed'").fetchone()
    ok(owed and owed["owed_by"] == "us" and owed["due_at"] == "2026-10-08T09:30:00Z", dict(owed) if owed else None)
    closed = db.execute("SELECT done_reason FROM commitments WHERE kind = 'approval_owed' AND client_id = 'client:alpha'"
                        ).fetchone()
    ok(closed["done_reason"] == "condition cleared on ingest", "closed, not deleted")
    db.close()


def test_dry_run_writes_nothing(tmp: Path):
    gpath = two_client_graph(tmp / "g6.sqlite")
    db = fresh_db(tmp, "dry")
    rep = m.ingest(db, gpath, dry_run=True)
    ok(rep["graph"]["contacts_new"] == 4, rep)
    for t in ("contacts", "observations", "interactions", "commitments", "ingest_runs"):
        ok(db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] == 0, t)
    db.close()


def fake_clay(credit_by_table: dict, columns: dict, auto: dict):
    calls = []

    def run(op, **args):
        calls.append((op, args))
        if op not in m.CLAY_READS:
            raise AssertionError(f"wrote through {op}")
        if op == "tables":
            return {"ok": True, "data": [{"id": t, "name": f"Table {t}", "workbook": {"id": "wb1", "name": "WB"}}
                                         for t in columns]}
        if op == "table":
            return {"ok": True, "data": {"type": "people", "tableSettings": {"AUTO_RUN_ON": auto[args["table"]],
                                                                             "AUTO_RUN_MODE": "keep_existing"}}}
        if op == "columns":
            return {"ok": True, "data": columns[args["table"]]}
        if op == "credit-usage":
            return {"ok": True, "data": {"entities": [{"id": "wb1", "entity": {"__kind": "workbook", "name": "WB"},
                                                       "credits": sum(credit_by_table.values()) + 5,
                                                       "subentities": [
                                                           {"id": t, "entity": {"__kind": "table", "name": f"Table {t}"},
                                                            "credits": c, "actionExecutions": int(c * 4)}
                                                           for t, c in credit_by_table.items()]}],
                                         "unattributedCredits": 1.5}}
        raise AssertionError(op)
    return run, calls


def action(cid, name, key, cond=""):
    return {"id": cid, "name": name, "type": "action",
            "settings": {"type": "action", "actionKey": key, "authAccountId": "aa_secret",
                         "conditionalRunFormulaText": cond}}


def test_credit_ledger(tmp: Path):
    g = G(tmp / "g7.sqlite")
    g.client("client:alpha", "Alpha Fund", "1")
    g.close()
    db = fresh_db(tmp, "credits")
    m.ingest(db, g.path)
    cols = {"t_a": [action("f1", "Find work email", "leadmagic-find-work-email"),
                    action("f2", "Validate", "findymail-validate-email", "{{f1}}"),
                    {"id": "f3", "name": "Full Name", "type": "basic"}],
            "t_b": [action("f9", "Claygent", "use-ai")]}
    run, calls = fake_clay({"t_a": 246.5, "t_b": 3400.0}, cols, {"t_a": True, "t_b": False})
    os.environ["GTM_MEMORY_NOW"] = "2026-10-08T12:00:00Z"
    m.ingest(db, g.path, clay=True, runner=run)
    ok({c[0] for c in calls} <= m.CLAY_READS, "only reads")
    scope = m.resolve_scope(db)
    by_table = q.credits(db, scope, "table")
    ok(abs(by_table["total"] - (246.5 + 3400 + 5 + 1.5)) < 1e-6, by_table["total"])
    top = by_table["rows"][0]
    ok(top["table_id"] == "t_b" and top["credits"] == 3400.0 and top["auto_run"] is False, top)
    ok({r["attribution"] for r in by_table["rows"]} == {"table", "workbook", "unattributed"})
    by_client = q.credits(db, scope, "client")
    ok(by_client["rows"] == [{"client": "Alpha Fund", "credits": 3653.0}], by_client["rows"])
    by_col = q.credits(db, scope, "column")
    row_a = next(r for r in by_col["rows"] if r["table"] == "Table t_a")
    ok(row_a["credits"] is None and "not measured" in row_a["split"], row_a)
    ok(row_a["provider"] == "findymail, leadmagic" and "Full Name" not in row_a["column"], row_a)
    ok("aa_secret" not in json.dumps([dict(r) for r in db.execute("SELECT * FROM clay_column_versions")]),
       "a credential id never lands in the store")
    # A measured column shows as measured; a second sync shows the change and a config version.
    db.execute("INSERT INTO credit_ledger (id, client_id, table_id, column_id, credits, rows, as_of, attribution, source) "
               "VALUES ('m1', 'client:alpha', 't_b', 'f9', 21.0, 1, '2026-10-08T12:00:00Z', 'column_measured', 'manual')")
    cols["t_a"][1] = action("f2", "Validate", "findymail-validate-email", "{{f1}} && true")
    cols["t_a"] = cols["t_a"][:2]
    run2, _ = fake_clay({"t_a": 250.0, "t_b": 3400.0}, cols, {"t_a": True, "t_b": False})
    os.environ["GTM_MEMORY_NOW"] = "2026-10-09T12:00:00Z"
    m.ingest(db, g.path, clay=True, runner=run2)
    by_table = q.credits(db, scope, "table")
    ta = next(r for r in by_table["rows"] if r["table_id"] == "t_a")
    ok(ta["change_since_last_sync"] == 3.5, ta)
    ok(db.execute("SELECT COUNT(*) FROM clay_column_versions WHERE column_id = 'f2'").fetchone()[0] == 2,
       "a config change is a new version, the old one kept")
    ok(db.execute("SELECT deleted_at FROM clay_columns WHERE id = 'f3'").fetchone()[0] is not None,
       "a removed column is soft-deleted")
    by_col = q.credits(db, scope, "column")
    meas = next(r for r in by_col["rows"] if r["split"] == "measured")
    ok(meas["column"] == "Claygent" and meas["credits"] == 21.0 and meas["table_credits"] == 3400.0, meas)
    db.close()


def people_store(path: Path) -> Path:
    path.unlink(missing_ok=True)
    p = sqlite3.connect(path)
    p.executescript("""
      CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT, phone TEXT, email TEXT, linkedin TEXT, how_we_met TEXT,
                           deleted_at TEXT);
      CREATE TABLE identities (person_id TEXT, kind TEXT, value TEXT, PRIMARY KEY (kind, value));
      CREATE TABLE observations (id TEXT, person_id TEXT, body TEXT);
    """)
    p.execute("INSERT INTO people VALUES ('pp1', 'Privatename Zzyx', '+15550001111', NULL, "
              "'https://linkedin.com/in/morgan-beta', 'met at a funeral', NULL)")
    p.execute("INSERT INTO identities VALUES ('pp1', 'email', 'pat@shared.example')")
    p.execute("INSERT INTO identities VALUES ('pp2', 'email', 'quietfriend@betafirm.example')")
    p.execute("INSERT INTO observations VALUES ('o1', 'pp1', 'SECRET-NOTE-QQQ going through a divorce')")
    p.commit()
    p.close()
    return path


def test_warm_path(tmp: Path):
    gpath = two_client_graph(tmp / "g8.sqlite")
    db = fresh_db(tmp, "warm")
    m.ingest(db, gpath)
    store = people_store(tmp / "people.db")
    alpha = m.resolve_scope(db, "Alpha Fund")
    w = q.warm(db, alpha, store)
    ok([x["key"] for x in w["warm"]] == ["pat@shared.example"] and w["warm"][0]["matched_on"] == "email", w)
    blob = json.dumps(w)
    for leak in ("Privatename", "Zzyx", "+15550001111", "SECRET-NOTE", "funeral", "pp1"):
        ok(leak not in blob, f"warm output leaked {leak}")
    dump = "\n".join(db.iterdump())
    for leak in ("Privatename", "+15550001111", "SECRET-NOTE", "funeral", "pp1"):
        ok(leak not in dump, f"memory.db stored {leak}")
    ok(not any(x["client"] == "Beta Raise" for x in w["warm"]), "alpha's warm list holds alpha's contacts only")
    ok([a["domain"] for a in w["warm_accounts"]] == ["shared.example"], "alpha never sees beta's firm as warm")
    wb = q.warm(db, m.resolve_scope(db, "Beta Raise"), store)
    ok(sorted(a["domain"] for a in wb["warm_accounts"]) == ["betafirm.example", "shared.example"], wb["warm_accounts"])
    ok("quietfriend" not in json.dumps(wb), "only the domain crosses, never the address")
    db.close()


def test_experiments():
    arm = lambda name, sent, pos, first="2026-09-01T00:00:00Z": {  # noqa: E731
        "arm": name, "sent": sent, "bounces": 0, "ooo": 0, "positives": pos, "first_sent_at": first}
    as_of = m.parse_time("2026-10-09T12:00:00Z")
    ok(m.verdict([arm("a", 900, 9)], as_of)["call"] == "single arm")
    ok(m.verdict([arm("a", 217, 3), arm("b", 9, 1)], as_of)["call"] == "don't know yet")
    ok(m.verdict([arm("a", 600, 9, "2026-10-01T00:00:00Z"), arm("b", 600, 3)], as_of)["call"] == "too early")
    v = m.verdict([arm("a", 600, 12), arm("b", 600, 6)], as_of)
    ok(v["call"] == "adopt" and v["winner"] == "a", v)
    ok(m.verdict([arm("a", 1000, 115), arm("b", 1000, 100)], as_of)["call"] == "replicate")
    ok(m.verdict([arm("a", 1000, 105), arm("b", 1000, 100)], as_of)["call"] == "inconclusive")
    ok(m.campaign_parts("Zeutara | Ivy | Pre-seed investors | Midweek founder story") == ("Midweek", "Midweek founder story"))


def big_graph(path: Path, n: int = 5000) -> Path:
    g = G(path)
    g.client("client:big", "Big Client", "9")
    cams = [g.campaign(f"c{i}", "client:big", "9", f"Big | Offer{i % 4} | Seed | Wave {i % 3} arm{i}", 250, 250)
            for i in range(20)]
    for i in range(n):
        g.enroll(cams[i % 20], f"lead{i}@firm{i % 900}.example", f"Lead {i} Person{i}", "Partner" if i % 3 else "Analyst",
                 f"https://linkedin.com/in/lead{i}", dates=("2026-10-01", "2026-10-04"))
    for i in range(0, n, 17):
        g.reply(f"reply:{i}", cams[i % 20], f"lead{i}@firm{i % 900}.example", f"2026-10-0{1 + i % 8}T10:00:00Z",
                ["positive", "neutral", "negative", "ooo"][i % 4], ws="9")
    g.close()
    return path


def test_speed(tmp: Path) -> dict:
    gpath = big_graph(tmp / "big.sqlite")
    db = fresh_db(tmp, "big")
    t0 = time.perf_counter()
    m.ingest(db, gpath)
    ingest_s = time.perf_counter() - t0
    db.close()
    db = m.open_db(tmp / "big.db", readonly=True)
    scope = m.resolve_scope(db)
    warm_store = people_store(tmp / "big-people.db")
    queries = {
        "contact": lambda: q.contact(db, scope, "lead4321@firm721.example"),
        "account": lambda: q.account(db, scope, "firm721.example"),
        "timeline": lambda: q.timeline(db, scope),
        "overdue": lambda: q.overdue(db, scope),
        "why": lambda: q.why(db, scope, "firm17.example"),
        "credits --by column": lambda: q.credits(db, scope, "column"),
        "experiments": lambda: q.experiments(db, scope),
        "warm": lambda: q.warm(db, scope, warm_store),
    }
    timings = {}
    for name, fn in queries.items():
        best = min(_timed(fn) for _ in range(3))
        timings[name] = best
        ok(best < QUERY_BUDGET_MS, f"{name} took {best:.1f} ms on 5,000 leads")
    # `check` scans every table and runs the foreign-key check, like `people
    # check`. It is a health pass, not a question, so it is timed, not budgeted.
    timings["check (unbudgeted)"] = _timed(lambda: q.check(db, scope))
    db.close()
    env = dict(os.environ, GTM_MEMORY_DB=str(tmp / "big.db"))
    start = time.perf_counter()
    out = subprocess.run([sys.executable, str(TOOL), "overdue", "--json"], capture_output=True, text=True, env=env,
                         timeout=60)
    timings["cli overdue (wall)"] = (time.perf_counter() - start) * 1000
    ok(out.returncode == 0, out.stderr)
    out = subprocess.run([sys.executable, "-X", "importtime", str(TOOL), "overdue"], capture_output=True, text=True,
                         env=env, timeout=60)
    loaded = {line.rsplit("|", 1)[-1].strip() for line in out.stderr.splitlines() if "|" in line}
    ok(not loaded & {"gtm_ingest", "osgraph", "subprocess", "concurrent"}, "a query never loads the ingest side")
    return {"ms": timings, "ingest_s": ingest_s}


def _timed(fn) -> float:
    start = time.perf_counter()
    fn()
    return (time.perf_counter() - start) * 1000


def test_dispatch():
    out = subprocess.run(["bash", str(ROOT / "bin" / "chewbacca"), "gtm-memory", "--help"], capture_output=True,
                         text=True, timeout=60)
    ok(out.returncode == 0 and "gtm-memory" in out.stdout, out.stderr)


def main():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        test_tenancy(tmp)
        test_no_name_merges(tmp)
        test_job_change_history(tmp)
        test_supersede_not_erase(tmp)
        test_score_decay()
        test_why_and_commitments(tmp)
        test_dry_run_writes_nothing(tmp)
        test_credit_ledger(tmp)
        test_warm_path(tmp)
        test_experiments()
        test_dispatch()
        speed = test_speed(tmp)
    print(f"gtm-memory: {CHECKS} checks passed; ingest of 5,000 leads {speed['ingest_s']:.1f}s; ms: "
          + ", ".join(f"{k} {v:.1f}" for k, v in speed["ms"].items()))


if __name__ == "__main__":
    main()
