"""clay_hud: the lines clay-build draws for each state, and the one socket it
draws and listens on. Builders are pure; the socket is a socketpair. Kyber is
never started here."""
import json
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import clay_hud  # noqa: E402
from clay_geometry import Rect  # noqa: E402

TARGET = Rect(400.4, 300.6, 120.2, 32.0)
VERBS = ("@", "c", ">", "r", "m", "u", "a", "-")
NAMES = tuple(f"Person {i}" for i in range(12))


def every_state():
    return {
        "acting": clay_hud.acting("FIND PEOPLE", 2, 6, "Asking Clay's people search.", "Nothing is saved yet.",
                                  TARGET, 42),
        "approve": clay_hud.approve("TEST RUN", ["Save and run 10 rows", "Balance now 1234.5 cr"],
                                    "Run the test", "Spends credits on 10 rows.", "Nothing is spent.",
                                    TARGET, 61, 4, 6),
        "dry": clay_hud.approve("TEST RUN", ["Save and run 10 rows"], "Run the test", "x", "y", TARGET, 61, 4, 6,
                                dry_run=True),
        "short": clay_hud.ask_short(30, 50, TARGET),
        "paused": clay_hud.paused(3, 6, 70, TARGET),
        "failed": clay_hud.failed(3, 6, "Couldn't find Continue on the page.", TARGET, True, 80),
        "done": clay_hud.done(50, 41, NAMES[:9], 31.2, False, 300),
        "misses": clay_hud.done(50, 38, NAMES, 31.2, None, 300, show_misses=True),
        "clear": clay_hud.clear(),
        "tick": clay_hud.tick(75),
    }


class Builders(unittest.TestCase):
    def test_every_line_is_a_hud_line(self):
        for state, lines in every_state().items():
            self.assertTrue(lines, state)
            for line in lines:
                self.assertIn(line.split(" ", 1)[0], VERBS, f"{state}: {line}")
                self.assertNotIn("\n", line, state)
                self.assertNotIn("—", line, state)

    def test_acting_sits_beside_the_target_and_points_at_it(self):
        lines = clay_hud.acting("FIND PEOPLE", 2, 6, "note", "hold", TARGET, 42)
        self.assertIn("@ clay-note near=400,301,120,32 side=right chrome=window w=300", lines)
        self.assertIn("m clay-target 400 301 120 32 life=300", lines)
        self.assertIn("a 460 317 act=true", lines)
        self.assertIn("c mk Mark kind=ico spin=true size=18", lines)
        self.assertIn('c ticks Text value="■■□□□□"', lines)
        self.assertIn('c verb Text value="Find people · 2/6"', lines)
        self.assertIn('c time Text value="0:42"', lines)
        self.assertIn('c stop Button label="Stop" action=clay-stop', lines)

    def test_approve_replaces_the_note_with_one_card(self):
        lines = every_state()["approve"]
        self.assertIn("- clay-note", lines)
        self.assertTrue(any(line.startswith("@ clay-card near=") and "urgency=alert" in line for line in lines))
        self.assertIn('c go Button label="Run the test" action=clay-approve variant=primary', lines)
        self.assertIn('c no Button label="Not now" action=clay-decline', lines)
        self.assertEqual(sum("variant=primary" in line for line in lines), 1)
        self.assertIn("a 460 317", lines)
        self.assertTrue(any('message="Waiting on you"' in line for line in lines))

    def test_the_dry_run_card_cannot_approve(self):
        lines = every_state()["dry"]
        self.assertFalse(any("clay-approve" in line for line in lines))
        self.assertIn('c close Button label="Close" action=clay-close variant=primary', lines)
        self.assertTrue(any("Dry run. Nothing was pressed." in line for line in lines))

    def test_a_short_count_asks_in_numbers(self):
        lines = every_state()["short"]
        self.assertIn('c go Button label="Use all 30" action=clay-approve variant=primary', lines)
        self.assertIn('c no Button label="End here" action=clay-decline', lines)

    def test_paused_lets_go_of_the_page(self):
        lines = clay_hud.paused(3, 6, 70, TARGET, body="Table auto-run is on.", hold="Spent 6.2 cr so far.")
        self.assertIn("a off", lines)
        self.assertIn("u clay-target", lines)
        self.assertIn("- clay-card", lines)
        self.assertIn('c body Text value="Table auto-run is on."', lines)
        self.assertIn('c hold Text value="Spent 6.2 cr so far." tone=muted', lines)
        self.assertIn('c resume Button label="Resume" action=clay-resume variant=primary', lines)
        self.assertIn('c end Button label="End here" action=clay-end', lines)
        self.assertTrue(any(line.startswith("@ clay-note near=") for line in lines))
        self.assertTrue(any(line.startswith("@ clay-note at=right") for line in clay_hud.paused(3, 6, 70, None)))

    def test_failed_offers_only_what_it_can_do(self):
        lines = clay_hud.failed(3, 6, "Couldn't find Continue on the page.", TARGET, True, 80)
        self.assertIn("m clay-target 400 301 120 32 tone=miss life=300", lines)
        self.assertIn('c s Screen title="STOPPED AT 3/6"', lines)
        self.assertTrue(any("clay-retry" in line for line in lines))
        self.assertTrue(any("clay-show" in line for line in lines))
        no_retry = clay_hud.failed(4, 6, "x", TARGET, False, 80)
        self.assertFalse(any("clay-retry" in line for line in no_retry))
        no_target = clay_hud.failed(1, 6, "x", None, True, 80)
        self.assertFalse(any(line.startswith("m clay-target") for line in no_target))
        self.assertFalse(any("clay-show" in line for line in no_target))
        self.assertEqual(sum("variant=primary" in line for line in no_target), 1)

    def test_done_names_at_most_nine_misses(self):
        lines = every_state()["misses"]
        items = next(line for line in lines if line.startswith("c list List"))
        listed = json.loads(items.split("items=", 1)[1])
        self.assertEqual(listed, [*NAMES[:9], "+3 more"])
        self.assertFalse(any("clay-misses" in line for line in lines))
        self.assertTrue(any("clay-misses" in line for line in every_state()["done"]))
        self.assertIn("c mk Mark kind=globe spin=true size=40", lines)
        self.assertTrue(any('message="38/50 emails · 31.2 cr"' in line for line in lines))

    def test_done_without_misses_offers_no_list(self):
        lines = clay_hud.done(10, 10, (), 6.0, False, 100)
        self.assertFalse(any("clay-misses" in line for line in lines))
        self.assertIn('c close Button label="Close" action=clay-close variant=primary', lines)

    def test_a_quote_in_copy_survives_as_json(self):
        lines = clay_hud.acting("FIND PEOPLE", 2, 6, 'Asking for "seed" partners.', "hold", TARGET, 1)
        body = next(line for line in lines if line.startswith("c body Text"))
        self.assertEqual(json.loads(body.split("value=", 1)[1]), 'Asking for "seed" partners.')

    def test_the_snapshot_fixtures_are_what_a_run_sends(self):
        # ClayStatesTests.swift renders these files; regenerate with
        # python3 bin/lib/clay_hud.py --print <state> > tests/fixtures/clay-hud/<state>.lines
        fixtures = Path(__file__).resolve().parent / "fixtures" / "clay-hud"
        for state in clay_hud.FIXTURE_STATES:
            self.assertEqual((fixtures / f"{state}.lines").read_text(), "\n".join(clay_hud.sample(state)) + "\n",
                             state)


