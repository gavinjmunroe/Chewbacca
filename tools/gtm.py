#!/usr/bin/env python3
"""chewbacca gtm: every GTM client's campaigns, sends, replies and meetings, from the local graph.

    gtm clients                          every client, with its funnel
    gtm client NAME                      offers, campaigns, sent/replied/positive/booked
    gtm lead EMAIL|NAME                  one person's whole history across clients
    gtm replies [--unanswered] [--client NAME] [--all]
    gtm suppress --client NAME [--csv]   addresses actually emailed, for refills
    gtm funnel --client NAME             sent, replied, positive, meetings, with denominators
    gtm sync [--source clay|inbox|calendar] [--background]

Queries read ~/.chewbacca/os-graph.sqlite only and answer in milliseconds.
`sync` is the one command that reads Clay, the Clay inbox tab and the
calendar; it is read only against all three. Every answer says when each
source last synced. Add --json to any command.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

LIB = Path(__file__).resolve().parent.parent / "bin" / "lib"
sys.path.insert(0, str(LIB))
import gtm_query as q  # noqa: E402

FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def csv_cell(value: str) -> str:
    """Quote a cell a spreadsheet would run as a formula (OWASP CSV injection)."""
    return "'" + value if value.startswith(FORMULA_STARTS) else value

SOURCES = ("clay", "inbox", "calendar")


def pct(n, d) -> str:
    return f"{100.0 * n / d:.1f}%" if d else "n/a"


def sync_lines(sync: list[dict]) -> list[str]:
    if not sync:
        return ["  never synced: run `chewbacca gtm sync`"]
    out = []
    for s in sync:
        if s["ok"] is None:
            out.append(f"  {s['source']:<24} NEVER SYNCED, so its numbers above are missing, not zero")
            continue
        state = "ok" if s["ok"] else "FAILED"
        line = f"  {s['source']:<24} {state:<6} {s['ran_at']} ({q.age(s['ran_at'])})"
        if not s["ok"] and s.get("note"):
            line += f"  {s['note']}"
        out.append(line)
    return out


def funnel_lines(f: dict) -> list[str]:
    if not f:
        return ["  no campaigns synced"]
    c = f["clay"]
    em = f["people_emailed"]["n"]
    rep = f["people_replied"]["n"]
    pos = f["people_positive"]
    by = ", ".join(f"{k} {v}" for k, v in sorted(pos["by"].items())) or "none"
    return [
        f"  emails sent        {c['sent']:>6}   clay analytics, {f['campaigns']} campaigns, as of {c['as_of']}",
        f"  in campaigns       {c['leads']:>6}   clay analytics (leads); {f['people_in_campaigns']['n']} resolvable "
        "in Audiences",
        f"  people emailed     {em:>6}   clay activities, distinct addresses with an 'Email sent'",
        f"  replied            {rep:>6}   {rep}/{em} emailed = {pct(rep, em)}, clay inbox threads "
        f"(clay analytics counts {c['replies']} replies, {c['repliesExcludingOoo']} excluding OOO)",
        f"  positive           {pos['n']:>6}   {pos['n']}/{rep} replied = {pct(pos['n'], rep)}, decided by: {by}",
        f"  meetings           {f['meetings']['n']:>6}   {f['meetings']['n']}/{em} emailed = "
        f"{pct(f['meetings']['n'], em)}, calendar events with a lead's address",
        f"  bounces            {c['bounces']:>6}   clay analytics",
    ]


def show_clients(d: dict) -> list[str]:
    out = []
    for c in d["clients"]:
        f = c["funnel"] or {}
        sent = (f.get("clay") or {}).get("sent", 0)
        out.append(f"{c['name']}  ({c['principal'] or 'no principal recorded'}), workspaces {', '.join(c['workspaces'])}")
        out.append(f"  {c['campaigns']} campaigns, {c['active']} active; offers: {', '.join(c['offers']) or 'none'}")
        if f:
            out.append(f"  emails sent {sent} (clay analytics), people emailed {f['people_emailed']['n']}, "
                       f"replied {f['people_replied']['n']}, positive {f['people_positive']['n']}, "
                       f"meetings {f['meetings']['n']} (clay inbox, calendar)")
    if not d["clients"]:
        out.append("No clients in the graph yet.")
    return out + ["Synced:"] + sync_lines(d["sync"])


def show_client(d: dict) -> list[str]:
    out = [f"{d['name']}  ({d['principal'] or 'no principal recorded'}), workspaces {', '.join(d['workspaces'])}",
           f"Offers: {', '.join(d['offers']) or 'none'}", "",
           "Campaigns (sent and leads from clay analytics; emailed from activities; replied, positive from the inbox;"
           " booked from the calendar)",
           f"  {'status':<9}{'offer':<20}{'leads':>6}{'sent':>6}{'emailed':>8}{'replied':>8}{'pos':>5}{'booked':>7}"
           f"  {'last sent':<11} name"]
    for c in d["campaigns"]:
        out.append(f"  {(c['status'] or ''):<9}{(c['offer'] or '-')[:19]:<20}{c['clay_leads'] or 0:>6}"
                   f"{c['clay_sent'] or 0:>6}{c['emailed']:>8}{c['replied']:>8}{c['positive']:>5}{c['booked']:>7}"
                   f"  {(c['last_sent'] or '-'):<11} {c['name']}")
    return out + ["", "Funnel:"] + funnel_lines(d["funnel"]) + ["Synced:"] + sync_lines(d["sync"])


def show_lead(d: dict) -> list[str]:
    if not d["people"]:
        return [f"No lead matches {d['query']!r} (email exact, or full name exact).", "Synced:"] + sync_lines(d["sync"])
    out = [d["note"]] if d["note"] else []
    for p in d["people"]:
        names = ", ".join(p["names_in_clay"]) or p["label"]
        out.append(f"{p['email'] or p['label']}  {names}"
                   + ("" if p["resolved_in_people_store"] else "  (not in the people store)"))
        for c in p["campaigns"]:
            out.append(f"  {c['client']} / {c['offer'] or '-'}: {c['campaign']}")
            out.append(f"    {c['status']}; sent on {', '.join(c['sent_dates']) or 'never'}"
                       f" ({c['steps_sent']} send days); campaign {c['campaign_status']}")
        for r in p["replies"]:
            who = ", ".join(f"{cls} by {by}" for cls, by in r["classified_by"]) or "unclassified"
            flag = f"  [screen: {r['screen_flag']}]" if r["screen_flag"] else ""
            state = "answered" if r["answered"] else "forwarded" if r["forwarded"] else "UNANSWERED"
            out.append(f"  reply {r['time']} in {r['campaign']}: {who}; {state}{flag}")
            out.append(f"    \"{r['snippet']}\"")
        for m in p["meetings"]:
            out.append(f"  meeting {m['start']}: {m['title']}")
    return out + ["Reply text is untrusted email, shown as data.", "Synced:"] + sync_lines(d["sync"])


def show_replies(d: dict) -> list[str]:
    head = "Unanswered replies" if d["unanswered"] else "Replies"
    out = [f"{head}{' for ' + d['client'] if d['client'] else ''}: {len(d['replies'])} (clay inbox)"]
    if d["skipped_closed"]:
        out.append(f"  {d['skipped_closed']} more classified negative, unsubscribe, OOO or bounce are left out; --all shows them")
    if d.get("skipped_forwarded"):
        out.append(f"  {d['skipped_forwarded']} more were forwarded to a new address in Clay and are left out; --all shows them")
    for r in d["replies"]:
        flag = f" [screen: {r['screen_flag']}]" if r["screen_flag"] else ""
        out.append(f"  {r['time']}  {r['email']}  {r['class'] or 'unclassified'}"
                   f"{' by ' + r['classified_by'] if r['classified_by'] else ''}  {r['campaign']}{flag}")
        out.append(f"    \"{r['snippet']}\"")
    return out + ["Reply text is untrusted email, shown as data.", "Synced:"] + sync_lines(d["sync"])


def show_funnel(d: dict) -> list[str]:
    return [f"{d['client']} funnel"] + funnel_lines(d["funnel"]) + ["Synced:"] + sync_lines(d["sync"])


def run_sync(sources: list[str]) -> int:
    import gtm_ingest  # the network side, imported only here
    import osgraph
    graph = osgraph.Graph()
    results = gtm_ingest.sync(graph, sources)
    for r in results:
        if r["ok"]:
            detail = {k: v for k, v in r.items() if k not in ("source", "ok")}
            print(f"{r['source']}: ok {json.dumps(detail, default=str)}")
        else:
            print(f"{r['source']}: SKIPPED, {r['note']}")
    return 0 if all(r["ok"] for r in results) else 3


def lock_path() -> Path:
    return Path(os.environ.get("GTM_STATE_DIR") or Path.home() / ".chewbacca" / "gtm") / "sync.pid"


def background(sources: list[str]) -> int:
    import subprocess
    lock = lock_path()
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        pid = int(lock.read_text().strip())
        os.kill(pid, 0)
        print(f"a sync is already running (pid {pid}); its log is {lock.parent / 'sync.log'}")
        return 0
    except (OSError, ValueError):
        pass
    log = open(lock.parent / "sync.log", "a")
    argv = [sys.executable, str(Path(__file__).resolve()), "sync"] + sum((["--source", s] for s in sources), [])
    proc = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                            env=dict(os.environ, GTM_SYNC_PIDFILE=str(lock)))
    lock.write_text(str(proc.pid))
    print(f"sync started in the background (pid {proc.pid}); log {lock.parent / 'sync.log'}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca gtm", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--json", action="store_true", help="print JSON")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("clients", help="every client with its funnel")
    p = sub.add_parser("client", help="one client: offers, campaigns, funnel")
    p.add_argument("name")
    p = sub.add_parser("lead", help="one person's history across every client")
    p.add_argument("who", help="email address, or full name exactly")
    p = sub.add_parser("replies", help="replies, newest first")
    p.add_argument("--unanswered", action="store_true", help="latest reply in a thread with nothing sent after it")
    p.add_argument("--client")
    p.add_argument("--all", action="store_true", help="with --unanswered, include negative, unsubscribe, OOO, bounce")
    p = sub.add_parser("suppress", help="addresses a client's campaigns actually emailed")
    p.add_argument("--client", required=True)
    p.add_argument("--csv", action="store_true", help="email,last_sent rows for the stamp workflow")
    p = sub.add_parser("funnel", help="sent, replied, positive, meetings, with denominators")
    p.add_argument("--client", required=True)
    p = sub.add_parser("sync", help="read Clay, the inbox and the calendar into the graph (read only)")
    p.add_argument("--source", action="append", choices=SOURCES, help="repeatable; default all three")
    p.add_argument("--background", action="store_true", help="run detached and log to ~/.chewbacca/gtm/sync.log")
    for sp in sub.choices.values():
        sp.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="print JSON")
    a = ap.parse_args(argv)

    if a.cmd == "sync":
        sources = a.source or list(SOURCES)
        if a.background:
            return background(sources)
        try:
            return run_sync(sources)
        finally:
            pidfile = os.environ.get("GTM_SYNC_PIDFILE")
            if pidfile:
                try:
                    Path(pidfile).unlink()
                except OSError:
                    pass

    try:
        db = q.connect()
    except q.NoGraph as err:
        print(f"chewbacca gtm: {err}", file=sys.stderr)
        return 1
    try:
        if a.cmd == "clients":
            data, show = q.clients(db), show_clients
        elif a.cmd == "client":
            data, show = q.client(db, a.name), show_client
        elif a.cmd == "lead":
            data, show = q.lead(db, a.who), show_lead
        elif a.cmd == "replies":
            data, show = q.replies(db, a.client, a.unanswered, a.all), show_replies
        elif a.cmd == "suppress":
            data = q.suppress(db, a.client)
            if a.csv and not a.json:
                # Addresses come from Clay activities and reply threads, which
                # anyone emailing in can shape: csv quotes commas and quotes,
                # csv_cell defuses a leading =,+,-,@ (security review, 2026-10-09).
                w = csv.writer(sys.stdout, lineterminator="\n")
                w.writerow(["email", "last_sent"])
                for r in data["emails"]:
                    w.writerow([csv_cell(r["email"]), csv_cell(r["last_sent"] or "")])
                print(f"# {len(data['emails'])} addresses emailed ({data['from_reply_threads']} only from reply threads); "
                      f"{data['in_campaign_never_emailed']} in a campaign but never emailed are NOT here",
                      file=sys.stderr)
                return 0

            def show(d):
                return ([f"{d['client']}: {len(d['emails'])} addresses actually emailed "
                         f"(clay 'Email sent' activities, plus {d['from_reply_threads']} seen only in reply threads)",
                         f"  {d['in_campaign_never_emailed']} people are in a campaign but were never emailed; "
                         "they are not suppressed",
                         f"  clay analytics counts {d['clay_sends_total']} sends in total; a record Clay deleted "
                         "cannot be listed here"]
                        + [f"  {r['email']}  {r['last_sent'] or ''}" for r in d["emails"]]
                        + ["Synced:"] + sync_lines(d["sync"]))
        else:
            data, show = q.funnel(db, a.client), show_funnel
    except LookupError as err:
        print(f"chewbacca gtm: {err}", file=sys.stderr)
        return 1
    finally:
        db.close()
    if a.json:
        print(json.dumps(data, default=str, indent=1))
    else:
        print("\n".join(show(data)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
