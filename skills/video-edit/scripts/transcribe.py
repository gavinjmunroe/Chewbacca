#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["fermion-research==0.2.3", "mlx-audio==0.5.7", "mlx-lm==0.31.3", "mlx==0.32.3", "soundfile", "scipy", "zstandard"]
# ///
"""Local Phonon-2 transcription with words in the caption helper's JSON format.

    uv run transcribe.py AUDIO [AUDIO ...] --output-dir DIR

English speech only. Unresolved speech gaps stop output; review or retry those
windows with Phonon. Whisper is reserved for concrete unresolved failures or
unsupported input. See references/technical.md in this skill.
Apple silicon only. Files are decoded by FFmpeg to 16 kHz mono. Array inputs
to transcribe() must already be float PCM at that rate. One model per process;
batch files to amortize loading. Existing outputs require --force.
"""
import argparse
from functools import lru_cache
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import time

MODEL = "FermionResearch/Phonon-2"


@lru_cache(maxsize=1)
def load_model():
    # Private timing API: pin Fermion/MLX Audio together above; test before upgrading.
    from fermion.transcribe import _resolve
    from fermion._speech import backends, fetch
    kind = backends.resolve("word-timestamp transcription")
    if kind != "mlx":
        raise RuntimeError("Phonon word timestamps require Apple silicon with MLX")
    repo, key, pin, local = _resolve(MODEL)
    return backends.load(kind, local or fetch.ensure(repo, key, pin),
                         profile=key, backend=pin["backend"])


def read_audio(path):
    import numpy as np
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(path),
                          "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype="<f4").copy()


def word_segments(result, duration):
    """Join timed subwords, including contractions, numerals and punctuation."""
    segments = []
    for sentence in result.sentences:
        words = []
        for token in sentence.tokens:
            start, end = float(token.start), float(token.end)
            if not all(math.isfinite(t) for t in (start, end)) or end < start:
                raise ValueError("Decoder returned an invalid token timestamp")
            start, end = max(0.0, min(start, duration)), max(0.0, min(end, duration))
            for piece in re.findall(r"\s*\S+", token.text):
                text = piece.strip()
                punctuation = all(not c.isalnum() for c in text)
                if words and (not piece[0].isspace() or punctuation):
                    words[-1]["word"] += text
                    words[-1]["end"] = max(words[-1]["end"], end)
                else:
                    words.append({"word": text, "start": start, "end": end})
        if words:
            segments.append({"id": len(segments), "start": words[0]["start"],
                             "end": words[-1]["end"],
                             "text": " ".join(w["word"] for w in words), "words": words})
    return segments


@lru_cache(maxsize=1)
def load_vad():
    from mlx_audio.vad import load
    return load("mlx-community/silero-vad", strict=True)


def uncovered_speech(x, words):
    """Ask VAD only about long untranscribed gaps, not every frame of a file."""
    duration = len(x) / 16000
    gaps = []
    for left, right in zip([{"end": 0.0}] + words, words + [{"start": duration}]):
        a, b = left["end"], right["start"]
        if b - a < 0.6:
            continue
        # Context helps VAD classify short words at either side of the gap.
        lo, hi = max(0, round((a - 0.2) * 16000)), min(len(x), round((b + 0.2) * 16000))
        speech = load_vad().get_speech_timestamps(x[lo:hi], sample_rate=16000,
                                                 return_seconds=True, speech_pad_ms=0,
                                                 min_speech_duration_ms=100)
        covered = sum(max(0, min(b, s["end"] + lo / 16000) -
                          max(a, s["start"] + lo / 16000)) for s in speech)
        if covered >= 0.4:
            gaps.append((a, b))
    return gaps


def recover_gaps(x, words, model):
    import mlx.core as mx
    recovered = []
    for attempt in range(3):
        gaps = uncovered_speech(x, words)
        if not gaps:
            break
        for a, b in gaps:
            # ponytail: bounded retries for missed speech; unresolved gaps stop automation.
            width = (8.0, 4.0, 2.0)[attempt]
            n = math.ceil((b - a) / width)
            for i in range(n):
                core_a, core_b = a + i * (b - a) / n, a + (i + 1) * (b - a) / n
                lo = max(0, round((core_a - 1.0) * 16000))
                hi = min(len(x), round((core_b + 1.0) * 16000))
                r = model.generate(mx.array(x[lo:hi]), dtype=mx.bfloat16)
                fresh = [dict(w, start=w["start"] + lo / 16000, end=w["end"] + lo / 16000)
                         for s in word_segments(r, (hi - lo) / 16000) for w in s["words"]]
                joined = splice_repair(words, fresh, core_a, core_b)
                if joined is not None:
                    words = joined
                    recovered.append({"start": core_a, "end": core_b, "attempt": attempt + 1})
    return words, recovered, uncovered_speech(x, words)


