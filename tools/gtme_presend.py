#!/usr/bin/env python3
"""pre-send gate: refuse a campaign list unless every address was verified.

THE FAILURE THIS EXISTS FOR. On 2026-09-28 four campaigns for the first client
sent 48 step-one emails and 13 bounced at the lead level, 27%. One offer was 5
of 12. A healthy cold list runs low single digits. Every bounce spends sender
reputation on mailboxes someone has to keep alive, and the fix that followed
(fit-only relaunch lists) still carried no mailbox verification at all: the
only check on those rows compared the email domain to the firm name.

So this exits nonzero unless, for every row in every list:

  1. a real verifier verdict is attached and it says valid/deliverable
     (a column on the row, or --verification results.csv joined by email)
  2. the address is syntactically sane and not a shared mailbox
  3. it appears once across all lists, and in no --suppress list
  4. no firm gets more than --per-campaign-firm contacts in one list, or more
     than --per-firm-total across all lists in this run

    chewbacca gtme presend --client NAME LIST.csv [LIST2.csv ...]
    chewbacca gtme presend --client NAME *.csv --verification v.csv --suppress sent.csv \\
        --senders senders.json --mx

The client's clients.json entry supplies the refused sender addresses
(refused_senders) and the firm limits (presend). A full pass writes a receipt
for that client only, at ~/.chewbacca/state/send-gate-receipts/<client>.json:
until 2026-10-13 one receipt file served every client, so any client's pass
would have unlocked another client's launch for 12 hours.

--mx resolves each domain's mail exchanger as a FLOOR. A domain with no MX and
no A record cannot receive mail, so that fails. But an MX record proves only
that the domain has a mail server, not that this mailbox exists, so MX never
substitutes for (1). There is no flag that lets MX alone pass. That is on purpose.

Moved from zeutara-gtme scripts/pre_send_gate.py on 2026-10-13; that script is
now a shim that runs this one for its client. Exit 0 pass, 1 refused, 2 usage
or read error. Output never prints an address.
"""
import argparse
import collections
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gtme_config  # noqa: E402
from gtme_lists import (EMAIL_OK, FREE, ROLE, canonical_firm, domain_matches_firm,  # noqa: E402
                        email_domain, get, load_aliases, read_rows, slug)

VERIFIED = {"valid", "verified", "deliverable", "ok", "safe", "safe_to_send", "true", "yes"}
CATCH_ALL = {"catch-all", "catch_all", "catchall", "accept_all", "accept-all", "acceptall",
             "accept all", "risky", "unknown_catch_all"}

# One contact per firm per campaign is the hard rule: two emails about the same
# deal to one firm is the offence. Across campaigns the ceiling is 4: after the
# 2026-09-22 firm-identity fix, one firm was going to get eight cold emails from
# one sender, and the fixed allocation's max to any one firm was 4. A client
# entry's presend block overrides either.
PER_CAMPAIGN_FIRM = 1
PER_FIRM_TOTAL = 4
# Titles that run the firm's own books or operations, not its checks. On
# 2026-10-04 the client caught two CFOs on Monday's lists after the qualifier
# and this gate had both passed them.
NON_DECIDER = re.compile(r"\b(cfo|coo|chief (financial|operating|of staff|people|marketing)|"
                         r"controller|comptroller|treasurer|head of (finance|operations|people|"
                         r"talent|marketing|platform)|(finance|operations|fund) (director|manager)|"
                         r"accountant|accounting)\b", re.I)
URL = re.compile(r"^https?://\S+\.\S+", re.I)


def mx_status(domain, runner=None):
    """'mx', 'a-only', 'null-mx', 'none' or 'error'. Uses dig; stdlib has no MX lookup."""
    runner = runner or _dig
    try:
        mx = runner(domain, "MX")
    except Exception:
        return "error"
    if mx:
        # RFC 7505 null MX ("0 .") means the domain explicitly accepts no mail
        if all(line.split()[-1] in {".", ""} for line in mx):
            return "null-mx"
        return "mx"
    try:
        return "a-only" if runner(domain, "A") else "none"
    except Exception:
        return "error"


