"""Copy a working Clay waterfall from one table onto another, through the API, with no clicks.

Caleb, 2026-10-17: "Bro never tell me to do things manually!" after being asked to add Clay's Work
Email waterfall to the Sabo table by hand. A table waterfall is not one column: Zeutara's table
t_0tmju95pkBPQmMJvubE holds 7 finder actions (LeadMagic, Findymail, Prospeo, Dropcontact, Hunter,
Datagma, Wiza), 7 Findymail validators that each run only when nothing earlier verified, and one
formula column (formulaType "waterfall") that keeps the first verified email. This reads that
dependency graph, swaps the source table's inputs for the target's, and creates each column in
dependency order, so every reference points at a column that already exists.

    python3 -I tools/waterfall_copy.py --from t_src --waterfall f_formula --client sabo \\
        --map f_srcName=Person --map-expr "<domain formula>=Company domain"   # plan only
    ... --apply

Every action column is created with runAsButton:true, so nothing runs until run-cells picks rows.
"""
import argparse
import json
import os
import re
import subprocess
import sys

REF = re.compile(r"\{\{(f_[0-9A-Za-z_]+)\}\}")
CLAY = os.environ.get("CHEWBACCA_CLAY_BIN", "chewbacca clay").split()
CLIENTS = os.path.expanduser("~/.chewbacca/gtm/clients")


def clay(*args):
    out = subprocess.run([*CLAY, *args], capture_output=True, text=True, timeout=120)
    lines = (out.stdout or "").strip().splitlines()
    receipt = json.loads(lines[-1]) if lines else {}
    if not receipt.get("ok"):
        raise SystemExit(f"{args[0]} failed: {(out.stdout or out.stderr)[:400]}")
    return receipt


def refs(col):
    return set(REF.findall(json.dumps(col.get("typeSettings") or {})))


def closure(cols, root):
    """The waterfall's own columns: the formula plus every action it reaches through actions."""
    by_id = {c["id"]: c for c in cols}
    keep, todo = set(), [root]
    while todo:
        cid = todo.pop()
        if cid in keep or cid not in by_id:
            continue
        c = by_id[cid]
        if cid != root and c.get("type") != "action":
            continue  # an input column (name, domain, source): stays on the source side
        keep.add(cid)
        todo.extend(refs(c))
    return keep


def order(cols, keep):
    by_id = {c["id"]: c for c in cols}
    done, seq = set(), []

    def visit(cid, stack=()):
        if cid in done:
            return
        if cid in stack:
            raise SystemExit(f"cycle through {by_id[cid]['name']}")
        for d in refs(by_id[cid]) & keep:
            visit(d, stack + (cid,))
        done.add(cid)
        seq.append(cid)

    for cid in sorted(keep):
        visit(cid)
    return seq


def plan(cols, root, id_map, expr_map, view):
    """Bodies in creation order. id_map/expr_map rewrite the source inputs; anything else unmapped stops."""
    by_id = {c["id"]: c for c in cols}
    keep = closure(cols, root)
    inputs = set().union(*(refs(by_id[c]) for c in keep)) - keep
    text_of = lambda c: json.dumps(by_id[c]["typeSettings"])
    unmapped = sorted(i for i in inputs if i not in id_map and not any(i in e for e in expr_map))
    if unmapped:
        named = [f"{i} ({by_id[i].get('name')})" if i in by_id else i for i in unmapped]
        raise SystemExit("map these source inputs first: " + ", ".join(named))
    bodies = []
    for cid in order(cols, keep):
        c = by_id[cid]
        ts = text_of(cid)
        for expr, target in expr_map.items():
            ts = ts.replace(json.dumps(expr)[1:-1], "{{" + target + "}}")
        for src, target in id_map.items():
            ts = ts.replace("{{" + src + "}}", "{{" + target + "}}")
        settings = json.loads(ts)
        if c.get("type") == "action":
            settings["runAsButton"] = True
        bodies.append({"source": cid, "body": {"name": c["name"], "type": c["type"], "typeSettings": settings,
                                               "activeViewId": view}})
    return bodies


def created_id(receipt):
    data = receipt.get("data") or {}
    for k in ("id", "fieldId"):
        if isinstance(data, dict) and str(data.get(k, "")).startswith("f_"):
            return data[k]
    field = data.get("field") if isinstance(data, dict) else None
    if isinstance(field, dict) and str(field.get("id", "")).startswith("f_"):
        return field["id"]
    raise SystemExit(f"no new column id in the response: {json.dumps(receipt)[:300]}")


def apply(client, bodies):
    new = {}
    for b in bodies:
        text = json.dumps(b["body"])
        for src, dst in new.items():
            text = text.replace("{{" + src + "}}", "{{" + dst + "}}")
        r = clay("add-enrichment-column", f"ws={client['ws']}", f"table={client['table']}", f"spec={text}",
                 "--allow-writes")
        new[b["source"]] = created_id(r)
        print(f"created {b['body']['name']} -> {new[b['source']]}", flush=True)
    return new


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from", dest="src", required=True, help="source table id")
    ap.add_argument("--waterfall", required=True, help="the source's waterfall formula column id")
    ap.add_argument("--client", required=True)
    ap.add_argument("--map", action="append", default=[], help="f_source=Target column name")
    ap.add_argument("--map-expr", action="append", default=[], help="source formula text=Target column name")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    with open(os.path.join(CLIENTS, f"{a.client}.json")) as f:
        client = json.load(f)
    src_cols = clay("columns", f"table={a.src}")["data"]
    dst = {c["name"]: c["id"] for c in clay("columns", f"table={client['table']}")["data"]}
    resolve = lambda name: dst.get(name) or sys.exit(f"target table has no column '{name}'")
    id_map = {k: resolve(v) for k, v in (m.split("=", 1) for m in a.map)}
    expr_map = {k: resolve(v) for k, v in (m.rsplit("=", 1) for m in a.map_expr)}
    bodies = plan(src_cols, a.waterfall, id_map, expr_map, client.get("view"))
    for b in bodies:
        print(f"- {b['body']['name']} [{b['body']['type']}: {b['body']['typeSettings'].get('actionKey') or b['body']['typeSettings'].get('formulaType')}]")
    if a.apply:
        mapping = apply(client, bodies)
        print(json.dumps(mapping))


if __name__ == "__main__":
    main()
