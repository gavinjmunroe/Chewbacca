"""The Clay build, one recipe step at a time.

The recipe says what to press, the page presses it, Clay's own reads say what
it cost, and Kyber shows all of it. What this file guarantees:

- A step that spends is never pressed without a `clay-approve` for that card,
  pressed after the card appeared. Presses queued earlier are dropped.
- A paid press is never sent twice. Once it may have gone out, every retry,
  resume and failure path only waits and reads.
- Stop, `x`, Kyber going away, or the person's hand on the page halt the run
  at once. After `x` nothing is drawn.
- Nothing runs while table auto-run is on, and an unknown reading is never
  taken as off.
"""
from __future__ import annotations

import dataclasses
import os
import re
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import clay_hud
from clay_geometry import problem, to_screen
from clay_page import PageError, Paused, Stopped
from clay_reads import AutoRunUnknown, ReadError, ids_from_href
from clay_recipe import fill

# The 300 ms glide in docs/CLAY-HUD.md: the pointer reaches the control before
# it is pressed, so the person sees what is about to happen. Guessed, never
# measured on the glass.
GLIDE_S = 0.3

# How often progress is read while rows run. Guessed, never measured: one rows
# read took 1.7 s on 2026-10-09 (library/clay-api/measured.json).
POLL_S = 3.0

# How long rows may run before the run stops and says so. Both guessed: the
# 2026-10-05 live run filled 10 test rows within a minute, and nobody has
# timed 500.
TEST_SETTLE_S = 120.0
REST_SETTLE_S = 600.0

DRY_CLOSE_S = 60.0
SIGNED_OUT = ("/login", "/signin", "/sign-in", "/signup", "/sign-up")
STOPS = {"stop", "dismissed", "clay-stop", "clay-end"}

# What each paid card says. The rows above the buttons come from Clay.
CARDS = {
    "test": ("Run the test", "Spends credits on these rows. It cannot be undone.",
             "Nothing is spent, and the table stays."),
    "rest": ("Run the rest", "Spends credits on every row left. It cannot be undone.",
             "Nothing more is spent, and the table stays."),
}


@dataclass(frozen=True)
class Outcome:
    state: str
    line: str
    spent: float | None


class _Halt(Exception):
    def __init__(self, outcome: Outcome):
        super().__init__(outcome.line)
        self.outcome = outcome


def _credits(amount: float) -> str:
    return f"{round(amount, 2):g}"


def _number(text) -> int | None:
    digits = re.sub(r"\D", "", text or "")
    return int(digits) if digits else None


