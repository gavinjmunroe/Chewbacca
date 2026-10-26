#!/usr/bin/env python3
"""chewbacca gtme, the own-inbox half: outbound for one person with one Gmail.

`chewbacca gtme start` makes the plan and the free list. Everything after that
used to need Clay and a fleet of sending inboxes, which nobody running a small
business has. This runs the rest on their own Mac, from their own Gmail:

    chewbacca gtme sender --client X --name "Dana Ruiz" --address "12 Main St, Austin TX"
    chewbacca gtme find   --client X        emails + a sourced fact from each company's own site
    chewbacca gtme verify --client X [--spend N]   optional: check each email through treg first
    chewbacca gtme batch  --client X        today's emails, frozen, shown in full, with an id
    chewbacca gtme send   --client X --batch ID [--dry-run]
    chewbacca gtme inbox  --client X        replies sorted; opt-outs and bounces suppressed
    chewbacca gtme reply  --client X --to ADDR --text "..."   a Gmail draft, never a send
    chewbacca gtme today  --client X        inbox, then the next batch
    chewbacca gtme autosend --client X --interested "..."   the yes-reply that goes out on its own
    chewbacca gtme share  --client X --dir PATH   keep the ledger in a shared repo both people pull
    chewbacca gtme copy   --client X --file seq.json [--require-line]   your own sequence

The person approves every batch. `batch` prints each email exactly as it will
go out and an id that is a hash of that text; `send` refuses any id it didn't
make, a batch older than two hours, and anything once CHEWBACCA_NO_SEND is set.
Nothing here buys a domain, spends a credit or sends without that id.

Volume is low on purpose. Every playbook says never cold email from your
primary domain (references/bma/outbound-rules.md); a person with one Gmail has
nothing else, so the ramp is half the warmed-inbox ramp and tops out at 20 a
day, with real follow-ups threaded under the first email.
"""
from __future__ import annotations

import argparse
import base64
import csv
import email.message
import email.utils
import hashlib
import html
import http.client
import ipaddress
import json
import os
import random
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gtme_operator as op  # noqa: E402
import gtme_reply  # noqa: E402
import treg_client  # noqa: E402

# A warmed inbox ramps 5, 10, 20, 40 a day over four weeks (outbound-rules.md,
# BMA). A primary Gmail never warmed for cold mail gets half of that ceiling:
# the playbooks' own answer is "never the primary domain", and this is the
# smallest volume that still books a meeting a week at 1 per 350-500 contacts
# over a quarter. Guessed from those two sources, not measured on a fresh inbox.
RAMP = ((7, 5), (14, 10), (21, 15))
DAILY_CAP = 20
# His standing rule for anything that sends: an ok in chat within 2 hours.
BATCH_TTL = timedelta(hours=2)
# Long enough that 20 sends look like a person, short enough to finish in a
# coffee break. Guessed, never measured against a spam filter.
GAP_SECONDS = (45, 90)
FETCH_TIMEOUT = 8
FETCH_BYTES = 400_000
# What a page may grow to once decompressed. A gzip bomb turns 400 KB into
# gigabytes; a real homepage was 52 KB unpacked (python.org, 2026-10-11).
PAGE_CHARS = 2_000_000
PAGES = ("", "/contact", "/contact-us", "/about")
MAX_WORDS = 125
ROLE = re.compile(r"^(info|contact|hello|hi|office|admin|sales|team|support|help|mail|enquiries|inquiries|"
                  r"booking|bookings|appointments|frontdesk|reception)@", re.I)
NEVER = re.compile(r"^(no-?reply|donotreply|postmaster|abuse|privacy|legal|webmaster|careers|jobs|"
                   r"press|media|unsubscribe)@|@(sentry|wixpress|example|sentry-next)\.|\.(png|jpe?g|gif|svg|webp)$",
                   re.I)
EMAIL_RX = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}")
TITLE_RX = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
META_RX = re.compile(r"<meta[^>]+(?:name|property)=[\"'](?:og:)?description[\"'][^>]*content=[\"']([^\"']{10,400})",
                     re.I)
DASH = re.compile("[—–]")
OPT_OUT = "If you'd rather not hear from me, reply stop and I won't email you again."


# What one customer's package costs us each month, before anything is sold.
# Mailforge lists about $3 a mailbox (bitscale.ai review, 2026-10-11) and a
# .com is about $12 a year; the data budget is a cap, not a forecast.
PACKAGE_DEFAULTS = {"shape": "retainer", "data_budget_usd": 25.0, "mailboxes": 10, "mailbox_usd": 3.0, "domains": 4,
                    "domain_usd_year": 12.0, "price_usd": None}
# The three ways a founder buys it (Caleb, 2026-10-23, after the UCLA showcase:
# "retainer, one-time list or software they run themselves"). Only a retainer
# sends from mailboxes and domains we pay for; the other two send from theirs.
SHAPES = {"retainer": "we run it every week, a month", "one_time_list": "a list and its copy, once",
          "self_serve": "they run it on their own inboxes, a month"}


class Refused(Exception):
    pass


# ── files ────────────────────────────────────────────────────────────────


def cdir(client: str) -> Path:
    return op.client_dir(client)


def plan_of(client: str) -> dict:
    plan = op.read_json(cdir(client) / "plan.json", None)
    if not plan:
        raise Refused(f"There's no plan for {client} yet. Run `chewbacca gtme start --client \"{client}\"` first.")
    return plan


def jsonl(path: Path) -> list[dict]:
    try:
        return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    except (OSError, ValueError):
        return []


def append(path: Path, row: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(row, default=str) + "\n")
    os.chmod(path, 0o600)


def suppressed(client: str) -> dict[str, str]:
    return {r["email"]: r.get("why", "") for r in jsonl(cdir(client) / "suppress.jsonl")}


def suppress(client: str, addr: str, why: str) -> None:
    if addr.lower() not in suppressed(client):
        append(cdir(client) / "suppress.jsonl", {"email": addr.lower(), "why": why, "at": op.stamp()})


# ── find: the company's own site, never a paid lookup ─────────────────────


def domain_of(url: str) -> str:
    host = urllib.parse.urlsplit(url if "//" in url else "http://" + url).hostname or ""
    return host.lower().removeprefix("www.")


def public_host(host: str) -> bool:
    """SSRF guard (rules/security.md): every address the name resolves to must
    be public. A listing a stranger wrote can point its website at 127.0.0.1."""
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global:
            return False
    return bool(infos)


