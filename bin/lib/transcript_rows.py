"""Claude Code transcript rows that carry the user's own words.

A message the user types while a turn is running is not a `"type": "user"`
row. Claude Code stores it as

    {"type": "attachment",
     "attachment": {"type": "queued_command", "prompt": "...",
                    "commandMode": "prompt", "origin": {"kind": "human"}}}

and shows it to the model inside a system reminder. Every reader that kept
only `type == "user"` rows dropped those. On 2026-10-26 a wrap-up that tried to
learn from every message in the 30-hour Parker Manley session found 89 of his
~130: the other 41 were queued_command attachments (123 human ones in that
transcript, next to 19 task notifications and 2 relays from another session,
which are not his words and stay out).

`as_user_row` turns a human queued_command into the user row it would have
been, so a reader's existing `type == "user"` logic sees it. Any other row comes
back unchanged.
"""
from __future__ import annotations

# A line prefilter that skips rows without '"user"' must also keep these.
MARKER = "queued_command"


def human_prompt(row: dict):
    """The prompt of a mid-turn human message (a str or a list of content
    blocks), or None when the row is anything else."""
    if not isinstance(row, dict) or row.get("type") != "attachment":
        return None
    a = row.get("attachment")
    if not isinstance(a, dict) or a.get("type") != "queued_command":
        return None
    origin = a.get("origin") if isinstance(a.get("origin"), dict) else {}
    if origin.get("kind", "human") != "human" or a.get("commandMode", "prompt") != "prompt":
        return None
    prompt = a.get("prompt")
    return prompt if isinstance(prompt, (str, list)) and prompt else None


def as_user_row(row: dict) -> dict:
    prompt = human_prompt(row)
    if prompt is None:
        return row
    return {**row, "type": "user", "message": {"role": "user", "content": prompt}, "queued": True}


def maybe_user_line(line: str) -> bool:
    """Cheap prefilter for a raw JSONL line: could it hold a user message?"""
    return '"user"' in line or MARKER in line
