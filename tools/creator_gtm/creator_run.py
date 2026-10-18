"""One creator from a client's roster, end to end: brands found, buyers found, spend ranked, table tidy.

    chewbacca gtme creator <client> "<Creator name>" [--brands FILE] [--instagram HANDLE ...] [--live]

Before this, a creator's run took a hand-typed list of brands and domains in a one-off script, then
brand_buyer per brand, the Work Email waterfall by hand on the misses, spend_now add/check/write and
table_tidy, each remembered by whoever ran it. This runs those steps in that order:

  1 discover   brands the creator was paid by: Instagram posts on the creator's handles (and their
               run club's) that tag a brand next to an ad marker, plus any brands the client hands
               over. Every find is an evidence line with a date, a URL and where it came from.
  2 plan       per brand: run the chain, copy a contact another creator's row already found
               (no credits), or skip a brand this creator's row already has. Credits are
               estimated from the client's own run log and the enrichment catalog's prices.
  3 chain      brand_buyer on each brand that needs it, spending brands first, one row per brand
               with the Creator cell set, stopping before the client's credit allowance runs out.
  4 waterfall  the table's Work Email waterfall, only on rows where a person was picked and no
               verified email came back.
  5 spend      the sponsored posts go in as spend evidence, Jev checks them, scores are written.
  6 tidy       table_tidy puts the client view back in the shape its client file declares.

Dry run is the default: it reads and prints every step with its estimated credits, and writes
nothing. Every Clay call goes through `chewbacca clay` (inside the tools it runs), which holds the
credit allowance. Nothing here names a client; the client file carries all of it.
"""
import argparse
import contextlib
import datetime as dt
import json
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)
import brand_buyer as L  # noqa: E402
import enrich_catalog as C  # noqa: E402
import spend_now as SN  # noqa: E402
import table_tidy as TT  # noqa: E402
import waterfall_run as WR  # noqa: E402
from creator_gtm import provider as P  # noqa: E402

# ── discovery ────────────────────────────────────────────────────────────────

# A caption needs one of these next to an @brand before it is a candidate. Cheap recall, guessed
# from how sponsored posts disclose; Jev's check on the spend signal is the precision step, so a
# friend tagged under "use my code" costs one Jev answer and never a Clay credit.
AD_MARKERS = re.compile(r"#ad\b|#sponsored|#partner|#gifted|paid partnership|partnered with|in partnership|"
                        r"sponsored by|presented by|powered by|thank(?:s| you) to @|\bcode\b|ambassador", re.I)
MENTION = re.compile(r"@([A-Za-z0-9_.]{2,30})")
# A bio link on one of these is a link page, not the brand's own site.
LINK_HOSTS = {"linktr.ee", "linkin.bio", "lnk.bio", "beacons.ai", "bit.ly", "tinyurl.com", "shopmy.us", "liketk.it",
              "instagram.com", "tiktok.com", "youtube.com", "x.com", "twitter.com", "facebook.com", "linkpop.com",
              "stan.store", "hoo.be", "msha.ke", "campsite.bio", "solo.to", "taplink.cc", "allmylinks.com"}
SHORTCODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
# Instagram media ids carry their creation time in the top 41 bits, in ms after this epoch.
# Checked 2026-10-17 on three posts in the first client's research: DQfQg2TEtJJ decodes to
# 2025-10-31, DWr9_lakzjk to 2026-04-03, and DBY1Vpjt-oC to 2024-10-21, the week the brand's
# own press release for that reel ran (the research had typed 2025 for it by hand).
IG_EPOCH_MS = 1314220021721


def shortcode_date(code):
    """The UTC date an Instagram post was made, from its shortcode alone, or None."""
    n = 0
    for ch in code or "":
        if ch not in SHORTCODE:
            return None
        n = n * 64 + SHORTCODE.index(ch)
    if not n:
        return None
    return dt.datetime.fromtimestamp(((n >> 23) + IG_EPOCH_MS) / 1000, dt.timezone.utc).date()


