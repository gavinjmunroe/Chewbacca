#!/usr/bin/env python3
"""Draw stimuli, conventions or mechanisms with a real random source.

    draw.py stimuli 10        8-12 non-web artifacts across categories
    draw.py conventions 6     arbitrary web conventions to invert
    draw.py mechanisms 4      distant-domain principles to collide with
    draw.py functional        every functional convention (never drawn, always kept)
    draw.py stimuli 10 --used run/used.txt   skip and record earlier draws

Why a script draws instead of the model: a model asked for a random object
picks from its own mode, the same few "random" things every time (the
Artificial Hivemind and NoveltyBench results). The pick has to come from
outside the model or the stimulus does no work.
"""
import argparse
import csv
import pathlib
import random
import sys

REFS = pathlib.Path(__file__).resolve().parent.parent / "references"
RNG = random.SystemRandom()

# danium/lateral-thinking random-stimulus minimums (MIT): five distinct
# categories, at least two concrete objects and one abstraction, no two from
# the same category side by side. Its author reports pure-abstract batches
# feel intellectualized and pure-concrete ones mundane.
MIN_CATEGORIES = 5
MIN_CONCRETE = 2
MIN_ABSTRACT = 1


def rows(name):
    with open(REFS / f"{name}.tsv", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def read_used(path):
    if path and path.exists():
        return set(path.read_text().splitlines())
    return set()


def record_used(path, picked):
    if path:
        with open(path, "a") as f:
            f.writelines(p + "\n" for p in picked)


def spread(batch):
    """Order the batch so no two neighbours share a category.

    Always place the category with the most left, never the one just placed.
    That cannot fail while no category holds more than half the batch. A
    random reshuffle could: on 2026-10-14 a batch with six of ten from
    nature-physics gave up after 500 shuffles and shipped neighbours anyway.
    """
    groups = {}
    for r in batch:
        groups.setdefault(r["category"], []).append(r)
    out, prev = [], None
    while groups:
        options = [c for c in groups if c != prev]
        most = max(len(groups[c]) for c in options)
        prev = RNG.choice([c for c in options if len(groups[c]) == most])
        out.append(groups[prev].pop())
        if not groups[prev]:
            del groups[prev]
    return out


def draw_stimuli(n, used):
    pool = [r for r in rows("stimuli") if r["stimulus"] not in used]
    if n > len(pool):
        sys.exit(f"draw: only {len(pool)} unused stimuli left; start a new used file or add stimuli")
    for _ in range(500):
        batch = RNG.sample(pool, n)
        cats = [r["category"] for r in batch]
        kinds = [r["kind"] for r in batch]
        if (len(set(cats)) >= min(MIN_CATEGORIES, n)
                and max(cats.count(c) for c in cats) <= (n + 1) // 2
                and kinds.count("concrete") >= MIN_CONCRETE
                and kinds.count("abstract") >= MIN_ABSTRACT):
            break
    else:
        sys.exit("draw: pool too small for the category minimums; add stimuli")
    batch = spread(batch)
    return [f'{r["stimulus"]}\t{r["category"]}\t{r["kind"]}' for r in batch], \
        [r["stimulus"] for r in batch]


def check_pool(pool, n, what):
    if n > len(pool):
        sys.exit(f"draw: only {len(pool)} unused {what} left; start a new used file or add more")
    return n


def draw(what, n, used):
    """Return (lines to show the model, keys to record as used)."""
    n = n or {"stimuli": 10, "conventions": 6, "mechanisms": 4}[what]
    if what == "stimuli" and n < MIN_CONCRETE + MIN_ABSTRACT:
        sys.exit(f"draw: stimuli needs at least {MIN_CONCRETE + MIN_ABSTRACT} to meet the concrete and abstract minimums")
    if what == "stimuli":
        return draw_stimuli(n, used)
    if what == "conventions":
        pool = [r for r in rows("conventions")
                if r["kind"] == "arbitrary" and r["id"] not in used]
        picked = RNG.sample(pool, check_pool(pool, n, "conventions"))
        return [f'{r["id"]}\t{r["convention"]}' for r in picked], [r["id"] for r in picked]
    pool = [r for r in rows("mechanisms") if r["domain"] not in used]
    picked = RNG.sample(pool, check_pool(pool, n, "mechanisms"))
    return ([f'{r["domain"]}\t{r["active principle"]}\t{r["bridging question"]}' for r in picked],
            [r["domain"] for r in picked])


def functional():
    return [f'{r["id"]}\t{r["convention"]}' for r in rows("conventions") if r["kind"] == "functional"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["stimuli", "conventions", "mechanisms", "functional"])
    ap.add_argument("n", nargs="?", type=int, default=0)
    ap.add_argument("--used", type=pathlib.Path)
    a = ap.parse_args()
    if a.what == "functional":
        print("\n".join(functional()))
        return
    lines, keys = draw(a.what, a.n, read_used(a.used))
    record_used(a.used, keys)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
