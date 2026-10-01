#!/usr/bin/env python3
"""Score skill-routing arms on a labeled fixture, through the real route() path.

    hybrid_route_eval.py run  FIXTURE --arms keyword,jev,haiku,cascade --out DIR
    hybrid_route_eval.py fit  DIR          # choose the cascade threshold from a calibration run
    hybrid_route_eval.py summary DIR

Arms (all start with the same code rules, so exact cases cost nothing anywhere):
  none      always "no skill"; the floor any router must beat
  keyword   tools/skill_match.py, the model-free matcher behind skill-route.sh
  jev       Jev's choice, always accepted (threshold 0)
  haiku     claude -p --model haiku, discrete answer
  sonnet    claude -p --model sonnet, discrete answer
  cascade   Jev at the fitted threshold, haiku below it: tools/hybrid_route.py as shipped

Results carry prompts, so DIR belongs outside any public repo. Jev performance
figures stay private under TypeSafe's agreement 2.3(f).
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hybrid_route as hr  # noqa: E402

ARMS = ("none", "keyword", "jev", "haiku", "sonnet", "cascade")
# Four parallel claude -p processes kept the Mac responsive on 2026-09-26;
# more starts to queue on the subscription's own concurrency.
WORKERS = 4


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_arm(arm: str, case: dict, catalog: list[dict], threshold: float) -> dict:
    prompt = case["prompt"]
    names = {c["name"] for c in catalog}
    started = time.perf_counter()
    if arm in ("none", "keyword"):
        code = hr.code_node(prompt, names)
        if code["status"] == "accept":
            skill, by = code["skill"], "code"
        elif arm == "none":
            skill, by = None, "none"
        else:
            import skill_match
            from unittest.mock import patch
            skills = [(c["name"], c["description"], "") for c in catalog]
            with patch.object(skill_match, "load_skills", return_value=skills):
                matches = skill_match.match(prompt)
            skill, by = (matches[0][0] if matches else None), "keyword"
        result = {"status": "resolved", "skill": skill, "decided_by": by, "usd": 0.0,
                  "ms": hr._ms(started), "trace": []}
    elif arm == "jev":
        result = hr.route(prompt, catalog, threshold=0.0, use_llm=False)
    elif arm in ("haiku", "sonnet"):
        result = hr.route(prompt, catalog, model=arm, use_jev=False, max_usd=1.0)
    elif arm == "cascade":
        result = hr.route(prompt, catalog, threshold=threshold)
    else:
        raise ValueError(arm)
    acceptable = case["acceptable"] if case["acceptable"] is not None else [None]
    jev_stage = next((s for s in result["trace"] if s["backend"] == "jev"), None)
    return {"id": case["id"], "kind": case.get("kind"), "arm": arm, "skill": result["skill"],
            "status": result["status"], "decided_by": result["decided_by"],
            "correct": result["skill"] in acceptable, "usd": result["usd"], "ms": result["ms"],
            "jev_p": jev_stage.get("p") if jev_stage else None,
            "jev_skill": jev_stage.get("skill") if jev_stage else None,
            "jev_status": jev_stage.get("status") if jev_stage else None,
            "usd_known": all(s.get("usd_known", True) for s in result["trace"]),
            "escalated": any(s["backend"] == "llm" for s in result["trace"]) and arm == "cascade"}


def cmd_run(args) -> int:
    fixture = Path(args.fixture)
    cases = json.loads(fixture.read_text())
    catalog = json.loads(Path(args.catalog).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows_path = out / "rows.jsonl"
    done = set()
    if rows_path.exists():  # resume: a finished (case, arm) is never re-billed
        for line in rows_path.read_text().splitlines():
            try:
                row = json.loads(line)
                done.add((row["id"], row["arm"]))
            except (ValueError, KeyError):
                continue
    meta = {"fixture": str(fixture), "fixture_sha256": sha(fixture),
            "catalog_sha256": hr.catalog_hash(catalog), "threshold": args.threshold,
            "policy": hr.POLICY_VERSION, "hybrid_route_sha256": sha(Path(hr.__file__)),
            "harness_sha256": sha(Path(__file__)), "arms": args.arms.split(","),
            "started": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    jobs = [(arm, case) for arm in meta["arms"] for case in cases if (case["id"], arm) not in done]
    print(f"{len(jobs)} runs to do, {len(done)} already recorded", flush=True)

    def job(item):
        arm, case = item
        return run_arm(arm, case, catalog, args.threshold)
    with ThreadPoolExecutor(WORKERS) as pool, rows_path.open("a") as f:
        for row in pool.map(job, jobs):
            f.write(json.dumps(row) + "\n")
            f.flush()
            print(f"{row['arm']:8} {row['id']:8} {'ok ' if row['correct'] else 'MISS'} "
                  f"{row['decided_by']}", flush=True)
    return cmd_summary(args)


def load_rows(out: Path) -> list[dict]:
    rows = {}
    for line in (out / "rows.jsonl").read_text().splitlines():
        try:
            row = json.loads(line)
            rows[(row["id"], row["arm"])] = row
        except (ValueError, KeyError):
            continue
    return list(rows.values())


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (round(centre - half, 3), round(centre + half, 3))


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact p for b discordant one way and c the other."""
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n
    return round(min(1.0, 2 * tail), 4)


def p95(values: list[float]) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, math.ceil(0.95 * len(values)) - 1)] if values else 0.0


