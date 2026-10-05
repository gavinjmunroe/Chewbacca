#!/usr/bin/env python3
"""The oss surface and the engine layer: a spec whose repo is not remixable,
or that reaches off this Mac, is refused at load; a command is the detected
binary plus the spec's own args and nothing from the glass; HTTP goes only to
localhost, follows no redirect and ignores proxies; output is capped; text
from an engine reaches the HUD with its control characters gone; the oss
surface ranks what replaces an app and labels its license; and nothing on
either surface installs, launches or writes.

A made-up registry and engine file in a temp directory, a fake runner, and
one throwaway HTTP server on 127.0.0.1. No network, no HUD.
"""
import http.server
import json
import os
import re
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import surfaces_fixture as fx  # noqa: E402

from surfaces import Context, SurfaceError  # noqa: E402
from surfaces import engine as E  # noqa: E402
from surfaces import oss  # noqa: E402

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def app(ident, name, license_, remix=False, caveat=False, replaces=(), stars=100, desc="An app"):
    return {"id": ident, "name": name, "repo": f"https://github.com/{ident}", "description": desc,
            "categories": ["Productivity"], "replaces": list(replaces), "stack": "Web (self-hosted)",
            "language": "Go", "license": license_, "remixable": remix, "remixable_with_caveat": caveat,
            "remix_caveat": "Enterprise folder is not MPL" if caveat else None, "stars": stars,
            "archived": False}


APPS = [
    app("ollama/ollama", "Ollama", "MIT", remix=True, replaces=["LM Studio"], stars=150000),
    app("navidrome/navidrome", "Navidrome", "GPL-3.0", replaces=["Spotify"], stars=15000),
    app("toeverything/affine", "Affine", "MPL-2.0", caveat=True, replaces=["Notion"], stars=70000),
    app("appflowy-io/appflowy", "AppFlowy", "AGPL-3.0", replaces=["Notion"], stars=77000),
    app("usememos/memos", "Memos", "MIT", remix=True, replaces=["Notion"], stars=60000,
        desc=fx.INJECTION + "‮"),
    app("someone/closed", "Closed", "NOASSERTION", replaces=["Notion"], stars=10),
    app("tailscale/tailscale", "Tailscale", "BSD-3-Clause", remix=True, stars=20000),
]


def spec(**over):
    base = {"id": "models", "title": "Models", "repo": "ollama/ollama",
            "detect": {"url": "http://127.0.0.1:11434/api/version"},
            "read": {"url": "http://127.0.0.1:11434/api/tags"},
            "rows": "models", "row": {"title": "name", "subtitle": "size"}, "format": {"subtitle": "bytes"}}
    base.update(over)
    return base


class World:
    def __init__(self, engines, bins=()):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "apps.json").write_text(json.dumps({"meta": {}, "apps": APPS}))
        (root / "engines.json").write_text(json.dumps({"engines": engines}))
        self.bins = {}
        for name in bins:
            p = root / name
            p.write_text("#!/bin/sh\nexit 0\n")
            p.chmod(0o755)
            self.bins[name] = str(p)
        self.calls = []
        self.gets = []
        self.answers = {}
        self.ctx = Context(run=self.run, now=lambda: fx.NOW,
                           env={"OSS_APPS_DATA": str(root / "apps.json"),
                                "KYBER_SURFACES_ENGINES": str(root / "engines.json")})
        self.ctx.http_get = self.get

    def run(self, argv):
        self.calls.append(list(argv))
        return self.answers.get("run", (0, "{}", ""))

    def get(self, url, timeout=E.HTTP_TIMEOUT, cap=E.MOST_BYTES):
        self.gets.append(url)
        if url in self.answers:
            body = self.answers[url]
            if isinstance(body, Exception):
                raise body
            return 200, body.encode()
        raise SurfaceError("Not answering.")


def lines_ok(lines):
    for line in lines:
        if "\n" in line or "\r" in line:
            return False
        if line.startswith("c "):
            if not ID.match(line.split()[1]):
                return False
    return True


def test_shipped_file():
    specs, refused = E.load_specs(Context(env={}), oss.registry(Context(env={}))["apps"])
    check("shipped engines.json: every entry loads, none refused", len(specs) >= 2 and not refused,
          (len(specs), refused))
    ids = [s["id"] for s in specs]
    check("shipped engines.json: ids are unique", len(ids) == len(set(ids)), ids)