def vetted_address(host: str, port: int) -> tuple:
    """Resolve once, refuse any non-public answer, and hand back the exact
    address to connect to. Connecting by name would resolve a second time,
    and a name can answer public for the check and private for the connect
    (DNS rebinding). A check on the socket's peer instead broke every fetch
    inside Claude Code's sandbox, which relays all traffic through 127.0.0.1
    (2026-10-11)."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for info in infos:
        if not ipaddress.ip_address(info[4][0].split("%")[0]).is_global:
            raise OSError(f"{host} resolves to a private address")
    if not infos:
        raise OSError(f"{host} doesn't resolve")
    return infos[0][4][:2]


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.create_connection(vetted_address(self.host, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        sock = socket.create_connection(vetted_address(self.host, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTP(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_PinnedHTTPConnection, req)


class _PinnedHTTPS(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_PinnedHTTPSConnection, req, context=self._context)


class _Guarded(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urllib.parse.urlsplit(newurl).hostname or ""
        if not public_host(host):
            raise urllib.error.URLError(f"redirect to a private address: {host}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url: str, limit: int = FETCH_BYTES) -> str:
    fx = os.environ.get("GTME_FIXTURES")
    parts = urllib.parse.urlsplit(url)
    if fx:
        name = (parts.hostname or "").removeprefix("www.") + (parts.path.replace("/", "_") or "")
        p = Path(fx) / "sites" / (name + ".html")
        return p.read_text() if p.exists() else ""
    if parts.scheme not in ("http", "https") or not public_host(parts.hostname or ""):
        return ""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh) chewbacca-gtme"})
    try:
        # No proxy: through one, the peer checked would be the proxy, not the site.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _PinnedHTTP, _PinnedHTTPS, _Guarded)
        with opener.open(req, timeout=FETCH_TIMEOUT) as r:
            if "html" not in (r.headers.get("Content-Type") or "html"):
                return ""
            return decode_body(r.read(min(limit, PAGE_CHARS)), r.headers.get("Content-Encoding") or "",
                               r.headers.get_content_charset() or "utf-8")
    # http.client.HTTPException too: a stranger's website cell held two hosts
    # on two lines ("www.aim13.com\nwww.aim13.nyc", 2026-10-26) and InvalidURL
    # crashed a 3,000-row investor run an hour in.
    except (urllib.error.URLError, OSError, ValueError, zlib.error, http.client.HTTPException):
        return ""


def decode_body(raw: bytes, encoding: str, charset: str) -> str:
    """python.org answered a plain request with gzip on 2026-10-11, and the
    page read as binary noise: no title, no email. Some servers compress
    whether or not they were asked, so the bytes decide, not the request."""
    if "gzip" in encoding.lower() or raw[:2] == b"\x1f\x8b":
        raw = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(raw, PAGE_CHARS)
    elif "deflate" in encoding.lower():
        try:
            raw = zlib.decompressobj().decompress(raw, PAGE_CHARS)
        except zlib.error:
            raw = zlib.decompressobj(-zlib.MAX_WBITS).decompress(raw, PAGE_CHARS)
    return raw[:PAGE_CHARS].decode(charset, "replace")


def emails_on(page: str, domain: str) -> list[str]:
    text = html.unescape(urllib.parse.unquote(page))
    seen = []
    for m in EMAIL_RX.findall(text):
        a = m.lower().strip(".")
        own = a.split("@", 1)[1]
        if NEVER.search(a) or not (own == domain or own.endswith("." + domain)):
            continue
        if a not in seen:
            seen.append(a)
    # A named person beats the shared inbox; both beat nothing.
    return sorted(seen, key=lambda a: bool(ROLE.match(a)))


def fact_on(page: str) -> str:
    m = META_RX.search(page) or TITLE_RX.search(page)
    return re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()[:220] if m else ""


def cmd_find(a) -> int:
    d = cdir(a.client)
    plan_of(a.client)
    src = d / "deduped" / "golden.csv"
    if not src.exists():
        src = d / "list-raw.csv"
    if not src.exists():
        raise Refused(f"No list yet. Run `chewbacca gtme list --client \"{a.client}\"` first.")
    with src.open() as f:
        rows = list(csv.DictReader(f))
    out, found = [], 0
    for r in rows[: a.limit]:
        site = (r.get("website") or "").strip()
        dom = domain_of(site) if site else ""
        addr, where, fact, fact_url = (r.get("email") or "").strip().lower(), "", "", ""
        if dom:
            base = site if "//" in site else "https://" + site
            base = base.rstrip("/")
            for path in PAGES:
                page = fetch(base + path)
                if not page:
                    continue
                if not fact:
                    fact, fact_url = fact_on(page), base + path
                if not addr:
                    hits = emails_on(page, dom)
                    if hits:
                        addr, where = hits[0], base + path
                if addr and fact:
                    break
        if addr:
            found += 1
        out.append({**{k: r.get(k, "") for k in op.LIST_COLUMNS}, "email": addr, "email_source": where,
                    "role_inbox": "yes" if addr and ROLE.match(addr) else "", "site_fact": fact,
                    "site_fact_source": fact_url})
    # A rerun of find keeps what was already paid for: verdicts, and emails a
    # paid lookup found, which the site still won't print.
    old = d / "leads.csv"
    prior = list(csv.DictReader(old.open())) if old.exists() else []
    known = {r["email"].lower(): r.get("email_verdict", "") for r in prior if r.get("email")}
    bought = {(r.get("company"), r.get("website"), r.get("name")): r for r in prior
              if (r.get("email_source") or "").startswith("treg ")}
    for r in out:
        paid_row = bought.get((r.get("company"), r.get("website"), r.get("name")))
        if not r["email"] and paid_row:
            r["email"], r["email_source"] = paid_row["email"].lower(), paid_row["email_source"]
        r["email_verdict"] = known.get(r["email"], "") if r["email"] else ""
    paid = paid_lookups(a, out) if a.paid else None
    cols = op.LIST_COLUMNS + ["email_source", "role_inbox", "site_fact", "site_fact_source", "email_verdict"]
    with (d / "leads.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in out:
            w.writerow({k: op.csv_cell(str(r.get(k) or "")) for k in cols})
    print(f"Checked {len(out)} companies' own websites. Found an email for {found}, every one printed on "
          f"that company's site (the page is saved next to it). Nothing was bought or guessed.")
    if paid:
        print(paid)
    print(f"Saved: {d / 'leads.csv'}")
    return 0


def package_of(plan: dict) -> dict:
    return {**PACKAGE_DEFAULTS, **(plan.get("package") or {})}


def paid_lookups(a, rows: list[dict]) -> str:
    """Emails the site didn't print, from treg's routed finder, billed to this
    customer. With no --spend it runs ONE lookup and reports the real charge
    and what the rest would cost (feedback_price_one_run_before_bulk); only an
    approved --spend amount runs the rest, and the monthly budget caps both."""
    plan = plan_of(a.client)
    pkg = package_of(plan)
    want = [r for r in rows if not r["email"] and r.get("name") and r.get("website")]
    if not want:
        return "Nobody left needs a paid lookup: every lead without an email also has no person's name."
    spend_file = cdir(a.client) / "spend.jsonl"
    customer = op.slug(a.client)
    limit = a.spend if a.spend is not None else 0.0
    spent, tried, hit, unsure = 0.0, 0, 0, 0
    for r in want:
        if a.spend is None and tried == 1:
            break
        if a.spend is not None and spent + treg_client.FIND_MAX_USD > limit:
            break
        try:
            res = treg_client.find_email(domain=domain_of(r["website"]), full_name=r["name"], customer=customer,
                                         spend_file=spend_file, budget_usd=pkg["data_budget_usd"],
                                         now=op.utc_now())
        except treg_client.Refused as err:
            return f"Paid lookups stopped: {err}"
        tried += 1
        spent += res["cost_usd"]
        # Only a mailbox the check called valid. catch_all, risky and unknown
        # were all let through before 2026-10-13; see treg_client.SENDABLE.
        # A paid-for address is kept either way, with its verdict, so batch
        # holds it and the next run never buys the same lookup again.
        if res["email"]:
            r["email"], r["email_source"] = res["email"], f"treg {res['served_by'] or 'finder'} {res['call_id']}"
            r["email_verdict"] = res.get("verdict") or "unknown"
            if r["email_verdict"] == treg_client.SENDABLE:
                hit += 1
            else:
                unsure += 1
    left = len(want) - tried
    if a.spend is None:
        each = max(spent, 0.0001)
        return (f"Priced one paid lookup: ${spent:.4f}, {'found' if hit else 'no email found'}. "
                f"The other {left} would cost about ${each * left:.2f} at that rate, up to "
                f"${treg_client.FIND_MAX_USD * left:.2f} at the per-lookup cap. Nothing more was spent; "
                f"approve an amount with --spend.")
    kept_out = (f" {unsure} more came back but didn't verify as a live mailbox, so batches hold them."
                if unsure else "")
    return (f"Paid lookups: {tried} tried, {hit} found and verified, ${spent:.2f} spent of the ${limit:.2f} "
            f"approved. {left} left.{kept_out}")


def cmd_verify(a) -> int:
    """Checks each lead's email with treg's routed verifier before it goes out
    from their own inbox, where a bounce costs the person's own sender
    reputation. Optional: with no treg token it says so and changes nothing.
    Same gate as paid lookups: no --spend prices ONE check and stops."""
    plan = plan_of(a.client)
    pkg = package_of(plan)
    d = cdir(a.client)
    leads_csv = d / "leads.csv"
    if not leads_csv.exists():
        raise Refused(f"No leads yet. Run `chewbacca gtme find --client \"{a.client}\"` first.")
    with leads_csv.open() as f:
        reader = csv.DictReader(f)
        cols, rows = list(reader.fieldnames or []), list(reader)
    if "email_verdict" not in cols:
        cols.append("email_verdict")
    off = suppressed(a.client)
    want = [r for r in rows if r.get("email") and not r.get("email_verdict") and r["email"].lower() not in off]
    if not want:
        print("Every lead with an email already has a verdict. Nothing to check.")
        return 0
    if not treg_client.token():
        print(f"{len(want)} emails aren't verified, and there's no treg token on this Mac, so nothing was checked. "
              "Verifying is optional: sign in at treg.to and save the token to the Keychain as treg-token "
              "to check them before they go out.")
        return 0
    customer, limit = op.slug(a.client), a.spend if a.spend is not None else 0.0
    spent, tried, counts, stop = 0.0, 0, {}, ""

    def save():
        with leads_csv.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({k: op.csv_cell(str(r.get(k) or "")) for k in cols})

    # Saved after every check, so a verdict already paid for survives Ctrl-C.
    for r in want:
        if a.spend is None and tried == 1:
            break
        if a.spend is not None and spent + treg_client.VERIFY_MAX_USD > limit:
            break
        try:
            res = treg_client.verify_email(email=r["email"], customer=customer, spend_file=d / "spend.jsonl",
                                           budget_usd=pkg["data_budget_usd"], now=op.utc_now())
        except treg_client.Refused as err:
            stop = f" Stopped: {err}"
            break
        tried += 1
        spent += res["cost_usd"]
        r["email_verdict"] = res["verdict"]
        counts[res["verdict"]] = counts.get(res["verdict"], 0) + 1
        if res["verdict"] == "invalid":
            suppress(a.client, r["email"], f"treg verify: invalid ({res['served_by'] or 'verifier'} {res['call_id']})")
        save()
    left = len(want) - tried
    tally = ", ".join(f"{n} {v}" for v, n in sorted(counts.items())) or "none"
    if a.spend is None:
        print(f"Priced one check: ${spent:.4f}, {tally}. The other {left} would cost up to "
              f"${treg_client.VERIFY_MAX_USD * left:.2f} at the per-check cap. Nothing more was spent; approve an "
              f"amount with --spend.{stop}")
    else:
        print(f"Verified {tried}: {tally}. ${spent:.2f} spent of the ${limit:.2f} approved, {left} left. Invalid "
              f"addresses are suppressed; catch_all, risky and unknown are held out of batches.{stop}")
    return 0


def client_terms(client: str) -> dict:
    """Motion and pricing from the founder's client json, when one exists.
    The plan's own values win; these fill only what the plan never set."""
    import gtme_pipeline
    try:
        _, cfg = gtme_pipeline.config_for(client)
        return {"motion": gtme_pipeline.motions_of(cfg), **gtme_pipeline.pricing_of(cfg)}
    except gtme_pipeline.Refused as err:
        if "no client config" in str(err):
            return {}
        raise Refused(f"the client config: {err}")


