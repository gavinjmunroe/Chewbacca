#!/usr/bin/env python3
"""granola-import's reading of Granola's MCP answers, hermetic: no network,
no token, no Granola. Fixture answers in the shapes Anarlog's importer reads
(JSON lists, JSON in prose, tagged text) become rc-<start> meetings the
meetings surface already reads, with Granola's notes as the summary, no
action items queued, and a second meeting at the same second kept apart.
"""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
tmp = tempfile.mkdtemp()
os.environ["HOME"] = tmp
loader = importlib.machinery.SourceFileLoader("granola_import", str(ROOT / "bin" / "granola-import"))
spec = importlib.util.spec_from_loader("granola_import", loader)
GI = importlib.util.module_from_spec(spec)
loader.exec_module(GI)
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import meeting_capture as MC  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


LISTER = {"name": "list_meetings", "inputSchema": {"properties": {"limit": {}, "cursor": {}, "time_range": {}},
                                                    "required": ["time_range"]}}
GETTER = {"name": "get_meetings", "inputSchema": {"properties": {"meeting_ids": {"type": "array"}}}}
TX = {"name": "get_meeting_transcript", "inputSchema": {"properties": {"meeting_id": {"type": "string"}}}}

check("list arguments come from the tool's own schema",
      GI.list_arguments(LISTER, 0, "c2") == {"limit": 50, "cursor": "c2", "time_range": "all"},
      GI.list_arguments(LISTER, 0, "c2"))
check("ids batch into an array argument when the schema has one",
      GI.id_arguments(GETTER, ["a", "b"]) == [{"meeting_ids": ["a", "b"]}])
check("one id per call when the schema takes one", GI.id_arguments(TX, ["a", "b"]) == [{"meeting_id": "a"},
                                                                                      {"meeting_id": "b"}])
check("a tool is found across case and separators", GI.tool_named([{"name": "List-Meetings"}], ["list_meetings"]))
listed = GI.records([GI.parse_json_text('Here: {"meetings":[{"id":"g1","title":"Jonah sync","date":'
                                        '"2026-10-01T17:00:00Z"}],"next_cursor":"c2"}')], {})
check("JSON inside prose is read and the meeting found", list(listed) == ["g1"], listed)
check("a cursor is followed", GI.next_cursor([{"next_cursor": "c2"}]) == "c2"
      and GI.next_cursor([{"next_cursor": "c2", "has_more": False}]) is None)
tagged = GI.records(['<meetings><meeting id="g2" title="Sagar 1:1" date="Oct 2"></meeting></meetings>'], {})
check("tagged text answers are read too", tagged.get("g2", {}).get("title") == "Sagar 1:1", tagged)

used = set()
detail = [{"meetings": [{"id": "g1", "title": "Jonah sync", "start_time": "2026-10-01T17:00:00Z",
                         "end_time": "2026-10-01T17:30:00Z", "summary": "## Notes\n- Ship tier A Monday",
                         "attendees": [{"name": "Jonah", "email": "jonah@zeutara.example"}],
                         "action_items": ["Send list"]}]}]
tx = [{"transcript": [{"speaker": "Jonah", "text": "Ship tier A Monday", "start_timestamp": "2026-10-01T17:01:00Z"}]}]
m = GI.to_meeting("g1", listed["g1"], detail, tx, used)
check("it becomes a native meeting id the surface reads", MC.is_native(m["id"]), m["id"])
check("Granola's notes are the summary, not marked a guess",
      m["summary"]["by"] == "Granola" and "Ship tier A" in m["summary"]["markdown"] and not m["summary"]["guess"])
check("the transcript keeps who said it", m["lines"][0]["text"] == "Jonah: Ship tier A Monday", m["lines"])
check("attendees carry over", m["participants"][0]["email"] == "jonah@zeutara.example")
check("no action items are queued from history", m["action_items"] == [])
twin = GI.to_meeting("g9", {"id": "g9", "title": "Twin", "date": "2026-10-01T17:00:00Z"}, [], [], used)
check("two meetings starting the same second get two files", twin["id"] != m["id"] and MC.is_native(twin["id"]))
check("the CLI parses", compile((ROOT / "bin" / "granola-import").read_text(), "granola-import", "exec") is not None)
print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