def summarize(rows: list[dict]) -> dict:
    by_arm: dict[str, list[dict]] = {}
    for row in rows:
        by_arm.setdefault(row["arm"], []).append(row)
    summary = {}
    for arm, rs in by_arm.items():
        k, n = sum(r["correct"] for r in rs), len(rs)
        model_ms = [r["ms"] for r in rs if r["decided_by"] != "code"]
        summary[arm] = {
            "n": n, "correct": k, "accuracy": round(k / n, 3), "wilson95": wilson(k, n),
            "usd_total": round(sum(r["usd"] for r in rs), 5),
            "usd_per_case": round(sum(r["usd"] for r in rs) / n, 6),
            "usd_all_known": all(r["usd_known"] for r in rs),
            "median_ms": round(statistics.median(r["ms"] for r in rs), 1),
            "p95_ms": round(p95([r["ms"] for r in rs]), 1),
            "median_ms_excluding_code": round(statistics.median(model_ms), 1) if model_ms else None,
            "unresolved": sum(r["status"] != "resolved" for r in rs),
            "escalation_rate": round(sum(r["escalated"] for r in rs) / n, 3) if arm == "cascade" else None,
            "by_kind": {kind: f"{sum(r['correct'] for r in rs if r['kind'] == kind)}/"
                              f"{sum(1 for r in rs if r['kind'] == kind)}"
                        for kind in sorted({r["kind"] for r in rs})},
        }
    ids = {r["id"] for r in rows}
    pairs = {}
    if "cascade" in by_arm:
        cascade = {r["id"]: r["correct"] for r in by_arm["cascade"]}
        for arm, rs in by_arm.items():
            if arm == "cascade":
                continue
            other = {r["id"]: r["correct"] for r in rs}
            shared = ids & cascade.keys() & other.keys()
            b = sum(cascade[i] and not other[i] for i in shared)
            c = sum(other[i] and not cascade[i] for i in shared)
            pairs[f"cascade_vs_{arm}"] = {"cascade_only_right": b, "other_only_right": c,
                                          "mcnemar_exact_p": mcnemar_exact(b, c)}
    return {"arms": summary, "paired": pairs}


def cmd_summary(args) -> int:
    out = Path(args.out)
    result = summarize(load_rows(out))
    (out / "summary.json").write_text(json.dumps(result, indent=1))
    for arm in ARMS:
        s = result["arms"].get(arm)
        if s:
            print(f"{arm:8} {s['correct']:>3}/{s['n']:<3} acc {s['accuracy']:.3f} {s['wilson95']}  "
                  f"${s['usd_per_case']:.5f}/case  median {s['median_ms']:.0f} ms  p95 {s['p95_ms']:.0f} ms"
                  + (f"  escalated {s['escalation_rate']:.2f}" if s["escalation_rate"] is not None else ""))
    for name, pair in result["paired"].items():
        print(f"{name}: {pair}")
    return 0


def cmd_fit(args) -> int:
    """Pick the threshold on calibration rows only: maximize cascade accuracy
    from the jev and haiku arms, ties to the higher threshold's lower spend
    broken toward fewer model calls. Writes fit.json; never reads a test set."""
    out = Path(args.out)
    rows = load_rows(out)
    jev = {r["id"]: r for r in rows if r["arm"] == "jev"}
    haiku = {r["id"]: r for r in rows if r["arm"] == "haiku"}
    ids = sorted(jev.keys() & haiku.keys())
    grid = [round(0.30 + 0.01 * i, 2) for i in range(70)]
    table = []
    for t in grid:
        correct = cost = escalations = 0.0
        for i in ids:
            j, h = jev[i], haiku[i]
            if j["decided_by"] == "code":
                correct += j["correct"]
                continue
            # Jev accepted only when valid and at or above t; otherwise haiku.
            accepted = j["jev_p"] is not None and j["jev_status"] != "error" and j["jev_p"] >= t
            cost += j["usd"]
            if accepted:
                correct += j["correct"]
            else:
                correct += h["correct"]
                cost += h["usd"]
                escalations += 1
        table.append({"threshold": t, "accuracy": round(correct / len(ids), 4),
                      "usd_per_case": round(cost / len(ids), 6),
                      "escalation_rate": round(escalations / len(ids), 3)})
    best = max(table, key=lambda r: (r["accuracy"], -r["usd_per_case"]))
    haiku_model_usd = [r["usd"] for r in haiku.values() if r["decided_by"] == "llm"]
    fit = {"n": len(ids), "chosen": best, "rule": "max calibration accuracy, then min cost",
           "measured_model_usd_mean": round(statistics.mean(haiku_model_usd), 5) if haiku_model_usd else None,
           "measured_model_usd_max": round(max(haiku_model_usd), 5) if haiku_model_usd else None,
           "table": table}
    (out / "fit.json").write_text(json.dumps(fit, indent=1))
    print(json.dumps({k: v for k, v in fit.items() if k != "table"}, indent=1))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("fixture")
    run.add_argument("--catalog", required=True)
    run.add_argument("--arms", default=",".join(ARMS))
    run.add_argument("--threshold", type=float, default=hr.DEFAULT_THRESHOLD)
    run.add_argument("--out", required=True)
    for name in ("fit", "summary"):
        p = sub.add_parser(name)
        p.add_argument("out")
    args = parser.parse_args()
    return {"run": cmd_run, "fit": cmd_fit, "summary": cmd_summary}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