def api_anything(site, op, **args):
    """One api-anything read. Raises with its reason; an unreadable source is never zero brands."""
    out = subprocess.run(["api-anything", "call", site, op, *[f"{k}={v}" for k, v in args.items()]],
                         capture_output=True, text=True, timeout=120)
    lines = (out.stdout or "").strip().splitlines()
    receipt = json.loads(lines[0]) if lines else {}
    if not receipt.get("ok"):
        raise RuntimeError(receipt.get("reason") or out.stderr.strip()[:300] or f"{site} {op} failed")
    data = receipt.get("data")
    if isinstance(data, dict) and "columns" in data:
        return [dict(zip(data["columns"], r)) for r in data["rows"]]
    return data if isinstance(data, list) else [data] if data else []


def ig_posts(handle):
    return [{"code": p.get("node.code"), "caption": p.get("node.caption.text") or ""}
            for p in api_anything("instagram", "getPosts", username=handle)]


def ig_profile(handle):
    rows = api_anything("instagram", "getProfile", username=handle)
    return rows[0] if rows else {}


# Seams the tests replace: Instagram posts, Instagram profiles, Jev, the allowance read.
POSTS = ig_posts
PROFILE = ig_profile


HOSTNAME = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def host(url):
    """The bare hostname of a URL or domain, or "" when it isn't one."""
    url = (url or "").strip().lower()
    h = urllib.parse.urlsplit(url if "://" in url else "https://" + url).hostname or ""
    h = h[4:] if h.startswith("www.") else h
    return h if HOSTNAME.match(h) else ""


def label(text, limit=60):
    """A name from a profile, as plain printable text of bounded length: it goes into Jev's prompts."""
    kept = "".join(ch if ch.isprintable() else " " if ch.isspace() else "" for ch in (text or ""))
    return " ".join(kept.split())[:limit]


def names_site(domain, *names):
    """True when the domain's own name is in the handle or display name, or the other way round.
    A bio link is the profile owner's claim; a site that doesn't carry the brand's name stays out, so
    a profile can't put someone else's domain on the email allowlist."""
    site = norm(domain.split(".")[-2] if domain.count(".") else domain)
    return len(site) >= 3 and any(n and (site in n or n in site) for n in map(norm, names))


def norm(name):
    return L._norm(name)


def known_domains(cfg, records):
    """Brand name -> domain the client already holds: its spend list, then its record file."""
    out = {norm(b): d for b, d in ((cfg.get("spend_now") or {}).get("brands") or {}).items()}
    for key, r in records.items():
        if r.get("domain"):
            out.setdefault(key, r["domain"])
    return out


def resolve_handle(handle, known):
    """(brand, domain, how) for an @handle, from its own profile; domain None when unresolved."""
    prof = PROFILE(handle) or {}
    brand = label(prof.get("full_name")) or handle
    for key in (norm(brand), norm(handle)):
        if key in known:
            return brand, known[key], "already on the client's brand list"
    for link in prof.get("bio_links") or []:
        url = link.get("url") if isinstance(link, dict) else link
        h = host(url)
        if h and h not in LINK_HOSTS:
            if names_site(h, handle, brand):
                return brand, h, f"@{handle}'s bio link {h}"
            return handle, None, f"@{handle}'s bio link {h} doesn't carry its name"
    return brand, None, f"@{handle} has no site in its bio"


def from_instagram(handles, creator, known, today, own=()):
    """(evidence, unreadable, unresolved): sponsored-looking posts on each handle, one item per brand tag."""
    found, unreadable, unresolved, cache = [], [], [], {}
    own = {h.lower() for h in (*handles, *own)}
    for handle in handles:
        try:
            posts = POSTS(handle)
        except Exception as exc:  # reported, never read as "no sponsors"
            unreadable.append(f"instagram @{handle}: {exc}")
            continue
        for post in posts:
            caption = post.get("caption") or ""
            if not AD_MARKERS.search(caption):
                continue
            for tag in dict.fromkeys(m.lower().rstrip(".") for m in MENTION.findall(caption)):
                if tag in own:
                    continue
                if tag not in cache:
                    try:
                        cache[tag] = resolve_handle(tag, known)
                    except Exception as exc:
                        unreadable.append(f"instagram profile @{tag}: {exc}")
                        cache[tag] = (tag, None, "profile unreadable")
                brand, domain, how = cache[tag]
                if not domain:
                    unresolved.append({"handle": tag, "why": how})
                    continue
                date = shortcode_date(post.get("code"))
                found.append({"creator": creator, "brand": brand, "domain": domain, "kind": "sponsored_post",
                              "date": date.isoformat() if date else "", "url": f"https://www.instagram.com/p/{post['code']}/",
                              "text": f"@{handle} post tagging @{tag}: {label(caption, 240)}",
                              "found_by": f"instagram @{handle}; domain from {how}; date decoded from the shortcode",
                              "found_on": today.isoformat()})
    return found, unreadable, unresolved


