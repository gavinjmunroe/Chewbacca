"""clay-map, clay-go and the Clay navigation package, hermetically.

No browser and no Clay session: queries run against a small fixture map, the
router's hop builder is called directly, and the shipped map files are
checked for shape and for anything that looks like customer data.
"""
import importlib.machinery
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "library/learning/clay-navigation"
sys.path.insert(0, str(ROOT / "bin/lib"))
sys.path.insert(0, str(ROOT / "tools"))


def load_script(name):
    loader = importlib.machinery.SourceFileLoader(name.replace("-", "_"), str(ROOT / "bin" / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


FIXTURE = {
    "schema": "clay-elements/1", "revision": "t", "coverage": {"states": 3},
    "hop_ms": {"/workspaces/{ws}/home": 300, "/workspaces/{ws}/campaigns/inbox": 200},
    "states": {
        "home": {"id": "home", "base": "/workspaces/{ws}/home", "kind": "page", "chain": [], "reached": True, "load_requests": [],
                 "elements": [
                     {"role": "button", "label": "Find leads", "struct": "button", "disposition": "explored", "kind": "modal",
                      "to": "home.abc123", "ms": 120, "unlocked": 5,
                      "requests": [{"method": "GET", "path": "/v3/x", "query": [], "body": [], "status": 200, "ms": 5}]},
                     {"role": "link", "label": "Sequencer", "struct": "a", "disposition": "link", "to": "campaigns-inbox"},
                     {"role": "button", "label": "Send", "struct": "button", "disposition": "gate", "reason": "gate word"}]},
        "home.abc123": {"id": "home.abc123", "base": "/workspaces/{ws}/home", "kind": "modal", "reached": True, "load_requests": [],
                        "chain": [{"role": "button", "label": "Find leads", "key": "button|Find leads"}], "elements": []},
        "campaigns-inbox": {"id": "campaigns-inbox", "base": "/workspaces/{ws}/campaigns/inbox", "kind": "page", "chain": [],
                            "reached": True, "load_requests": [], "elements": []},
    },
}


def run_map(d, *args):
    env = dict(os.environ, CLAY_MAP_DIR=str(d))
    return subprocess.run([sys.executable, str(ROOT / "bin/clay-map"), *args], capture_output=True, text=True, env=env, timeout=30)


def test_queries():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "elements.json").write_text(json.dumps(FIXTURE))
        out = run_map(d, "where", "home", "find")
        assert out.returncode == 0 and '"to": "home.abc123"' in out.stdout, out.stdout + out.stderr
        out = run_map(d, "where", "home", "nothing-like-this")
        assert out.returncode == 1
        out = run_map(d, "unlocks", "home.abc123")
        assert "home :: button:Find leads" in out.stdout, out.stdout
        out = run_map(d, "path", "home.abc123", "campaigns-inbox")
        path = json.loads(out.stdout)
        # From a modal, the cheapest way to the inbox is one router hop.
        assert path["total_ms"] == 200 and path["steps"][0]["do"].startswith("router hop"), path
        out = run_map(d, "path", "home", "home.abc123")
        assert json.loads(out.stdout)["total_ms"] == 120


def test_clay_go_hops_and_refusals():
    go = load_script("clay-go")
    routes = json.loads((PKG / "routes.json").read_text())
    states = routes["states"]
    assert go.chain(states, "column-settings") == ["table", "column-menu", "column-settings"]
    hops = go.build_hops(states, "column-settings", {"ws": "1", "t": "t_x", "wb": "wb_y", "column": "email"}, routes["gate_words"])
    assert hops[0]["spec"]["url"] == "/workspaces/1/workbooks/wb_y/tables/t_x"
    assert hops[1]["spec"]["clicks"][0]["name"] == "email"
    try:
        go.build_hops(states, "table", {"ws": "1"}, routes["gate_words"])
    except SystemExit as e:
        assert "--t" in str(e) or "--wb" in str(e)
    else:
        raise AssertionError("a table hop without ids must refuse")
    gate = re.compile(r"\b(" + routes["gate_words"] + r")\b", re.I)
    for word in ("Launch sequence", "Save", "Run column", "Send", "Delete view", "Add to blocklist", "Pause", "Complete"):
        assert gate.search(word), word
    for word in ("Open Sidebar", "History", "Lead setup", "Default view", "Events"):
        assert not gate.search(word), word
    # Every click step whose label could match a gate word is marked as a menu, tab or filter.
    for sid, st in states.items():
        assert ("url" in st) != ("parent" in st), sid
        if "parent" in st:
            assert st["parent"] in states, sid
        for step in st.get("steps", []):
            c = step["click"]
            name = c.get("name") or ""
            if name and not name.startswith("{") and gate.search(name):
                assert c.get("kind") in ("menu", "tab", "nav"), (sid, name)


def test_crawl_helpers_keep_no_values():
    import clay_crawl as cc
    assert cc.pattern("https://app.clay.com/workspaces/123456/workbooks/wb_0zzzz3fakefakefakeC/tables/t_0zzzz1fakefakefakeA/views/gv_0zzzz4fakefakefakeD") \
        == "/workspaces/{ws}/workbooks/{wb}/tables/{t}/views/{gv}"
    assert cc.pattern("/workspaces/1/campaigns/cam_0zzzz2fakefakefakeB?tab=replies&x=1") == "/workspaces/{ws}/campaigns/{cam}?tab=replies"
    reqs = cc.clean_requests([
        {"method": "POST", "path": "/v3/a", "query": ["q"], "body": ["f_0zzzz1fakefakefakeA", "email"], "status": 200, "ms": 9},
        {"method": "POST", "path": "/v3/a", "query": ["q"], "body": ["email", "f_0zzzz1fakefakefakeA"], "status": 200, "ms": 9},
    ])
    assert reqs == [{"method": "POST", "path": "/v3/a", "query": ["q"], "body": ["email", "{f}"], "status": 200, "ms": 9}]


def test_package_validates():
    import ux_learning
    value, _ = ux_learning.package(PKG / "package.json")
    ids = {e["id"]: e for e in value["edges"]}
    for gate in ("confirm-launch", "send-campaign", "use-sculptor", "add-work-email"):
        assert ids[gate]["forbidden"], gate
    r = ux_learning.route(value, "home", "credits")
    assert r["reachable"], r
    r = ux_learning.route(value, "home", "gate-held")
    assert not r["reachable"], "no route may end on a gate"


def test_sanitizer_drops_values_on_synthetic_payloads():
    import clay_sanitize as cs
    vocab = {"Find leads", "Open Sidebar", "Members", "Sequence actions", "Reply rate", "Acme Fund", "v3", "workspaces",
             "leads", "email", "replies", "label", "table-header-field-"}
    san = cs.Sanitizer(vocab=vocab, names=["Acme Fund"])
    hostile = {
        "states": {
            "people-jane.doe@example.com": {
                "base": "/workspaces/{ws}/people/123456/jane.doe@example.com", "kind": "page", "chain": [], "reached": True,
                "redirects_to": "/workspaces/{ws}/campaigns/cam_0zzzz2fakefakefakeB?tab=replies&token=abcd1234efgh5678ijkl",
                "load_requests": [{"method": "POST", "path": "/v3/workspaces/4400417/leads/jane@example.com",
                                   "query": ["token", "x-ABCDEF1234567890abcdef"], "body": ["email", "f_0zzzz1fakefakefakeA"],
                                   "status": 200, "ms": 12, "headers": {"authorization": "Bearer sk-live-123"},
                                   "values": {"email": "jane@example.com"}}],
                "elements": [
                    {"role": "button", "label": "Jane Doe", "struct": "button", "disposition": "explored", "cookie": "sid=1"},
                    {"role": "button", "label": "Call +1 (310) 555-0199", "struct": "button", "disposition": "explored"},
                    {"role": "button", "label": "Acme Fund", "struct": "button", "disposition": "explored"},
                    {"role": "button", "label": "Members 5", "struct": "button#row-jane@example.com", "disposition": "explored"},
                    {"role": "link", "label": "Open", "struct": "a", "disposition": "link",
                     "to": "mailto:jane.doe@example.com", "unlocked_sample": ["button:Bearer abc", "button:Find leads"]},
                    {"role": "button", "label": "Find leads", "struct": "button", "disposition": "gate",
                     "reason": "tried to write: POST /v3/x/jane@example.com, PATCH /v3/t_0zzzz1fakefakefakeA/9999999"},
                ]}},
        "coverage": {"unexplored_list": [{"state": "people-jane.doe@example.com", "element": "button:Jane Doe", "why": "x"}]},
        "hop_ms": {"/workspaces/{ws}/people/987654321": 300},
    }
    out = json.dumps(san.map(hostile)) + json.dumps(san.endpoints({"a": {
        "method": "GET", "path": "/v3/u/bob@example.com?api_key=SECRET123456789012345", "query": ["api_key"], "body": [],
        "statuses": [200, "Bearer x"], "fired_by": ["people-jane.doe@example.com :: button:Jane Doe"]}}))
    for bad in ("jane", "Jane", "doe", "example.com", "555", "0199", "Acme", "Bearer", "sk-live", "sid=1", "abcd1234",
                "SECRET", "4400417", "987654321", "123456", "9999999", "0zzzz1fakefakefakeA", "0zzzz2fakefakefakeB",
                "headers", "values", "cookie"):
        assert bad not in out, (bad, out[:400])
    assert "Find leads" in out and "Members #" in out, out[:400]
    assert not cs.find_leaks(out), cs.find_leaks(out)


def test_allowed_word_plus_pii_never_passes():
    """An allowed word inside a longer string must not carry the rest through."""
    import clay_sanitize as cs
    vocab = {"Find leads", "Members", "label", "email", "v3", "workspaces", "replies", "table-header-field-N", "Reply rate"}
    san = cs.Sanitizer(vocab=vocab)
    assert san.label("Find leads John Smith") == "<data>"
    assert san.label("John Smith Find leads") == "<data>"
    assert san.label("Members John") == "<data>"
    assert san.label("Members 12") == "Members #"
    assert san.label("Reply rate 4.5%") == "Reply rate #%"
    assert san.label("Find leads") == "Find leads"
    assert san.key("label_John Smith") == "{x}"
    assert san.key("labelJohn") == "{x}"
    assert san.key("email_jane@example.com") == "{x}"
    assert san.key("email") == "email"
    assert san.path("/v3/workspaces/jane@example.com/label_john") == "/v3/workspaces/{x}/{x}"
    assert san.path("/v3/workspaces-john/replies") == "/v3/{x}/replies"
    assert san.path("/x?tab=replies&email=jane@example.com") == "/{x}?tab=replies"
    assert san.path("/x?tab=replies-jane") == "/{x}"
    assert san.testid("table-header-field-N") == "table-header-field-N"
    assert san.testid("table-header-field-john") == "{testid}"
    assert san.struct("button#label-jane@x.com>div") == "button#{testid}@other>div"
    assert san.struct("div@content-jane>a") == "div@other>a"
    assert san.role_label("button-jane:Find leads Jane") == "other:<data>"
    assert san.target("johnsmith.com") == "<external>"
    assert san.reason("tried to write: POST /v3/leads/jane@example.com") == "tried to write"
    assert san.reason("gate word plus jane") == "other"
    req = san.request({"method": "post", "path": "/v3/leads/9876543", "query": ["email", "email=jane"],
                       "body": ["email", "label John"], "status": "Bearer x", "ms": True, "headers": {"cookie": "a"}})
    assert req == {"method": "POST", "path": "/v3/{x}/{n}", "query": ["email", "{x}"], "body": ["email", "{x}"],
                   "status": None, "ms": None}, req


def test_registry_link_matches_by_shape():
    import clay_registry_link as rl
    idx = rl.index(ROOT)
    if not idx:
        return  # registry not present in this checkout
    assert "inbox" in idx.get(rl.shape("POST", "/v3/workspaces/{n}/clay-sequencer/master-inbox/replies"), []), idx
    assert not idx.get(rl.shape("GET", "/v3/workspaces/{n}/clay-sequencer/master-inbox/replies"))
    assert not idx.get(rl.shape("POST", "/v3/workspaces/{n}/clay-sequencer/master-inbox/replies/extra"))


def test_crawl_logs_carry_no_pii():
    """A crawl step's log output, fed synthetic PII everywhere it could enter."""
    import contextlib
    import io
    import clay_crawl as cc

    class Page:
        _vocab = ["Find leads", "Members"]

    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        c = cc.Crawl(Page(), "4400417", log=print)
        c.names = ["Acme Fund"]
        pii_sid = "people-jane.doe@example.com-t_0zzzz1fakefakefakeA"
        el = {"role": "button-jane", "label": "Jane Doe +1 (310) 555-0199 jane@example.com"}
        r = {"timing": {"first_ms": "jane@example.com"}, "fresh_count": "Acme Fund",
             "url1": "https://app.clay.com/workspaces/4400417/tables/t_0zzzz1fakefakefakeA?token=abcdef0123456789abcdef"}
        c.log_press(pii_sid, el, "panel jane@example.com", "/workspaces/4400417/people/jane@example.com", r)
        c.log_press("home", {"role": "button", "label": "Members 12"}, "menu", None, {"timing": {"first_ms": 40}, "fresh_count": 3})
        c.log_error(pii_sid, RuntimeError("GET https://api.clay.com/v3/x?email=jane@example.com Bearer sk-live-1"))
        c.log(f"[pass 1] {c.ref(pii_sid)} (3 states)")
        c.states["known"] = {"base": "/workspaces/{ws}/people/jane.doe@example.com/t_0zzzz1fakefakefakeA"}
        c.log(f"[pass 1] {c.ref('known')} (3 states)")
        c.log("raw line with jane@example.com and t_0zzzz1fakefakefakeA and 44004170 and Bearer abc")
    text = out.getvalue()
    for bad in ("jane", "Jane", "Doe", "example.com", "555", "0199", "Acme", "4400417", "0zzzz1fakefakefakeA",
                "abcdef0123456789", "sk-live", "Bearer", "https", "@"):
        assert bad not in text, (bad, text)
    assert "button:Members #" in text and "(40 ms, +3)" in text and "RuntimeError" in text, text


def _strings(x):
    """Every string value. Dict keys are the map's own schema, never data."""
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from _strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v)