def motion_of(plan: dict, client: str) -> list[str]:
    return list(plan.get("motion") or client_terms(client).get("motion") or [])


def cmd_package(a) -> int:
    plan = plan_of(a.client)
    pkg = package_of(plan)
    terms = client_terms(a.client)
    if not (plan.get("package") or {}).get("shape") and terms.get("shape"):
        pkg["shape"] = terms["shape"]
    if (plan.get("package") or {}).get("price_usd") is None and terms.get("price") is not None:
        pkg["price_usd"] = terms["price"]
    for k in ("shape", "data_budget_usd", "mailboxes", "mailbox_usd", "domains", "domain_usd_year", "price_usd"):
        v = getattr(a, k)
        if v is not None:
            pkg[k] = v
    if a.motion:
        import gtme_pipeline
        try:
            plan["motion"] = gtme_pipeline.motions_of({"motion": [m.strip() for m in a.motion.split(",") if m.strip()]})
        except gtme_pipeline.Refused as err:
            raise Refused(str(err))
    plan["package"] = pkg
    op.write_json(cdir(a.client) / "plan.json", plan)
    return cmd_costs(a)


def cmd_costs(a) -> int:
    plan = plan_of(a.client)
    pkg = package_of(plan)
    now = op.utc_now()
    try:
        data = treg_client.month_spend(cdir(a.client) / "spend.jsonl", now)
    except treg_client.Refused as err:
        raise Refused(str(err))
    shape = pkg["shape"]
    ours = shape == "retainer"
    inboxes = pkg["mailboxes"] * pkg["mailbox_usd"] if ours else 0.0
    domains = pkg["domains"] * pkg["domain_usd_year"] / 12 if ours else 0.0
    total = data + inboxes + domains
    sent = sum(1 for r in jsonl(cdir(a.client) / "sent.jsonl") if r["at"][:7] == now.strftime("%Y-%m"))
    motion = motion_of(plan, a.client)
    out = {"month": now.strftime("%Y-%m"), "shape": shape, "motion": motion, "data_usd": round(data, 2), "data_budget_usd": pkg["data_budget_usd"],
           "mailboxes_usd": round(inboxes, 2), "domains_usd": round(domains, 2), "total_usd": round(total, 2),
           "emails_sent": sent, "price_usd": pkg["price_usd"],
           "margin_usd": round(pkg["price_usd"] - total, 2) if pkg["price_usd"] is not None else None}
    if getattr(a, "json", False):
        print(json.dumps(out, indent=1))
        return 0
    sending = (f"{pkg['mailboxes']} mailboxes ${inboxes:.2f}, {pkg['domains']} domains ${domains:.2f} a month"
               if ours else "no mailboxes or domains, they send from their own")
    if motion:
        print(f"{a.client} sells to " + ", then ".join(m.replace("_", " ") for m in motion) + ".")
    print(f"{a.client}, {SHAPES[shape]}, {out['month']}: data ${data:.2f} of a ${pkg['data_budget_usd']:.2f} budget "
          f"(treg's own charges), {sending}. Total ${total:.2f}, {sent} emails sent.")
    if pkg["price_usd"] is not None:
        per = "once" if shape == "one_time_list" else "a month"
        print(f"At ${pkg['price_usd']:.0f} {per} that leaves ${out['margin_usd']:.2f}.")
    else:
        print("No price set yet, so no margin.")
    return 0


# ── batch: today's emails, frozen ────────────────────────────────────────


def today_cap(client: str) -> int:
    sent = [r for r in jsonl(cdir(client) / "sent.jsonl") if r.get("step") == 1]
    if not sent:
        return RAMP[0][1]
    first = min(op.parse_time(r["at"]) for r in sent)
    days = (op.utc_now() - first).days
    return next((n for limit, n in RAMP if days < limit), DAILY_CAP)


def sent_today(client: str) -> int:
    day = op.utc_now().date()
    return sum(1 for r in jsonl(cdir(client) / "sent.jsonl") if op.parse_time(r["at"]).date() == day)


def fill(text: str, lead: dict) -> str:
    first = (lead.get("name") or "").split(" ")[0].strip()
    greet = first if first and not lead.get("role_inbox") else f"{lead.get('company') or 'there'} team"
    out = (text.replace("{{first_name}}", greet).replace("{{company}}", lead.get("company") or "your team")
               .replace("{{signal_line}}", lead.get("line") or ""))
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def unsign(body: str, sign: str) -> str:
    """The draft's own sign-off line taken off the end, since the footer signs.
    Only a final line: a bare replace also ate the name inside "At Dana Co, we
    help", sending "At  Co" (found 2026-10-11)."""
    lines = body.rstrip().split("\n")
    if lines and lines[-1].strip() == sign:
        lines.pop()
    return "\n".join(lines).strip()


def footer(sender: dict) -> str:
    return f"{sender['name']}\n{sender['address']}\n\n{OPT_OUT}"


