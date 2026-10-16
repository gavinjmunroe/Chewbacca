"""Read a table's columns and print how they feed each other, before touching any cell.

Every action and formula column names its inputs as {{f_...}} inside inputsBinding or
formulaText. Those references are the table's dependency graph: run a column and every
column downstream of it can change. This prints the graph in run order, what each paid
action costs to trigger, and the client-readiness problems Caleb flagged on 2026-10-16
("move all the goated rows to the top", "isn't the whole point of a waterfall that it
condenses"). Read-only: it only calls `chewbacca clay columns`.

    python3 -I tools/table_graph.py <table id>
"""
import json
import re
import subprocess
import sys

REF = re.compile(r"\{\{(f_[0-9A-Za-z]+)\}\}")
# Per-run Data Credit costs observed on the Sabo table, 2026-10-15/16 receipts.
OBSERVED_COST = {
    "cpj-find-lists-of-people-v2": 0.5,
    "findymail-find-work-email-from-linkedin": 0.5,
    "validate-email": 0.1,
    "social-posts-get-post-activity-posts-and-shares": 2.5,
    "use-ai": 3.0,
}


def columns(table):
    out = subprocess.run(["chewbacca", "clay", "columns", f"table={table}"],
                         capture_output=True, text=True, timeout=60)
    receipt = json.loads(out.stdout or "{}")
    if not receipt.get("ok"):
        sys.exit(f"columns read failed: {out.stdout[:300]}")
    return receipt["data"]


def inputs(col):
    ts = col.get("typeSettings") or {}
    text = json.dumps(ts.get("inputsBinding", [])) + (ts.get("formulaText") or "")
    return sorted(set(REF.findall(text)))


def graph(cols):
    by_id = {c["id"]: c for c in cols}
    deps = {c["id"]: [d for d in inputs(c) if d in by_id] for c in cols}
    order, seen = [], set()

    def visit(cid, stack=()):
        if cid in seen:
            return
        if cid in stack:
            raise SystemExit(f"cycle through {by_id[cid]['name']}")
        for d in deps[cid]:
            visit(d, stack + (cid,))
        seen.add(cid)
        order.append(cid)

    for c in cols:
        visit(c["id"])
    feeds = {c["id"]: [o for o in by_id if c["id"] in deps[o]] for c in cols}
    return by_id, deps, feeds, order


def lint(by_id, deps, feeds):
    issues = []
    actions = [c for c in by_id.values() if c.get("type") == "action"]
    visible = [c for c in by_id.values() if not c["id"].startswith("f_created") and not c["id"].startswith("f_updated")]
    if len(visible) > 8:
        issues.append(f"{len(visible)} columns. A client view should show 4 to 6, one per step of the story.")
    leaves = [c for c in visible if not feeds[c["id"]] and deps[c["id"]]]
    if not any(c.get("type") == "formula" and len(deps[c["id"]]) >= 2 for c in leaves):
        issues.append("No condensed result column: nothing at the end combines the person, email and verdict into one cell (the waterfall pattern).")
    names = [c["name"].lower() for c in visible]
    if not any("status" in n for n in names):
        issues.append("No Status column, so ready rows can't be filtered from half-run and test rows.")
    for c in actions:
        action = (c.get("typeSettings") or {}).get("actionKey", "")
        if not deps[c["id"]]:
            issues.append(f"'{c['name']}' ({action}) has no column inputs, so it can't be chained or gated.")
    dup_actions = {}
    for c in actions:
        dup_actions.setdefault(c["typeSettings"].get("actionKey"), []).append(c["name"])
    for key, names_ in dup_actions.items():
        if len(names_) > 1:
            issues.append(f"{len(names_)} columns run {key}: {', '.join(names_)}. A waterfall would try providers in one column.")
    return issues


def main():
    table = sys.argv[1]
    cols = columns(table)
    by_id, deps, feeds, order = graph(cols)
    print(f"{len(cols)} columns, run order (inputs first):")
    for cid in order:
        c = by_id[cid]
        kind = c.get("type")
        action = (c.get("typeSettings") or {}).get("actionKey", "")
        cost = OBSERVED_COST.get(action)
        ins = ", ".join(by_id[d]["name"] for d in deps[cid]) or "(typed in)"
        outs = ", ".join(by_id[o]["name"] for o in feeds[cid]) or "nothing"
        price = f" ~{cost} cr/run" if cost is not None else (" cost unknown" if kind == "action" else "")
        print(f"- {c['name']} [{kind}{': ' + action if action else ''}{price}]\n    from: {ins}\n    feeds: {outs}")
    issues = lint(by_id, deps, feeds)
    print(f"\nClient readiness: {len(issues)} issue(s)")
    for i in issues:
        print(f"- {i}")


if __name__ == "__main__":
    main()
