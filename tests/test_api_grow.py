"""api-grow: a browse to a taught host points at its ops before the call, a
browse to an untaught host is logged and nudged once per session, skipped and
never-teach hosts stay quiet, and the hook never fires on a Bash call that
touches no website. Offline: specs and state live in a temp dir."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp())
os.environ["API_ANYTHING_HOME"] = str(TMP / "engine")
os.environ["API_GROW_DIR"] = str(TMP / "grow")
os.environ["API_GROW_BUNDLED"] = str(TMP / "bundled")
(TMP / "engine" / "sites").mkdir(parents=True)
(TMP / "bundled").mkdir()
(TMP / "engine" / "sites" / "erikfish.json").write_text(json.dumps({
    "name": "erikfish", "baseUrl": "https://erikfish.com",
    "operations": [{"name": "searchPosts", "trigger": {"url": "https://erikfish.com/wp-json/wp/v2/posts?search={q}"},
                    "request": {"url": "https://erikfish.com/wp-json/wp/v2/posts"}}]}))
(TMP / "bundled" / "goodreads.json").write_text(json.dumps({
    "name": "goodreads", "baseUrl": "https://www.goodreads.com", "operations": [{"name": "searchBooks"}]}))
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import api_grow  # noqa: E402


def ev(event, tool, session="s1", **ti):
    return {"hook_event_name": event, "tool_name": tool, "session_id": session, "tool_input": ti}


def hook(payload):
    p = subprocess.run([str(ROOT / ".claude" / "hooks" / "api-grow.sh")], input=json.dumps(payload),
                       capture_output=True, text=True, env=os.environ.copy(), timeout=20)
    return p.stdout.strip()


def main():
    failures = 0

    def check(name, cond):
        nonlocal failures
        print(("  ok    " if cond else "  FAIL  ") + name)
        failures += 0 if cond else 1

    idx = api_grow.taught_index()
    check("user specs index by host", "searchPosts" in idx.get("erikfish.com", {}).get("erikfish", []))
    check("bundled specs index with www stripped", "goodreads" in idx.get("goodreads.com", {}))

    pre = api_grow.handle(ev("PreToolUse", "WebFetch", url="https://www.goodreads.com/book/show/1"))
    check("a taught host is pointed at its ops before the browse", pre and "goodreads (searchBooks)" in pre)
    check("pointed once per session", api_grow.handle(ev("PreToolUse", "WebFetch", url="https://goodreads.com/x")) is None)
    check("an untaught host is not mentioned before the browse",
          api_grow.handle(ev("PreToolUse", "WebFetch", url="https://bookshop.org/a")) is None)

    post = api_grow.handle(ev("PostToolUse", "mcp__plugin_playwright_playwright__browser_navigate",
                              url="https://bookshop.org/search?keywords=dune"))
    check("an untaught host gets the teach nudge after the browse", post and "bookshop.org has no API yet" in post)
    check("the nudge says read-only and names skip", "read-only" in post and "api-grow skip bookshop.org" in post)
    again = api_grow.handle(ev("PostToolUse", "WebFetch", url="https://bookshop.org/b"))
    check("nudged once per session, but the visit still counts",
          again is None and api_grow.load()["hosts"]["bookshop.org"]["count"] == 2)
    check("a new session is nudged again", api_grow.handle(ev("PostToolUse", "WebFetch", "s2",
                                                              url="https://bookshop.org/c")) is not None)

    api_grow.skip("docs.python.org", "docs pages, nothing repeatable")
    check("a skipped host stays quiet",
          api_grow.handle(ev("PostToolUse", "WebFetch", url="https://docs.python.org/3/x.html")) is None)
    for url in ("http://localhost:3000/", "https://github.com/a/b", "https://www.linkedin.com/in/x",
                "https://accounts.google.com/x", "https://login.example.com/", "http://10.0.0.1/"):
        check("never teach " + url, api_grow.handle(ev("PostToolUse", "WebFetch", "s9", url=url)) is None)

    check("Bash curl to a new host is caught", api_grow.handle(ev(
        "PostToolUse", "Bash", command="curl -s 'https://api.weather.gov/points/34,-118'")) is not None)
    check("Bash with no web tool is ignored", api_grow.urls_from_hook(ev(
        "PostToolUse", "Bash", command="echo https://example.org > notes.txt")) == [])

    st = api_grow.status()
    check("status ranks the queue by visits", st["untaught"][0]["host"] == "bookshop.org")
    check("status lists the skip and why", {"host": "docs.python.org", "why": "docs pages, nothing repeatable"} in st["skipped"])

    out = hook(ev("PostToolUse", "WebFetch", "s3", url="https://www.allrecipes.com/recipe/1"))
    check("the hook script emits PostToolUse context",
          json.loads(out)["hookSpecificOutput"]["hookEventName"] == "PostToolUse" if out else False)
    check("the hook script is silent on plain Bash", hook(ev("PostToolUse", "Bash", command="ls -la")) == "")
    check("the hook survives junk input", subprocess.run([str(ROOT / ".claude" / "hooks" / "api-grow.sh")],
          input="not json", capture_output=True, text=True).returncode == 0)

    print("%d failure(s)" % failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
