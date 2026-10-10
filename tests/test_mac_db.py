"""bin/mac-db against a fake home of fake Apple databases, never the real ones."""
import gzip
import json
import os
import sqlite3
import struct
import subprocess
import sys
import time
from pathlib import Path

BIN = Path(__file__).resolve().parents[1] / "bin" / "mac-db"
CD = 978307200
NOW = time.time()


def _sql(path: Path, *stmts):
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    for s in stmts:
        con.execute(*s) if isinstance(s, tuple) else con.execute(s)
    con.commit(); con.close()


def _pb(field, payload: bytes) -> bytes:
    """One length-delimited protobuf field (lengths here stay under 128)."""
    return bytes([(field << 3) | 2, len(payload)]) + payload


def _home(tmp: Path) -> Path:
    L = tmp / "Library"
    _sql(L / "Application Support/CallHistoryDB/CallHistory.storedata",
         "create table ZCALLRECORD (ZDATE real, ZADDRESS text, ZNAME text, ZORIGINATED int, ZANSWERED int, ZDURATION real, ZCALLTYPE int)",
         ("insert into ZCALLRECORD values (?,?,?,?,?,?,?)", (NOW - 3600 - CD, "+1 (310) 555-0100", None, 1, 0, 65.4, 1)),
         ("insert into ZCALLRECORD values (?,?,?,?,?,?,?)", (NOW - 40 * 86400 - CD, "+13105550199", None, 0, 0, 0, 16)))
    ab = L / "Application Support/AddressBook/Sources/X/AddressBook-v22.abcddb"
    _sql(ab,
         "create table ZABCDRECORD (Z_PK int, ZFIRSTNAME text, ZLASTNAME text, ZORGANIZATION text, ZNICKNAME text, ZCREATIONDATE real, ZMODIFICATIONDATE real)",
         "create table ZABCDPHONENUMBER (ZOWNER int, ZFULLNUMBER text)",
         "create table ZABCDEMAILADDRESS (ZOWNER int, ZADDRESS text)",
         ("insert into ZABCDRECORD values (1,'Test','Person',null,null,?,null)", (NOW - CD,)),
         "insert into ZABCDPHONENUMBER values (1,'310-555-0100')")
    body = gzip.compress(_pb(2, _pb(3, _pb(2, "Hello note\nsecond line".encode()))))
    _sql(L / "Group Containers/group.com.apple.notes/NoteStore.sqlite",
         "create table ZICCLOUDSYNCINGOBJECT (Z_PK int, ZTITLE1 text, ZTITLE2 text, ZSNIPPET text, ZFOLDER int, ZMARKEDFORDELETION int, ZMODIFICATIONDATE1 real)",
         "create table ZICNOTEDATA (ZNOTE int, ZDATA blob, ZCRYPTOTAG blob)",
         "insert into ZICCLOUDSYNCINGOBJECT values (9, null, 'Notes', null, null, 0, null)",
         ("insert into ZICCLOUDSYNCINGOBJECT values (10, 'Hello note', null, 'second line', 9, 0, ?)", (NOW - 60 - CD,)),
         ("insert into ZICNOTEDATA values (10, ?, null)", (body,)))
    blob = b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+\x05hi yo\x86"
    _sql(L / "Messages/chat.db",
         "create table message (ROWID int, date int, is_from_me int, handle_id int, text text, attributedBody blob)",
         "create table handle (ROWID int, id text)",
         "create table chat (ROWID int, display_name text)",
         "create table chat_message_join (chat_id int, message_id int)",
         "insert into handle values (1, '+13105550100')",
         ("insert into message values (1, ?, 0, 1, null, ?)", (int((NOW - 120 - CD) * 1e9), blob)))
    # Chrome: visit_time in microseconds since 1601.
    _sql(L / "Application Support/Google/Chrome/Default/History",
         "create table urls (id int, url text, title text)",
         "create table visits (id int, url int, visit_time int, visit_duration int)",
         "insert into urls values (1, 'https://example.com', 'Example')",
         ("insert into visits values (1, 1, ?, 5000000)", (int((NOW - 30 + 11644473600) * 1e6),)))
    # Biome SEGB v2: header, one record, index entry at the end.
    payload = _pb(6, b"com.example.App")
    rec = b"\x00" * 8 + payload
    data = bytearray(b"SEGB" + struct.pack("<I", 1) + struct.pack("<d", NOW - CD) + b"\x00" * 16 + rec)
    data += b"\x00" * (4096 - len(data))
    data[-16:] = struct.pack("<IId", len(rec), 1, NOW - 5 - CD)
    biome = L / "Biome/streams/restricted/App.InFocus/local"
    biome.mkdir(parents=True)
    (biome / "1").write_bytes(bytes(data))
    return tmp


