#!/usr/bin/env python3
"""Write doc2query questions for every file of a frozen index, resumable.

    BRAIN_INDEX=/frozen/.brain python3 bench/d2q_build.py

The cache is $BRAIN_INDEX/bench-cache/d2q.json, keyed by brain_d2q.key(text),
so a rerun only asks for notes it has not seen. It holds note-derived text, so
it stays beside the frozen index and never in this repo.
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "src"))
import brain      # noqa: E402
import d2q as brain_d2q  # noqa: E402  (bench/d2q.py)

IDX = os.environ.get("BRAIN_INDEX", os.path.expanduser("~/second-brain/.brain"))


def main():
    db = brain.open_read(os.path.join(IDX, "index.db"))
    files = sorted({r[0] for r in db.execute("SELECT file FROM chunk")})
    path = os.path.join(IDX, "bench-cache", "d2q.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cache = json.load(open(path)) if os.path.exists(path) else {}
    t0, done = time.time(), 0
    for i, f in enumerate(files):
        p = os.path.expanduser(f) if f.startswith("~") else os.path.join(brain.BRAIN, f)
        try:
            text = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        k = brain_d2q.key(text)
        if k in cache:
            continue
        cache[k] = {"file": f, "q": brain_d2q.generate(text)}
        done += 1
        if done % 20 == 0:
            tmp = path + ".tmp"
            json.dump(cache, open(tmp, "w")); os.replace(tmp, path)
            print(f"{i + 1}/{len(files)}  {done} new  {(time.time() - t0) / done:.1f}s each", flush=True)
    tmp = path + ".tmp"
    json.dump(cache, open(tmp, "w")); os.replace(tmp, path)
    empty = sum(1 for v in cache.values() if not v["q"])
    print(f"done: {len(cache)} notes, {empty} with no questions, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