class Run:
    def __init__(self, sentence: str, count: int, dry_run: bool, steps, page, reads, hud, board, display,
                 clock=time.monotonic, sleep=time.sleep, approve_wait_s: float = 300, close_wait_s: float = 1800,
                 tick_s: float = 1.0, env=None):
        self.steps, self.page, self.reads, self.hud, self.board = steps, page, reads, hud, board
        self.display, self.clock, self.sleep = display, clock, sleep
        self.dry_run = dry_run
        self.count = count
        self.values = {"sentence": sentence, "count": count}
        self.approve_wait_s, self.close_wait_s, self.tick_s = approve_wait_s, close_wait_s, tick_s
        self.env = os.environ if env is None else env
        self.total = len(steps) - 1
        self.ws = self.table = self.field = None
        self.before = self.after_test = None
        self.tally_test = None
        self.last_target = None
        self.paid = False
        self.stopping = False
        self.started = 0.0

    # ── the glass ────────────────────────────────────────────────────────────
    def _send(self, lines: list[str]) -> None:
        if not self.hud.dismissed:
            self.hud.send(lines)

    def _elapsed(self) -> float:
        return self.clock() - self.started

    def _fill(self, text: str) -> str:
        return fill(text, self.values)

    def _acting(self, n, step, target) -> None:
        self._send(clay_hud.acting(step.title, n, self.total, self._fill(step.note), step.holds, target,
                                   self._elapsed()))

    def _hold(self) -> str:
        return "No more credits are spent while this waits." if self.paid else "Nothing spent."

    def _ticker(self, done: threading.Event) -> None:
        while not done.wait(self.tick_s):
            if not self.stopping:
                self._send(clay_hud.tick(self._elapsed()))

    # ── events ───────────────────────────────────────────────────────────────
    def _should_stop(self) -> bool:
        """Drains what is queued. A stop sticks; any other press here belongs
        to a card that is gone, and is dropped so it can never answer a later one."""
        while not self.stopping:
            event = self.hud.next_event(0)
            if event is None:
                break
            if event["name"] in STOPS:
                self.stopping = True
        return self.stopping

    def _drain(self) -> None:
        if self._should_stop():
            raise Stopped()

    def _await(self, wanted: set[str], timeout_s: float) -> str | None:
        deadline = self.clock() + timeout_s
        while True:
            remaining = deadline - self.clock()
            if remaining <= 0:
                return None
            event = self.hud.next_event(remaining)
            if event is None:
                return None
            if event["name"] in wanted:
                return event["name"]
            if event["name"] in STOPS:
                self.stopping = True
                raise Stopped()

    def _rest(self, seconds: float) -> None:
        end = self.clock() + seconds
        while self.clock() < end:
            self._drain()
            self.sleep(min(0.1, end - self.clock()))

    # ── money ────────────────────────────────────────────────────────────────
    def _spent(self) -> float | None:
        if not self.paid:
            return 0.0
        try:
            return self.before - self.reads.credits(self.ws)
        except ReadError:
            return None

    def _spend_line(self, spent: float | None) -> str:
        if not self.paid:
            return "Nothing spent."
        if spent is None:
            return "Check Clay's usage page for what was spent."
        return f"Spent {_credits(spent)} credits."

    # ── states that wait on the person ───────────────────────────────────────
    def _pause(self, n: int, target, body: str = "You have the page.") -> None:
        self._send(clay_hud.paused(n, self.total, self._elapsed(), target, body=body, hold=self._hold()))
        if self._await({"clay-resume", "clay-end"}, self.close_wait_s) != "clay-resume":
            spent = self._spent()
            raise _Halt(Outcome("stopped", f"Ended. {self._spend_line(spent)}", spent))
        self.page.resume(self._should_stop)

    def _fail(self, n: int, sentence: str, target, can_retry: bool) -> None:
        """Returns only when the person presses Try again."""
        self._send(clay_hud.failed(n, self.total, sentence, target, can_retry, self._elapsed(), hold=self._hold()))
        wanted = {"clay-end", "clay-show"} | ({"clay-retry"} if can_retry else set())
        while True:
            got = self._await(wanted, self.close_wait_s)
            if got == "clay-show" and target:
                self._send(clay_hud.show_where(target))
                continue
            if got == "clay-retry":
                self.page.resume(self._should_stop)
                return
            raise _Halt(Outcome("failed", sentence, self._spent()))

    # ── one action ───────────────────────────────────────────────────────────
    def _screen(self, found):
        trouble = problem(found.window, self.display)
        if trouble:
            raise PageError(trouble)
        return to_screen(found.rect, found.window, self.display)

    def _do(self, n: int, step, action) -> str | None:
        """A free action: find it, point at it, press it, wait for what follows."""
        action = dataclasses.replace(action, value=self._fill(action.value))
        target = None
        while True:
            try:
                self._drain()
                found = self.page.locate(action.find, self._should_stop)
                target = self.last_target = self._screen(found)
                self._acting(n, step, target)
                self._rest(GLIDE_S)
                self.page.act(action, self._should_stop)
                return self.page.wait(action.expect, action.timeout_s, self._should_stop)
            except Paused:
                self._pause(n, target)
            except (PageError, ReadError) as err:
                self._fail(n, str(err), target, can_retry=step.cost == "free")

    def _approve(self, n: int, step, action, captured: str | None) -> Outcome | None:
        """The paid action: a card with Clay's own numbers, then one press."""
        go_label, go_hint, no_hint = CARDS[action.approve]
        while True:
            target = None
            try:
                self._drain()
                found = self.page.locate(action.find, self._should_stop)
                target = self._screen(found)
                rows = [captured or found.text, f"Balance now {_credits(self.reads.credits(self.ws))} cr"]
            except (PageError, ReadError) as err:
                self._fail(n, str(err), target, can_retry=False)
                continue
            if action.approve == "rest" and self.tally_test:
                rows.append(f"Test found {self.tally_test.found} of {self.tally_test.ran} for "
                            f"{_credits(self.before - self.after_test)} cr")
            self._drain()  # a press that landed during the credits read is not an answer to this card
            if self.dry_run:
                self._send(clay_hud.approve(step.title, rows, go_label, go_hint, no_hint, target,
                                            self._elapsed(), n, self.total, dry_run=True))
                try:
                    self._await({"clay-close"}, DRY_CLOSE_S)
                except Stopped:
                    pass
                return Outcome("dry-run", "Stopped at the first approval card. Nothing spent.", 0.0)
            self._send(clay_hud.approve(step.title, rows, go_label, go_hint, no_hint, target,
                                        self._elapsed(), n, self.total))
            if self._await({"clay-approve", "clay-decline"}, self.approve_wait_s) != "clay-approve":
                spent = self._spent()
                line = "Not now." if action.approve == "test" else "Stopped after the test."
                return Outcome("declined", f"{line} {self._spend_line(spent)}", spent)
            # Approving hands the page back: a scroll while reading the card is
            # not a takeover.
            self.page.resume(self._should_stop)
            was_paid, self.paid = self.paid, True
            try:
                self.page.act(action, self._should_stop)
            except Paused:
                # act() refuses before pressing, so nothing went out. Ask again.
                self.paid = was_paid
                self._pause(n, target)
                continue
            except PageError as err:
                self._fail(n, str(err), target, can_retry=False)
            self._acting(n, step, target)
            self._after_paid(n, action, target)
            return None

    def _after_paid(self, n: int, action, target) -> None:
        """Wait for what the paid press should bring. Never presses again."""
        while True:
            try:
                self.page.wait(action.expect, action.timeout_s, self._should_stop)
                return
            except Paused:
                self._pause(n, target)
            except PageError as err:
                self._fail(n, str(err), target, can_retry=False)

    def _settle(self, n: int, step, limit_s: float):
        deadline = self.clock() + limit_s
        while True:
            progress = self.reads.progress(self.ws, self.table, self.field)
            self._send(clay_hud.strip("acting", n, self.total, f"{progress.done}/{progress.rows} rows",
                                      self._elapsed()))
            if progress.settled:
                return progress
            if self.clock() > deadline:
                raise ReadError(f"Rows were still running after {limit_s:g} seconds.")
            self._rest(POLL_S)

    # ── the steps, by recipe id ──────────────────────────────────────────────
    def _step_check(self, n: int, step) -> None:
        while True:
            try:
                self._acting(n, step, None)
                win, href = self.page.window(self._should_stop)
                trouble = problem(win, self.display)
                if trouble:
                    raise PageError(trouble)
                if urlparse(href).path.startswith(SIGNED_OUT):
                    raise PageError("Sign in to Clay in this window, then press Try again.")
                # Never a default: reads against the wrong workspace would put
                # someone else's balance on the card.
                self.ws = ids_from_href(href)[0] or self.env.get("CLAY_WORKSPACE_ID")
                if not self.ws:
                    raise PageError("Open your Clay workspace in this window, then press Try again.")
                self.before = self.reads.credits(self.ws)
                return
            except (PageError, ReadError) as err:
                self._fail(n, str(err), None, can_retry=True)

    def _step_find(self, n: int, step) -> Outcome | None:
        captured = None
        for action in step.actions:
            captured = self._do(n, step, action)
        found = _number(captured)
        if found is None or found >= self.count:
            return None
        if found == 0:
            self._fail(n, "Clay found nobody matching that. Nothing was saved.", self.last_target, can_retry=False)
        self._drain()
        self._send(clay_hud.ask_short(found, self.count, self.last_target, n, self.total, self._elapsed()))
        if self._await({"clay-approve", "clay-decline"}, self.approve_wait_s) != "clay-approve":
            return Outcome("declined", "Ended. Nothing was saved.", 0.0)
        self.page.resume(self._should_stop)
        self.count = self.values["count"] = found
        return None

    def _step_count(self, n: int, step) -> None:
        for action in step.actions:
            self._do(n, step, action)

    def _paid_step(self, n: int, step) -> Outcome | None:
        captured = None
        for action in step.actions:
            if action.approve:
                return self._approve(n, step, action, captured)
            captured = self._do(n, step, action)
        return None

    def _step_test(self, n: int, step) -> Outcome | None:
        return self._paid_step(n, step)

    def _auto_run_off(self, n: int) -> None:
        while True:
            try:
                if not self.reads.auto_run(self.table):
                    return
                known = True
                body = "Table auto-run is on. Turn it off in Clay's table settings, then press Resume."
            except AutoRunUnknown:
                known = False
                body = ("Clay did not say whether table auto-run is off. "
                        "Turn it off in the table settings, then press Resume.")
            self._pause(n, None, body=body)
            if not known:
                return  # the person's word is the only reading there is

    def _step_read(self, n: int, step) -> None:
        while True:
            try:
                self._acting(n, step, None)
                _, href = self.page.window(self._should_stop)
                self.table = ids_from_href(href)[1]
                if not self.table:
                    raise PageError("Clay did not open the new table.")
                self._auto_run_off(n)
                self.field = self.reads.email_field(self.table)
                self._settle(n, step, TEST_SETTLE_S)
                self.tally_test = self.reads.emails(self.ws, self.table, self.field)
                self.after_test = self.reads.credits(self.ws)
                return
            except (PageError, ReadError) as err:
                self._fail(n, str(err), None, can_retry=True)

    def _step_rest(self, n: int, step) -> Outcome | None:
        outcome = self._paid_step(n, step)
        if outcome:
            return outcome
        while True:
            try:
                self._settle(n, step, REST_SETTLE_S)
                return None
            except ReadError as err:
                self._fail(n, str(err), None, can_retry=True)

    def _step_done(self, n: int, step) -> Outcome:
        while True:
            try:
                self._acting(n, step, None)
                end = self.reads.credits(self.ws)
                tally = self.reads.emails(self.ws, self.table, self.field)
                try:
                    auto = self.reads.auto_run(self.table)
                except AutoRunUnknown:
                    auto = None
                break
            except ReadError as err:
                self._fail(n, str(err), None, can_retry=True)
        spent = self.before - end
        show = False
        while True:
            self._send(clay_hud.done(tally.rows, tally.found, tally.missing_names, spent, auto, self._elapsed(),
                                     show_misses=show, total=self.total))
            try:
                got = self._await({"clay-misses", "clay-close"}, self.close_wait_s)
            except Stopped:
                got = None
            if got == "clay-misses":
                show = True
                continue
            return Outcome("done", f"{tally.found} of {tally.rows} have work emails. "
                                   f"Spent {_credits(spent)} credits.", spent)

    def go(self) -> Outcome:
        self.started = self.clock()
        done = threading.Event()
        if self.tick_s:
            threading.Thread(target=self._ticker, args=(done,), daemon=True).start()
        try:
            for n, step in enumerate(self.steps):
                self.board.note(f"step {n} of {self.total}: {step.title}")
                outcome = getattr(self, f"_step_{step.id}")(n, step)
                if outcome:
                    return outcome
            raise RuntimeError("the recipe ended without a done step")
        except Stopped:
            spent = self._spent()
            return Outcome("stopped", f"Stopped. {self._spend_line(spent)}", spent)
        except _Halt as halt:
            return halt.outcome
        finally:
            done.set()
