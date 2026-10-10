"""bin/screen-time against a fake knowledgeC.db, never the real one."""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "bin" / "screen-time"
EPOCH = 978307200


def _db(tmp: Path) -> Path:
    db = tmp / "knowledgeC.db"
    con = sqlite3.connect(db)
    con.execute("create table ZOBJECT (ZSTREAMNAME text, ZVALUESTRING text, ZSTARTDATE real, ZENDDATE real)")
    # Noon local on each day keeps the date stable in any timezone the runner is in.
    import datetime as dt
    def at(day, hours, bundle, stream="/app/usage"):
        t = dt.datetime.fromisoformat(f"{day}T12:00:00").timestamp() - EPOCH
        con.execute("insert into ZOBJECT values (?,?,?,?)", (stream, bundle, t, t + hours * 3600))
    at("2026-10-09", 2, "com.microsoft.VSCode")
    at("2026-10-08", 1, "com.anthropic.claudefordesktop")
    at("2026-10-08", 3, "com.google.Chrome")
    at("2026-10-01", 1.5, "com.microsoft.VSCode")       # the week before
    at("2026-10-09", 5, "com.microsoft.VSCode", "/notification/usage")  # other stream, ignored
    con.commit(); con.close()
    return db


def _run(tmp, *args):
    env = {**os.environ, "SCREEN_TIME_DB": str(_db(tmp))}
    out = subprocess.run([sys.executable, str(BIN), "--end", "2026-10-09", "--json", *args],
                         env=env, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_all_apps_week_and_change(tmp_path):
    s = _run(tmp_path)
    assert s["total_minutes"] == 360
    assert s["previous_total_minutes"] == 90
    assert s["change_pct"] == 300
    assert [a["name"] for a in s["apps"]] == ["Google Chrome", "Claude Code (VS Code)", "Claude"]
    assert s["apps"][1]["by_day"][-1] == 120


def test_dev_preset_drops_chrome(tmp_path):
    s = _run(tmp_path, "--only", "dev")
    assert {a["name"] for a in s["apps"]} == {"Claude Code (VS Code)", "Claude"}
    assert s["total_minutes"] == 180
    assert s["daily_average_minutes"] == 26


def test_html_card_renders(tmp_path):
    db = _db(tmp_path)
    out = tmp_path / "card.html"
    subprocess.run([sys.executable, str(BIN), "--end", "2026-10-09", "--only", "dev", "--html", str(out)],
                   env={**os.environ, "SCREEN_TIME_DB": str(db)}, check=True, capture_output=True)
    page = out.read_text()
    assert "Daily Average" in page and "Claude Code (VS Code)" in page and "Google Chrome" not in page