def _dig(domain, rtype):
    out = subprocess.run(["dig", "+short", "+time=3", "+tries=1", rtype, domain],
                         capture_output=True, text=True, timeout=10)
    if out.returncode != 0:
        raise RuntimeError("dig failed")
    return [ln for ln in out.stdout.splitlines() if ln.strip() and not ln.startswith(";")]


def verification_verdict(row, value):
    """A provider's risky substatus overrides its broad valid status."""
    substatuses = [str(v or '').strip().lower() for k, v in row.items()
                   if slug(k) == 'substatus']
    # Qube's two 2026-10-15 bounces were valid/catch_all. Neither a sidecar
    # CSV nor an inline verdict may discard the provider's narrower result.
    if any(v in CATCH_ALL for v in substatuses):
        return 'catch_all'
    return str(value or '').strip().lower()


def load_verification(path):
    rows, cols = read_rows(path)
    if "email" not in cols:
        raise ValueError(f"{path}: no email column")
    vcol = cols.get("verification")
    if not vcol:
        # a two-column file whose second column is the verdict
        others = [c for c in (rows[0].keys() if rows else []) if c != cols["email"]]
        vcol = others[0] if len(others) == 1 else None
    if not vcol:
        raise ValueError(f"{path}: no verification status column")
    verdicts = {}
    for row in rows:
        email = get(row, cols, 'email').lower()
        value = verification_verdict(row, row.get(vcol))
        prior = verdicts.get(email)
        if prior is None or prior in VERIFIED:
            verdicts[email] = value
    return verdicts


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)


