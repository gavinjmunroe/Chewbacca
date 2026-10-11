"""chewbacca clay: routing, the write gate, and the JSON it prints.

Hermetic. CHEWBACCA_CLAY_FIXTURES points the front door at recorded surface
answers written below, so no Clay session, CLI, browser or network is used.
Every fixture is synthetic: example.com addresses, made-up ids, no rows from a
real workspace. A measured.json in a temp dir decides which surface is fastest.
"""
import hashlib
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

# The 16 writes derived from Clay's frontend bundle (and one from the CLI), each
# with the args a caller gives and the request it must build. Written out by
# hand from the bundle's contracts, not read back from clay.json, so a slot that
# lands in the wrong path segment fails here (it did once: the campaign id
# overwrote "campaigns" in clay-sequencer/campaigns/{id}/status).
WS = "1000001"
V3 = f"https://api.clay.com/v3/workspaces/{WS}"
REC_NEW = [{"f_a": "x", "f_b": 2}]
REC_UPD = [{"id": "r_1", "cells": {"f_a": "y"}}]
FILTER = {"type": "GroupOp", "combinationMode": "And", "items": []}
CONFIG = {"source": {"type": "S3_CSV", "filename": "a.csv", "key": "k/1", "recordKeys": ["a"], "records": []},
          "destination": {"type": "TABLE", "tableId": "t_ex1"}, "map": {}, "isImportWithoutRun": True}
DERIVED = {
    "add-column": (["table=t_ex1", "name=Lead score", "data_type=number", "view=gv_ex1"],
                   ("POST", f"{V3}/tables/t_ex1/fields",
                    {"name": "Lead score", "type": "number", "typeSettings": {"dataTypeSettings": {"type": "number"}}, "activeViewId": "gv_ex1"})),
    "update-column": (["table=t_ex1", "field=f_ex1", 'update={"name":"New"}'],
                      ("PATCH", f"{V3}/tables/t_ex1/fields/f_ex1?skipActionFieldRuns=true", {"name": "New"})),
    "table-auto-run": (["table=t_ex1", "on=false", 'settings={"AUTO_RUN_ON":true,"AUTO_RUN_MODE":"all","DEDUPE_FIELD_ID":null}'],
                       ("PATCH", f"{V3}/tables/t_ex1", {"tableSettings": {"AUTO_RUN_ON": False, "AUTO_RUN_MODE": "all", "DEDUPE_FIELD_ID": None}})),
    "run-cells": (["table=t_ex1", "fields=f_a", "rows=r_1,r_2"],
                  ("PATCH", f"{V3}/tables/t_ex1/run", {"fieldIds": ["f_a"], "runRecords": {"recordIds": ["r_1", "r_2"]}, "forceRun": True})),
    "cancel-run": (["table=t_ex1"], ("POST", f"{V3}/tables/t_ex1/cancelrun", {})),
    "add-rows": (["table=t_ex1", "records=" + json.dumps(REC_NEW)],
                 ("POST", f"{V3}/tables/t_ex1/records", {"records": [{"cells": REC_NEW[0]}]})),
    "update-rows": (["table=t_ex1", "records=" + json.dumps(REC_UPD)], ("PATCH", f"{V3}/tables/t_ex1/records", {"records": REC_UPD})),
    "delete-rows": (["table=t_ex1", "rows=r_1"], ("DELETE", f"{V3}/tables/t_ex1/records", {"recordIds": ["r_1"]})),
    "import": (["config=" + json.dumps(CONFIG)], ("POST", f"{V3}/imports", {"config": CONFIG, "workspaceId": "1000001"})),
    "add-leads": (["audience=seg_ex1", "filter=" + json.dumps(FILTER), "campaign=cam_ex1"],
                  ("CLI", ["clay", "audiences", "update", "seg_ex1", "--filter", json.dumps(FILTER, separators=(",", ":"))], None)),
    "campaign-status": (["campaign=cam_ex1", "status=PAUSED"], ("PATCH", f"{V3}/clay-sequencer/campaigns/cam_ex1/status", {"status": "PAUSED"})),
    "lead-category": (["lead_map_id=42", "category_id=3"],
                      ("PATCH", f"{V3}/clay-sequencer/master-inbox/lead-category", {"email_lead_map_id": 42, "category_id": 3})),
    "mark-read": (["lead_map_id=42", "read_status=UNREAD"],
                  ("PATCH", f"{V3}/clay-sequencer/master-inbox/lead-read-status", {"email_lead_map_id": 42, "new_read_status": "UNREAD"})),
    "blocklist-remove": (["entry=987"], ("DELETE", f"{V3}/clay-sequencer/global-blocklist/987", {})),
    "blocklist-add-bulk": (["emails=a@example.com,example.org"],
                           ("POST", f"{V3}/campaigns/global-blocklist/add-bulk", {"emailsOrDomains": ["a@example.com", "example.org"]})),
    "page-view-activity": (["resource=wb_ex1", "resource_type=WORKBOOK"],
                           ("POST", f"{V3}/resources/wb_ex1/activity", {"resourceType": "WORKBOOK", "activityType": "LAST_OPENED"})),
}


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
        # A synthetic workspace, and never the real GTM client config.
        env.update(CLAY_WORKSPACE_ID=WS, GTM_CONFIG=str(base / "no-clients.json"))
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
    gated = {s["op"] for op in reg["ops"] if op["kind"] == "write" for s in op["surfaces"] if s["type"] == "api-anything"}
    ok({n for n, o in sops.items() if not o["readOnly"]} == gated, "a spec write is not behind the registry's gate")
    for op in reg["ops"]:
        ok(op["gate"] == "read" if op["kind"] == "read" else op["gate"].startswith("write:"), f"{op['name']} gate class")
    # The 16 writes once listed as untaught are ops now, each carrying where its
    # request came from, and none claims to be verified: none was ever sent.
    ok(reg["untaught_writes"] == [], "untaught_writes should be empty")
    ops = {o["name"]: o for o in reg["ops"]}
    files = {f["file"]: f["sha256"] for f in reg["bundle"]["files"]}
    for name in DERIVED:
        op = ops.get(name)
        ok(op and op["kind"] == "write" and op["verified"] is False, f"{name} must be a write op with verified:false")
        ev = op["evidence"]
        if ev["source"] == "bundle":
            ok(ev["file"] in files and ev["sha256"] == files[ev["file"]], f"{name} evidence names a bundle file the registry records")
            ok(ev["contract"] and isinstance(ev["contract_offset"], int) and ev["body_schema"], f"{name} evidence lacks contract, offset or schema")
        else:
            ok(ev["source"] == "cli" and ev["command"].startswith("clay "), f"{name} evidence is neither bundle nor cli")
        ok(op["confidence"].split(":")[0] in ("high", "medium", "low"), f"{name} confidence")
        ok(op.get("readback", {}).get("op") in ops, f"{name} readback names a read op that exists")
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
    ok(out["untaught_writes"] == [], "no write is left untaught")
    derived = [o for o in out["ops"] if o["op"] in DERIVED]
    ok(len(derived) == 16 and all(o["verified"] is False and o["evidence"] for o in derived), "derived writes list verified:false and evidence")
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
    ok(out["payload"]["args"]["ws"] == "1000001", "the refusal shows the payload")
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
    for bad in ("table=../../workspaces/9/x", "table=t_1?x=y", "table=t_1/rows", "ws=1000001/../9", "limit=5;rm"):
        k = bad.split("=")[0]
        op = {"table": "table", "ws": "tables", "limit": "rows"}[k]
        extra = ("table=t_ok1",) if op == "rows" else ()
        code, out, _ = run({}, {}, op, bad, *extra)
        ok(code == 2 and out["class"] == "input", f"a crafted slot is refused before any call: {bad}")
    code, out, _ = run({}, {}, "run-cells", "table=t_example1", "fields=f_a", "rows=r_1")
    ok(code == 3 and out["class"] == "refused" and out["gate"] == "write:spends-credits", "run-cells refuses without --allow-writes")
    code, out, _ = run({}, {}, "measure", "reply")
    ok(code == 3 and out["class"] == "refused", "measure never runs a write")


