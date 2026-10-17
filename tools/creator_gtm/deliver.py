"""Record every handed contact of a client in the intro ledger, then stamp where it came from.

    python3 tools/creator_gtm/deliver.py ~/.chewbacca/gtm/clients/<slug>.json          dry run: prints what it would record
    python3 tools/creator_gtm/deliver.py ~/.chewbacca/gtm/clients/<slug>.json --live   records, then writes Delivered On/For
    python3 tools/creator_gtm/deliver.py <client.json> --from-records [--live]          reads the client's record file instead

The ledger is the proof and Clay is the view. A row is recorded first and stamped second, so a
Clay write that fails leaves the ledger right and the next run fills the row from it. A row
that already carries Delivered On is skipped. Every Clay call goes through `chewbacca clay`,
which owns the write gate.

A client on a provider with no table (see tools/creator_gtm/provider.py) has only its record
file, so --from-records reads that and stamps each record's "delivered" field instead of a row.
A handed contact is one whose status is the client's ready_value or follow_buyers' warm status.

Needs LEDGER_URL and LEDGER_TOKEN, from the environment or ~/.config/intro-ledger/env.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request

STAMP_COLUMNS = ("Delivered On", "Delivered For", "Ledger Record")
# The columns brand_buyer writes when the client file doesn't rename them (its DEFAULT_PICK_COLUMNS).
PICK_DEFAULTS = {"person": "Person", "title": "Title", "why": "Why this person", "status": "Status",
                 "contact": "Contact"}
# follow_buyers.WARM with no "; needs work" tail: a past buyer at a new brand with a verified email.
WARM = "Warm: past buyer moved"
ENV_FILE = os.path.expanduser("~/.config/intro-ledger/env")


class Failed(SystemExit):
    pass


def load_env():
    env = {k: os.environ[k] for k in ("LEDGER_URL", "LEDGER_TOKEN") if os.environ.get(k)}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k in ("LEDGER_URL", "LEDGER_TOKEN") and k not in env:
                    env[k] = v
    return env


def clay(op, live=True, write=False, **kw):
    args = ["chewbacca", "clay", op] + [f"{k}={v}" for k, v in kw.items()]
    if write:
        args.append("--allow-writes" if live else "--dry-run")
    out = subprocess.run(args, capture_output=True, text=True, timeout=120)
    try:
        receipt = json.loads(out.stdout or "{}")
    except json.JSONDecodeError:
        raise Failed(f"{op}: not JSON: {out.stdout[:300]} {out.stderr[:300]}")
    if not receipt.get("ok", False) and (live or not write):
        raise Failed(f"{op} failed: {(out.stdout or out.stderr)[:600]}")
    return receipt


def text(cell):
    v = (cell or {}).get("value")
    return v.strip() if isinstance(v, str) else ("" if v is None else json.dumps(v))


def verdict_of(raw):
    """ZeroBounce's cell reads like a checkmark plus "Valid email". Keep the word, drop the icon."""
    low = raw.lower()
    for word in ("invalid", "catch-all", "unknown", "valid"):
        if word in low:
            return word
    return raw


def columns(cfg):
    return {c.get("name"): c["id"] for c in clay("columns", table=cfg["table"]).get("data") or []}


def ensure_stamp_columns(cfg, cols, live):
    for name in STAMP_COLUMNS:
        if name not in cols:
            clay("add-column", live, write=True, ws=cfg["ws"], table=cfg["table"], name=name,
                 data_type="text", view=cfg["view"])
    return columns(cfg) if live else cols


def read_rows(cfg, ids):
    fields = ",".join(i for i in ids.values() if i)
    seen, rows, after = set(), [], None
    while True:
        kw = dict(ws=cfg["ws"], table=cfg["table"], view=cfg["view"], fields=fields)
        if after:
            kw["after"] = after
        page = [r for r in clay("rows", **kw).get("data") or [] if r["id"] not in seen]
        if not page:
            return rows
        rows += page
        seen.update(r["id"] for r in page)
        after = page[-1]["id"]


def payload_for(cfg, row, ids):
    cells = row["cells"]
    get = lambda role: text(cells.get(ids.get(role)))
    return {
        "client": cfg["client_slug"],
        "brand": get("brand"),
        "brand_domain": get("domain"),
        "person": get("person"),
        "title": get("title"),
        "email": get("email").lower(),
        "email_verdict": verdict_of(get("verify")),
        "profile": get("profile"),
        "why": get("why"),
        "evidence": {"contact": get("contact"), "profile": get("profile"),
                     "email_check": get("verify")},
        "delivered_for": get("creator") or cfg.get("creator", ""),
        "source": {"system": "clay", "ws": cfg["ws"], "table": cfg["table"], "row": row["id"]},
    }


