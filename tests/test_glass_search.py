"""Search answered on the glass (bin/lib/glass_search.py, CHW-188).

Hermetic: a local HTTP server stands in for DuckDuckGo and Exa, and the
end-to-end check runs the real hud-listen against a fake display socket, the
pattern in tests/test_hud_listen.py. Nothing here touches the network.

Run: python3 tests/test_glass_search.py
"""
from __future__ import annotations

import http.server
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(ROOT / "tests"))
import glass_search  # noqa: E402
import route  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if condition else 'FAIL'} {name}{'' if condition else ' ' + str(detail)}")
    if not condition:
        failures.append(name)


# Shaped like html.duckduckgo.com/html/ on 2026-10-09: an ad first, a
# redirect link, a direct link, a duplicate, and a javascript: link that must
# never become a row. Every host is a reserved example domain.
DDG_PAGE = """
<div class="result results_links result--ad">
  <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=ads.example">Buy tickets</a>
  <a class="result__snippet" href="#">An advert.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.scores.example%2Fdodgers&amp;rut=x">Dodgers Scores &amp; Results</a>
  <a class="result__snippet" href="#">The official scoreboard page.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="https://news.example/dodgers-win">Dodgers beat Braves 5-2</a>
  <a class="result__snippet" href="#">The <b>Dodgers</b> won the game 5-2 over the Braves on Thursday.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="https://news.example/dodgers-win">Duplicate</a>
  <a class="result__snippet" href="#">Same page again.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="javascript:alert(1)">Bad link</a>
  <a class="result__snippet" href="#">Never a row.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="https://stats.example/lad">LAD stats</a>
  <a class="result__snippet" href="#">Season stats with a separator.</a>
</div>
"""


class Fake(http.server.BaseHTTPRequestHandler):
    mode = "ok"
    seen: list[dict] = []

    def log_message(self, *args) -> None:
        pass

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("content-length") or 0)).decode()
        Fake.seen.append({"path": self.path, "body": body, "key": self.headers.get("x-api-key")})
        if Fake.mode == "slow":
            time.sleep(2)
        if Fake.mode == "500":
            self.send_response(500)
            self.end_headers()
            return
        if self.path.startswith("/exa"):
            payload = json.dumps({"answer": "The Dodgers won 5-2.", "citations": [
                {"title": "Dodgers beat Braves", "url": "https://news.example/dodgers-win"},
                {"title": "bad", "url": "file:///etc/passwd"}]}).encode()
            ctype = "application/json"
        else:
            payload = DDG_PAGE.encode()
            ctype = "text/html"
        self.send_response(200)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except BrokenPipeError:
            pass  # the timeout test hangs up on purpose


def serve() -> tuple[http.server.ThreadingHTTPServer, str]:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def test_search_query() -> None:
    cases = [
        ("search who won the dodgers game", "who won the dodgers game"),
        ("Search for Python 3.13 release date.", "python 3.13 release date"),
        ("google rust traits", "rust traits"),
        ("look up the weather in LA", "the weather in la"),
        ("can you search who won the dodgers game", "who won the dodgers game"),
        ("open google.com", None),
        ("go to google.com", None),
        ("in chrome search rust traits", None),
        ("search rust traits in chrome", None),
        ("google it", None),
        ("search", None),
        ("what's the weather", None),
    ]
    for said, want in cases:
        got = route.search_query(said)
        check(f"{said!r} -> {want!r}", got == want, got)
    # The router itself still sends an explicit app request to the browser.
    d = route.route("open google.com", {}, {}, classify=lambda s, m: None)
    check("open google.com still routes to the browser", d.dest == "browser", d)
    check("and opens the site, not a search", route.browser_url("open google.com")[0] == "https://google.com")


def test_parse_and_answer() -> None:
    rows = glass_search.parse_ddg(DDG_PAGE)
    urls = [s.url for s, _ in rows]
    check("the ad is dropped", not any("ads.example" in u or "y.js" in u for u in urls), urls)
    check("the redirect is unwrapped", urls[0] == "https://www.scores.example/dodgers", urls)
    check("duplicates are dropped", urls.count("https://news.example/dodgers-win") == 1, urls)
    check("a javascript: link is never a row", not any(u.startswith("javascript") for u in urls), urls)
    check("three real results", len(rows) == 3, urls)
    check("host drops www", rows[0][0].host == "scores.example", rows[0][0])
    check("entities are decoded", rows[0][0].title == "Dodgers Scores & Results", rows[0][0].title)
    check("a line separator in a snippet is stripped", " " not in rows[2][1], rows[2][1])
    answer, host = glass_search.pick_answer("who won the dodgers game", rows)
    check("the snippet that answers beats the top rank", host == "news.example", (answer, host))
    check("the answer has no markup", "<b>" not in answer, answer)


