#!/usr/bin/env python3
"""May we email this address? A do-not-contact check across every list we keep.

  gtme-dnc check jane@acme.com [more ...] [--client NAME] [--list dnc.csv] [--blocklist saved.json]
                 [--blocklist-ws WS] [--company-wide] [--json]
  gtme-dnc check --stdin < addresses.txt          one address or domain per line

Ported from togari-platform src/dnc (service.ts check, guard.ts checkDncByEmail)
at 6ef088b. The matching is Togari's: email and domain are trimmed and
lowercased, a leading "www." comes off a domain, and an email's domain is
derived and checked too, so blocking a whole domain blocks every address at
it. A bare domain is checked as a domain.

Sources, any one of which suppresses, each named on its match:
  --client NAME       the local GTM graph's suppression list (`gtm suppress`):
                      emailed, replied, bounced, unsubscribed, not a fit,
                      do-not-contact, and "*@domain" blocks
  --list CSV          a DNC export: an email and/or domain column (company_domain,
                      domain, website), optional reason and added_at columns.
                      Togari's togari_dnc.contacts export has this shape.
  --blocklist JSON    a saved `chewbacca clay blocklist` answer
  --blocklist-ws WS   read that Clay workspace's blocklist now, through the
                      kit's front door (a read)

Two deliberate differences from Togari, both toward not emailing someone:
  * Togari FAILS OPEN: when BigQuery errors, the send is allowed. Here a source
    that can't be read is an error (exit 2, "unknown"), never "allowed".
  * Togari's SQL matches the derived domain against company_domain on every
    row, including rows that suppress one person, so one opted-out contact
    silences the whole company. Its own test describes a domain block as a
    row with no email. Here a domain block is a domain-only row, a "*@domain"
    entry or a bare domain; --company-wide reproduces Togari's wider match.

Exit 0 allowed, 1 suppressed (any target), 2 unknown or usage. Offline except
--blocklist-ws, which only reads. Nothing here writes to any list.
"""
import argparse
import csv
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Unknown(Exception):
    """A source could not be read, so the answer is not "allowed"."""


def norm_email(s):
    return (s or "").strip().lower()


def norm_domain(s):
    d = (s or "").strip().lower()
    for p in ("https://", "http://"):
        if d.startswith(p):
            d = d[len(p):]
    d = d.split("/")[0].split("?")[0].split("#")[0]
    return d[4:] if d.startswith("www.") else d


def domain_of(email):
    at = email.rfind("@")
    if at < 0 or at == len(email) - 1:
        return ""
    return norm_domain(email[at + 1:])


class Entry:
    __slots__ = ("email", "domain", "reason", "added_at", "source")

    def __init__(self, email, domain, reason, added_at, source):
        self.email, self.domain, self.reason, self.added_at, self.source = email, domain, reason, added_at, source


def entry_from_value(value, reason, added_at, source):
    """One list value: an address, a "*@domain", or a bare domain."""
    v = (value or "").strip()
    if not v:
        return None
    if v.startswith("*@"):
        return Entry("", norm_domain(v[2:]), reason, added_at, source)
    if "@" in v:
        e = norm_email(v)
        return Entry(e, domain_of(e), reason, added_at, source)
    return Entry("", norm_domain(v), reason, added_at, source)


def load_csv(path):
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            rows = list(csv.DictReader(fh))
    except OSError as exc:
        raise Unknown(f"{path}: {exc.strerror or exc}")
    out = []
    for r in rows:
        low = {(k or "").strip().lower(): (v or "") for k, v in r.items()}
        email = next((low[k] for k in ("email", "email_address", "work_email") if low.get(k)), "")
        domain = next((low[k] for k in ("company_domain", "domain", "website") if low.get(k)), "")
        reason = low.get("dnc_reason") or low.get("reason") or f"on {os.path.basename(path)}"
        added = low.get("dnc_added_at") or low.get("added_at") or None
        # A row with an is_dnc column of false is a contact, not a suppression.
        if low.get("is_dnc", "true").strip().lower() in ("false", "0", "no"):
            continue
        if email:
            out.append(Entry(norm_email(email), norm_domain(domain) or domain_of(norm_email(email)), reason, added, path))
        elif domain:
            out.append(Entry("", norm_domain(domain), reason, added, path))
    return out


def load_blocklist(data, source):
    """A `chewbacca clay blocklist` answer, the whole line or just its data."""
    if isinstance(data, dict) and "data" in data:
        if data.get("ok") is False:
            raise Unknown(f"{source}: the blocklist read failed: {data.get('reason')}")
        data = data["data"]
    if not isinstance(data, list):
        raise Unknown(f"{source}: not a blocklist answer")
    out = []
    for item in data:
        if not isinstance(item, dict):
            continue
        e = entry_from_value(item.get("email_or_domain") or item.get("emailOrDomain"),
                             f"Clay blocklist: {item.get('source') or 'blocked'}", item.get("created_at"), source)
        if e:
            out.append(e)
    return out