def gate(paths, verification=None, suppress=(), aliases_path=None,
         per_campaign_firm=PER_CAMPAIGN_FIRM, per_firm_total=PER_FIRM_TOTAL,
         allow_catch_all=False, check_mx=False, mx_runner=None,
         require_title=False, require_line=False):
    fails, warns, notes = [], [], []
    alias, known_domains = load_aliases(aliases_path)
    suppressed = set()
    for sp in suppress:
        srows, scols = read_rows(sp)
        suppressed |= {get(r, scols, "email").lower() for r in srows if get(r, scols, "email")}

    lists = []
    for path in paths:
        try:
            rows, cols = read_rows(path)
        except OSError as exc:
            raise SystemExit(f"cannot read {path}: {exc}")
        lists.append((path, rows, cols))

    seen = collections.Counter()
    uf = UnionFind()
    per_list_firms = {}
    all_domains = collections.Counter()
    total = 0

    for path, rows, cols in lists:
        name = os.path.basename(path)
        total += len(rows)
        if not rows:
            fails.append(f"{name}: EMPTY, zero rows")
            continue
        if "email" not in cols:
            fails.append(f"{name}: no email column found")
            continue
        if "company" not in cols:
            fails.append(f"{name}: no firm or company column, so the per-firm ceiling "
                         f"cannot be checked")

        # Monday 2026-10-05's lists were row_id,email,name,firm: the role and line
        # checks below had nothing to read and passed by default.
        if require_title and "title" not in cols:
            fails.append(f"{name}: no title column, so nobody checked these people write "
                         f"checks (two CFOs reached a client's list on 2026-10-04)")
        if require_line and "line" not in cols:
            fails.append(f"{name}: no personalized line column, so no line was checked "
                         f"against a public source. Export the list with the line Clay "
                         f"will send and a line_source URL")
        has_vcol = "verification" in cols
        if not has_vcol and verification is None:
            hint = ""
            if any(slug(c) == "emailcheck" for c in rows[0].keys()):
                hint = (" Its `email_check` column is a domain-vs-firm heuristic, not a "
                        "mailbox verifier.")
            fails.append(f"{name}: NO VERIFIER RAN. None of {len(rows)} rows carries a "
                         f"verification verdict.{hint} Run Clay's Validate Email (or "
                         f"ZeroBounce/NeverBounce) and pass the results with --verification.")

        unverified, catch_all, bad_syntax, role, dupes_in, supp = 0, 0, 0, 0, 0, 0
        non_decider, unsourced = 0, 0
        mismatch, free = 0, 0
        firms = collections.Counter()
        local_seen = set()
        for r in rows:
            email = get(r, cols, "email").lower()
            dom = email_domain(email)
            if not EMAIL_OK.match(email):
                bad_syntax += 1
                continue
            if ROLE.match(email):
                role += 1
            if email in local_seen:
                dupes_in += 1
            elif email:
                # count each list once, so a repeat inside one list is not
                # also reported as a repeat across lists
                seen[email] += 1
            local_seen.add(email)
            if email in suppressed:
                supp += 1
            all_domains[dom] += 1
            if dom in FREE:
                free += 1

            verdict = None
            if verification is not None and email in verification:
                verdict = verification[email]
            elif has_vcol:
                verdict = get(r, cols, "verification").lower()
            verdict = verification_verdict(r, verdict) if verdict is not None else None
            if verdict is not None:
                if verdict in VERIFIED:
                    pass
                elif verdict in CATCH_ALL and allow_catch_all:
                    catch_all += 1
                else:
                    unverified += 1
            elif has_vcol or verification is not None:
                unverified += 1

            if "title" in cols and NON_DECIDER.search(get(r, cols, "title")):
                non_decider += 1
            if "line" in cols and get(r, cols, "line"):
                src = get(r, cols, "line_source") if "line_source" in cols else ""
                if not URL.match(src):
                    unsourced += 1

            firm = get(r, cols, "company")
            if firm:
                key = "firm:" + canonical_firm(firm, alias)
                uf.find(key)
                # one corporate domain is one firm, whatever the name column says
                if dom and dom not in FREE:
                    uf.union(key, "dom:" + dom)
                firms[key] += 1
                if dom not in FREE and not domain_matches_firm(dom, firm, known_domains):
                    mismatch += 1
            elif dom and dom not in FREE:
                uf.find("dom:" + dom)
                firms["dom:" + dom] += 1
        per_list_firms[name] = firms

        if non_decider:
            fails.append(f"{name}: {non_decider} titles run finance or operations (CFO, COO, "
                         f"controller), not checks")
        if unsourced:
            fails.append(f"{name}: {unsourced} personalized lines name an investment with no "
                         f"public source URL in a line_source column. On 2026-10-04 a "
                         f"reviewer cut 19 such lines that were false")
        if bad_syntax:
            fails.append(f"{name}: {bad_syntax} malformed email addresses")
        if role:
            fails.append(f"{name}: {role} shared mailboxes (info@, ir@) nobody reads")
        if dupes_in:
            fails.append(f"{name}: {dupes_in} duplicate addresses inside the list")
        if supp:
            fails.append(f"{name}: {supp} addresses are on a suppression list")
        if unverified:
            fails.append(f"{name}: {unverified} of {len(rows)} addresses did not verify as "
                         f"valid (invalid, unknown, missing, or catch-all)")
        if catch_all:
            warns.append(f"{name}: {catch_all} catch-all domains passed by --allow-catch-all; "
                         f"a catch-all verdict cannot confirm the mailbox exists")
        if mismatch:
            warns.append(f"{name}: {mismatch} email domains don't match the firm name. "
                         f"On 2026-10-03 these lined up with the 27% bounce rate")
        if free:
            warns.append(f"{name}: {free} free consumer mailboxes (fine for an angel only "
                         f"if verified)")

    # firm identity is resolved across every list before counting
    for name, firms in per_list_firms.items():
        merged = collections.Counter()
        for key, n in firms.items():
            merged[uf.find(key)] += n
        over = {k: n for k, n in merged.items() if n > per_campaign_firm}
        if over:
            worst = sorted(over.items(), key=lambda kv: -kv[1])[:3]
            worst = [(k.split(":", 1)[1], n) for k, n in worst]
            fails.append(f"{name}: {len(over)} firms get the same pitch more than "
                         f"{per_campaign_firm}x, worst {worst}")
    totals = collections.Counter()
    for firms in per_list_firms.values():
        for key, n in firms.items():
            totals[uf.find(key)] += n
    over_total = {k: n for k, n in totals.items() if n > per_firm_total}
    if over_total:
        worst = [(k.split(":", 1)[1], n) for k, n in
                 sorted(over_total.items(), key=lambda kv: -kv[1])[:3]]
        fails.append(f"ACROSS LISTS: {len(over_total)} firms exceed the ceiling of "
                     f"{per_firm_total} emails from one sender, worst {worst}")

    cross = sum(1 for n in seen.values() if n > 1)
    if cross and len(lists) > 1:
        fails.append(f"ACROSS LISTS: {cross} addresses appear on more than one list")

    if check_mx:
        status = {d: mx_status(d, mx_runner) for d in all_domains}
        dead = {d: s for d, s in status.items() if s in {"none", "null-mx"}}
        errs = [d for d, s in status.items() if s == "error"]
        rows_dead = sum(all_domains[d] for d in dead)
        if dead:
            fails.append(f"MX: {len(dead)} domains cannot receive mail (no MX, no A, or null "
                         f"MX), covering {rows_dead} rows")
        if errs:
            warns.append(f"MX: {len(errs)} domains could not be resolved (DNS error); "
                         f"unchecked, not passed")
        live = sum(1 for s in status.values() if s in {"mx", "a-only"})
        notes.append(f"MX floor: {live} of {len(status)} domains have a mail server. That "
                     f"proves the DOMAIN takes mail, not that any mailbox exists. It is not "
                     f"verification.")

    return {"files": len(lists), "rows": total, "fails": fails, "warnings": warns,
            "notes": notes}