def splice_repair(old, fresh, a, b):
    """Replace through matching boundary words, so timing drift cannot duplicate them."""
    key = lambda w: re.sub(r"\W", "", w["word"]).casefold()
    left, right = [], []
    for i, w in enumerate(old):
        if w["end"] <= a + 1e-6:
            for j, v in enumerate(fresh):
                if key(w) == key(v) and abs(w["start"] - v["start"]) <= 0.4:
                    left.append((i, j))
        elif w["start"] >= b - 1e-6:
            for j, v in enumerate(fresh):
                if key(w) == key(v) and abs(w["start"] - v["start"]) <= 0.4:
                    right.append((i, j))
    if (a > 0 and not left) or (b < (old[-1]["end"] if old else 0) and not right):
        return None
    for li, lj in reversed(left or [(0, 0)]):
        for ri, rj in right or [(len(old), len(fresh))]:
            if lj >= rj:
                continue
            merged = old[:li] + fresh[lj:rj] + old[ri:]
            if any(w["end"] <= w["start"] for w in merged):
                continue
            if not any(l["end"] > r["start"] + 1e-6 for l, r in zip(merged, merged[1:])):
                return merged
    return None


def segments_from_words(words):
    segments, current = [], []
    for w in words:
        if current and w["start"] - current[-1]["end"] > 0.6:
            segments.append(current)
            current = []
        current.append(w)
        if w["word"][-1:] in ".?!":
            segments.append(current)
            current = []
    if current:
        segments.append(current)
    return [{"id": i, "start": ws[0]["start"], "end": ws[-1]["end"],
             "text": " ".join(w["word"] for w in ws), "words": ws}
            for i, ws in enumerate(segments)]


def transcribe(audio):
    import mlx.core as mx
    import numpy as np
    x = read_audio(audio) if isinstance(audio, (str, Path)) else np.asarray(audio, dtype=np.float32)
    if x.ndim != 1 or not np.isfinite(x).all():
        raise ValueError("Expected finite mono float PCM at 16 kHz")
    duration = len(x) / 16000
    started = time.perf_counter()
    recovered, unresolved = [], []
    if not len(x) or np.max(np.abs(x)) < 1e-4:
        segments = []
    else:
        speech = load_model()
        result = speech.model.generate(mx.array(x), dtype=mx.bfloat16,
                                       chunk_duration=30.0, overlap_duration=2.0)
        mx.synchronize()
        segments = word_segments(result, duration)
        words = [w for s in segments for w in s["words"]]
        words, recovered, unresolved = recover_gaps(x, words, speech.model)
        segments = segments_from_words(words)
    return {"text": " ".join(s["text"] for s in segments), "segments": segments,
            "language": "en", "engine": "phonon-2", "model": MODEL,
            "duration": duration, "transcribe_seconds": time.perf_counter() - started,
            "recovered_intervals": recovered,
            "review_intervals": [{"start": a, "end": b, "reason": "speech without words"}
                                 for a, b in unresolved]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="+")
    parser.add_argument("--output-dir", type=Path, default=Path("."))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    destinations = [args.output_dir / (Path(p).stem + ".json") for p in args.audio]
    if len(set(destinations)) != len(destinations):
        parser.error("Input filenames collide in the output directory")
    for src, dest in zip(args.audio, destinations):
        if Path(src).resolve() == dest.resolve():
            parser.error("Output would replace an input")
        if dest.exists() and not args.force:
            parser.error(f"Output exists: {dest}; use --force or another directory")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for src, dest in zip(args.audio, destinations):
        result = transcribe(src)
        if result["review_intervals"]:
            raise RuntimeError(f"Unresolved speech gaps in {src}: {result['review_intervals']}")
        # A failed decode/write leaves an existing transcript intact.
        with tempfile.NamedTemporaryFile(mode="w", dir=dest.parent, delete=False) as f:
            temp = Path(f.name)
            try:
                json.dump(result, f, ensure_ascii=False, allow_nan=False, indent=2)
                f.flush()
                temp.replace(dest)
            finally:
                temp.unlink(missing_ok=True)
        print(json.dumps({"output": str(dest), "engine": result["engine"],
                          "seconds": round(result["transcribe_seconds"], 3)}))


if __name__ == "__main__":
    main()