def test_no_private_name_in_the_shipped_map():
    """Every name a person typed that this Mac knows (the clay CLI listing and
    the gtm-memory store: tables, columns, campaigns, clients, contacts,
    accounts, emails, domains) must be absent from the committed map. A string
    equal to a name fails, and so does any name of six or more characters with a
    space, @ or dot found anywhere in a file. Skips where no store exists."""
    import clay_private_names
    names = clay_private_names.names()
    if not names:
        return
    # The kit's own op names (library/clay-api/registry.json) are repo words,
    # not typed data; one of them is spelled like a column in the workspace.
    try:
        ops = {o["name"].lower() for o in json.loads((ROOT / "library/clay-api/registry.json").read_text())["ops"]}
    except (OSError, ValueError, KeyError):
        ops = set()
    curated = {k.lower() for k in json.loads((PKG / "routes.json").read_text())["states"]}
    low = {n.lower() for n in names} - ops - curated
    long_names = [n.lower() for n in names if len(n) >= 6 and any(c in n for c in " @.")]
    for name in ("elements.json", "routes.json", "package.json"):
        p = PKG / name
        if not p.exists():
            continue
        text = p.read_text()
        equal = sorted({s for s in _strings(json.loads(text)) if s.strip().lower() in low})
        assert not equal, f"{name}: {len(equal)} strings equal a private name"
        lowered = text.lower()
        inside = [n for n in long_names if n in lowered]
        assert not inside, f"{name}: {len(inside)} private names appear inside"