def handed(cfg, status):
    return status in (cfg.get("ready_value", "Ready"), WARM)


def column_names(cfg):
    """Role -> column name: the client file's names, brand_buyer's pick columns where it names none,
    and the email column under either role name ("email" or brand_buyer's "findymail")."""
    names = {**PICK_DEFAULTS, **cfg["columns"]}
    if "email" not in names and names.get("findymail"):
        names["email"] = names["findymail"]
    return names


def payload_from_record(cfg, key, rec, records_path):
    """The ledger payload for one brand in the client's record file (provider.save_record's shape)."""
    c = rec.get("contact") or {}
    return {
        "client": cfg["client_slug"],
        "brand": rec.get("brand") or key,
        "brand_domain": c.get("domain") or rec.get("domain") or "",
        "person": c.get("person") or "",
        "title": c.get("title") or "",
        "email": (c.get("email") or "").lower(),
        "email_verdict": verdict_of(c.get("zerobounce") or ""),
        "profile": c.get("profile") or "",
        "why": c.get("why") or "",
        "evidence": {"profile": c.get("profile"), "email_check": c.get("zerobounce"), "lane": rec.get("lane")},
        "delivered_for": rec.get("creator") or cfg.get("creator", ""),
        "source": {"system": rec.get("provider") or "records", "records": os.path.basename(records_path),
                   "key": key},
    }


def records_path(cfg, client_file):
    p = os.path.expanduser(cfg.get("records") or f"{cfg['client_slug']}.records.json")
    return p if os.path.isabs(p) else os.path.join(os.path.dirname(os.path.abspath(client_file)), p)


def blocked_write(cfg, where, brand, domain, failure, evaluate=None):
    """A ledger post or stamp that failed: record it with next-move's pick, never retry it here."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    import next_move  # noqa: E402
    log = os.path.join(os.path.dirname(os.path.abspath(where)), f"{cfg.get('client_slug', 'client')}.blockers.jsonl")
    return next_move.on_blocked("deliver_write", {"brand": brand, "domain": domain or ""}, failure,
                                client=cfg.get("client_slug"), goal=f"{brand}'s handed contact recorded in the intro ledger",
                                log_path=log, evaluate=evaluate)


def deliver_records(cfg, path, live, post_fn):
    """Record each handed contact in the client's record file, then stamp the record. Returns the report."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from provider import load_records, save_record  # noqa: E402  (stdlib-only; no vendor import)
    report = {"client": cfg["client_slug"], "live": live, "recorded": [], "already": [], "skipped": [], "blocked": []}
    for key, rec in sorted(load_records(path).get("brands", {}).items()):
        if not handed(cfg, (rec.get("contact") or {}).get("status")):
            continue
        p = payload_from_record(cfg, key, rec, path)
        if rec.get("delivered"):
            report["already"].append(p["brand"])
            continue
        bad = problems(p)
        if bad:
            report["skipped"].append({"brand": p["brand"], "key": key, "why": bad})
            continue
        if not live:
            report["recorded"].append({"brand": p["brand"], "person": p["person"], "email": p["email"],
                                       "for": p["delivered_for"], "dry_run": True})
            continue
        try:
            record, created = post_fn(p)
        # Failed is a SystemExit (a ledger refusal raises it), so it's named: Exception alone missed it.
        except (Exception, Failed) as e:  # one brand's failed post doesn't stop the batch, and isn't retried here
            b = blocked_write(cfg, path, p["brand"], rec.get("domain"), f"ledger post failed: {e}")
            report["blocked"].append({"brand": p["brand"], "key": key, "why": str(e)[:300], "next": b["next"]})
            continue
        try:
            save_record(path, key, {"delivered": {"on": record["delivered_on"], "for": record["delivered_for"],
                                                  "ledger": f"#{record['seq']} {record['hash'][:16]}"}})
        except (Exception, Failed) as e:
            b = blocked_write(cfg, path, p["brand"], rec.get("domain"),
                              f"ledger has it as #{record['seq']} but the record stamp failed: {e}")
            report["blocked"].append({"brand": p["brand"], "key": key, "why": str(e)[:300], "next": b["next"],
                                      "ledger": record["seq"]})
            continue
        report["recorded"].append({"brand": p["brand"], "person": p["person"], "seq": record["seq"],
                                   "delivered_on": record["delivered_on"], "new": created})
    return report


