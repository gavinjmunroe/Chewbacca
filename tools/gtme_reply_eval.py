#!/usr/bin/env python3
"""chewbacca gtme reply-eval: measure the reply classifier on hand-labeled real replies.

    gtme reply-eval --gold FILE [--json] [--misses] [--min LABEL=RECALL ...]

FILE is JSONL, one reply per line: {id, text, label, why?, lead_email?, sending_email?,
company?}. text is the body as the inbox delivered it (HTML is fine): each row runs through
clean_reply_text and then reply_intent, the same path a live reply takes. label is one of
GOLD_LABELS, read by a person, never by the classifier.

Prints per-label precision, recall and support, then every confusion pair (gold -> predicted)
with its count. --misses adds the row ids behind each pair, never the reply text, so the
output is safe to paste. --min fails (exit 1) when a label's recall drops under the floor.

Parity with Togari only proved the port copied its bugs: on 65 real Zeutara replies both
bounces came out "unclear" (team/memory/feedback_run_ported_classifiers_on_real_inbox).
This is the check that isn't chosen by the code's author. Real gold files stay private
(~/.chewbacca/private/reply-gold/); only made-up rows go in tests.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gtme_reply  # noqa: E402

# What a person reading the reply would call it. Coarser than gtme_reply.KINDS on purpose:
# it's what decides the next action, and it's what a labeler can call without the rules.
#   question     asks for something before deciding: numbers, the deck, a form or portal
#   not_now      a person saying come back later (an autoresponder is bounce_auto)
#   wrong_person not them: left, new address, or names who to email instead
#   bounce_auto  nobody to answer: mailer-daemon, out-of-office, spam challenge, notices
#   forward      they put someone else on the thread (cc'd or forwarded), who already has it
#   needs_read   a person can't tell from the text either (a signature over an attachment)
GOLD_LABELS = ("interested", "question", "not_now", "not_interested", "wrong_person",
               "opt_out", "bounce_auto", "forward", "needs_read")

KIND_TO_GOLD = {
    "interested": "interested",
    "question": "question", "deck": "question", "form": "question",
    "later": "not_now",
    "pass": "not_interested",
    "new_address": "wrong_person", "referral": "wrong_person",
    "unsubscribe": "opt_out",
    "bounce": "bounce_auto", "ignore": "bounce_auto",
    "unclear": "needs_read",
}
# gtme_reply files an autoresponder under "later" with this label, so the follow-up waits
# for the return date; a person saying "in 3 weeks" gets "Come back later".
OUT_OF_OFFICE_LABEL = "Out of office"


def to_gold(intent):
    """A gtme_reply intent ({kind, label, ...}) as one of GOLD_LABELS."""
    kind = intent.get("kind")
    if kind == "later" and intent.get("label") == OUT_OF_OFFICE_LABEL:
        return "bounce_auto"
    return KIND_TO_GOLD.get(kind, "needs_read")


def classify(row):
    text = gtme_reply.clean_reply_text(row.get("text") or "")
    intent = gtme_reply.reply_intent(text, row.get("lead_email"), row.get("sending_email"),
                                     row.get("company"))
    return to_gold(intent)


def load_gold(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{number}: not JSON ({error.msg})") from None
            if not isinstance(row, dict) or "text" not in row or "label" not in row:
                raise ValueError(f"{path}:{number}: needs text and label")
            if row["label"] not in GOLD_LABELS:
                raise ValueError(f"{path}:{number}: label {row['label']!r} is not one of "
                                 + ", ".join(GOLD_LABELS))
            row.setdefault("id", f"row-{number}")
            rows.append(row)
    if not rows:
        raise ValueError(f"{path}: no rows")
    return rows


def evaluate(rows, predict=classify):
    """Per-label precision and recall plus confusion pairs. predict(row) -> a GOLD_LABELS
    value, so another classifier (Dough's) can be measured on the same rows."""
    gold = Counter()
    guessed = Counter()
    hits = Counter()
    pairs = defaultdict(list)
    for row in rows:
        want, got = row["label"], predict(row)
        gold[want] += 1
        guessed[got] += 1
        if want == got:
            hits[want] += 1
        else:
            pairs[(want, got)].append(row["id"])
    labels = {}
    for label in GOLD_LABELS:
        if not gold[label] and not guessed[label]:
            continue
        labels[label] = {
            "support": gold[label], "predicted": guessed[label], "correct": hits[label],
            "precision": round(hits[label] / guessed[label], 3) if guessed[label] else None,
            "recall": round(hits[label] / gold[label], 3) if gold[label] else None,
        }
    confusion = [{"gold": w, "predicted": g, "count": len(ids), "ids": ids}
                 for (w, g), ids in sorted(pairs.items(), key=lambda kv: (-len(kv[1]), kv[0]))]
    return {"rows": len(rows), "correct": sum(hits.values()),
            "accuracy": round(sum(hits.values()) / len(rows), 3), "labels": labels,
            "confusion": confusion}


def _pct(value):
    return "  n/a" if value is None else f"{value * 100:5.1f}%"


def render(result, misses=False):
    lines = [f"{result['correct']} of {result['rows']} replies labeled right "
             f"({result['accuracy'] * 100:.1f}%)", "",
             f"{'label':<16}{'gold':>5}{'guessed':>9}{'right':>7}{'precision':>11}{'recall':>9}"]
    for label, m in result["labels"].items():
        lines.append(f"{label:<16}{m['support']:>5}{m['predicted']:>9}{m['correct']:>7}"
                     f"{_pct(m['precision']):>11}{_pct(m['recall']):>9}")
    lines.append("")
    if not result["confusion"]:
        lines.append("No confusions.")
    for pair in result["confusion"]:
        line = f"{pair['count']:>3}  {pair['gold']} read as {pair['predicted']}"
        if misses:
            line += "  [" + ", ".join(pair["ids"]) + "]"
        lines.append(line)
    return "\n".join(lines)


def _floors(specs):
    floors = {}
    for spec in specs or []:
        label, _, value = spec.partition("=")
        if label not in GOLD_LABELS or not value:
            raise ValueError(f"--min wants LABEL=RECALL with a label from {', '.join(GOLD_LABELS)}")
        floors[label] = float(value)
    return floors


def main(argv=None):
    parser = argparse.ArgumentParser(prog="chewbacca gtme reply-eval",
                                     description=__doc__.splitlines()[0])
    parser.add_argument("--gold", required=True, help="hand-labeled JSONL, one reply per line")
    parser.add_argument("--json", action="store_true", help="the numbers as JSON")
    parser.add_argument("--misses", action="store_true",
                        help="list the row ids behind each confusion (never the text)")
    parser.add_argument("--min", action="append", metavar="LABEL=RECALL",
                        help="exit 1 when this label's recall is under RECALL (0 to 1)")
    args = parser.parse_args(argv)
    try:
        floors = _floors(args.min)
        result = evaluate(load_gold(args.gold))
    except (ValueError, OSError) as error:
        print(f"chewbacca gtme reply-eval: {error}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(render(result, misses=args.misses))
    low = [f"{label} recall {result['labels'].get(label, {}).get('recall')} under {floor}"
           for label, floor in floors.items()
           if (result["labels"].get(label, {}).get("recall") or 0) < floor]
    for line in low:
        print(f"FAIL {line}", file=sys.stderr)
    return 1 if low else 0


if __name__ == "__main__":
    sys.exit(main())
