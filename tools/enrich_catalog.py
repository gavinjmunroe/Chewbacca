"""Every Clay enrichment this workspace can run, and which one to use for a job.

Caleb, 2026-10-17: "I need chewbs to have a perfect memory of all the diff clay tools you are
yet to use a built in waterfall and always weigh the best option systematically". The Sabo
chain had run Findymail alone on every brand while Clay's Work Email waterfall (10 providers,
~1.1 credits a row in the Tools panel) sat one click away. This file keeps the whole catalog
on disk; enrich_math turns counted outcomes into the probability each option is best, and says
which test to run when the data can't decide yet.

    enrich_catalog.py build DUMP.json       fold `clay workflows actions list` output into the catalog
    enrich_catalog.py learn RUNS.jsonl      count usable/tried per email provider from brand_buyer runs
    enrich_catalog.py record NAME --tried N --usable K    add a head-to-head test's counts
    enrich_catalog.py pick "work email"     rank every option for a capability
    enrich_catalog.py show                  what's on file and how old it is

Named without "clay" so a plain `pytest tests/test_enrich_catalog.py` or a run of this file
isn't read by launch-guard as a command that reaches Clay.

Reads and writes only local files; the dump comes from the clay CLI read, run separately.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enrich_math as M  # noqa: E402

HOME = os.path.expanduser(os.environ.get("CHEWBACCA_GTM_DIR", "~/.chewbacca/gtm"))
CATALOG = os.path.join(HOME, "clay-catalog.json")
OBSERVED = os.path.join(HOME, "clay-observed.json")

# Read off the Clay Tools panel in Caleb's screenshot, 2026-10-17 (Sabo workspace). These are
# the panel's own per-row prices, kept until a catalog dump replaces them.
PANEL_PRICES = {
    "Use AI": {"credits": None, "note": "Clay's AI column, priced per model", "outputs": ["model answer"]},
    "Enrich person": {"credits": 0.5, "note": "Clay person enrichment from a LinkedIn profile",
                      "outputs": ["title", "company", "location", "experience"]},
    "Work Email": {"credits": 1.1, "waterfall": True, "providers": 10,
                   "note": "tries 10 email providers in order, stops at the first hit", "outputs": ["work email"]},
    "Personal Email": {"credits": 3.3, "waterfall": True, "providers": 7,
                       "note": "tries 7 providers for a personal address", "outputs": ["personal email"]},
    "Mobile Phone": {"credits": 10.0, "waterfall": True, "providers": 14,
                     "note": "tries 14 providers for a mobile number", "outputs": ["mobile phone"]},
    "LATAM Mobile Phone": {"credits": 9.9, "waterfall": True, "providers": 11,
                           "note": "mobile numbers for Latin America", "outputs": ["mobile phone"]},
    "Perform search": {"credits": 0.2, "note": "Google search results", "outputs": ["search results"]},
    # Not in the panel; the Sabo table's Findymail column, 0.5 per run on the 10/15-16 receipts.
    "Find work email from profile URL": {"credits": 0.5, "note": "Findymail, single provider, from a LinkedIn URL",
                                         "outputs": ["work email"],
                                         "actionKey": "findymail-find-work-email-from-linkedin"},
}

CLIENTS = os.path.join(HOME, "clients")


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    os.replace(tmp, path)


def is_waterfall(a):
    text = " ".join(str(a.get(k) or "") for k in ("name", "displayName", "description", "type"))
    return bool(re.search(r"waterfall", text, re.I))


def compact(a):
    outs = [o.get("outputPath") for o in a.get("outputParameters") or [] if o.get("outputPath")]
    labels = a.get("actionLabels") or {}
    return {
        "name": a.get("displayName") or a.get("name"),
        "package": a.get("packageDisplayName") or "",
        "packageId": a.get("packageId"),
        "actionKey": a.get("actionKey"),
        "functionId": a.get("functionId"),
        "type": a.get("type"),
        "categories": a.get("categories") or [],
        "credits": a.get("creditCost"),
        "private_key_credits": a.get("usesPrivateKeyCost"),
        "tier": a.get("priorityTier"),
        "waterfall": is_waterfall(a),
        "configured": bool(a.get("configuredTools")),
        "requires_key": bool(labels.get("requiresApiKey")),
        "label_type": labels.get("type"),
        "outputs": outs[:40],
        "strengths": a.get("dataStrengths"),
        "why": a.get("whyUseful"),
        "description": (a.get("description") or "")[:400],
    }


def build(dump_path, out=CATALOG):
    with open(dump_path) as f:
        dump = json.load(f)
    if isinstance(dump, dict) and dump.get("error"):
        sys.exit(f"the dump is an error, not a catalog: {dump['error']}")
    actions = dump.get("data") if isinstance(dump, dict) else dump
    if not isinstance(actions, list) or not actions:
        sys.exit("no actions in the dump")
    cat = {"built": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "source": os.path.abspath(dump_path),
           "count": len(actions), "actions": [compact(a) for a in actions]}
    save(out, cat)
    return cat


def same_org(email_domain, domain):
    d = (domain or "").lower().removeprefix("www.")
    return bool(d) and (email_domain == d or email_domain.endswith("." + d))


# brand_buyer logs one {"step": "email", "email", "zerobounce"} per Findymail try. A try is
# usable only when the address exists, ZeroBounce says valid, and it sits at the brand or a
# parent the chain hopped to. Archer, 2026-10-16: Sydney Wild's vitaminwell.com inbox was valid
# and useless, because she'd left. Counting "found" would have scored that as a win.
def learn(runs_path, out=OBSERVED, provider="findymail-find-work-email-from-linkedin"):
    tried = found = usable = 0
    with open(runs_path) as f:
        for line in f:
            try:
                run = json.loads(line)
            except json.JSONDecodeError:
                continue
            steps = run.get("steps") or []
            domains = [run.get("domain")] + [s.get("to") for s in steps if s.get("step") == "parent fallback"]
            domains += [s.get("domain") for s in steps if s.get("step") == "Clay people search"]
            for s in steps:
                if s.get("step") != "email":
                    continue
                tried += 1
                email = s.get("email") or ""
                found += "@" in email
                at = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
                usable += bool(at) and s.get("zerobounce") == "valid" and any(same_org(at, d) for d in domains)
    obs = load(out, {})
    obs[provider] = {"tried": tried, "found": found, "usable": usable, "source": os.path.abspath(runs_path),
                     "at": time.strftime("%Y-%m-%d")}
    save(out, obs)
    return obs[provider]


def record(name, tried, usable, out=OBSERVED, note=""):
    """Add a head-to-head test's counts. A cascade's second step is recorded as
    '<second>|after <first> miss', counted only on the rows the first step missed."""
    obs = load(out, {})
    prev = obs.get(name) or {"tried": 0, "usable": 0}
    obs[name] = {"tried": prev["tried"] + tried, "usable": prev.get("usable", 0) + usable,
                 "at": time.strftime("%Y-%m-%d"), "note": note or prev.get("note", "")}
    save(out, obs)
    return obs[name]


def options(catalog):
    """Catalog actions, else the panel prices, as one list of option dicts."""
    acts = (catalog or {}).get("actions") or []
    if acts:
        out = []
        for a in acts:
            panel = PANEL_PRICES.get(a.get("name") or "")
            # Clay's catalog leaves functions unpriced; "Work Email" is one. The Tools panel prints
            # their per-row price, so a panel price fills the gap and says where it came from.
            if a.get("credits") is None and panel and panel.get("credits") is not None:
                a = {**a, "credits": panel["credits"], "price_source": "Clay Tools panel, 2026-10-17",
                     "waterfall": a.get("waterfall") or panel.get("waterfall", False),
                     "outputs": a.get("outputs") or panel.get("outputs", [])}
            out.append(a)
        return out
    return [{"name": n, "credits": p.get("credits"), "waterfall": p.get("waterfall", False),
             "actionKey": p.get("actionKey"),
             "providers": p.get("providers"), "source": "Clay Tools panel, 2026-10-17", "outputs": p.get("outputs", []),
             "categories": [], "description": p.get("note", "")} for n, p in PANEL_PRICES.items()]


def matches(opt, words):
    hay = " ".join([opt.get("name") or "", opt.get("package") or "", opt.get("description") or "",
                    " ".join(map(str, opt.get("categories") or [])), " ".join(opt.get("outputs") or [])]).lower()
    return all(w in hay for w in words)


def loose(opt, words):
    hay = " ".join([opt.get("name") or "", opt.get("description") or "", " ".join(opt.get("outputs") or [])]).lower()
    return any(w in hay for w in words if len(w) > 2)


# Jev answers fit from what an action returns, so a generically named action whose outputs carry
# the field still counts; Clay's own skill warns a keyword grep misses those. 40 candidates keep
# one request under Jev's 100 KB cap with descriptions cut to 160 characters.
JEV_MAX = 40
# Guessed, never measured: below even odds an action isn't offered as an option.
JEV_FIT = 0.5


def jev_fit(capability, opts):
    """{index: probability the action delivers the capability}, or None when Jev fails."""
    state = "\n".join(f"{i}: {o.get('name')} ({o.get('package') or 'Clay'}). {(o.get('description') or '')[:160]}"
                      f" Returns: {', '.join((o.get('outputs') or [])[:12]) or 'not listed'}"
                      for i, o in enumerate(opts))
    request = {"state": state, "questions": {f"fit_{i}": {
        "type": "noul",
        "instructions": f"Clay action {i}, {o.get('name')}: given one row per person or company, does running "
                        f"it return {capability} as one of its results? A different field from the same "
                        "provider is no.",
    } for i, o in enumerate(opts)}}
    out = subprocess.run(["chewbacca", "jev", "evaluate", "-"], input=json.dumps(request),
                         capture_output=True, text=True, timeout=60)
    try:
        answers = json.loads(out.stdout)["answers"]
        return {i: float(answers[f"fit_{i}"]["noul"]) for i in range(len(opts))}
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None


def key(opt):
    """Outcomes are filed by actionKey (stable across renames), else by name for functions."""
    return opt.get("actionKey") or opt.get("functionId") or opt.get("name")


def counts(observed, k):
    o = observed.get(k) or {}
    return o.get("usable", 0), o.get("tried", 0)


def with_cascades(opts, observed):
    """Each measured single option followed by each waterfall on its misses, as its own option."""
    singles = [o for o in opts if not o.get("waterfall") and counts(observed, key(o))[1] and o.get("credits") is not None]
    falls = [o for o in opts if o.get("waterfall") and o.get("credits") is not None]
    return opts + [{"name": f"{s['name']}, then {w['name']} on misses", "cascade": True,
                    "credits": [s["credits"], w["credits"]], "steps": [key(s), f"{key(w)}|after {key(s)} miss"]}
                   for s in singles for w in falls]


def candidates(capability, opts, use_jev, fit=jev_fit):
    """The options that deliver the capability: Jev over a loose prefilter, else every word must match."""
    words = [w for w in re.split(r"\W+", capability.lower()) if w]
    if use_jev:
        # Most capability words first, so a 739-action catalog doesn't hand Jev the first 40
        # actions that merely say "email" (2026-10-17: Findymail never reached the pool).
        hits = lambda o: sum(w in " ".join([o.get("name") or "", o.get("description") or "",
                                            " ".join(o.get("outputs") or [])]).lower() for w in words)
        pool = sorted((o for o in opts if loose(o, words)), key=hits, reverse=True)[:JEV_MAX]
        probs = fit(capability, pool) if pool else {}
        kept = [{**o, "fit": round(probs[i], 2)} for i, o in enumerate(pool) if probs and probs[i] >= JEV_FIT]
        # An empty answer falls through to keywords: "nothing fits" from a thin catalog entry is
        # weaker evidence than a name that says the thing outright.
        if kept:
            return kept
    return [o for o in opts if matches(o, words)]


def rank(capability, catalog=None, observed=None, value=None, use_jev=False, fit=jev_fit):
    """(options with p_best and yield intervals, decision). Jev only decides which actions are
    candidates; every number after that comes from counted outcomes in enrich_math."""
    catalog = load(CATALOG, {}) if catalog is None else catalog
    observed = load(OBSERVED, {}) if observed is None else observed
    opts = with_cascades(candidates(capability, options(catalog), use_jev, fit), observed)
    for o in opts:
        names = o.get("steps") or [key(o)]
        o["rates"] = [M.posterior(*counts(observed, n)) for n in names]
        o["observed"] = [f"{counts(observed, n)[0]}/{counts(observed, n)[1]}" for n in names]
    return M.compare(opts, value=value)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("dump")
    l = sub.add_parser("learn"); l.add_argument("runs"); l.add_argument("--provider", default="findymail-find-work-email-from-linkedin")
    r = sub.add_parser("record"); r.add_argument("name"); r.add_argument("--tried", type=int, required=True)
    r.add_argument("--usable", type=int, required=True); r.add_argument("--note", default="")
    p = sub.add_parser("pick"); p.add_argument("capability"); p.add_argument("--json", action="store_true")
    p.add_argument("--client", help="client slug; its 'value' block prices a contact in credits")
    p.add_argument("--no-jev", action="store_true", help="keyword match only")
    sub.add_parser("show")
    a = ap.parse_args(argv)
    if a.cmd == "build":
        cat = build(a.dump)
        print(f"{cat['count']} actions, {sum(x['waterfall'] for x in cat['actions'])} waterfalls -> {CATALOG}")
    elif a.cmd == "learn":
        print(json.dumps(learn(a.runs, provider=a.provider)))
    elif a.cmd == "record":
        print(json.dumps(record(a.name, a.tried, a.usable, note=a.note)))
    elif a.cmd == "pick":
        value = None
        if a.client:
            value = M.client_value(load(os.path.join(CLIENTS, f"{a.client}.json"), {}).get("value"))
        rows, decision = rank(a.capability, value=value, use_jev=not a.no_jev)
        if a.json:
            print(json.dumps({"options": rows, "decision": decision}, indent=1, default=str))
            return
        if not rows:
            print(f"nothing on file matches '{a.capability}'. Search wider before calling it missing.")
            return
        print(f"metric: {rows[0].get('metric')}" + ("" if value is not None else
              " (no client value block with deal_usd, reply_rate, close_rate, usd_per_credit)"))
        for o in rows:
            if o.get("p_best") is None:
                print(f"- {o['name']}: price unknown, not ranked")
                continue
            y = o["yield"]
            cost = o["credits"] if not o.get("cascade") else "+".join(map(str, o["credits"]))
            by = f" ({o['package']})" if o.get("package") else ""
            print(f"- {o['name']}{by} [{cost} cr, observed {', '.join(o['observed'])}] usable yield "
                  f"{y['mean']:.2f} (90%: {y['lo']:.2f} to {y['hi']:.2f}), P(best) {o['p_best']:.2f}")
        d = decision
        if d["action"] == "pick":
            print(f"\nPick: {d['name']} (best in {d['p_best']:.0%} of draws)")
        elif d["action"] == "test":
            print(f"\nNo pick yet: {d['leader']} leads at P(best) {d['p_best']:.2f}, under {M.CONFIDENT}. "
                  f"Test {d['name']} on {d['rows']} rows, record it, then pick again.")
    else:
        cat = load(CATALOG, {})
        print(f"catalog: {cat.get('count', 0)} actions, built {cat.get('built', 'never')}"
              + ("" if cat else " (pick falls back to the 2026-10-17 Tools panel prices)"))
        print(f"observed: {json.dumps(load(OBSERVED, {}))}")


if __name__ == "__main__":
    main()
