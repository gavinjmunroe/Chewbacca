"""What Whisper says when it hears nothing, stripped from a transcript's ends.

A Python twin of bin/lib/people-amber/transcript-filler.js (Amber's, from
amber-id), so meeting capture can use it inside mlx-whisper's own interpreter
without starting node per chunk. tests/test_people_amber.py runs both on the
same inputs and fails if they disagree.

Only the very start and the very end are touched: Whisper's silence
hallucinations bracket real audio, and a filter that hunted through the body
would eat someone genuinely saying "thanks for watching" about their video.
"""
from __future__ import annotations

import re

FILLER = [re.compile(p, re.I) for p in (
    r"^thank(?:s| you)(?: (?:so|very) much)? for watching(?: (?:this|my|the) video)?[!.…]*$",
    r"^(?:and )?(?:please )?(?:don'?t forget to )?(?:like(?:,| and)? )?subscribe(?: to (?:my|the) channel)?[!.…]*$",
    r"^(?:please )?like and subscribe[!.…]*$",
    r"^subtitles? (?:by|created by|provided by) .*$",
    r"^(?:sub(?:title)?s )?(?:by )?amara\.org.*$",
    r"^transcription by .*$",
    r"^(?:closed captions?|captioning) (?:by|provided by) .*$",
    r"^the end[!.…]*$",
    r"^bye(?:[ -]?bye)?[!.…]*$",
    r"^(?:see you|catch you) (?:next time|later|in the next (?:one|video))[!.…]*$",
    r"^\[?\s*(?:blank_?audio|silence|music|inaudible|no speech)\s*\]?[!.…]*$",
    r"^[♪♫\s.…-]+$",
    r"^you[!.…]*$",
    r"^www\.[a-z0-9.-]+\.[a-z]{2,}[/\s]*$",
)]


def is_filler(sentence: str) -> bool:
    s = sentence.strip()
    return not s or any(p.search(s) for p in FILLER)


def sentences(text: str) -> list[str]:
    """Lossless: each piece keeps the whitespace after it, so "".join() is the input.
    Breaks only where whitespace follows the punctuation, which keeps
    "Subtitles by the Amara.org community" whole."""
    parts = re.split(r"(?<=[.!?…])(\s+)", text)
    out = []
    for i in range(0, len(parts), 2):
        piece = parts[i] + (parts[i + 1] if i + 1 < len(parts) else "")
        if piece:
            out.append(piece)
    return out or [text]


def strip_transcript_filler(raw) -> dict:
    """{"text", "removed", "all_filler"}. all_filler means nothing was said."""
    text = raw if isinstance(raw, str) else ""
    if not text.strip():
        return {"text": "", "removed": [], "all_filler": False}
    parts = sentences(text)
    removed = []
    start, end = 0, len(parts)
    while start < end and is_filler(parts[start]):
        removed.append(parts[start].strip())
        start += 1
    while end > start and is_filler(parts[end - 1]):
        removed.append(parts[end - 1].strip())
        end -= 1
    kept = "".join(parts[start:end]).strip()
    return {"text": kept, "removed": [r for r in removed if r], "all_filler": not kept}
