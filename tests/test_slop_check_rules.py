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
