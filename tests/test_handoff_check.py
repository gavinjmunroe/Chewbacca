#!/usr/bin/env python3
"""handoff-check: refuse a reply that hands the user something to run.

do-it-yourself.md is ALWAYS ON and Caleb still had to say it twice in one
night. A rule that does not fire is not a rule, so these cases are the rule
turned into something that executes.

The false-positive cases matter more than the true positives. A guard that
fires on correct replies gets switched off, and then it protects nothing.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load():
    loader = importlib.machinery.SourceFileLoader(
        "handoff", str(ROOT / "bin/handoff-check"))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


MUST_FIRE = [
    "All set. Just run `cd ~/project && ./install.sh` to finish.",
    "You'll need to brew install jq first.",
    "Rebuild to see it:\n\n```bash\ncd ~/kit && ./install.sh\n```",
    "You should run the suite before merging.",
    "Try running it again with --force.",
    "Open a terminal and paste this in.",
    "Make sure you run the migration after pulling.",
    "Don't forget to set ANTHROPIC_API_KEY.",
    "Now run the tests and tell me what happens.",
    "You'll have to grant Accessibility yourself.",
    # 2026-10-09: a guessed price handed over as a lookup, and it was wrong.
    "Text's queued. Check the $500 edu price on apple.com before u send it.",
    "Check the current price before quoting it to him.",
    # 2026-10-11, the repeats ranked in docs/plans/REPEAT-MISTAKES.md. Each is
    # the reply he answered with "do it urself" or "don't ask".
    # feedback_dont_report_what_you_can_fix:
    "#11, adding her to the workspace, still needs you to send the invite.",
    "There's one thing left and it's on you Monday morning: the writes.",
    "Here's what's open:\n- Click after \"...still relevant today.\", hit Enter, then Cmd+V\n- Fix Miyaki to Miyake",
    "Say \"done\" when u're finished and I'll check again.",
    "u'll need to approve it in Settings.",
    # feedback_never_hand_him_a_command:
    "I opened a fresh window. Sign into Slack there and leave it open until it closes by itself.",
    # feedback_no_confirmation_prompts:
    "Both lists are verified. Want me to start running Wave 2 now?",
    "The build is mid-upload. It's harmless, but say the word and I'll kill it.",
    "Shall I merge the six branches?",
    "Should I go ahead and push it?",
    "Lmk if you want me to retry.",
]

MUST_NOT_FIRE = [
    # Naming a decision only the user can make is required, not a handoff.
    # Refused twice on 2026-10-06 and the same answer reached Caleb three times.
    "The one call you'll have to make is when someone replies interested.",
    # 2026-10-10: payment is a credential only he holds; refused once, sent twice.
    "Tell me the slot and I'll fill the cart. You'll have to put the card in yourself, I can't enter payment.",
    "You'll have to type the 2FA code from your phone.",
    # Reporting what was actually done. The honest, correct shape.
    "I ran the suite: 278 passed, 0 failed.",
    "I pushed to main. I ran `swift build` first and it was clean.",
    "I installed it and linked it:\n\n```\nhud-voice -> ~/.local/bin\n```",
    # Showing a command as evidence, in past tense.
    "I ran this:\n\n```bash\ngit commit -- bin/portal\n```\n\nand it worked.",
    # A genuine blocker, named the sanctioned way.
    "BLOCKED: Portal.app needs Accessibility. That is a click only you can make.",
    "BLOCKED: the 2FA prompt is on your phone.",
    # Explaining what a command does, not instructing.
    "The `--json` flag makes evals.py write a row per case.",
    "`fitness --run` costs model calls, which is why it had never been run.",
    # Ordinary prose with the word run in it.
    "The loop has never run once.",
    "That test run took sixteen seconds.",
    # The agent checking before a send is the right shape.
    "I checked the price on apple.com before queueing the draft.",
    "The send gate checks the thread before you send anything.",
    # A drafted text he will send is his words, not a handoff to him.
    'Text for Maggie: "can u add me as admin on the GCP project? It needs you to click accept"',
    # A message going out under his name waits for his send; asking is right.
    "Draft #41 is queued. Want me to send it?",
    "Say send and all 5 go out.",
    # A 2FA push or a QR code is a credential only he holds.
    "Sign in with Duo on your phone whenever you can.",
    # A gate that needs his approval by design is not work handed back.
    "Those need you to sign off on the gate before they start.",
    # A factual question is not a permission ask.
    "Which inbox should get business leads?",
]


def test_fires_on_every_handoff():
    h = load()
    for msg in MUST_FIRE:
        assert h.check(msg), f"MISSED a handoff: {msg[:60]!r}"


def test_never_fires_on_an_honest_report():
    h = load()
    for msg in MUST_NOT_FIRE:
        hits = h.check(msg)
        assert not hits, f"FALSE POSITIVE on {msg[:60]!r}: {hits}"


def test_blocked_is_an_escape():
    """BLOCKED: is the sanctioned way to name a real blocker, so a reply that
    uses it must pass even when it also contains an instruction."""
    h = load()
    msg = "BLOCKED: only you can approve this.\nThen run `./install.sh`."
    assert not h.check(msg)


def test_an_explicit_request_is_an_escape():
    """He asked for a runnable prompt for a parallel tab on the same night the
    rule was being broken. Handing one over was correct."""
    h = load()
    msg = "Here you go:\n\n```\ncd ~/kit && claude\n```\n\nJust run that."
    assert h.check(msg), "sanity: this is a handoff with no request"
    assert not h.check(msg, user_text="give me a prompt to go ham there")
    assert not h.check(msg, user_text="what's the command?")


def test_empty_and_none_are_safe():
    h = load()
    assert h.check("") == []
    assert h.check(None) == []


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  pass  {name}")
            except AssertionError as exc:
                print(f"  FAIL  {name}: {exc}")
                fails += 1
    print(f"\n{'FAILED' if fails else 'ok'}  {fails} failure(s)")
    sys.exit(1 if fails else 0)