def problems(mail: dict) -> list[str]:
    """The gates every email passes before it can sit in a batch. The
    playbook checklist (demand-gen-playbooks.md, Growth Engine X): a real
    sender, a physical address and an opt-out, every variable resolved."""
    body, out = mail["body"], []
    if "{{" in body or "{{" in mail["subject"]:
        out.append("a {{blank}} is still in it")
    if DASH.search(body + mail["subject"]):
        out.append("it has a long dash")
    if OPT_OUT not in body:
        out.append("no opt-out line")
    words = len(body.split(OPT_OUT)[0].split())
    if words > MAX_WORDS:
        out.append(f"{words} words, over {MAX_WORDS}")
    if mail.get("line") and not re.match(r"https?://", mail.get("line_source") or ""):
        out.append("the personal line has no public source link")
    return out


def sagar_review(plan: dict, step1: dict) -> tuple[list[str], list[str]]:
    """Sagar's first-email rules (tools/gtme_grade.py sagar_email), the same
    ones gtme-grade runs on a campaign, on this client's step 1 as it will go
    out: the subject stacks the offer's nouns, the email says who it is from
    and what is sold. Returns (refusals, warnings). Who the email comes from
    and what it sells come from the plan and ~/.chewbacca/gtm/clients.json,
    never from a name written into this file."""
    import gtme_grade
    sender = plan.get("sender") or {}
    client = gtme_grade.load_client(plan.get("client")) or {}
    company = sender.get("company") or client.get("sender_company") or plan.get("client")
    offer = (plan.get("offer") or {}).get("what_you_sell") or (plan.get("answers") or {}).get("sell")
    names = [sender.get("name"), (plan.get("answers") or {}).get("sender"), client.get("principal")]
    sign = "\n".join(x for x in (sender.get("name"), sender.get("address")) if x)
    res = gtme_grade.sagar_email(step1.get("subject") or "", f"{step1.get('body') or ''}\n\n{sign}",
                                 offer, [n for n in names if n], company, "email 1")
    bad = [f"{m} [{src}]" for m, src in res["fails"]]
    bad += [f"NOT CHECKED {what}: {why}" for what, why in res["skips"]]
    warns = [f"{m} [{src}]" for m, src in res["warns"]]
    if "{{signal_line}}" not in (step1.get("body") or "") and not gtme_grade.personal_fields(step1.get("body") or ""):
        warns.append(f"email 1 has no per-lead line, so nothing in it is a signal [{gtme_grade.SAGAR_SIGNALS}]")
    return bad, warns


def lines_from(path: str | None) -> dict[str, dict]:
    """Personal first lines the agent wrote after reading each site, as
    {email: {"line": "...", "source": "https://..."}}. Code checks them;
    the agent writes them, because only judgment makes one worth reading."""
    if not path:
        return {}
    if not Path(path).exists():
        return {}
    body = op.read_json(Path(path), {})
    return {k.lower(): v for k, v in body.items() if isinstance(v, dict)} if isinstance(body, dict) else {}


def due_followups(client: str, plan: dict) -> list[dict]:
    steps = {c["step"]: c for c in plan["copy"]}
    sent = jsonl(cdir(client) / "sent.jsonl")
    replied = {r["email"] for r in jsonl(cdir(client) / "replies.jsonl")}
    off = suppressed(client)
    last: dict[str, dict] = {}
    for r in sent:
        if r["email"] not in last or r["step"] > last[r["email"]]["step"]:
            last[r["email"]] = r
    first = {r["email"]: r for r in sent if r["step"] == 1}
    out = []
    for addr, r in last.items():
        nxt = steps.get(r["step"] + 1)
        if not nxt or addr in replied or addr in off or addr not in first:
            continue
        if op.utc_now() - op.parse_time(first[addr]["at"]) >= timedelta(days=nxt["day"]):
            out.append({"lead": first[addr]["lead"], "step": nxt["step"], "thread": first[addr].get("thread"),
                        "message_id": first[addr].get("message_id"), "subject": "Re: " + first[addr]["subject"]})
    return out


# Caleb to Gavin, 2026-10-11: "ones that don't reply after 3 days we follow up
# and also email other members of the staff". A church is one account: the
# next person there waits until the first has had this long to answer, and
# anyone at the church replying stops the rest. The 3 is his, not measured.
NEXT_CONTACT_DAYS = 3


def account_of(addr: str) -> str:
    dom = addr.rsplit("@", 1)[-1].lower()
    return "" if gtme_reply.FREE_MAIL.search(dom) else dom


def account_state(client: str) -> tuple[dict, set]:
    """When each account was first emailed, and which accounts have replied."""
    first: dict[str, object] = {}
    for r in jsonl(cdir(client) / "sent.jsonl"):
        acct = account_of(r.get("email", ""))
        if acct and r.get("step") == 1:
            at = op.parse_time(r["at"])
            if acct not in first or at < first[acct]:
                first[acct] = at
    answered = {account_of(r.get("email", "")) for r in jsonl(cdir(client) / "replies.jsonl")}
    answered |= {account_of(r.get("from", "")) for r in jsonl(cdir(client) / "replies.jsonl")}
    answered.discard("")
    return first, answered


