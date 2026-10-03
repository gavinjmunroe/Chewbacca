"""Search the second brain fast enough to answer while someone is still talking.

`call-listen` asks it one question per sentence the other side finishes, with a
budget of a few hundred milliseconds, so this is BM25 over paragraph chunks in
plain Python: no embeddings, no network, no index server. The index is built
once per process.

Measured 2026-10-02 on a 1,321-file, 18 MB brain: see `build` for the numbers.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

# Folders that are somebody else's words or bulk data, not the person's
# context. `sources/` holds third-party repos copied in for research, and one
# CHANGELOG in there was the largest markdown file in the brain.
SKIP_DIRS = {".git", "node_modules", "__pycache__", "sources", "professional-contacts", "transcripts"}
# One chunk is roughly one paragraph group: big enough to carry a fact and its
# reason, small enough that four of them fit a prompt that has to answer in
# about a second.
CHUNK_CHARS = 1200
MAX_FILE_BYTES = 400_000
# The person's own standing notes outrank research digests on a tie.
BOOST = {"memory": 1.4, "": 1.5, "calls": 1.3}

WORD = re.compile(r"[a-z0-9$][a-z0-9$'.-]*[a-z0-9]|[a-z0-9]")
STOP = set(
    "a an the and or but if of to in on at by for with from as is are was were be been "
    "it its this that these those i you he she they we me him her them us my your our "
    "their his not no do does did so than then there here what which who whom how why "
    "when where can could would should will just about into over also very really "
    "yeah okay ok like um uh gonna wanna got get have has had".split()
)


def words(text: str) -> list[str]:
    return [w.strip(".'") for w in WORD.findall(text.lower()) if w not in STOP]


def plain(text: str) -> str:
    """Lowercase words with punctuation and apostrophes gone: "What's this?" -> "whats this"."""
    return " ".join(re.findall(r"[a-z0-9$]+", text.lower().replace("'", "").replace("\u2019", "")))


# A playbook card lists what a prospect literally says, in quotes, on a line
# starting "They say:". Those quotes are matched against the sentence just
# heard before any BM25, because the moments that need a cue fastest are made
# of stop words: "who is this and what is this about" had no searchable word
# at all and returned nothing on 2026-10-02.
# "Also heard:" carries generated paraphrases of the same moment.
SAYS = re.compile(r"^(?:They say|Also heard):(.*)$", re.M)


@dataclass
class Chunk:
    path: str
    heading: str
    text: str
    boost: float


def chunks_of(path: Path, root: Path) -> list[Chunk]:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    rel = str(path.relative_to(root))
    top = rel.split("/", 1)[0] if "/" in rel else ""
    boost = BOOST.get(top, 1.0)
    # Front matter is metadata; the description line inside it is worth
    # keeping because it says what the file is about in one sentence.
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end != -1:
            meta = raw[3:end]
            found = re.search(r"^description:\s*(.+)$", meta, re.M)
            raw = (found.group(1).strip('"') + "\n\n" if found else "") + raw[end + 4:]
    out: list[Chunk] = []
    heading = ""
    buffer: list[str] = []
    size = 0

    def flush() -> None:
        nonlocal buffer, size
        text = "\n\n".join(buffer).strip()
        if text:
            out.append(Chunk(rel, heading, text, boost))
        buffer, size = [], 0

    for block in re.split(r"\n\s*\n", raw):
        block = block.strip()
        if not block:
            continue
        if block.startswith("#"):
            flush()
            heading = block.splitlines()[0].lstrip("#").strip()
            rest = "\n".join(block.splitlines()[1:]).strip()
            if not rest:
                continue
            block = rest
        if size + len(block) > CHUNK_CHARS and buffer:
            flush()
        buffer.append(block[: CHUNK_CHARS * 2])
        size += len(block)
    flush()
    return out


class Bank:
    """BM25 over every chunk of every markdown file under a root."""

    K1 = 1.4
    B = 0.75

    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        # (words of a quoted phrasing, chunk index), from every "They say:" line.
        self.phrasings: list[tuple[tuple[str, ...], int]] = []
        for i, c in enumerate(chunks):
            for line in SAYS.findall(c.text):
                for quote in re.findall(r'"([^"]+)"', line):
                    said = tuple(plain(quote).split())
                    if len(said) >= 2:
                        self.phrasings.append((said, i))
        self.terms = [Counter(words(c.heading + " " + c.path + " " + c.text)) for c in chunks]
        self.lengths = [sum(t.values()) for t in self.terms]
        self.average = (sum(self.lengths) / len(self.lengths)) if self.lengths else 1.0
        df: Counter[str] = Counter()
        for t in self.terms:
            df.update(t.keys())
        n = len(chunks)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}
        self.postings: dict[str, list[int]] = {}
        for i, t in enumerate(self.terms):
            for w in t:
                self.postings.setdefault(w, []).append(i)

    @classmethod
    def build(cls, root: Path) -> "Bank":
        root = root.expanduser().resolve()
        found: list[Chunk] = []
        for path in sorted(root.rglob("*.md")):
            parts = set(path.relative_to(root).parts[:-1])
            if parts & SKIP_DIRS:
                continue
            try:
                if path.stat().st_size > MAX_FILE_BYTES:
                    continue
            except OSError:
                continue
            found.extend(chunks_of(path, root))
        return cls(found)

    def heard(self, sentence: str, k: int = 2) -> list[int]:
        """Chunks whose "They say:" phrasings occur in `sentence`, longest match first.

        A phrasing matches when its words appear in order and unbroken in the
        sentence, or, for phrasings of three words or more, when every one of
        its words is in the sentence ("what exactly do you guys do" against
        "what do you guys do").
        """
        said = plain(sentence).split()
        if not said:
            return []
        joined = " " + " ".join(said) + " "
        present = set(said)
        best: dict[int, int] = {}
        for phrasing, i in self.phrasings:
            exact = (" " + " ".join(phrasing) + " ") in joined
            loose = len(set(phrasing)) >= 3 and set(phrasing) <= present
            if exact or loose:
                score = len(phrasing) * (2 if exact else 1)
                if score > best.get(i, 0):
                    best[i] = score
        return sorted(best, key=lambda i: best[i], reverse=True)[:k]

    def search(self, query: str, k: int = 4, said: str | None = None) -> list[Chunk]:
        """BM25 over `query`; with `said`, cards whose phrasings it contains come first."""
        first = self.heard(said) if said else []
        q = set(words(query))
        scores: dict[int, float] = {}
        for w in q:
            idf = self.idf.get(w)
            if idf is None:
                continue
            for i in self.postings[w]:
                tf = self.terms[i][w]
                norm = tf * (self.K1 + 1) / (tf + self.K1 * (1 - self.B + self.B * self.lengths[i] / self.average))
                scores[i] = scores.get(i, 0.0) + idf * norm
        ranked = sorted(scores, key=lambda i: scores[i] * self.chunks[i].boost, reverse=True)
        picked: list[Chunk] = [self.chunks[i] for i in first]
        seen_paths: Counter[str] = Counter()
        for i in ranked:
            if i in first:
                continue
            chunk = self.chunks[i]
            # Two chunks from one file at most, so one long note cannot
            # crowd out everything else that matched.
            if seen_paths[chunk.path] >= 2:
                continue
            seen_paths[chunk.path] += 1
            picked.append(chunk)
            if len(picked) == k:
                break
        return picked


def render(found: list[Chunk], limit: int = 900) -> str:
    return "\n\n".join(
        f"[{c.path}{' > ' + c.heading if c.heading else ''}]\n{c.text[:limit]}" for c in found
    )
