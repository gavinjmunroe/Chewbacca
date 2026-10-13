#!/usr/bin/env python3
"""chewbacca gtme config: the client entry in clients.json is the contract.

THE FAILURE THIS EXISTS FOR. On 2026-10-13 an audit of the outbound engine
counted 97 executable lines that hard-code one client (Zeutara) across three
repos, three engine defaults that fall back to its Clay workspace when nothing
is named, and two homes for its standing rulings. A second client can only run
on the engine if everything that differs between clients is a field here, and
nothing else in the engine names a client. This module is the one reader of
that file and the one place its shape is written down.

    chewbacca gtme config check --client Zeutara
    chewbacca gtme config check --all --json
    chewbacca gtme config fields

The file is ~/.chewbacca/gtm/clients.json ($GTM_CONFIG, then the older
$GTME_CLIENTS and $CHEWBACCA_GTM_CLIENTS, win when set). Exit 0 when every
checked entry has no error, 1 when one does, 2 on bad arguments or an
unreadable file. A field the contract names but the entry lacks is listed as
missing, never an error: a client being set up is still a valid entry.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# One line per field: (kind, paths this field is part of, what it holds).
# "clay" is the Clay outbound path (Zeutara), "solo" the own-inbox path
# (Firm Foundation). A field in a path's contract is listed as missing until set.
FIELDS = {
    "name": ("str", ("clay", "solo"), "the client's name; every --client matches it or an alias"),
    "aliases": ("list[str]", (), "other names the client goes by"),
    "workspaces": ("list[str]", ("clay",), "Clay workspace ids, digits; exactly one is resolved per command"),
    "principal": ("str", ("clay",), "the person every email goes out as"),
    "sender_company": ("str", ("solo",), "the company the email comes from, when not the client's name"),
    "offers": ("list[obj]", ("clay",), "what is sold: {name, aliases, context, pitch, campaign_template}"),
    "campaign_name": ("str", ("clay",), "campaign name template, with {company}, {tier} and {date}"),
    "data_dir": ("path", ("clay",), "where lists, drafts and receipts for this client live on disk"),
    "rulings_path": ("path", ("clay",), "the DECISIONS.json that owns this client's standing rulings"),
    "rulings": ("list[obj]", (), "rulings kept here only when the client has no rulings_path"),
    "mailboxes": ("list[str]", (), "the client's own addresses (never a cold sender)"),
    "primary_domain": ("str", (), "the client's own domain; cold mail never goes from it"),
    "refused_senders": ("list[regex]", ("clay",), "sender addresses the client refused, as regexes"),
    "refused_senders_source": ("str", (), "who refused them, and when"),
    "presend": ("obj", (), "pre-send gate limits: {per_campaign_firm, per_firm_total}"),
    "voice": ("obj", ("clay",), "how mail reads: {first_name, sign_off, banned_words}"),
    "channels": ("obj", ("clay",), "where replies land: {togari_client, slack_channel}"),
    "client_slack": ("obj", (), "the client's Slack ids: {user, me, conversations}"),
    "report": ("obj", ("clay",), "the weekly numbers: {recipient, day}"),
    "ready": ("obj", (), "inputs `gtme ready` uses when the drafts file names none"),
    "reply_labels": ("list[obj]", (), "where reply labels are read from"),
    "state_dir": ("path", ("solo",), "a shared folder holding this client's own-inbox ledger"),
}
WS_RE = re.compile(r"[0-9]{1,15}")
DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}


def config_path() -> Path:
    for var in ("GTM_CONFIG", "GTME_CLIENTS", "CHEWBACCA_GTM_CLIENTS"):
        if os.environ.get(var):
            return Path(os.path.expanduser(os.environ[var]))
    base = os.environ.get("GTME_HOME") or os.path.join(os.path.expanduser("~"), ".chewbacca", "gtm")
    return Path(base) / "clients.json"


def load(path: Path | None = None) -> dict:
    """The whole file. A missing file is an empty config; a broken one raises."""
    p = path or config_path()
    try:
        doc = json.loads(p.read_text())
    except FileNotFoundError:
        return {"clients": []}
    if not isinstance(doc, dict) or not isinstance(doc.get("clients", []), list):
        raise ValueError(f"{p} is not a {{\"clients\": [...]}} object")
    return doc


def _norm(s) -> str:
    return " ".join(str(s or "").lower().split())


def names_of(entry: dict) -> list[str]:
    return [entry.get("name") or ""] + [a for a in entry.get("aliases") or [] if isinstance(a, str)]


def client(name: str, doc: dict | None = None) -> dict | None:
    """The entry whose name or alias is `name`, else None."""
    want = _norm(name)
    for c in (doc or load()).get("clients", []):
        if isinstance(c, dict) and want and any(_norm(n) == want for n in names_of(c)):
            return c
    return None


def workspace(name: str | None, doc: dict | None = None, env: dict | None = None) -> tuple[str | None, str]:
    """(workspace id, '') or (None, why not). Order: the named client's one
    workspace, then $CLAY_WORKSPACE_ID. Never a built-in id: until 2026-10-13
    three engine commands fell back to one client's workspace when none was
    named, so client two's grade would have been read in client one's Clay."""
    env = os.environ if env is None else env
    if name:
        c = client(name, doc)
        if c is None:
            return None, f"no client named {name} in {config_path()}"
        return workspace_of(c)
    if env.get("CLAY_WORKSPACE_ID"):
        return str(env["CLAY_WORKSPACE_ID"]), ""
    return None, "no Clay workspace chosen: name the client (--client) or the workspace, or set CLAY_WORKSPACE_ID"


def workspace_of(entry: dict) -> tuple[str | None, str]:
    """(the entry's one workspace, '') or (None, why): none and several refuse."""
    ws = [str(w) for w in entry.get("workspaces") or []]
    if len(ws) == 1:
        return ws[0], ""
    if len(ws) > 1:
        return None, f"{entry.get('name')} names {len(ws)} Clay workspaces ({', '.join(ws)}); pass the one you mean"
    return None, f"{entry.get('name')} names no Clay workspace in {config_path()}"


def client_for_workspace(ws: str, doc: dict | None = None) -> tuple[dict | None, str]:
    """(entry, '') for the one client whose workspaces include ws, else (None, why)."""
    hits = [c for c in (doc or load()).get("clients", [])
            if isinstance(c, dict) and str(ws) in [str(w) for w in c.get("workspaces") or []]]
    if len(hits) == 1:
        return hits[0], ""
    if hits:
        return None, f"workspace {ws} is named by {len(hits)} clients ({', '.join(c.get('name', '?') for c in hits)})"
    return None, f"workspace {ws} belongs to no client in {config_path()}"


def slug(name: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in _norm(name)).strip("-") or "client"


# ------------------------------------------------------------------ check

def _kind_ok(kind: str, v) -> bool:
    if kind in ("str", "path"):
        return isinstance(v, str) and v.strip() != ""
    if kind == "obj":
        return isinstance(v, dict)
    if kind.startswith("list["):
        inner = kind[5:-1]
        if not isinstance(v, list):
            return False
        if inner in ("str", "regex"):
            return all(isinstance(x, str) and x for x in v)
        return all(isinstance(x, dict) for x in v)
    return True


def path_of(entry: dict) -> str:
    return "clay" if entry.get("workspaces") else "solo"


def check_entry(entry: dict, doc: dict) -> dict:
    """{name, path, errors, warnings, missing, present}."""
    errors, warnings = [], []
    name = entry.get("name") if isinstance(entry.get("name"), str) else ""
    if not name.strip():
        errors.append("name: missing or empty")
    for key, v in entry.items():
        if key.startswith("_"):
            continue
        spec = FIELDS.get(key)
        if spec is None:
            warnings.append(f"{key}: not a contract field, so nothing in the engine reads it")
            continue
        if not _kind_ok(spec[0], v):
            errors.append(f"{key}: should be {spec[0]}")
            continue
        if spec[0] == "path":
            p = Path(os.path.expanduser(v))
            if not p.exists():
                errors.append(f"{key}: {v} does not exist")
        if key == "workspaces":
            bad = [w for w in v if not WS_RE.fullmatch(str(w))]
            if bad:
                errors.append(f"workspaces: {bad} are not Clay workspace ids (digits)")
        if key == "refused_senders":
            for pat in v:
                try:
                    re.compile(pat)
                except re.error as exc:
                    errors.append(f"refused_senders: {pat!r} does not compile ({exc})")
        if key == "offers":
            for i, o in enumerate(v):
                if not isinstance(o.get("name"), str) or not o["name"].strip():
                    errors.append(f"offers[{i}]: no name")
                ctx = o.get("context")
                if ctx and not Path(os.path.expanduser(ctx)).exists():
                    errors.append(f"offers[{i}] {o.get('name')}: context {ctx} does not exist")
        if key == "campaign_name" and "{company}" not in v:
            errors.append("campaign_name: needs {company}, or every offer's campaigns share one name")
        if key == "presend":
            for k in ("per_campaign_firm", "per_firm_total"):
                if k in v and not (isinstance(v[k], int) and v[k] >= 1):
                    errors.append(f"presend.{k}: should be a whole number of at least 1")
        if key == "report" and v.get("day") and str(v["day"]).lower() not in DAYS:
            errors.append(f"report.day: {v['day']!r} is not a weekday name")
    if entry.get("rulings_path"):
        rp = Path(os.path.expanduser(entry["rulings_path"]))
        try:
            dec = json.loads(rp.read_text())
            if not isinstance(dec, dict) or not isinstance(dec.get("rulings"), list):
                errors.append(f"rulings_path: {rp} has no rulings list")
            elif not any(_norm(n) in {_norm(x) for x in names_of(entry)}
                         for n in [dec.get("client")] + list(dec.get("aliases") or [])):
                errors.append(f"rulings_path: {rp} names client {dec.get('client')!r}, not {name}")
        except (OSError, ValueError) as exc:
            if Path(os.path.expanduser(entry["rulings_path"])).exists():
                errors.append(f"rulings_path: unreadable ({exc.__class__.__name__})")
        if entry.get("rulings"):
            warnings.append(f"rulings: {len(entry['rulings'])} rulings here and a rulings_path too; "
                            f"the rulings_path file owns them, move these there")
    for other in doc.get("clients", []):
        if other is entry or not isinstance(other, dict):
            continue
        shared = {_norm(n) for n in names_of(entry) if n} & {_norm(n) for n in names_of(other) if n}
        if shared:
            errors.append(f"name or alias {sorted(shared)} is also {other.get('name')}'s")
        ws = set(map(str, entry.get("workspaces") or [])) & set(map(str, other.get("workspaces") or []))
        if ws:
            errors.append(f"workspaces {sorted(ws)} are also {other.get('name')}'s")
    path = path_of(entry)
    contract = [k for k, spec in FIELDS.items() if path in spec[1]]
    missing = [k for k in contract if k not in entry]
    return {"name": name, "path": path, "errors": errors, "warnings": warnings,
            "missing": missing, "present": [k for k in contract if k in entry]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca gtme config", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("check", help="check one client's entry, or every entry, against the contract")
    who = p.add_mutually_exclusive_group(required=True)
    who.add_argument("--client")
    who.add_argument("--all", action="store_true")
    p.add_argument("--json", action="store_true")
    sub.add_parser("fields", help="every field the contract names, and what it holds")
    a = ap.parse_args(argv)
    if a.cmd == "fields":
        for k, (kind, paths, what) in FIELDS.items():
            print(f"  {k:<24}{kind:<13}{'/'.join(paths) or 'optional':<13}{what}")
        return 0
    try:
        doc = load()
    except (OSError, ValueError) as exc:
        print(f"chewbacca gtme config: {exc}", file=sys.stderr)
        return 2
    if a.all:
        entries = [c for c in doc.get("clients", []) if isinstance(c, dict)]
    else:
        c = client(a.client, doc)
        if c is None:
            print(f"chewbacca gtme config: no client named {a.client} in {config_path()}", file=sys.stderr)
            return 2
        entries = [c]
    results = [check_entry(c, doc) for c in entries]
    if a.json:
        print(json.dumps({"file": str(config_path()), "clients": results}, indent=1))
    else:
        for r in results:
            n = len(r["present"]) + len(r["missing"])
            print(f"{r['name']} ({r['path']} path): {'OK' if not r['errors'] else 'ERRORS'}, "
                  f"contract {len(r['present'])} of {n} fields")
            for e in r["errors"]:
                print(f"  error    {e}")
            for w in r["warnings"]:
                print(f"  warn     {w}")
            if r["missing"]:
                print(f"  missing  {', '.join(r['missing'])}")
    return 1 if any(r["errors"] for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
