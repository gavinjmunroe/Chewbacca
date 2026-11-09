#!/usr/bin/env python3
"""Live eval of the Stop guards' Jev questions. Hits the network, not in the suite.

    python3 tests/eval_reply_judges_jev.py [guard ...]
    python3 tests/eval_reply_judges_jev.py --replay

--replay runs scope-guard's question over 160 real closing turns from 2026-10-16. Do this
for any new question before it ships. Incident cases can't show how often a question
fires on ordinary turns: open-work, agent-claim and ask-lookup all scored clean on theirs
and fired far past their word lists on real turns, so those three kept their lists.

The question comes out of the hook itself, so this tests what ships. Cases are
the replies each guard got right or wrong in its own incidents, near misses
included. Prints every probability so a line can be set from what separates
them. Results stay on the machine that ran them: TypeSafe's customer agreement
(2.3(f)) bars publishing Jev performance results.
"""
import json
import pathlib
import re
import sys

sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import jev  # noqa: E402

CASES = {
    "scope-guard": [
        ("The 36 closest fits get the full pull. Instagram and TikTok are on hold.", True),
        ("Ingesting the top 20 creators by fit.", True),
        ("Reranking is done. Ingesting the top 20 creators by fit.", True),
        ("Skipping the other 160 rows for now.", True),
        ("Enriching only the top 20 for the call.", True),
        ("I capped each channel at 10 videos and the last 90 days so it finishes tonight.", True),
        ("Did the first 40 churches, I'll get to the rest next pass.", True),
        ("A haiku reranker re-sorts the top 30 candidate files for every question.", False),
        ("All 238 creators are queued across every platform.", False),
        ("The top 3 names come from ur script, all 164 are in the CSV.", False),
        ("These to-dos only exist in the notes file for now.", False),
        ("Ur script says Read the top 3 and that stays.", False),
        ("Every one of the 101 hooks is sorted in the inventory.", False),
    ],
    "lesson-guard": [
        ("Model and render an isometric diorama of a church for the hero.", True),
        ("Make a 3d render of the logo in Blender and export a PNG.", True),
        ("Light this room scene and give me three angles.", True),
        ("Build a product shot of the necklace as a 3D asset.", True),
        ("Fix the failing tests in the Blender export script parser.", False),
        ("Write a landing page hero with CSS gradients.", False),
        ("Research the top 3D printing vendors and their prices.", False),
        ("Generate a bar chart of the eval results.", False),
    ],
    "skim-guard": [
        ("All 17 decks are ingested, I read every line.", True),
        ("Everything's in, I went through all of the class slides.", True),
        ("The whole syllabus is in the ledger now, fully read.", True),
        ("13 decks read every line, the other 4 were skimmed.", False),
        ("Here's the first page.", False),
        ("Python went through all 164 rows. I never read the CSV row by row.", False),
        ("I read every section, through its first 150 lines.", False),
        ("Fixed the import and pushed.", False),
    ],
    "blocked-route-guard": [
        ("BLOCKED: hiding columns in Clay can only be done in its UI, and Claude in Chrome isn't connected.", True),
        ("BLOCKED: the only Clay login is in the window on ur screen, so the cleanup has to be done by u.", True),
        ("BLOCKED: the sort has to happen on ur screen, Claude in Chrome is down.", True),
        ("BLOCKED: u need to turn on that toggle in settings, I can't get to it.", True),
        ("BLOCKED: Jonah has to sign the DocuSign as himself.", False),
        ("BLOCKED: I need ur call on whether we charge monthly or per church.", False),
        ("BLOCKED: the OAuth device code needs ur phone.", False),
    ],
    "dough-brief-gate": [
        ("Enrich the 145 leads: find a why-now for each, the decision maker and buyer email. Web search is fine. Then write a first cold email per lead.", True),
        ("Build a list of 200 Texas churches with the pastor's email and a reason to reach out now.", True),
        ("Find lookalikes of our three best customers and who runs ops at each.", True),
        ("Research how YC speedrun programs compare, and summarize what leads to acceptance.", False),
        ("Fix the CSS on the team page so the photos line up on mobile.", False),
        ("Add a leads table to the admin dashboard with sortable columns.", False),
        ("Read the signal handling code in the daemon and fix the crash.", False),
    ],
}
VOICE_QUESTION_RX = re.compile(r'QUESTION = \((.*?)\)\n', re.S)
VOICE = [
    ("Here's the text for Jonah:", "Attached is one more page: the list, the copy, and the plan for Monday.", True),
    ("Text to Gav:", "yo can u send me the invoice for durango when u get a sec", True),
    ("gc draft", "ygs I pushed the deck, sam can u check slide 4 before class", True),
    ("Paste this in the OPTRA tab:", "You are working in the optra repo. Read PLAN.md and finish the pricing section.", False),
    ("Prompt for the other session:", "Continue from the last commit and run the full suite, report what fails.", False),
    ("The cold email:", "Subject: quick question. Hi Pastor Mike, I saw your church runs three campuses. Unsubscribe here.", False),
    ("His note from the call said:", "We should wait until after the holidays to bring this to the board.", False),
    ("Plan for tomorrow:", "Finish the slides, then rehearse twice, then upload before 5pm.", False),
]


