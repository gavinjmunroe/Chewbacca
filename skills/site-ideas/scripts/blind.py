#!/usr/bin/env python3
"""Build the blind pick sheet: survivors and baseline, equal arms, shuffled, one format.

    blind.py RUN --keep RUN/keep.tsv                 cards, key and condense prompt
    blind.py RUN --keep RUN/keep.tsv --sheet OUT.md  also condense headless and write the sheet
    blind.py RUN --keep RUN/keep.tsv --new           throw the old key away and deal again

A second call reuses RUN/blind/KEY.json and its prompt, so a retried condense
or a second reader's sheet keeps the same letters. Picks already written
against a key are only valid against that key: --new is for a new filter.

keep.tsv is one surviving lane direction per line: lane<TAB>name, names as
they appear in RUN/out/<lane>.md. Every baseline concept goes in.

Why each step:
- Equal arms. With 8 survivors and 10 baseline cards, a reader with no
  preference puts 3 or more baseline cards in a top five 62% of the time, so
  the test says nothing. At 8 and 8, a no-preference reader splits 4-of-5 or
  better toward the lanes 14% of the time and toward the baseline another 14%
  (616 of 4368 each way). The larger arm is cut at random, never by choice.
- At most 13 a side: one letter per card, and a 26-card sheet is already more
  than a reader holds in mind.
- The Move line goes. It names the draw (a wedding suite, a field guide), and
  that alone tells a reader which arm a card came from.
- One headless rewrite of every card, blind to the arm, to the same five
  lines. On 2026-10-14 that brought 21 cards to 89 to 112 words each, and it
  is what showed three survivors to be baseline structures in new words.
- The key stays in RUN/blind/KEY.json. The sheet never names a lane.
"""
import argparse
import json
import pathlib
import random
import re
import subprocess
import sys
import tempfile

RNG = random.SystemRandom()
CONDENSE = """Below are {n} website concepts for one client. Rewrite every one into exactly this format, in the same order, keeping its letter:

### <letter>. <a plain name, 3 to 6 words, that says what the site is>
- What it is: <one sentence>
- First ten seconds: <one sentence>
- Main action: <one sentence>
- Needs from the client: <one short line>
- Will not: <one short line>

Rules. Every line 25 words or fewer. Give every concept the same length and the same care. Use only what its card says: add nothing, improve nothing, judge nothing, rank nothing. Plain names only, no wordplay. No em dashes, no emojis, no bold. Output only the {n} rewritten concepts.

"""


def sections(path):
    out = {}
    for sec in re.split(r"^## ", path.read_text(), flags=re.M)[1:]:
        title, _, body = sec.partition("\n")
        name = re.sub(r"^\d+\.\s*", "", re.sub(r"\s*\(p=.*?\)\s*$", "", title)).strip()
        out[name] = body.split("\n---")[0].strip()
    return out


# Bold or plain, bulleted or not: "- **Move:**", "**Move:**", "- Move:".
FIELD = r"^(?:- )?(?:\*\*)?{}:?(?:\*\*)?:?"


def strip_move(body):
    return re.sub(FIELD.format("Move") + r".*?(?=" + FIELD.format("First ten seconds") + ")",
                  "", body, flags=re.S | re.M)


def refusals(text):
    # "No x, no y, no z" reads as a negation stack; the sheet lists them instead.
    def fix(m):
        items = re.split(r",\s+no\s+", m.group(1))
        items[0] = re.sub(r"^No\s+", "", items[0])
        return "- Will not: " + "; ".join(i.rstrip(".") for i in items) + "."
    return re.sub(r"^- Will not: (.*)$", fix, text, flags=re.M)


SHEET_HEAD = """# Site ideas: blind pick

{n} ways the site could work. Half came from the idea lanes and half from a plain prompt. They're shuffled and rewritten to the same length, so the source doesn't show.

Pick your top five and write one line on why for each. Judge what the site is and how it gets the main action done, not the wording.

Don't open the key ({key}) until you've picked.

"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", type=pathlib.Path)
    ap.add_argument("--keep", type=pathlib.Path, required=True)
    ap.add_argument("--sheet", type=pathlib.Path)
    ap.add_argument("--model", default="opus")
    ap.add_argument("--new", action="store_true", help="discard the existing key and deal again")
    a = ap.parse_args()
    out = a.run / "blind"
    if (out / "KEY.json").exists() and not a.new:
        cards = json.loads((out / "KEY.json").read_text())["cards"]
        prompt = (out / "condense-prompt.txt").read_text()
        print(f"reusing the key in {out}/KEY.json ({len(cards)} cards); --new deals again")
    else:
        cards, prompt = deal(a, out)
    if a.sheet:
        sheet(a, out, cards, prompt)


def deal(a, out):
    lane, cache = [], {}
    for line in a.keep.read_text().splitlines():
        if not line.strip():
            continue
        name_lane, name = line.split("\t", 1)
        if name_lane not in cache:
            cache[name_lane] = sections(a.run / f"out/{name_lane}.md")
        if name not in cache[name_lane]:
            sys.exit(f"blind: no '{name}' in out/{name_lane}.md")
        lane.append({"arm": "lane", "lane": name_lane, "name": name, "body": cache[name_lane][name]})
    base = [{"arm": "baseline", "lane": "baseline", "name": n, "body": b}
            for n, b in sections(a.run / "out/baseline.md").items()]
    k = min(len(lane), len(base), 13)
    every = lane + base
    cards = RNG.sample(lane, k) + RNG.sample(base, k)
    kept = {id(c) for c in cards}
    dropped = [f'{c["lane"]}: {c["name"]}' for c in every if id(c) not in kept]
    RNG.shuffle(cards)
    for i, c in enumerate(cards):
        c["letter"] = chr(65 + i)
        c["body"] = strip_move(c["body"])
    out.mkdir(exist_ok=True)
    (out / "KEY.json").write_text(json.dumps({
        "cards": [{x: c[x] for x in ("letter", "arm", "lane", "name")} for c in cards],
        "dropped_at_random": dropped}, indent=1))
    prompt = CONDENSE.format(n=len(cards)) + "\n\n".join(f"=== {c['letter']} ===\n{c['body']}" for c in cards)
    (out / "condense-prompt.txt").write_text(prompt)
    print(f"{k} lane and {k} baseline cards; dropped at random: {dropped or 'none'}")
    return cards, prompt


def sheet(a, out, cards, prompt):
    with tempfile.TemporaryDirectory() as empty:
        r = subprocess.run(["claude", "-p", "--restricted", "--model", a.model], input=prompt,
                           capture_output=True, text=True, cwd=empty, timeout=1200)
    got = len(re.findall(r"^### [A-Z]\.", r.stdout, re.M))
    if r.returncode or got != len(cards):
        sys.exit(f"blind: condense returned {got} of {len(cards)} cards (exit {r.returncode})")
    (out / "condensed.md").write_text(r.stdout)
    a.sheet.write_text(SHEET_HEAD.format(n=len(cards), key=out / "KEY.json")
                       + refusals(re.sub(r"^(- .*)$", r"\1\n", r.stdout.strip(), flags=re.M))
                       + "\n\n## Top five\n\n" + "\n\n".join(f"{i}. Letter:   Why:" for i in range(1, 6)) + "\n")
    print(f"sheet: {a.sheet}")


if __name__ == "__main__":
    main()
