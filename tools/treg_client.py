#!/usr/bin/env python3
"""treg.to, metered per customer. One gateway to the paid contact-data
providers (Hunter, Tomba, LeadMagic and 20 more behind one routed call), so a
Chewbacca subscription can include data without a Clay seat per customer.

Every call:
- carries X-Treg-Meta customer=<slug>, so treg's own usage-by-tag report
  splits the bill the same way this file does;
- carries X-Treg-Route-Max-Cost. treg's default is $1 a call, and a waterfall
  pays every provider that bills a miss before the one that hits, so an
  uncapped lookup can cost 200 times the $0.0048 list price;
- records treg's own charge (X-Treg-Cost-Micro, integer micro-USD) and call id
  in the customer's spend.jsonl, never an estimate;
- refuses once the customer's month-to-date spend reaches their budget.

The token comes from TREG_TOKEN or the macOS Keychain (service "treg-token").
Terms checked 2026-10-11 (treg.to/terms section 07 and 11): calling the hosted
API inside our own product, tagged by customer, needs no special agreement.
"""
from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = os.environ.get("TREG_BASE", "https://treg.to")
# Most a single email lookup may cost, waterfall included. The routed finder's
# children run $0.0048 to $0.15 a hit (treg catalog, 2026-10-11); 5 cents
# allows any one mid-priced provider and stops a long chain of billed misses.
# Guessed from the catalog range, not measured on our own lists.
FIND_MAX_USD = 0.05
# Most one verify may cost. The routed verifier's 11 children list $0 to
# $0.0138 a check (treg catalog get treg.people.email.verify, 2026-10-13), so
# this reaches every one of them and no chain of misses past the dearest.
VERIFY_MAX_USD = 0.015
# The only verdict that goes out. treg's own study (treg.to/gtm-engineering,
# chapter 8, 2026-10-07): a finder "found" 60 of 60 people from title searches,
# and 32 verified deliverable, 16 risky, 4 unknown, 8 invalid. Its catalog
# notes a team that sent to catch-all hits unverified and "bounced on most of
# them" (contracts.yaml, 2026-09-06). Zeutara's unverified 9/28 send bounced 27%.
SENDABLE = "valid"
# treg's verdict words (contracts.yaml people.email.verify), plus the provider
# words a direct verify returns in output.status that mean the same thing.
_VERDICT_WORDS = {"valid": "valid", "deliverable": "valid", "ok": "valid", "safe": "valid",
                  "invalid": "invalid", "undeliverable": "invalid", "bad": "invalid",
                  "mailbox_not_found": "invalid", "catch_all": "catch_all", "catch-all": "catch_all",
                  "accept_all": "catch_all", "acceptall": "catch_all", "risky": "risky",
                  "unknown": "unknown"}
TIMEOUT = 30


class Refused(Exception):
    pass


def token() -> str:
    t = os.environ.get("TREG_TOKEN", "").strip()
    if t:
        return t
    try:
        p = subprocess.run(["security", "find-generic-password", "-s", "treg-token", "-w"],
                           capture_output=True, text=True, timeout=10)
        return p.stdout.strip() if p.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def month_spend(spend_file: Path, now: datetime) -> float:
    """Fails closed. The security review of 6db53f17 caught that an unreadable
    or corrupt ledger read as $0 spent, which reopened the whole budget. Only
    a ledger that doesn't exist yet counts as nothing spent."""
    if not spend_file.exists():
        return 0.0
    total = 0
    try:
        for line in spend_file.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("at", "")[:7] == now.strftime("%Y-%m"):
                total += int(r["cost_micro"])
    except (OSError, ValueError, KeyError, TypeError) as err:
        raise Refused(f"the spend ledger {spend_file} can't be read ({err}), so the budget can't be "
                      f"checked. Nothing more is spent until it's fixed.")
    return total / 1_000_000


