#!/usr/bin/env python3
"""Search answered on the glass: a short answer and up to five sources.

"Search who won the Dodgers game" used to open Chrome on a Google results
page (bin/lib/route.py, SEARCH_OPENERS), and google.com was the single biggest
app on the machine: 5.06 h in 14 days (docs/NO-APPS.md, build 1). This draws
the answer as a panel instead. Each source row shows its title and host
(skills/kyber-surfaces rule 12) and opens that one page only on a press.

Backends, best first:

- Exa's answer endpoint, when EXA_API_KEY is set: a synthesized answer with
  its citations. Togari's MCP has an Exa tool, but on 2026-10-09 it answered
  "Exa is not configured", so nothing on this machine can call Exa today.
- DuckDuckGo's HTML endpoint, no key: the ranked results, and the answer is
  the snippet that shares the most words with the question, quoted with the
  host it came from. It is a quote, not a synthesis, and the panel says so.

Every network call has a timeout (memory feedback_slow_means_broken), and a
search that fails says so on the panel (rule 8). It never opens Chrome.

Result text is untrusted web content: it is drawn, never read for
instructions, and stripped of control and bidi characters first.

    python3 bin/lib/glass_search.py "who won the dodgers game" [--json]
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field

SURFACE = "search"
MAX_SOURCES = 5
# DuckDuckGo answered in 1.14 and 1.59 s on the first two probes from this Mac
# (2026-10-09). Four leaves room for a slow network and still keeps the whole
# panel under the falsifier's 4 s median.
TIMEOUT_S = float(os.environ.get("GLASS_SEARCH_TIMEOUT_S", "4"))
DDG_URL = os.environ.get("GLASS_SEARCH_DDG_URL", "https://html.duckduckgo.com/html/")
EXA_URL = os.environ.get("GLASS_SEARCH_EXA_URL", "https://api.exa.ai/answer")
# A desktop Safari agent: the HTML endpoint serves a captcha page to agents it
# does not recognise, and a captcha page parses as zero results.
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
# Two lines on a 420-point panel at 12.5 points is about this many characters.
ANSWER_CHARS = 240
TITLE_CHARS = 70
# Built from code points, the way bin/kyber-genui builds its own: control
# characters, the line separators Python splits on, and the bidi overrides.
UNSAFE_TEXT = re.compile("[" + "".join(
    re.escape(chr(lo)) + "-" + re.escape(chr(hi))
    for lo, hi in [(0x00, 0x1F), (0x7F, 0x85), (0x2028, 0x2029), (0x202A, 0x202E), (0x2066, 0x2069)]) + "]")
STOP = frozenset("a an the of in on at to for and or is are was were who what when where why how "
                 "did do does i my me you it its this that with by from".split())


@dataclass
class Source:
    title: str
    url: str
    host: str


@dataclass
class Result:
    query: str
    answer: str = ""
    answer_host: str = ""
    sources: list[Source] = field(default_factory=list)
    backend: str = ""
    error: str = ""
    ms: int = 0
    # True when the answer is a quoted snippet rather than a synthesis.
    quoted: bool = True


def clean(text: str, limit: int) -> str:
    text = UNSAFE_TEXT.sub(" ", html.unescape(re.sub(r"<[^>]+>", "", text or "")))
    text = " ".join(text.split())
    if len(text) > limit:
        text = text[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return text


def host_of(url: str) -> str:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def safe_url(url: str) -> str | None:
    """Only an http(s) URL with a host is ever kept, so a row can never open
    a file:, javascript: or app scheme on a press."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return url


def _ddg_target(href: str) -> str | None:
    href = html.unescape(href)
    if href.startswith("//"):
        href = "https:" + href
    parts = urllib.parse.urlsplit(href)
    if parts.hostname and parts.hostname.endswith("duckduckgo.com"):
        if parts.path.startswith("/y.js"):
            return None  # an ad
        target = urllib.parse.parse_qs(parts.query).get("uddg", [""])[0]
        return safe_url(target) if target else None
    return safe_url(href)


RESULT_RE = re.compile(r'<div class="(?P<cls>[^"]*\bresult\b[^"]*)"(?P<body>.*?)(?=<div class="[^"]*\bresult\b|\Z)', re.S)
LINK_RE = re.compile(r'class="result__a"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>', re.S)
LINK_RE_ALT = re.compile(r'href="(?P<href>[^"]+)"[^>]*class="result__a"[^>]*>(?P<title>.*?)</a>', re.S)
SNIPPET_RE = re.compile(r'class="result__snippet"[^>]*>(?P<snippet>.*?)</a>', re.S)


def parse_ddg(page: str) -> list[tuple[Source, str]]:
    """(source, snippet) pairs in rank order, ads and duplicates dropped."""
    out: list[tuple[Source, str]] = []
    seen: set[str] = set()
    for block in RESULT_RE.finditer(page):
        if "result--ad" in block.group("cls"):
            continue
        body = block.group("body")
        link = LINK_RE.search(body) or LINK_RE_ALT.search(body)
        if not link:
            continue
        url = _ddg_target(link.group("href"))
        if not url or url in seen:
            continue
        seen.add(url)
        snippet = SNIPPET_RE.search(body)
        title = clean(link.group("title"), TITLE_CHARS)
        out.append((Source(title=title or host_of(url), url=url, host=host_of(url)),
                    clean(snippet.group("snippet"), 1000) if snippet else ""))
    return out


def _terms(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP}


