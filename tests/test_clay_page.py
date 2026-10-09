"""clay_page: every page touch goes through one `chewie web eval` subprocess,
which a Stop kills within a poll, which never carries a URL (a URL opens a new
tab), and whose answers become sentences a person can act on. The subprocess is
faked; nothing here starts Chrome."""
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import clay_geometry  # noqa: E402
import clay_page  # noqa: E402
from clay_recipe import Action  # noqa: E402

FRAME = {"screen_x": 0, "screen_y": 38, "outer_w": 1512, "outer_h": 944,
         "inner_w": 1512, "inner_h": 857, "dpr": 2, "href": "https://app.clay.com/workspaces/1/home"}


class FakeProc:
    def __init__(self, out="", code=0, never=False, err="chewie web: no tab matching app.clay.com"):
        self.out, self.code, self.never, self.err, self.killed = out, code, never, err, False

    def poll(self):
        return None if self.never and not self.killed else self.code

    def communicate(self, timeout=None):
        return self.out, self.err if self.code else ""

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        return self.code


def answer(**body) -> str:
    return json.dumps(body) + "\n"


class PageTests(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("CHEWIE_CDP_PORT", None)
        os.environ.pop("CHEWIE_CHROME_PROFILE", None)

    def page(self, proc, seen=None):
        def spawn(argv, **kw):
            if seen is not None:
                seen.append((argv, kw["env"]))
            return proc
        return clay_page.Page(spawn=spawn, chewie="chewie", poll_s=0.01, kill=lambda proc: proc.kill())

    def test_locate_maps_the_answer(self):
        seen = []
        found = self.page(FakeProc(answer(ok=True, rect={"x": 1, "y": 2, "w": 3, "h": 4},
                                          text="Find leads", frame=FRAME)), seen).locate(
            [{"css": "button", "text": "Find leads"}])
        self.assertEqual(found.rect, clay_geometry.Rect(1, 2, 3, 4))
        self.assertEqual(found.window, clay_geometry.Window.from_page(FRAME))
        self.assertEqual(found.href, FRAME["href"])
        self.assertEqual(found.text, "Find leads")
        argv, env = seen[0]
        self.assertEqual(argv[:3], ["chewie", "web", "eval"])
        self.assertEqual(env["CHEWIE_WEB_FRAME"], "app.clay.com")
        self.assertEqual(len(argv), 4)  # no URL argument, which would open a new tab
        self.assertIn('[{"css": "button", "text": "Find leads"}]', argv[3])
        self.assertIn("function locate(", argv[3])

    def test_missing_is_a_sentence(self):
        out = answer(ok=False, tried=[{"css": "button", "text": "Continue", "result": "missing", "count": 0}])
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc(out)).locate([{"css": "button", "text": "Continue"}])
        self.assertEqual(str(caught.exception), "Couldn't find Continue on the page.")
        self.assertEqual(caught.exception.tried[0]["result"], "missing")

    def test_ambiguous_says_it_did_not_guess(self):
        out = answer(ok=False, tried=[{"css": "button", "text": "Save", "result": "ambiguous", "count": 2}])
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc(out)).locate([{"css": "button", "text": "Save"}])
        self.assertEqual(str(caught.exception), "Found 2 matches for Save, so it stopped instead of guessing.")

    def test_a_regex_target_reads_as_words(self):
        out = answer(ok=False, tried=[{"css": "button", "text": "^Save and run \\d+ rows$",
                                       "result": "missing", "count": 0}])
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc(out)).locate([{"css": "button", "text_re": "^Save and run \\d+ rows$"}])
        self.assertEqual(str(caught.exception), "Couldn't find Save and run N rows on the page.")

    def test_act_sends_only_what_the_page_needs(self):
        seen = []
        action = Action(find=({"css": "textarea"},), do="type", value="fintech VC partners", enter=True,
                        expect={"text_re": "~([\\d,]+) found"}, timeout_s=90, approve="")
        found = self.page(FakeProc(answer(ok=True, rect={"x": 5, "y": 6, "w": 7, "h": 8},
                                          text="", frame=FRAME)), seen).act(action)
        self.assertEqual(found.rect, clay_geometry.Rect(5, 6, 7, 8))
        expr = seen[0][0][3]
        self.assertIn('{"do": "type", "value": "fintech VC partners", "enter": true}', expr)
        self.assertIn("armTakeover();", expr)

    def test_act_that_did_not_take_stops(self):
        action = Action(find=({"css": "input"},), do="check", value="", enter=False,
                        expect={"css": "x"}, timeout_s=5, approve="")
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc(answer(ok=False, reason="did not tick"))).act(action)
        self.assertEqual(str(caught.exception), "The box did not tick, so it stopped.")

    def test_a_hand_on_the_page_before_a_press_pauses_it(self):
        action = Action(find=({"css": "button"},), do="click", value="", enter=False,
                        expect={"css": "x"}, timeout_s=5, approve="")
        with self.assertRaises(clay_page.Paused):
            self.page(FakeProc(answer(ok=False, reason="takeover"))).act(action)

    def test_wait_returns_the_capture(self):
        got = self.page(FakeProc(answer(ok=True, captured="1,204"))).wait(
            {"text_re": "~([\\d,]+) found"}, 90, lambda: False)
        self.assertEqual(got, "1,204")
        self.assertIsNone(self.page(FakeProc(answer(ok=True))).wait({"text": "x"}, 5, lambda: False))

    def test_wait_timeout_is_a_sentence(self):
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc(answer(ok=False, reason="timeout"))).wait({"text": "Work email"}, 20, lambda: False)
        self.assertEqual(str(caught.exception), 'Clay did not show "Work email" within 20 seconds.')

    def test_stop_kills_a_hanging_eval_fast(self):
        proc = FakeProc(never=True)
        started = time.monotonic()
        with self.assertRaises(clay_page.Stopped):
            self.page(proc).wait({"text": "~"}, 90, should_stop=lambda: time.monotonic() - started > 0.05)
        self.assertTrue(proc.killed)
        self.assertLess(time.monotonic() - started, 0.3)

    def test_a_silent_chrome_is_killed_after_its_grace(self):
        proc = FakeProc(never=True)
        with mock.patch.object(clay_page, "GRACE_S", 0.05):
            with self.assertRaises(clay_page.PageError) as caught:
                self.page(proc).wait({"text": "x"}, 0.01, lambda: False)
        self.assertTrue(proc.killed)
        self.assertEqual(str(caught.exception), "Chrome stopped answering.")

    def test_takeover_pauses(self):
        with self.assertRaises(clay_page.Paused):
            self.page(FakeProc(answer(ok=False, reason="takeover"))).wait({"text": "x"}, 5, lambda: False)

    def test_resume_clears_the_flag(self):
        seen = []
        self.page(FakeProc(answer(ok=True)), seen).resume()
        self.assertIn("armTakeover().took = false", seen[0][0][3])

    def test_a_closed_clay_tab_says_so(self):
        err = 'chewie web: no frame url contains "app.clay.com". run: chewie web frames'
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc("", code=1, err=err)).locate([{"css": "button"}])
        self.assertEqual(str(caught.exception),
                         "The Clay tab in Chewie's Chrome is gone. Open app.clay.com there, then press Try again.")

    def test_page_errors_never_reach_the_card_raw(self):
        # web.js reports the page exception's description: Clay's own error
        # text and stack, if its click handler throws inside our eval.
        stack = ("chewie web: TypeError: Cannot read properties of undefined (reading 'rows')\n"
                 "    at HTMLButtonElement.onClick (https://app.clay.com/assets/index-abc.js:1:2345)\n") * 4
        log = io.StringIO()
        with mock.patch("sys.stderr", log), self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc("", code=1, err=stack)).locate([{"css": "button"}])
        self.assertEqual(str(caught.exception), "Chrome could not run that step on the Clay page.")
        self.assertIn("TypeError", log.getvalue())

    def test_a_press_carries_the_table_and_the_words_the_card_showed(self):
        seen = []
        action = Action(find=({"css": "[role=menuitem]", "text_re": "^Run"},), do="click", value="", enter=False,
                        expect={"text": "x"}, timeout_s=5, approve="rest")
        self.page(FakeProc(answer(ok=True, rect={"x": 1, "y": 2, "w": 3, "h": 4}, text="Run 8", frame=FRAME)),
                  seen).act(action, table="t_new1", expect_text="Run 8 empty or out-of-date rows")
        expr = seen[0][0][3]
        self.assertIn('refuse(location.pathname, f.text, {"table": "t_new1", '
                      '"text": "Run 8 empty or out-of-date rows"})', expr)

    def test_a_press_on_another_table_is_refused(self):
        action = Action(find=({"css": "button"},), do="click", value="", enter=False,
                        expect={"text": "x"}, timeout_s=5, approve="rest")
        with self.assertRaises(clay_page.WrongTable):
            self.page(FakeProc(answer(ok=False, reason="wrong table"))).act(action, table="t_new1")
        with self.assertRaises(clay_page.Changed):
            self.page(FakeProc(answer(ok=False, reason="changed"))).act(action, expect_text="Run 8")

    def test_stop_kills_everything_the_eval_started(self):
        # chewie runs node as a child of its bash wrapper (mac/bin/chewie
        # cmd_web), so killing the wrapper alone left node to finish the
        # press after Stop. This wrapper's child presses after one second.
        with tempfile.TemporaryDirectory() as d:
            mark = Path(d) / "pressed"
            fake = Path(d) / "chewie"
            fake.write_text(f'#!/bin/bash\n/bin/sh -c "sleep 1; echo pressed > {mark}"\ntrue\n')
            fake.chmod(0o755)
            page = clay_page.Page(chewie=str(fake), poll_s=0.01)
            started = time.monotonic()
            with self.assertRaises(clay_page.Stopped):
                page.wait({"text": "x"}, 90, lambda: time.monotonic() - started > 0.1)
            self.assertLess(time.monotonic() - started, 0.5)
            time.sleep(1.5)
            self.assertFalse(mark.exists())

    def test_garbage_out_is_an_error_not_a_crash(self):
        with self.assertRaises(clay_page.PageError):
            self.page(FakeProc("undefined\n")).window()

    def test_window_reads_the_frame(self):
        win, href = self.page(FakeProc(answer(**FRAME))).window()
        self.assertEqual(win, clay_geometry.Window.from_page(FRAME))
        self.assertEqual(href, FRAME["href"])

    def test_the_eval_and_the_tab_count_use_one_port(self):
        seen = []
        with mock.patch.dict(os.environ, {"CHEWIE_CDP_PORT": "9400"}):
            self.page(FakeProc(answer(**FRAME)), seen).window()
        self.assertEqual(seen[0][1]["CHEWIE_CDP_PORT"], "9400")
        self.assertEqual(clay_page.cdp_port(), 9333)

    def test_another_profile_without_a_port_refuses(self):
        # web.js hashes a non-Default profile to its own port; guessing 9333
        # would drive whichever account owns that window.
        os.environ["CHEWIE_CHROME_PROFILE"] = "Profile 1"
        with self.assertRaises(clay_page.PageError):
            clay_page.cdp_port()
        os.environ["CHEWIE_CDP_PORT"] = "9512"
        self.assertEqual(clay_page.cdp_port(), 9512)

    def test_clay_targets_counts_pages_only(self):
        body = json.dumps([{"type": "page", "url": "https://app.clay.com/a"},
                           {"type": "iframe", "url": "https://app.clay.com/b"},
                           {"type": "page", "url": "https://example.com/?app.clay.com"},
                           {"type": "page", "url": "https://example.com"}]).encode()
        seen = []

        def fetch(url, timeout):
            seen.append(url)
            return io.BytesIO(body)
        # Counted by chewie's own rule (web.js:223-227): any page or iframe
        # whose url contains the frame string, because that is what the eval
        # can land in. A look-alike counts, so it can never be the one tab.
        got = clay_page.clay_targets(9333, fetch=fetch)
        self.assertEqual([t["url"] for t in got], ["https://app.clay.com/a", "https://app.clay.com/b",
                                                   "https://example.com/?app.clay.com"])
        self.assertEqual(seen, ["http://127.0.0.1:9333/json/list"])

    def test_no_chrome_means_no_tabs(self):
        def fetch(url, timeout):
            raise ConnectionRefusedError()
        self.assertEqual(clay_page.clay_targets(9333, fetch=fetch), [])

    def test_every_eval_refuses_outside_clays_own_page(self):
        seen = []
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc(answer(ok=False, reason="not clay")), seen).locate([{"css": "button"}])
        self.assertIn("not Clay", str(caught.exception))
        self.assertIn('location.hostname !== "app.clay.com" || window.top !== window', seen[0][0][3])


if __name__ == "__main__":
    unittest.main()