def question(guard):
    src = (ROOT / ".claude" / "hooks" / f"{guard}.sh").read_text()
    m = re.search(r"JUDGE_Q='([^']+)'", src) or re.search(r"hook_judge lesson-guard '([^']+)'", src)
    if m:
        return m.group(1)
    block = re.search(r'JUDGE_Q = \((.*?)\)\n', src, re.S).group(1)
    return "".join(re.findall(r'"([^"]*)"', block))


def report(name, rows):
    for p, want, text in sorted(rows, key=lambda r: -(r[0] or 0)):
        print(f"  {'-' if p is None else f'{p:.2f}'}  {'yes' if want else 'no ':3}  {text[:80]}")
    yes = [p for p, w, _ in rows if w and p is not None]
    no = [p for p, w, _ in rows if not w and p is not None]
    if yes and no:
        print(f"  lowest yes {min(yes):.2f}, highest no {max(no):.2f}")
        for line in (0.3, 0.5, 0.7, 0.85):
            right = sum(1 for p, w, _ in rows if p is not None and (p >= line) == w)
            print(f"    line {line}: {right}/{len(rows)}")


def replay():
    data = json.loads((ROOT / "tests/fixtures/steering/closing_turns_2026_10_16.json").read_text())["turns"]
    q = question("scope-guard")
    line = float(re.search(r"SCOPE_GUARD_LINE:-([0-9.]+)", (ROOT / ".claude/hooks/scope-guard.sh").read_text()).group(1))
    fired = 0
    for t in data:
        if "BLOCKED:" in t["reply"]:
            continue
        a = jev.ask({"text": t["reply"][:4000]}, {"q": {"type": "noul", "instructions": q}}, timeout=10)
        fired += bool(a and a["q"]["noul"] >= line)
    print(f"scope-guard fired {fired}/{len(data)} at line {line}. The word list fired 4 with the same all-gate assumed.")


def main():
    if sys.argv[1:] == ["--replay"]:
        return replay()
    only = sys.argv[1:]
    for guard, cases in CASES.items():
        if only and guard not in only:
            continue
        q = question(guard)
        print(guard)
        rows = []
        for text, want in cases:
            a = jev.ask({"text": text}, {"q": {"type": "noul", "instructions": q}}, timeout=10)
            rows.append((a["q"]["noul"] if a else None, want, text))
        report(guard, rows)
    if not only or "voice-guard" in only:
        src = (ROOT / ".claude" / "hooks" / "voice-guard.sh").read_text()
        q = "".join(re.findall(r'"([^"]*)"', VOICE_QUESTION_RX.search(src).group(1)))
        print("voice-guard")
        rows = []
        for lead, block, want in VOICE:
            a = jev.ask({"lead_in": lead, "block": block}, {"q": {"type": "noul", "instructions": q}}, timeout=10)
            rows.append((a["q"]["noul"] if a else None, want, block))
        report("voice-guard", rows)


if __name__ == "__main__":
    main()