def sender_rules(entry):
    """The client's refused sender addresses, as compiled regexes."""
    return [(p, re.compile(p, re.I)) for p in (entry or {}).get("refused_senders") or []]


def bad_sender(email, rules):
    """Which refused-sender rule this address matches, or None."""
    e = (email or "").lower()
    for pattern, rx in rules:
        if rx.search(e):
            return f"matches {pattern}"
    return None


def check_senders(path, rules, source=""):
    """Read a sender list (CSV with an email column, or `clay campaigns options
    sender-accounts` JSON) and return the failures."""
    if path.endswith(".json"):
        with open(path) as fh:
            emails = [a.get("email", "") for a in json.load(fh).get("data", [])]
    else:
        rows, cols = read_rows(path)
        if "email" not in cols:
            raise ValueError(f"{path}: no email column")
        emails = [get(r, cols, "email") for r in rows]
    if not emails:
        return [f"SENDERS: {os.path.basename(path)} is empty"]
    bad = [(e, why) for e in emails if (why := bad_sender(e, rules))]
    if not bad:
        return []
    who = f" ({source})" if source else ""
    return [f"SENDERS: {len(bad)} of {len(emails)} inboxes are on the client's refused "
            f"list{who}, e.g. {bad[:3]}"]


# --------------------------------------------------------------- receipts

def receipt_dir():
    return Path(os.path.expanduser("~")) / ".chewbacca" / "state" / "send-gate-receipts"


def receipt_path(client):
    return receipt_dir() / (gtme_config.slug(client) + ".json")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def write_receipt(a, client, dest=None):
    """gtme-grade --verify reads this before any campaign START or add-leads.

    Only a run with every check on counts as full. --first-send, catch-all and
    a run without the MX floor still pass the gate for a dry run, but cannot
    unlock a launch: a client with prior sends never has "nobody was emailed
    before" true. Every input file is hashed so the verify refuses if a list,
    suppression, sender or verification file changed after the pass."""
    inputs = list(a.files) + list(a.suppress)
    inputs += [p for p in (a.senders, a.verification) if p]
    full_but_lines = (bool(a.senders) and bool(a.suppress) and bool(a.verification) and a.mx
                      and not a.no_title_check and not a.allow_catch_all)
    # full_but_lines: every check on, for a campaign that sends one story and no
    # per-lead line. A launch accepts it; add-leads needs full.
    full = full_but_lines and not a.no_lines
    dest = Path(dest) if dest else receipt_path(client)
    try:
        hashes = {os.path.abspath(p): sha256(p) for p in inputs}
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
        with open(tmp, "w") as fh:
            json.dump({"time": int(time.time()), "client": client, "full": full,
                       "full_but_lines": full_but_lines, "hashes": hashes}, fh)
        os.replace(tmp, dest)
    except OSError as exc:
        print(f"pre-send-gate: could not write receipt: {exc}", file=sys.stderr)