def test_chat_approval_stands_in_for_the_terminal():
    # 2026-10-10: Caleb's "do it yourself" in chat, recorded by chat-approval.sh,
    # approves a write the way typing the op name at a terminal does, for 12 hours.
    import json as _json
    import tempfile
    import time as _time
    args = ("blocklist-add", "emailOrDomain=blocked.example", "--allow-writes")
    sent = {"api-anything/blocklistAdd.json": SENT}
    said = "Lock in bro fix chewb the whole point is I give you full permission to do everything gtm"

    def put(sid, age, **extra):
        rec = {"v": 2, "interactive": True, "at": int(_time.time()) - age, "session_id": sid, "excerpt": said}
        rec.update(extra)
        with open(os.path.join(d, sid + ".json"), "w") as f:
            _json.dump(rec, f)

    with tempfile.TemporaryDirectory() as d:
        env = {"CHEWBACCA_CLAY_CHAT_APPROVAL_DIR": d, "CLAUDE_CODE_SESSION_ID": "s-agent-tab"}
        put("s-caleb", 60)
        code, out, err = run(sent, {}, *args, env_extra=env)
        ok(code == 0 and out["ok"] is True, "a fresh chat approval from any of Caleb's tabs lets an approved write run")
        ok("session s-caleb" in err.stderr and said[:60] in err.stderr and said[:61] not in err.stderr,
           "the write names the approving session and the first 60 chars of what he typed")
        code, out, _ = run(sent, {}, *args, env_extra=dict(env, CHEWBACCA_NO_SEND="1"))
        ok(code == 3 and "NO_SEND" in out["reason"], "CHEWBACCA_NO_SEND=1 still refuses a chat-approved write")
        put("s-caleb", 3 * 3600)
        code, out, _ = run(sent, {}, *args, env_extra=env)
        ok(code == 3 and "did not approve" in out["reason"], "a chat approval older than 2 hours is refused")
        # 2026-10-10 13:17: the v1 hook wrote a record from a `claude --bg`
        # session's own prompt. Records without v2 and interactive never count.
        os.remove(os.path.join(d, "s-caleb.json"))
        put("s-launched", 60, v=1)
        put("s-launched2", 60, interactive=False)
        code, out, _ = run(sent, {}, *args, env_extra=env)
        ok(code == 3, "a v1 or non-interactive record (a launched session's prompt) is refused")
        put("s-caleb", 60)
        open(os.path.join(d, "STOPPED"), "w").write("1")
        code, out, _ = run(sent, {}, *args, env_extra=env)
        ok(code == 3, "a standing stop refuses even beside a fresh record")
        code, out, _ = run(sent, {}, *args, env_extra=dict(env, CHEWBACCA_CLAY_CHAT_APPROVAL_DIR=os.path.join(d, "missing")))
        ok(code == 3, "no chat approval and nobody at the terminal is refused")
    code, out, _ = run({}, {}, "campaign-status", "campaign=cam_x", "status=START", "--allow-writes")
    ok(code == 3 and out["class"] == "refused", "a START is still never sent from here")


def test_campaign_build_ops_touch_drafts_only():
    # 2026-10-10: the Monday build needed CSV loads, segments and draft campaigns
    # through the front door. None of them may launch or edit a live campaign.
    import json as _json
    import tempfile
    import time as _time
    code, out, _ = run({}, {}, "campaign-update", "campaign=cam_x", 'input={"status":"active"}', "--allow-writes")
    ok(code == 2 and "status" in out["reason"], "campaign-update refuses a status key")
    code, out, _ = run({}, {}, "csv-upload", "trigger=15a2668a-07fd-4844-be50-37981ebb971a", "csv=/tmp/../etc/x.csv")
    ok(code == 2, "csv-upload refuses a path with ..")
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "s-caleb.json"), "w") as f:
            _json.dump({"v": 2, "interactive": True, "session_id": "s-caleb", "at": int(_time.time())}, f)
        approve = {"CHEWBACCA_CLAY_CHAT_APPROVAL_DIR": d, "CHEWBACCA_CLAY_TEST_CAMPAIGN_STATUS": "active"}
        code, out, _ = run({}, {}, "campaign-sequence", "campaign=cam_x", 'input={"ops":[{"op":"deleteStep"}]}',
                           "--allow-writes", env_extra=approve)
        ok(code == 3 and "only a draft" in out["reason"], "campaign-sequence refuses a live campaign")


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
        env.update(CLAY_WORKSPACE_ID=WS, GTM_CONFIG=str(Path(d) / "no-clients.json"))
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
        env.update(CLAY_WORKSPACE_ID=WS, GTM_CONFIG=str(Path(d) / "no-clients.json"))
        env["CHEWBACCA_CLAY_TRUST_ENGINE"] = "1"  # no longer an escape hatch (review of b68d5645)
        p = subprocess.run(["node", str(TOOL), "credits", "--surface", "api"], capture_output=True, text=True,
                           env=env, timeout=60)
        out = json.loads(p.stdout)
        ok(p.returncode == 1 and "pinned commit" in out["tried"][0]["reason"], f"an unpinned engine ran: {p.stdout[:300]}")
        ok(not marker.exists(), "the unpinned engine was imported before it was refused")