def read_blocklist_ws(ws):
    if not ws.isdigit():
        raise Unknown(f"--blocklist-ws takes a numeric workspace id, not {ws!r}")
    front = ROOT / "bin" / "chewbacca-clay"
    try:
        p = subprocess.run(["node", str(front), "blocklist", f"ws={ws}"], capture_output=True, text=True, timeout=120)
        data = json.loads(p.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        raise Unknown(f"Clay blocklist for workspace {ws} could not be read: {exc}")
    if data.get("truncated"):
        raise Unknown(f"Clay blocklist for workspace {ws} came back cut ({data['truncated']}); a partial list can't clear anyone")
    return load_blocklist(data, f"Clay blocklist ws={ws}")


def load_client(name):
    sys.path.insert(0, str(ROOT / "bin" / "lib"))
    try:
        import gtm_query
        db = gtm_query.connect()
        data = gtm_query.suppress(db, name)
    except SystemExit as exc:
        raise Unknown(f"client {name}: {exc}")
    except Exception as exc:  # a missing graph or client is unknown, never allowed
        raise Unknown(f"client {name}: the GTM graph could not be read ({type(exc).__name__}: {exc})")
    out = []
    for row in data.get("emails", []):
        e = entry_from_value(row["email"], "; ".join(row.get("reasons") or ["suppressed"]), row.get("last_sent"), f"gtm suppress --client {name}")
        if e:
            out.append(e)
    return out


def check(target, entries, company_wide=False):
    """Togari's DncService.check over in-memory entries. Returns its DncDecision shape."""
    t = (target or "").strip()
    if "@" in t:
        email, domain = norm_email(t), domain_of(norm_email(t))
    else:
        email, domain = "", norm_domain(t)
    if not email and not domain:
        return {"target": target, "suppressed": False, "matches": [], "empty": True}
    matches = []
    for e in entries:
        if email and e.email and e.email == email:
            on, value = "email", e.email
        elif domain and e.domain == domain and (not e.email or company_wide):
            on, value = "domain", e.domain
        else:
            continue
        m = {"matchedOn": on, "value": value, "reason": e.reason, "source": e.source}
        if e.added_at:
            m["addedAt"] = e.added_at
        if on == "domain" and e.email:
            m["via"] = e.email
        matches.append(m)
    # Email matches first, as the decision's reason is the first match's.
    matches.sort(key=lambda m: m["matchedOn"] != "email")
    return {"target": target, "suppressed": bool(matches), "matches": matches,
            "reason": matches[0]["reason"] if matches else None}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="gtme-dnc", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="is each address or domain suppressed, and by which list")
    c.add_argument("targets", nargs="*")
    c.add_argument("--stdin", action="store_true", help="read targets one per line")
    c.add_argument("--client")
    c.add_argument("--list", action="append", default=[])
    c.add_argument("--blocklist", action="append", default=[])
    c.add_argument("--blocklist-ws", action="append", default=[])
    c.add_argument("--company-wide", action="store_true", help="Togari's match: any row's company domain")
    c.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    targets = list(a.targets)
    if a.stdin:
        targets += [line.strip() for line in sys.stdin if line.strip()]
    if not targets:
        print("gtme-dnc: name at least one address or domain", file=sys.stderr)
        return 2
    if not (a.client or a.list or a.blocklist or a.blocklist_ws):
        print("gtme-dnc: no list to check against; pass --client, --list, --blocklist or --blocklist-ws. "
              "Checking nothing would say everyone is allowed.", file=sys.stderr)
        return 2
    try:
        entries, sources = [], []
        if a.client:
            got = load_client(a.client)
            entries += got
            sources.append({"source": f"gtm suppress --client {a.client}", "entries": len(got)})
        for path in a.list:
            got = load_csv(path)
            entries += got
            sources.append({"source": path, "entries": len(got)})
        for path in a.blocklist:
            try:
                data = json.loads(Path(path).read_text())
            except (OSError, ValueError) as exc:
                raise Unknown(f"{path}: {exc}")
            got = load_blocklist(data, path)
            entries += got
            sources.append({"source": path, "entries": len(got)})
        for ws in a.blocklist_ws:
            got = read_blocklist_ws(ws)
            entries += got
            sources.append({"source": f"Clay blocklist ws={ws}", "entries": len(got)})
    except Unknown as exc:
        out = {"ok": False, "decision": "unknown", "reason": str(exc)}
        print(json.dumps(out) if a.json else f"UNKNOWN: {exc}. Not allowed until every list reads.")
        return 2

    results = [check(t, entries, a.company_wide) for t in targets]
    if a.json:
        print(json.dumps({"ok": True, "sources": sources, "results": results}))
    else:
        for r in results:
            if r.get("empty"):
                print(f"?  {r['target']!r}: nothing to check")
            elif r["suppressed"]:
                m = r["matches"][0]
                more = f" (+{len(r['matches']) - 1} more)" if len(r["matches"]) > 1 else ""
                print(f"NO   {r['target']}: {m['matchedOn']} {m['value']} on {m['source']}: {m['reason']}{more}")
            else:
                print(f"ok   {r['target']}")
        print(f"# checked against {sum(s['entries'] for s in sources)} entries from {len(sources)} source(s)")
    return 1 if any(r["suppressed"] for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
