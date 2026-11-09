#!/usr/bin/env python3
"""doc2query for brain: a local model writes the questions each note answers.

TRIED 2026-10-12, NOT SHIPPED. Measured against the shipped rrf3 + feedback on
dev+dev2+dev3: as a fourth RRF list it gained nothing on dev3 (+2 -2 at w=0.3,
+7 -7 at w=0.7) and lost on dev2; merged into the best-chunk list it changed
nothing. It does about what feedback does (+4 on dev3 with feedback off) and
the two do not stack. Kept in bench/ so the table in TODO.md reproduces.

WHY, 2026-10-12. The sealed misses are questions worded unlike their note. A
dev set written to reproduce that (dev3: 43 of 70 questions share no word with
the note's name or description) scored 44.3% under the shipped ranker against
47.7% sealed, and in 18 of its 39 misses the gold note sat below rank 50: no
fusion or reorder reaches a file the embedding never put near the question.
So each note gets a few questions in everyday words, written once at index
time by a model on this Mac, and the question vectors vote for their note.

Local only: the note goes to Ollama on loopback (brain.ollama_url()), never
off the machine. A missing model or a failed call yields no questions, and
rank() works exactly as before for that note.
"""
import json, os, re, sys, urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))
import brain  # noqa: E402

MODEL = os.environ.get("BRAIN_D2Q_MODEL", "llama3.2:latest")
# 4,000 characters is ~1,000 tokens of prompt. Measured 2026-10-12 at load 5 on
# this Mac: a 378-token prompt plus 92 generated tokens took 4.6 s warm with
# llama3.2 3B. Longer notes get questions from their opening only; their later
# sections still win through best-chunk fusion in rank().
MAX_CHARS = 4000
N_QUESTIONS = 5
VERSION = "d2q-1"   # part of the cache key: change it when the prompt changes

PROMPT = ("Here is a note from someone's personal notes.\n\n{note}\n\n"
          "Write {n} different questions this note answers, the way the person might ask an "
          "assistant months later after forgetting the note's wording. Use everyday words, "
          "not the note's own terms. One per line, no numbering.")


def generate(text, timeout=120):
    """Up to N_QUESTIONS questions for one note, or [] on any failure."""
    _, body = brain.frontmatter(text)
    prompt = PROMPT.format(note=brain.clean(text)[:MAX_CHARS] if body.strip() else "", n=N_QUESTIONS)
    try:
        req = urllib.request.Request(brain.OLLAMA + "/api/generate", data=json.dumps({
            "model": MODEL, "prompt": prompt, "stream": False, "keep_alive": "10m",
            "options": {"num_predict": 200, "temperature": 0}}).encode(),
            headers={"Content-Type": "application/json"})
        out = json.loads(urllib.request.urlopen(req, timeout=timeout).read()).get("response", "")
    except Exception:
        return []
    return parse(out)


def parse(out):
    qs = []
    for line in out.splitlines():
        line = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip().strip('"')
        if line.endswith("?") and 3 <= len(line.split()) <= 40:
            qs.append(line)
    return qs[:N_QUESTIONS]


def key(text):
    return VERSION + ":" + brain.sha(text)
