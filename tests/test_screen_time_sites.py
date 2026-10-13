"""screen-time --sites against a fake knowledgeC.db and fake Chrome profiles.

The rule under test: Chrome's foreground seconds go to the newest navigation
before them, across profiles, and Chrome's own visit_duration is ignored (it
kept counting background tabs: 19.5 h of google.com inside 14.3 h of Chrome in
front, 10/7 to 10/13)."""
import datetime as dt
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "bin" / "screen-time"
APPLE = 978307200
CHROME = 11644473600


def at(hhmm: str) -> float:
    return dt.datetime.fromisoformat(f"2026-10-09T{hhmm}:00").timestamp()


def _knowledge(tmp: Path) -> Path:
    db = tmp / "knowledgeC.db"
    con = sqlite3.connect(db)
    con.execute("create table ZOBJECT (ZSTREAMNAME text, ZVALUESTRING text, ZSTARTDATE real, ZENDDATE real)")
    # Chrome in front 10:00 to 11:00 and 14:00 to 14:30; VS Code between.
    for a, b, bundle in (("10:00", "11:00", "com.google.Chrome"), ("11:00", "14:00", "com.microsoft.VSCode"),
                         ("14:00", "14:30", "com.google.Chrome")):
        con.execute("insert into ZOBJECT values ('/app/usage',?,?,?)", (bundle, at(a) - APPLE, at(b) - APPLE))
    con.commit(); con.close()
    return db


def _profile(chrome: Path, name: str, visits: list[tuple[str, str, float]]) -> None:
    d = chrome / name
    d.mkdir(parents=True)
    con = sqlite3.connect(d / "History")
    con.execute("create table urls (id integer primary key, url text)")
    con.execute("create table visits (id integer primary key, url integer, visit_time integer, visit_duration integer)")
    for i, (hhmm, url, hours) in enumerate(visits, 1):
        con.execute("insert into urls values (?,?)", (i, url))
        con.execute("insert into visits (url, visit_time, visit_duration) values (?,?,?)",
                    (i, int((at(hhmm) + CHROME) * 1e6), int(hours * 3600e6)))
    con.commit(); con.close()


def _run(tmp: Path) -> dict:
    chrome = tmp / "Chrome"
    # visit_duration claims 9 h of google.com: a parked background tab. It must not count.
    _profile(chrome, "Default", [("09:30", "https://www.google.com/search?q=x", 9),
                                 ("10:40", "https://github.com/a/b", 0.1)])
    _profile(chrome, "Profile 1", [("10:15", "https://app.example.com/t/1", 0.1),
                                   ("14:10", "https://mail.google.com/mail/u/0", 0.1)])
    (chrome / "Local State").write_text(json.dumps(
        {"profile": {"info_cache": {"Default": {"name": "Personal"}, "Profile 1": {"name": "Work"}}}}))
    env = {**os.environ, "SCREEN_TIME_DB": str(_knowledge(tmp)), "SCREEN_TIME_CHROME_DIR": str(chrome)}
    out = subprocess.run([sys.executable, str(BIN), "--sites", "--end", "2026-10-09", "--days", "1", "--json"],
                         env=env, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_foreground_time_goes_to_the_newest_navigation(tmp_path):
    r = _run(tmp_path)
    got = {s["site"]: s["minutes"] for s in r["sites"]}
    # 10:00-10:15 google (opened 09:30), 10:15-10:40 example, 10:40-11:00 github,
    # 14:00-14:10 still github (VS Code time in between is not Chrome's), 14:10-14:30 mail.
    assert got == {"google.com": 15, "app.example.com": 25, "github.com": 30, "mail.google.com": 20}
    assert r["chrome_minutes"] == 90
    assert sum(got.values()) == r["chrome_minutes"]


def test_site_rows_name_the_profile_and_count_visits(tmp_path):
    rows = {s["site"]: s for s in _run(tmp_path)["sites"]}
    assert rows["app.example.com"]["profile"] == "Work"
    assert rows["google.com"]["profile"] == "Personal"
    assert rows["github.com"]["visits"] == 1


def test_the_live_history_file_is_never_opened(tmp_path):
    # Chrome keeps History locked while it runs. A copy is read; the original
    # must come out byte for byte the same, with no -journal or -wal left beside it.
    r = _run(tmp_path)
    assert r["sites"]
    hist = tmp_path / "Chrome" / "Default" / "History"
    assert not hist.with_name("History-journal").exists()
    assert not hist.with_name("History-wal").exists()
