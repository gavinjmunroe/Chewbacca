#!/usr/bin/env python3
"""Query the open source app registry: what replaces a Mac app, and can it be remixed.

  oss-apps search <term>            name, description, category, stack, replaces
  oss-apps replaces <app>           open source apps that replace a proprietary one
  oss-apps category [<name>]        apps in a category, or every category with counts
  oss-apps remixable [<term>]       only permissive licenses, safe to build on and ship
  oss-apps show <owner/repo|name>   one entry in full
  oss-apps stats                    counts, sources, and what could not be fetched
  oss-apps build [--offline]        rebuild config/data/oss-apps/apps.json from the sources

Filters on every list: --remixable [--with-caveats], --stack <s>, --limit N (default 25, 0 = all), --json.

remixable is true only for a permissive SPDX license GitHub detected itself
(MIT, Apache, BSD, ISC and friends). MPL-2.0 and open-core repos a person read
and recorded in config/data/oss-apps/curated.json are remixable_with_caveat instead,
listed by --with-caveats with the caveat printed. GPL, AGPL, no license,
source-available and anything GitHub could not classify are false.
"""

import argparse
import json
import os
from pathlib import Path
import runpy
import sys

REPO = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("OSS_APPS_DATA", REPO / "config" / "data" / "oss-apps" / "apps.json"))


def load(path=None):
    data = json.loads(Path(path or DATA).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("apps"), list):
        raise ValueError(f"{path or DATA} is not an oss-apps registry")
    return data


def _fold(text):
    return (text or "").casefold()


def _haystack(app):
    parts = [app["name"], app["id"], app.get("description"), app.get("stack"), app.get("language")]
    parts += app.get("categories") or []
    parts += app.get("replaces") or []
    return _fold(" ".join(p for p in parts if p))


def _by_stars(apps):
    return sorted(apps, key=lambda a: (-(a.get("stars") or 0), _fold(a["name"])))


def search(apps, term):
    t = _fold(term)

    def rank(app):
        name = _fold(app["name"])
        if name == t:
            return 0
        if name.startswith(t):
            return 1
        if t in name or t in _fold(app["id"]):
            return 2
        if any(_fold(r) == t for r in app.get("replaces") or []):
            return 3
        return 4
    hits = [a for a in apps if t in _haystack(a)]
    return sorted(hits, key=lambda a: (rank(a), -(a.get("stars") or 0)))


def replaces(apps, product):
    """Exact name match on what an app replaces; substring only if nothing is exact."""
    p = _fold(product)
    exact = [a for a in apps if any(_fold(r) == p for r in a.get("replaces") or [])]
    if exact:
        return _by_stars(exact)
    return _by_stars([a for a in apps if any(p in _fold(r) for r in a.get("replaces") or [])])


def category(apps, name):
    n = _fold(name)
    return _by_stars([a for a in apps if any(n in _fold(c) for c in a.get("categories") or [])])


