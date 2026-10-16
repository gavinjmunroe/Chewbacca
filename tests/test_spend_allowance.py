"""chewbacca clay: a standing daily credit allowance stands in for the per-write ok.

On 2026-10-16 Caleb approved the same Sabo enrichment run three times in one
hour and wrote "Fix chewbs you shouldn't be asking for permission". A paid run
inside the workspace's allowance now goes with nobody asked; one over it is
refused with a BLOCKED line and nothing is sent. Hermetic: fixture surfaces, a
synthetic workspace, temp files for the allowance and its spend record.
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_chewbacca_clay import AUTH_FAIL, SENT, WS, run  # noqa: E402

checks = 0
RUN = ("run-cells", "table=t_ex1", "fields=f_a", "rows=r_1,r_2", "--allow-writes")


def ok(cond, msg):
    global checks
    assert cond, msg
    checks += 1


def balance(n):
    return {"ok": True, "class": "ok", "tier": 1, "ms": 100, "data": {"balance": n}}


def fixtures(bal, *writes):
    fx = {"api-anything/creditBalance.json": balance(bal) if bal is not None else AUTH_FAIL}
    for w in writes or ("runCells",):
        fx[f"api-anything/{w}.json"] = SENT
    return fx


def sent_lines(log):
    return [ln for ln in log.read_text().splitlines() if ln.strip()] if log.exists() else []


def test_inside_runs_over_refuses():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        allow, spend, log, chat = d / "allow.json", d / "spend.json", d / "sent.jsonl", d / "chat"
        chat.mkdir()
        env = {"CHEWBACCA_CLAY_ALLOWANCES": str(allow), "CHEWBACCA_CLAY_ALLOWANCE_SPEND": str(spend),
               "CHEWBACCA_CLAY_SENT_LOG": str(log), "CHEWBACCA_CLAY_CHAT_APPROVAL_DIR": str(chat)}

        # No allowance: the old gate, nobody approved, refused.
        code, out, _ = run(fixtures(100), {}, *RUN, env_extra=env)
        ok(code == 3 and "did not approve" in out["reason"], ("no allowance still needs the usual ok", out))

        allow.write_text(json.dumps({"v": 1, "workspaces": {WS: {"client": "Example", "daily_credits": 10}}}))
        code, out, p = run(fixtures(100), {}, *RUN, env_extra=env)
        ok(code == 0 and out["ok"] is True, ("a paid run inside the allowance goes with nobody asked", out, p.stderr))
        ok("inside the Example (ws 1000001) allowance, 0 of 10" in p.stderr, ("the run names the allowance it used", p.stderr))
        ok(len(sent_lines(log)) == 1, "exactly one request went out")

        code, out, p = run(fixtures(95), {}, *RUN, env_extra=env)
        ok(code == 0 and "5 of 10" in p.stderr, ("observed spend accumulates from the balance drop", p.stderr))

        # A top-up is never negative spend.
        code, out, p = run(fixtures(500), {}, *RUN, env_extra=env)
        ok(code == 0 and "5 of 10" in p.stderr, ("a balance increase leaves spend where it was", p.stderr))

        code, out, p = run(fixtures(494), {}, *RUN, env_extra=env)
        ok(code == 3 and out["reason"].startswith("BLOCKED:") and "11 of its 10-credit" in out["reason"],
           ("over the allowance is refused with a BLOCKED line", out))
        ok("allowance-set ws=1000001" in out["reason"], "the refusal says how the cap is raised")
        ok(len(sent_lines(log)) == 3, "nothing was sent for the refused run")

        # Row and column writes ride the same allowance once it has room; a new
        # day starts at zero and counts spend since the last check.
        rec = json.loads(spend.read_text())
        rec[WS]["day"] = "2000-01-01"
        spend.write_text(json.dumps(rec))
        code, out, p = run(fixtures(492, "updateRecords"), {}, "update-rows", "table=t_ex1",
                           "records=" + json.dumps([{"id": "r_1", "cells": {"f_a": "y"}}]), "--allow-writes", env_extra=env)
        ok(code == 0 and "2 of 10" in p.stderr, ("a new day resets spend to what landed since the last check", p.stderr))

        # Another workspace has no allowance.
        code, out, _ = run(fixtures(100), {}, *RUN, env_extra=dict(env, CLAY_WORKSPACE_ID="2000002"))
        ok(code == 3 and "did not approve" in out["reason"], "an allowance covers its own workspace only")

        # Never campaigns, blocklists, deletes or auto-run.
        for args in (("campaign-status", "campaign=cam_ex1", "status=PAUSED"),
                     ("blocklist-add", "emailOrDomain=blocked.example"),
                     ("delete-rows", "table=t_ex1", "rows=r_1"),
                     ("table-auto-run", "table=t_ex1", "on=true", 'settings={"AUTO_RUN_ON":false}')):
            code, out, _ = run(fixtures(100, "campaignStatus", "blocklistAdd", "deleteRecords", "updateTableSettings"),
                               {}, *args, "--allow-writes", env_extra=env)
            ok(code == 3 and "did not approve" in out["reason"], (f"{args[0]} is outside any allowance", out))

        # An unreadable balance can't be checked, so it falls back to asking.
        code, out, p = run(fixtures(None), {}, *RUN, env_extra=env)
        ok(code == 3 and "did not approve" in out["reason"] and "could not be read" in p.stderr,
           ("an unreadable balance never runs on the allowance", out, p.stderr))

        # His stop holds the allowance too.
        (chat / "STOPPED").write_text("1")
        code, out, _ = run(fixtures(492), {}, *RUN, env_extra=env)
        ok(code == 3 and out["reason"].startswith("BLOCKED: Caleb said stop"), ("a stop holds the allowance", out))

        code, out, _ = run(fixtures(492), {}, *RUN, env_extra=dict(env, CHEWBACCA_NO_SEND="1"))
        ok(code == 3 and "NO_SEND" in out["reason"], "CHEWBACCA_NO_SEND=1 still refuses first")


def test_setting_an_allowance_needs_caleb():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        allow, chat = d / "allow.json", d / "chat"
        chat.mkdir()
        env = {"CHEWBACCA_CLAY_ALLOWANCES": str(allow), "CHEWBACCA_CLAY_ALLOWANCE_SPEND": str(d / "spend.json"),
               "CHEWBACCA_CLAY_CHAT_APPROVAL_DIR": str(chat)}
        args = ("allowance-set", f"ws={WS}", "daily=40", "client=Sabo")

        def said(text, sid="s-caleb", age=60, **extra):
            rec = {"v": 2, "interactive": True, "at": int(time.time()) - age, "session_id": sid, "excerpt": text, **extra}
            (chat / f"{sid}.json").write_text(json.dumps(rec))

        code, out, _ = run({}, {}, *args, env_extra=env)
        ok(code == 3 and out["reason"].startswith("BLOCKED:") and not allow.exists(), ("no ok, no allowance", out))
        said("yo")
        code, out, _ = run({}, {}, *args, env_extra=env)
        ok(code == 3 and not allow.exists(), "a recent prompt that doesn't name the number can't set a cap")
        said("Sabo can spend 400 credits a day")
        code, out, _ = run({}, {}, *args, env_extra=env)
        ok(code == 3 and not allow.exists(), "400 in chat does not approve 40")
        said("Sabo can spend 40 credits a day", age=3 * 3600)
        code, out, _ = run({}, {}, *args, env_extra=env)
        ok(code == 3 and not allow.exists(), "a chat message older than 2 hours does not set it")
        said("Sabo can spend 40 credits a day", interactive=False)
        code, out, _ = run({}, {}, *args, env_extra=env)
        ok(code == 3 and not allow.exists(), "a launched session's prompt does not set it")

        said("Sabo can spend 40 credits a day, no outreach")
        code, out, _ = run({}, {}, *args, env_extra=env)
        cfg = json.loads(allow.read_text())
        a = cfg["workspaces"][WS]
        ok(code == 0 and a["daily_credits"] == 40 and a["client"] == "Sabo" and a["set_by"].startswith("chat s-caleb"),
           ("his own message naming the number sets it", out))

        (chat / "s-caleb.json").unlink()
        code, out, _ = run({}, {}, "allowance-set", f"ws={WS}", "daily=60", env_extra=dict(env, CHEWBACCA_CLAY_TTY_ANSWER="allowance-set"))
        a = json.loads(allow.read_text())["workspaces"][WS]
        ok(code == 0 and a["daily_credits"] == 60 and a["client"] == "Sabo" and a["set_by"] == "terminal",
           ("typed at a terminal it sets it, keeping the client name", out))

        code, out, _ = run({}, {}, "allowance", env_extra=env)
        ok(code == 0 and out["allowances"][WS]["daily_credits"] == 60 and out["allowances"][WS]["spent_today"] == 0,
           ("allowance lists it", out))
        code, out, _ = run({}, {}, "allowance-set", f"ws={WS}", "daily=-5", env_extra=env)
        ok(code == 2, "a cap that isn't a positive number is a usage error")
        code, out, _ = run({}, {}, "allowance-clear", f"ws={WS}", env_extra=env)
        ok(code == 0 and WS not in json.loads(allow.read_text())["workspaces"], "allowance-clear removes it with no ok needed")


def main():
    test_inside_runs_over_refuses()
    test_setting_an_allowance_needs_caleb()
    print(f"clay allowance: {checks} checks passed")


if __name__ == "__main__":
    main()
