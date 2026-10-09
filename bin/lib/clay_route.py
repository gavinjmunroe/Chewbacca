"""Start clay-build from a sentence, with no model turn.

"find me 50 fintech VC partners in Clay" is a whole instruction: who, how
many, and where. Doing it is one detached `clay-build`, which asks before any
credit is spent, so the voice only has to say "On it."

WHOLE UTTERANCES ONLY, as bin/lib/opener.py. A sentence starts a run only
when it names Clay or work emails: "build me a list of 5 restaurants in
Dallas" is the model's, because a parser that grabbed it would drive
Chewie's Chrome for a request about dinner. A Clay sentence with no number
gets one question back instead of a guessed count.

`parse` reads and never acts: `fast_path` in hud-listen and
tests/voice_cases.py replay logged sentences through it. `perform` acts.
"""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import clay_lock

ROOT = Path(__file__).resolve().parents[2]
CLAY_BUILD = ROOT / "bin" / "clay-build"
# bin/clay-build's own bounds, repeated so a refusal is said rather than
# logged by a process nobody watches.
MAX_COUNT = 500
WHO_MAX = 200


@dataclass(frozen=True)
class Command:
    who: str
    count: int | None


@dataclass(frozen=True)
class Outcome:
    ok: bool
    line: str


UNITS = {w: i for i, w in enumerate(
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen".split(), start=1)}
TENS = {w: 10 * i for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split(), start=2)}


def _norm(said: str) -> str:
    """Punctuation out, case and digits kept: the rest is typed into Clay."""
    s = said.replace("’", "'")
    s = re.sub(r"(?<=\d),(?=\d{3})", "", s)
    s = re.sub(r"[^\w'& ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Lead-ins that carry no instruction: "OK so find me ...".
    s = re.sub(r"^((ok|okay|so|hey|um|uh|now|please|can you|could you)\s+)+", "", s, flags=re.I)
    return re.sub(r"\s+please$", "", s, flags=re.I)


def _count(words: list[str]) -> tuple[int | None, list[str]]:
    """A leading number, as digits or words ("a hundred and fifty"), and what follows."""
    if words and words[0].isdigit():
        return int(words[0]), words[1:]
    value, used = 0, 0
    for i, word in enumerate(words):
        w = word.lower()
        if w == "a" and i + 1 < len(words) and words[i + 1].lower() == "hundred" and used == i:
            continue
        if w in UNITS:
            value += UNITS[w]
        elif w in TENS:
            value += TENS[w]
        elif w == "hundred":
            value = (value or 1) * 100
        elif w == "and" and value:
            pass
        else:
            break
        used = i + 1
    return (value, words[used:]) if value else (None, words)


VERB = r"(?:find|get|pull)(?: me)?"
# "pull up my table in Clay", "get my credits in clay", "find out who is in
# clay": a verb from the shapes and a request about something that exists,
# not people to find. Those go to the model.
NOT_WHO = {"up", "out", "my", "our", "your", "his", "her", "their", "its"}
WHERE = r"(?:in|on|from|with|using) clay"
EMAILS = r"with (?:their )?work emails?"
# "Clay, find 20 seed investors in Austin" and "Clay, build a list of ...".
ADDRESSED = re.compile(rf"^clay (?:{VERB}|build(?: me)?(?: a list of)?) (?P<rest>.+?)(?: {WHERE}| {EMAILS})?$", re.I)
# "find me 50 fintech VC partners in Clay", or with work emails.
ASKED = re.compile(rf"^{VERB} (?P<rest>.+?) (?:{WHERE}|{EMAILS})$", re.I)
# "build a list of fifty fintech VC partners with work emails".
LISTED = re.compile(rf"^build(?: me)? a list of (?P<rest>.+?) (?:{WHERE}|{EMAILS})$", re.I)


def parse(said: str) -> Command | None:
    """The run `said` asks for, or None when it is anything else."""
    s = _norm(said)
    match = ADDRESSED.match(s) or ASKED.match(s) or LISTED.match(s)
    if not match:
        return None
    words = match.group("rest").split()
    # "find me in clay": the optional "me" was the whole rest.
    if words and words[0].lower() == "me":
        words = words[1:]
    if words and words[0].lower() in NOT_WHO:
        return None
    count, rest = _count(words)
    who = " ".join(rest)
    return Command(who, count) if who else None


def _lock_held() -> bool:
    fd, _ = clay_lock.acquire(clay_lock.lock_path())
    if fd is None:
        return True
    os.close(fd)
    return False


def _spawn(argv: list[str]) -> None:
    """Detached, so the run outlives the voice turn, with its output kept."""
    home = Path(os.environ.get("CHEWBACCA_HOME") or Path.home() / ".chewbacca").expanduser()
    (home / "logs").mkdir(parents=True, exist_ok=True)
    with open(home / "logs" / "clay-build.log", "a", encoding="utf-8") as log:
        subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)


def perform(command: Command, spawn=_spawn, lock_held=_lock_held) -> Outcome:
    """Start it and say how that went, in a line short enough to speak."""
    if command.count is None:
        return Outcome(False, "Say it with a number, like: find me 50 fintech VC partners in Clay.")
    if not 1 <= command.count <= MAX_COUNT:
        return Outcome(False, f"A Clay run takes 1 to {MAX_COUNT} people.")
    if len(command.who) > WHO_MAX:
        return Outcome(False, "Say who to find in fewer words.")
    if lock_held():
        return Outcome(False, "Clay is already being driven by another run.")
    try:
        spawn([str(CLAY_BUILD), command.who, "--count", str(command.count)])
    except OSError:
        return Outcome(False, "clay-build didn't start.")
    return Outcome(True, "On it.")
