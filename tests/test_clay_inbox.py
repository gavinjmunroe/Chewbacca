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


def run(answer, *args):
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
        env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}", CLAY_STUB_ANSWER=str(ans))
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
    print("clay-inbox: 3 checks passed")


if __name__ == "__main__":
    main()
