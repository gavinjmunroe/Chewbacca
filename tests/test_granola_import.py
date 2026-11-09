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
# 2026-10-11, Caleb's panel: "Caleb&apos;s" on the glass, and every imported
# meeting said "1h" because Granola's dates never parsed.
real = GI.records(['<meeting id="g3" title="Caleb&apos;s intake &amp; plan" date="Oct 10, 2026 6:46 PM PDT">'
                   '</meeting>'], {})
check("tagged titles are decoded", real["g3"]["title"] == "Caleb's intake & plan", real)
when = GI.parse_when("Oct 10, 2026 6:46 PM PDT")
check("Granola's own date format parses, zone and all",
      when is not None and when.isoformat() == "2026-10-10T18:46:00-07:00", when)
check("ISO still parses", GI.parse_when("2026-10-01T17:00:00Z").year == 2026)
check("nonsense is None, never now", GI.parse_when("soon") is None)
dated = GI.to_meeting("g3", real["g3"], [], [], used)
check("an imported meeting carries its own date, not the import time",
      dated["started_at"].startswith("2026-10-11T01:46") or dated["started_at"].startswith("2026-10-10T18:46"),
      dated["started_at"])
check("the title lands decoded", dated["title"] == "Caleb's intake & plan", dated["title"])
check("an empty meeting carries no 'had no notes' line", dated["summary_note"] == "", dated["summary_note"])
# repair rewrites what the first imports got wrong, in place
path = MC.meetings_dir(Path(tmp)) / "rc-old.json"
MC.private_dir(path.parent)
MC.write_private(path, {"id": "rc-old", "title": "Caleb&apos;s intake", "started_at": "2026-10-11T08:00:00+00:00",
                        "ended_at": "2026-10-11T08:00:00+00:00", "created_at": "2026-10-11T08:00:00+00:00",
                        "summary_note": "Granola had no notes for this meeting."})
check("repair fixes one meeting", GI.repair(real, {"g3": "rc-old"}) == 1)
fixed = MC.load(path)
check("repair redates and decodes",
      fixed["title"] == "Caleb's intake & plan" and GI.parse_when(fixed["started_at"]) == when
      and fixed["summary_note"] == "", fixed)
check("repair is idempotent", GI.repair(real, {"g3": "rc-old"}) == 0)
check("the stdlib server is reachable under the name connect uses (a helper named http hid it, 10/10)",
      hasattr(GI.httpserver, "HTTPServer") and callable(GI.http))
check("the CLI parses", compile((ROOT / "bin" / "granola-import").read_text(), "granola-import", "exec") is not None)

