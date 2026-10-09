#!/usr/bin/env python3
"""Learn which design choices separate a real system from unguided LLM output.

    python3 tools/build_prior.py            # writes data/prior.json

Every anti-slop linter in research/11 hand-wrote its rules, and so did ours:
30 regexes asserting that indigo-600 is a tell. This asserts nothing. It counts
how often each design token appears in 74 real design systems and how often the
same token appears in unguided generations, and keeps the log ratio.

    weight(f) = log P(f | real system) - log P(f | unguided output)

A token common in real systems and rare in generated ones scores positive. One
common in generated output and rare in real systems scores negative. A token
rare in both scores near zero, which is the property that matters: it means
being weird earns nothing. Pure novelty scoring rewards random hex values, and
random is not good design. Only choices that real systems actually make count.

This is a naive-Bayes log-odds discriminator, and it is mechanical on purpose.
research/13: reward models overweight typical outputs at alpha-hat 0.57, so any
model asked to rank designs prefers the median one. A counter cannot.

THE CONFOUND, STATED. The two corpora are different file types: design systems
are token YAML, generations are HTML. Some of the separation is format, not
taste. So the absolute score is not meaningful and this never reports one.
What is meaningful is RANKING HTML PAGES AGAINST EACH OTHER, where format is
held constant. tools/validate_prior.py tests exactly that and nothing else.
"""
import collections
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import tokens as tk  # noqa: E402

ALPHA = 0.5  # Jeffreys prior, so a token seen in one corpus only stays finite


def collect(paths, kind):
    df = collections.Counter()
    n = 0
    for p in paths:
        try:
            feats = tk.features(p.read_text(errors="ignore"), kind)
        except Exception as e:                      # noqa: BLE001
            print(f"  skip {p.name}: {e}", file=sys.stderr)
            continue
        if not feats:
            continue
        n += 1
        df.update(feats)
    return df, n


def main():
    sysfiles = sorted(ROOT.glob("systems/*/DESIGN.md"))
    slopfiles = sorted(ROOT.glob("corpus/slop/*.html"))
    if not sysfiles:
        print("no systems/*/DESIGN.md", file=sys.stderr)
        return 1
    if len(slopfiles) < 10:
        print(f"only {len(slopfiles)} corpus samples; run tools/gen_corpus.py first",
              file=sys.stderr)
        return 1

    craft_df, n_craft = collect(sysfiles, "design")
    slop_df, n_slop = collect(slopfiles, "html")
    print(f"{n_craft} design systems, {n_slop} unguided generations")

    vocab = set(craft_df) | set(slop_df)
    weights = {}
    for f in vocab:
        p_craft = (craft_df[f] + ALPHA) / (n_craft + 2 * ALPHA)
        p_slop = (slop_df[f] + ALPHA) / (n_slop + 2 * ALPHA)
        weights[f] = {
            "w": round(math.log(p_craft) - math.log(p_slop), 4),
            "craft": craft_df[f], "slop": slop_df[f],
        }

    out = {
        "n_craft": n_craft, "n_slop": n_slop, "alpha": ALPHA,
        "note": "w = log P(f|real system) - log P(f|unguided). Rank HTML "
                "against HTML only; the corpora are different file types and "
                "some separation is format, not taste.",
        "weights": weights,
    }
    dest = ROOT / "data" / "prior.json"
    dest.write_text(json.dumps(out, indent=2, sort_keys=True))
    print(f"wrote {dest}  ({len(weights)} tokens)")

    ranked = sorted(weights.items(), key=lambda kv: kv[1]["w"])
    print("\nMOST GENERATED-LOOKING (common in output, rare in real systems)")
    for f, d in ranked[:10]:
        print(f"  {d['w']:+7.2f}  {f:<18} real {d['craft']:>3}/{n_craft}  "
              f"gen {d['slop']:>3}/{n_slop}")
    print("\nMOST SYSTEM-LIKE (real systems make this choice, generators do not)")
    for f, d in ranked[-10:][::-1]:
        print(f"  {d['w']:+7.2f}  {f:<18} real {d['craft']:>3}/{n_craft}  "
              f"gen {d['slop']:>3}/{n_slop}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
