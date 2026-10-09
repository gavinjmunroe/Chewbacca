#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["fermion-research==0.2.3", "mlx-audio==0.5.7", "mlx-lm==0.31.3", "mlx==0.32.3", "soundfile", "scipy", "zstandard"]
# ///
"""Find restarts hidden inside selected takes ("Sam proposed... Sam proposed an idea").

Whole-clip ASR merges a false start with its restart, so a clean transcript of a selected
segment proves nothing. This splits each segment at its internal pauses, transcribes the
speech before and after every pause separately, and flags a pause whose following words
repeat words just before it.

  uv run restart_scan.py AUDIO CUTLIST.json
  python3 restart_scan.py --self-test

CUTLIST: {"segments": [{"id": "...", "s": seconds, "e": seconds}, ...]} in AUDIO's seconds.
English on Apple silicon (Phonon-2). Flags are candidates: confirm with the envelope and a listen.
"""
import json, re, sys

SR = 16000


def words(text):
    return re.sub(r"[^a-z0-9' ]", " ", text.lower()).split()


def is_restart(pre, post):
    """True when the speech after a pause restarts what came before it."""
    if len(pre) < 1 or len(post) < 2:
        return False
    head = post[:2]
    tail = " ".join(pre)
    return head == pre[:2] or head == pre[-2:] or " ".join(head) in tail


def pauses(x, a, b, floor_db=-50.0, hop=0.05, min_gap=0.1):
    """Midpoints of silent runs (>= min_gap) strictly inside [a, b), in seconds."""
    import numpy as np
    out, run, t0 = [], 0, a
    n = int((b - a) / hop)
    for i in range(n):
        seg = x[int((a + i * hop) * SR):int((a + (i + 1) * hop) * SR)]
        db = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9) if len(seg) else -120
        if db < floor_db:
            run += 1
        else:
            if run * hop >= min_gap and i - run > 2:
                out.append(a + (i - run / 2) * hop)
            run = 0
    return out


def scan(audio, cutlist):
    from transcribe import read_audio, transcribe
    x = read_audio(audio)

    def text(a, b, start, end):
        # Short clips can decode empty. Retry with more of the selected take.
        for context in (1, 3):
            lo = max(0, int(max(start, a - context) * SR))
            hi = min(len(x), int(min(end, b + context) * SR))
            offset = lo / SR
            r = transcribe(x[lo:hi])
            unresolved = [g for g in r["review_intervals"]
                          if g["end"] + offset > a and g["start"] + offset < b]
            if not unresolved:
                selected = [w["word"] for s in r["segments"] for w in s["words"]
                            if a <= (w["start"] + w["end"]) / 2 + offset < b]
                return words(" ".join(selected))
        raise RuntimeError(f"Review unresolved speech in restart window {a:.2f}-{b:.2f}s: "
                           f"{unresolved}")

    hits = []
    for s in json.load(open(cutlist))["segments"]:
        for g in pauses(x, s["s"], s["e"]):
            pre = text(max(s["s"], g - 3), g, s["s"], s["e"])
            post = text(g, min(s["e"], g + 2.5), s["s"], s["e"])
            if is_restart(pre, post):
                hits.append({"id": s["id"], "pause": round(g, 2), "before": " ".join(pre[-6:]), "after": " ".join(post[:6])})
    return hits


def self_test():
    from types import SimpleNamespace
    from unittest.mock import mock_open, patch
    assert is_restart(["sam", "proposed", "to"], ["sam", "proposed", "an", "idea"])
    assert is_restart(["i", "was", "worried", "that"], ["that", "llms", "would"]) is False
    assert is_restart(["first", "is", "alignment", "sam", "altman"], ["sam", "altman", "admits"])
    assert not is_restart(["catch", "up", "really", "quickly"], ["sam", "proposed", "an", "idea"])
    def timed(text, offset):
        return {"segments": [{"words": [{"word": w, "start": offset + i * .3 + .2,
                                        "end": offset + i * .3 + .4}
                                       for i, w in enumerate(text.split())]}],
                "review_intervals": []}
    unresolved = {"text": "", "review_intervals": [{"start": 0, "end": 4}]}
    results = iter([unresolved, timed("Sam proposed a", 0), timed("Sam proposed an idea", 1),
                    unresolved, unresolved])
    backend = SimpleNamespace(read_audio=lambda _: [0.0] * (4 * SR),
                              transcribe=lambda _: next(results))
    data = json.dumps({"segments": [{"id": "restart", "s": 0, "e": 4}]})
    with patch.dict(sys.modules, {"transcribe": backend, "mlx_whisper": None}), \
         patch(__name__ + ".pauses", return_value=[2]), \
         patch("builtins.open", mock_open(read_data=data)):
        hits = scan("audio.wav", "cutlist.json")
        assert len(hits) == 1 and hits[0]["id"] == "restart"
        try:
            scan("audio.wav", "cutlist.json")
        except RuntimeError as e:
            assert "unresolved speech" in str(e)
        else:
            raise AssertionError("Unresolved speech passed without review")
    print("ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif len(sys.argv) == 3:
        found = scan(sys.argv[1], sys.argv[2])
        print(json.dumps(found, indent=1))
        sys.exit(1 if found else 0)
    else:
        sys.exit(__doc__)
