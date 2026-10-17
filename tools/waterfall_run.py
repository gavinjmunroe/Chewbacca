"""Run a table waterfall on chosen rows one step at a time, through chewbacca clay only.

Each finder's conditionalRunFormulaText reads the earlier steps' results, so a step run before the
previous one finishes sees nothing and fires anyway, which is the spend the waterfall exists to
avoid. This runs finder then validator per step and waits for those cells to settle before the
next step, then prints the waterfall's value per row.

    python3 -I tools/waterfall_run.py --ws W --table T --waterfall f_formula --rows r_a,r_b,r_c
"""
import argparse
import json
import subprocess
import sys
import time

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import waterfall_measure as WM  # noqa: E402

# Clay finished a finder plus its validator on 3 rows in 10 to 40 s on 2026-10-17; 120 s is the
# ceiling before a step is reported stuck rather than waited on forever.
STEP_TIMEOUT = 120
POLL = 4
# 2026-10-17 first run: cells came back with values and statuses outside a short "done" list, so
# every step waited the full 120 s. A cell is settled unless Clay says it's still in flight.
IN_FLIGHT = {"RUNNING", "QUEUED", "PENDING", "IN_PROGRESS", "STARTED"}


def clay(*args):
    out = subprocess.run(["chewbacca", "clay", *args], capture_output=True, text=True, timeout=180)
    lines = (out.stdout or "").strip().splitlines()
    receipt = json.loads(lines[-1]) if lines else {}
    if not receipt.get("ok"):
        raise SystemExit(f"{args[0]} failed: {(out.stdout or out.stderr)[:300]}")
    return receipt["data"]


def statuses(ws, table, rows, fields):
    got = clay("rows-by-id", f"ws={ws}", f"table={table}", "rows=" + ",".join(rows), "fields=" + ",".join(fields))
    return {(r["id"], f): ((r.get("cells") or {}).get(f) or {}) for r in got for f in fields}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ws", required=True)
    ap.add_argument("--table", required=True)
    ap.add_argument("--waterfall", required=True)
    ap.add_argument("--rows", required=True)
    ap.add_argument("--from-step", type=int, default=1, help="resume here; run-cells forces a rerun, so never repeat a paid step")
    a = ap.parse_args(argv)
    rows = a.rows.split(",")
    cols = clay("columns", f"table={a.table}")
    names = {c["id"]: c["name"] for c in cols}
    for finder, validator in WM.steps(cols, a.waterfall)[a.from_step - 1:]:
        fields = [f for f in (finder, validator) if f]
        for f in fields:
            clay("run-cells", f"ws={a.ws}", f"table={a.table}", f"fields={f}", f"rows={','.join(rows)}", "--allow-writes")
            t0 = time.time()
            while time.time() - t0 < STEP_TIMEOUT:
                time.sleep(POLL)
                cells = statuses(a.ws, a.table, rows, [f])
                if all(str((c.get("metadata") or {}).get("status") or "").upper() not in IN_FLIGHT for c in cells.values()):
                    break
            else:
                print(f"{names[f]}: still running after {STEP_TIMEOUT}s", flush=True)
        cells = statuses(a.ws, a.table, rows, fields)
        print(f"- {names[finder]}: " + "; ".join(f"{r}: {str(cells[(r, finder)].get('value') or '-')[:60]}" for r in rows), flush=True)
    final = statuses(a.ws, a.table, rows, [a.waterfall])
    for r in rows:
        print(f"{r} -> {final[(r, a.waterfall)].get('value') or 'no verified email'}")


if __name__ == "__main__":
    main()
