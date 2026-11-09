"""The scorer must not count table header rows as misses (2026-10-03).
Run: python3 tests/test_score.py"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
from score import score

TABLE = """| axis | theirs | ours | delta |
|---|---|---|---|
| section height | 928px | 928px | ok |
| heading lines | 2 | 3 | **+1** |
| heading align | left | left | ok |
"""

def test_header_is_not_an_axis():
    assert score(TABLE) == (2, 3)

if __name__ == "__main__":
    test_header_is_not_an_axis(); print("ok test_header_is_not_an_axis")
