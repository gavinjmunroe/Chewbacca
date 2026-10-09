"""clay_run: the build, end to end, against fakes for the page, Clay, Kyber and
the clock. What these pin is the part that costs money: no paid click without
an approval for that card, never the same paid click twice, and a stop, an `x`
or a hand on the page halting the run at once."""
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import clay_recipe  # noqa: E402
import clay_run  # noqa: E402
from clay_geometry import Display, Rect, Window  # noqa: E402
from clay_page import Found, PageError, Paused, Stopped  # noqa: E402
from clay_reads import AutoRunUnknown, Progress, Tally  # noqa: E402

RETINA = Display(1512, 982, 2.0)
WIN = Window(0, 38, 1512, 944, 1512, 857, 2.0)
DOCKED = Window(0, 38, 1512, 944, 1512, 500, 2.0)
HOME = "https://app.clay.com/workspaces/1372623/home"
TABLE = "https://app.clay.com/workspaces/1372623/workbooks/wb_1/tables/t_new1"
TEST_BUTTON = "^Save and run \\d+ rows$"
REST_ITEM = "^Run \\d+ empty or out-of-date rows"
TEXTS = {TEST_BUTTON: "Save and run 10 rows", REST_ITEM: "Run 8 empty or out-of-date rows"}


class World:
    def __init__(self, auto=(False,)):
        self.balance = 1000.0
        self.auto = list(auto)
        self.rest_ran = False


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def label(alts):
    first = alts[0]
    return first.get("text") or first.get("text_re") or first["css"]


class FakePage:
    def __init__(self, world, found=551, win=WIN, href=HOME, missing=None, pause_act=None, pause_wait=None):
        self.world, self.found, self.win, self.href = world, found, win, href
        self.missing = dict(missing or {})
        self.pause_act = dict(pause_act or {})
        self.pause_wait = dict(pause_wait or {})
        self.acted, self.located, self.waited = [], [], []
        self.resumed = 0

    def _found(self, name):
        return Found(Rect(100, 200, 80, 30), self.win, self.href, TEXTS.get(name, name))

    def window(self, should_stop=None):
        return self.win, self.href

    def locate(self, alts, should_stop=None):
        name = label(alts)
        self.located.append(name)
        if self.missing.get(name):
            self.missing[name] -= 1
            raise PageError(f"Couldn't find {name} on the page.")
        return self._found(name)

    def act(self, action, should_stop=None):
        name = label(action.find)
        if self.pause_act.get(name):
            self.pause_act[name] -= 1
            raise Paused()
        self.acted.append((name, action.do, action.value, action.approve))
        if action.approve == "test":
            self.world.balance -= 6.0
            self.href = TABLE
        if action.approve == "rest":
            self.world.balance -= 24.0
            self.world.rest_ran = True
        return self._found(name)

    def wait(self, expect, timeout_s, should_stop):
        if should_stop():
            raise Stopped()
        key = next(iter(expect.values()))
        self.waited.append(key)
        if self.pause_wait.get(key):
            self.pause_wait[key] -= 1
            raise Paused()
        return {"~([\\d,]+) found": f"{self.found:,}",
                "(Save and run \\d+ rows)": "Save and run 10 rows",
                "(Run \\d+ empty or out-of-date rows[^\\n]{0,40})": "Run 8 empty or out-of-date rows (4.8 credits)",
                }.get(key)

    def resume(self, should_stop=None):
        self.resumed += 1


class FakeReads:
    def __init__(self, world):
        self.world = world

    def credits(self, ws):
        assert ws == "1372623", ws
        return self.world.balance

    def auto_run(self, table):
        value = self.world.auto.pop(0) if len(self.world.auto) > 1 else self.world.auto[0]
        if value is None:
            raise AutoRunUnknown("Clay did not say whether table auto-run is on.")
        return value

    def email_field(self, table):
        assert table == "t_new1", table
        return "f_email"

    def progress(self, ws, table, field):
        return Progress(rows=10, done=10, running=0, queued=0, errors=0)

    def emails(self, ws, table, field):
        if self.world.rest_ran:
            return Tally(rows=10, ran=10, found=9, missing_names=("Person 9",))
        return Tally(rows=10, ran=2, found=2, missing_names=())