def read_brands_file(path):
    """[(brand, domain or None)] from JSON (list, list of {brand, domain}, or {brand: domain}) or lines."""
    with open(os.path.expanduser(path)) as f:
        text = f.read()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict):
        return [(b, d or None) for b, d in data.items()]
    if isinstance(data, list):
        return [(x, None) if isinstance(x, str) else (x.get("brand"), x.get("domain") or None) for x in data]
    out = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if parts and parts[0] and not parts[0].startswith("#") and parts[0].lower() != "brand":
            out.append((parts[0], parts[1] if len(parts) > 1 and parts[1] else None))
    return out


def from_handed(pairs, creator, known, today, source):
    found, unresolved = [], []
    for brand, domain in pairs:
        brand = label(brand)
        domain = host(domain) if domain else known.get(norm(brand))
        if not domain:
            unresolved.append({"brand": brand, "why": "handed over with no domain, and none on file"})
            continue
        found.append({"creator": creator, "brand": brand, "domain": domain, "kind": "handed", "date": "",
                      "url": "", "text": f"{brand} handed over by the client for {creator}", "found_by": source,
                      "found_on": today.isoformat()})
    return found, unresolved


def brands_of(evidence):
    """{brand: domain}, first find wins, one brand per domain so a tag and a handed name don't double."""
    out, seen = {}, {}
    for e in evidence:
        if e["domain"] in seen or e["brand"] in out:
            continue
        seen[e["domain"]] = e["brand"]
        out[e["brand"]] = e["domain"]
    return out


# ── files next to the client file ────────────────────────────────────────────

def side_file(cfg, suffix):
    return os.path.join(os.path.dirname(os.path.abspath(cfg["_path"])), f"{cfg.get('client_slug') or 'client'}.{suffix}")


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def append_creator_evidence(cfg, items):
    path = side_file(cfg, "creator-evidence.jsonl")
    have = set()
    if os.path.exists(path):
        with open(path) as f:
            have = {(e["creator"], e["brand"], e["kind"], e["url"]) for e in map(json.loads, filter(str.strip, f))}
    fresh = [e for e in items if (e["creator"], e["brand"], e["kind"], e["url"]) not in have]
    with open(path, "a") as f:
        for e in fresh:
            f.write(json.dumps(e) + "\n")
    return fresh


# ── plan and estimate ────────────────────────────────────────────────────────

def record_for(records, brand, domain):
    """The brand's record by name, else by domain: a list can call it "Strava (owns Runna)" where
    the chain filed it as "Strava"."""
    rec = records.get(norm(brand))
    if rec:
        return rec
    return next((r for r in records.values() if domain and domain in (r.get("domain"), (r.get("contact") or {}).get("domain"))), {})


def creator_row(cfg, rows_map, rec, creator, brand):
    """This creator's row for the brand: the map this command keeps, a record the chain wrote for
    them, or, for the client file's own creator, the chain's rows file from before records existed."""
    row = rows_map.get(f"{creator}|{norm(brand)}")
    if not row and rec.get("creator") == creator:
        row = rec.get("view_row")
    if not row and creator == cfg.get("creator"):
        row = L.load_rows().get(norm(brand))
    return row


def table_statuses(rows):
    """{row: Status cell} for rows that have no record, so a Ready row is never paid for twice."""
    if not rows or not L.prov().has_table:
        return {}
    field = next((c["id"] for c in L.columns() if c.get("name") == L.PICK_COLUMNS["status"]), None)
    if not field:
        return {}
    got = L.clay("rows-by-id", True, ws=L.WS, table=L.TABLE, rows=",".join(rows), fields=field).get("data") or []
    return {r["id"]: ((r.get("cells") or {}).get(field) or {}).get("value") for r in got}


