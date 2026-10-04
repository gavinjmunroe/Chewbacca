#!/usr/bin/env python3
"""Precision and recall per threshold for brain-recall and skill-route, from
labeled real prompts, and a recommended bar chosen by a rule fixed in advance.

Both hooks shipped on 2026-10-03 with bars set from a handful of synthetic or
single observed prompts (MIN_COS 0.66, VEC_MIN 0.34, VEC_GATE 0.45). The hooks
now log every prompt to ~/.chewbacca/state/route-shadow.jsonl, bin/route-label
turns rows into labels, and this reads ~/.chewbacca/state/route-labels.jsonl.

  python3 tools/route_tune.py
  python3 tools/route_tune.py --labels path/to/route-labels.jsonl

THE RULE, written before any label existed. Do not edit it after looking at a
table; that turns a measurement back into a guess.

  Prediction at threshold t: the top-scoring candidate if its score >= t,
  otherwise abstain. Only the top candidate is judged, because it is the one
  that decides whether the hook speaks; brain-recall can show more than one
  file, and those extras are not scored here.

  A label says which candidate was right (truth), that nothing should have
  been shown, or that the right answer was not among the three ("outside").
    TP  prediction equals truth
    FP  a prediction that does not equal truth, including any prediction on a
        row whose truth is nothing
    positives  rows whose truth is a candidate or outside
  precision = TP / (TP + FP)     recall = TP / positives

  Bar (brain-recall MIN_COS, skill-route VEC_MIN): over t from 0.20 to 0.90
  in steps of 0.01, keep the thresholds with precision >= 0.80 on at least 10
  predictions. Of those, take the highest recall; tie, the highest precision;
  tie, the lowest threshold.

  Gate (skill-route VEC_GATE, which turns a suggestion into a refusal): the
  same, with precision >= 0.95. A wrong refusal blocks a tool call, so it has
  to be rarer than a wrong suggestion. Only one skill is enforced, so this is
  computed over every vector-routed row as a proxy and says so.

  Fewer than 50 labeled rows for a hook: print the table, recommend nothing.

Precision with fewer than 10 predictions is noise, which is why a threshold
that shows almost nothing cannot win on a perfect 2 out of 2.
"""

import argparse
import json
import os
import sys

MIN_ROWS = 50
MIN_PREDICTIONS = 10
BAR_PRECISION = 0.80
GATE_PRECISION = 0.95
GRID = [round(0.20 + i * 0.01, 2) for i in range(71)]
HOOKS = ("brain-recall", "skill-route")


def default_labels():
    home = os.environ.get("CHEWBACCA_HOME") or "~/.chewbacca"
    return os.environ.get("ROUTE_LABELS") or os.path.join(
        os.path.expanduser(home), "state", "route-labels.jsonl")


def load(path):
    """Latest label per row id wins, so relabeling a row corrects it."""
    out = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if not (row.get("id") and row.get("hook") in HOOKS and row.get("candidates")):
                continue
            # Stem-matcher scores run to 30 and are not cosines; one would
            # count as a prediction at every threshold. route-label already
            # skips them, this keeps a hand-edited file honest too.
            if row.get("method") not in (None, "vector", "cosine"):
                continue
            out[row["id"]] = row
    return list(out.values())


def score_at(rows, t):
    tp = fp = positives = shown = 0
    for r in rows:
        truth = r.get("truth")
        if truth is not None or r.get("outside"):
            positives += 1
        top = max(r["candidates"], key=lambda c: c["score"])
        if top["score"] < t:
            continue
        shown += 1
        if truth is not None and top["name"] == truth:
            tp += 1
        else:
            fp += 1
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / positives if positives else None
    return {"t": t, "shown": shown, "tp": tp, "fp": fp, "positives": positives,
            "precision": precision, "recall": recall}


def recommend(table, min_precision):
    ok = [r for r in table if r["shown"] >= MIN_PREDICTIONS
          and r["precision"] is not None and r["precision"] >= min_precision]
    if not ok:
        return None
    return sorted(ok, key=lambda r: (-(r["recall"] or 0), -r["precision"], r["t"]))[0]


def fmt(x):
    return "  -  " if x is None else f"{x:.2f}"


def report(hook, rows, out):
    table = [score_at(rows, t) for t in GRID]
    out.write(f"\n{hook}: {len(rows)} labeled rows\n")
    out.write("     t  shown   TP   FP  precision  recall\n")
    for r in table:
        if round(r["t"] * 100) % 2:
            continue
        out.write(f"  {r['t']:.2f}  {r['shown']:5d} {r['tp']:4d} {r['fp']:4d}     "
                  f"{fmt(r['precision'])}     {fmt(r['recall'])}\n")
    if len(rows) < MIN_ROWS:
        out.write(f"  no recommendation: {len(rows)} labeled rows, the rule needs {MIN_ROWS}.\n")
        return {"hook": hook, "rows": len(rows), "bar": None, "gate": None}
    result = {"hook": hook, "rows": len(rows), "bar": None, "gate": None}
    name = "MIN_COS" if hook == "brain-recall" else "VEC_MIN"
    bar = recommend(table, BAR_PRECISION)
    if bar:
        result["bar"] = bar["t"]
        out.write(f"  recommended {name} = {bar['t']:.2f}  (precision {bar['precision']:.2f} "
                  f"on {bar['shown']} shown, recall {fmt(bar['recall'])})\n")
    else:
        out.write(f"  no {name} reaches precision {BAR_PRECISION:.2f} on {MIN_PREDICTIONS}+ "
                  f"predictions. The hook is not ready to speak on this evidence.\n")
    if hook == "skill-route":
        gate = recommend(table, GATE_PRECISION)
        if gate:
            result["gate"] = gate["t"]
            out.write(f"  recommended VEC_GATE = {gate['t']:.2f}  (precision {gate['precision']:.2f} "
                      f"on {gate['shown']} shown; proxy over all vector rows, not only enforced skills)\n")
        else:
            out.write(f"  no VEC_GATE reaches precision {GATE_PRECISION:.2f} on "
                      f"{MIN_PREDICTIONS}+ predictions.\n")
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description="Threshold sweep for the prompt routers.")
    ap.add_argument("--labels", default=default_labels())
    ap.add_argument("--json", action="store_true", help="print the recommendations as JSON too")
    args = ap.parse_args(argv)
    try:
        rows = load(args.labels)
    except OSError:
        print(f"route_tune: no labels at {args.labels}. Run bin/route-label first.", file=sys.stderr)
        return 1
    results = [report(h, [r for r in rows if r["hook"] == h], sys.stdout) for h in HOOKS]
    if args.json:
        print(json.dumps(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
