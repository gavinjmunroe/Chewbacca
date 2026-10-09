"""The copy check must catch a brand swap and a trimmed sentence.

Both shipped on 2026-10-03 and the exact-match check passed them.
Run: python3 tests/test_check_copy.py
"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
from check_copy import lifted

THEIRS = {
    "Lemma triages issues and alerts you in Slack.",
    "After deploying the fix, Lemma creates an online eval. If a regression occurs, you'll know immediately.",
}

def test_brand_swap_is_caught():
    assert lifted(THEIRS, {"a.js": 'body: "Sift triages issues and alerts you in Slack."'})

def test_trimmed_sentence_is_caught():
    src = {"a.js": "After deploying the fix, Sift creates an online eval. If a regression occurs, you'll know."}
    assert lifted(THEIRS, src)

def test_own_words_pass():
    src = {"a.js": "Sift posts the issue to the channel your team already watches."}
    assert not lifted(THEIRS, src)

if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