def run(home, *args, ok=True):
    p = subprocess.run([sys.executable, str(BIN), *args], capture_output=True, text=True,
                       env={**os.environ, "MAC_DB_HOME": str(home), "MAC_DB_SYSROOT": str(home)})
    if ok:
        assert p.returncode == 0, p.stderr
    return p


def j(home, *args):
    return json.loads(run(home, *args, "--json").stdout)


def test_calls_window_and_contact_name(tmp_path):
    rows = j(_home(tmp_path), "calls")
    assert len(rows) == 1  # the 40-day-old call is outside the 7-day default
    assert rows[0]["direction"] == "out" and rows[0]["seconds"] == 65
    assert rows[0]["who_name"] == "Test Person"
    assert len(j(tmp_path, "calls", "--days", "0")) == 2


def test_messages_decode_attributed_body(tmp_path):
    rows = j(_home(tmp_path), "messages")
    assert rows[0]["text"] == "hi yo" and rows[0]["who_name"] == "Test Person"
    assert "body_blob" not in rows[0]


def test_note_body_from_gzip_protobuf(tmp_path):
    home = _home(tmp_path)
    assert j(home, "notes")[0]["title"] == "Hello note"
    assert j(home, "note", "10")["text"] == "Hello note\nsecond line"


def test_chrome_copy_and_search(tmp_path):
    home = _home(tmp_path)
    assert j(home, "chrome", "--search", "example")[0]["seconds"] == 5
    assert j(home, "chrome", "--search", "nomatch") == []


def test_biome_segb_record(tmp_path):
    home = _home(tmp_path)
    assert j(home, "biome")[0]["stream"] == "App.InFocus"
    assert j(home, "biome", "App.InFocus")[0]["values"] == "com.example.App"


def test_sql_write_backs_up_then_restore_undoes(tmp_path):
    home = _home(tmp_path)
    count = lambda: json.loads(run(home, "sql", "calls", "select count(*) n from ZCALLRECORD").stdout)[0]["n"]
    out = json.loads(run(home, "sql", "calls", "delete from ZCALLRECORD where ZCALLTYPE = 16").stdout)
    assert out["changed"] == 1 and count() == 1
    backup = Path(out["backup"])
    assert (backup / "manifest.json").exists()
    assert backup.parent == home / ".chewbacca/mac-db/backups"
    run(home, "restore", backup.name)
    assert count() == 2


def _fake_mac(tmp_path):
    bindir = tmp_path / "fakebin"
    bindir.mkdir()
    log = tmp_path / "mac.log"
    (bindir / "mac").write_text(f"#!/bin/sh\necho \"$@\" >> {log}\n")
    (bindir / "mac").chmod(0o755)
    return bindir, log


def test_app_verbs_go_through_the_mac_cli(tmp_path):
    home = _home(tmp_path)
    bindir, log = _fake_mac(tmp_path)
    env = {**os.environ, "MAC_DB_HOME": str(home), "PATH": f"{bindir}:{os.environ['PATH']}"}
    env.pop("CHEWBACCA_NO_SEND", None)
    subprocess.run([sys.executable, str(BIN), "reminders", "add", "Buy milk", "--due", "tomorrow"], env=env, check=True)
    subprocess.run([sys.executable, str(BIN), "notes", "append", "10", "more"], env=env, check=True)
    assert log.read_text().splitlines() == ["reminders add Buy milk --due tomorrow", "notes append 10 more"]


def test_no_send_never_reaches_messages(tmp_path):
    home = _home(tmp_path)
    bindir, log = _fake_mac(tmp_path)
    env = {**os.environ, "MAC_DB_HOME": str(home), "PATH": f"{bindir}:{os.environ['PATH']}", "CHEWBACCA_NO_SEND": "1"}
    p = subprocess.run([sys.executable, str(BIN), "messages", "send", "+15550100", "hi"], env=env,
                       capture_output=True, text=True, check=True)
    assert "[no send]" in p.stdout and not log.exists()


def test_biome_clear_keeps_a_backup(tmp_path):
    home = _home(tmp_path)
    assert "cleared 1 files" in run(home, "biome", "App.InFocus", "--clear").stdout
    assert j(home, "biome") == []
    assert any((home / ".chewbacca/mac-db/backups").glob("biome-App.InFocus-*"))


def test_stores_report_missing_and_present(tmp_path):
    report = {r["store"]: r for r in j(_home(tmp_path), "stores")}
    assert report["calls"]["readable"] and report["calls"]["rows"] == 2
    assert report["photos"]["note"] == "not on this Mac"
    assert report["biome"]["rows"] == 1


def test_unknown_store_exits_2(tmp_path):
    assert run(_home(tmp_path), "nope", ok=False).returncode == 2