class Socket(unittest.TestCase):
    def hud(self):
        ours, theirs = socket.socketpair()
        self.addCleanup(ours.close)
        self.addCleanup(theirs.close)
        theirs.settimeout(2)
        hud = clay_hud.Hud(path="/nowhere/hud.sock", connect=lambda path: ours)
        hud.open()
        return hud, theirs

    def read(self, sock, until):
        got = b""
        while until not in got:
            got += sock.recv(65536)
        return got.decode()

    def test_opens_subscribed(self):
        _, kyber = self.hud()
        self.assertEqual(self.read(kyber, b"\n"), "listen\n")

    def test_events(self):
        hud, kyber = self.hud()
        self.read(kyber, b"\n")
        kyber.sendall(b'e ks-send x surface="keystrokes"\n'
                      b'e clay-approve go surface="clay-card"\n'
                      b"e stop run\n")
        first = hud.next_event(2)
        self.assertEqual((first["name"], first["component"], first["surface"]), ("clay-approve", "go", "clay-card"))
        self.assertEqual(hud.next_event(2)["name"], "stop")
        self.assertIsNone(hud.next_event(0.05))

    def test_x_silences_every_later_send(self):
        hud, kyber = self.hud()
        self.read(kyber, b"\n")
        kyber.sendall(b"x\n")
        self.assertEqual(hud.next_event(2), {"name": "dismissed"})
        self.assertTrue(hud.dismissed)
        hud.send(["@ clay-note at=right"])
        hud.close()
        kyber.settimeout(0.2)
        try:
            leftover = kyber.recv(65536)
        except socket.timeout:
            leftover = b""
        self.assertEqual(leftover, b"")

    def test_send_and_close(self):
        hud, kyber = self.hud()
        self.read(kyber, b"\n")
        hud.send(["@ clay-note at=right", "c s Screen"])
        self.assertEqual(self.read(kyber, b"Screen\n"), "@ clay-note at=right\nc s Screen\n")
        hud.close()
        self.assertIn("- clay-strip", self.read(kyber, b"- clay-strip\n"))

    def test_kyber_going_away_reads_as_dismissed(self):
        hud, kyber = self.hud()
        self.read(kyber, b"\n")
        kyber.close()
        self.assertEqual(hud.next_event(2), {"name": "dismissed"})

    def test_missing_socket_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(clay_hud.HudMissing) as caught:
                clay_hud.Hud(path=str(Path(d) / "none.sock")).open()
        self.assertEqual(str(caught.exception), "Kyber isn't running, and this run is meant to be watched.")


if __name__ == "__main__":
    unittest.main()