def categories(apps):
    counts = {}
    for a in apps:
        for c in a.get("categories") or []:
            counts[c] = counts.get(c, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def remix_ok(app, with_caveats=False):
    return app.get("remixable") is True or (with_caveats and app.get("remixable_with_caveat") is True)


def remixable(apps, term=None, with_caveats=False):
    pool = search(apps, term) if term else _by_stars(apps)
    return [a for a in pool if remix_ok(a, with_caveats)]


def find(apps, ident):
    """owner/repo first, then an exact name, and only then a repo slug, so
    `show sol` means the app called Sol, not whatever repo ends in /sol."""
    i = _fold(ident)
    for a in apps:
        if _fold(a["id"]) == i:
            return a
    named = [a for a in apps if _fold(a["name"]) == i]
    if named:
        return _by_stars(named)[0]
    slugged = [a for a in apps if _fold(a["repo"]).rstrip("/").endswith("/" + i)]
    return _by_stars(slugged)[0] if slugged else None


def apply_filters(rows, args):
    if args.remixable:
        rows = [a for a in rows if remix_ok(a, args.with_caveats)]
    if args.stack:
        s = _fold(args.stack)
        rows = [a for a in rows if s in _fold(a.get("stack"))]
    if args.limit:
        rows = rows[:args.limit]
    return rows


def fmt_stars(n):
    if n is None:
        return "-"
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def print_rows(rows, total, show_caveats=False):
    if not rows:
        print("no matches")
        return
    for a in rows:
        remix = "remix" if a.get("remixable") else ("caveat" if a.get("remixable_with_caveat") else "no-remix")
        repl = ", ".join((a.get("replaces") or [])[:4])
        print(f"{a['name'][:28]:<28} {fmt_stars(a.get('stars')):>7}  {a['license'][:14]:<14} {remix:<8}  "
              f"{(a.get('stack') or '')[:20]:<20} {a['repo']}")
        if repl:
            print(f"{'':<28}          replaces: {repl}")
        if show_caveats and a.get("remix_caveat"):
            print(f"{'':<28}          caveat: {a['remix_caveat']}")
    if total > len(rows):
        print(f"\n{len(rows)} of {total} shown. --limit 0 for all.")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="oss-apps", description=__doc__.splitlines()[0],
                                     formatter_class=argparse.RawDescriptionHelpFormatter,
                                     epilog="\n".join(__doc__.splitlines()[2:]))
    parser.add_argument("command", choices=["search", "replaces", "category", "remixable", "show", "stats", "build"])
    parser.add_argument("term", nargs="*")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--remixable", action="store_true", help="only permissive licenses")
    parser.add_argument("--with-caveats", action="store_true",
                        help="with --remixable: also MPL-2.0 and hand-read open core, caveat shown")
    parser.add_argument("--stack", help="Swift, Electron, Tauri, Flutter, Qt, Web ...")
    parser.add_argument("--limit", type=int, default=25, help="rows to show, 0 for all")
    parser.add_argument("--offline", action="store_true", help="build: reuse the fetch cache")
    args = parser.parse_args(argv)
    term = " ".join(args.term).strip()

    if args.command == "build":
        sys.argv = ["oss_apps_build.py"] + (["--offline"] if args.offline else [])
        runpy.run_path(str(REPO / "tools" / "oss_apps_build.py"), run_name="__main__")
        return 0

    try:
        data = load()
    except (OSError, ValueError) as err:
        print(f"oss-apps: cannot read the registry: {err}", file=sys.stderr)
        print("  rebuild it with: oss-apps build", file=sys.stderr)
        return 2
    apps = data["apps"]

    if args.command == "stats":
        if args.json:
            print(json.dumps(data["meta"], indent=1))
        else:
            meta = data["meta"]
            print(f"generated {meta['generated']} by {meta['generator']}")
            for k, v in meta["counts"].items():
                print(f"  {k:<22} {v}")
            for k, v in meta["gaps"].items():
                print(f"  {k:<34} {len(v)}{': ' + ', '.join(v[:8]) if v else ''}")
        return 0

    if args.command == "show":
        if not term:
            parser.error("show needs an owner/repo or a name")
        app = find(apps, term)
        if app is None:
            print(f"oss-apps: nothing named {term!r}. Try: oss-apps search {term}", file=sys.stderr)
            return 1
        print(json.dumps(app, indent=1, ensure_ascii=False))
        return 0

    if args.command == "category" and not term:
        cats = categories(apps)
        if args.json:
            print(json.dumps(cats, indent=1, ensure_ascii=False))
        else:
            for c, n in cats.items():
                print(f"{n:>4}  {c}")
        return 0

    if args.command in ("search", "replaces") and not term:
        parser.error(f"{args.command} needs a term")
    rows = {
        "search": lambda: search(apps, term),
        "replaces": lambda: replaces(apps, term),
        "category": lambda: category(apps, term),
        "remixable": lambda: remixable(apps, term or None, args.with_caveats),
    }[args.command]()
    total = len(apply_filters(rows, argparse.Namespace(**{**vars(args), "limit": 0})))
    shown = apply_filters(rows, args)
    if args.json:
        print(json.dumps({"query": {"command": args.command, "term": term or None},
                          "total": total, "apps": shown}, indent=1, ensure_ascii=False))
    else:
        print_rows(shown, total, show_caveats=args.remixable or args.command == "remixable")
    return 0 if shown else 1


if __name__ == "__main__":
    sys.exit(main())
