"""The data steps of the creator GTM tools, behind one contract, so the vendor under them can change.

Caleb, 2026-10-16: "removing clay from the equation is def the play after this phase". Gavin's
ruling holds until Sabo pays: Clay stays the live provider. This file makes the later swap a new
adapter plus one line in the client file, with pick, ranking, status, attribution and spend logic
untouched.

The contract, every method on Provider:

  people_search(ref, domain, filters)  people at a company: [{name, title, headline, summary, url}]
  find_email(ref, person)              one work email for that person, or None
  verify_email(ref, email)             "valid", "invalid", "catch-all", "unknown" or None
  person_posts(person, since)          a person's recent posts: [{date, url, text}]
  company_signals(account, fetch)      dated, sourced company events: [{date, title, where, url}]

`ref` is what open_account() returned: a Clay row id for Clay, any stable key for others. Each
paid call lands in self.costs as {op, provider, credits, cents}; credits is Clay's unit, cents is
money, and either is None when it wasn't measured. A provider with a table (Clay) also writes the
view; one without has has_table False and the local record file is the only copy.

The client file picks the adapter: "provider": "clay" (the default) or {"name": "treg", ...}.
"""
import datetime as dt
import json
import os
import time
import urllib.request


class NotWired(RuntimeError):
    """A provider step that has no implementation yet. Raised, never silently empty: an empty list
    would read as "nobody works there" and send the chain into its blocked-search loop."""


class Provider:
    name = "base"
    label = "base"
    has_table = False

    def __init__(self, cfg=None):
        self.cfg = cfg or {}
        opts = self.cfg.get("provider") if isinstance(self.cfg.get("provider"), dict) else {}
        # Cents per Clay credit depends on the client's plan and is not on file for anyone yet,
        # so cents stay None until a client file states it.
        self.cents_per_credit = opts.get("cents_per_credit")
        self.costs = []

    # ── the five data steps ──────────────────────────────────────────────────
    def people_search(self, ref, domain, filters=None):
        raise NotWired(self._unwired("people_search"))

    def find_email(self, ref, person):
        raise NotWired(self._unwired("find_email"))

    def verify_email(self, ref, email):
        raise NotWired(self._unwired("verify_email"))

    def person_posts(self, person, since=None):
        raise NotWired(self._unwired("person_posts"))

    def company_signals(self, account, fetch=None):
        """Hiring on the company's public job board. Free, no vendor, so every adapter shares it."""
        jobs = []
        for board, slug in (account.get("ats") or {}).items():
            jobs += [dict(j, board=board) for j in public_ats_jobs(board, slug, fetch or fetch_json)]
        self.record("company_signals", credits=0.0, cents=0.0, source="public ATS boards")
        return jobs

    # ── accounts, the view, cost ─────────────────────────────────────────────
    def open_account(self, brand, domain, creator, live):
        """Returns {"ref", "receipt"}. Off Clay there is no row to make, so the key is the brand."""
        return {"ref": f"{self.name}:{domain}", "receipt": {"ok": True, "provider": self.name}}

    def balance(self):
        return None

    def show(self, ref, cells):
        """Write cells to the provider's table view. No table, nothing to write."""

    def record(self, op, credits=None, cents=None, **extra):
        if cents is None and credits is not None and self.cents_per_credit is not None:
            cents = round(credits * self.cents_per_credit, 2)
        entry = {"op": op, "provider": self.name, "credits": credits, "cents": cents, **extra}
        self.costs.append(entry)
        return entry

    def drain_costs(self):
        out, self.costs = self.costs, []
        return out

    def _unwired(self, op):
        return f"{self.name} provider: {op} is not wired yet"


def cost_total(costs):
    """Sum credits and cents; a total is None when any entry in it was unmeasured."""
    total = {}
    for unit in ("credits", "cents"):
        vals = [c.get(unit) for c in costs]
        total[unit] = None if any(v is None for v in vals) else round(sum(vals), 2)
    return total


# ── Clay, the live adapter ───────────────────────────────────────────────────

