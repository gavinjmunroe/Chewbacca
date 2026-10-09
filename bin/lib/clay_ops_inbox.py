"""The sequencer inbox in clay-inbox's shape, read through `chewbacca clay`.

An adapter for gtm_ingest, which this file does not change: pass
`inbox_fn=clay_ops_inbox.fetch_inbox_for_sync` to `gtm_ingest.sync`. It returns what
bin/clay-inbox returns (each reply plus a `history` key holding its
message-history answer) without driving Caleb's signed-in Chrome tab:
clay-inbox navigates that tab to the campaigns page before it can read.

Read only. Raises gtm_ingest's SourceUnavailable when a read fails, so a sync
records the inbox as skipped rather than empty.
"""
from __future__ import annotations

import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
FRONT_DOOR = ROOT / "bin" / "chewbacca-clay"
PAGE = 20          # Clay pages master-inbox replies 20 at a time whatever limit is asked
MAX_PAGES = 250    # 5,000 replies, clay-inbox's own ceiling
# Separate processes are not paced against each other by api-anything. Four at
# once keeps a 65-thread inbox to a few seconds without a burst of 65.
WORKERS = 4


class InboxUnavailable(RuntimeError):
    pass


def _run(args: list[str]) -> dict:
    p = subprocess.run(["node", str(FRONT_DOOR), *args], capture_output=True, text=True, timeout=180)
    try:
        out = json.loads(p.stdout)
    except json.JSONDecodeError:
        raise InboxUnavailable(f"chewbacca clay {args[0]} printed non-JSON: {p.stderr[:200]}") from None
    if not out.get("ok"):
        raise InboxUnavailable(f"chewbacca clay {args[0]}: {out.get('class')}: {str(out.get('reason'))[:200]}")
    return out


def fetch_inbox(workspace_id: str) -> list:
    replies: list = []
    for page in range(MAX_PAGES):
        got = _run(["inbox", f"ws={workspace_id}", f"offset={page * PAGE}", "--surface", "api"])["data"] or []
        replies.extend(got)
        if len(got) < PAGE:
            break

    def thread(r: dict) -> dict:
        h = _run(["thread", f"ws={workspace_id}", f"campaign_id={r['email_campaign_id']}",
                  f"lead_id={int(r['email_lead_id'])}"])["data"]
        return {**r, "history": h}

    with ThreadPoolExecutor(WORKERS) as pool:
        return list(pool.map(thread, replies))


def _unavailable(err: Exception) -> Exception:
    try:
        from gtm_ingest import SourceUnavailable  # type: ignore
        return SourceUnavailable(str(err))
    except ImportError:
        return err


def fetch_inbox_for_sync(workspace_id: str) -> list:
    try:
        return fetch_inbox(workspace_id)
    except InboxUnavailable as err:
        raise _unavailable(err) from err