STATUSES = table_statuses


def plan(cfg, creator, brands, records, rows_map, ready):
    """[(brand, domain, action, row)]: action is skip, copy or chain."""
    recs = {b: record_for(records, b, d) for b, d in brands.items()}
    found = {b: (rec, creator_row(cfg, rows_map, rec, creator, b)) for b, rec in recs.items()}
    on_table = STATUSES([row for rec, row in found.values() if row and not rec])
    out = []
    for brand, domain in brands.items():
        rec, row = found[brand]
        has_contact = (rec.get("contact") or {}).get("status") == ready or (row and on_table.get(row) == ready)
        if has_contact and row:
            out.append((brand, domain, "skip", row))
        elif has_contact:
            out.append((brand, domain, "copy", None))
        else:
            out.append((brand, domain, "chain", row))
    return out


def run_costs(run_log):
    """Credits per live chain run and whether it ended on a picked person with no verified email."""
    costs, misses = [], []
    try:
        with open(run_log) as f:
            runs = [json.loads(line) for line in f if line.strip()]
    except OSError:
        runs = []
    for r in runs:
        if not r.get("live"):
            continue
        c = (r.get("cost") or {}).get("credits")
        if c is None:
            c = r.get("credits_observed")
        if c is not None:
            costs.append(float(c))
        res = r.get("result") or {}
        if res.get("person"):
            misses.append(res.get("status") != r.get("ready", L.READY))
    return costs, misses


def waterfall_option():
    """The enrichment catalog's work-email waterfall: (option, decision) or (None, decision)."""
    ranked, decision = C.rank("work email")
    fall = next((o for o in ranked if o.get("waterfall") and not o.get("cascade")), None)
    return fall, decision


def estimate(cfg, steps, has_table):
    """Per-step credit estimates, each saying what it rests on."""
    costs, misses = run_costs(L.RUN_LOG)
    chain = sum(a == "chain" for _, _, a, _ in steps)
    est = {"chain_brands": chain}
    if costs:
        mean = statistics.fmean(costs)
        est["chain"] = {"credits": round(chain * mean, 1), "low": round(chain * min(costs), 1),
                        "high": round(chain * max(costs), 1),
                        "basis": f"mean {mean:.2f} a brand over {len(costs)} live runs in the client's run log "
                                 f"(range {min(costs):.2f} to {max(costs):.2f})"}
    else:
        est["chain"] = {"credits": None, "basis": "no live runs in the client's run log yet: unmeasured"}
    if not has_table:
        est["waterfall"] = {"credits": 0, "basis": "the provider has no table, so no waterfall to run"}
    else:
        fall, decision = waterfall_option()
        rate = sum(misses) / len(misses) if misses else None
        price = (fall or {}).get("credits")
        rows = None if rate is None else chain * rate
        est["waterfall"] = {
            "credits": round(rows * price, 1) if rows is not None and price is not None else None,
            "basis": (f"{rate:.0%} of {len(misses)} picked runs ended with no verified email, "
                      if rate is not None else "miss rate unmeasured, ")
                     + (f"{fall['name']} at {price} credits a row ({fall.get('price_source') or fall.get('source') or 'catalog'})"
                        if fall else "no waterfall in the enrichment catalog"),
            "catalog": decision.get("action"), "catalog_pick": decision.get("name")}
    est["copy"] = {"credits": 0, "basis": "row add and plain cells, no enrichment"}
    est["spend"] = {"credits": 0, "basis": "plain columns and cells; Jev checks run locally"}
    est["tidy"] = {"credits": 0, "basis": "view settings only"}
    known = [v["credits"] for k, v in est.items() if isinstance(v, dict) and k != "chain_brands"]
    est["total"] = None if any(c is None for c in known) else round(sum(known), 1)
    if est["total"] is not None and costs:
        est["total_high"] = round(est["chain"]["high"] + (est["waterfall"]["credits"] or 0), 1)
    return est


def read_allowance(ws):
    """(daily credits, spent today) for the workspace, or None when no allowance is on file."""
    out = subprocess.run(["chewbacca", "clay", "allowance", f"ws={ws}"], capture_output=True, text=True, timeout=60)
    try:
        a = (json.loads(out.stdout).get("allowances") or {}).get(str(ws))
    except json.JSONDecodeError:
        return None
    return (a["daily_credits"], a.get("spent_today", 0.0)) if a else None