def read_receipt(client):
    """The client's receipt as written, or None."""
    try:
        r = json.loads(receipt_path(client).read_text())
    except (OSError, ValueError):
        return None
    return r if isinstance(r, dict) else None


# ------------------------------------------------------------------ main

def main(argv=None, client=None, receipt=None, default_aliases=None):
    """client: the clients.json name, when a client repo's shim runs this;
    receipt: a path to write the receipt to instead of the client's own (tests)."""
    ap = argparse.ArgumentParser(prog="chewbacca gtme presend",
                                 description="Refuse a send list unless every address "
                                             "verified and firm ceilings hold.")
    ap.add_argument("files", nargs="+")
    if client is None:
        ap.add_argument("--client", required=True, help="the client in clients.json these lists are for")
    ap.add_argument("--verification", help="CSV of email + verifier verdict, joined by email")
    ap.add_argument("--suppress", action="append", default=[],
                    help="CSV of addresses that must not be on any list (repeatable)")
    ap.add_argument("--aliases", default=default_aliases, help="firm alias table (alias_key, canonical_key, domain)")
    ap.add_argument("--per-campaign-firm", type=int)
    ap.add_argument("--per-firm-total", type=int)
    ap.add_argument("--allow-catch-all", action="store_true",
                    help="count catch-all verdicts as a warning instead of a failure")
    ap.add_argument("--mx", action="store_true", help="also run the DNS MX floor (needs dig)")
    ap.add_argument("--senders", help="sender inboxes the campaign uses: CSV with an email "
                                      "column, or clay sender-accounts JSON")
    ap.add_argument("--no-senders", action="store_true",
                    help="skip the sender check (list-only dry run)")
    ap.add_argument("--first-send", action="store_true",
                    help="assert nobody on these lists was ever emailed before, in place "
                         "of --suppress <earlier recipients>")
    ap.add_argument("--no-title-check", action="store_true",
                    help="the list has no titles and you accept not checking roles")
    ap.add_argument("--no-lines", action="store_true",
                    help="the campaign sends no per-lead personalized line")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    name = client or a.client

    entry = gtme_config.client(name)
    if entry is None:
        print(f"pre-send-gate: no client named {name} in {gtme_config.config_path()}", file=sys.stderr)
        return 2
    limits = entry.get("presend") or {}
    per_campaign = a.per_campaign_firm or limits.get("per_campaign_firm") or PER_CAMPAIGN_FIRM
    per_total = a.per_firm_total or limits.get("per_firm_total") or PER_FIRM_TOTAL
    try:
        rules = sender_rules(entry)
        verification = load_verification(a.verification) if a.verification else None
        result = gate(a.files, verification, a.suppress, a.aliases, per_campaign,
                      per_total, a.allow_catch_all, a.mx,
                      require_title=not a.no_title_check, require_line=not a.no_lines)
        # Both were caught by the client on 2026-10-04, not by this gate: earlier
        # recipients were on Monday's lists, and 97 inboxes sat on domains the
        # client had ruled out. Neither can pass silently any more.
        if not a.suppress and not a.first_send:
            result["fails"].append("PRIOR SENDS: no --suppress list of earlier recipients. "
                                   "Pass everyone already emailed (every earlier wave), or "
                                   "--first-send if truly nobody was")
        if a.senders:
            result["fails"].extend(check_senders(a.senders, rules, entry.get("refused_senders_source", "")))
        elif not a.no_senders:
            result["fails"].append("SENDERS: no --senders list, so the inboxes were never "
                                   "checked against the client's refused senders")
    except (OSError, ValueError, re.error) as exc:
        print(f"pre-send-gate: {exc}", file=sys.stderr)
        return 2

    if a.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"\npre-send-gate: {result['files']} list(s), {result['rows']:,} rows")
        for n in result["notes"]:
            print(f"  note  {n}")
        for w in result["warnings"]:
            print(f"  warn  {w}")
        for f in result["fails"]:
            print(f"  FAIL  {f}")
        print("  REFUSED. Do not launch." if result["fails"] else
              "  pass  every address verified, ceilings hold.")
    if not result["fails"]:
        write_receipt(a, entry["name"], receipt)
    return 1 if result["fails"] else 0


if __name__ == "__main__":
    sys.exit(main())