def test_refusals():
    by_id = {a["id"]: a for a in APPS}
    cases = {
        "a GPL repo": spec(repo="navidrome/navidrome"),
        "a repo not in the registry": spec(repo="nobody/nothing"),
        "a NOASSERTION repo": spec(repo="someone/closed"),
        "an unknown key": spec(shell="rm -rf ~"),
        "a relative bin": spec(detect={"bin": ["ollama"]}, read={"args": ["list"]}),
        "args without a bin": spec(read={"args": ["list"]}),
        "a remote read url": spec(read={"url": "http://example.com/x"}),
        "https to localhost": spec(read={"url": "https://127.0.0.1/x"}),
        "userinfo in the url": spec(read={"url": "http://evil@127.0.0.1/x"}),
        "a lookalike host": spec(read={"url": "http://127.0.0.1.evil.com/x"}),
        "a remote detect url": spec(detect={"url": "http://10.0.0.5/x"}),
        "both detect kinds": spec(detect={"url": "http://127.0.0.1/x", "bin": ["/bin/ls"]}),
        "a bad id": spec(id="Models; rm"),
        "an unknown format": spec(format={"title": "eval"}),
        "a row field outside the three": spec(row={"title": "name", "argv": "x"}),
        "a string for args": spec(detect={"bin": ["/bin/ls"]}, read={"args": "status --json"}),
    }
    for label, s in cases.items():
        check(f"refused at load: {label}", E.check_spec(s, by_id) is not None)
    check("allowed: a remixable_with_caveat repo", E.check_spec(spec(repo="toeverything/affine"), by_id) is None)
    check("allowed: a plain MIT spec", E.check_spec(spec(), by_id) is None)

    w = World([spec(), spec(id="music", repo="navidrome/navidrome"), spec()])
    specs, refused = E.load_specs(w.ctx)
    check("load: the GPL entry and the duplicate id are refused, the good one kept",
          [s["id"] for s in specs] == ["models"] and {r["why"] for r in refused} ==
          {"GPL-3.0 license isn't remixable", "that id is used twice"}, (specs, refused))
    try:
        E.EngineSurface("music").fetch(w.ctx)
        check("a refused engine never runs", False)
    except SurfaceError as err:
        check("a refused engine never runs, and says why", "refused" in str(err) and not w.gets, str(err))


