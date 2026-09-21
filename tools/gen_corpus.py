#!/usr/bin/env python3
"""Sample what an unguided LLM actually produces, so the slop prior is measured.

Every anti-slop linter in research/11 hand-wrote its rule list. This does not.
It draws N samples from the generator with no design guidance at all, and the
frequency of a feature in that sample IS the definition of typical.

    python3 tools/gen_corpus.py --samples 3 --workers 8

Writes corpus/slop/<brief>-<i>.html. Resumable: an existing non-empty file is
skipped, so an interrupted run continues where it stopped.
"""
import argparse
import concurrent.futures as cf
import pathlib
import shutil
import subprocess
import tempfile
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "corpus" / "slop"
# Generate from OUTSIDE the repo. Running inside it would load this repo's
# own CLAUDE.md, which is design guidance, and the prior would then measure
# the guidance instead of the default. That is the whole measurement lost.
MIN_BYTES = 2000  # a real page; 506 bytes was a chat summary that slipped through
NEUTRAL = "/private/tmp/claude-501/-Users-joelnewton/97f1fab6-2b4c-4ae0-bcd5-b8462babccdb/scratchpad/probe"

# Briefs a person would actually type. Deliberately plain: naming a style here
# would measure that style instead of the default.
BRIEFS = {
    "saas-landing":  "Build a landing page for a SaaS product that schedules social media posts.",
    "pricing":       "Build a pricing page with three tiers.",
    "dashboard":     "Build an analytics dashboard page showing key metrics and a chart.",
    "settings":      "Build an account settings page.",
    "signup":        "Build a signup page with email and password.",
    "data-table":    "Build a page showing a table of customer records with sorting and filtering.",
    "empty-state":   "Build an empty state for a projects list that has no projects yet.",
    "portfolio":     "Build a personal portfolio homepage for a software engineer.",
    "docs":          "Build a documentation page explaining how to install a CLI tool.",
    "checkout":      "Build a checkout page for an online store.",
    "blog-index":    "Build a blog index page listing recent articles.",
    "profile":       "Build a user profile page for a social app.",
}

PROMPT_SUFFIX = (
    " Write it as a single self-contained HTML file named index.html in the "
    "current directory. One file, inline CSS and JS, no dependencies. "
    "Make it look good."
)


def one(brief_key, brief_text, i, model):
    path = OUT / f"{brief_key}-{i}.html"
    if path.exists() and path.stat().st_size > MIN_BYTES:
        return (path.name, "skip", 0)
    t0 = time.time()
    # Its own empty directory per sample. Asked to "output an HTML file" the
    # model writes one to disk about half the time and prints a summary to
    # stdout instead, which cost 3 of the first 7 samples. Harvesting from
    # both places is more reliable than trying to forbid one of them.
    work = tempfile.mkdtemp(prefix="uxgen-")
    try:
        try:
            r = subprocess.run(
                ["claude", "-p", "--model", model, brief_text + PROMPT_SUFFIX],
                capture_output=True, text=True, timeout=900, cwd=work,
            )
        except subprocess.TimeoutExpired:
            return (path.name, "timeout", time.time() - t0)

        body = _harvest(r.stdout, pathlib.Path(work))
        if body is None:
            return (path.name, "no-html", time.time() - t0)
        if len(body) < MIN_BYTES:
            return (path.name, f"short({len(body)})", time.time() - t0)
        path.write_text(body)
        return (path.name, f"ok({len(body)}b)", time.time() - t0)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _harvest(stdout, work):
    """Take the HTML from stdout, or from whatever the model wrote to disk."""
    span = _html_span(stdout)
    if span:
        return span
    candidates = [f for f in work.rglob("*.htm*") if f.is_file()]
    if not candidates:
        return None
    best = max(candidates, key=lambda f: f.stat().st_size)
    return best.read_text(errors="ignore")


def _html_span(text):
    low = text.lower()
    lo = low.find("<!doctype")
    if lo < 0:
        lo = low.find("<html")
    hi = low.rfind("</html>")
    if lo >= 0 and hi > lo:
        return text[lo:hi + 7]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--model", default="sonnet")
    a = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [(k, v, i, a.model)
            for k, v in BRIEFS.items()
            for i in range(a.samples)]
    print(f"{len(jobs)} samples, {a.workers} at a time", flush=True)

    done = 0
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(one, *j) for j in jobs]
        for f in cf.as_completed(futs):
            name, status, dt = f.result()
            done += 1
            print(f"[{done}/{len(jobs)}] {name} {status} {dt:.0f}s", flush=True)

    n = len(list(OUT.glob("*.html")))
    print(f"corpus: {n} files in {OUT}")
    return 0 if n else 1


if __name__ == "__main__":
    sys.exit(main())
