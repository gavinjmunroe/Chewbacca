"""Follow past buyers: a brand person who already paid the client's creators is warm wherever they go.

The seed file lists each buyer: who they are, the brands and domains they paid from, the history in
one line, and their current employer with its source. For every seed whose current domain is not
one they paid from, this adds (or reuses) a row for the new brand, runs brand_buyer's people search
there to see who else is on the team, gets the seed's own email (Findymail, then ZeroBounce), and
writes Status "Warm: past buyer moved" with a Why line naming the person and the history.

A seed still at a brand they paid from is recorded as stayed and costs nothing.

Nothing here loops. New moves come from a Clay JobChange signal on the seeds, which runs on Clay's
side; an exported event list goes in with --events, or a seed's "current" is edited by hand. The
client file (brand_buyer's format) names the table; its "buyers" key names the seed file, relative
to the client file. Dry run is the default.

  python3 tools/creator_gtm/follow_buyers.py --client <client.json> [--only NAME] [--events F] [--live]
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import brand_buyer as L  # noqa: E402

# TODO: call Clay through tools/creator_gtm/provider.py (the shared provider interface, in
# progress on wt-gtm-provider, session local_e6857244) once it lands, instead of brand_buyer.clay.

WARM = "Warm: past buyer moved"


def load_buyers(path):
    with open(path) as f:
        return json.load(f)


def save_buyers(path, buyers):
    with open(path, "w") as f:
        json.dump(buyers, f, indent=1)
        f.write("\n")


def moved(seed):
    """True when the seed's current domain is none of the domains they paid creators from."""
    current = (seed.get("current") or {}).get("domain", "").lower()
    paid = {d.lower() for d in (seed.get("paid_from") or {}).get("domains", [])}
    return bool(current) and current not in paid


def apply_events(buyers, events):
    """Fold JobChange events ({name, linkedin, employer, domain, title, since, source}) into seeds.

    Matched on LinkedIn URL first, then on name. Returns the names whose employer changed.
    """
    changed = []
    for ev in events:
        url = (ev.get("linkedin") or "").rstrip("/").lower()
        seed = next((s for s in buyers if url and (s.get("linkedin") or "").rstrip("/").lower() == url), None)
        seed = seed or next((s for s in buyers if L._norm(s["name"]) == L._norm(ev.get("name"))), None)
        if not seed or not ev.get("domain"):
            continue
        if (seed.get("current") or {}).get("domain", "").lower() != ev["domain"].lower():
            changed.append(seed["name"])
        seed["current"] = {k: ev.get(k, "") for k in ("employer", "domain", "title", "since", "source")}
    return changed


def prefer_seed(rank, seed_name):
    """Wrap Jev's ranking so the seed goes first when the search found them.

    The seed already paid the client's creators, which is stronger evidence of owning the budget
    than any title score, so Jev's gate does not get to stop on them.
    """
    def ranked(people):
        order, scores, gate = rank(people)
        hit = next((i for i, p in enumerate(people) if L._norm(p.get("name")) == L._norm(seed_name)), None)
        if order is None or hit is None:
            return order, scores, gate
        scores = list(scores)
        scores[hit] = max(scores[hit], L.MIN_PICK_FIT)
        return [hit] + [i for i in order if i != hit], scores, True
    return ranked


def why_line(seed, chain_result, seed_in_search, email=None, problem=None):
    cur = seed["current"]
    since = f" since {cur['since']}" if cur.get("since") else ""
    found = (f"Clay's people search at {cur['domain']} lists {seed['name']} there" if seed_in_search
             else f"Clay's people search at {cur['domain']} did not return {seed['name']}; "
                  f"current role is from {cur['source']}")
    line = (f"{seed['name']} {seed['history']} (paid from {', '.join(seed['paid_from']['brands'])}), "
            f"now {cur['title']} at {cur['employer']}{since}. {found}.")
    # Archer, 2026-10-16: Findymail's LinkedIn lookup gave the seed's old address at the parent
    # they left and ZeroBounce called it valid. A live inbox at the brand they left is not a way in.
    if problem and problem.startswith("off-domain"):
        line += (f" Findymail returned {email}, an address at the brand {seed['name']} left (ZeroBounce "
                 f"{chain_result.get('seed_verdict') or 'checked'}), so no verified {cur['domain']} email yet.")
    elif problem:
        line += f" No verified {cur['domain']} email: {problem}."
    team = [t for t in (chain_result.get("team") or []) if L._norm(t[0]) != L._norm(seed["name"])]
    if team:
        door = chain_result.get("door")
        line += " Also on the team: " + ", ".join(f"{n} ({t or 'no title'})" for n, t in team) + "."
        if door:
            line += f" Verified email on that team: {door[0]}, {door[1]}."
    return line