class ClayProvider(Provider):
    """Today's `chewbacca clay` calls, unchanged, behind the contract.

    Clay computes on a table row: the search, Findymail and ZeroBounce are cells on the brand's
    row, so `ref` is the row id and the row is also the client's view. The calls go through the
    chain module's own clay() and run_and_wait(), looked up at call time, so the tests' fake
    Clay and the write gate in `chewbacca clay` both still apply.
    """
    name = "clay"
    label = "Clay"
    has_table = True

    def __init__(self, chain, cfg=None):
        super().__init__(cfg)
        self.chain = chain
        self.row_domain = {}
        self.last_meta = {}

    def _paid(self, op, cell, row):
        before = self.balance()
        state, size = self.chain.run_and_wait(cell, row)
        after = self.balance()
        # Read off the workspace balance around one cell run, so another tab spending in the
        # same seconds lands here too. Good enough to compare providers, not to bill.
        credits = round(before - after, 2) if before is not None and after is not None else None
        self.record(op, credits=credits, source="balance delta")
        return state, size

    def people_search(self, ref, domain, filters=None):
        # The search column reads the row's domain cell; filters live on the column (--setup).
        if self.row_domain.get(ref, domain) != domain:
            self.chain.clay("update-rows", True, ws=self.chain.WS, table=self.chain.TABLE,
                            records=json.dumps([{"id": ref, "cells": {self.chain.F_DOMAIN: domain}}]))
        self.row_domain[ref] = domain
        state, size = self._paid("people_search", self.chain.F_PEOPLE, ref)
        self.last_meta = {"row_chars": size}
        return (state.get("fields") or {}).get("people", [])

    def find_email(self, ref, person):
        self.chain.clay("update-rows", True, ws=self.chain.WS, table=self.chain.TABLE,
                        records=json.dumps([{"id": ref, "cells": {self.chain.F_PROFILE: person.get("url")}}]))
        return (self._paid("find_email", self.chain.F_FINDYMAIL, ref)[0].get("fields") or {}).get("email")

    def verify_email(self, ref, email):
        # ZeroBounce's cell reads the Findymail cell on the same row, so `email` is that one.
        return (self._paid("verify_email", self.chain.F_VERIFY, ref)[0].get("fields") or {}).get("status")

    def person_posts(self, person, since=None):
        raise NotWired("clay provider: person_posts has no column on the client table yet")

    def open_account(self, brand, domain, creator, live):
        c = self.chain
        added = c.clay("add-rows", live, ws=c.WS, table=c.TABLE, records=json.dumps(
            [{c.F_BRAND: brand, c.F_DOMAIN: domain, c.F_CREATOR: creator}]))
        if not live:
            return {"ref": None, "receipt": added}
        # listRowsAfter stopped after 10 of 397 rows on 2026-10-16, so the id comes from the add.
        ids = sorted(set(c.re.findall(r'"(r_[0-9A-Za-z]{15,})"', json.dumps(added.get("data")))))
        if len(ids) != 1:
            raise c.ClayFailed(f"added, but could not find the new row: {json.dumps(added)[:600]}")
        self.row_domain[ids[0]] = domain
        return {"ref": ids[0], "receipt": added}

    def balance(self):
        return self.chain.clay("credits", True).get("data", {}).get("balance")

    def show(self, ref, cells):
        if ref and cells:
            self.chain.clay("update-rows", True, ws=self.chain.WS, table=self.chain.TABLE,
                            records=json.dumps([{"id": ref, "cells": cells}]))


# ── treg, the next adapter, not wired ────────────────────────────────────────

class TregProvider(Provider):
    """treg.to: one token, routed provider endpoints, metered per call in cents.

    Not wired. The routed ids are treg.people.search, treg.people.email.find and
    treg.people.email.verify; tools/treg_client.py already calls the last two for gtme. Wiring
    this means mapping their responses onto the shapes in this file's docstring and recording
    X-Treg-Cost-Micro as cents. company_signals is the shared public job-board read.
    """
    name = "treg"
    label = "treg"

    def _unwired(self, op):
        return (f"treg provider: {op} is not wired yet. Set \"provider\": \"clay\" in the client file, "
                "or wire it in tools/creator_gtm/provider.py (TregProvider) on tools/treg_client.py")


PROVIDERS = {"clay": ClayProvider, "treg": TregProvider}


def for_client(cfg, chain=None):
    """The adapter the client file names, Clay when it names none."""
    spec = (cfg or {}).get("provider") or "clay"
    name = spec.get("name", "clay") if isinstance(spec, dict) else str(spec)
    cls = PROVIDERS.get(name)
    if cls is None:
        raise NotWired(f"unknown provider {name!r}; known: {sorted(PROVIDERS)}")
    return cls(chain, cfg) if cls is ClayProvider else cls(cfg)


# ── public job boards ────────────────────────────────────────────────────────

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "chewbacca-spend-now/1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def public_ats_jobs(board, slug, fetch=fetch_json):
    """Dated jobs from a public ATS board. Checked live 2026-10-16: Greenhouse gymshark
    (first_published), Ashby strava (publishedAt), Workable celsius (published_on). Lever's
    shape is from its public docs and hasn't been seen live."""
    if board == "greenhouse":
        data = fetch(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
        return [{"date": j.get("first_published") or j.get("updated_at"), "title": j["title"],
                 "where": (j.get("location") or {}).get("name"), "url": j["absolute_url"]} for j in data["jobs"]]
    if board == "ashby":
        data = fetch(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        return [{"date": j.get("publishedAt"), "title": j["title"], "where": j.get("location"),
                 "url": j["jobUrl"]} for j in data["jobs"]]
    if board == "workable":
        data = fetch(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
        return [{"date": j.get("published_on"), "title": j["title"], "where": j.get("city"),
                 "url": j["url"]} for j in data["jobs"]]
    if board == "lever":
        data = fetch(f"https://api.lever.co/v0/postings/{slug}?mode=json")
        return [{"date": dt.datetime.fromtimestamp(j["createdAt"] / 1000, dt.timezone.utc).date().isoformat(),
                 "title": j["text"], "where": (j.get("categories") or {}).get("location"),
                 "url": j["hostedUrl"]} for j in data]
    raise ValueError(f"unknown ATS board {board}")


# ── the canonical record ─────────────────────────────────────────────────────

def load_records(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"brands": {}}


def save_record(path, key, record):
    """Merge one brand's record into the client's record file and write it whole.

    This file is the source of truth for who the contact is and why; the Clay table is a view
    written from it, so swapping providers keeps every pick made so far.
    """
    data = load_records(path)
    old = data.setdefault("brands", {}).get(key) or {}
    data["brands"][key] = {**old, **record, "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    return data["brands"][key]
