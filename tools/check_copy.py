#!/usr/bin/env python3
"""Refuse copy lifted verbatim from the reference.

The standing rule on this build is to read their work to learn technique and
parameters, then write our own code, copy and artwork. The brand check covers
names, emails and marks. It does not cover SENTENCES, and on 2026-09-28 the
metrics panel turned out to carry five of their strings word for word:

    "Scoring every new trace against this failure mode"
    "Recurred 2m ago", "2 traces flagged", "all passing"
    "refund_policy_violations"

Those were copied while building from a screenshot and nothing was looking.

WHAT COUNTS AS LIFTED. A run of their rendered text, at least MIN_CHARS long,
appearing in our source. Short strings are excluded because a UI shares a
vocabulary and "Read the docs" is not plagiarism: two pages about the same
subject will both say "traces" and "latency". Identifiers that are genuinely
generic (a field name any such product would use) can be allowlisted by name,
with the reason, rather than by lowering the threshold for everything.

A BRAND SWAP IS STILL A LIFT. On 2026-10-03 three of the four feature
leads were their sentences with "Lemma" replaced by "Sift", and this check
passed them because it compared exact strings. Both sides are now compared
with the two brand names folded to one token, case and whitespace folded, and
a shared run of SHINGLE words counts as a hit even when the full sentence was
trimmed ("you'll know" against their "you'll know immediately").

Usage:  python3 tools/check_copy.py <reference-url>
"""
import sys, re, json, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_CHARS = 18
# Eight words in a row. The three brand-swapped leads shared 13, 9 and 14;
# the longest shared run between two unrelated product pages in this repo's
# own copy is a 4-word phrase ("every trace against your"), so 8 leaves room.
SHINGLE = 8
BRANDS = re.compile(r"\b(lemma|sift)\b", re.I)


def norm(s):
    s = BRANDS.sub("BRAND", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&nbsp;", " ").replace("&hellip;", "...").replace("\u2019", "'")
    return re.sub(r"\s+", " ", s).strip().lower()


def shingles(s, n=SHINGLE):
    w = re.findall(r"[a-z0-9_']+", s)
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def lifted(strings, src):
    """(string, path) for each of their strings found in our source."""
    texts = {path: norm(text) for path, text in src.items()}
    words = {path: " ".join(re.findall(r"[a-z0-9_']+", t)) for path, t in texts.items()}
    hits = []
    for s in sorted(strings, key=len, reverse=True):
        if len(s) < MIN_CHARS or s in ALLOW:
            continue
        ns = norm(s)
        for path in texts:
            if ns in texts[path] or any(sh in words[path] for sh in shingles(ns)):
                hits.append((s, path))
                break
    return hits

# Generic beyond any one product. Each needs a reason, not just a place on a
# list, because the easy way to make this check pass is to keep adding to it.
ALLOW = {
    # none yet; add with the reason inline when one is genuinely generic
}

SCRAPE = r"""() => {
  const out = new Set();
  for (const n of document.querySelectorAll('body *')) {
    if (n.children.length) continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.tagName)) continue;
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length >= 8) out.add(t);
  }
  return [...out];
}"""


def their_text(url):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.goto(url, wait_until="networkidle", timeout=120000)
        pg.wait_for_timeout(4500)
        seen = set(pg.evaluate(SCRAPE))
        h = pg.evaluate("document.documentElement.scrollHeight"); y = 0
        while y < h:
            pg.evaluate(f"window.scrollTo(0,{y})"); pg.wait_for_timeout(120)
            seen |= set(pg.evaluate(SCRAPE))
            h = pg.evaluate("document.documentElement.scrollHeight"); y += 500
        b.close()
    return seen


def ours():
    files = []
    for pat in ("index.html", "src/**/*.js", "src/**/*.css"):
        files += list(ROOT.glob(pat))
    return {f: f.read_text() for f in files}


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.uselemma.ai/"
    cache = ROOT / "docs" / "their-strings.json"
    if "--cached" in sys.argv and cache.exists():
        strings = set(json.loads(cache.read_text()))
    else:
        strings = their_text(url)
        cache.write_text(json.dumps(sorted(strings), indent=1))
    src = {str(p.relative_to(ROOT)): text for p, text in ours().items()}
    hits = lifted(strings, src)
    if hits:
        print(f"copy check FAILED: {len(hits)} string(s) lifted verbatim "
              f"(>= {MIN_CHARS} chars)\n")
        for s, where in hits:
            print(f"  {where}\n    {s!r}\n")
        print("Rewrite these in our own words. Adding them to ALLOW needs a "
              "reason that survives someone asking.")
        sys.exit(1)
    print(f"copy check: clean ({len(strings)} of their strings checked, "
          f"threshold {MIN_CHARS} chars)")