def test_local_url():
    good = ["http://127.0.0.1:11434/api/tags", "http://localhost:3000/x", "http://[::1]:8080/"]
    bad = ["http://example.com", "https://127.0.0.1/", "file:///etc/passwd", "http://127.0.0.1.nip.io/",
           "http://u:p@127.0.0.1/", "http://127.0.0.1:99999/", "http://127.0.0.1/\nHost: x", "ftp://127.0.0.1/",
           "http://0.0.0.0/", "http://169.254.169.254/latest"]
    check("local_url: localhost forms pass", all(E.local_url(u) for u in good), good)
    check("local_url: everything else fails", not any(E.local_url(u) for u in bad),
          [u for u in bad if E.local_url(u)])
    try:
        E.local_get("http://example.com/")
        check("local_get refuses a remote url before connecting", False)
    except SurfaceError:
        check("local_get refuses a remote url before connecting", True)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://example.com/steal")
            self.end_headers()
            return
        body = b"x" * 5000 if self.path == "/big" else json.dumps({"models": [{"name": "m"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)


def test_http_for_real():
    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    saved = os.environ.get("http_proxy")
    # A proxy from the environment would carry a "local" request elsewhere.
    os.environ["http_proxy"] = "http://127.0.0.1:9/"
    try:
        _, body = E.local_get(f"http://127.0.0.1:{port}/ok")
        check("local_get: reads a local server and ignores http_proxy", json.loads(body)["models"][0]["name"] == "m")
        try:
            E.local_get(f"http://127.0.0.1:{port}/redirect")
            check("local_get: a redirect is not followed", False)
        except SurfaceError as err:
            check("local_get: a redirect is not followed", "302" in str(err), str(err))
        try:
            E.local_get(f"http://127.0.0.1:{port}/big", cap=1000)
            check("local_get: output over the cap is refused", False)
        except SurfaceError:
            check("local_get: output over the cap is refused", True)
    finally:
        server.shutdown()
        if saved is None:
            os.environ.pop("http_proxy", None)
        else:
            os.environ["http_proxy"] = saved


def test_command_read():
    w = World([spec(id="peers", repo="tailscale/tailscale", detect={"bin": ["/nope/tailscale", "BIN"]},
                    read={"args": ["status", "--json"]}, rows="Peer.*",
                    row={"title": "HostName", "subtitle": "Online", "detail": "TailscaleIPs.0"}, format={})],
              bins=["tailscale"])
    raw = json.loads(Path(w.ctx.env["KYBER_SURFACES_ENGINES"]).read_text())
    raw["engines"][0]["detect"]["bin"][1] = w.bins["tailscale"]
    Path(w.ctx.env["KYBER_SURFACES_ENGINES"]).write_text(json.dumps(raw))
    peers = {"Peer": {"k1": {"HostName": "laptop\x1b[2J‮gnp.exe", "Online": True, "TailscaleIPs": ["100.1.2.3"]},
                      "k2": {"HostName": fx.INJECTION, "Online": False, "TailscaleIPs": []}}}
    w.answers["run"] = (0, json.dumps(peers), "")
    s = E.EngineSurface("peers")
    data = s.fetch(w.ctx)
    check("command: argv is the detected binary plus the spec's args, nothing else",
          w.calls == [[w.bins["tailscale"], "status", "--json"]], w.calls)
    titles = [r["title"] for r in data["rows"]]
    check("command: an object of peers becomes rows", len(titles) == 2 and data["rows"][0]["subtitle"] == "yes", titles)
    check("command: escape and bidi characters are stripped",
          not any(E.CONTROL.search(t) for t in titles) and "laptop" in titles[0], titles)
    model = s.model(data, None, {"/engine-peers/q": "; rm -rf ~"}, w.ctx)
    encoded = json.dumps(model)
    check("command: an injection in a host name is one row of words", "\\n" not in encoded and
          any("Ignore previous instructions" in r["title"] for r in model["/engine-peers/rows"]), encoded[:200])
    check("command: nothing typed on the glass reached a command", len(w.calls) == 1, w.calls)
    check("engine: has no actions at all", s.actions == {}, s.actions)

    w.answers["run"] = (0, "x" * (E.MOST_BYTES + 1), "")
    try:
        s.fetch(w.ctx)
        check("command: output over 1 MB is refused", False)
    except SurfaceError as err:
        check("command: output over 1 MB is refused", "MB" in str(err), str(err))
    w.answers["run"] = (1, "", "failed to connect to local Tailscale service; is Tailscale running?\nmore")
    try:
        s.fetch(w.ctx)
        check("command: a failure says its first line", False)
    except SurfaceError as err:
        check("command: a failure says its first line", "Tailscale running?" in str(err) and "more" not in str(err))


def test_http_read_and_rows():
    w = World([spec(),
               spec(id="forge", repo="tailscale/tailscale", detect={"bin": ["/nope/gitea"]},
                    read={"url": "http://127.0.0.1:3000/api/v1/repos/search"}, rows="data", install="brew install gitea")])
    models = {"models": [{"name": f"m{i}", "size": 1 << 30} for i in range(20)]}
    w.answers["http://127.0.0.1:11434/api/tags"] = json.dumps(models)
    s = E.EngineSurface("models")
    data = s.fetch(w.ctx)
    model = s.model(data, None, {}, w.ctx)
    check("http: rows are capped at 12 and the note says of how many",
          len(model["/engine-models/rows"]) == 12 and model["/engine-models/note"] == "12 of 20",
          model["/engine-models/note"])
    check("http: bytes format", model["/engine-models/rows"][0]["subtitle"] == "1 GB", model["/engine-models/rows"][0])
    check("http: columns follow the spec's row", [c["field"] for c in model["/engine-models/columns"]] ==
          ["title", "subtitle"])
    check("http: layout lines are single, ids valid", lines_ok(s.layout()))
    w.answers["http://127.0.0.1:11434/api/tags"] = "<html>"
    try:
        s.fetch(w.ctx)
        check("http: not JSON is an error in words", False)
    except SurfaceError as err:
        check("http: not JSON is an error in words", "JSON" in str(err))
    w.answers["http://127.0.0.1:11434/api/tags"] = json.dumps({"other": []})
    try:
        s.fetch(w.ctx)
        check("http: a missing rows path is an error in words", False)
    except SurfaceError as err:
        check("http: a missing rows path is an error in words", "models" in str(err))
    before = len(w.gets)
    try:
        E.EngineSurface("forge").fetch(w.ctx)
        check("http: a bin-detected engine that isn't installed is never polled", False)
    except SurfaceError as err:
        check("http: a bin-detected engine that isn't installed is never polled",
              len(w.gets) == before and "brew install gitea" in str(err), (w.gets, str(err)))
    loading = s.model(None, None, {}, w.ctx)
    check("engine: loading state", loading["/engine-models/note"] == "Loading…")
    err = s.model(None, "Not answering on 11434.", {}, w.ctx)
    check("engine: error state", err["/engine-models/note"] == "Not answering on 11434.")


def test_names_and_walk():
    s = E.EngineSurface("X; rm -rf / && ../..")
    check("engine: a hostile id becomes a safe name", re.fullmatch(r"engine-[a-z0-9-]+", s.name) is not None, s.name)
    check("engine: an empty id is 'unknown'", E.EngineSurface("").name == "engine-unknown")
    doc = {"a": {"b": [10, 20]}, "Peer": {"x": {"n": 1}, "y": {"n": 2}}}
    check("walk: dotted path and index", E.walk(doc, "a.b.1") == 20)
    check("walk: star over an object", E.walk(doc, "Peer.*") == [{"n": 1}, {"n": 2}])
    check("bytes format on a bool draws nothing, not '1 B'", E.field_text(True, "bytes", fx.NOW) == "")
    check("walk: missing is None", E.walk(doc, "a.c.d") is None and E.walk(doc, "a.b.9") is None)
    check("clean: newlines, escapes and bidi go", E.clean("a\nb\x1b[31m‮c") == "a b [31m c")


def test_oss_surface():
    w = World([spec(), spec(id="forge", repo="tailscale/tailscale", detect={"bin": ["/nope/gitea"]},
                            read={"url": "http://127.0.0.1:3000/x"}, rows="data", install="brew install gitea"),
               spec(id="music", repo="navidrome/navidrome")])
    w.answers["http://127.0.0.1:11434/api/version"] = "{}"
    o = oss.Oss("notion")
    data = o.fetch(w.ctx)
    values = o.initial()
    model = o.model(data, None, values, w.ctx)
    rows = model["/oss/rows"]
    check("oss: what replaces Notion, most stars first",
          [r["name"] for r in rows] == ["AppFlowy", "Affine", "Memos", "Closed"], rows)
    check("oss: license buckets", [r["license"] for r in rows] == ["copyleft", "caveat", "remixable", "none"], rows)
    check("oss: layout lines are single, ids valid", lines_ok(o.layout()))
    engines = {e["id"]: e["text"] for e in model["/oss/engines"]}
    check("oss: engine states in words", engines == {
        "models": "Models: running", "forge": "Models: not installed: brew install gitea",
        "music": "music: refused: GPL-3.0 license isn't remixable"}, engines)

    r = o.drill(w.ctx, data, {"row": "usememos/memos"})
    check("oss: More shows one entry", r.ok and r.updates == {"/oss/pick": "usememos/memos"}, r)
    model = o.model(data, None, {**values, **r.updates}, w.ctx)
    detail = json.dumps(model["/oss/detail"])
    check("oss: a description's injection is stripped to one line of words",
          "\\n" not in detail and "\\u202e" not in detail and "Ignore previous" in detail, detail[:160])
    check("oss: a press for an app not in the registry does nothing",
          not o.drill(w.ctx, data, {"row": "evil/thing"}).ok)

    calls = len(w.calls)
    r = o.engine(w.ctx, data, {"row": "forge"})
    check("oss: Show on a missing engine installs nothing and opens nothing",
          not r.ok and not r.opens and len(w.calls) == calls and "Nothing was installed" in r.line, r)
    r = o.engine(w.ctx, data, {"row": "music"})
    check("oss: Show on a refused engine opens nothing", not r.ok and not r.opens, r)
    r = o.engine(w.ctx, data, {"row": "models"})
    check("oss: Show on a running engine opens its panel", r.ok and r.opens == "engine" and r.opens_arg == "models", r)
    r = o.engine(w.ctx, data, {"row": "../../etc"})
    check("oss: an id the spec file never named opens nothing", not r.ok and not r.opens, r)

    model = o.model(data, None, {**values, "/oss/q": ""}, w.ctx)
    check("oss: empty query says how many apps and asks", "7 open source apps" in model["/oss/note"], model["/oss/note"])
    model = o.model(data, None, {**values, "/oss/q": "zzzz"}, w.ctx)
    check("oss: nothing found says so", model["/oss/note"].startswith("Nothing in the registry replaces zzzz"))
    check("oss: loading state", o.model(None, None, values, w.ctx)["/oss/note"] == "Loading…")
    check("oss: only read actions", set(o.actions) == {"ks-drill", "ks-engine"}, set(o.actions))


def main() -> int:
    for t in (test_shipped_file, test_refusals, test_local_url, test_http_for_real, test_command_read,
              test_http_read_and_rows, test_names_and_walk, test_oss_surface):
        t()
    print(f"\n{'FAILED' if failed else 'passed'}: test_surface_engines ({failed} failing)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
