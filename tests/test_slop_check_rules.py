"""The two rules Caleb named on 2026-10-06, pinned so they cannot go quiet.

"Not this, not that" and "phrase comma phrase" both shipped onto the Amber
fridge draft with slop-check installed and green, because neither shape was a
rule yet. Each case below is either a line he flagged or the nearest ordinary
sentence that must stay clean.
"""

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SLOP = ROOT / "bin" / "slop-check"


def rules_fired(text, chat=False):
    args = ["python3", str(SLOP), "--stdin", "--json"] + (["--chat"] if chat else [])
    out = subprocess.run(args, input=text, capture_output=True, text=True).stdout
    data = json.loads(out)
    files = data if isinstance(data, list) else [data]
    return {f["rule"] for entry in files for f in entry.get("findings", [])}


@pytest.mark.parametrize(
    "text",
    [
        "Not a CRM. Not a Rolodex. Not a Notion doc.",
        "No web view, no TUI, just the bar.",
        "Never a pitch, never a pipeline.",
    ],
)
def test_negation_stack_fires(text):
    assert "negation-stack" in rules_fired(text)


@pytest.mark.parametrize(
    "text",
    [
        "It never worked and nobody fixed it.",
        "Not every hook fires on the first try.",
    ],
)
def test_negation_stack_quiet(text):
    assert "negation-stack" not in rules_fired(text)


@pytest.mark.parametrize(
    "text",
    [
        "Small moments, big impact.",
        "Three numbers, one concept.",
        "big sur 23, all 5 of us",
        "Dad, Dr. Reyes",
    ],
)
def test_comma_splice_fires(text):
    assert "comma-splice-fragment" in rules_fired(text)


@pytest.mark.parametrize(
    "text",
    [
        "The pot goes on the stove, and the kettle sits by it.",
        "Wang et al., 2024.",
        "In the hud group, after the terminal line:",
        "If it fails, read the log.",
        "Fixed, it was a stale match.",
    ],
)
def test_comma_splice_quiet(text):
    assert "comma-splice-fragment" not in rules_fired(text)


# The Mash Up paper, 2026-10-11. My Miyake half scored clean (6) while Andy, a
# teammate, read it as "the slop version" on sight. These are the tells he saw
# that no rule caught, measured against his own hand-written section.
def fired(text, *flags):
    args = ["python3", str(SLOP), "--stdin", "--json", *flags]
    data = json.loads(subprocess.run(args, input=text, capture_output=True, text=True).stdout)
    files = data if isinstance(data, list) else [data]
    return {f["rule"] for entry in files for f in entry.get("findings", [])}


@pytest.mark.parametrize(
    "text",
    [
        "It was technical, but it was also democratic.",
        "It proves his folding can shape light, not just clothing.",
        "Not only did he design clothes but he designed lamps.",
    ],
)
def test_not_just_contrast_fires_in_chat_and_essays(text):
    assert "not-just-contrast" in fired(text, "--chat")
    assert "not-just-contrast" in fired(text, "--essay")
    assert "not-just-contrast" not in fired(text)


def test_not_just_contrast_leaves_plain_sentences_alone():
    assert "not-just-contrast" not in fired("He studied graphic design because fashion was not offered.", "--essay")


PAIRED = (
    "Both designers worked with rhythm. Both of them used flat shapes. "
    'Douglas painted "rings of color" (NGA). Miyake made "a laboratory" (MDS). '
    'He said "for the many" (MDS) and "making things" (BoF) and "beauty and joy" (NYT). '
    'The dress is "a paper lantern" (PMA) with "rolling discs" (Met) and "second skin" (Met). '
    "Both men chose hope. Both reached ordinary people. "
) * 10
NARRATIVE = (
    "Aaron Douglas was born on May 26th, 1899 in Topeka Kansas, far away from his eventual "
    "residence in Harlem. He worked in a glass factory and a steel foundry to pay for college, "
    "and he kept painting at night because his mother had. In his cover for God's Trombones, "
    "Johnson compares a preacher's voice to a trombone, and Douglas draws the sound as light "
    "breaking over the congregation (Johnson). "
) * 10


def test_essay_density_tells_fire_on_paired_quote_quilt():
    rules = fired(PAIRED, "--essay")
    assert "both-symmetry" in rules
    assert "quote-confetti" in rules


def test_essay_density_tells_stay_quiet_on_narrative_and_without_flag():
    assert not {"both-symmetry", "quote-confetti"} & fired(NARRATIVE, "--essay")
    assert not {"both-symmetry", "quote-confetti"} & fired(PAIRED)


# 2026-10-21: a drafted text inside an unlabeled fence went out unscored, and
# both contrasts in it scored 0 anyway. "Not this, phrase, phrase".
@pytest.mark.parametrize(
    "text",
    [
        "And it doesn't just give me answers, it gives me a problem.",
        "For basic studying the model barely matters. They're all good enough. It's HOW u use it",
    ],
)
def test_doesnt_just_and_barely_matters_fire(text):
    assert "not-just-contrast" in rules_fired(text, chat=True)


def test_chat_scores_unlabeled_fence_but_not_code():
    draft = "Here:\n```\nIt doesn't just quiz me, it teaches me.\n```\n"
    assert "not-just-contrast" in rules_fired(draft, chat=True)
    code = "Here:\n```python\nx = 'doesn\\'t just, it'\n```\n"
    assert "not-just-contrast" not in rules_fired(code, chat=True)


def test_plain_studying_line_stays_clean():
    assert "not-just-contrast" not in rules_fired(
        "For basic studying any of them work fine. I care way more abt how it's set up", chat=True
    )


@pytest.mark.parametrize(
    "text",
    [
        'Say "send 123" for Mark.',
        "Text is draft #134 to Dad.",
        "The warm texts, #127 to #131, are ready.",
        "#125 Ovunda and #119 Gavin are waiting.",
    ],
)
def test_draft_number_fires_in_chat(text):
    assert "draft-number" in rules_fired(text, chat=True)


@pytest.mark.parametrize(
    "text",
    [
        "Fixed in PR #123 Monday.",
        "Send Mark's draft when you're ready.",
        "Section 123 of the agreement.",
        "We send 5 emails a day.",
    ],
)
def test_draft_number_quiet_in_chat(text):
    assert "draft-number" not in rules_fired(text, chat=True)


def test_draft_number_quiet_in_files():
    assert "draft-number" not in rules_fired('Run "send 123" from the queue.')
