#!/usr/bin/env python3
"""gtme-portfolio: the shared firm -invested_in-> company graph every investor list judges with.

    gtme-portfolio import PATH                  merge an older graph file in, keeping its provenance
    gtme-portfolio build --csv investors.csv    fetch and extract firms not in the graph yet
                         [--limit N] [--workers 4]
    gtme-portfolio show DOMAIN                  one firm's companies and the page that proves them
    gtme-portfolio stats

THE FAILURE THIS EXISTS FOR. On 2026-10-26 an investor list for a mushroom
protein founder was decided by sector keywords: "consumer" let Greylock and a
fintech fund in, and a keyword patch was the next proposal. Caleb: "WHY IS
THERE BRUTE FORCE WORD KEY STUFF IN CHEWBACCA? I THOUGHT WE HAD MADE AN
INTELLIGENT SYSTEM???????" What a firm actually backed is the evidence of fit.
A graph of 489 firms and 9,920 portfolio edges already existed, built for one
client and locked in that client's repo, so no other list ever read it. This
is that graph in the kit, keyed by firm domain, with no client in it.

Ontology (graph-engineering stage 3), kept to what the judge needs:

    Firm      keyed by domain        attrs: firm, page_url, fetched_at, reachable, extractor
    Company   a name on the page     attrs: name
    INVESTED_IN  Firm -> Company     provenance: source (the page URL the name was read on)

Extraction is a model with no tools, since the page text is a stranger's
(an injected instruction can only change the JSON). Every company name it
returns must appear literally on the page, or the edge is dropped: that check
is the quality gate, and it runs in code on every edge. Fit to a founder's
pitch is not stored here; gtme-investors asks Jev that per list, with these
edges as the evidence.

Graph file: $GTME_PORTFOLIO_GRAPH, else ~/.chewbacca/gtm/graph/portfolio.json.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import json
import os
import re
import subprocess
import sys
import threading
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gtme_pipeline as gp  # noqa: E402
import gtme_solo as solo  # noqa: E402

PORT = re.compile(r"portfolio|companies|investments|our-companies|holdings", re.I)
# A portfolio page shorter than this is a nav shell or a logo wall with no
# alt text; the extractor then reads the homepage instead. Carried over from
# the client build of 2026-10-05, where it was guessed, never measured.
MIN_PAGE_CHARS = 500
PAGE_CHARS = 16_000
MODEL = os.environ.get("GTME_PORTFOLIO_MODEL", "haiku")
_lock = threading.Lock()


def graph_path() -> Path:
    return Path(os.environ.get("GTME_PORTFOLIO_GRAPH")
                or Path.home() / ".chewbacca" / "gtm" / "graph" / "portfolio.json")


def load() -> dict:
    try:
        g = json.loads(graph_path().read_text())
    except (OSError, ValueError):
        g = {}
    g.setdefault("firms", {})
    return g


def save(g: dict) -> None:
    p = graph_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(g, indent=1))
    tmp.replace(p)


def domain_of(website: str) -> str:
    w = (website or "").split()[0] if (website or "").split() else ""
    return solo.domain_of(w) if w else ""


def page_text(body: str) -> str:
    """Visible text plus image alt and title text: a logo wall names its companies only there."""
    alts = " ".join(re.findall(r'(?i)(?:alt|title|aria-label)=["\']([^"\']{2,60})["\']', body or ""))
    return re.sub(r"\s+", " ", gp.text_of(body) + " " + alts).strip()


def portfolio_page(domain: str) -> tuple[str, str]:
    home_url = f"https://{domain}/"
    home = gp.page(home_url)
    if not home:
        return "", ""
    links = [urllib.parse.urljoin(home_url, h) for h in re.findall(r'href=["\']([^"\'#?]+)["\']', home)]
    cands = [u for u in links if solo.domain_of(u) == domain and PORT.search(urllib.parse.urlsplit(u).path)]
    cands += [urllib.parse.urljoin(home_url, p) for p in ("/portfolio", "/companies", "/portfolio/")]
    for u in dict.fromkeys(cands):
        t = page_text(gp.page(u))
        if len(t) > MIN_PAGE_CHARS:
            return u, t
    return home_url, page_text(home)


def model_extract(firm: str, url: str, text: str) -> list[str]:
    prompt = (f"Text from {firm}'s website ({url}):\n<page>{text[:PAGE_CHARS]}</page>\n\n"
              "List every company this page shows the firm invested in. Only names that literally appear on the "
              "page; skip the firm itself, its LPs, team members, partners and news outlets.\n"
              'Reply with only JSON: {"companies": ["..."]}').replace("\x00", " ")
    try:
        # No settings sources and our own system prompt: with the user's
        # instructions loaded, the first pilot (2026-10-26) answered every
        # page with a prayer and no JSON, so 3 of 3 firms got zero edges.
        p = subprocess.run(["claude", "-p", "--model", MODEL, "--tools", "", "--permission-mode", "plan",
                            "--setting-sources", "", "--no-session-persistence",
                            "--system-prompt", "You extract company names from web pages. Reply with JSON only.",
                            prompt], capture_output=True, text=True, timeout=240)
    except (OSError, subprocess.TimeoutExpired):
        return []
    m = re.search(r"\{.*\}", p.stdout, re.S)
    try:
        names = json.loads(m.group(0)).get("companies", []) if m else []
    except json.JSONDecodeError:
        return []
    return [n if isinstance(n, str) else (n or {}).get("name", "") for n in names]


def verified(names: list[str], text: str, firm: str) -> list[str]:
    """The quality gate: a name the model gave that the page doesn't contain is dropped."""
    low, out = text.lower(), []
    for n in names:
        n = re.sub(r"\s+", " ", str(n or "")).strip()
        if len(n) > 1 and n.lower() in low and n.lower() != firm.lower() and n not in out:
            out.append(n)
    return out