def test_backends() -> None:
    server, base = serve()
    try:
        with patch.object(glass_search, "DDG_URL", base + "/html/"), \
             patch.object(glass_search, "EXA_URL", base + "/exa"), \
             patch.dict(os.environ, {"EXA_API_KEY": ""}):
            Fake.mode, Fake.seen = "ok", []
            r = glass_search.search("who won the dodgers game", timeout=2)
            check("duckduckgo answers with no key", r.backend == "duckduckgo" and not r.error, r)
            check("up to five sources", 0 < len(r.sources) <= 5, r.sources)
            check("the query was posted", "q=who+won" in Fake.seen[-1]["body"], Fake.seen[-1])
            lines = glass_search.result_lines(r)
            check("the answer quotes its host", 'news.example: “' in lines[0], lines[0])
            rows = json.loads(lines[1].split(" ", 2)[2])
            check("rows carry title and host", rows[1]["text"] == "Dodgers beat Braves 5-2  ·  news.example", rows)
            check("rows carry ids, never URLs", all(set(row) == {"id", "text"} for row in rows), rows)

            with patch.dict(os.environ, {"EXA_API_KEY": "fake-test-key"}):
                r = glass_search.search("who won the dodgers game", timeout=2)
            check("exa is used when its key is set", r.backend == "exa" and r.answer == "The Dodgers won 5-2.", r)
            check("exa gets the key in its header", Fake.seen[-1]["key"] == "fake-test-key")
            check("a file: citation is dropped", [s.host for s in r.sources] == ["news.example"], r.sources)
            check("a synthesized answer is not quoted", glass_search.answer_text(r) == "The Dodgers won 5-2.")

            Fake.mode = "500"
            with patch.dict(os.environ, {"EXA_API_KEY": "fake-test-key"}):
                r = glass_search.search("x", timeout=2)
            check("both failing names both", "Exa" in r.error and "DuckDuckGo" in r.error and not r.sources, r.error)
            failed = "\n".join(glass_search.result_lines(r))
            check("a failure draws an error Status", "level=error" in failed and "Nothing was opened" in failed, failed)

            Fake.mode = "slow"
            started = time.monotonic()
            r = glass_search.search("x", timeout=0.5)
            took = time.monotonic() - started
            check("a slow backend times out", "didn't answer" in r.error, r.error)
            check("and the timeout holds", took < 1.8, took)
    finally:
        server.shutdown()
    with patch.object(glass_search, "DDG_URL", "http://127.0.0.1:9/html/"), patch.dict(os.environ, {"EXA_API_KEY": ""}):
        r = glass_search.search("x", timeout=1)
    check("an unreachable backend says so", "couldn't reach DuckDuckGo" in r.error or "DuckDuckGo" in r.error, r.error)


def test_loading_lines() -> None:
    lines = glass_search.loading_lines('who said "hi"')
    check("the panel opens on the search surface", lines[0].startswith("@ search "), lines[0])
    check("root is named before the data", lines.index("r s") < lines.index('d /answer "Searching…"'), lines)
    check("rows open on a press", 'action=gs-open actionLabel="Open"' in "\n".join(lines))
    check("the query is a JSON string prop", 'value="who said \\"hi\\""' in lines[3], lines[3])
    check("a click off the card closes it", lines[1] == "glance search", lines[1])


def test_end_to_end() -> None:
    """The real hud-listen against a fake display: a search draws the answer
    and sources, never starts the model, never opens a browser until a row is
    pressed, opens only a URL it drew, and "close it" takes the panel down."""
    from test_hud_listen import run_against  # noqa: E402

    server, base = serve()
    directory = tempfile.mkdtemp()
    opened = os.path.join(directory, "opened")
    ran = os.path.join(directory, "model-ran")
    Fake.mode = "ok"
    state = {"rows": None}

    def rows_drawn() -> bool:
        return state["rows"] is not None

    def until(lines: list[str]) -> bool:
        for line in lines:
            if line.startswith("d /sources [{"):
                state["rows"] = line
        return any(line == "- search" for line in lines)

    said = [
        (0.5, 'h "search who won the dodgers game"'),
        (rows_drawn, 'e action gs-open row="src-9" surface="search"'),
        (rows_drawn, 'e action gs-open row="src-1" surface="search"'),
        (lambda: rows_drawn() and os.path.exists(opened), 'h "close it"'),
    ]
    env = {"GLASS_SEARCH_DDG_URL": base + "/html/", "EXA_API_KEY": "", "HUD_SEARCH": "on",
           "HUD_OPEN_CMD": f"sh -c 'echo \"$0\" >> {opened}'"}
    started = time.monotonic()
    try:
        with patch.dict(os.environ, env):
            received, _ = run_against(f"#!/bin/sh\ncat > /dev/null\ntouch {ran}\n", said, until, timeout=25)
    finally:
        server.shutdown()
    lines = [line for _, line in received]
    print("    drawn:", *[l for l in lines if l[:2] in ("@ ", "c ", "d ", "r ", "- ", "s ")], sep="\n      ")
    check("the search panel opened", any(l.startswith("@ search at=topRight") for l in lines), lines)
    check("it painted Searching first", 'd /answer "Searching…"' in lines, lines)
    answer = [l for l in lines if l.startswith("d /answer ") and "Searching" not in l]
    check("an answer was drawn", answer and "news.example" in answer[0], answer)
    check("source rows were drawn", state["rows"] and '"id":"src-0"' in state["rows"], state["rows"])
    first_open = next((t for t, l in received if l.startswith('s "Opened')), None)
    check("the model never ran", not os.path.exists(ran))
    got = Path(opened).read_text().split() if os.path.exists(opened) else []
    check("only the pressed row opened, once", got == ["https://news.example/dodgers-win"], got)
    check("the press said what it opened", first_open is not None, lines)
    check('"close it" took the panel down', "- search" in lines, lines)
    print(f"    end to end in {time.monotonic() - started:.1f}s")


def main() -> int:
    print("search sentences")
    test_search_query()
    print("parsing and the answer")
    test_parse_and_answer()
    print("backends, failures, timeouts")
    test_backends()
    print("the skeleton")
    test_loading_lines()
    print("end to end against a fake display")
    test_end_to_end()
    print(f"{len(failures)} failed: {', '.join(failures)}" if failures else "all passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
