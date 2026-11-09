#!/usr/bin/env python3
"""chewbacca gtm-memory: the relationship store's architecture for GTM clients, accounts, contacts and Clay.

    gtm-memory ingest [--clay] [--dry-run]       OS graph (and Clay tables, columns, credits) into memory
    gtm-memory account DOMAIN                    people there (past and current), scores, summary, timeline
    gtm-memory contact EMAIL|LINKEDIN            facts with sources, superseded values, jobs, what is owed
    gtm-memory timeline [EMAIL|DOMAIN]           sends, replies, verdicts, meetings, newest first
    gtm-memory overdue                           commitments past due, then contacts cooling off
    gtm-memory why DOMAIN|EMAIL                  score history and the evidence behind the biggest jump
    gtm-memory credits [--by column|table|client]
    gtm-memory experiments                       arms, samples and the playbook verdict
    gtm-memory warm                              contacts already in your people store (read only)
    gtm-memory check                             identity conflicts and integrity
    gtm-memory owe TITLE --due WHEN [--by us|client] [--contact EMAIL]
    gtm-memory done COMMITMENT_ID
    gtm-memory hypothesis EXPERIMENT_ID TEXT [--lever L] [--copy REF]
    gtm-memory verdict EMAIL good_fit|not_fit --by NAME
    gtm-memory measure TABLE_ID COLUMN_ID --credits N [--rows R] [--note TEXT]

Every query reads ~/.chewbacca/gtm/memory.db only. With more than one client on
file a query needs --client NAME, or --all-clients to cross clients on purpose.
Add --json to anything.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LIB = Path(__file__).resolve().parent.parent / "bin" / "lib"
sys.path.insert(0, str(LIB))
import gtm_memory as m  # noqa: E402
import gtm_memory_query as q  # noqa: E402


def pct(x) -> str:
    return "  -" if x is None else f"{x * 100:3.0f}%"


def fresh(d: dict) -> list[str]:
    f = d.get("freshness") or {}
    if not f.get("last_ingest"):
        return ["", "memory never ingested: chewbacca gtm-memory ingest"]
    return ["", f"memory as of {f['last_ingest']} ({f['age']}, sources: {f.get('sources')})"]


def score_line(s) -> str:
    if not s:
        return "no score"
    return (f"fit {pct(s['fit'])}  intent {pct(s['intent'])}  engagement {pct(s['engagement'])}  "
            f"temperature {pct(s['temperature'])}")


def event_line(e: dict) -> str:
    bits = [e["happened_at"][:16].replace("T", " "), f"{e['kind']:<14}"]
    if e.get("client"):
        bits.append(f"[{e['client']}]")
    if e.get("who"):
        bits.append(e["who"])
    if e["kind"] == "send":
        bits.append(f"step {e.get('step')} of {e.get('campaign') or e.get('campaign_id')}")
    if e["kind"] == "reply":
        d = e.get("detail") or {}
        bits.append(f"{e.get('reply_class') or 'unclassified'} by {e.get('classified_by') or 'nobody'}"
                    + (" (answered)" if d.get("answered") else ""))
    if e["kind"] == "client_verdict":
        bits.append(f"{(e.get('detail') or {}).get('verdict')} by {e.get('classified_by')}")
    bits.append(f"<{e['source']}>")
    return "  " + "  ".join(str(b) for b in bits)


def show_contact(d: dict) -> list[str]:
    out = []
    for v in d["clients"]:
        name = (v["facts"].get("name") or {}).get("value") or d["contact_id"]
        out += [f"{name}  [{v['client']}]", "  " + score_line(v["score"]), "", "  facts"]
        for k, f in v["facts"].items():
            cost = f" {f['cost_credits']} cr" if f.get("cost_credits") else ""
            out.append(f"    {k:<16} {f['value'][:60]:<60} {f['source']}/{f.get('provider') or '-'} "
                       f"{f['observed_at'][:10]} conf {f['confidence']:.2f}{cost}")
        if v["superseded"]:
            out.append("  superseded (kept)")
            for h in v["superseded"]:
                out.append(f"    {h['attribute']:<16} {h['value'][:60]:<60} {h['observed_at'][:10]} -> "
                           f"replaced {str(h['superseded_at'])[:10]}")
        if v["employment"]:
            out.append("  employment")
            for j in v["employment"]:
                out.append(f"    {j['domain']:<28} {j['started_at'][:10]} to {(j['ended_at'] or 'now')[:10]}"
                           + (f"  ({j['end_reason']})" if j["end_reason"] else ""))
        for o in v["open_commitments"]:
            out.append(f"  OWED by {o['owed_by']}: {o['title']} due {str(o['due_at'])[:16]}")
        out += ["  timeline"] + [event_line(e) for e in v["timeline"][:12]] + [""]
    return out + fresh(d)


def show_account(d: dict) -> list[str]:
    out = [", ".join(d["domains"])]
    for v in d["clients"]:
        out += [f"[{v['client']}]  " + score_line(v["score"])]
        if v["summary"]:
            out += ["  " + line for line in v["summary"]["body"].splitlines()]
        out.append("  people")
        for p in v["people"]:
            out.append(f"    {p['name']:<28} {str(p['title'] or '')[:36]:<36} {p['started_at'][:10]} to "
                       f"{(p['ended_at'] or 'now')[:10]}")
        out += ["  timeline"] + [event_line(e) for e in v["timeline"][:15]] + [""]
    return out + fresh(d)


def show_overdue(d: dict) -> list[str]:
    out = []
    if d["late"]:
        out.append(f"LATE ({len(d['late'])})")
        # Replies before refills: a positive left 24 hours loses about half its
        # booking chance, a refill a day late loses a day of volume.
        groups = (("the client owes", lambda r: r["owed_by"] == "client"),
                  ("we owe on replies", lambda r: r["owed_by"] != "client" and r["kind"] != "refill"),
                  ("refills (every step sent to every lead, nothing queued)", lambda r: r["kind"] == "refill"))
        for title, pick in groups:
            rows = [r for r in d["late"] if pick(r)]
            if rows:
                out.append(f"  {title} ({len(rows)})")
                out += [f"    {r['late_by_hours']:>6.1f}h late  {r['title']}  [{r['client']}]" for r in rows]
    else:
        out.append("nothing late")
    if d["upcoming"]:
        out.append(f"\ncoming due ({d['upcoming_total']})")
        for r in d["upcoming"][:10]:
            out.append(f"  {str(r['due_at'])[:16]}  owed by {r['owed_by']:<6} {r['title']}")
    if d["cooling"]:
        out.append("\ncooling: replied once, nothing two-way since")
        for r in d["cooling"][:10]:
            out.append(f"  {r['who']:<30} last two-way {r['last_two_way'][:10]}  engagement {pct(r['engagement'])}")
    return out + fresh(d)


def show_why(d: dict) -> list[str]:
    out = [f"why {d['subject']}"]
    for v in d["clients"]:
        out.append(f"[{v['client']}]")
        if not v.get("jump"):
            out.append("  " + (v.get("note") or "no movement on record"))
            continue
        j = v["jump"]
        out.append(f"  biggest move: {j['dimension']} {pct(j['before'])} -> {pct(j['after'])} "
                   f"between {j['from'][:10]} and {j['to'][:10]}")
        for e in v["evidence"]:
            out.append(f"    {e['at'][:16]}  {e['kind']:<12} {e['class'] or ''}  {e['who']}  <{e['source']}>")
        out.append("  weekly series (recomputed from what was known each week)")
        for s in v["series"][-8:]:
            out.append(f"    {s['as_of'][:10]}  {score_line(s)}")
    return out + fresh(d)


def show_credits(d: dict) -> list[str]:
    out = [f"Clay credits by {d['by']}, {d['window_days']}-day window, synced {d['as_of'] or 'never'}: "
           f"{d['total']} total"]
    for r in d["rows"]:
        if d["by"] == "client":
            out.append(f"  {r['credits']:>9.1f}  {r['client']}")
        elif d["by"] == "table":
            chg = "" if r["change_since_last_sync"] is None else f"  ({r['change_since_last_sync']:+.1f} since last sync)"
            auto = "" if r["auto_run"] is None else ("  auto-run ON" if r["auto_run"] else "  auto-run off")
            out.append(f"  {r['credits']:>9.1f}  {str(r['table'])[:52]:<52} {r['attribution']}{auto}{chg}")
        else:
            cr = "unsplit" if r["credits"] is None else f"{r['credits']:.1f}"
            out.append(f"  {cr:>9}  of {r['table_credits']:>7.1f}  {str(r['table'])[:40]:<40} "
                       f"{str(r['column'])[:60]}  [{r.get('provider') or '-'}]  {r['split']}")
    return out + fresh(d)


def show_experiments(d: dict) -> list[str]:
    out = [f"rule: {d['rule']}"]
    for e in d["experiments"]:
        v = e["verdict"]
        out.append(f"\n{e['name']}  [{e['client']}]  {e['id']}")
        out.append(f"  hypothesis {e['hypothesis']}   lever {e['lever']}   copy {e['copy']}")
        for a in e["arms"]:
            out.append(f"    {a['arm'][:40]:<40} sent {a['sent']:>4}  positive {a['positives']:>2}  "
                       f"rate {pct(a['positive_rate'])}  {a['status'] or ''}")
        out.append(f"  verdict: {v.get('call')}. {v.get('why', '')}")
    return out + fresh(d)


def show_warm(d: dict) -> list[str]:
    out = [f"{len(d['warm'])} contacts you already know (matched by key, nothing copied from people.db)"]
    for w in d["warm"]:
        out.append(f"  {w['name']:<30} {w['matched_on']:<9} {w['key']:<40} -> {w['next']}  [{w['client']}]")
    accts = d.get("warm_accounts") or []
    out.append(f"{len(accts)} accounts where you know someone at the domain")
    for a in accts:
        out.append(f"  {a['domain']:<34} {score_line(a['score'])}  [{a['client']}]")
    if d.get("note"):
        out.append(d["note"])
    return out + fresh(d)


def show_check(d: dict) -> list[str]:
    out = ["ok" if d["ok"] else "problems found"]
    for p in d["problems"]:
        out.append(f"  {p['what']}")
        for r in (p.get("rows") or [])[:5]:
            out.append(f"    {r['kind']} {r['value']}: {r['evidence']}")
    out.append("  " + ", ".join(f"{k} {v}" for k, v in d["stats"].items()))
    return out + fresh(d)


def show_ingest(d: dict) -> list[str]:
    out = [("DRY RUN, nothing written: " if d["dry_run"] else "ingested: ") + json.dumps(d["graph"])]
    if d.get("clay"):
        c = dict(d["clay"])
        errs = c.pop("errors")
        out.append("clay: " + json.dumps(c) + (f"  ({len(errs)} errors: {errs[:3]})" if errs else ""))
    for name, x in d["derived"].items():
        out.append(f"{name}: {json.dumps(x)}")
    return out


def main(argv=None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true")
    common.add_argument("--client")
    common.add_argument("--all-clients", action="store_true")
    ap = argparse.ArgumentParser(prog="gtm-memory", description=__doc__.split("\n")[0], parents=[common],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest", parents=[common])
    p.add_argument("--clay", action="store_true", help="also read Clay tables, columns and credit usage")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--graph")
    for name in ("account", "contact", "why"):
        sub.add_parser(name, parents=[common]).add_argument("who")
    p = sub.add_parser("timeline", parents=[common])
    p.add_argument("who", nargs="?")
    p.add_argument("--limit", type=int, default=50)
    sub.add_parser("overdue", parents=[common])
    p = sub.add_parser("credits", parents=[common])
    p.add_argument("--by", choices=("column", "table", "client"), default="table")
    sub.add_parser("experiments", parents=[common])
    sub.add_parser("warm", parents=[common]).add_argument("--people")
    sub.add_parser("check", parents=[common])
    p = sub.add_parser("owe", parents=[common])
    p.add_argument("title")
    p.add_argument("--due", required=True)
    p.add_argument("--by", choices=("us", "client", "contact"), default="us")
    p.add_argument("--contact")
    sub.add_parser("done", parents=[common]).add_argument("id")
    p = sub.add_parser("hypothesis", parents=[common])
    p.add_argument("id")
    p.add_argument("text")
    p.add_argument("--lever")
    p.add_argument("--copy")
    p = sub.add_parser("verdict", parents=[common])
    p.add_argument("who")
    p.add_argument("call", choices=("good_fit", "not_fit"))
    p.add_argument("--by", required=True)
    p = sub.add_parser("measure", parents=[common])
    p.add_argument("table")
    p.add_argument("column")
    p.add_argument("--credits", type=float, required=True)
    p.add_argument("--rows", type=int)
    p.add_argument("--note")
    a = ap.parse_args(argv)

    try:
        if a.cmd == "ingest":
            db = m.open_db()
            d, show = m.ingest(db, a.graph, clay=a.clay, dry_run=a.dry_run), show_ingest
        elif a.cmd in ("owe", "done", "hypothesis", "verdict", "measure"):
            db = m.open_db()
            d, show = write(db, a), (lambda x: [x["said"]])
        else:
            db = m.open_db(readonly=True)
            scope = m.resolve_scope(db, a.client, a.all_clients)
            d, show = {
                "account": lambda: (q.account(db, scope, a.who), show_account),
                "contact": lambda: (q.contact(db, scope, a.who), show_contact),
                "timeline": lambda: (q.timeline(db, scope, a.who, a.limit),
                                     lambda x: [event_line(e) for e in x["events"]] + fresh(x)),
                "overdue": lambda: (q.overdue(db, scope), show_overdue),
                "why": lambda: (q.why(db, scope, a.who), show_why),
                "credits": lambda: (q.credits(db, scope, a.by), show_credits),
                "experiments": lambda: (q.experiments(db, scope), show_experiments),
                "warm": lambda: (q.warm(db, scope, a.people), show_warm),
                "check": lambda: (q.check(db, scope), show_check),
            }[a.cmd]()
    except m.ScopeError as e:
        print(f"gtm-memory: {e}", file=sys.stderr)
        return 2
    except m.MemoryError_ as e:
        print(f"gtm-memory: {e}", file=sys.stderr)
        return 1
    if a.json:
        print(json.dumps(d, indent=2, default=str))
    else:
        print("\n".join(show(d)))
    return 0


def write(db, a) -> dict:
    """Hand-entered facts. Each needs exactly one client, because a fact with
    no client is a fact every client can read."""
    scope = m.resolve_scope(db, a.client, False)
    if len(scope.ids) != 1:
        raise m.ScopeError("writes need exactly one client: pass --client NAME")
    client = scope.ids[0]
    stamp = m.iso(m.now())
    db.execute("BEGIN IMMEDIATE")
    try:
        if a.cmd == "owe":
            due = m.norm_time(a.due)
            if not due:
                raise m.MemoryError_(f"could not read --due {a.due!r}: use YYYY-MM-DD or an ISO time")
            cid = q.find_contact(db, scope, a.contact)[0] if a.contact else None
            cmt = m.new_id("cmt")
            db.execute("INSERT INTO commitments (id, client_id, kind, owed_by, contact_id, title, due_at, source, origin, "
                       "created_at) VALUES (?, ?, 'deliverable', ?, ?, ?, ?, 'manual', 'manual', ?)",
                       (cmt, client, a.by, cid, m.clip(a.title, 300), due, stamp))
            said = f"owed by {a.by}: {a.title}, due {due} ({cmt})"
        elif a.cmd == "done":
            n = db.execute("UPDATE commitments SET done_at = ?, done_reason = 'marked done' WHERE id = ? AND "
                           "client_id = ? AND done_at IS NULL", (stamp, a.id, client)).rowcount
            if not n:
                raise m.MemoryError_(f"no open commitment {a.id} for {scope.name(client)}")
            said = f"done: {a.id}"
        elif a.cmd == "hypothesis":
            n = db.execute("UPDATE experiments SET hypothesis = ?, lever = COALESCE(?, lever), "
                           "copy_ref = COALESCE(?, copy_ref), updated_at = ? WHERE id = ? AND client_id = ?",
                           (m.clip(a.text, 500), a.lever, a.copy, stamp, a.id, client)).rowcount
            if not n:
                raise m.MemoryError_(f"no experiment {a.id} for {scope.name(client)}")
            said = f"recorded hypothesis on {a.id}"
        elif a.cmd == "verdict":
            cid, _ = q.find_contact(db, scope, a.who)
            m.interact(db, client, "client_verdict", stamp, "manual", f"verdict:{cid}:{stamp}", cid,
                       classified_by=m.clip(a.by, 80), detail={"verdict": a.call})
            m.recompute_scores(db, client)
            m.derive_commitments(db, client)
            said = f"{a.who}: {a.call} by {a.by}"
        else:
            if not db.execute("SELECT 1 FROM clay_tables WHERE id = ? AND client_id = ?", (a.table, client)).fetchone():
                raise m.MemoryError_(f"no Clay table {a.table} for {scope.name(client)}")
            db.execute("INSERT INTO credit_ledger (id, client_id, table_id, column_id, credits, rows, as_of, attribution, "
                       "source, note) VALUES (?, ?, ?, ?, ?, ?, ?, 'column_measured', 'manual measure', ?)",
                       (m.new_id("cr"), client, a.table, a.column, a.credits, a.rows, stamp, m.clip(a.note, 300)))
            said = f"measured {a.credits} credits on {a.table}/{a.column}"
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise
    return {"ok": True, "said": said}


if __name__ == "__main__":
    sys.exit(main())
