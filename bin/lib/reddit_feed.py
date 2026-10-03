"""Read Reddit through its public Atom feeds. Read-only, no account, no key.

The trick that circulated in April 2026 (append .json to any Reddit URL, reel by
@zchangd) stopped working when Reddit closed unauthenticated JSON on 2026-05-30.
Measured from this Mac on 2026-10-02: www and api.reddit.com answer .json with a
403 "blocked by network security" page, and old.reddit.com redirects it to a
login. New OAuth apps now need approval under Reddit's Responsible Builder Policy.

The .rss form of the same URLs still answers anonymously, so this reads that.
What it gives up: vote counts and comment nesting. Feeds come in Reddit's own
sort order, so `sort=top` ranks by votes without showing them.

A 403 block page is reported and left alone. This never retries through a
browser, a spoofed client or someone's cookies.
"""
import html
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

ATOM = {"a": "http://www.w3.org/2005/Atom"}
BASE = "https://www.reddit.com"
USER_AGENT = "chewbacca-reddit/0.1 (personal research, read-only)"
# Measured 2026-10-02: every anonymous feed request came back with
# x-ratelimit-remaining 0.0 and a reset of up to 60 s. One request a minute is
# the whole budget, so the limiter honours the reset header instead of a fixed
# sleep, and remembers it across runs in this file.
RATE_FILE = os.path.expanduser("~/Library/Caches/chewbacca/reddit-rate.json")
# The reset header never exceeded 60 in the same runs, so a 429 without headers
# waits one full window, and no stored wait is trusted beyond it.
WINDOW = 60
MAX_RETRIES = 3
# Feeds cap at 100 entries; asking for more returns 100.
FEED_MAX = 100


class Blocked(Exception):
    """Reddit answered with its network-security block page."""


class _Text(HTMLParser):
    """Text the author wrote: only what sits inside <div class="md">.

    Everything outside it is Reddit's trailer ("submitted by /u/x [link]
    [comments]"), which comes wrapped in a thumbnail table on image posts and
    bare on text posts, so dropping by tag misses half of them. A link post has
    no md div and so no text. Tables the author wrote are kept as rows of cells.
    """

    BLOCK = ("p", "li", "blockquote", "pre", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.depth = [], 0

    def handle_starttag(self, tag, attrs):
        if self.depth:
            if tag == "div":
                self.depth += 1
            if tag in self.BLOCK or tag in ("br", "tr"):
                self.parts.append("\n")
            elif tag in ("td", "th"):
                self.parts.append(" | ")
        elif tag == "div" and "md" in (dict(attrs).get("class") or "").split():
            self.depth = 1

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag == "div":
            self.depth -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)