def follow(seed, live, cols):
    cur = seed["current"]
    brand = cur["employer"]
    log = {"brand": brand, "domain": cur["domain"], "live": live, "seed": seed["name"],
           "lane": "follow past buyers", "steps": [], "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    t0 = time.time()
    before = L.prov().balance()
    row = L.load_rows().get(L._norm(brand))
    if row:
        log["steps"].append({"step": "reuse row", "row": row})
    else:
        opened = L.prov().open_account(brand, cur["domain"], L.CREATOR, live)
        if not live:
            print(json.dumps({"dry_run": opened["receipt"], "seed": seed["name"], "brand": brand,
                              "next": ["people search at " + cur["domain"], "seed first if found",
                                       "seed email + verify", "Status " + WARM]}, indent=1))
            return log
        row = opened["ref"]
        L.save_row(brand, row)
        log["steps"].append({"step": "add row", "row": row})
    if not live:
        print(json.dumps({"dry_run": "reuse " + row, "seed": seed["name"]}, indent=1))
        return log

    # The chain's own Status/Why/Contact are overwritten below; its log goes into this one.
    rank, emit = L.jev_rank, L.emit
    L.jev_rank, L.emit = prefer_seed(rank, seed["name"]), (lambda _log: None)
    try:
        chain = L.finish(cur["domain"], row, {"brand": brand, "domain": cur["domain"], "live": True,
                                              "steps": log["steps"], "lane": log["lane"]}, t0, before, cols)
    finally:
        L.jev_rank, L.emit = rank, emit
    result = dict(chain.get("result") or {})
    result["team"] = [tuple(t) for t in chain.get("team") or []]
    seed_in_search = any(L._norm(n) == L._norm(seed["name"]) for n, _ in result["team"])
    if result.get("email") and not L.email_problem(result["email"], result.get("zerobounce"), [cur["domain"]]):
        result["door"] = (result.get("person"), result["email"])

    email, verdict = result.get("email"), result.get("zerobounce")
    if L._norm(result.get("person")) != L._norm(seed["name"]):
        if not seed.get("linkedin"):
            email, verdict = None, None
            log["steps"].append({"step": "seed email", "skipped": "no LinkedIn URL on file"})
        else:
            _, email, verdict = L.email_for(row, {"name": seed["name"], "url": seed["linkedin"]}, log)
    problem = L.email_problem(email, verdict, [cur["domain"]])
    if not problem:
        result.pop("door", None)  # the seed is the door
    result["seed_verdict"] = verdict
    why = why_line(seed, result, seed_in_search, email, problem)
    status = WARM if not problem else f"{WARM}; needs work: {problem}"
    costs = (chain.get("costs") or []) + L.prov().drain_costs()
    L.save_record(brand, cur["domain"], {"person": seed["name"], "title": cur["title"], "email": email,
                                         "zerobounce": verdict, "profile": seed.get("linkedin"),
                                         "domain": cur["domain"], "why": why, "status": status, "row": row,
                                         "team": result["team"]}, costs, lane="follow past buyers")
    L.show(row, {cols.get("person"): seed["name"], cols.get("title"): cur["title"], cols.get("why"): why,
                 cols.get("status"): status, cols.get("contact"): L.contact_line(seed["name"], cur["title"],
                                                                                  None if problem else email, why)})
    seed["current"].update({"email": email, "zerobounce": verdict, "email_problem": problem,
                            "door": result.get("door"), "row": row,
                            "checked": time.strftime("%Y-%m-%d"), "in_clay_search": seed_in_search})
    log["result"] = {"person": seed["name"], "email": email, "zerobounce": verdict, "problem": problem,
                     "row": row, "status": status, "why": why, "team": result["team"],
                     "chain_pick": result.get("person"), "door": result.get("door")}
    after = L.prov().balance()
    log["costs"], log["cost"] = costs, L.gtm_provider.cost_total(costs)
    log["credits_observed"] = round(before - after, 2) if before is not None and after is not None else None
    log["seconds"] = round(time.time() - t0)
    L.emit(log)
    return log


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", default=L.CLIENT_FILE, help="brand_buyer client.json")
    ap.add_argument("--buyers", help="seed file (default: the client file's 'buyers', relative to it)")
    ap.add_argument("--events", help="JSON list of JobChange events to fold into the seeds first")
    ap.add_argument("--only", help="one seed by name")
    ap.add_argument("--live", action="store_true")
    a = ap.parse_args(argv)
    cfg = L.load_client(a.client)
    if cfg:
        L.configure(cfg)
    path = a.buyers or (os.path.join(os.path.dirname(cfg["_path"]), cfg["buyers"])
                        if cfg and cfg.get("buyers") else None)
    if not path:
        ap.error("no seed file: pass --buyers or add \"buyers\": \"buyers.json\" to the client file")
    buyers = load_buyers(path)
    if a.events:
        with open(a.events) as f:
            print(json.dumps({"moved_by_events": apply_events(buyers, json.load(f))}), file=sys.stderr)
    cols = L.ensure_pick_columns(a.live) if a.live else {}
    out = []
    for seed in buyers:
        if a.only and L._norm(seed["name"]) != L._norm(a.only):
            continue
        if not moved(seed):
            out.append({"seed": seed["name"], "stayed": seed["current"]["employer"]})
            continue
        out.append(follow(seed, a.live, cols))
    if a.live or a.events:
        save_buyers(path, buyers)
    print(json.dumps([o if "stayed" in o else {"seed": o.get("seed"), **(o.get("result") or {})}
                      for o in out], indent=1))
    return out


if __name__ == "__main__":
    main()