def test_dry_run_builds_each_write():
    # No fixtures at all: if --dry-run ever reached a surface it would fail with "no fixture".
    for name, (argv, (method, url, body)) in DERIVED.items():
        code, out, p = run({}, {}, name, *argv, "--dry-run", env_extra={"CHEWBACCA_NO_SEND": "1"})
        ok(code == 0 and out and out["dry_run"] is True and out["sent"] is False, f"{name} dry run failed: {p.stdout[:300]}")
        ok(out["kind"] == "write" and out["verified"] is False, f"{name} dry run says write, unverified")
        req = out["request"]
        if method == "CLI":
            ok(req["argv"] == url, f"{name} argv: {req['argv']}")
            continue
        ok(req["method"] == method and req["url"] == url, f"{name} built {req['method']} {req['url']}")
        ok(req["body"] == body, f"{name} body: {json.dumps(req['body'])}")
        ok("cookie" not in {h.lower() for h in req["headers"]}, f"{name} dry run carries a cookie")


def test_dry_run_never_loads_the_engine():
    # Not fixture mode: a fake engine on API_ANYTHING_DIST writes a marker when imported.
    with tempfile.TemporaryDirectory() as d:
        dist = Path(d) / "dist"
        dist.mkdir()
        marker = Path(d) / "imported"
        (dist / "execute.js").write_text(f"require('fs').writeFileSync({json.dumps(str(marker))}, 'x'); exports.call = async () => ({{ok: true}});\n")
        (Path(d) / "m.json").write_text("{}")
        env = dict(os.environ, API_ANYTHING_DIST=str(dist), API_ANYTHING_HOME=str(Path(d) / "home"), CHEWBACCA_CLAY_MEASURED=str(Path(d) / "m.json"))
        env.pop("CHEWBACCA_CLAY_FIXTURES", None)
        env.update(CLAY_WORKSPACE_ID=WS, GTM_CONFIG=str(Path(d) / "no-clients.json"))
        for name in ("add-column", "delete-rows", "blocklist-add"):
            argv = DERIVED[name][0] if name in DERIVED else ["emailOrDomain=blocked.example"]
            p = subprocess.run(["node", str(TOOL), name, *argv, "--dry-run", "--allow-writes"], capture_output=True, text=True, env=env, timeout=60)
            out = json.loads(p.stdout)
            ok(p.returncode == 0 and out["sent"] is False, f"{name} live dry run: {p.stdout[:300]}")
        ok(not marker.exists(), "a dry run imported the engine")