def build_one(domain: str, firm: str, extract=model_extract) -> dict:
    url, text = portfolio_page(domain)
    cos = verified(extract(firm, url, text), text, firm) if text else []
    return {"firm": firm, "page_url": url, "reachable": bool(text), "fetched_at":
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "extractor": MODEL,
            "companies": [{"name": c, "source": url} for c in cos]}


def companies(domain: str, g: dict | None = None) -> list[dict]:
    node = (g or load())["firms"].get(domain) or {}
    return node.get("companies") or []


# One Jev call carries this many company questions. 40 was the first pilot's
# size and Jev answered every one (2026-10-26); never measured past that.
MATCH_BATCH = 40
# A company is in the pitch's market at 0.7. Guessed from one pilot: Beyond
# Meat 0.90, Kite Hill 0.83, Pivot Bio 0.72 were the real matches it found.
MATCH_YES = 0.7


# Bumped when the match method changes, so cached answers from the old
# method are asked again: v2 added the second look with page context.
MATCH_VERSION = "v2"


def pitch_key(pitch: str) -> str:
    import hashlib
    return hashlib.sha1(f"{MATCH_VERSION} {pitch}".encode()).hexdigest()[:12]


def match_question(firm: str, name: str, pitch: str) -> str:
    return (f"Is the company named {name} (an investment of {firm}) in the same market as this startup, close "
            f"enough that backing {name} shows real interest in it: {pitch}? Companies in that startup's own "
            f"industry and its supply chain count. Companies in unrelated industries do not, even if they sell "
            f"to consumers too.")


def jev_match(firm: str, names: list[str], pitch: str, names_source=lambda n: "") -> list[tuple[str, float]] | None:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
    import gtme_jev  # the kit's Jev by path, never tools/jev.py (11/2)
    jev = gtme_jev.kit_jev()
    if jev is None:
        return None
    hits, answered = [], False
    for i in range(0, len(names), MATCH_BATCH):
        chunk = names[i:i + MATCH_BATCH]
        qs = {f"c:{j}": {"type": "noul", "instructions": match_question(firm, n, pitch)} for j, n in enumerate(chunk)}
        a = jev.ask({"firm": firm, "portfolio": chunk}, qs, decision="gtme-portfolio-match") or {}
        for j, n in enumerate(chunk):
            p = jev.probability((a.get(f"c:{j}") or {}).get("noul"))
            if p is not None:
                answered = True
                if p >= MATCH_YES:
                    hits.append((n, round(p, 2)))
    if not answered:
        return None
    return confirm_hits(firm, hits, pitch, names_source)


# The second look. Asked from the name alone, Jev passed W Capital -> Tacala
# (a Taco Bell franchisee), G20 -> Bidtellect (ad tech) and Forum -> VendorPM
# for an MSP software founder at 0.70 to 0.74 (2026-10-26), while the real
# matches (JMI -> Autotask 0.86, Castile -> Whaleback 0.87) sat higher. Each
# first-pass hit is asked again with the words around it on the firm's own
# page. On that second look the three false ones scored 0.06 to 0.07 and
# Autotask 0.73, so the bar sits at 0.5. Set from those few; never measured
# on more.
CONFIRM_YES = 0.5
SNIPPET = 300


def snippet(name: str, source: str) -> str:
    text = page_text(gp.page(source)) if source else ""
    i = text.lower().find(name.lower())
    return text[max(0, i - SNIPPET):i + len(name) + SNIPPET] if i >= 0 else ""


def confirm_question(firm: str, name: str, pitch: str) -> str:
    return (f"The text is from {firm}'s own portfolio page, around the company {name}. Using it and what you "
            f"know of {name}, is {name} in this startup's market: it sells to the same customers, builds the "
            f"same kind of product, or is itself the kind of customer this startup sells to? The startup: "
            f"{pitch}. A company in a different industry is no, even when it is also a business "
            f"that buys software, also sells to consumers, or shares a buzzword.")


def _jev():
    lib = str(Path(__file__).resolve().parent.parent / "bin" / "lib")
    if lib not in sys.path[:1]:
        sys.path.insert(0, lib)
    import gtme_jev  # the kit's Jev by path, never tools/jev.py (11/2)
    return gtme_jev.kit_jev()


