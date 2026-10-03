#!/bin/bash
# reddit must parse Reddit's Atom feeds into posts and comments, stop with exit 3
# on the network-security block page instead of working around it, and retry a
# 429. Offline: the feeds below are synthetic, shaped like the real ones read on
# 2026-10-02, and no request leaves the machine.
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

python3 - "$ROOT/bin/lib" "$T" <<'PY'
import io, sys, urllib.error
sys.path.insert(0, sys.argv[1])
import reddit_feed as rf
rf.RATE_FILE = sys.argv[2] + "/rate.json"

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/alice</name></author><category term="startups" label="r/startups"/>
<content type="html">&lt;!-- SC_OFF --&gt;&lt;div class="md"&gt;&lt;p&gt;We charge  $49.&lt;/p&gt;&lt;p&gt;Too low?&lt;/p&gt;&lt;table&gt;&lt;tr&gt;&lt;th&gt;Plan&lt;/th&gt;&lt;th&gt;Price&lt;/th&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Pro&lt;/td&gt;&lt;td&gt;$49&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href="https://www.reddit.com/user/alice"&gt; /u/alice &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href="https://www.reddit.com/r/startups/comments/abc123/pricing/"&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href="https://www.reddit.com/r/startups/comments/abc123/pricing/"&gt;[comments]&lt;/a&gt;&lt;/span&gt;</content>
<id>t3_abc123</id><link href="https://www.reddit.com/r/startups/comments/abc123/pricing/"/>
<updated>2026-10-01T10:00:00+00:00</updated><published>2026-10-01T10:00:00+00:00</published><title>Is $49 too low?</title></entry>
<entry><author><name>/u/bob</name></author><category term="startups" label="r/startups"/>
<content type="html">&lt;table&gt;&lt;tr&gt;&lt;td&gt;&lt;a href="https://example.com/post?a=1&amp;amp;b=2"&gt;[link]&lt;/a&gt;&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content>
<id>t3_def456</id><link href="https://www.reddit.com/r/startups/comments/def456/x/"/>
<published>2026-10-01T11:00:00+00:00</published><title>A link post</title></entry>
<entry><author><name>/u/[deleted]</name></author><category term="startups" label="r/startups"/>
<content type="html">&lt;div class="md"&gt;&lt;p&gt;Raise it.&lt;/p&gt;&lt;/div&gt;</content>
<id>t1_c0001</id><link href="https://www.reddit.com/r/startups/comments/abc123/pricing/c0001/"/>
<updated>2026-10-01T12:00:00+00:00</updated><title>/u/[deleted] on Is $49 too low?</title></entry>
</feed>"""

fail = []
def check(name, ok):
    if not ok:
        fail.append(name)

e = rf.parse_feed(FEED)
check("three entries", len(e) == 3)
check("kinds", [x["kind"] for x in e] == ["post", "post", "comment"])
check("rank is feed order", [x["rank"] for x in e] == [1, 2, 3])
# The live trailer sits outside the md div with no table around it; review on
# 2026-10-02 found it leaking into every text post.
check("self text only, trailer dropped, author table kept",
      e[0]["text"] == "We charge $49.\n\nToo low?\n\n| Plan | Price\n| Pro | $49")
check("self post has no outbound link", e[0]["link"] is None)
check("link post target unescaped", e[1]["link"] == "https://example.com/post?a=1&b=2")
check("author without /u/", e[0]["author"] == "alice")
check("deleted author is null", e[2]["author"] is None)
check("comment title dropped", e[2]["title"] is None)
check("comment falls back to updated", e[2]["published"] == "2026-10-01T12:00:00+00:00")
check("subreddit", e[0]["subreddit"] == "startups")

check("thread from url", rf.thread_path("https://www.reddit.com/r/x/comments/1wr140j/slug/") == "comments/1wr140j")
check("thread from t3 id", rf.thread_path("t3_1wr140j") == "comments/1wr140j")
try:
    rf.thread_path("not a post!")
    check("bad ref raises", False)
except ValueError:
    pass
try:
    rf.thread_path("python")
    check("subreddit name is not a post id", False)
except ValueError:
    pass
check("bare id with a digit", rf.thread_path("1wr140j") == "comments/1wr140j")
for raw in ("ClaudeAI", "r/ClaudeAI", "/r/ClaudeAI/", "https://www.reddit.com/r/ClaudeAI/"):
    check(f"sub name from {raw}", rf.sub_name(raw) == "ClaudeAI")
check("feed url", rf.feed_url("r/x/top", t="week", limit=5, q=None)
      == "https://www.reddit.com/r/x/top/.rss?t=week&limit=5")

def http_error(code, body, headers=None):
    return urllib.error.HTTPError("u", code, "x", headers or {}, io.BytesIO(body.encode()))

BLOCK = "<p>You've been blocked by network security.</p>"
check("block page detected", rf.is_block_page(403, BLOCK))
check("plain 403 is not the block page", not rf.is_block_page(403, "Forbidden: private community"))

def raises_block(req, timeout):
    raise http_error(403, BLOCK)
try:
    rf.fetch("https://www.reddit.com/r/x/.rss", opener=raises_block)
    check("block raises Blocked", False)
except rf.Blocked:
    pass

calls = []
class Resp(io.BytesIO):
    headers = {"x-ratelimit-remaining": "5", "x-ratelimit-reset": "0"}
    def __enter__(self): return self
    def __exit__(self, *a): pass
def flaky(req, timeout):
    calls.append(req.get_header("User-agent"))
    if len(calls) == 1:
        raise http_error(429, "slow down", {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "0"})
    return Resp(FEED.encode())
check("429 retried then parsed", len(rf.parse_feed(rf.fetch("https://www.reddit.com/r/x/.rss", opener=flaky))) == 3 and len(calls) == 2)
check("sends its own user agent", calls[0] == rf.USER_AGENT)

# A 429 without rate headers must still hold off a whole window, not fire the
# retries back to back.
import json, time
slept = []
rf.time.sleep = slept.append
def bare_429(req, timeout):
    raise http_error(429, "slow down")
try:
    rf.fetch("https://www.reddit.com/r/x/.rss", opener=bare_429)
    check("three bare 429s give up", False)
except RuntimeError:
    pass
check("bare 429 waits a window between tries", len(slept) == 2 and all(rf.WINDOW - 2 < s <= rf.WINDOW + 1 for s in slept))
def retry_after(req, timeout):
    raise http_error(429, "slow down", {"retry-after": "7"})
slept.clear()
rf._hold(0)
try:
    rf.fetch("https://www.reddit.com/r/x/.rss", opener=retry_after)
except RuntimeError:
    pass
check("Retry-After honoured", slept and all(5 < s <= 7 for s in slept))
open(rf.RATE_FILE, "w").write("[1, 2]")
rf._wait_for_budget(lambda m: None)

from importlib.machinery import SourceFileLoader
cli = SourceFileLoader("reddit_cli", sys.argv[1] + "/../reddit").load_module()
class A: pass
a = A(); a.cmd, a.name, a.sort, a.t, a.limit = "sub", "/r/ClaudeAI/", "top", "week", 500
check("listing url", cli.listing_url(a) == "https://www.reddit.com/r/ClaudeAI/top/.rss?t=week&limit=100")
a.sort = "new"
check("no window on new", cli.listing_url(a) == "https://www.reddit.com/r/ClaudeAI/new/.rss?limit=100")
b = A(); b.cmd, b.query, b.sub, b.sort, b.t, b.limit = "search", "cold email", "r/startups", "top", "month", 25
check("search url", cli.listing_url(b) == "https://www.reddit.com/r/startups/search/.rss?q=cold+email&sort=top&t=month&restrict_sr=on&limit=25")

for name in fail:
    print("reddit:", name, "FAILED")
sys.exit(1 if fail else 0)
PY
fail=$?

"$ROOT/bin/reddit" thread "not a post!" >/dev/null 2>&1
code=$?
if [ "$code" -ne 2 ]; then echo "reddit thread with a bad ref exited $code, want 2"; fail=1; fi
"$ROOT/bin/reddit" sub x --comments -1 >/dev/null 2>&1
code=$?
if [ "$code" -ne 2 ]; then echo "reddit --comments -1 exited $code, want 2"; fail=1; fi
exit $fail