def test_derived_writes_stay_gated():
    for name, (argv, _) in DERIVED.items():
        code, out, _ = run({}, {}, name, *argv)
        ok(code == 3 and out["class"] == "refused" and "allow-writes" in out["reason"], f"{name} ran without --allow-writes")
        ok(out["request"], f"{name} refusal shows the request it would send")
        code, out, _ = run({}, {}, name, *argv, "--allow-writes")
        ok(code == 3 and "did not approve" in out["reason"], f"{name} ran with nobody typing its name")
        code, out, _ = run({}, {}, name, *argv, "--allow-writes", env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": name, "CHEWBACCA_NO_SEND": "1"})
        ok(code == 3 and "NO_SEND" in out["reason"], f"{name} ran under CHEWBACCA_NO_SEND=1")
    # A campaign start is never sent from here, approved or not.
    code, out, _ = run({}, {}, "campaign-status", "campaign=cam_ex1", "status=START", "--allow-writes",
                       env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": "campaign-status"})
    ok(code == 3 and out["class"] == "refused" and "never sent from here" in out["reason"], "a campaign START was let through")
    code, out, _ = run({}, {}, "campaign-status", "campaign=cam_ex1", "status=START", "--dry-run")
    ok(code == 3, "a campaign START is refused even as a dry run")


def test_new_args_are_shape_checked():
    bad = [
        ("run-cells", ["table=t_ex1", "fields=f_a", "rows=r_1,r_2,r_3,r_4,r_5,r_6"]),  # the five-row cap
        ("run-cells", ["table=t_ex1", "fields=../x", "rows=r_1"]),
        ("update-column", ["table=t_ex1", "field=f_1/../../x", 'update={"name":"a"}']),
        ("update-column", ["table=t_ex1", "field=f_ex1", 'update={"name":"a","tableId":"t_2"}']),
        ("update-column", ["table=t_ex1", "field=f_ex1", "update={}"]),
        ("add-column", ["table=t_ex1", "name=a\nb", "data_type=text", "view=gv_ex1"]),
        ("add-column", ["table=t_ex1", "name=a", "data_type=formula", "view=gv_ex1"]),
        ("add-rows", ["table=t_ex1", 'records=[{"name":"x"}]']),
        ("add-rows", ["table=t_ex1", "records=" + json.dumps([{"f_a": 1}] * 101)]),
        ("update-rows", ["table=t_ex1", 'records=[{"cells":{"f_a":1}}]']),
        ("delete-rows", ["table=t_ex1", "rows=r_1?all=1"]),
        ("table-auto-run", ["table=t_ex1", "on=yes", 'settings={"AUTO_RUN_ON":true}']),
        ("table-auto-run", ["table=t_ex1", "on=true", 'settings={"autoRunOn":true}']),
        ("import", ['config={"source":{"type":"URL"},"destination":{"type":"TABLE"},"map":{},"isImportWithoutRun":true}']),
        ("add-leads", ["audience=seg_ex1", 'filter={"type":"BinOp"}', "campaign=cam_ex1"]),
        # campaign is required (2026-10-10): a dry run without it is refused,
        # not shown as sendable until the grade gate after approval.
        ("add-leads", ["audience=seg_ex1", "filter=" + json.dumps(FILTER)]),
        ("lead-category", ["lead_map_id=1;2", "category_id=3"]),
        ("mark-read", ["lead_map_id=1", "read_status=SEEN"]),
        ("blocklist-remove", ["entry=../../x"]),
        ("blocklist-add-bulk", ["emails=a@example.com,not an email"]),
        ("page-view-activity", ["resource=wb_1", "resource_type=PAGE"]),
    ]
    for name, argv in bad:
        code, out, _ = run({}, {}, name, *argv, "--dry-run")
        ok(code == 2 and out["class"] == "input", f"a bad arg reached {name}: {argv}")


def test_first_live_use_reads_back():
    argv = DERIVED["add-column"][0]
    approve = {"CHEWBACCA_CLAY_TTY_ANSWER": "add-column"}
    made = {"ok": True, "class": "ok", "tier": 1, "ms": 50, "data": {"field": {"id": "f_new"}}}
    cols = {"ok": True, "class": "ok", "tier": 1, "ms": 40, "data": [{"id": "f_new", "name": "Lead score", "type": "number"}]}
    code, out, _ = run({"api-anything/createField.json": made, "api-anything/getTableColumns.json": cols}, {}, *["add-column", *argv], "--allow-writes", env_extra=approve)
    ok(code == 0 and out["verified"] is False and out["readback"]["ok"] is True and out["readback"]["op"] == "columns", f"readback: {out}")
    cols_without = {**cols, "data": [{"id": "f_old", "name": "Other"}]}
    code, out, _ = run({"api-anything/createField.json": made, "api-anything/getTableColumns.json": cols_without,
                        "cli/columns.json": {"exit": 0, "stdout": json.dumps({"data": []}), "stderr": ""}}, {}, "add-column", *argv, "--allow-writes", env_extra=approve)
    ok(code == 0 and out["readback"]["ok"] is False, "a column missing on readback is reported")
    code, out, _ = run({"api-anything/cancelRuns.json": SENT}, {}, "cancel-run", "table=t_ex1", "--allow-writes", env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": "cancel-run"})
    ok(code == 0 and out["readback"]["check"] == "manual" and out["readback"]["run"].startswith("chewbacca clay table-status"), "a manual readback names the read to run")


def approve_and_capture(name, argv, fixtures):
    """Run one approved write in fixture mode; return (dry-run request, prompt text, requests handed to a surface)."""
    code, dry, _ = run({}, {}, name, *argv, "--dry-run")
    assert code == 0, f"{name} dry run failed: {dry}"
    with tempfile.TemporaryDirectory() as d:
        tty, sent = Path(d) / "tty.txt", Path(d) / "sent.jsonl"
        code, out, p = run(fixtures, {}, name, *argv, "--allow-writes", env_extra={
            "CHEWBACCA_CLAY_TTY_ANSWER": name, "CHEWBACCA_CLAY_TTY_TRANSCRIPT": str(tty), "CHEWBACCA_CLAY_SENT_LOG": str(sent)})
        assert code == 0, f"{name} approved write failed: {p.stdout[:400]}"
        handed = [json.loads(x) for x in sent.read_text().split("\n") if x] if sent.exists() else []
        return dry["request"], tty.read_text(), handed


def prompt_payload(text):
    lines = text.split("\n")
    ok(len(lines) == 4 and lines[0] == "" and lines[1].startswith("chewbacca clay is about to WRITE")
       and lines[3].startswith("Type the op name"), f"the prompt has extra or missing lines: {text!r}")
    ok(all(0x20 <= ord(c) <= 0x7e for c in lines[2]), "the payload line carries a byte outside printable ASCII")
    shown_hash = lines[1].split("sha256 ")[1].split(")")[0]
    ok(shown_hash == hashlib.sha256(lines[2][2:].encode()).hexdigest(), "the prompt's sha256 is not the hash of the payload it shows")
    return json.loads(lines[2])


def test_nothing_changes_between_approval_and_send():
    # Review of f3a934cb: anything the write depends on that changes after the
    # person approves refuses the send.
    argv = DERIVED["add-column"][0]
    with tempfile.TemporaryDirectory() as d:
        lib = Path(d) / "lib"
        lib.mkdir()
        for f in ("registry.json", "clay.json"):
            (lib / f).write_text((LIB / f).read_text())
        spec = json.loads((lib / "clay.json").read_text())
        for o in spec["operations"]:
            if o["name"] == "createField":
                o["request"]["url"] = o["request"]["url"].replace("api.clay.com", "evil.example.com")
        mutations = {
            "spec": {"write": {"path": str(lib / "clay.json"), "text": json.dumps(spec)}},
            "registry": {"write": {"path": str(lib / "registry.json"), "text": (lib / "registry.json").read_text().replace('"write:schema"', '"write:schema "')}},
            "env": {"env": {"CLAY_WORKSPACE_ID": "9999999"}},
        }
        base = {"CHEWBACCA_CLAY_LIB": str(lib), "CHEWBACCA_CLAY_TTY_ANSWER": "add-column"}
        for what, hook in mutations.items():
            sent = Path(d) / f"sent-{what}.jsonl"
            code, out, p = run({"api-anything/createField.json": SENT}, {}, "add-column", *argv, "--allow-writes",
                               env_extra={**base, "CHEWBACCA_CLAY_SENT_LOG": str(sent), "CHEWBACCA_CLAY_TEST_AFTER_APPROVE": json.dumps(hook)})
            ok(code == 3 and out["class"] == "refused" and "changed after approval" in out["reason"], f"a {what} change after approval was sent: {p.stdout[:300]}")
            ok(not sent.exists(), f"a {what} change after approval still reached the surface")
            for f in ("registry.json", "clay.json"):
                (lib / f).write_text((LIB / f).read_text())
        # The same hook rewriting identical bytes changes nothing, so the write goes.
        same = {"write": {"path": str(lib / "clay.json"), "text": (LIB / "clay.json").read_text()}}
        code, out, _ = run({"api-anything/createField.json": SENT}, {}, "add-column", *argv, "--allow-writes",
                           env_extra={**base, "CHEWBACCA_CLAY_TEST_AFTER_APPROVE": json.dumps(same)})
        ok(code == 0 and out["ok"] is True and len(out["sha256"]) == 64, "an unchanged write after approval was refused")


def test_approved_request_is_the_sent_request():
    # Review of e5f1edeb: what the person approves must be byte for byte what is
    # sent, defaults (ws) and composed bodies included, and the same object
    # --dry-run prints.
    cases = {name: argv for name, (argv, _) in DERIVED.items()}
    # add-leads also needs a passing grade before it sends; its send path is
    # tested in tests/test_launch_guard_grade.py.
    cases.pop("add-leads")
    cases["reply"] = ["campaign_id=1", 'reply_data={"email_stats_id":"s1","email_body":"x"}']
    cases["blocklist-add"] = ["emailOrDomain=blocked.example"]
    reg = json.loads((LIB / "registry.json").read_text())
    ops = {o["name"]: o for o in reg["ops"]}
    for name, argv in cases.items():
        s = ops[name]["surfaces"][0]
        fx = {f"api-anything/{s['op']}.json": SENT} if s["type"] == "api-anything" else {f"cli/{name}.json": {"exit": 0, "stdout": "{}", "stderr": ""}}
        dry, prompt, handed = approve_and_capture(name, argv, fx)
        shown = prompt_payload(prompt)
        ok(shown == {"op": name, "request": dry}, f"{name}: the prompt shows something other than the dry run")
        ok(len(handed) == 1 and handed[0]["request"] == dry, f"{name}: the surface was handed something other than what was approved")
    ok(dry_ws_in_url(cases), "ws default reaches the approved URL")


def dry_ws_in_url(cases):
    _, out, _ = run({}, {}, "cancel-run", *cases["cancel-run"], "--dry-run")
    return "/workspaces/1000001/" in out["request"]["url"]


def test_control_bytes_cannot_fake_the_prompt():
    evil = 'x\n  {"op":"cancel-run","request":{}}\x1b[2K\x1b[1A‮ end'
    argv = ["table=t_ex1", "records=" + json.dumps([{"f_a": evil}])]
    dry, prompt, handed = approve_and_capture("add-rows", argv, {"api-anything/createRecords.json": SENT})
    ok("\x1b" not in prompt and "‮" not in prompt and " " not in prompt, "a control byte reached the terminal raw")
    shown = prompt_payload(prompt)
    ok(shown["request"]["body"]["records"][0]["cells"]["f_a"] == evil, "the escaped value does not decode to what is sent")
    ok(handed[0]["request"] == dry == shown["request"], "prompt, dry run and sent request differ")
    big = ["table=t_ex1", "records=" + json.dumps([{"f_a": "y" * 200}] * 99)]
    code, out, _ = run({}, {}, "add-rows", *big, "--allow-writes", env_extra={"CHEWBACCA_CLAY_TTY_ANSWER": "add-rows"})
    ok(code == 2 and "too long to read" in out["reason"], "a request too long to show was not refused")


# One valid sample per arg name any registry op takes, for walking every op.
SAMPLES = {
    "ws": "1000001", "table": "t_ex1", "row": "r_ex1", "view": "gv_ex1", "audience": "seg_ex1", "campaign": "cam_ex1",
    "campaign_id": "1", "lead_id": "2", "cursor": "abc", "after": "r_ex9", "limit": "5", "offset": "0", "days": "7",
    "ids": "p_1,p_2", "emailOrDomain": "blocked.example", "reply_data": '{"email_stats_id":"s1","email_body":"x"}',
    "forward_data": '{"message_id":"m","stats_id":"s","to_emails":"a@example.com"}', "field": "f_ex1",
    "update": '{"name":"x"}', "on": "false", "mode": "all", "settings": '{"AUTO_RUN_ON":true}', "fields": "f_a",
    "rows": "r_1", "records": json.dumps([{"f_a": "x"}]), "config": json.dumps(CONFIG), "filter": json.dumps(FILTER),
    "status": "PAUSED", "lead_map_id": "1", "category_id": "1", "read_status": "READ", "entry": "9",
    "emails": "a@example.com", "resource": "t_ex1", "resource_type": "TABLE", "name": "x", "data_type": "text",
    "workflow": "wf_ex1", "run": "wfr_ex1", "detail": "summary",
    "trigger": "15a2668a-07fd-4844-be50-37981ebb971a", "csv": "/tmp/leads.csv", "input": '{"name":"x"}',
}
CLI_READ_LEAVES = {"list", "get", "analytics", "balance", "search-ids", "search-count", "query", "query-live", "query-usage",
                   "audience", "summary", "activities", "list-values", "steps", "reference", "traffic", "aggregate", "search",
                   "schema", "validate", "format", "diagram", "preview-sequence", "resolve", "sender-accounts", "skills",
                   "business-context", "files", "segments", "whoami", "versions"}


def surface_mutates(s, sops):
    """An independent reading of whether one surface can change Clay."""
    if s["type"] == "api-anything":
        o = sops[s["op"]]
        return o["request"]["method"] != "GET" and not o["readOnly"] or not o["readOnly"]
    if s["type"] == "cli":
        words = []
        for t in s["argv"]:
            if t.startswith("-") or "{" in t:
                break
            words.append(t)
        return not words or words[-1] not in CLI_READ_LEAVES
    return s["argv"][0] not in ("clay-inbox", "clay-balance")


def walk_gate(reg_path=None):
    reg = json.loads(Path(reg_path or LIB / "registry.json").read_text())
    sops = {o["name"]: o for o in json.loads((LIB / "clay.json").read_text())["operations"]}
    extra = {"CHEWBACCA_CLAY_LIB": str(Path(reg_path).parent)} if reg_path else {}
    walked = 0
    for op in reg["ops"]:
        own = {"update-rows": {"records": json.dumps(REC_UPD)},
               "campaign-sequence": {"input": '{"ops":[{"op":"deleteStep"}]}'}}.get(op["name"], {})
        argv = [f"{a.rstrip('?')}={own.get(a.rstrip('?'), SAMPLES[a.rstrip('?')])}" for a in op["args"]]
        for s in op["surfaces"]:
            if s.get("unless"):
                continue
            mutates = op["kind"] == "write" or surface_mutates(s, sops)
            code, out, p = run({}, {}, op["name"], *argv, "--surface", s["type"], env_extra=extra)
            if mutates:
                ok(code == 3 and out["class"] == "refused" and "allow-writes" in out["reason"],
                   f"{op['name']} via {s['type']} ran without the gate: {p.stdout[:200]}")
                code, out, _ = run({}, {}, op["name"], *argv, "--surface", s["type"], "--allow-writes", env_extra=extra)
                ok(code == 3 and "did not approve" in out["reason"], f"{op['name']} via {s['type']} ran with nobody at the terminal")
                code, out, _ = run({}, {}, op["name"], *argv, "--surface", s["type"], "--allow-writes",
                                   env_extra={**extra, "CHEWBACCA_CLAY_TTY_ANSWER": op["name"], "CHEWBACCA_NO_SEND": "1"})
                ok(code == 3 and "NO_SEND" in out["reason"], f"{op['name']} via {s['type']} ran under CHEWBACCA_NO_SEND=1")
            else:
                ok(not (out and out.get("class") == "refused"), f"the read {op['name']} via {s['type']} was refused")
            walked += 1
    return walked


def test_every_mutating_surface_is_gated():
    ok(walk_gate() > 40, "walked too few surfaces")
    # A registry that mislabels mutating surfaces as reads is still gated on each one.
    reg = json.loads((LIB / "registry.json").read_text())
    reg["ops"] += [
        {"name": "t-cli-delete", "kind": "read", "gate": "read", "args": ["table"], "summary": "x",
         "surfaces": [{"type": "cli", "argv": ["tables", "delete", "{table}"]}]},
        {"name": "t-cli-runs", "kind": "read", "gate": "read", "args": ["table"], "summary": "x",
         "surfaces": [{"type": "cli", "argv": ["workflows", "runs", "pause", "{table}"]}]},
        {"name": "t-cli-unknown", "kind": "read", "gate": "read", "args": ["table"], "summary": "x",
         "surfaces": [{"type": "cli", "argv": ["tables", "frobnicate", "{table}"]}]},
        {"name": "t-bin", "kind": "read", "gate": "read", "args": ["table"], "summary": "x",
         "surfaces": [{"type": "bin", "argv": ["clay-send", "--table", "{table}"]}]},
    ]
    with tempfile.TemporaryDirectory() as d:
        lib = Path(d) / "lib"
        lib.mkdir()
        (lib / "registry.json").write_text(json.dumps(reg))
        (lib / "clay.json").write_text((LIB / "clay.json").read_text())
        for name in ("t-cli-delete", "t-cli-runs", "t-cli-unknown", "t-bin"):
            code, out, p = run({}, {}, name, "table=t_ex1", env_extra={"CHEWBACCA_CLAY_LIB": str(lib)})
            ok(code == 3 and out["class"] == "refused", f"a mislabelled {name} ran without the gate: {p.stdout[:200]}")
        code, out, _ = run({}, {}, "ops", env_extra={"CHEWBACCA_CLAY_LIB": str(lib)})
        kinds = {o["op"]: o["kind"] for o in out["ops"]}
        ok(all(kinds[n] == "write" for n in ("t-cli-delete", "t-cli-runs", "t-cli-unknown", "t-bin")), "ops lists a mislabelled write as a read")


def test_values_that_change_when_decoded_are_refused():
    # Review of 300f4ddb: a value is checked and built in one representation.
    # Each of these looks different once decoded, normalized or re-parsed.
    sneaky_ids = ["%2e%2e", "t_1%2Fx", "t_1%2fx", "..", "t_1∕x", "t_1／x", "t_1 ", " t_1", "t_1\t", "t_1/../x", "tı_1"]
    for v in sneaky_ids:
        for name, key, rest in (("cancel-run", "table", []), ("blocklist-remove", "entry", []),
                                ("page-view-activity", "resource", ["resource_type=TABLE"]),
                                ("update-column", "field", ["table=t_ex1", 'update={"name":"x"}'])):
            code, out, _ = run({}, {}, name, f"{key}={v}", *rest, "--dry-run")
            ok(code == 2 and out["class"] == "input", f"{name} {key}={v!r} reached the builder")
    code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "table=t_ex2", "--dry-run")
    ok(code == 2 and "more than once" in out["reason"], "a key given twice was accepted")
    bad_json = [
        ("add-rows", ["table=t_ex1", 'records=[{"f_a":1,"f_a":2}]']),
        ("add-rows", ["table=t_ex1", 'records=[{"__proto__":{"f_a":1}}]']),
        ("add-rows", ["table=t_ex1", 'records=[{"f_a":{"constructor":{"prototype":1}}}]']),
        ("table-auto-run", ["table=t_ex1", "on=true", 'settings={"AUTO_RUN_ON":true,"AUTO_RUN_ON":false}']),
        ("update-column", ["table=t_ex1", "field=f_ex1", 'update={"name":"a","name":"b"}']),
        ("add-leads", ["audience=seg_ex1", 'filter={"type":"GroupOp","items":[],"items":[{"x":1}]}', "campaign=cam_ex1"]),
        ("add-leads", ["audience=seg_ex1", 'filter={"type":"GroupOp","items":[{"__proto__":{}}]}', "campaign=cam_ex1"]),
        ("add-rows", ["table=t_ex1", 'records=[{"f_a":1}] trailing']),
        ("run-cells", ["table=t_ex1", 'fields=["f_a","f_a\\u002f.."]', "rows=r_1"]),
    ]
    for name, argv in bad_json:
        code, out, _ = run({}, {}, name, *argv, "--dry-run")
        ok(code == 2 and out["class"] == "input", f"{name} accepted {argv[-1]!r}")
    # Whitespace a builder might trim is part of the value: what is checked is what is sent.
    code, out, _ = run({}, {}, "add-column", "table=t_ex1", "name=Lead score ", "data_type=text", "view=gv_ex1", "--dry-run")
    ok(code == 0 and out["request"]["body"]["name"] == "Lead score ", "a checked value was altered before sending")
    code, out, _ = run({}, {}, "run-cells", "table=t_ex1", 'fields=["f_a"]', "rows=r_1", "--dry-run")
    ok(code == 0 and out["request"]["body"]["fieldIds"] == ["f_a"], "a JSON list was read differently from a comma list")
    # The finished request is checked too: a spec whose template was tampered with is refused.
    spec = json.loads((LIB / "clay.json").read_text())
    tamper = {
        "host": lambda o: o["request"].update(url=o["request"]["url"].replace("api.clay.com", "evil.example.com")),
        "dotdot": lambda o: o["request"].update(url=o["request"]["url"].replace("/tables/", "/../")),
        "proto": lambda o: o["request"].update(body='{"__proto__":{"x":1},"name":"x","type":"text","typeSettings":{"dataTypeSettings":{"type":"text"}},"activeViewId":"gv_example"}'),
    }
    for what, fn in tamper.items():
        doctored = json.loads(json.dumps(spec))
        fn(next(o for o in doctored["operations"] if o["name"] == "createField"))
        with tempfile.TemporaryDirectory() as d:
            lib = Path(d)
            (lib / "registry.json").write_text((LIB / "registry.json").read_text())
            (lib / "clay.json").write_text(json.dumps(doctored))
            code, out, _ = run({}, {}, "add-column", *DERIVED["add-column"][0], "--dry-run", env_extra={"CHEWBACCA_CLAY_LIB": str(lib)})
            ok(code == 2 and out["class"] == "input", f"a {what}-tampered spec built a request: {out}")


def test_workspace_has_no_built_in_default():
    reg = json.loads((LIB / "registry.json").read_text())
    ok("defaults" not in reg, "the registry still carries a default workspace")
    with tempfile.TemporaryDirectory() as d:
        def cfg(*workspace_lists):
            f = Path(d) / f"clients-{len(list(Path(d).glob('clients-*')))}.json"
            f.write_text(json.dumps({"clients": [{"name": f"Client {i}", "workspaces": w} for i, w in enumerate(workspace_lists)]}))
            return str(f)
        unset = {"CLAY_WORKSPACE_ID": ""}
        # Nothing set and no config: refuse, naming the ways to choose.
        code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "--dry-run", env_extra={**unset, "GTM_CONFIG": str(Path(d) / "missing.json")})
        ok(code == 2 and "ws=<id>" in out["reason"] and "CLAY_WORKSPACE_ID" in out["reason"], f"no workspace was not refused: {out}")
        # One workspace across all clients: used.
        one = cfg(["2000002"], ["2000002"])
        code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "--dry-run", env_extra={**unset, "GTM_CONFIG": one})
        ok(code == 0 and "/workspaces/2000002/" in out["request"]["url"], "the one configured workspace was not used")
        # Two: refuse and name the clients, never pick one.
        two = cfg(["2000002"], ["3000003"])
        code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "--dry-run", env_extra={**unset, "GTM_CONFIG": two})
        ok(code == 2 and "names 2" in out["reason"] and "Client 0" in out["reason"], f"two workspaces did not refuse: {out}")
        # The env var beats the config; ws= beats both.
        code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "--dry-run", env_extra={"CLAY_WORKSPACE_ID": "4000004", "GTM_CONFIG": one})
        ok("/workspaces/4000004/" in out["request"]["url"], "CLAY_WORKSPACE_ID did not win over the config")
        code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "ws=5000005", "--dry-run", env_extra={"CLAY_WORKSPACE_ID": "4000004"})
        ok("/workspaces/5000005/" in out["request"]["url"], "ws= did not win")
        # A workspace from the env or the config is shape-checked like ws=.
        code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "--dry-run", env_extra={"CLAY_WORKSPACE_ID": "1/../2"})
        ok(code == 2 and out["class"] == "input", "a crafted CLAY_WORKSPACE_ID reached the URL")
        bad = cfg(["9/../1"])
        code, out, _ = run({}, {}, "cancel-run", "table=t_ex1", "--dry-run", env_extra={**unset, "GTM_CONFIG": bad})
        ok(code == 2 and out["class"] == "input", "a crafted workspace in the config reached the URL")
        # The config a write's workspace came from is pinned: editing it after approval refuses.
        hook = {"write": {"path": one, "text": json.dumps({"clients": [{"name": "x", "workspaces": ["6000006"]}]})}}
        code, out, _ = run({"api-anything/cancelRuns.json": SENT}, {}, "cancel-run", "table=t_ex1", "--allow-writes",
                           env_extra={**unset, "GTM_CONFIG": one, "CHEWBACCA_CLAY_TTY_ANSWER": "cancel-run",
                                      "CHEWBACCA_CLAY_TEST_AFTER_APPROVE": json.dumps(hook)})
        ok(code == 3 and "changed after approval" in out["reason"], "a clients.json edit after approval was not refused")


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