LOOKALIKES = ["https://app.clay.com.evil.example/home", "https://evil.example/?app.clay.com", "https://notapp.clay.com/",
              "http://app.clay.com/", "https://app.clay.com:8443/", "https://user@app.clay.com/", "https://evil.example/app.clay.com",
              "https://xapp.clay.com/", "javascript:alert(1)//app.clay.com"]


def test_crawler_acts_only_on_exact_clay_origin():
    import clay_crawl as cc
    assert cc.is_clay_origin("https://app.clay.com/workspaces/1/home")
    assert cc.is_clay_origin("https://app.clay.com:443/x")
    for url in LOOKALIKES:
        assert not cc.is_clay_origin(url), url

    class Page(cc.Page):
        def __init__(self):
            self.sid = "s"
    sent = []
    orig = cc.cdp
    try:
        cc.cdp = lambda method, **kw: sent.append(kw.get("expression", "")) or {"result": {"value": cc.OFF_ORIGIN}}
        p = Page()
        try:
            p.js("window.__cm.enum()", _retry=False)
        except cc.OffOrigin:
            pass
        else:
            raise AssertionError("an off-origin page must refuse the evaluation")
    finally:
        cc.cdp = orig
    assert sent and sent[0].startswith('(location.origin === "https://app.clay.com") ?'), sent