def problems(p):
    """A Ready row still has to hold what an intro is: a person, an email and a valid check."""
    out = [k for k in ("brand", "person", "email", "delivered_for") if not p[k]]
    if p["email"] and p["email_verdict"] != "valid":
        out.append(f"email check is {p['email_verdict'] or 'empty'}")
    return out


def post(env, payload):
    req = urllib.request.Request(env["LEDGER_URL"].rstrip("/") + "/intros", method="POST",
                                 data=json.dumps(payload).encode(),
                                 headers={"Authorization": f"Bearer {env['LEDGER_TOKEN']}",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read())
    if not body.get("ok"):
        raise Failed(f"ledger refused {payload['brand']}: {body}")
    return body["record"], body["created"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("client_file")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--from-records", action="store_true", help="read the client's record file, not a table")
    a = ap.parse_args(argv)
    with open(a.client_file) as f:
        cfg = json.load(f)
    env = load_env()
    if a.live and not {"LEDGER_URL", "LEDGER_TOKEN"} <= set(env):
        raise Failed(f"set LEDGER_URL and LEDGER_TOKEN, or write them to {ENV_FILE}")
    if a.from_records:
        report = deliver_records(cfg, records_path(cfg, a.client_file), a.live, lambda p: post(env, p))
        print(json.dumps(report, indent=1))
        return report

    cols = ensure_stamp_columns(cfg, columns(cfg), a.live)
    own = column_names(cfg)
    names = {**own, "delivered_on": "Delivered On", "delivered_for": "Delivered For",
             "ledger": "Ledger Record"}
    # A dry run adds no columns, so only the client's own columns have to exist yet.
    missing = [n for n in (names.values() if a.live else own.values()) if n not in cols]
    if missing:
        raise Failed(f"table {cfg['table']} has no column named {missing}")
    ids = {role: cols.get(name) for role, name in names.items()}

    report = {"client": cfg["client_slug"], "live": a.live, "recorded": [], "already": [], "skipped": [], "blocked": []}
    for row in read_rows(cfg, ids):
        if not handed(cfg, text(row["cells"].get(ids["status"]))):
            continue
        p = payload_for(cfg, row, ids)
        if ids.get("delivered_on") and text(row["cells"].get(ids["delivered_on"])):
            report["already"].append(p["brand"])
            continue
        bad = problems(p)
        if bad:
            report["skipped"].append({"brand": p["brand"], "row": row["id"], "why": bad})
            continue
        if not a.live:
            report["recorded"].append({"brand": p["brand"], "person": p["person"], "email": p["email"],
                                       "for": p["delivered_for"], "dry_run": True})
            continue
        try:
            record, created = post(env, p)
        except (Exception, Failed) as e:
            b = blocked_write(cfg, a.client_file, p["brand"], None, f"ledger post failed: {e}")
            report["blocked"].append({"brand": p["brand"], "row": row["id"], "why": str(e)[:300], "next": b["next"]})
            continue
        stamp = {ids["delivered_on"]: record["delivered_on"], ids["delivered_for"]: record["delivered_for"],
                 ids["ledger"]: f"#{record['seq']} {record['hash'][:16]}"}
        try:
            clay("update-rows", True, write=True, ws=cfg["ws"], table=cfg["table"],
                 records=json.dumps([{"id": row["id"], "cells": stamp}]))
        except (Exception, Failed) as e:  # the ledger is right; the next run fills the row from it
            b = blocked_write(cfg, a.client_file, p["brand"], None,
                              f"ledger has it as #{record['seq']} but the table stamp failed: {e}")
            report["blocked"].append({"brand": p["brand"], "row": row["id"], "why": str(e)[:300], "next": b["next"],
                                      "ledger": record["seq"]})
            continue
        report["recorded"].append({"brand": p["brand"], "person": p["person"], "seq": record["seq"],
                                   "delivered_on": record["delivered_on"], "new": created})
    print(json.dumps(report, indent=1))
    return report


if __name__ == "__main__":
    try:
        main()
    except Failed as e:
        print(f"deliver: {e}", file=sys.stderr)
        sys.exit(1)