def test_query_slot_reads_build():
    # Until 2026-10-10 every op whose spec slotted a query key refused with "dry
    # run does not handle slot step query:days" before any surface ran, live on
    # main: credit-usage, campaign-leads and rows with limit= never answered.
    code, out, p = run({}, {}, "credit-usage", "--dry-run")
    ok(code == 0 and out["request"]["url"] == f"{V3}/credit-reporting/creditReportType/workspace/recent?days=7",
       f"credit-usage builds with its default days: {p.stdout[:300]}")
    code, out, _ = run({}, {}, "credit-usage", "days=30", "--dry-run")
    ok(code == 0 and out["request"]["url"].endswith("recent?days=30"), "days= replaces the template value in place")
    code, out, _ = run({}, {}, "campaign-leads", "campaign=cam_ex1", "limit=5", "--dry-run")
    ok(code == 0 and out["request"]["url"].endswith("/enrolled-leads?limit=5"), "limit= reaches the query")
    code, out, _ = run({}, {}, "campaign-activity", "campaign=cam_ex1", "limit=7", "--dry-run")
    ok(code == 0 and out["request"]["url"] == f"{V3}/audiences/campaigns/cam_ex1/activities?limit=7", "a new read's query slot builds")
    code, out, _ = run({}, {}, "table-sources", "table=t_ex1", "--dry-run")
    ok(code == 0 and out["request"]["url"] == f"{V3}/sources?tableId=t_ex1", "a query slot can carry an id")
    for bad in ("days=7&x=1", "days=7%26x%3D1", "days=-1"):
        code, out, _ = run({}, {}, "credit-usage", bad, "--dry-run")
        ok(code == 2 and out["class"] == "input", f"a crafted query value is refused before any call: {bad}")
    # The fixed reads answer through a recorded surface too, not just in a dry run.
    usage = {"ok": True, "class": "ok", "tier": 1, "ms": 90, "data": {"entities": [], "unattributedCredits": 0}}
    code, out, _ = run({"api-anything/creditUsage.json": usage}, {}, "credit-usage", "days=3")
    ok(code == 0 and out["surface"] == "api-anything" and out["data"]["unattributedCredits"] == 0, "credit-usage answers")


