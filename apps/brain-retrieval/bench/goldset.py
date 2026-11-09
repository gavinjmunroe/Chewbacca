"""Where the benchmark's question sets live.

The gold sets are written against one person's brain, so their questions and
answer paths are that person's private notes. They stay in the brain itself
(~/second-brain/.bench/brain-retrieval/), never in this repo: on 2026-10-09 they
rode into Chewbacca with this folder and named health and relationship notes
to every collaborator. Set BRAIN_BENCH_DIR to point at another brain's sets.
"""
import json
import os

DIR = os.environ.get("BRAIN_BENCH_DIR",
                     os.path.expanduser("~/second-brain/.bench/brain-retrieval"))


def load(name):
    path = os.path.join(DIR, name)
    if not os.path.exists(path):
        raise SystemExit(f"no gold set at {path}. Write one for your own brain "
                         f"(see README) or set BRAIN_BENCH_DIR.")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