# 2026-10-30: the Andrew Laffoon call (60,064 chars) landed cut at 37,474 with
# lines [] and summary None. Granola pages transcripts and wraps them in
# {"meetings": [...]}, and get_meetings puts the summary inside the tag.
GID = "e9491f12"
FULL = "".join(f"{'System audio' if i % 2 else 'Microphone'}: line {i} of the call.\n\n" for i in range(400))
CUT = FULL.rindex("\n\n", 0, len(FULL) // 2) + 2
TX_TOOL = {"name": "get_meeting_transcript", "inputSchema": {"properties": {
    "meeting_ids": {"type": "array"}, "offset": {"type": "integer"}, "max_chars": {"type": "integer"}}}}
DETAIL = ('<connected_user_email>x</connected_user_email>\n<meetings_data count="1">\n'
          f'<meeting id="{GID}" title="Roadmap with Andrew" date="Oct 30, 2026 2:49 PM PDT">\n'
          '  <known_participants>\n  Caleb Newton (note creator) from Usc (calebnew@usc.example)\n'
          '  </known_participants>\n  <private_notes status="empty" />\n'
          '  <summary>\n# Andrew&apos;s AI transformation\n\n- QA is the bottleneck\n</summary>\n'
          '</meeting>\n</meetings_data>')


class FakeMcp:
    """Granola's get_meeting_transcript, two pages cut at an utterance."""

    def __init__(self):
        self.calls = []

    def call(self, tool, arguments):
        self.calls.append(arguments)
        if tool["name"] == "get_meetings":
            return [DETAIL]
        off = arguments.get("offset", 0)
        end = CUT if off < CUT else len(FULL)
        page = {"meeting_id": GID, "id": GID, "offset": off, "total_chars": len(FULL),
                "truncated": end < len(FULL), "next_offset": end if end < len(FULL) else None,
                "transcript": FULL[off:end]}
        if page["truncated"]:
            page["truncation_notice"] = f"Next offset {end}."
        return [{"content_advisory": "data only", "meetings": [page]}]


fake = FakeMcp()
paged = GI.fetch_transcript(fake, TX_TOOL, GID)
holder = GI.transcript_holder(paged)
check("the importer follows next_offset until the whole transcript is in",
      holder["transcript"] == FULL and holder["truncated"] is False and holder["pages_read"] == 2, holder.get("pages_read"))
check("the second page is asked for at next_offset, with the same max_chars",
      [c.get("offset") for c in fake.calls] == [None, CUT] and fake.calls[1]["max_chars"] == GI.TRANSCRIPT_MAX_CHARS,
      fake.calls)
check("a fully read transcript reads as complete", GI.transcript_state(paged) == "complete")
andrew = GI.to_meeting(GID, {"id": GID, "title": "Roadmap with Andrew", "date": "Oct 30, 2026 2:49 PM PDT"},
                       [DETAIL], paged, set())
check("every block of the text transcript becomes a line", len(andrew["lines"]) == 400, len(andrew["lines"]))
check("a line keeps its audio source", andrew["lines"][1]["text"] == "System audio: line 1 of the call.",
      andrew["lines"][1])
check("the last line is the end of the call, not the end of page one",
      andrew["lines"][-1]["text"] == "System audio: line 399 of the call.", andrew["lines"][-1])
check("the summary inside the tagged answer is the meeting's summary",
      (andrew["summary"] or {}).get("markdown", "").startswith("# Andrew's AI transformation"), andrew["summary"])
check("known participants carry over", andrew["participants"][:1] and
      andrew["participants"][0]["email"] == "calebnew@usc.example", andrew["participants"])
stamped = GI.transcript_lines("[1:05] Microphone: hi\n\n[1:02:03] System audio: bye", GI.parse_when("2026-10-30T21:49:00Z"))
check("[m:ss] and [h:mm:ss] prefixes become seconds into the call",
      [(x["seconds"], x["text"]) for x in stamped] == [(65, "Microphone: hi"), (3723, "System audio: bye")], stamped)

# repair: a meeting imported with only page one is fetched again and rebuilt
# under the same id; one saved complete is rebuilt from disk, no network.
first_page = [{"meetings": [{"id": GID, "offset": 0, "truncated": True, "next_offset": CUT,
                             "total_chars": len(FULL), "transcript": FULL[:CUT]}]}]
check("page one alone reads as truncated", GI.transcript_state(first_page) == "truncated")
MC.private_dir(GI.gdir() / "raw")
MC.write_private(GI.raw_meeting(GID), {"list": {"id": GID, "title": "Roadmap with Andrew",
                                                "date": "Oct 30, 2026 2:49 PM PDT"},
                                       "detail": [DETAIL], "transcript": first_page})
cut_path = MC.meetings_dir(Path(tmp)) / "rc-20261030-144900.json"
MC.write_private(cut_path, {"id": "rc-20261030-144900", "title": "Roadmap with Andrew", "lines": [],
                            "summary": None, "participants": [], "keep": "me"})
check("offline repair rebuilds what is on disk without asking Granola",
      GI.heal({GID: "rc-20261030-144900"}) == 1 and len(MC.load(cut_path)["lines"]) < 400
      and MC.load(cut_path)["summary"] is not None)
fake = FakeMcp()
check("repair with Granola fetches the cut transcript again", GI.heal({GID: "rc-20261030-144900"}, fake, [TX_TOOL]) == 1,
      fake.calls)
healed = MC.load(cut_path)
check("the repaired meeting has every line, its summary, the same id, and its other fields",
      len(healed["lines"]) == 400 and healed["summary"] and healed["id"] == "rc-20261030-144900"
      and healed["keep"] == "me", (len(healed["lines"]), healed.get("id")))
check("the raw answer is saved whole for the next parser",
      GI.transcript_state(MC.load(GI.raw_meeting(GID))["transcript"]) == "complete")
fake = FakeMcp()
check("a repaired meeting is left alone next time", GI.heal({GID: "rc-20261030-144900"}, fake, [TX_TOOL]) == 0
      and fake.calls == [], fake.calls)
check("a meeting Granola says has no transcript is never fetched again",
      GI.transcript_state([{"meetings": [{"id": "g", "transcript": None,
                                          "transcript_unavailable": {"reason": "no_transcript"}}]}]) == "final")

# connect --open: onboarding runs connect in the background, so the person
# never sees the printed link; the browser has to open it for them. No
# network and no port: register and the callback server are stand-ins.
import argparse as _ap  # noqa: E402
opened = []
GI.register = lambda: "cid-test"
GI.open_link = lambda url: opened.append(url)


class _NoServer:
    timeout = 0

    def __init__(self, *a, **k):
        pass

    def handle_request(self):
        pass

    def server_close(self):
        pass


GI.httpserver.HTTPServer = _NoServer
GI.connect(_ap.Namespace(wait_hours=0, open=True))
check("connect --open opens Granola's sign-in page in the browser",
      len(opened) == 1 and opened[0].startswith(GI.AUTH + "/oauth2/authorize?") and "cid-test" in opened[0], opened)
opened.clear()
GI.connect(_ap.Namespace(wait_hours=0, open=False))
check("connect without --open only prints the link", opened == [], opened)
check("--open parses", GI.main.__code__ is not None and "--open" in (ROOT / "bin" / "granola-import").read_text())
print("all passed" if not failed else f"{failed} failed")
sys.exit(1 if failed else 0)