def html_to_text(body):
    parser = _Text()
    parser.feed(body or "")
    text = "".join(parser.parts)
    text = re.sub(r"[ \t ]+", " ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _outbound_link(body):
    """A link post's target: the href Reddit labels [link] in the post table."""
    m = re.search(r'<a href="([^"]+)">\[link\]</a>', body or "")
    if not m:
        return None
    url = html.unescape(m.group(1))
    # Self posts point [link] back at their own comments page.
    return None if "/comments/" in url and "reddit.com" in url else url


def parse_feed(xml_text):
    """Entries of a Reddit Atom feed as plain dicts, in feed order."""
    root = ET.fromstring(xml_text)
    out = []
    for rank, entry in enumerate(root.findall("a:entry", ATOM), 1):
        rid = entry.findtext("a:id", "", ATOM)
        body = entry.findtext("a:content", "", ATOM)
        author = entry.findtext("a:author/a:name", None, ATOM)
        cat = entry.find("a:category", ATOM)
        link = entry.find("a:link", ATOM)
        kind = {"t3": "post", "t1": "comment"}.get(rid[:2], "other")
        item = {
            "kind": kind,
            "id": rid,
            "rank": rank,
            "title": entry.findtext("a:title", "", ATOM),
            # Deleted accounts come through as /u/[deleted] or with no author.
            "author": None if not author or author == "/u/[deleted]" else author.removeprefix("/u/"),
            "subreddit": cat.get("term") if cat is not None else None,
            "url": link.get("href") if link is not None else None,
            "published": entry.findtext("a:published", None, ATOM)
            or entry.findtext("a:updated", None, ATOM),
            "text": html_to_text(body),
        }
        if kind == "post":
            item["link"] = _outbound_link(body)
        if kind == "comment":
            # "/u/name on Post title" is noise once the post is known.
            item["title"] = None
        out.append(item)
    return out


def feed_url(path, **params):
    """https://www.reddit.com/<path>.rss?<params>, path without the .rss."""
    path = path.strip("/")
    query = {k: v for k, v in params.items() if v not in (None, "")}
    return f"{BASE}/{path}/.rss" + ("?" + urllib.parse.urlencode(query) if query else "")


def thread_path(ref):
    """A post URL, a /r/x/comments/id path, a t3_ id or a bare id, as a path.

    A bare id must hold a digit, so a subreddit name like "python" passed by
    mistake is refused here instead of spending the minute's only request.
    """
    ref = ref.strip()
    m = re.search(r"/comments/([a-z0-9]+)", ref)
    if m:
        return f"comments/{m.group(1)}"
    m = re.fullmatch(r"t3_([a-z0-9]{5,10})", ref) or re.fullmatch(r"(?=[a-z]*[0-9])([a-z0-9]{5,10})", ref)
    if m:
        return f"comments/{m.group(1)}"
    raise ValueError(f"not a Reddit post: {ref}")


def sub_name(name):
    """ClaudeAI from ClaudeAI, r/ClaudeAI, /r/ClaudeAI/ or a full subreddit URL."""
    name = re.sub(r"^https?://[^/]+", "", name.strip()).strip("/")
    return name.removeprefix("r/").strip("/")


def is_block_page(status, body):
    return status == 403 and "blocked by network security" in body.lower()


def _wait_for_budget(log):
    try:
        with open(RATE_FILE) as f:
            state = json.load(f)
        ready_at = float(state.get("ready_at", 0)) if isinstance(state, dict) else 0
    except (OSError, ValueError, TypeError):
        return
    delay = min(ready_at - time.time(), WINDOW + 1)
    if delay > 0:
        log(f"reddit: waiting {delay:.0f}s for the rate limit")
        time.sleep(delay)


def _hold(seconds):
    os.makedirs(os.path.dirname(RATE_FILE), exist_ok=True)
    with open(RATE_FILE, "w") as f:
        json.dump({"ready_at": time.time() + seconds}, f)


def _record_budget(headers, throttled=False):
    """Note when the next request may go. A 429 with no usable headers still
    holds off: Retry-After if given, else one whole window."""
    try:
        if float(headers.get("x-ratelimit-remaining")) < 1:
            return _hold(float(headers.get("x-ratelimit-reset")) + 1)
        if not throttled:
            return _hold(0)
    except (TypeError, ValueError):
        pass
    if throttled:
        try:
            _hold(float(headers.get("retry-after")))
        except (TypeError, ValueError):
            _hold(WINDOW)


def fetch(url, log=lambda m: None, opener=urllib.request.urlopen):
    """GET one feed, honouring the shared rate limit. Returns the XML text."""
    for attempt in range(1, MAX_RETRIES + 1):
        _wait_for_budget(log)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with opener(req, timeout=30) as resp:
                _record_budget(resp.headers)
                return resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            _record_budget(e.headers, throttled=e.code == 429)
            if is_block_page(e.code, body):
                raise Blocked(url) from None
            if e.code == 429:
                log(f"reddit: 429 ({attempt}/{MAX_RETRIES})")
                continue
            if e.code in (403, 404):
                raise LookupError(f"{e.code} for {url}: private, banned, or missing") from None
            raise
    raise RuntimeError(f"rate limited {MAX_RETRIES} times: {url}")