ALLOWANCE = read_allowance


# ── the steps that write ─────────────────────────────────────────────────────

def run_chain(cfg, creator, brand, domain, row, live):
    if not HOSTNAME.match(domain or ""):
        raise SystemExit(f"{domain!r} is not a hostname")
    argv = ["--client", cfg["_path"], "--creator", creator] + (["--live"] if live else [])
    argv += (["--row", row] if row else ["--new-row"]) + ["--", brand, domain]
    with contextlib.redirect_stdout(sys.stderr):
        return L.main(argv)


def copy_contact(cfg, creator, brand, domain, rec, live):
    """A new row for this creator carrying the contact another creator's run already found."""
    L.configure({**cfg, "creator": creator})
    cols = L.ensure_pick_columns(live)
    opened = L.prov().open_account(brand, domain, creator, live)
    row = opened["ref"]
    if live and row:
        L.show(row, L.view_cells({**rec["contact"], "row": row}, cols))
    return row


def waterfall_field(cfg):
    """The table's work-email waterfall column: named in the client file, else the only one there."""
    cols = L.columns()
    name = (cfg.get("columns") or {}).get("waterfall")
    if name:
        return next((c["id"] for c in cols if c.get("name") == name), None)
    falls = [c["id"] for c in cols if (c.get("typeSettings") or {}).get("formulaWaterfall")]
    return falls[0] if len(falls) == 1 else None


def run_waterfall(cfg, field, rows):
    with contextlib.redirect_stdout(sys.stderr):
        WR.main(["--ws", str(cfg["ws"]), "--table", cfg["table"], "--waterfall", field, "--rows", ",".join(rows)])
    final = WR.statuses(str(cfg["ws"]), cfg["table"], rows, [field])
    return {r: (final[(r, field)].get("value") or None) for r in rows}


WATERFALL = run_waterfall


def take_waterfall(cfg, misses, found):
    """Each miss whose waterfall value is an email at the brand or a verified parent becomes Ready."""
    taken = []
    for brand, domain, res in misses:
        email = found.get(res["row"])
        if not email or "@" not in str(email):
            continue
        allowed = [domain, res.get("domain")] + L.PARENT_DOMAINS.get(norm(brand), [])
        # The waterfall writes a value only after one of its validators passed, so "valid" is its verdict.
        if L.email_problem(email, "valid", allowed):
            continue
        why = (res.get("why") or "").rstrip(".") + f"; Findymail missed, the Work Email waterfall found and verified {email}."
        contact = {**res, "email": email, "zerobounce": "valid (waterfall)", "why": why, "status": L.READY}
        P.save_record(L.RECORDS_FILE, norm(brand), {"contact": {k: contact.get(k) for k in (
            "person", "title", "email", "zerobounce", "profile", "domain", "why", "status")}})
        L.show(res["row"], L.view_cells({**contact}, L.ensure_pick_columns(True)))
        taken.append(brand)
    return taken


def spend_items(cfg_s, evidence):
    """Sponsored posts as evidence for the client's spend signal named for them (default "campaign")."""
    kind = cfg_s["spend_now"].get("creator_post_signal", "campaign")
    if kind not in SN.signals(cfg_s):
        return []
    return [{"brand": e["brand"], "kind": kind, "date": e["date"], "url": e["url"], "text": e["text"],
             "found_by": e["found_by"]} for e in evidence if e["kind"] == "sponsored_post" and e["date"]]


def remember_brands(path, brands):
    """Add this creator's brands to the client file's spend list, so later scoring keeps them."""
    with open(path) as f:
        cfg = json.load(f)
    have = cfg.setdefault("spend_now", {}).setdefault("brands", {})
    new = {b: d for b, d in brands.items() if b not in have and d not in have.values()}
    if new:
        have.update(new)
        save_json(path, cfg)
    return new


# ── the command ──────────────────────────────────────────────────────────────

def say(msg=""):
    print(msg, flush=True)