def test_guard_records_only_exact_api_origin():
    """The page guard, run in node: a lookalike host is not Clay's API, so its
    POST is neither logged as Clay nor blocked; Clay's own write is blocked."""
    if not shutil.which("node"):
        return
    guard = (ROOT / "bin/lib/clay_guard.js").read_text().strip().rstrip(";")
    script = """
const vm = require('vm');
const calls = [];
const ctx = {URL, JSON, Promise, TypeError, console, performance: {now: () => 0},
  location: {href: 'https://app.clay.com/workspaces/1/home'}, navigator: {},
  XMLHttpRequest: function () {}, WebSocket: function () {}};
ctx.XMLHttpRequest.prototype = {open() {}, send() {}, addEventListener() {}};
ctx.WebSocket.prototype = {send() {}};
ctx.window = ctx;
ctx.fetch = (u, i) => { calls.push(String(u)); return Promise.resolve({status: 200}); };
vm.createContext(ctx);
vm.runInContext('(' + process.argv[1] + ')("strict", [])', ctx);
const g = ctx.__clayGuard;
const look = JSON.parse(process.argv[2]);
const out = {api: g.isApi('https://api.clay.com/v3/x'), look: look.map((u) => g.isApi(u.replace('app.', 'api.')))};
ctx.window.fetch('https://api.clay.com.evil.example/v3/tables', {method: 'POST', body: '{}'}).then(() => {
  ctx.window.fetch('https://api.clay.com/v3/tables/x', {method: 'PATCH', body: '{}'}).catch(() => {
    out.logged = g.log.map((r) => r.path); out.blocked = g.blocked; out.passed = calls;
    console.log(JSON.stringify(out));
  });
});
"""
    # user@api.clay.com really is Clay's API host; a request there is Clay's.
    looks = [u for u in LOOKALIKES if "user@" not in u]
    out = subprocess.run(["node", "-e", script, guard, json.dumps(looks)], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["api"] is True and not any(r["look"]), r
    assert r["passed"] == ["https://api.clay.com.evil.example/v3/tables"], r
    assert r["blocked"] == ["PATCH /v3/tables/x"], r
    assert r["logged"] == ["/v3/tables/x"], r


def test_committed_map_files_have_no_leaks():
    import clay_sanitize as cs
    for name in ("elements.json", "routes.json", "package.json"):
        p = PKG / name
        if p.exists():
            assert not cs.find_leaks(p.read_text()), (name, cs.find_leaks(p.read_text()))


def test_no_customer_data_in_shipped_map():
    """Emails, Clay object ids and long digit runs never ship. When the clay CLI
    is signed in, every workspace name it lists (tables, campaigns, workflows,
    workbooks) is checked too; the names themselves never appear in this file."""
    import clay_sanitize as cs
    names = []
    if shutil.which("clay"):
        for args in (["tables", "list"], ["campaigns", "list"], ["workflows", "list"], ["workbooks", "list"]):
            try:
                out = subprocess.run(["clay", *args], capture_output=True, text=True, timeout=30)
                names += [d.get("name", "") for d in json.loads(out.stdout).get("data", [])]
            except (OSError, ValueError, subprocess.TimeoutExpired):
                pass
    # Generic words a workspace can name a table with are not evidence of a leak.
    names = [n for n in names if len(n) >= 12]
    for name in ("routes.json", "elements.json", "package.json", "procedure.md"):
        p = PKG / name
        if not p.exists():
            continue
        text = p.read_text()
        assert not re.search(r"[\w.+-]+@[\w-]+\.[a-z]{2,}", text), name
        assert not re.search(r"\b(t|wb|cam|wf|gv|audseg)_[A-Za-z0-9]{10,}", text), name
        for n in names:
            assert n not in text, f"{name} contains a workspace name"


def main():
    for t in (test_queries, test_clay_go_hops_and_refusals, test_crawl_helpers_keep_no_values, test_package_validates,
              test_sanitizer_drops_values_on_synthetic_payloads, test_allowed_word_plus_pii_never_passes,
              test_registry_link_matches_by_shape, test_crawl_logs_carry_no_pii, test_no_private_name_in_the_shipped_map,
              test_crawler_acts_only_on_exact_clay_origin, test_guard_records_only_exact_api_origin,
              test_committed_map_files_have_no_leaks,
              test_no_customer_data_in_shipped_map):
        t()
        print("ok", t.__name__)


if __name__ == "__main__":
    main()
