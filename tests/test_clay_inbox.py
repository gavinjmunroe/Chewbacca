"""clay-inbox: filters by campaign, and says so when Clay refuses the read.

Hermetic: `chewbacca` and `chewie` are stubs on PATH that answer the API read
and the in-page fetch with a canned inbox, so no network, browser or Clay
session is touched. The API path became the default in 86587a58 (10/11) and
this test kept stubbing only chewie, so every run reached for the real
`chewbacca clay` and hung past its 30 s timeout.
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "bin" / "clay-inbox"

INBOX = [
    {"lead_email": "a@fund.com", "email_campaign_name": "Zeutara | Qube Finance | Seed", "history": {"history": []},
     "email_campaign_id": "c1", "email_lead_id": "1"},
    {"lead_email": "b@fund.com", "email_campaign_name": "Zeutara | Ivy | Pre-seed", "history": {"history": []},
     "email_campaign_id": "c2", "email_lead_id": "2"},
]

# `chewbacca clay inbox|thread ...` answered from files, the shape clay_op reads.
API_STUB = r"""#!/bin/sh
[ "$1" = clay ] || exit 2
case "$2" in
  inbox) cat "$CLAY_STUB_API" ;;
  thread) echo '{"ok": true, "data": {"history": []}}' ;;
  *) exit 2 ;;
esac
"""


def run(answer, *args, env_extra=None, api=None):
    with tempfile.TemporaryDirectory() as d:
        stub = Path(d) / "chewie"
        stub.write_text(
            "#!/bin/sh\n"
            '[ "$2" = "eval" ] && cat "$CLAY_STUB_ANSWER"\n'
            "exit 0\n"
        )
        stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
        cli = Path(d) / "chewbacca"
        cli.write_text(API_STUB)
        cli.chmod(cli.stat().st_mode | stat.S_IEXEC)
        ans = Path(d) / "answer.json"
        ans.write_text(json.dumps(json.dumps(answer)))
        api_file = Path(d) / "api.json"
        api_file.write_text(json.dumps(api if api is not None else {"ok": True, "data": INBOX}))
        # A synthetic workspace, and never the real GTM client config.
        env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}", CLAY_STUB_ANSWER=str(ans),
                   CLAY_STUB_API=str(api_file),
                   CLAY_WORKSPACE_ID="1000001", GTM_CONFIG=str(Path(d) / "no-clients.json"))
        env.update(env_extra or {})
        return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True, env=env, timeout=30)


def main():
    # The default path: the API, no browser.
    out = run(INBOX, "--campaign", "qube")
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert [r["lead_email"] for r in got] == ["a@fund.com"], got
    out = run(INBOX)
    assert len(json.loads(out.stdout)) == 2
    out = run(INBOX, api={"ok": False, "error": "Unauthorized"})
    assert out.returncode != 0 and "Unauthorized" in out.stderr, (out.returncode, out.stderr)

    # The browser path, only when asked for.
    out = run(INBOX, "--browser", "--campaign", "qube")
    assert out.returncode == 0, out.stderr
    assert [r["lead_email"] for r in json.loads(out.stdout)] == ["a@fund.com"]
    out = run({"error": {"type": "Unauthorized"}}, "--browser")
    assert out.returncode != 0 and "refused" in out.stderr, (out.returncode, out.stderr)

    # No built-in workspace: with none chosen it refuses instead of reading a client's inbox.
    out = run(INBOX, env_extra={"CLAY_WORKSPACE_ID": ""})
    assert out.returncode != 0 and "no Clay workspace chosen" in out.stderr, (out.returncode, out.stderr)
    with tempfile.TemporaryDirectory() as d:
        one = Path(d) / "clients.json"
        one.write_text(json.dumps({"clients": [{"name": "A", "workspaces": ["2000002"]}]}))
        out = run(INBOX, env_extra={"CLAY_WORKSPACE_ID": "", "GTM_CONFIG": str(one)})
        assert out.returncode == 0, out.stderr
        one.write_text(json.dumps({"clients": [{"name": "A", "workspaces": ["2000002"]}, {"name": "B", "workspaces": ["3000003"]}]}))
        out = run(INBOX, env_extra={"CLAY_WORKSPACE_ID": "", "GTM_CONFIG": str(one)})
        assert out.returncode != 0 and "no Clay workspace chosen" in out.stderr, out.stderr
    # The workspace goes into a URL and into JS evaluated in the signed-in tab: only digits.
    out = run(INBOX, "--workspace", "1');alert(1);//")
    assert out.returncode != 0 and "numeric" in out.stderr, out.stderr
    print("clay-inbox: 10 checks passed")


if __name__ == "__main__":
    main()
