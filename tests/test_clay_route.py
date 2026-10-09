"""clay_route: the sentences that start clay-build with no model, and the near
misses that must still go to the model. Nothing is spawned: clay-build and
the lock are stubbed."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import clay_route  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def main() -> int:
    takes = [
        ("find me 50 fintech VC partners in Clay", "fintech VC partners", 50),
        ("Find me 50 fintech VC partners in Clay.", "fintech VC partners", 50),
        ("Clay, find 20 seed investors in Austin", "seed investors in Austin", 20),
        ("Hey Clay, get me thirty seed investors in Austin", "seed investors in Austin", 30),
        ("find me 20 seed investors in Austin in Clay", "seed investors in Austin", 20),
        ("build a list of fifty fintech VC partners with work emails", "fintech VC partners", 50),
        ("build me a list of a hundred and fifty B2B SaaS founders in clay", "B2B SaaS founders", 150),
        ("find me twenty-five Series-A founders with work emails", "Series A founders", 25),
        ("pull 1,000 CFOs from Clay", "CFOs", 1000),
        ("okay so find me fintech VC partners in clay", "fintech VC partners", None),
        ("Clay, build a list of fintech VC partners", "fintech VC partners", None),
    ]
    for said, who, count in takes:
        got = clay_route.parse(said)
        check(f"{said!r} parses", got == clay_route.Command(who, count), got)

    # Same verbs, and nothing that says Clay or work emails: the model's.
    for said in ("find me a coffee shop", "open clay", "what is clay", "build a website",
                 "find me 5 restaurants in Dallas", "build me a list of 5 restaurants in Dallas",
                 "build a list of groceries", "find my keys", "Clay", "clay find", "find me in clay",
                 "get me 50 in clay", "what does clay cost", "find me 50 people on LinkedIn",
                 "pull up my table in Clay", "get my credits in clay", "Clay, find my last table",
                 "find out who is in clay"):
        got = clay_route.parse(said)
        check(f"{said!r} goes to the model", got is None, got)

    spawned = []

    def spawn(argv):
        spawned.append(argv)

    free = lambda: False  # noqa: E731
    got = clay_route.perform(clay_route.Command("fintech VC partners", 50), spawn=spawn, lock_held=free)
    check("a whole request starts clay-build", spawned == [[str(ROOT / "bin" / "clay-build"),
                                                            "fintech VC partners", "--count", "50"]], spawned)
    check("and says on it", got == clay_route.Outcome(True, "On it."), got)

    spawned.clear()
    got = clay_route.perform(clay_route.Command("fintech VC partners", None), spawn=spawn, lock_held=free)
    check("no count asks one question", got == clay_route.Outcome(
        False, "Say it with a number, like: find me 50 fintech VC partners in Clay."), got)
    got = clay_route.perform(clay_route.Command("CFOs", 1000), spawn=spawn, lock_held=free)
    check("too many says the range", got == clay_route.Outcome(False, "A Clay run takes 1 to 500 people."), got)
    got = clay_route.perform(clay_route.Command("fintech VC partners", 50), spawn=spawn, lock_held=lambda: True)
    check("a held lock refuses", got == clay_route.Outcome(False, "Clay is already being driven by another run."), got)
    check("and none of those spawned", spawned == [], spawned)

    def broken(argv):
        raise OSError("no such file")

    got = clay_route.perform(clay_route.Command("fintech VC partners", 50), spawn=broken, lock_held=free)
    check("a spawn failure says so", got == clay_route.Outcome(False, "clay-build didn't start."), got)

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
