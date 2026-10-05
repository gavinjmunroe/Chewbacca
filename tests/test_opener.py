"""opener: the sentences that open a new Terminal window, a new Chrome window
or Google Sheets with no model, and the near misses that must still go to
the model. The action is stubbed: nothing opens on the screen."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import opener  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def main() -> int:
    # Real sentences from the voice log to 2026-09-27, then close variants.
    takes = [
        ("Open up Google sheets", "tab", opener.SHEETS_HOME),
        ("Open up a Google Chrome window on my monitor screen", "chrome", ""),
        ("Open a chrome window on my laptop screen", "chrome", ""),
        ("Open up a new Google Chrome window and pull up sheets", "chrome", opener.SHEETS_HOME),
        ("Open up a new chrome window to get a Google sheet going", "chrome", opener.SHEETS_NEW),
        ("Open a new terminal window", "terminal", ""),
        ("Open a new terminal war", "terminal", ""),
        ("Open a new terminal", "terminal", ""),
        ("open a new terminal window.", "terminal", ""),
        ("Can you open a new Chrome window please", "chrome", ""),
        ("pull up google sheets", "tab", opener.SHEETS_HOME),
        ("Open a terminal window", "terminal", ""),
    ]
    for said, kind, url in takes:
        got = opener.parse(said)
        check(f"takes {said!r}", got is not None and got.kind == kind and got.url == url, got)

    screen = opener.parse("Open a chrome window on my laptop screen")
    check("a named screen is noted so the answer can own up to it", screen and screen.screen, screen)

    refuses = [
        # A second half this cannot do.
        "OK now open Google sheets and label it Valencia",
        # A task: which repo, and work on it.
        "Open up the Gavin Jay Monroe get hub Rea. We need to do some work on it.",
        # A Claude window needs a folder the words do not name.
        "Open new Claude window",
        "Open up terminal start, Claude",
        # A bubble is a draft for the terminal and depends on what is pending.
        "Open a bubble",
        "Open up a bubble",
        # Bare "open terminal" most likely means the one already open.
        "Open terminal",
        "open a new terminal and run the tests",
        "open a new chrome window and search for flights to Valencia",
        "open my google sheet from yesterday",
        "don't open a new terminal",
        "why did you open a new terminal",
        "open sheets and make a budget",
        "",
    ]
    for said in refuses:
        got = opener.parse(said)
        check(f"refuses {said!r}", got is None, got)

    # perform, with the runner stubbed.
    calls = []

    def ok_run(argv):
        calls.append(argv)
        return True

    out = opener.perform(opener.Command("terminal"), run=ok_run)
    check("terminal says it is open", out.ok and out.line == "Terminal's open.", out)
    check("terminal goes through AppleScript, never open -n",
          calls[-1][0] == "osascript" and "-n" not in calls[-1] and "do script" in calls[-1][2], calls[-1])
    out = opener.perform(opener.Command("chrome", opener.SHEETS_NEW), run=ok_run)
    check("a new window gets the url", out.ok and calls[-1][-1] == opener.SHEETS_NEW, calls[-1])
    out = opener.perform(opener.Command("chrome", screen=True), run=ok_run)
    check("a screen it cannot pick is said, not claimed", "screen" in out.line, out)
    out = opener.perform(opener.Command("tab", opener.SHEETS_HOME), run=ok_run)
    check("sheets opens as a tab in Chrome", calls[-1][:3] == ["open", "-a", "Google Chrome"], calls[-1])
    out = opener.perform(opener.Command("terminal"), run=lambda argv: False)
    check("a failure is reported as one", not out.ok and "didn't" in out.line, out)

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