def main(argv=None, today=None, jev=None):
    ap = argparse.ArgumentParser(prog="chewbacca gtme creator", description=__doc__.split("\n\n")[0])
    ap.add_argument("client", help="client slug (~/.chewbacca/gtm/clients/<slug>.json) or client file")
    ap.add_argument("creator", help="the creator's name as it should read in the Creator column")
    ap.add_argument("--brands", help="brands the client handed over: JSON or lines of 'Brand, domain'")
    ap.add_argument("--instagram", action="append", default=[], help="a handle to read (repeat for a run club)")
    ap.add_argument("--live", action="store_true", help="spend and write (default prints the plan)")
    a = ap.parse_args(argv)
    cfg = L.load_client(a.client)
    if not cfg:
        ap.error(f"no client file for {a.client!r}")
    today = today or dt.date.today()
    jev = jev or SN.run_jev
    creator = a.creator
    L.configure({**cfg, "creator": creator}, strict=a.live)
    prov = L.prov()
    records = P.load_records(L.RECORDS_FILE)["brands"]
    known = known_domains(cfg, records)
    mode = "LIVE" if a.live else "dry run, nothing written or spent"
    say(f"{creator} for {cfg.get('client_slug') or 'client'} ({mode}), provider {prov.label}")

    # 1 discover
    handles = list(dict.fromkeys(a.instagram + ((cfg.get("creators") or {}).get(creator) or {}).get("instagram", [])))
    ig, unreadable, unresolved = from_instagram(handles, creator, known, today)
    handed, unresolved_h = ([], [])
    if a.brands:
        handed, unresolved_h = from_handed(read_brands_file(a.brands), creator, known, today,
                                           f"brands file {os.path.basename(a.brands)}")
    evidence = ig + handed
    brands = brands_of(evidence)
    say(f"\n1 discover (0 credits): {len(handles)} Instagram handle(s), {len(ig)} sponsored-post finds, "
        f"{len(handed)} handed over, {len(brands)} brands")
    for e in ig:
        say(f"  - {e['brand']} ({e['domain']}): {e['date'] or 'undated'} {e['url']}")
    for u in unreadable:
        say(f"  UNREADABLE {u}")
    for u in unresolved + unresolved_h:
        say(f"  no domain, left out: {u.get('brand') or '@' + u.get('handle', '')}: {u['why']}")
    if not handles and not a.brands:
        say("  no source: pass --instagram <handle> or --brands <file>, or add creators.<name>.instagram to the client file")
    if not brands:
        say("\nNo brands to run.")
        return {"brands": {}, "unreadable": unreadable}
    if a.live:
        append_creator_evidence(cfg, evidence)

    # spend scores first, so the chain spends on spending brands first
    cfg_s = SN.load_client(cfg["_path"])
    cfg_s["spend_now"]["brands"] = {**cfg_s["spend_now"]["brands"], **brands}
    items = [SN.validate_item(cfg_s, e, today) for e in spend_items(cfg_s, evidence)]
    if a.live:
        SN.append_evidence(cfg_s, items)
        SN.check(cfg_s, today, jev=jev)
    ev = SN.load_evidence(cfg_s)
    score = {b: SN.brand_result(ev, b, today, cfg_s)[0] for b in brands}

    # 2 plan
    rows_map = load_json(side_file(cfg, "creator-rows.json"), {})
    steps = sorted(plan(cfg, creator, brands, records, rows_map, L.READY), key=lambda s: -score[s[0]])
    est = estimate(cfg, steps, prov.has_table)
    allowance = ALLOWANCE(cfg.get("ws")) if prov.has_table else None
    left = round(allowance[0] - allowance[1], 1) if allowance else None
    say(f"\n2 plan: {sum(s[2] == 'chain' for s in steps)} to run, {sum(s[2] == 'copy' for s in steps)} to copy "
        f"from another creator's row, {sum(s[2] == 'skip' for s in steps)} already on this creator's row")
    for brand, domain, action, row in steps:
        say(f"  {score[brand]:>3}  {brand} ({domain}): {action}" + (f", row {row}" if row else ""))
    say(f"\n3 chain: {est['chain'].get('credits')} credits est. ({est['chain']['basis']})")
    say(f"4 waterfall: {est['waterfall'].get('credits')} credits est. ({est['waterfall']['basis']})")
    say(f"5 spend: 0 credits ({len(items)} sponsored posts as spend evidence, Jev checks, scores written)")
    say(f"6 tidy: 0 credits (table_tidy {'--apply' if a.live else 'plan'})")
    say(f"total: {est['total']} credits est." + (f", up to {est['total_high']}" if est.get("total_high") else "")
        + (f"; allowance left today {left} of {allowance[0]}" if allowance else ""))
    report = {"creator": creator, "today": today.isoformat(), "live": a.live, "brands": {}, "estimate": est,
              "unreadable": unreadable, "allowance_left": left}
    if not a.live:
        return report

    # 3 chain, spending brands first, stopping before the allowance runs out
    costs, _ = run_costs(L.RUN_LOG)
    per_brand_max = max(costs) if costs else None
    spent, results = 0.0, {}
    for brand, domain, action, row in steps:
        rec = record_for(records, brand, domain)
        if action == "skip":
            results[brand] = {**(rec.get("contact") or {}), "row": row, "action": "skip"}
            continue
        if action == "copy":
            row = copy_contact(cfg, creator, brand, domain, rec, True)
            rows_map[f"{creator}|{norm(brand)}"] = row
            results[brand] = {**rec["contact"], "row": row, "action": "copy"}
            continue
        if left is not None and per_brand_max is not None and left - spent < per_brand_max:
            results[brand] = {"status": f"BLOCKED: {left - spent:.1f} credits left in today's allowance, "
                                        f"a brand has cost up to {per_brand_max:.1f}", "action": "held"}
            continue
        try:
            log = run_chain(cfg, creator, brand, domain, row, True)
        except SystemExit as exc:
            results[brand] = {"status": f"Needs work: chain stopped: {exc}", "action": "chain"}
            continue
        res = log.get("result") or {}
        spent += (log.get("cost") or {}).get("credits") or 0.0
        if res.get("row"):
            rows_map[f"{creator}|{norm(brand)}"] = res["row"]
        results[brand] = {**res, "action": "chain"}
        save_json(side_file(cfg, "creator-rows.json"), rows_map)
    save_json(side_file(cfg, "creator-rows.json"), rows_map)
    L.configure({**cfg, "creator": creator})

    # 4 waterfall on picked rows with no verified email
    misses = [(b, brands[b], r) for b, r in results.items()
              if r.get("action") == "chain" and r.get("person") and r.get("row") and r.get("status") != L.READY]
    if not prov.has_table:
        say(f"\n4 waterfall: skipped, {prov.label} has no table ({len(misses)} rows without a verified email)")
    elif not misses:
        say("\n4 waterfall: every picked row already has a verified email")
    else:
        field = waterfall_field(cfg)
        if not field:
            say("\n4 waterfall: BLOCKED: no single waterfall column on the table; name it as columns.waterfall")
        else:
            taken = take_waterfall(cfg, misses, WATERFALL(cfg, field, [r["row"] for _, _, r in misses]))
            for b in taken:
                results[b]["status"] = L.READY
            say(f"\n4 waterfall: ran on {len(misses)} rows, {len(taken)} now Ready")

    # 5 spend
    remember_brands(cfg["_path"], brands)
    if prov.has_table:
        with contextlib.redirect_stdout(sys.stderr):
            SN.write(cfg_s, today, True)
    ev = SN.load_evidence(cfg_s)
    score = {b: SN.brand_result(ev, b, today, cfg_s)[0] for b in brands}

    # 6 tidy
    if prov.has_table:
        with contextlib.redirect_stdout(sys.stderr):
            TT.main(["--client", cfg["_path"], "--apply"])

    say(f"\n{creator}: brand list, spending first")
    for b in sorted(results, key=lambda b: -score[b]):
        r = results[b]
        say(f"  {score[b]:>3}  {b}: {r.get('person') or '-'}, {r.get('email') or 'no email'}, {r.get('status')}")
        report["brands"][b] = {"score": score[b], **{k: r.get(k) for k in ("person", "title", "email", "status", "row", "action")}}
    with open(side_file(cfg, "creator-runs.jsonl"), "a") as f:
        f.write(json.dumps({**report, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}) + "\n")
    return report


if __name__ == "__main__":
    main()
