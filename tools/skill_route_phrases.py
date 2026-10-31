#!/usr/bin/env python3
"""Learn per-skill trigger phrases from the train half of the skill-route labels.

    skill_route_phrases.py learn [--labels FILE] [--min-support 2] [--min-precision 0.75] [--out FILE]

The keyword router in .claude/hooks/skill-route.sh matches a prompt against skill
descriptions, which are written in documentation English. Caleb types in his own
register ("give me a text to send the gc", "launch the campaigns"), so the held-out
recall gap on 2026-10-17 was texting-register prompts. This learns the word n-grams
(1 to 3 words) that, on the TRAIN split only, appear in at least --min-support prompts
labeled with one skill and in few prompts labeled anything else.

The output is a candidate list, printed with each phrase's train support and
precision. It is reviewed by hand before anything goes into
config/skill-route-phrases.json: names of people, clients and private projects are
cut there, because the shipped list runs for every user (tests/portable_code.sh).
The held-out split is never read here; it is only scored, once, by
tools/skill_route_eval.py.
"""
import argparse
import json
import os
import re
import sys

LABELS = os.path.expanduser("~/second-brain/systems/skill-route-eval.jsonl")
STOP = set("""a an the to of and or in on for is it i u me my we us our you your this that
be do did does so at with what how from are was im its as if just ok bro can get all
""".split())


def words(text):
    """Lowercased words of what a person typed: system-reminder blocks and paths removed,
    the same normalization the hook applies before matching."""
    text = re.sub(r"<system-reminder>.*?</system-reminder>", " ", text, flags=re.S)
    text = re.sub(r"\S*/\S*", " ", text.lower())
    return re.findall(r"[a-z0-9']+", text)


def grams(ws, top=3):
    out = set()
    for n in range(1, top + 1):
        for i in range(len(ws) - n + 1):
            g = tuple(ws[i:i + n])
            if all(w in STOP for w in g) or g[0] in STOP or g[-1] in STOP:
                continue
            out.add(" ".join(g))
    return out


def learn(rows, min_support, min_precision, kinds=("typed",)):
    # Typed prompts only by default: session briefs share pages of boilerplate, so on the
    # first run every brief phrase ("sessions outside the repo") scored as a gtm trigger.
    train = [(r["label"], grams(words(r["text"]))) for r in rows
             if r.get("split") == "train" and r.get("label") and r.get("kind", "typed") in kinds]
    seen = {}
    for label, gs in train:
        for g in gs:
            seen.setdefault(g, []).append(label)
    found = {}
    for g, labels in seen.items():
        for skill in set(labels) - {"NONE"}:
            support = labels.count(skill)
            precision = support / len(labels)
            if support >= min_support and precision >= min_precision:
                found.setdefault(skill, []).append((g, support, round(precision, 2)))
    # A longer phrase whose words contain a kept shorter one adds nothing.
    for skill, items in found.items():
        items.sort(key=lambda t: (len(t[0].split()), -t[1]))
        kept = []
        for g, s, p in items:
            if any(re.search(rf"\b{re.escape(k)}\b", g) for k, _s, _p in kept):
                continue
            kept.append((g, s, p))
        found[skill] = kept
    return found


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    lp = sub.add_parser("learn")
    lp.add_argument("--labels", default=LABELS)
    lp.add_argument("--min-support", type=int, default=2)
    lp.add_argument("--min-precision", type=float, default=0.75)
    lp.add_argument("--kinds", default="typed", help="comma list of row kinds to learn from")
    lp.add_argument("--out", help="write the candidates as JSON (holds fragments of prompts: keep private)")
    a = ap.parse_args(argv)
    with open(a.labels) as f:
        rows = [json.loads(line) for line in f if line.strip()]
    found = learn(rows, a.min_support, a.min_precision, tuple(a.kinds.split(",")))
    for skill in sorted(found):
        print(skill)
        for g, s, p in found[skill]:
            print(f"  {g!r:32} support {s}  train precision {p}")
    if a.out:
        with open(a.out, "w") as f:
            json.dump(found, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
