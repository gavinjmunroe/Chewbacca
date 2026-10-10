"""clay-inbox: filters by campaign, and says so when Clay refuses the read.

Hermetic: `chewie` is a stub on PATH that answers the in-page fetch with a
canned inbox, so no browser or Clay session is touched.
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
    {"lead_email": "a@fund.com", "email_campaign_name": "Zeutara | Qube Finance | Seed", "history": {"history": []}},
    {"lead_email": "b@fund.com", "email_campaign_name": "Zeutara | Ivy | Pre-seed", "history": {"history": []}},
]


def run(answer, *args, env_extra=None):
    with tempfile.TemporaryDirectory() as d:
        stub = Path(d) / "chewie"
        stub.write_text(
            "#!/bin/sh\n"
            '[ "$2" = "eval" ] && cat "$CLAY_STUB_ANSWER"\n'
            "exit 0\n"
        )
        stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
        ans = Path(d) / "answer.json"
        ans.write_text(json.dumps(json.dumps(answer)))
        # A synthetic workspace, and never the real GTM client config.
        env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}", CLAY_STUB_ANSWER=str(ans),
                   CLAY_WORKSPACE_ID="1000001", GTM_CONFIG=str(Path(d) / "no-clients.json"))
        env.update(env_extra or {})
        return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True, env=env, timeout=30)


def main():
    out = run(INBOX, "--campaign", "qube")
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert [r["lead_email"] for r in got] == ["a@fund.com"], got

    out = run(INBOX)
    assert len(json.loads(out.stdout)) == 2

    out = run({"error": {"type": "Unauthorized"}})
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
    # The workspace goes into JS evaluated in the signed-in tab: only digits.
    out = run(INBOX, "--workspace", "1');alert(1);//")
    assert out.returncode != 0 and "numeric" in out.stderr, out.stderr
    print("clay-inbox: 7 checks passed")


if __name__ == "__main__":
    main()