def confirm_hits(firm: str, hits: list[tuple[str, float]], pitch: str, source_of, ask=None) -> list[tuple[str, float]]:
    jev = _jev()
    ask = ask or jev.ask
    out = []
    for name, _ in hits:
        a = ask({"firm": firm, "company": name, "page_text_around_it": snippet(name, source_of(name))},
                    {"fit": {"type": "noul", "instructions": confirm_question(firm, name, pitch)}},
                    decision="gtme-portfolio-confirm") or {}
        p = jev.probability((a.get("fit") or {}).get("noul"))
        if p is not None and p >= CONFIRM_YES:
            out.append((name, round(p, 2)))
    return out


def matches(firm: str, names: list[str], pitch: str, g: dict | None = None, ask=jev_match):
    """Which of a firm's companies are in this pitch's market, cached on the
    firm's node per pitch so a rerun asks Jev nothing it already answered."""
    g = g if g is not None else load()
    node = next((n for n in g["firms"].values() if n.get("firm") == firm and n.get("companies")), None)
    key = pitch_key(pitch)
    if node is not None and key in (node.get("fits") or {}):
        return [tuple(h) for h in node["fits"][key]["hits"]]
    src = {c["name"]: c.get("source", "") for c in (node or {}).get("companies") or []}
    hits = ask(firm, names, pitch, lambda n: src.get(n, "")) if ask is jev_match else ask(firm, names, pitch)
    if hits is not None and node is not None:
        with _lock:
            node.setdefault("fits", {})[key] = {"pitch": pitch[:200], "hits": hits,
                                                "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
            save(g)
    return hits


def firms_from_csv(path: Path) -> dict[str, str]:
    out = {}
    with path.open(newline="", encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            d = domain_of(r.get("website") or "") or (r.get("email") or "").rsplit("@", 1)[-1].lower()
            if d and d not in out:
                out[d] = r.get("organization") or r.get("company") or d
    return out


def cmd_build(a, extract=model_extract) -> int:
    g = load()
    want = firms_from_csv(Path(os.path.expanduser(a.csv)))
    todo = [(d, f) for d, f in want.items() if d not in g["firms"]]
    have = len(want) - len(todo)
    if a.limit:
        todo = todo[:a.limit]
    print(f"{len(want)} firms in the list, {have} already in the graph, {len(todo)} to fetch now", flush=True)

    def one(df):
        d, firm = df
        try:
            return d, build_one(d, firm, extract)
        except Exception as err:  # one bad site never stops the build; the node says why
            return d, {"firm": firm, "reachable": False, "companies": [], "error": type(err).__name__}
    done = 0
    with concurrent.futures.ThreadPoolExecutor(a.workers) as ex:
        for d, node in ex.map(one, todo):
            with _lock:
                g["firms"][d] = node
                done += 1
                if done % 10 == 0 or done == len(todo):
                    save(g)
                    print(f"{done}/{len(todo)}", flush=True)
    save(g)
    got = [g["firms"][d] for d, _ in todo]
    print(f"built {len(got)}: {sum(1 for n in got if n.get('companies'))} with companies, "
          f"{sum(len(n.get('companies') or []) for n in got)} edges, "
          f"{sum(1 for n in got if not n.get('reachable'))} unreachable")
    return 0


def cmd_import(a) -> int:
    src = json.loads(Path(os.path.expanduser(a.path)).read_text())
    g = load()
    added = edges = 0
    for d, node in (src.get("firms") or {}).items():
        if d in g["firms"]:
            continue
        url = node.get("page_url")
        cos = [{"name": c["name"], "source": url} for c in node.get("companies") or [] if c.get("name")]
        g["firms"][d] = {"firm": node.get("firm") or d, "page_url": url, "reachable": bool(node.get("reachable")),
                         "fetched_at": node.get("fetched"), "extractor": f"imported from {a.path}", "companies": cos}
        added += 1
        edges += len(cos)
    save(g)
    print(f"imported {added} firms, {edges} edges; client sector tags were left behind")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gtme-portfolio", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("build")
    p.add_argument("--csv", required=True)
    p.add_argument("--limit", type=int, default=0, help="first N new firms only, for a pilot")
    p.add_argument("--workers", type=int, default=4)
    p = sub.add_parser("import")
    p.add_argument("path")
    p = sub.add_parser("show")
    p.add_argument("domain")
    sub.add_parser("stats")
    a = ap.parse_args(argv)
    if a.cmd == "build":
        return cmd_build(a)
    if a.cmd == "import":
        return cmd_import(a)
    g = load()
    if a.cmd == "show":
        print(json.dumps(g["firms"].get(a.domain) or {}, indent=1))
        return 0
    f = g["firms"]
    print(f"{len(f)} firms, {sum(1 for n in f.values() if n.get('companies'))} with companies, "
          f"{sum(len(n.get('companies') or []) for n in f.values())} edges")
    return 0


if __name__ == "__main__":
    sys.exit(main())
