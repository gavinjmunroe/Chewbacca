#!/usr/bin/env python3
"""The held-out cases: stable, never shown, scored, and able to fail a fix.

Hermetic: cases, proposals and declines in a temp learn directory, found
through CHEWBACCA_LEARN_DIR the way the real run finds ~/.chewbacca/learn,
and the judge reads its change from a file, never this checkout's git diff.
Sentences are chosen by searching for ones the split puts on each side,
because the split hashes the sentence and a test that let it fall where it
may would pass or fail by chance. Each refusal is checked with a control
that differs only in the thing refused, so the exit code is what is tested.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="holdout-test-"))
os.environ["CHEWBACCA_LEARN_DIR"] = str(TMP / "learn")
os.environ.pop("CHEWBACCA_HOLDOUT_EVERY", None)
os.environ.pop("CHEWBACCA_PENDING_DECLINES", None)
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import learnloop as L  # noqa: E402

ENV = dict(os.environ, SUPERASSISTANT_DIR=str(TMP / "voice"), BOB_DIR=str(TMP / "bob"),
           CHEWBACCA_TRANSCRIPTS=str(TMP / "projects"))
NO_CHANGE = TMP / "no-change.diff"
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


def sentences(template: str, held: bool, n: int, start: int = 0) -> list[str]:
    """`n` sentences from `template` that the split puts on the given side."""
    out, i = [], start
    while len(out) < n:
        said = template.format(i)
        if L.held_out({"said": said}) == held:
            out.append(said)
        i += 1
    return out


def case(said, shape="x", at="2026-09-28T10:00:00-05:00"):
    cid = L.episode_id(said, shape)
    return {"id": cid, "shape": shape, "said": said, "seconds": 6.0, "answer": "",
            "at": at, "origin": f"test:{cid}"}


def write_cases(rows):
    L.write_jsonl(L.CASES / "voice.jsonl", rows)


def judge(*args, change=NO_CHANGE):
    r = subprocess.run([sys.executable, "tests/voice_cases.py", *args, "--change", str(change)],
                       capture_output=True, text=True, cwd=str(ROOT), env=ENV)
    counts = next((json.loads(line[6:]) for line in r.stdout.splitlines()
                   if line.startswith("JUDGE ")), None)
    return r.returncode, r.stdout, counts


def main() -> int:
    for d in ("voice", "bob", "projects"):
        (TMP / d).mkdir()
    NO_CHANGE.write_text("")

    # The split itself. "Play ..." reaches the music path; drafting never
    # reaches a fast path, the same pair test_reflect relies on.
    sample = [f"open the thing called {i}" for i in range(3000)]
    share = sum(L.held_out({"said": s}) for s in sample) / len(sample)
    check("about one sentence in three is held out", 0.29 < share < 0.38, share)
    # Pinned, so a split that changed between runs (Python's salted hash(),
    # a new key format) fails here instead of reshuffling what was shown.
    pinned = [L.held_out({"said": f"open the thing called {i}"}) for i in range(12)]
    check("the split is the same on every run",
          pinned == [True, False, True, True, False, False, True, False, False, False, False, True],
          pinned)
    check("a repeat of a sentence lands on the same side, whatever its punctuation",
          all(L.held_out({"said": s}) == L.held_out({"said": s.upper() + "!"}) for s in sample[:40]))
    h = sentences("open the thing called {}", True, 1)[0]
    check("a sentence already shown is never held out", not L.held_out({"said": h}, {L.said_key(h)}))
    r = subprocess.run([sys.executable, "-c", "import learnloop as L; print(L.held_out({'said': %r}))" % h],
                       capture_output=True, text=True,
                       env=dict(ENV, CHEWBACCA_HOLDOUT_EVERY="0", PYTHONPATH=str(ROOT / "bin" / "lib")))
    check("CHEWBACCA_HOLDOUT_EVERY=0 turns it off", r.stdout.strip() == "False", r.stdout + r.stderr)

    # What a proposer may see.
    vis = [case(s) for s in sentences("Play track {}", False, 2)]
    hid = [case(s) for s in sentences("Play track {}", True, 2)]
    groups = [{"shape": "x", "count": 4, "median_s": 6.0, "cost_s": 24.0, "cases": vis + hid},
              {"shape": "y", "count": 1, "median_s": 6.0, "cost_s": 6.0, "cases": [hid[0]]}]
    view = L.visible(groups)
    check("visible keeps only the cases a proposer may see",
          view[0]["cases"] == vis and view[0]["held"] == 2, view)
    check("a shape with nothing visible is dropped", [g["shape"] for g in view] == ["x"], view)

    # Exposure: recorded, mapped from ids, or reconstructed for the proposal
    # from before either existed.
    early = case("open the early sentence", shape="open", at="2026-09-27T01:00:00-05:00")
    late = case("open the late sentence", shape="open", at="2026-09-28T09:00:00-05:00")
    other = case("open by recorded id", shape="z")
    L.write_jsonl(L.PROPOSALS / "legacy.json", [{"id": "legacy", "shapes": ["open"], "at": 1790497488.5}])
    L.write_jsonl(L.PROPOSALS / "ids.json", [{"id": "ids", "shapes": ["z"], "shown": [other["id"]]}])
    L.write_jsonl(L.PROPOSALS / "said.json", [{"id": "said", "shapes": ["q"], "shown_said": ["some words"]}])
    seen = L.exposed([early, late, other])
    check("a legacy proposal exposed the cases of its shapes said before it ran",
          "open the early sentence" in seen and "open the late sentence" not in seen, seen)
    check("a `shown` id list is mapped to its sentences", "open by recorded id" in seen, seen)
    check("a `shown_said` list is exposure as written", "some words" in seen, seen)
    for p in L.PROPOSALS.glob("*.json"):
        p.unlink()

    # Quoting.
    held_c = case("Open up a new Chrome window please")
    check("a quoted sentence is found through punctuation and case",
          L.quoted([held_c], '("open up a new chrome window, please", "chrome"),') == [held_c])
    check("a sentence under five words is too common to count",
          L.quoted([case("open google sheets")], "open google sheets") == [])
    inner = case("open a new terminal window")
    outer = case("can you open a new terminal window please")
    check("a held sentence inside a shown one is the shown one being copied",
          L.quoted([inner], "(\"can you open a new terminal window please\", 'x')", [outer]) == [])

    # Pending declines are read with the kept ones, and never written to them.
    pend = TMP / "pending.jsonl"
    L.write_jsonl(L.DECLINED, [{"case": "kept1", "why": "k"}])
    L.write_jsonl(pend, [{"case": "pend1", "why": "p"}])
    r = subprocess.run([sys.executable, "-c", "import learnloop as L; print(sorted(L.declined_cases()))"],
                       capture_output=True, text=True,
                       env=dict(ENV, CHEWBACCA_PENDING_DECLINES=str(pend), PYTHONPATH=str(ROOT / "bin" / "lib")))
    check("a candidate's pending declines count while it is judged",
          r.stdout.strip() == "['kept1', 'pend1']", r.stdout + r.stderr)
    check("and are not in the kept file", "pend1" not in L.DECLINED.read_text())
    L.DECLINED.unlink()

    plays = [case(s) for s in sentences("Play track {}", False, 3, start=100)]
    held_plays = [case(s) for s in sentences("Play track {}", True, 2, start=100)]
    held_drafts = [case(s) for s in sentences("Write a caption for the clip we shot on day {}", True, 2)]

    # Memorising is printed for the person reading the branch, never a refusal.
    write_cases(plays[:2] + held_drafts)
    code, out, counts = judge("--shapes", "x")
    check("passing every shown case and no held-out one is flagged MEMORISED",
          "MEMORISED x" in out and counts["memorised"] == ["x"], out)
    check("but does not fail: the held ones may belong to the model", code == 0, out)
    check("the JUDGE line carries both halves",
          counts["train"] == [2, 2] and counts["held"] == [0, 2], counts)
    check("a held-out miss is printed by id, never by sentence",
          held_drafts[0]["id"] in out and "caption" not in out, out)

    write_cases(plays[:2] + [held_plays[0], held_drafts[0]])
    code, out, counts = judge("--shapes", "x")
    check("a fix that reaches some held-out cases passes and says how many",
          code == 0 and counts["held"] == [1, 2], (code, counts))

    # A declined sentence the parser grabs anyway: only the decline differs.
    write_cases(plays[:2])
    code, _, _ = judge("--shapes", "x")
    check("control: two shown plays pass", code == 0)
    L.write_jsonl(L.DECLINED, [{"case": plays[1]["id"], "why": "should stay with the model"}])
    code, out, counts = judge("--shapes", "x")
    check("declining one and still reaching it fails", code == 1 and counts["grabbed"] == 1, out)

    # A declined shape: another shape keeps something to judge, so only the
    # grab can fail it.
    y = case("Play track for the y shape", shape="y")
    write_cases([case(plays[0]["said"], shape="x"), y])
    L.write_jsonl(L.DECLINED, [{"shape": "x", "why": "outbound"}])
    code, out, counts = judge("--shapes", "x,y")
    check("reaching a sentence of a declined shape fails", code == 1 and "GRABBED" in out, out)
    write_cases([case(c["said"], shape="x") for c in held_drafts] + [y])
    code, out, counts = judge("--shapes", "x,y")
    check("control: a declined shape nothing reaches passes", code == 0, out)
    check("and its held cases stay in the held count, so declining lifts no share",
          counts["held"] == [0, 2], counts)
    L.DECLINED.unlink()

    # A held-out sentence quoted in the change: only the change differs.
    write_cases(plays[:2] + [held_drafts[0]])
    quoting = TMP / "quoting.diff"
    quoting.write_text(f'+    ("{held_drafts[0]["said"]}", None),\n')
    code, out, counts = judge("--shapes", "x", change=quoting)
    check("a change quoting a held-out sentence fails", code == 1 and counts["quoted"] == [held_drafts[0]["id"]],
          out)
    shown_only = TMP / "shown.diff"
    shown_only.write_text(f'+    ("{plays[0]["said"]}", "music"),\n')
    code, out, _ = judge("--shapes", "x", change=shown_only)
    check("control: quoting only shown sentences passes", code == 0, out)

    # The proposer is never shown a held-out sentence.
    write_cases(plays[:2] + [held_drafts[1]])
    r = subprocess.run([sys.executable, "bin/propose", "--dry-run", "--shapes", "x"],
                       capture_output=True, text=True, cwd=str(ROOT), env=ENV)
    check("propose shows the visible cases", plays[0]["said"] in r.stdout, r.stdout[-400:] + r.stderr[-400:])
    check("and never a held-out one", "caption" not in r.stdout)
    check("and does not announce that any were held", "held" not in r.stdout.lower())

    loader = SourceFileLoader("propose", str(ROOT / "bin" / "propose"))
    propose = importlib.util.module_from_spec(importlib.util.spec_from_loader("propose", loader))
    loader.exec_module(propose)
    shown_groups = L.visible(L.select("voice", 3, ["x"]), set())
    view_dir, env = propose.session_view(shown_groups)
    in_view = [c["said"] for c in L.read_jsonl(view_dir / "cases" / "voice.jsonl")]
    check("the session's learn directory holds only the shown cases",
          sorted(in_view) == sorted(c["said"] for c in plays[:2]), in_view)
    check("and its judge splits nothing further, with the raw logs pointed away",
          env["CHEWBACCA_HOLDOUT_EVERY"] == "0" and env["CHEWBACCA_LEARN_DIR"] == str(view_dir)
          and not any(any(Path(env[k]).iterdir()) for k in ("SUPERASSISTANT_DIR", "BOB_DIR", "CHEWBACCA_TRANSCRIPTS")),
          env.get("CHEWBACCA_LEARN_DIR"))

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
