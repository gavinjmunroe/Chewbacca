"""chewbacca clay: routing, the write gate, and the JSON it prints.

Hermetic. CHEWBACCA_CLAY_FIXTURES points the front door at recorded surface
answers written below, so no Clay session, CLI, browser or network is used.
Every fixture is synthetic: example.com addresses, made-up ids, no rows from a
real workspace. A measured.json in a temp dir decides which surface is fastest.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "bin" / "chewbacca-clay"
LIB = ROOT / "library" / "clay-api"

OK_BALANCE = {"ok": True, "class": "ok", "tier": 1, "ms": 120, "data": {"balance": 1234.5, "actionExecutionBalance": 0}}
CLI_BALANCE = {"exit": 0, "stdout": json.dumps({"balance": 1234.5, "workspace": {"id": "1", "name": "Example"}}), "stderr": ""}
AUTH_FAIL = {"ok": False, "class": "auth", "reason": "not logged in", "next": "api-anything login clay", "ms": 90}
INPUT_FAIL = {"ok": False, "class": "input", "reason": "param tableId must be a table id", "ms": 3}
CUT = {"ok": True, "class": "ok", "tier": 1, "ms": 300, "data": [{"id": "f_1"}], "truncated": "showing 1 of 40 items"}
CLI_COLUMNS = {"exit": 0, "stdout": json.dumps({"data": [{"id": f"f_{i}", "name": f"Column {i}", "type": "basic"} for i in range(40)]}), "stderr": ""}
RESOURCES = {
    "ok": True, "class": "ok", "tier": 1, "ms": 150,
    "data": [
        {"id": "t_example1", "name": "Example table", "resourceType": "TABLE"},
        {"id": "wb_example1", "name": "Example workbook", "resourceType": "WORKBOOK"},
        {"id": "f_example1", "name": "Example folder", "resourceType": "FOLDER"},
    ],
}
SENT = {"ok": True, "class": "ok", "tier": 1, "ms": 200, "data": {"ok": True}}

checks = 0


def ok(cond, msg):
    global checks
    assert cond, msg
    checks += 1


def run(fixtures, measured, *args, env_extra=None):
    with tempfile.TemporaryDirectory() as d:
        base = Path(d)
        for rel, body in fixtures.items():
            f = base / "fx" / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(body))
        (base / "fx").mkdir(exist_ok=True)
        m = base / "measured.json"
        m.write_text(json.dumps(measured))
        env = dict(os.environ, CHEWBACCA_CLAY_FIXTURES=str(base / "fx"), CHEWBACCA_CLAY_MEASURED=str(m),
                   CHEWBACCA_CLAY_LIB=str(LIB), API_ANYTHING_HOME=str(base / "engine-home"))
        env.pop("CLAY_WORKSPACE_ID", None)
        # tests/run.sh exports CHEWBACCA_NO_SEND=1 for every check, and it refuses
        # before --allow-writes is read, so the write-gate cases saw the wrong
        # reason under the suite and passed alone. Fixture mode never reaches a
        # real surface; the one case about NO_SEND sets it itself.
        env.pop("CHEWBACCA_NO_SEND", None)
        env.update(env_extra or {})
        p = subprocess.run(["node", str(TOOL), *args], capture_output=True, text=True, env=env, timeout=60)
        try:
            out = json.loads(p.stdout)
        except json.JSONDecodeError:
            out = None
        return p.returncode, out, p


def registry_and_spec():
    reg = json.loads((LIB / "registry.json").read_text())
    spec = json.loads((LIB / "clay.json").read_text())
    return reg, spec


def test_registry_matches_spec():
    reg, spec = registry_and_spec()
    sops = {o["name"]: o for o in spec["operations"]}
    for op in reg["ops"]:
        for s in op["surfaces"]:
            if s["type"] == "api-anything":
                ok(s["op"] in sops, f"{op['name']} names {s['op']}, missing from clay.json")
                ok(sops[s["op"]]["readOnly"] == (op["kind"] == "read"), f"{op['name']}: read/write disagrees with the spec")
                params = {p["name"] for p in sops[s["op"]]["params"]}
                ok(set(s["args"]) <= params, f"{op['name']}: maps args the spec op does not take")
    # Every spec write is gated through the registry, and nothing else writes.
    gated = {s["op"] for op in reg["ops"] if op["kind"] == "write" for s in op["surfaces"]}
    ok({n for n, o in sops.items() if not o["readOnly"]} == gated, "a spec write is not behind the registry's gate")
    for op in reg["ops"]:
        ok(op["gate"] == "read" if op["kind"] == "read" else op["gate"].startswith("write:"), f"{op['name']} gate class")
    untaught = {w["name"] for w in reg["untaught_writes"]}
    for name in ("add-column", "update-column", "run-cells", "add-rows", "import", "add-leads"):
        ok(name in untaught, f"{name} is not recorded as an untaught write")
    # The spec carries references, never a credential: no cookie or auth header, no session value.
    for o in spec["operations"]:
        hdrs = {k.lower() for k in o["request"]["headers"]}
        ok(not hdrs & {"cookie", "authorization", "x-csrf-token"}, f"{o['name']} stores a credential header")
    ok("claysession=" not in (LIB / "clay.json").read_text(), "a session cookie value is in the spec")
    ok(reg["engine"]["sha"] and len(reg["engine"]["sha"]) == 40, "the engine is not pinned to a full commit")


def test_ops_json_shape():
    code, out, p = run({}, {"credits": {"api-anything:creditBalance": {"ms": 900, "at": "2026-10-09", "tier": 1}}}, "ops")
    ok(code == 0 and out and out["ok"] is True, f"ops failed: {p.stderr}")
    names = {o["op"] for o in out["ops"]}
    for name in ("workspaces", "rows", "inbox", "thread", "credits", "reply", "forward", "blocklist-add"):
        ok(name in names, f"ops is missing {name}")
    credits = next(o for o in out["ops"] if o["op"] == "credits")
    ok(set(credits) >= {"op", "kind", "gate", "args", "summary", "surfaces", "ui"}, "op entry keys")
    s0 = next(s for s in credits["surfaces"] if s["surface"] == "api-anything")
    ok(set(s0) >= {"surface", "call", "ms", "tier", "last_verified"}, "surface entry keys")
    ok(s0["ms"] == 900 and s0["last_verified"] == "2026-10-09", "measured ms and date are reported")
    ok(all(o["kind"] in ("read", "write") for o in out["ops"]), "kind is read or write")
    ok(out["untaught_writes"] and all(w["taught"] is False for w in out["untaught_writes"]), "untaught writes listed")
    ok(out["ui_only"] and all("route" in u for u in out["ui_only"]), "ui-only jobs carry a route")


def test_routes_to_fastest_measured():
    fx = {"api-anything/creditBalance.json": OK_BALANCE, "cli/credits.json": CLI_BALANCE}
    slow_api = {"credits": {"api-anything:creditBalance": {"ms": 3000}, "cli:credits balance": {"ms": 800}}}
    code, out, _ = run(fx, slow_api, "credits")
    ok(code == 0 and out["surface"] == "cli", f"cli was measured faster, got {out and out.get('surface')}")
    ok(out["data"]["balance"] == 1234.5 and len(out["tried"]) == 1, "one call, cli data")
    fast_api = {"credits": {"api-anything:creditBalance": {"ms": 400}, "cli:credits balance": {"ms": 2500}}}
    code, out, _ = run(fx, fast_api, "credits")
    ok(code == 0 and out["surface"] == "api-anything" and out["tier"] == 1, "api-anything was measured faster")
    ok(set(out) >= {"ok", "op", "surface", "call", "ms", "tried", "data"}, f"result keys: {sorted(out)}")
    code, route, _ = run({}, fast_api, "route", "credits")
    ok([r["surface"] for r in route["order"]][:2] == ["api-anything", "cli"], "route lists fastest first")
    # A fixed-order op keeps its richer surface first even when a thinner one is faster.
    fast_cli = {"table": {"cli:tables get {table}": {"ms": 300}, "api-anything:getTable": {"ms": 3000}}}
    code, route, _ = run({}, fast_cli, "route", "table", "table=t_example1")
    ok([r["surface"] for r in route["order"]] == ["api-anything", "cli"], "table keeps the auto-run surface first")


def test_falls_through_on_failure_and_truncation():
    fx = {"api-anything/creditBalance.json": AUTH_FAIL, "cli/credits.json": CLI_BALANCE}
    code, out, _ = run(fx, {}, "credits")
    ok(code == 0 and out["surface"] == "cli", "auth failure on api-anything falls to the CLI")
    ok([t["ok"] for t in out["tried"]] == [False, True] and out["tried"][0]["class"] == "auth", "tried records both")
    fx = {"api-anything/getTableColumns.json": CUT, "cli/columns.json": CLI_COLUMNS}
    code, out, _ = run(fx, {}, "columns", "table=t_example1")
    ok(code == 0 and out["surface"] == "cli" and len(out["data"]) == 40, "a cut result falls to the uncut CLI")
    ok("truncated" in out["tried"][0], "the cut attempt says so")
    fx = {"api-anything/getTableColumns.json": INPUT_FAIL, "cli/columns.json": CLI_COLUMNS}
    code, out, _ = run(fx, {}, "columns", "table=t_example1")
    ok(code == 1 and out["class"] == "input" and len(out["tried"]) == 1, "an input error stops, no fallthrough")
    ok(out["ui"] == "clay-go column-settings --table t_example1", "a failure names the UI route")
    code, out, _ = run({"api-anything/creditBalance.json": AUTH_FAIL}, {}, "credits")
    ok(code == 1 and out["ok"] is False and out["ui"] == "clay-go credits", "every surface failing exits 1 with the route")


def test_args_pick_the_surface():
    code, route, _ = run({}, {}, "route", "rows", "table=t_example1")
    ok([r["call"] for r in route["order"]] == ["cli:tables rows list {table}"], "no view: only the CLI can page rows")
    code, route, _ = run({}, {}, "route", "rows", "table=t_example1", "view=gv_example1")
    ok([r["call"] for r in route["order"]][0] == "api-anything:listRows", "a view makes the api op eligible")
    code, route, _ = run({}, {}, "route", "rows", "table=t_example1", "view=gv_example1", "after=r_example9")
    ok([r["call"] for r in route["order"]] == ["api-anything:listRowsAfter"], "after= is the api page cursor only")
    code, route, _ = run({}, {}, "route", "campaign-leads", "campaign=cam_example1", "cursor=abc")
    ok([r["call"] for r in route["order"]] == ["api-anything:campaignLeadsNext"], "cursor routes to the next-page op")
    fx = {"api-anything/listResources.json": RESOURCES}
    code, out, _ = run(fx, {}, "tables", "--surface", "api")
    ok(code == 0 and [r["id"] for r in out["data"]] == ["t_example1"], "tables filters the one-call resource list")
    code, out, _ = run({}, {}, "row", "table=t_example1")
    ok(code == 2 and out["class"] == "input", "a missing required arg is a usage error")
    code, out, _ = run({}, {}, "credits", "bogus=1")
    ok(code == 2 and "unknown arg" in out["reason"], "an unknown arg is refused before any call")
    code, route, _ = run({}, {}, "route", "rows", "table=--filter")
    ok(route["order"] == [], "a value shaped like a flag never reaches the CLI argv")
    code, out, _ = run({}, {}, "no-such-op")
    ok(code == 2 and out["class"] == "usage", "unknown op")


def test_write_gate():
    args = ("blocklist-add", "emailOrDomain=blocked.example")
    # No fixture for the write: if the gate ever let it through, the run would fail with
    # "no fixture" (exit 1), never the refusal (exit 3) these assert.
    code, out, _ = run({}, {}, *args)
    ok(code == 3 and out["class"] == "refused" and "allow-writes" in out["reason"], "a write without --allow-writes")
    ok("confirm" not in out, "the refusal never hands back an approval token (review 2026-10-09: self-approval)")
    ok(out["payload"]["args"]["ws"] == "1372623", "the refusal shows the payload")
    code, out, _ = run({}, {}, *args, "--allow-writes")
    ok(code == 3 and "did not approve" in out["reason"], "--allow-writes with nobody typing is refused")
    code, out, _ = run({}, {}, *args, "--allow-writes", env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": "reply"})
    ok(code == 3, "typing a different op name is refused")
    code, out, _ = run({"api-anything/blocklistAdd.json": SENT}, {}, *args, "--allow-writes",
                       env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": "blocklist-add", "CHEWBACCA_NO_SEND": "1"})
    ok(code == 3 and "NO_SEND" in out["reason"], "CHEWBACCA_NO_SEND=1 refuses even an approved write")
    code, out, _ = run({"api-anything/blocklistAdd.json": SENT}, {}, *args, "--allow-writes",
                       env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": "blocklist-add"})
    ok(code == 0 and out["ok"] is True and out["surface"] == "api-anything", "--allow-writes and a typed approval let it run")
    fail = {"api-anything/inboxReply.json": {"ok": False, "class": "error", "reason": "500", "ms": 10}}
    reply = ("reply", "campaign_id=1", 'reply_data={"email_stats_id":"s1","email_body":"x"}')
    code, out, _ = run(fail, {}, *reply, "--allow-writes", env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": "reply"})
    ok(code == 1 and len(out["tried"]) == 1, "a failed write is sent once and never retried on another surface")
    # Slots go into an authenticated api.clay.com URL: a path or query in a value is refused.
    for bad in ("table=../../workspaces/9/x", "table=t_1?x=y", "table=t_1/rows", "ws=1372623/../9", "limit=5;rm"):
        k = bad.split("=")[0]
        op = {"table": "table", "ws": "tables", "limit": "rows"}[k]
        extra = ("table=t_ok1",) if op == "rows" else ()
        code, out, _ = run({}, {}, op, bad, *extra)
        ok(code == 2 and out["class"] == "input", f"a crafted slot is refused before any call: {bad}")
    code, out, _ = run({}, {}, "run-cells", "table=t_example1")
    ok(code == 3 and out["class"] == "untaught" and out["gate"] == "write:spends-credits", "an untaught write refuses")
    code, out, _ = run({}, {}, "measure", "reply")
    ok(code == 3 and out["class"] == "refused", "measure never runs a write")


def test_a_relabelled_write_is_still_gated():
    # Review of b68d5645: a registry that calls blocklist-add a read, or an env var
    # pointing at such a registry, must not get past the person-at-a-terminal gate.
    reg = json.loads((LIB / "registry.json").read_text())
    for op in reg["ops"]:
        if op["name"] == "blocklist-add":
            op["kind"], op["gate"] = "read", "read"
    with tempfile.TemporaryDirectory() as d:
        lib = Path(d) / "lib"
        lib.mkdir()
        (lib / "registry.json").write_text(json.dumps(reg))
        (lib / "clay.json").write_text((LIB / "clay.json").read_text())
        code, out, _ = run({}, {}, "blocklist-add", "emailOrDomain=blocked.example", env_extra={"CHEWBACCA_CLAY_LIB": str(lib)})
        ok(code == 3 and out["class"] == "refused", "a POST relabelled as a read still needs --allow-writes and a person")
        env = dict(os.environ, CHEWBACCA_CLAY_LIB=str(lib), API_ANYTHING_HOME=str(Path(d) / "home"),
                   CHEWBACCA_CLAY_MEASURED=str(Path(d) / "m.json"))
        env.pop("CHEWBACCA_CLAY_FIXTURES", None)
        (Path(d) / "m.json").write_text("{}")
        p = subprocess.run(["node", str(TOOL), "ops"], capture_output=True, text=True, env=env, timeout=60)
        ops = {o["op"]: o for o in json.loads(p.stdout)["ops"]}
        ok(ops["blocklist-add"]["kind"] == "write", "live, CHEWBACCA_CLAY_LIB is ignored and the repo registry is read")


def test_refuses_an_unpinned_engine():
    # Not fixture mode: the front door finds this fake engine, hashes it, and must refuse it
    # before importing it. Importing would write the marker file.
    with tempfile.TemporaryDirectory() as d:
        dist = Path(d) / "dist"
        dist.mkdir()
        marker = Path(d) / "imported"
        (dist / "execute.js").write_text(
            f"require('fs').writeFileSync({json.dumps(str(marker))}, 'x'); exports.call = async () => ({{ok: true, data: 1}});\n"
        )
        (Path(d) / "m.json").write_text("{}")
        env = dict(os.environ, API_ANYTHING_DIST=str(dist), API_ANYTHING_HOME=str(Path(d) / "home"),
                   CHEWBACCA_CLAY_MEASURED=str(Path(d) / "m.json"))
        env.pop("CHEWBACCA_CLAY_FIXTURES", None)
        env["CHEWBACCA_CLAY_TRUST_ENGINE"] = "1"  # no longer an escape hatch (review of b68d5645)
        p = subprocess.run(["node", str(TOOL), "credits", "--surface", "api"], capture_output=True, text=True,
                           env=env, timeout=60)
        out = json.loads(p.stdout)
        ok(p.returncode == 1 and "pinned commit" in out["tried"][0]["reason"], f"an unpinned engine ran: {p.stdout[:300]}")
        ok(not marker.exists(), "the unpinned engine was imported before it was refused")


def test_ui_only_prints_route():
    code, out, _ = run({}, {}, "start-campaign", "campaign=cam_example1")
    ok(code == 0 and out["surface"] == "ui" and out["done"] is False, "a UI-only job is not claimed done")
    ok(out["route"] == "clay-go campaign --campaign cam_example1", f"route filled: {out['route']}")


def test_inbox_adapter_keeps_clay_inbox_shape():
    replies = {"ok": True, "class": "ok", "tier": 1, "ms": 100, "data": [
        {"email_campaign_id": 11, "email_lead_id": "21", "lead_email": "lead.one@example.com", "email_campaign_name": "Example A"},
        {"email_campaign_id": 12, "email_lead_id": "22", "lead_email": "lead.two@example.com", "email_campaign_name": "Example B"},
    ]}
    history = {"ok": True, "class": "ok", "tier": 1, "ms": 80, "data": {"history": [{"type": "SENT", "message_id": "m1"}]}}
    with tempfile.TemporaryDirectory() as d:
        fx = Path(d) / "fx" / "api-anything"
        fx.mkdir(parents=True)
        (fx / "inboxReplies.json").write_text(json.dumps(replies))
        (fx / "threadHistory.json").write_text(json.dumps(history))
        (Path(d) / "m.json").write_text("{}")
        env = dict(os.environ, CHEWBACCA_CLAY_FIXTURES=str(Path(d) / "fx"), CHEWBACCA_CLAY_MEASURED=str(Path(d) / "m.json"))
        code = (
            "import json, sys; sys.path.insert(0, sys.argv[1]); import clay_ops_inbox as c;"
            "print(json.dumps(c.fetch_inbox('1')))"
        )
        p = subprocess.run(["python3", "-c", code, str(ROOT / "bin" / "lib")], capture_output=True, text=True,
                           env=env, timeout=120)
        ok(p.returncode == 0, f"adapter failed: {p.stderr[-400:]}")
        got = json.loads(p.stdout)
        ok(len(got) == 2 and all(r["history"]["history"][0]["message_id"] == "m1" for r in got),
           "each reply carries its thread under history, as clay-inbox returns it")
        (fx / "threadHistory.json").write_text(json.dumps({"ok": False, "class": "auth", "reason": "signed out", "ms": 5}))
        p = subprocess.run(["python3", "-c", code, str(ROOT / "bin" / "lib")], capture_output=True, text=True,
                           env=env, timeout=120)
        ok(p.returncode != 0 and "InboxUnavailable" in p.stderr, "a failed thread read raises, never returns a partial inbox")


def test_fixtures_are_scrubbed():
    text = Path(__file__).read_text()
    import re
    emails = set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", text))
    ok(all(e.endswith("example.com") for e in emails), f"a fixture address is not example.com: {emails}")


def main():
    for fn in (test_registry_matches_spec, test_ops_json_shape, test_routes_to_fastest_measured,
               test_falls_through_on_failure_and_truncation, test_args_pick_the_surface, test_write_gate,
               test_ui_only_prints_route, test_a_relabelled_write_is_still_gated, test_refuses_an_unpinned_engine, test_inbox_adapter_keeps_clay_inbox_shape, test_fixtures_are_scrubbed):
        fn()
    print(f"chewbacca clay: {checks} checks passed")


if __name__ == "__main__":
    main()
