"""call-practice's scoring, without a microphone, a model or a voice."""
import sys
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
loader = SourceFileLoader("call_practice", str(ROOT / "bin" / "call-practice"))
practice = module_from_spec(spec_from_loader(loader.name, loader))
loader.exec_module(practice)


def test_marks_come_off_before_scoring():
    assert practice.unmark("ASK: Why / NOW, and not six months ago?") == "Why now, and not six months ago?"


def test_saying_the_spine_of_the_cue_counts_and_ad_libbing_does_not():
    cue = "HANDLE: No problem. / What PART do you want to think through?"
    assert practice.overlap(cue, "no problem, so what part do you want to think through") >= practice.ON_SCRIPT
    assert practice.overlap(cue, "totally, take your time and call me tomorrow") < practice.ON_SCRIPT


def test_the_prospect_never_learns_the_price_from_the_notes():
    notes = "## The offer\n- Northline 90: 12 weeks, $3,000 paid in full.\n## Price and terms\n- $3,000.\n"
    summary = practice.offer_summary(notes)
    assert "3,000" not in summary and "12 weeks" in summary


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except AssertionError as err:
                failed += 1
                print(f"  FAIL {name} {err}")
    sys.exit(1 if failed else 0)