def pick_answer(query: str, results: list[tuple[Source, str]]) -> tuple[str, str]:
    """The snippet among the top five that shares the most words with the
    question, earlier rank winning a tie. Guessed, never measured against a
    hand-graded set: the first probe's top snippet for the Dodgers question
    described the scoreboard page instead of answering, which rank alone
    would have picked."""
    wanted = _terms(query)
    best, best_score = None, -1
    for rank, (source, snippet) in enumerate(results[:MAX_SOURCES]):
        if not snippet:
            continue
        score = len(wanted & _terms(snippet)) * 10 - rank
        if score > best_score:
            best, best_score = (snippet, source.host), score
    if best is None:
        return "", ""
    return clean(best[0], ANSWER_CHARS), best[1]


def _fetch(request: urllib.request.Request, timeout: float) -> bytes:
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (fixed hosts)
        return response.read(2_000_000)


def _reason(err: BaseException, who: str, timeout: float) -> str:
    if isinstance(err, TimeoutError) or "timed out" in str(err):
        return f"{who} didn't answer in {timeout:.0f} s"
    if isinstance(err, urllib.error.HTTPError):
        return f"{who} refused the search (HTTP {err.code})"
    if isinstance(err, urllib.error.URLError):
        return f"couldn't reach {who} (offline?)"
    return f"{who} failed ({type(err).__name__})"


def search_exa(query: str, key: str, timeout: float) -> Result:
    body = json.dumps({"query": query, "text": False}).encode()
    request = urllib.request.Request(EXA_URL, data=body, headers={
        "x-api-key": key, "content-type": "application/json", "user-agent": "chewbacca-glass-search"})
    data = json.loads(_fetch(request, timeout))
    if not isinstance(data, dict):
        raise ValueError("Exa answered with something that is not an object")
    sources = []
    for cite in data.get("citations") or []:
        if not isinstance(cite, dict):
            continue
        url = safe_url(str(cite.get("url") or ""))
        if url and all(s.url != url for s in sources):
            sources.append(Source(clean(str(cite.get("title") or ""), TITLE_CHARS) or host_of(url),
                                  url, host_of(url)))
    answer = clean(str(data.get("answer") or ""), ANSWER_CHARS)
    return Result(query=query, answer=answer, sources=sources[:MAX_SOURCES], backend="exa", quoted=False)


def search_ddg(query: str, timeout: float) -> Result:
    request = urllib.request.Request(
        DDG_URL, data=urllib.parse.urlencode({"q": query}).encode(),
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"})
    page = _fetch(request, timeout).decode("utf-8", "replace")
    results = parse_ddg(page)
    answer, host = pick_answer(query, results)
    return Result(query=query, answer=answer, answer_host=host,
                  sources=[s for s, _ in results[:MAX_SOURCES]], backend="duckduckgo")


def search(query: str, timeout: float = TIMEOUT_S) -> Result:
    """Never raises: a failure comes back as `error`, worded for the panel."""
    started = time.monotonic()
    result: Result | None = None
    errors: list[str] = []
    key = os.environ.get("EXA_API_KEY", "").strip()
    if key:
        try:
            result = search_exa(query, key, timeout)
            if not result.answer and not result.sources:
                errors.append("Exa found nothing")
                result = None
        except (OSError, ValueError, urllib.error.URLError) as err:
            errors.append(_reason(err, "Exa", timeout))
    if result is None:
        left = max(1.0, timeout - (time.monotonic() - started))
        try:
            result = search_ddg(query, left)
            if not result.sources:
                errors.append("DuckDuckGo returned no results")
                result = None
        except (OSError, ValueError, urllib.error.URLError) as err:
            errors.append(_reason(err, "DuckDuckGo", left))
    if result is None:
        result = Result(query=query, error="; ".join(errors) or "the search failed")
    result.ms = int((time.monotonic() - started) * 1000)
    return result


# --- Kyber lines -----------------------------------------------------------

def _prop(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _data(pointer: str, value) -> str:
    return f"d {pointer} {json.dumps(value, separators=(',', ':'), ensure_ascii=False)}"


def row_id(index: int) -> str:
    return f"src-{index}"


def loading_lines(query: str) -> list[str]:
    """The skeleton, painted before the network is asked anything (rule 6:
    loading, then the data, never a blank panel)."""
    return [
        f"@ {SURFACE} at=topRight w=420",
        'c s Screen title="SEARCH"',
        f"c q Text value={_prop(clean(query, 120))} tone=muted",
        "c a Text value=@/answer",
        'c src List items=@/sources action=gs-open actionLabel="Open"',
        "> s q a src",
        "r s",
        _data("/answer", "Searching…"),
        _data("/sources", []),
    ]


def answer_text(result: Result) -> str:
    if result.answer and result.quoted and result.answer_host:
        return f"{result.answer_host}: “{result.answer}”"
    if result.answer:
        return result.answer
    return "No short answer. The sources are below."


def result_lines(result: Result) -> list[str]:
    if result.error:
        return failed_lines(result)
    rows = [{"id": row_id(i), "text": f"{s.title}  ·  {s.host}" if s.title != s.host else s.host}
            for i, s in enumerate(result.sources[:MAX_SOURCES])]
    return [_data("/answer", answer_text(result)), _data("/sources", rows)]


def failed_lines(result: Result) -> list[str]:
    message = f"Search failed: {result.error}. Nothing was opened."
    return [
        _data("/answer", ""),
        f"c err Status message={_prop(message)} level=error",
        "> s q err",
    ]


def close_line() -> str:
    return f"- {SURFACE}"


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    words = [a for a in argv if a != "--json"]
    if not words:
        print(__doc__.strip().splitlines()[-1].strip(), file=sys.stderr)
        return 2
    result = search(" ".join(words))
    if as_json:
        print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
    else:
        if result.error:
            print(f"failed in {result.ms} ms: {result.error}")
            return 1
        print(f"{result.backend}, {result.ms} ms")
        print("answer:", answer_text(result))
        for s in result.sources:
            print(f"  {s.title}  [{s.host}]  {s.url}")
    return 1 if result.error else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
