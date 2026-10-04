#!/usr/bin/env python3
"""Keep the memory index inside the budget that loads it.

MEMORY.md is read into every session. It grew past the limit its own loader
enforces, so the file was silently truncated mid-read and the memories at the
bottom stopped existing as far as any session was concerned. The system's
answer was a warning. This is the fix.

Every index line is one link plus a hook. Anything past the hook belongs in the
memory file itself, so the overflow is moved there rather than deleted.

  python3 tools/memory_compact.py --dry-run   show what would move
  python3 tools/memory_compact.py             do it
  python3 tools/memory_compact.py --terse     rewrite link lines to the terse form

The terse form, "- !stem (m/d): hook", drops the markdown link, the title and
the bold markers. On 2026-10-03 that took a 131-pointer index from 20,948 to
16,462 bytes, room for about 35 more pointers under the same load budget. The
full stem stays so `grep stem` and brain-check's drift check still find it, and
"!" keeps what the bold used to mark. Lines already terse pass through, so it is
safe to rerun after a session appends an old-style link line.
"""

import re
import sys
from pathlib import Path

MEM = Path.home() / "second-brain/memory"
INDEX = MEM / "MEMORY.md"
LIMIT = 200          # per line, the documented cap
HEADING = "## From the index"

# An old-style pointer: "- **[Title (9/21)](stem.md)**, hook".
POINTER = re.compile(r"^-\s*(\*\*)?\[([^\]]+)\]\(([^)\s]+?)\.md\)(\*\*)?[,:]?\s*(.*)$")
DATE = re.compile(r"\((\d{1,2}/\d{1,2})[^)]*\)\s*$")


def terse_line(line):
    """One old-style pointer in the terse form; anything else unchanged."""
    m = POINTER.match(line)
    if not m:
        return line
    bold, title, stem, _, hook = m.groups()
    date = DATE.search(title)
    hook = hook.replace("**", "").strip()
    head = f"- {'!' if bold else ''}{stem}{f' ({date.group(1)})' if date else ''}"
    return f"{head}: {hook}" if hook else head


def terse(text):
    return "\n".join(terse_line(l) for l in text.splitlines()) + "\n"


LINK = re.compile(r"^(\s*-\s*)(\*\*)?(\[[^\]]+\]\(([^)]+)\))(.*)$")


def already_covered(overflow, body):
    """Is this text effectively in the target file already?

    Word overlap, not exact match: the index paraphrases. Anything above the
    threshold is redundant and appending it makes the file worse, not safer.
    """
    words = {w for w in re.findall(r"[a-z0-9]{4,}", overflow.lower())}
    if not words:
        return True
    have = {w for w in re.findall(r"[a-z0-9]{4,}", body.lower())}
    return len(words & have) / len(words) >= 0.7


def trim(tail, room):
    """Cut at the last sentence or clause boundary that fits."""
    tail = tail.strip()
    if len(tail) <= room:
        return tail, ""
    cut = tail[:room]
    for sep in (". ", "; ", ", "):
        i = cut.rfind(sep)
        if i > room * 0.4:
            return tail[: i + 1].rstrip(), tail[i + 1 :].strip()
    # No clause boundary fits. Back off to a word boundary: cutting at exactly
    # `room` split "settings.json" and pushed ".json; it overrides..." into the
    # target file as if it were a sentence.
    i = cut.rfind(" ")
    if i <= 0:
        return cut.rstrip(), tail[len(cut):].strip()
    return tail[:i].rstrip(), tail[i:].strip()


def main():
    dry = "--dry-run" in sys.argv
    if not INDEX.is_file():
        print(f"no index at {INDEX}", file=sys.stderr)
        return 2
    if "--terse" in sys.argv:
        before = INDEX.read_text(encoding="utf-8")
        after = terse(before)
        changed = sum(a != b for a, b in zip(before.splitlines(), after.splitlines()))
        print(f"{changed} pointer(s) made terse, index {len(before.encode()):,} -> "
              f"{len(after.encode()):,} bytes")
        if dry:
            print("dry run, nothing written")
        elif changed:
            INDEX.write_text(after, encoding="utf-8")
        return 0

    lines = INDEX.read_text(encoding="utf-8").splitlines()
    before = sum(len(l) + 1 for l in lines)
    out, moved = [], 0

    for line in lines:
        if len(line) <= LIMIT:
            out.append(line)
            continue
        m = LINK.match(line)
        if not m:
            out.append(line)
            continue
        prefix, bold, link, target, tail = m.groups()
        # Bold survives only around the link. Truncating a line that opened **
        # mid-tail left the marker unclosed and bolded the rest of the file.
        head = f"{prefix}{'**' if bold else ''}{link}{'**' if bold else ''}"
        room = LIMIT - len(head) - 2
        kept, overflow = trim(tail.lstrip(" ,"), max(room, 40))
        # An original line could open ** around the link and close it inside
        # the tail. Keeping the orphaned closer bolded the rest of the file.
        if kept.count("**") % 2:
            kept = "".join(kept.rsplit("**", 1))
        out.append(f"{head}, {kept}" if kept else head)
        if not overflow:
            continue
        dest = MEM / target
        if not dest.is_file():
            print(f"  {target}: TARGET MISSING, index line left long")
            out[-1] = line
            continue
        body = dest.read_text(encoding="utf-8")
        # The index is a pointer, so the overflow is nearly always already in
        # the file it points at. Appending it anyway duplicated content and,
        # on a second run, duplicated it again.
        if already_covered(overflow, body):
            moved += 1
            print(f"  {target}: dropped {len(overflow)} chars, already in the file")
            continue
        moved += 1
        if not dry:
            if HEADING not in body:
                body = body.rstrip() + f"\n\n{HEADING}\n"
            body = body.rstrip() + f"\n\n{overflow}\n"
            dest.write_text(body, encoding="utf-8")
        print(f"  {target}: moved {len(overflow)} chars into the file")

    text = "\n".join(out) + "\n"
    after = len(text)
    print(f"\n{moved} line(s) trimmed")
    print(f"index {before:,} -> {after:,} bytes "
          f"({(before - after) / max(before, 1) * 100:.0f}% smaller, "
          f"about {(before - after) // 4:,} tokens off every session)")
    if dry:
        print("\ndry run, nothing written")
        return 0
    INDEX.write_text(text, encoding="utf-8")
    over = [l for l in out if len(l) > LIMIT]
    print(f"written. {len(over)} line(s) still over {LIMIT} chars"
          + (":" if over else "."))
    for l in over[:5]:
        print(f"  {len(l)}: {l[:90]}...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