def call(endpoint: str, body: dict, *, customer: str, spend_file: Path, budget_usd: float,
         max_cost_usd: float, now: datetime | None = None, extra_headers: dict | None = None) -> dict:
    """One metered call. Returns {"output", "raw", "cost_usd", "call_id", "served_by"}."""
    now = now or datetime.now(timezone.utc)
    spent = month_spend(spend_file, now)
    if spent + max_cost_usd > budget_usd:
        raise Refused(f"{customer} has used ${spent:.2f} of a ${budget_usd:.2f} data budget this month, "
                      f"and this lookup could cost up to ${max_cost_usd:.2f}.")
    tok = token()
    if not tok:
        raise Refused("No treg token on this Mac. Sign in at treg.to, then save the token to the Keychain "
                      "as treg-token.")
    if not endpoint.replace(".", "").replace("_", "").isalnum():
        raise Refused(f"not a treg endpoint id: {endpoint!r}")
    headers = {"X-Treg-Token": tok, "content-type": "application/json",
               "X-Treg-Meta": f"customer={customer}", "X-Treg-Route-Max-Cost": f"{max_cost_usd:.4f}",
               **(extra_headers or {})}
    req = urllib.request.Request(f"{BASE}/call/{endpoint}", data=json.dumps(body).encode(),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            heads, payload = r.headers, r.read()
    except urllib.error.HTTPError as err:
        heads, payload = err.headers, err.read()
        if err.code >= 400:
            # A 429 or 503 is treg turning the call away before any provider runs ("Nothing was
            # reserved or charged"). On 11/3 a saturated treg answered 503 to 6 Baptize verifies,
            # each was counted at the $0.015 cap, and the $0.10 budget ran out after 5 real checks.
            _record(spend_file, customer, endpoint, heads, now, 0 if err.code in (429, 503) else max_cost_usd)
            raise Refused(f"treg said {err.code}: {payload[:200].decode('utf-8', 'replace')}")
    except (urllib.error.URLError, OSError) as err:
        raise Refused(f"couldn't reach treg: {err}")
    cost = _record(spend_file, customer, endpoint, heads, now, max_cost_usd)
    try:
        data = json.loads(payload or b"{}")
    except ValueError:
        data = {}
    return {"output": data.get("output") if isinstance(data, dict) else None,
            "raw": data, "cost_usd": cost / 1_000_000, "call_id": heads.get("X-Treg-Call-Id") or "",
            "served_by": heads.get("X-Treg-Served-By") or ""}


def _record(spend_file: Path, customer: str, endpoint: str, heads, now: datetime,
            cap_usd: float = 0.0) -> int:
    # No usable charge header means treg didn't say what it billed. Count the
    # cap, the most it could have been, so the budget never undercounts.
    try:
        cost = int(heads.get("X-Treg-Cost-Micro"))
    except (TypeError, ValueError):
        cost = int(round(cap_usd * 1_000_000))
    spend_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with spend_file.open("a") as f:
        f.write(json.dumps({"at": now.isoformat(timespec="seconds"), "customer": customer,
                            "endpoint": endpoint, "cost_micro": cost,
                            "call_id": heads.get("X-Treg-Call-Id") or "",
                            "served_by": heads.get("X-Treg-Served-By") or ""}) + "\n")
    os.chmod(spend_file, 0o600)
    return cost


def find_email(*, domain: str, full_name: str, customer: str, spend_file: Path, budget_usd: float,
               now: datetime | None = None) -> dict:
    """A verified work email for one person, or output None on a miss."""
    res = call("treg.people.email.find", {"domain": domain, "full_name": full_name}, customer=customer,
               spend_file=spend_file, budget_usd=budget_usd, max_cost_usd=FIND_MAX_USD, now=now,
               extra_headers={"X-Treg-Route-Verify": "true"})
    out = res["output"] if isinstance(res["output"], dict) else {}
    verdict = ((res["raw"].get("_treg") or {}).get("verification") or {}).get("verdict") \
        if isinstance(res["raw"], dict) else None
    res["email"] = (out.get("email") or "").lower() or None
    res["verdict"] = verdict_word(verdict) if verdict else None
    return res


def verdict_word(word) -> str:
    """One of valid, invalid, catch_all, risky, unknown. Anything treg or a
    provider says that isn't on the list counts as unknown, never as valid."""
    return _VERDICT_WORDS.get(str(word or "").strip().lower().replace(" ", "_"), "unknown")


def verify_email(*, email: str, customer: str, spend_file: Path, budget_usd: float,
                 now: datetime | None = None) -> dict:
    """Whether a mailbox takes mail, from treg's routed verifier, billed to this
    customer. Adds "verdict" (a verdict_word) to call()'s result."""
    res = call("treg.people.email.verify", {"email": email}, customer=customer, spend_file=spend_file,
               budget_usd=budget_usd, max_cost_usd=VERIFY_MAX_USD, now=now)
    out = res["output"] if isinstance(res["output"], dict) else {}
    # The routed answer keeps the provider's own word in output.status and a
    # bare output.valid; a catch-all domain can say valid=true, so the word wins.
    if out.get("valid") is False:
        res["verdict"] = "invalid" if verdict_word(out.get("status")) in ("valid", "unknown") \
            else verdict_word(out.get("status"))
    elif out.get("status"):
        res["verdict"] = verdict_word(out["status"])
    elif isinstance(out.get("valid"), bool):
        res["verdict"] = "valid" if out["valid"] else "invalid"
    else:
        res["verdict"] = "unknown"
    return res
