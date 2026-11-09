#!/usr/bin/env python3
"""brain's second-stage rerank reorders by the model's pick and never stalls.

A fake `claude` stands in for the model, so nothing leaves the machine and no
quota is spent. It checks the parts that break silently: a reply with a prayer
line or code fence before the JSON still parses, ids out of range are dropped,
a slow model falls back to stage one's order inside the budget, a broken reply
falls back, a cached ranking spends no second call, and the cache never holds
the prompt text (brain notes are private).

Hermetic: synthetic rows and scores, a temp cache, no index, no Ollama.
"""
import importlib.util, json, os, stat, sys, tempfile, time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "apps", "brain-retrieval", "src")
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"  FAIL {name}  {detail}")


FAKE = r"""#!/usr/bin/env python3
import json, os, sys, time
prompt = sys.stdin.read()
with open(os.environ["FAKE_LOG"], "a") as fh: fh.write("call\n")
mode = os.environ.get("FAKE_MODE", "ok")
if mode == "slow": time.sleep(5)
if mode == "fail": sys.exit(3)
body = {"ok": "Lord, guide this search. Amen.\n```json\n{\"ranking\": [3, 99, \"1\", 3]}\n```",
        "slow": "{\"ranking\": [3]}",
        "bad": "I cannot rank these."}[mode]
print(json.dumps({"type": "result", "is_error": False, "result": body}))
"""


def main():
    tmp = tempfile.mkdtemp()
    fake = os.path.join(tmp, "claude")
    with open(fake, "w") as fh:
        fh.write(FAKE)
    os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)
    log = os.path.join(tmp, "calls")
    os.environ.update(BRAIN_RERANK_CLAUDE=fake, BRAIN_RERANK_CACHE=os.path.join(tmp, "cache"),
                      FAKE_LOG=log)
    sys.path.insert(0, SRC)
    spec = importlib.util.spec_from_file_location("rerank_under_test", os.path.join(SRC, "rerank.py"))
    rr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rr)

    names = ["memory/a.md", "memory/b.md", "memory/c.md", "memory/d.md"]
    secret = "the private sentence that must not be cached"
    rows = [(i + 1, f, "", f"{secret} {f}", i) for i, f in enumerate(names)]
    dense = np.asarray([0.9, 0.8, 0.7, 0.6], dtype="float32")
    calls = lambda: open(log).read().count("call") if os.path.exists(log) else 0

    os.environ["FAKE_MODE"] = "ok"
    r = rr.rerank("which note answers this", names, rows, dense, n=4, timeout=10)
    check("model's pick goes first, prayer line and fence skipped, bad ids dropped",
          r.ok and r.files == ["memory/c.md", "memory/a.md", "memory/b.md", "memory/d.md"], str(r))
    check("one model call", calls() == 1, str(calls()))

    r2 = rr.rerank("which note answers this", names, rows, dense, n=4, timeout=10)
    check("a repeat question is served from cache with no call", r2.cached and calls() == 1
          and r2.files == r.files, str(r2))
    blob = ""
    for d, _, fs in os.walk(os.environ["BRAIN_RERANK_CACHE"]):
        for f in fs:
            blob += open(os.path.join(d, f)).read()
    check("cache holds the ranking, never the note text or the question",
          blob and secret not in blob and "which note" not in blob, blob[:200])

    os.environ["FAKE_MODE"] = "slow"
    t = time.time()
    r = rr.rerank("a slow question", names, rows, dense, n=4, timeout=1.0)
    took = time.time() - t
    check("a slow model falls back to stage one inside the budget",
          not r.ok and r.files == names and took < 3.0, f"{r} {took:.1f}s")

    os.environ["FAKE_MODE"] = "bad"
    r = rr.rerank("a question with a broken reply", names, rows, dense, n=4, timeout=10)
    check("a reply with no JSON falls back to stage one", not r.ok and r.files == names, str(r))

    os.environ["FAKE_MODE"] = "fail"
    r = rr.rerank("a question the CLI fails on", names, rows, dense, n=4, timeout=10)
    check("a failing CLI falls back to stage one", not r.ok and r.files == names, str(r))

    os.environ["BRAIN_RERANK_CLAUDE"] = os.path.join(tmp, "missing")
    spec.loader.exec_module(rr)
    r = rr.rerank("no cli at all", names, rows, dense, n=4, timeout=10)
    check("no claude CLI falls back to stage one", not r.ok and r.files == names, str(r))

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