class FakeHud:
    """Each scripted event is released, in order, once its trigger sees the
    lines it waits for."""

    def __init__(self, script=()):
        self.script = list(script)
        self.sent, self.after_dismiss = [], []
        self.dismissed = False
        self.released_at = []

    def send(self, lines):
        (self.after_dismiss if self.dismissed else self.sent).extend(lines)

    def next_event(self, timeout_s):
        if self.script and self.script[0][0](self.sent):
            event = self.script.pop(0)[1]
            self.released_at.append(len(self.sent))
            if event["name"] == "dismissed":
                self.dismissed = True
            return event
        return None


class FakeBoard:
    def __init__(self):
        self.notes = []

    def note(self, text):
        self.notes.append(text)


def card(title):
    def seen(sent):
        return any(a.startswith("@ clay-card") and b == f'c s Screen title="{title}"' for a, b in zip(sent, sent[1:]))
    return seen


def note(title):
    def seen(sent):
        return any(a.startswith("@ clay-note") and b == f'c s Screen title="{title}"' for a, b in zip(sent, sent[1:]))
    return seen


def press(name):
    return {"name": name, "component": "go", "surface": "clay-card"}


class RunTests(unittest.TestCase):
    def run_build(self, script=(), count=10, dry_run=False, world=None, **page_kw):
        world = world or World()
        page = FakePage(world, **page_kw)
        hud = FakeHud(script)
        board = FakeBoard()
        clock = FakeClock()
        run = clay_run.Run("fintech VC partners", count, dry_run, clay_recipe.load(), page, FakeReads(world),
                           hud, board, RETINA, clock=clock, sleep=clock.sleep, tick_s=0, env={})
        outcome = run.go()
        return outcome, page, hud, board, world

    def paid(self, page):
        return [a for a in page.acted if a[3]]

    def test_dry_run_stops_at_the_first_card_and_presses_nothing_paid(self):
        outcome, page, hud, _, world = self.run_build([(card("TEST RUN"), press("clay-close"))], dry_run=True)
        self.assertEqual(outcome, clay_run.Outcome("dry-run", "Stopped at the first approval card. Nothing spent.", 0.0))
        self.assertEqual(self.paid(page), [])
        self.assertFalse(any("clay-approve" in line for line in hud.sent))
        self.assertEqual(world.balance, 1000.0)
        self.assertIn("Dry run. Nothing was pressed.", "\n".join(hud.sent))

    def test_decline_at_the_test_card_spends_nothing(self):
        outcome, page, _, _, world = self.run_build([(card("TEST RUN"), press("clay-decline"))])
        self.assertEqual(outcome, clay_run.Outcome("declined", "Not now. Nothing spent.", 0.0))
        self.assertEqual(self.paid(page), [])
        self.assertEqual(world.balance, 1000.0)

    def test_no_answer_at_a_card_is_a_no(self):
        outcome, page, _, _, _ = self.run_build([])
        self.assertEqual(outcome.state, "declined")
        self.assertEqual(self.paid(page), [])

    def test_a_full_run_presses_each_paid_control_once(self):
        outcome, page, hud, board, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (card("THE REST"), press("clay-approve")),
            (card("DONE"), press("clay-close")),
        ])
        self.assertEqual([a[3] for a in self.paid(page)], ["test", "rest"])
        self.assertEqual(outcome, clay_run.Outcome("done", "9 of 10 have work emails. Spent 30 credits.", 30.0))
        sent = "\n".join(hud.sent)
        self.assertIn('c r0 Text value="Save and run 10 rows"', sent)
        self.assertIn('c r0 Text value="Run 8 empty or out-of-date rows (4.8 credits)"', sent)
        self.assertIn('Text value="Test found 2 of 2 for 6 cr"', sent)
        self.assertIn('Text value="Balance now 994 cr"', sent)
        self.assertEqual(board.notes[:2], ["step 0 of 6: CHECK", "step 1 of 6: FIND PEOPLE"])
        self.assertEqual(len(board.notes), 7)
        typed = [a for a in page.acted if a[1] == "type"]
        self.assertEqual([a[2] for a in typed], ["fintech VC partners", "10"])

    def test_misses_are_shown_on_request(self):
        _, _, hud, _, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (card("THE REST"), press("clay-approve")),
            (card("DONE"), press("clay-misses")),
            (lambda sent: any("c list List" in line for line in sent), press("clay-close")),
        ])
        self.assertIn('c list List items=["Person 9"]', hud.sent)

    def test_a_short_count_asks_and_types_what_was_found(self):
        outcome, page, _, _, _ = self.run_build([
            (card("FEWER FOUND"), press("clay-approve")),
            (card("TEST RUN"), press("clay-decline")),
        ], count=50, found=30)
        self.assertIn(("input[type=number]", "type", "30", ""), page.acted)
        self.assertEqual(outcome.state, "declined")

    def test_a_short_count_declined_saves_nothing(self):
        outcome, page, _, _, _ = self.run_build([(card("FEWER FOUND"), press("clay-decline"))], count=50, found=30)
        self.assertEqual(outcome, clay_run.Outcome("declined", "Ended. Nothing was saved.", 0.0))
        self.assertNotIn("Continue", [a[0] for a in page.acted])

    def test_stop_mid_wait_halts_and_draws_nothing_more(self):
        world = World()
        page_ref = {}

        def typed(sent):
            return any(a[1] == "type" for a in page_ref["page"].acted)
        hud = FakeHud([(typed, {"name": "stop", "component": "run"})])
        page = FakePage(world)
        page_ref["page"] = page
        clock = FakeClock()
        outcome = clay_run.Run("fintech VC partners", 10, False, clay_recipe.load(), page, FakeReads(world),
                               hud, FakeBoard(), RETINA, clock=clock, sleep=clock.sleep, tick_s=0, env={}).go()
        self.assertEqual(outcome, clay_run.Outcome("stopped", "Stopped. Nothing spent.", 0.0))
        self.assertEqual(hud.sent[hud.released_at[0]:], [])
        self.assertNotIn("Continue", page.located)

    def test_x_means_nothing_is_ever_drawn_again(self):
        world = World()
        page = FakePage(world)
        hud = FakeHud([(lambda sent: any(a[1] == "type" for a in page.acted), {"name": "dismissed"})])
        clock = FakeClock()
        outcome = clay_run.Run("fintech VC partners", 10, False, clay_recipe.load(), page, FakeReads(world),
                               hud, FakeBoard(), RETINA, clock=clock, sleep=clock.sleep, tick_s=0, env={}).go()
        self.assertEqual(outcome.state, "stopped")
        self.assertEqual(hud.after_dismiss, [])

    def test_stop_after_the_test_reports_the_spend(self):
        outcome, page, _, _, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (lambda sent: any('title="READ THE TEST"' in line for line in sent), press("clay-stop")),
        ])
        self.assertEqual(outcome, clay_run.Outcome("stopped", "Stopped. Spent 6 credits.", 6.0))

    def test_a_hand_on_the_page_pauses_and_resume_finds_the_control_again(self):
        outcome, page, hud, _, _ = self.run_build([
            (note("PAUSED"), press("clay-resume")),
            (card("TEST RUN"), press("clay-decline")),
        ], pause_act={"textarea": 1})
        self.assertEqual(page.resumed, 1)
        self.assertEqual(page.located.count("textarea"), 2)
        self.assertEqual(len([a for a in page.acted if a[0] == "textarea"]), 1)
        self.assertIn('c body Text value="You have the page."', hud.sent)
        self.assertEqual(outcome.state, "declined")

    def test_a_pause_after_a_paid_click_never_presses_it_again(self):
        outcome, page, _, _, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (card("THE REST"), press("clay-approve")),
            (note("PAUSED"), press("clay-resume")),
            (card("DONE"), press("clay-close")),
        ], pause_wait={"Find work email": 1})
        self.assertEqual([a[3] for a in self.paid(page)], ["test", "rest"])
        self.assertEqual(page.waited.count("Find work email"), 2)
        self.assertEqual(outcome.state, "done")

    def test_a_hand_on_the_page_at_an_approved_press_asks_again(self):
        # act() refuses before pressing, so nothing was sent; the card comes back.
        outcome, page, hud, _, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (note("PAUSED"), press("clay-resume")),
            (lambda sent: sum(line == 'c s Screen title="TEST RUN"' for line in sent) >= 3, press("clay-decline")),
        ], pause_act={TEST_BUTTON: 1})
        self.assertEqual(self.paid(page), [])
        self.assertEqual(outcome.state, "declined")

    def test_a_missing_control_on_a_free_step_can_be_retried(self):
        outcome, page, hud, _, _ = self.run_build([
            (note("STOPPED AT 2/6"), press("clay-retry")),
            (card("TEST RUN"), press("clay-decline")),
        ], missing={"Continue": 1})
        sent = "\n".join(hud.sent)
        self.assertIn('c retry Button label="Try again" action=clay-retry variant=primary', sent)
        self.assertIn("m clay-target", sent)
        self.assertIn(("Continue", "click", "", ""), page.acted)
        self.assertEqual(outcome.state, "declined")

    def test_a_missing_paid_control_cannot_be_retried(self):
        outcome, page, hud, _, _ = self.run_build([(note("STOPPED AT 3/6"), press("clay-end"))],
                                                  missing={TEST_BUTTON: 1})
        self.assertFalse(any("clay-retry" in line for line in hud.sent))
        self.assertEqual(outcome, clay_run.Outcome("failed", "Couldn't find ^Save and run \\d+ rows$ on the page.", 0.0))
        self.assertEqual(self.paid(page), [])

    def test_auto_run_on_holds_the_rest_until_it_reads_off(self):
        world = World(auto=(True, False))
        outcome, page, hud, _, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (note("PAUSED"), press("clay-resume")),
            (card("THE REST"), press("clay-decline")),
        ], world=world)
        paused_at = hud.sent.index('c s Screen title="PAUSED"')
        self.assertIn("auto-run is on", hud.sent[paused_at + 2])
        rest_first = next(i for i, line in enumerate(hud.sent) if line == 'c s Screen title="THE REST"')
        self.assertLess(paused_at, rest_first)
        self.assertEqual([a[3] for a in self.paid(page)], ["test"])
        self.assertEqual(outcome, clay_run.Outcome("declined", "Stopped after the test. Spent 6 credits.", 6.0))

    def test_auto_run_still_on_after_resume_pauses_again(self):
        world = World(auto=(True, True, False))
        outcome, page, hud, _, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (note("PAUSED"), press("clay-resume")),
            (lambda sent: sum(line == 'c s Screen title="PAUSED"' for line in sent) >= 2, press("clay-end")),
        ], world=world)
        self.assertEqual([a[3] for a in self.paid(page)], ["test"])
        self.assertEqual(outcome.state, "stopped")

    def test_auto_run_unknown_waits_for_the_persons_word(self):
        world = World(auto=(None,))
        outcome, page, hud, _, _ = self.run_build([
            (card("TEST RUN"), press("clay-approve")),
            (note("PAUSED"), press("clay-resume")),
            (card("THE REST"), press("clay-decline")),
        ], world=world)
        self.assertTrue(any("did not say whether table auto-run is off" in line for line in hud.sent))
        self.assertEqual(outcome.state, "declined")

    def test_a_bad_window_stops_before_anything_is_touched(self):
        outcome, page, hud, _, _ = self.run_build([(note("STOPPED AT 0/6"), press("clay-end"))], win=DOCKED)
        self.assertIn("DevTools", outcome.line)
        self.assertEqual(outcome.state, "failed")
        self.assertEqual(page.acted, [])

    def test_a_window_moved_mid_run_stops_too(self):
        world = World()
        page = FakePage(world)
        real_locate = page.locate

        def locate(alts, should_stop=None):
            found = real_locate(alts, should_stop)
            return Found(found.rect, DOCKED, found.href, found.text) if label(alts) == "Continue" else found
        page.locate = locate
        hud = FakeHud([(note("STOPPED AT 2/6"), press("clay-end"))])
        clock = FakeClock()
        outcome = clay_run.Run("fintech VC partners", 10, False, clay_recipe.load(), page, FakeReads(world),
                               hud, FakeBoard(), RETINA, clock=clock, sleep=clock.sleep, tick_s=0, env={}).go()
        self.assertIn("DevTools", outcome.line)
        self.assertNotIn("Continue", [a[0] for a in page.acted])

    def test_no_workspace_in_the_url_is_never_guessed(self):
        outcome, page, _, _, _ = self.run_build([(note("STOPPED AT 0/6"), press("clay-end"))],
                                                href="https://app.clay.com/home")
        self.assertEqual(outcome.state, "failed")
        self.assertIn("workspace", outcome.line)
        self.assertEqual(page.acted, [])

    def test_signed_out_says_so(self):
        outcome, _, _, _, _ = self.run_build([(note("STOPPED AT 0/6"), press("clay-end"))],
                                             href="https://app.clay.com/login")
        self.assertEqual(outcome.line, "Sign in to Clay in this window, then press Try again.")


if __name__ == "__main__":
    unittest.main()
