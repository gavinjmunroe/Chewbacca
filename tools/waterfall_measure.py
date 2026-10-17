"""Count what a Clay waterfall actually delivered, per provider, from rows it already ran.

Caleb, 2026-10-17: "Nothing in this process should be based on vibes". The waterfall's yield was the
one unmeasured number in enrich_catalog's pick, and the Sabo table had only 3 rows to test it on. The
Zeutara tables had already run the same 7-provider Work Email waterfall on 258+ rows, so the counts
existed for free. This reads them: for each finder, the rows it ran on (only rows every earlier
step missed), how many it found, and how many its validator verified; then the waterfall's own
yield. `--record` files them for enrich_catalog under each finder's actionKey and the waterfall's
key, with the table named as the population, because a VC-partner list is not a brand list.

    python3 -I tools/waterfall_measure.py --ws 1372623 --table t_... --waterfall f_... [--record KEY]
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enrich_catalog as C  # noqa: E402

REF = re.compile(r"\{\{(f_[0-9A-Za-z_]+)\}\}")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def clay(*args):
    out = subprocess.run(["chewbacca", "clay", *args], capture_output=True, text=True, timeout=180)
    lines = (out.stdout or "").strip().splitlines()
    receipt = json.loads(lines[-1]) if lines else {}
    if not receipt.get("ok"):
        raise SystemExit(f"{args[0]} failed: {(out.stdout or out.stderr)[:300]}")
    return receipt["data"]


def steps(cols, waterfall):
    """[(finder column, validator column or None)] in waterfall order, read off its formulas."""
    by_id = {c["id"]: c for c in cols}
    out = []
    for step in by_id[waterfall]["typeSettings"]["formulaWaterfall"]:
        ids = REF.findall(step["formula"])
        finders = [i for i in ids if by_id.get(i, {}).get("type") == "action"
                   and "validate" not in by_id[i]["typeSettings"].get("actionKey", "")]
        finder = finders[-1]  # each step names the earlier finders first, its own last
        validator = next((i for i in ids if "validate" in by_id.get(i, {}).get("typeSettings", {}).get("actionKey", "")
                          and finder in json.dumps(by_id[i]["typeSettings"].get("inputsBinding"))), None)
        out.append((finder, validator))
    return out


def tally(rows, pairs, waterfall):
    counts = {f: {"ran": 0, "found": 0, "verified": 0} for f, _ in pairs}
    done = 0
    for r in rows:
        cells = r.get("cells") or {}
        for f, v in pairs:
            cell = cells.get(f) or {}
            if not cell.get("value") and (cell.get("metadata") or {}).get("status") not in ("SUCCESS", "ERROR"):
                continue
            counts[f]["ran"] += 1
            found = bool(EMAIL.search(str(cell.get("value") or "")))
            counts[f]["found"] += found
            vcell = (cells.get(v) or {}) if v else {}
            counts[f]["verified"] += found and (not v or str(vcell.get("value") or "").startswith("✅"))
        done += bool(EMAIL.search(str((cells.get(waterfall) or {}).get("value") or "")))
    return counts, done


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ws", required=True)
    ap.add_argument("--table", required=True)
    ap.add_argument("--waterfall", help="the waterfall formula column; default: the table's only one")
    ap.add_argument("--record", help="the catalog key to file the waterfall's own yield under")
    a = ap.parse_args(argv)
    cols = clay("columns", f"table={a.table}")
    by_id = {c["id"]: c for c in cols}
    if not a.waterfall:
        falls = [c["id"] for c in cols if (c.get("typeSettings") or {}).get("formulaType") == "waterfall"]
        if len(falls) != 1:
            raise SystemExit(f"{len(falls)} waterfall columns; pass --waterfall")
        a.waterfall = falls[0]
    pairs = steps(cols, a.waterfall)
    view = next(v["id"] for v in clay("views", f"table={a.table}") if v["name"] == "All rows")
    ids = clay("row-ids", f"ws={a.ws}", f"table={a.table}", f"view={view}")
    fields = ",".join([a.waterfall] + [x for p in pairs for x in p if x])
    rows = []
    for i in range(0, len(ids), 100):
        rows += clay("rows-by-id", f"ws={a.ws}", f"table={a.table}", "rows=" + ",".join(ids[i:i + 100]), f"fields={fields}")
    counts, done = tally(rows, pairs, a.waterfall)
    ran = sum(1 for r in rows if any((r.get("cells") or {}).get(f) for f, _ in pairs))
    for step, (f, _) in enumerate(pairs):
        c, key = counts[f], by_id[f]["typeSettings"]["actionKey"]
        print(f"- {key}: ran {c['ran']}, found {c['found']}, verified {c['verified']}")
        if a.record:
            # The first step runs on every row, so its rate is the provider's own; later steps only
            # see what earlier ones missed, a harder population, and are filed apart.
            k = key if step == 0 else f"{key}|after earlier waterfall misses"
            C.record(k, c["ran"], c["verified"], note=f"population {a.table}")
    print(f"waterfall: {done} verified emails on {ran} rows it ran on")
    if a.record:
        C.record(a.record, ran, done, note=f"population {a.table}")


if __name__ == "__main__":
    main()