# The reads added 2026-10-10 so nobody opens Clay for them: mailbox health, a
# campaign's bounce health and activity, a table's size, history and sources, a
# segment's history, and a workflow, its graph, its runs and one run's steps.
NEW_READS = ("sender-accounts", "bounce-health", "campaign-activity", "table-count", "table-history",
             "table-sources", "segment-history", "workflow", "workflow-graph", "workflow-runs",
             "workflow-run", "workflow-run-steps")


def test_new_reads_are_reads_with_a_measured_surface():
    reg, _ = registry_and_spec()
    measured = json.loads((LIB / "measured.json").read_text())
    ops = {o["name"]: o for o in reg["ops"]}
    code, listed, _ = run({}, {}, "ops")
    kinds = {o["op"]: o["kind"] for o in listed["ops"]}
    for name in NEW_READS:
        op = ops.get(name)
        ok(op and op["kind"] == "read" and op["gate"] == "read", f"{name} is a registered read")
        ok(kinds.get(name) == "read", f"{name}: the front door classifies every surface as a read")
        ok(op["ui"], f"{name} names the clay-go route it replaces")
        ok(any(v.get("at") for v in measured.get(name, {}).values()), f"{name} has a measured surface with a date")
    # Health first: the CLI is faster but has no warmup or SMTP state.
    code, route, _ = run({}, {"sender-accounts": {"cli:campaigns options sender-accounts": {"ms": 100},
                                                  "api-anything:senderAccounts": {"ms": 900}}}, "route", "sender-accounts")
    ok([r["surface"] for r in route["order"]] == ["api-anything", "cli"], "sender-accounts keeps the health surface first")
    code, route, _ = run({}, {}, "route", "workflow-run-steps", "workflow=wf_ex1", "run=wfr_ex1")
    ok([r["call"] for r in route["order"]] == ["cli:workflows runs steps {workflow} {run}"], "run steps need the workflow and the run")
    code, out, _ = run({}, {}, "workflow-graph", "workflow=wf_ex1", "detail=everything", "--dry-run")
    ok(code == 2 and out["class"] == "input", "detail is summary or full only")
    code, out, _ = run({}, {}, "workflow-graph", "workflow=wf_ex1", "detail=full", "--dry-run")
    ok(code == 0 and out["request"]["argv"] == ["clay", "workflows", "graph", "get", "wf_ex1", "--mode", "full"], "detail=full reaches --mode")
    code, out, _ = run({}, {}, "workflow-run", "run=--live", "--dry-run")
    ok(code == 2, "a run id shaped like a flag never reaches the CLI argv")