def cmd_batch(a) -> int:
    plan = plan_of(a.client)
    sender = plan.get("sender") or {}
    if not (sender.get("name") and sender.get("address")):
        raise Refused("Every cold email has to carry your name and a mailing address (CAN-SPAM). Run "
                      f"`chewbacca gtme sender --client \"{a.client}\" --name \"...\" --address \"...\"` first.")
    if op.utc_now().weekday() >= 5 and not a.weekend:
        raise Refused("It's the weekend. Cold email goes out Monday to Friday, in their business hours.")
    step1 = next((c for c in plan.get("copy") or [] if c.get("step") == 1), {})
    refusals, warns = sagar_review(plan, step1)
    if refusals:
        raise Refused("No batch. Email 1 fails Sagar's review, the same one gtme-grade runs on a campaign: "
                      + "; ".join(refusals) + ". Fix the copy with `chewbacca gtme copy`.")
    room = max(0, today_cap(a.client) - sent_today(a.client))
    d = cdir(a.client)
    # No --lines: the ledger's own lines.json. On 10/12 all 252 Firm Foundation
    # SoCal leads were held as "no personal line" because the file sat in the
    # ledger and nobody passed the flag.
    lines = lines_from(a.lines or str(cdir(a.client) / "lines.json"))
    off = suppressed(a.client)
    contacted = {r["email"] for r in jsonl(d / "sent.jsonl")}
    steps = {c["step"]: c for c in plan["copy"]}
    sign = plan["answers"].get("sender") or "{{your first name}}"
    mails, held = [], []
    for f in due_followups(a.client, plan):
        if len(mails) >= room:
            break
        lead, c = f["lead"], steps[f["step"]]
        body = unsign(fill(c["body"], lead), sign)
        mail = {"to": lead["email"], "step": f["step"], "subject": f["subject"], "lead": lead,
                "thread": f["thread"], "message_id": f["message_id"], "body": f"{body}\n\n{footer(sender)}"}
        bad = problems(mail)
        (held if bad else mails).append({**mail, "held_for": bad} if bad else mail)
    leads_csv = d / "leads.csv"
    rows = list(csv.DictReader(leads_csv.open())) if leads_csv.exists() else []
    first_at, answered = account_state(a.client)
    wait = timedelta(days=plan.get("next_contact_days", NEXT_CONTACT_DAYS))
    in_batch = set()
    for r in rows:
        if len(mails) >= room:
            break
        addr = (r.get("email") or "").lower()
        if not addr or addr in contacted or addr in off:
            continue
        acct = account_of(addr)
        if acct and (acct in answered or acct in in_batch
                     or (acct in first_at and op.utc_now() - first_at[acct] < wait)):
            continue
        if acct:
            in_batch.add(acct)
        extra = lines.get(addr, {})
        lead = {k: r.get(k, "") for k in ("company", "name", "email", "website", "role_inbox")}
        lead["line"] = (extra.get("line") or "").strip()
        c = steps[1]
        body = unsign(fill(c["body"], lead), sign)
        mail = {"to": addr, "step": 1, "subject": fill(c["subject"], lead), "lead": lead,
                "line": lead["line"], "line_source": extra.get("source") or "",
                "body": f"{body}\n\n{footer(sender)}"}
        bad = problems(mail)
        verdict = (r.get("email_verdict") or "").strip()
        if verdict and verdict != treg_client.SENDABLE:
            bad.append(f"the email verified as {verdict}, not a live mailbox")
        if plan.get("require_line") and not lead["line"]:
            bad.append("the first email needs its personal line and this lead has none yet")
        (held if bad else mails).append({**mail, "held_for": bad} if bad else mail)
    if plan.get("jev_checks") and mails:
        import gtme_jev
        rulings = op.rulings_for(a.client)
        kept = []
        for m in mails:
            why = gtme_jev.review(m, rulings, min_grade=plan.get("min_grade"))
            (held.append({**m, "held_for": why}) if why else kept.append(m))
            # Every verdict next to the address it was about, so replies and
            # meetings can later be joined to it and the bars set from our
            # own numbers instead of guesses.
            append(d / "jev.jsonl", {"to": m["to"], "step": m["step"], "held": bool(why), "why": why,
                                     "at": op.stamp()})
        mails = kept
    frozen = json.dumps([{k: m[k] for k in ("to", "step", "subject", "body")} for m in mails], sort_keys=True)
    bid = hashlib.sha256(frozen.encode()).hexdigest()[:10]
    batch = {"id": bid, "made_at": op.stamp(), "client": a.client, "mails": mails, "held": held,
             "inbox": a.inbox or sender.get("inbox") or "", "warnings": warns}
    if mails:
        op.write_json(d / "batches" / f"{bid}.json", batch)
    if a.json:
        print(json.dumps(batch, indent=1))
        return 0
    print(f"Today's limit is {today_cap(a.client)} (a new inbox ramps slowly so Gmail keeps trusting it); "
          f"{sent_today(a.client)} already went out today.")
    if not mails:
        print("Nothing to send today." + (f" {len(held)} held, below." if held else ""))
    for n, m in enumerate(mails, 1):
        print(f"\n--- {n}. To {m['to']} ({m['lead'].get('company')}), email {m['step']} of {len(steps)}")
        print(f"Subject: {m['subject']}\n")
        print(m["body"])
    for m in held:
        print(f"\nHeld, not in the batch: {m['to']}: {'; '.join(m['held_for'])}")
    for w in warns:
        print(f"\nWarning: {w}")
    if mails:
        print(f"\nBatch {bid}: {len(mails)} emails, exactly as above. Nothing has been sent. "
              f"Say ok and this batch goes out from your Gmail, spaced a minute or so apart. "
              f"The ok is good for 2 hours.")
    return 0


# ── send ─────────────────────────────────────────────────────────────────


def gws(args: list[str], inbox: str = "") -> dict:
    env = dict(os.environ)
    if inbox:
        env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = str(Path(os.path.expanduser(
            os.environ.get("CHEWBACCA_EMAIL_HOME", "~/.chewbacca/email"))) / inbox)
    p = subprocess.run([os.environ.get("CHEWBACCA_GWS_BIN", "gws")] + args, capture_output=True, text=True,
                       timeout=90, env=env)
    out = p.stdout or ""
    if p.returncode != 0 or "{" not in out:
        raise RuntimeError(((p.stderr or out).strip().splitlines() or ["gws failed"])[-1][:200])
    return json.loads(out[out.index("{"):])


def mime(m: dict, sender: dict) -> dict:
    msg = email.message.EmailMessage()
    msg["To"] = m["to"]
    msg["Subject"] = m["subject"] or "(no subject)"
    if sender.get("email"):
        msg["From"] = email.utils.formataddr((sender["name"], sender["email"]))
    if m.get("message_id"):
        msg["In-Reply-To"] = m["message_id"]
        msg["References"] = m["message_id"]
    if sender.get("email"):
        msg["List-Unsubscribe"] = f"<mailto:{sender['email']}?subject=stop>"
    msg.set_content(m["body"])
    body = {"raw": base64.urlsafe_b64encode(msg.as_bytes()).decode()}
    if m.get("thread"):
        body["threadId"] = m["thread"]
    return body


