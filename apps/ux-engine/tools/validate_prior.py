#!/usr/bin/env python3
"""Does the learned prior actually separate anything? Held-out AUC, HTML only.

    python3 tools/validate_prior.py runs/*/one-voltage.html runs/*/editorial.html

The prior is trained on design-system YAML against generated HTML, so it could
be separating file formats rather than design choices. That would produce a
confident number and mean nothing.

So this only ever compares HTML to HTML: stance-guided pages against unguided
corpus pages. Format is constant, and any separation left is about the design
tokens themselves.

AUC is the probability a randomly chosen guided page outranks a randomly chosen
unguided one. 0.5 is a coin flip and means the prior is worthless. Reported
with n, because an AUC from three samples is not evidence and the number should
carry its own warning.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin"))
sys.path.insert(0, str(ROOT / "tools"))
import importlib.machinery
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "uxslop", ROOT / "bin" / "ux-slop",
    # Same bug as bin/ux-boden: bin/ tools are extensionless on purpose, and
    # spec_from_file_location infers its loader from the extension, so without
    # this it returns None and the next line dies on NoneType.loader.
    loader=importlib.machinery.SourceFileLoader("uxslop", str(ROOT / "bin" / "ux-slop")),
)
uxslop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uxslop)


def auc(pos, neg):
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def main():
    guided_paths = [pathlib.Path(p) for p in sys.argv[1:]]
    if not guided_paths:
        guided_paths = sorted(ROOT.glob("runs/*/*.html"))
    unguided_paths = sorted(ROOT.glob("corpus/slop/*.html"))
    if not guided_paths:
        print("no guided pages. Run bin/ux-gen first.", file=sys.stderr)
        return 1

    prior = uxslop.load_prior()
    pos, neg = [], []
    for p in guided_paths:
        s, _, _ = uxslop.score(p, prior)
        if s is not None:
            pos.append(s)
    for p in unguided_paths:
        s, _, _ = uxslop.score(p, prior)
        if s is not None:
            neg.append(s)

    a = auc(pos, neg)
    print(f"guided (stance-constrained) n={len(pos)}   "
          f"mean {sum(pos)/len(pos):+.3f}" if pos else "no guided scores")
    print(f"unguided (corpus)           n={len(neg)}   "
          f"mean {sum(neg)/len(neg):+.3f}" if neg else "no unguided scores")
    if a is None:
        return 1
    print(f"\nAUC {a:.3f}   (0.5 = worthless)")
    if min(len(pos), len(neg)) < 10:
        print(f"n is {min(len(pos), len(neg))} on the smaller side. "
              f"This is a direction, not a result.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
