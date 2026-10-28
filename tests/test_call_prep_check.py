"""call_prep_check: the Junto scripts from 2026-10-28. The layered version
Caleb called "NOT COMPREHENDABLE" must fail for the reasons it confused the
room, and the plain rewrite with a price marker must pass."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import call_prep_check  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


# Trimmed from the doc as it stood at 1:22pm, before the rewrite.
LAYERED = """Junto: 1:30 to 1:45
The engine pitch (Caleb says these 2 sentences)
"We run all of that for you, with a send gate that throws out bad rows."
If he wants proof, Caleb shares screen and runs the dirty test list.
1. Open
"We didn't want to just pitch you, so we built your first campaign."
4. Show the site
His best result isn't on his homepage. We put it at the top.
Gavin sends a recap email today. Don't name a price, we haven't set one.
"""

# The 1:23pm rewrite, plus the price marker and the channel question it lacked.
PLAIN = """Junto: 1:30 to 1:45
Goal: Reed says yes to a free test this week.
1. Gavin opens
"We didn't want to just pitch you. Can we show you, and you tell us what's wrong?"
2. Gavin says what we do
"For you it's a service. We do the work, you don't install anything."
3. Caleb asks
"What's working for you right now, and what isn't?"
4. Caleb answers the Claude question if it comes up
"Claude can read your data, but it won't decide who to go after."
5. Gavin explains what working with us looks like
Lists only every week, or the full campaign.
[NEED: price range]
"""

# The cheat sheet register that Gavin couldn't read live.
SHORT = PLAIN + "Tell him u can set it up w his login rn\n"


def main() -> int:
    p, _ = call_prep_check.check(LAYERED)
    joined = " | ".join(p)
    check("layered fails", bool(p), p)
    check("layered: send gate is jargon", "send gate" in joined, joined)
    check("layered: dirty test list is jargon", "dirty test list" in joined, joined)
    check("layered: no price", "price" in joined, joined)
    check("layered: no channel question", "channel question" in joined, joined)
    check("layered: no service line", "service" in joined, joined)
    check("layered: steps without a speaker", "who talks" in joined, joined)
    _, w = call_prep_check.check(LAYERED)
    check("layered: site claim warned", any("our site" in x for x in w), w)

    p, w = call_prep_check.check(PLAIN)
    check("plain passes", p == [], p)

    p, _ = call_prep_check.check(SHORT)
    check("shorthand fails", any("shorthand" in x for x in p), p)

    quoted = PLAIN + '"Hi Brian, congrats w the rank"\n'
    p, _ = call_prep_check.check(quoted)
    check("shorthand inside a quote passes", p == [], p)

    raise_only = PLAIN.replace("[NEED: price range]", "If his $1.5M fundraise comes up, offer Holly.")
    p, _ = call_prep_check.check(raise_only)
    check("a fundraise amount is not a price", any("price" in x for x in p), p)

    priced = PLAIN.replace("[NEED: price range]", "The price is $1,500 a month after the pilot.")
    p, _ = call_prep_check.check(priced)
    check("a real monthly price passes", p == [], p)

    told = PLAIN + "Never say MCP or desktop app on the call.\n"
    p, _ = call_prep_check.check(told)
    check("a never line may name jargon", p == [], p)

    # 10/28 Firebox: a 1,000-word section was "wayyy too dense", three
    # founders sat in one doc tab, and a solo call still named Gavin.
    long_doc = PLAIN + ("Background line about the group and its history. " * 60)
    p, _ = call_prep_check.check(long_doc)
    check("over 450 words fails", any("words" in x for x in p), p)

    two = PLAIN + "OPTRA Labs: Friday 10/30, 4:00 to 4:30\n"
    p, _ = call_prep_check.check(two)
    check("two founders in one tab fails", any("own doc tab" in x for x in p), p)

    p, _ = call_prep_check.check(PLAIN, absent=["Gavin"])
    check("absent Gavin still in the steps fails", any("isn't on this call" in x for x in p), p)
    solo = PLAIN.replace("Gavin", "Caleb")
    p, _ = call_prep_check.check(solo, absent=["Gavin"])
    check("solo script w no Gavin passes", p == [], p)
    p, _ = call_prep_check.check(solo + "Gav can't make this one.\n", absent=["Gavin"])
    check("a leftover Gav line fails", any("isn't on this call" in x for x in p), p)

    print(f"{'FAIL' if failed else 'ok'}: {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