def _chewbacca_verdicts():
    """tools/verdicts.py, the kit's verdict log, loaded by path so no module
    here can shadow it; None when it isn't there. `chewbacca why --verdicts`
    reads what it writes."""
    try:
        import importlib.util
        mod = sys.modules.get("chewbacca_verdicts")
        if mod is None:
            here = os.path.dirname(os.path.realpath(__file__))
            spec = importlib.util.spec_from_file_location(
                "chewbacca_verdicts", os.path.join(here, ".", "verdicts.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            sys.modules["chewbacca_verdicts"] = mod
        return mod
    except Exception:
        return None


# One send row per batch: sent, held by CHEWBACCA_NO_SEND, or refused by a
# gate above (stale, changed, already sent).
def _logged_cmd_send(fn):
    v = _chewbacca_verdicts()
    if not v:
        return fn
    return v.logged_send("gtme send", fn, who=lambda a, k: "", about=lambda a, k: "%s batch %s" % (
        getattr(a[0], "client", ""), getattr(a[0], "batch", "")))


def cmd_send(a) -> int:
    plan = plan_of(a.client)
    d = cdir(a.client)
    path = d / "batches" / f"{re.sub(r'[^0-9a-f]', '', a.batch)}.json"
    batch = op.read_json(path, None)
    if not batch:
        raise Refused(f"There's no batch {a.batch}. Run `chewbacca gtme batch` and approve the id it prints.")
    frozen = json.dumps([{k: m[k] for k in ("to", "step", "subject", "body")} for m in batch["mails"]],
                        sort_keys=True)
    if hashlib.sha256(frozen.encode()).hexdigest()[:10] != batch["id"]:
        raise Refused("That batch changed after it was shown. Build it again so you approve what actually goes.")
    if op.utc_now() - op.parse_time(batch["made_at"]) > BATCH_TTL:
        raise Refused("That batch is over 2 hours old. Build a fresh one and approve that.")
    if batch.get("sent_at"):
        raise Refused(f"Batch {batch['id']} already went out at {batch['sent_at']}.")
    if os.environ.get("CHEWBACCA_NO_SEND") and not a.dry_run:
        raise Refused("Sending is turned off on this machine (CHEWBACCA_NO_SEND).")
    sender = plan.get("sender") or {}
    off = suppressed(a.client)
    gap = GAP_SECONDS if a.gap is None else (a.gap, a.gap)
    sent = 0
    # A send killed halfway (a closed lid, a stopped job) leaves no sent_at, so
    # the same id could run again. What sent.jsonl already holds never goes twice.
    done = {(r["email"], r["step"]) for r in jsonl(d / "sent.jsonl")}
    for n, m in enumerate(batch["mails"]):
        if m["to"] in off:
            print(f"Skipped {m['to']}: they asked not to be emailed after this batch was made.")
            continue
        if (m["to"], m["step"]) in done:
            print(f"Skipped {m['to']}: email {m['step']} already went to them.")
            continue
        # Two batches built the same morning each saw room for the full cap.
        if not a.dry_run and sent_today(a.client) >= today_cap(a.client):
            print(f"Stopped: today's limit of {today_cap(a.client)} is reached. The rest wait for tomorrow's batch.")
            break
        if a.dry_run:
            print(f"Would send email {m['step']} to {m['to']}: {m['subject']}")
            continue
        try:
            res = gws(["gmail", "users", "messages", "send", "--params", json.dumps({"userId": "me"}),
                       "--json", json.dumps(mime(m, sender))], batch.get("inbox") or "")
        except (RuntimeError, OSError, subprocess.SubprocessError, ValueError) as err:
            print(f"Stopped at {m['to']}: Gmail said {err}. {sent} went out before it; the rest did not.")
            break
        mid = ""
        try:
            meta = gws(["gmail", "users", "messages", "get", "--params", json.dumps(
                {"userId": "me", "id": res.get("id"), "format": "metadata", "metadataHeaders": ["Message-ID"]})],
                batch.get("inbox") or "")
            mid = next((h["value"] for h in (meta.get("payload") or {}).get("headers", [])
                        if h.get("name", "").lower() == "message-id"), "")
        except (RuntimeError, OSError, subprocess.SubprocessError, ValueError):
            pass
        append(d / "sent.jsonl", {"email": m["to"], "step": m["step"], "subject": m["subject"].removeprefix("Re: "),
                                  "lead": m["lead"], "gmail_id": res.get("id"),
                                  "thread": res.get("threadId") or m.get("thread"),
                                  "message_id": mid or m.get("message_id") or "", "batch": batch["id"],
                                  "at": op.stamp()})
        sent += 1
        print(f"Sent email {m['step']} to {m['to']}.")
        if n < len(batch["mails"]) - 1 and gap[1] > 0:
            time.sleep(random.uniform(*gap))
    if a.dry_run:
        print("Dry run: nothing was sent.")
        return 0
    batch["sent_at"] = op.stamp()
    op.write_json(path, batch)
    print(f"{sent} of {len(batch['mails'])} sent from your Gmail.")
    return 0


cmd_send = _logged_cmd_send(cmd_send)


# ── inbox: what came back ─────────────────────────────────────────────────


def plain_text(payload: dict) -> str:
    if (payload.get("mimeType") or "").startswith("text/plain") and (payload.get("body") or {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"] + "==").decode("utf-8", "replace")
    for part in payload.get("parts") or []:
        t = plain_text(part)
        if t:
            return t
    return ""


def reply_copy(client: str, plan: dict):
    """What a reply's next step may name for this client: its clients.json entry,
    else the plan's sender. Before 2026-10-13 a form reply here read "Fill out
    their form as Jonah", Zeutara's principal, on a Firm Foundation card."""
    try:
        import gtme_config
        entry = gtme_config.client(client) or {}
    except (ImportError, OSError, ValueError):
        entry = {}
    sender = (plan.get("sender") or {}).get("name") or ""
    return gtme_reply.copy_facts(entry or {"name": client}, sender)


def cmd_inbox(a) -> int:
    plan = plan_of(a.client)
    facts = reply_copy(a.client, plan)
    d = cdir(a.client)
    me = ((plan.get("sender") or {}).get("email") or "").lower()
    seen = {r["gmail_id"] for r in jsonl(d / "replies.jsonl")}
    threads = {}
    for r in jsonl(d / "sent.jsonl"):
        if r.get("thread"):
            threads.setdefault(r["thread"], r)
    needs, answered, auto = [], [], 0
    for tid, first in threads.items():
        try:
            th = gws(["gmail", "users", "threads", "get", "--params",
                      json.dumps({"userId": "me", "id": tid, "format": "full"})], a.inbox or "")
        except (RuntimeError, OSError, subprocess.SubprocessError, ValueError) as err:
            print(f"Couldn't read the thread with {first['email']}: {err}")
            continue
        for msg in th.get("messages") or []:
            heads = {h.get("name", "").lower(): h.get("value", "") for h in (msg.get("payload") or {}).get("headers", [])}
            frm = email.utils.parseaddr(heads.get("from", ""))[1].lower()
            if msg.get("id") in seen or not frm or frm == me or "SENT" in (msg.get("labelIds") or []):
                continue
            text = gtme_reply.clean_reply_text(plain_text(msg.get("payload") or {}) or msg.get("snippet") or "")
            v = gtme_reply.reply_intent(text, first["email"], me, first["lead"].get("company"), client=facts)
            row = {"email": first["email"], "from": frm, "gmail_id": msg.get("id"), "kind": v["kind"],
                   "label": v["label"], "next": v["nextStep"], "text": text[:2000], "at": op.stamp()}
            append(d / "replies.jsonl", row)
            if v["kind"] in ("unsubscribe", "bounce"):
                suppress(a.client, first["email"], v["label"])
                auto += 1
            elif v["kind"] in gtme_reply.AUTO_HANDLED:
                auto += 1
            elif v["kind"] == "interested" and auto_answer(a.client, plan, first, tid, heads, frm, text,
                                                          a.inbox or ""):
                answered.append(row)
            else:
                needs.append(row)
    if a.json:
        print(json.dumps({"needs_you": needs, "answered": answered, "handled": auto}, indent=1))
        return 0
    print(f"{auto} replies handled on their own (opt-outs and bounces are never emailed again; anyone who "
          f"replied gets no more follow-ups).")
    for r in answered:
        print(f"Answered on its own: {r['from']} said they're interested, and got your booking reply.")
    if not needs:
        print("Nobody's waiting on you.")
    for r in needs:
        print(f"\n{r['label']}: {r['from']} ({r['email']})\n  \"{gtme_reply.readable_reply(r['text'], 400)}\"\n"
              f"  Next: {r['next']}")
    return 0


# Guessed, never measured: Jev's yes probability must clear this before a
# reply goes out with nobody reading it. Togari's auto-send bar is the model;
# raise it if one wrong auto-answer ever reaches a church.
AUTOSEND_THRESHOLD = 0.85


def jev_says_yes(text: str):
    """Jev's probability that a reply is a plain yes to talking, or None."""
    sys.path.insert(0, str(op.ROOT / "bin" / "lib"))
    try:
        import jev  # noqa: E402
    except ImportError:
        return None
    answers = jev.ask({"reply": text[:2000]}, {"yes": {"type": "noul", "instructions":
        "This is a reply to a cold email offering to help with the sender's website and follow-up. "
        "Is it a plain yes to talking or hearing more, with no question we'd have to answer first, "
        "no request to stop, and no pointing us to someone else?"}}, decision="gtme-autosend")
    ans = (answers or {}).get("yes")
    return jev.probability(ans.get("noul")) if isinstance(ans, dict) else None


def auto_answer(client: str, plan: dict, first: dict, tid: str, heads: dict, frm: str, text: str,
                inbox: str) -> bool:
    """Send the person's own booking reply to an obvious yes, in the thread.

    Only an "interested" reply, only with a reply the person wrote and saved
    with `gtme autosend`, and only when every auto-send check passes: the
    reply re-reads as interested, and the answer carries no link, number,
    file or blank. Anything else waits for the person, as before.
    """
    answer = (plan.get("autosend") or {}).get("interested")
    if not answer or os.environ.get("CHEWBACCA_NO_SEND"):
        return False
    # Only the person we emailed gets an unread answer. Anyone else on the
    # thread (a cc, a forward, a look-alike From) waits for a human.
    if frm.lower() != (first.get("email") or "").lower():
        return False
    me = ((plan.get("sender") or {}).get("email") or "").lower()
    # The regex read found "interested"; Jev scores it. No score (no key, a
    # timeout, a bad answer) means a person reads it: a guess never sends.
    confidence = jev_says_yes(text)
    if confidence is None:
        return False
    check = gtme_reply.auto_sendable({"sentiment": "interested", "confidence": confidence,
                                      "threshold": plan.get("autosend_threshold", AUTOSEND_THRESHOLD),
                                      "draft": answer, "reply": text, "lead_id": first["email"],
                                      "campaign_id": client, "lead_email": first["email"], "sending_email": me,
                                      "client": reply_copy(client, plan)})
    if not check["ok"]:
        return False
    sender = plan.get("sender") or {}
    link = (plan.get("autosend") or {}).get("link") or ""
    m = {"to": frm, "subject": "Re: " + (first.get("subject") or ""),
         "body": "\n\n".join(x for x in (answer, link, sender.get("name") or "") if x),
         "message_id": heads.get("message-id", ""), "thread": tid}
    try:
        res = gws(["gmail", "users", "messages", "send", "--params", json.dumps({"userId": "me"}),
                   "--json", json.dumps(mime(m, sender))], inbox)
    except (RuntimeError, OSError, subprocess.SubprocessError, ValueError) as err:
        print(f"Couldn't answer {frm} on its own ({err}); it's waiting for you instead.")
        return False
    append(cdir(client) / "sent.jsonl", {"email": first["email"], "step": "auto-reply",
                                         "subject": first.get("subject"), "lead": first.get("lead"),
                                         "gmail_id": res.get("id"), "thread": res.get("threadId") or tid,
                                         "to": frm, "at": op.stamp()})
    return True


def cmd_autosend(a) -> int:
    plan = plan_of(a.client)
    if a.off:
        plan.pop("autosend", None)
        op.write_json(cdir(a.client) / "plan.json", plan)
        print("Off. Every interested reply waits for you again.")
        return 0
    if not a.interested:
        raise Refused('Give the reply to send when someone says yes: --interested "...", or --off.')
    text = gtme_reply.strip_em_dashes(a.interested.strip())
    # Only the draft checks are read off this probe, so the score is moot.
    probe = gtme_reply.auto_sendable({"sentiment": "interested", "confidence": 1.0, "threshold": 1.0,  # exact, not a model score
                                      "draft": text, "reply": "Yes, I'm interested. Let's talk.",
                                      "lead_id": "probe", "campaign_id": a.client})
    bad = [r for r in probe["reasons"] if r.startswith("draft")]
    if bad:
        raise Refused("That reply can't go out unread: " + "; ".join(bad) + ". Keep it to a short ask for a time.")
    plan["autosend"] = {"interested": text}
    if a.link:
        # The one link an unread reply may carry: the person's own booking
        # page, saved by them here. The answer text itself still can't hold one.
        u = urllib.parse.urlparse(a.link.strip())
        if u.scheme != "https" or not u.hostname:
            raise Refused("The booking link has to be a full https:// address, like https://calendly.com/you/30min.")
        plan["autosend"]["link"] = a.link.strip()
    op.write_json(cdir(a.client) / "plan.json", plan)
    print("On. When someone replies that they're interested, this goes back in their thread, signed with your "
          "name, and `inbox` lists it. Every other reply still waits for you.")
    return 0


def cmd_share(a) -> int:
    """Keep this client's ledger in a shared folder (a git repo both people pull)."""
    target = Path(os.path.expanduser(a.dir)).resolve()
    old = cdir(a.client)
    cfg = op.read_json(op.config_path(), {"clients": []})
    if not isinstance(cfg, dict):
        cfg = {"clients": []}
    entry = next((c for c in cfg.setdefault("clients", []) if isinstance(c, dict)
                  and op.slug(c.get("name", "")) == op.slug(a.client)), None)
    if entry is None:
        entry = {"name": a.client}
        cfg["clients"].append(entry)
    target.mkdir(parents=True, exist_ok=True)
    moved = 0
    if old.resolve() != target and old.is_dir() and not any(target.iterdir()):
        for f in old.iterdir():
            f.rename(target / f.name)
            moved += 1
    entry["state_dir"] = str(target)
    op.write_json(op.config_path(), cfg)
    repo = git_root(target)
    print(f"{a.client} now keeps its ledger in {target}" + (f" ({moved} files moved there)" if moved else "") + ".")
    if repo:
        attrs = repo / ".gitattributes"
        line = "*.jsonl merge=union"
        have = attrs.read_text() if attrs.exists() else ""
        if line not in have.splitlines():
            attrs.write_text(have + ("" if not have or have.endswith("\n") else "\n") + line + "\n")
        print(f"It's inside the git repo {repo}, so every command pulls first and pushes what it wrote.")
        rules = repo / "DECISIONS.json"
        if not rules.exists():
            op.write_json(rules, {"client": a.client, "aliases": [], "rulings": [],
                                  "_about": "Standing outbound rulings, with who said each and when. "
                                            "chewbacca gtme reads them before it recommends or writes anything."})
            print(f"Started {rules.name} at the repo root for this team's standing rules.")
    return 0


def cmd_copy(a) -> int:
    """Set the sequence from a JSON file: [{step, day, subject, body}, ...]."""
    plan = plan_of(a.client)
    seq = op.read_json(Path(a.file), None)
    if not isinstance(seq, list) or not seq:
        raise Refused("The file needs a list of steps: [{\"step\": 1, \"day\": 0, \"subject\": \"...\", \"body\": \"...\"}].")
    bad, last_day = [], -1
    for n, c in enumerate(seq, 1):
        if not isinstance(c, dict) or c.get("step") != n or not isinstance(c.get("day"), int):
            bad.append(f"step {n} needs step: {n} and a whole-number day")
            continue
        if c["day"] <= last_day:
            bad.append(f"step {n} has to come after step {n - 1}")
        last_day = c["day"]
        body = str(c.get("body") or "")
        if DASH.search(body + str(c.get("subject") or "")):
            bad.append(f"step {n} has a long dash")
        if len(body.split()) > MAX_WORDS:
            bad.append(f"step {n} is {len(body.split())} words, over {MAX_WORDS}")
        if n == 1 and not c.get("subject"):
            bad.append("step 1 needs a subject")
        if n == 1 and c.get("subject"):
            bad += sagar_review(plan, c)[0]
    if bad:
        raise Refused("Not saved: " + "; ".join(bad) + ".")
    plan["copy"] = [{k: c.get(k, "") for k in ("step", "day", "subject", "body")} for c in seq]
    if a.require_line:
        plan["require_line"] = True
    op.write_json(cdir(a.client) / "plan.json", plan)
    print(f"Saved a {len(seq)}-step sequence. `chewbacca gtme batch` shows it filled in for real leads before "
          "anything goes.")
    return 0


# ── a shared ledger: pull before, push after ──────────────────────────────


def git_root(path: Path):
    try:
        out = subprocess.run(["git", "-C", str(path), "rev-parse", "--show-toplevel"], capture_output=True,
                             text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return Path(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None


def _git(repo: Path, *args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=60)


def sync_pull(client: str) -> None:
    d = cdir(client)
    repo = git_root(d) if d.exists() else None
    if not repo or not _git(repo, "remote").stdout.strip():
        return
    r = _git(repo, "pull", "--rebase", "--autostash", "-q")
    if r.returncode != 0:
        print(f"Couldn't pull the shared ledger ({r.stderr.strip()[:200]}); working from what's on this Mac.")


def sync_push(client: str, what: str) -> None:
    d = cdir(client)
    repo = git_root(d) if d.exists() else None
    if not repo:
        return
    rel = str(d.resolve().relative_to(repo.resolve()))
    paths = [rel]
    if (repo / ".gitattributes").exists():
        paths.append(".gitattributes")
    _git(repo, "add", "--", *paths)
    if not _git(repo, "diff", "--cached", "--name-only", "--", *paths).stdout.strip():
        return
    c = _git(repo, "commit", "-q", "-m", f"chore: {op.slug(client)} ledger, {what}", "--", *paths)
    if c.returncode != 0:
        print(f"Couldn't commit the shared ledger: {c.stderr.strip()[:200]}")
        return
    if not _git(repo, "remote").stdout.strip():
        return
    for _ in range(3):
        if _git(repo, "push", "-q").returncode == 0:
            return
        _git(repo, "pull", "--rebase", "-q")
    print("Committed the ledger but couldn't push it; the next command tries again.")


def week_numbers(client: str, days: int = 7) -> dict:
    """The week's sends, replies and holds, counted from the ledger itself."""
    d = cdir(client)
    since = op.utc_now() - timedelta(days=days)
    recent = lambda rows: [r for r in rows if r.get("at") and op.parse_time(r["at"]) >= since]  # noqa: E731
    sent = recent(jsonl(d / "sent.jsonl"))
    replies = recent(jsonl(d / "replies.jsonl"))
    checks = recent(jsonl(d / "jev.jsonl"))
    kinds: dict[str, int] = {}
    for r in replies:
        kinds[r.get("label") or r.get("kind") or "other"] = kinds.get(r.get("label") or r.get("kind") or "other", 0) + 1
    firsts = [r for r in sent if r.get("step") == 1]
    return {"first": len(firsts), "followups": sum(1 for r in sent if isinstance(r.get("step"), int) and r["step"] > 1),
            "auto": sum(1 for r in sent if r.get("step") == "auto-reply"),
            "accounts": len({(r.get("email") or "").rsplit("@", 1)[-1] for r in firsts}),
            "replies": len(replies), "kinds": kinds,
            "people": sorted({r.get("from") or "" for r in replies if r.get("kind") in ("interested", "question")}),
            "held": sum(1 for r in checks if r.get("held")), "checked": len(checks),
            "suppressed": len(suppressed(client))}


def cmd_week(a) -> int:
    """This week's numbers as a markdown file in ~/Downloads, for Friday."""
    n = week_numbers(a.client)
    day = op.utc_now().date().isoformat()
    rate = f"{n['replies'] / n['first']:.0%}" if n["first"] else "no sends yet"
    lines = [f"# {a.client}, the week ending {day}", "",
             f"- First emails sent: {n['first']}, to {n['accounts']} organizations",
             f"- Follow-ups sent: {n['followups']}", f"- Replies: {n['replies']} ({rate} of first emails)"]
    lines += [f"  - {k}: {v}" for k, v in sorted(n["kinds"].items(), key=lambda kv: -kv[1])]
    lines += [f"- Answered on their own with the booking reply: {n['auto']}",
              f"- Held by the checks before sending: {n['held']} of {n['checked']}",
              f"- Never emailing again: {n['suppressed']}"]
    if n["people"]:
        lines += ["", "## Interested or asked something", ""] + [f"- {p}" for p in n["people"]]
    out = Path(a.out or Path.home() / "Downloads") / f"{a.client} week {day}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nSaved: {out}")
    return 0


def cmd_reply(a) -> int:
    d = cdir(a.client)
    row = next((r for r in reversed(jsonl(d / "replies.jsonl")) if r["from"] == a.to.lower()), None)
    if not row:
        raise Refused(f"No reply from {a.to} on file. Run `chewbacca gtme inbox` first.")
    sys.path.insert(0, str(op.ROOT / "mac" / "lib"))
    import gmail  # noqa: E402
    res = gmail.draft(row["gmail_id"], a.inbox or None, row["from"], gtme_reply.strip_em_dashes(a.text))
    if not res.get("ok"):
        raise Refused(f"Couldn't save the draft: {res.get('error')}")
    # Clears the reply from the needs-you surface (bin/lib/ingest_gtme.py).
    append(d / "drafted.jsonl", {"to": row["from"], "gmail_id": row["gmail_id"], "draft": res.get("draft_id"),
                                 "at": op.stamp()})
    print(f"Saved as a draft in your Gmail, in the thread with {row['from']}. Nothing was sent; open Gmail to "
          f"read it and press send.")
    return 0


def cmd_sender(a) -> int:
    plan = plan_of(a.client)
    s = plan.get("sender") or {}
    for k in ("name", "address", "email", "inbox", "company"):
        v = getattr(a, k)
        if v:
            s[k] = v.strip()
    plan["sender"] = s
    op.write_json(cdir(a.client) / "plan.json", plan)
    print(f"Saved. Every email signs as {s.get('name') or '[name missing]'}, "
          f"{s.get('address') or '[mailing address missing]'}.")
    return 0


def cmd_today(a) -> int:
    print("Replies first:")
    cmd_inbox(a)
    print("\nToday's batch:")
    return cmd_batch(a)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca gtme", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sender", help="the name and mailing address every email signs with")
    p.add_argument("--client", required=True)
    for k in ("name", "address", "email", "inbox", "company"):
        p.add_argument(f"--{k}")
    p = sub.add_parser("find", help="each company's email and a fact, from its own website")
    p.add_argument("--client", required=True)
    p.add_argument("--limit", type=int, default=200)
    p.add_argument("--paid", action="store_true", help="look up missing emails through treg, billed to this customer")
    p.add_argument("--spend", type=float, help="dollars approved for paid lookups (without it: price one only)")
    p = sub.add_parser("verify", help="check each lead's email through treg before it goes out (optional)")
    p.add_argument("--client", required=True)
    p.add_argument("--spend", type=float, help="dollars approved for checks (without it: price one only)")
    p = sub.add_parser("package", help="what this customer's subscription includes, and what it costs us")
    p.add_argument("--client", required=True)
    p.add_argument("--shape", choices=sorted(SHAPES), help="retainer, one_time_list or self_serve")
    p.add_argument("--data-budget", dest="data_budget_usd", type=float)
    p.add_argument("--mailboxes", type=int)
    p.add_argument("--mailbox-cost", dest="mailbox_usd", type=float)
    p.add_argument("--domains", type=int)
    p.add_argument("--domain-cost", dest="domain_usd_year", type=float, help="per domain per year")
    p.add_argument("--price", dest="price_usd", type=float, help="what the customer pays a month")
    p.add_argument("--motion", help="who they sell to, in order: customers,channel_partners,investors")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("costs", help="this month's cost for one customer")
    p.add_argument("--client", required=True)
    p.add_argument("--json", action="store_true")
    for name, helptext in (("batch", "today's emails, frozen, for your ok"), ("today", "replies, then the batch")):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("--client", required=True)
        p.add_argument("--lines", help="JSON of personal first lines with their source links")
        p.add_argument("--inbox", help="which connected Gmail (chewbacca email)")
        p.add_argument("--weekend", action="store_true")
        p.add_argument("--json", action="store_true")
    p = sub.add_parser("send", help="send a batch you approved")
    p.add_argument("--client", required=True)
    p.add_argument("--batch", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--gap", type=float, help="seconds between emails (default 45 to 90, random)")
    p = sub.add_parser("inbox", help="sort the replies")
    p.add_argument("--client", required=True)
    p.add_argument("--inbox")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("reply", help="save a reply as a Gmail draft, never send it")
    p.add_argument("--client", required=True)
    p.add_argument("--to", required=True)
    p.add_argument("--text", required=True)
    p.add_argument("--inbox")
    p = sub.add_parser("autosend", help="the reply that goes back on its own when someone says yes")
    p.add_argument("--client", required=True)
    p.add_argument("--interested", help="a short ask for a time, no links or numbers")
    p.add_argument("--link", help="your own booking page (Calendly, Cal.com), sent under the answer")
    p.add_argument("--off", action="store_true")
    p = sub.add_parser("week", help="this week's sends, replies and holds as markdown in ~/Downloads")
    p.add_argument("--client", required=True)
    p.add_argument("--out")
    p = sub.add_parser("copy", help="set the email sequence from a JSON file")
    p.add_argument("--client", required=True)
    p.add_argument("--file", required=True)
    p.add_argument("--require-line", action="store_true", help="hold any first email without its personal line")
    p = sub.add_parser("share", help="keep this client's ledger in a shared folder, like a team repo")
    p.add_argument("--client", required=True)
    p.add_argument("--dir", required=True)
    a = ap.parse_args(argv)
    shared = a.cmd not in ("share", "package", "costs", "week")
    try:
        if shared:
            sync_pull(a.client)
        code = {"sender": cmd_sender, "find": cmd_find, "verify": cmd_verify, "batch": cmd_batch, "send": cmd_send,
                "inbox": cmd_inbox, "reply": cmd_reply, "today": cmd_today, "package": cmd_package,
                "costs": cmd_costs, "autosend": cmd_autosend, "share": cmd_share,
                "copy": cmd_copy, "week": cmd_week}[a.cmd](a)
    except Refused as err:
        print(str(err), file=sys.stderr)
        return 2
    if shared and not getattr(a, "dry_run", False):
        sync_push(a.client, a.cmd)
    return code


if __name__ == "__main__":
    sys.exit(main())
