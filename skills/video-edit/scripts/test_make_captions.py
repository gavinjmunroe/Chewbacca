"""Run with Python 3. Exercises the caption CLI without media dependencies."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def check():
    script = Path(__file__).with_name("make_captions.py")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        audio, cuts, output, expected = [root / name for name in
                                         ("audio.json", "cuts.json", "out.ass", "expected.txt")]
        audio.write_text(json.dumps({"segments": [{"words": [
            {"word": "discard", "start": 9, "end": 9.5},
            {"word": "Alexx", "start": 10.2, "end": 10.5},
            {"word": "builds.", "start": 10.6, "end": 10.9},
            {"word": "Tools.", "start": 20.2, "end": 20.5},
        ]}]}))
        cuts.write_text(json.dumps({"segments": [
            {"src_start": 10, "src_end": 12, "out_start": 0},
            {"src_start": 20, "src_end": 21, "out_start": 2},
        ], "fix": {"Alexx": "Alex"}}))
        command = [sys.executable, str(script), str(audio), str(cuts), str(output)]
        result = subprocess.run(command + ["--expected", str(expected)],
                                capture_output=True, text=True, check=True, timeout=10)
        assert "chunks=2 overlaps=0" in result.stdout
        text = output.read_text()
        assert "Alex builds." in text and "discard" not in text
        assert "0:00:00.14" in text and "0:00:02.14" in text
        assert expected.read_text() == "Alexx builds.\nTools.\n"

        # The helper warns about close-caption overlap; it does not repair it.
        audio.write_text(json.dumps({"segments": [{"words": [
            {"word": "A.", "start": 10.2, "end": 10.21},
            {"word": "B.", "start": 10.22, "end": 10.23},
        ]}]}))
        result = subprocess.run(command, capture_output=True, text=True,
                                check=True, timeout=10)
        assert "overlaps=1" in result.stdout and "FIX BEFORE BURNING" in result.stdout

        # A first word stretched back before the cut is kept and clamped, number
        # pieces are joined, and the last caption stops at the export end.
        audio.write_text(json.dumps({"segments": [{"words": [
            {"word": " I", "start": 9.4, "end": 10.3},
            {"word": " spent", "start": 10.3, "end": 10.6},
            {"word": " $2", "start": 10.6, "end": 10.8},
            {"word": ",000.", "start": 10.8, "end": 11.95},
        ]}]}))
        cuts.write_text(json.dumps({"segments": [
            {"src_start": 10, "src_end": 12, "out_start": 1}]}))
        result = subprocess.run(command, capture_output=True, text=True,
                                check=True, timeout=10)
        assert "clamped boundary word 'I'" in result.stdout
        text = output.read_text()
        assert "0:00:01.00" in text and "I spent $2,000." in text
        assert "0:00:03.00" in text and "0:00:03.13" not in text

        audio.write_text(json.dumps({"segments": [
            {"words": [{"word": " My", "start": 10.1, "end": 10.3},
                       {"word": " spend", "start": 10.3, "end": 10.6}]},
            {"words": [{"word": " Is", "start": 10.7, "end": 10.9},
                       {"word": " high.", "start": 10.9, "end": 11.2}]},
            {"words": [{"word": " Claude", "start": 11.3, "end": 11.6}]},
        ]}))
        result = subprocess.run(command, capture_output=True, text=True,
                                check=True, timeout=10)
        text = output.read_text()
        assert "My spend is" in text and "Claude" in text

        audio.write_text('{"segments": []}')
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        assert result.returncode != 0 and "no words selected" in result.stderr
    print("Caption CLI checks passed")


if __name__ == "__main__":
    check()