def test_second_session_reads_through_its_own_login():
    # 2026-10-11: the Amber workspace wasn't visible to the BMA login, so a
    # second Chrome profile's session has to be readable without touching it.
    code, out, _ = run({}, {}, "--session", "Bad Name", "workspaces")
    ok(code == 2 and out["class"] == "usage", "a session name is a short lowercase slug")
    code, route, _ = run({}, {"tables": {"cli:tables list --limit 100": {"ms": 10}, "api-anything:listResources": {"ms": 900}}},
                         "--session", "personal", "route", "tables", "ws=1000001")
    ok({r["surface"] for r in route["order"]} == {"api-anything"}, "a second session never falls to the CLI's own login")
    code, out, _ = run({}, {}, "--session", "personal", "session-login", "Profile; rm")
    ok(code == 2, "session-login takes only Default or Profile N")


def test_fixtures_are_scrubbed():
    text = Path(__file__).read_text()
    import re
    emails = set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", text))
    ok(all(e.endswith("example.com") for e in emails), f"a fixture address is not example.com: {emails}")


def main():
    for fn in (test_registry_matches_spec, test_ops_json_shape, test_routes_to_fastest_measured,
               test_falls_through_on_failure_and_truncation, test_args_pick_the_surface, test_write_gate,
               test_dry_run_builds_each_write, test_dry_run_never_loads_the_engine, test_derived_writes_stay_gated,
               test_new_args_are_shape_checked, test_first_live_use_reads_back,
               test_approved_request_is_the_sent_request, test_control_bytes_cannot_fake_the_prompt,
               test_every_mutating_surface_is_gated, test_nothing_changes_between_approval_and_send,
               test_values_that_change_when_decoded_are_refused, test_workspace_has_no_built_in_default,
               test_ui_only_prints_route, test_chat_approval_stands_in_for_the_terminal, test_campaign_build_ops_touch_drafts_only, test_a_relabelled_write_is_still_gated, test_refuses_an_unpinned_engine, test_inbox_adapter_keeps_clay_inbox_shape,
               test_query_slot_reads_build, test_new_reads_are_reads_with_a_measured_surface,
               test_second_session_reads_through_its_own_login, test_fixtures_are_scrubbed):
        fn()
    print(f"chewbacca clay: {checks} checks passed")


if __name__ == "__main__":
    main()
