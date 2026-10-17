"""Put a client's Clay table into the shape its client file declares, every time, from one spec.

Caleb, 2026-10-17, looking at the Sabo table: "U are unorganized af with the table", then "Make
sure every table chewb ever makes is systematically organized, not brute forced" and "This will
make it infinitely easier to iterate and build off of and learn from workflows". The table had
38 columns: two Findymail columns, two Email formulas, two Verify columns and nine hand-typed
leftovers, all visible, sorted by last update. The lesson had been written down on 10/16 and the
view was still never set, because setting it was a step someone had to remember.

The client file's "client_view" is the spec: the columns the client reads, in order, and the
sort. With no spec, it is derived from the client file's "columns" mapping, so a new client gets
the same shape without anyone writing one. `table_graph.lint` runs first, so a duplicate
enrichment column is reported before anyone builds on it.

    python3 -I tools/table_tidy.py --client sabo            print the plan, change nothing
    python3 -I tools/table_tidy.py --client sabo --apply    set the view through chewbacca clay

Writes go only through `chewbacca clay view-columns / view-move-columns / view-sort`, which hold
Caleb's ok. It never adds, deletes or runs a column.
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import table_graph  # noqa: E402

CLIENTS = os.path.expanduser(os.environ.get("CHEWBACCA_GTM_DIR", "~/.chewbacca/gtm")) + "/clients"
# The story a client reads left to right: what, is it ready, how hot, who, their role, how to reach
# them, for which creator. Sabo's call on 10/16 asked for exactly these and nothing else.
DEFAULT_ORDER = ["brand", "status", "spend", "person", "title", "contact", "creator"]


def load_client(name):
    path = name if name.endswith(".json") else os.path.join(CLIENTS, f"{name}.json")
    with open(path) as f:
        return json.load(f)


def spec(client):
    """(ordered column names, [(name, direction)]) from client_view, else derived."""
    view = client.get("client_view") or {}
    if view.get("columns"):
        return view["columns"], [tuple(s) for s in view.get("sort") or []]
    cols = dict(client.get("columns") or {})
    score = ((client.get("spend_now") or {}).get("columns") or {}).get("score")
    if score:
        cols["spend"] = score
    names = [cols[k] for k in DEFAULT_ORDER if cols.get(k)]
    sort = [(n, "DESC") for n in (cols.get("status"), score) if n]
    return names, sort


def plan(columns, names, sort):
    by_name = {c["name"]: c["id"] for c in columns}
    missing = [n for n in names if n not in by_name]
    show = [by_name[n] for n in names if n in by_name]
    visibility = {c["id"]: {"isVisible": c["id"] in show} for c in columns}
    moves = [(show[i], show[i - 1]) for i in range(1, len(show))]
    sort_items = [{"fieldId": by_name[n], "direction": d} for n, d in sort if n in by_name]
    return {"show": show, "visibility": visibility, "moves": moves, "sort": sort_items, "missing": missing}


def clay(op, *args):
    out = subprocess.run(["chewbacca", "clay", op, *args, "--allow-writes"],
                         capture_output=True, text=True, timeout=60)
    receipt = json.loads((out.stdout or "{}").strip().splitlines()[-1] or "{}")
    if not receipt.get("ok"):
        raise SystemExit(f"{op} failed: {(out.stdout or out.stderr)[:300]}")
    return receipt


def apply(client, p):
    base = [f"ws={client['ws']}", f"table={client['table']}", f"view={client['view']}"]
    clay("view-columns", *base, "columns=" + json.dumps(p["visibility"]))
    # One move per call: Clay answers 400 when moved fields aren't already adjacent.
    for field, after in p["moves"]:
        clay("view-move-columns", *base, f"fields={field}", f"after_field={after}")
    if p["sort"]:
        clay("view-sort", *base, "sort=" + json.dumps(p["sort"]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--client", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    client = load_client(a.client)
    columns = table_graph.columns(client["table"])
    by_id, deps, feeds, _ = table_graph.graph(columns)
    issues = [i for i in table_graph.lint(by_id, deps, feeds) if "A client view should show" not in i]
    names, sort = spec(client)
    p = plan(columns, names, sort)
    print(f"client view: {' | '.join(names)}")
    print(f"sort: {', '.join(f'{n} {d}' for n, d in sort) or 'none'}")
    print(f"hides {sum(not v['isVisible'] for v in p['visibility'].values())} of {len(columns)} columns")
    if p["missing"]:
        print(f"MISSING from the table: {', '.join(p['missing'])}")
    for i in issues:
        print(f"- structure: {i}")
    if a.apply:
        apply(client, p)
        print("applied")


if __name__ == "__main__":
    main()
