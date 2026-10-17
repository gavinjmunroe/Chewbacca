#!/usr/bin/env bash
# Install the standards into a CLAUDE.md without destroying what is there.
#
#   merge-claude-md.sh <target CLAUDE.md> <standards file>
#
# Anyone who already had a CLAUDE.md lost it, with no backup and no warning.
# That is a bad first thing for an installer to do to a file somebody wrote by
# hand. Prints one word:
#
#   wrote      no file, so the standards were written
#   adopted    the file was exactly the standards, now wrapped in markers
#   merged     somebody's file, kept byte for byte below the standards, backed up
#   updated    only the region between our markers changed
#   unchanged  nothing to do, and nothing was written
#   refused    unbalanced markers or a read-only file; nothing was written
#
# Every byte outside the markers survives, CRLF included, because the file is
# read and written as bytes. A symlink is written through, never replaced. A
# region the user edited by hand is backed up before it is replaced.
# Fixture tests: tests/test_instruction_merge.py (backlog 250).
set -uo pipefail

TARGET="${1:-}"
STANDARDS="${2:-}"
[ -n "$TARGET" ] && [ -f "$STANDARDS" ] || {
  echo "usage: merge-claude-md.sh <target> <standards>" >&2; exit 2; }

exec python3 - "$TARGET" "$STANDARDS" <<'PY'
import os, sys, tempfile, time
from pathlib import Path

BEGIN, END = b"<!-- CHEWBACCA:BEGIN -->", b"<!-- CHEWBACCA:END -->"
link, standards = Path(sys.argv[1]), Path(sys.argv[2]).read_bytes()
# Write through a dotfiles symlink rather than replacing it with a file.
target = Path(os.path.realpath(link))
region = BEGIN + b"\n" + standards + END


def done(word, code=0):
    print(word)
    sys.exit(code)


def backup(data):
    path = target.with_name(target.name + ".yours-" + time.strftime("%Y%m%d-%H%M%S"))
    n = 1
    while path.exists():
        n += 1
        path = target.with_name(target.name + ".yours-" + time.strftime("%Y%m%d-%H%M%S") + f"-{n}")
    path.write_bytes(data)
    return path


def write(data):
    # os.replace would swap a read-only file for a writable one; the mode is
    # the user saying no.
    if target.exists() and not os.access(target, os.W_OK):
        print("CLAUDE.md is read-only; left as it is", file=sys.stderr)
        done("refused", 1)
    target.parent.mkdir(parents=True, exist_ok=True)
    mode = target.stat().st_mode & 0o777 if target.exists() else 0o644
    fd, tmp = tempfile.mkstemp(prefix="." + target.name, dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


if not target.exists():
    write(region + b"\n")
    target.with_name(target.name + ".chewbacca-region").write_bytes(region)
    done("wrote")

existing = target.read_bytes()
if BEGIN in existing or END in existing:
    if existing.count(BEGIN) != 1 or existing.count(END) != 1 or existing.index(END) < existing.index(BEGIN):
        print("CLAUDE.md has unbalanced Chewbacca markers; fix them by hand", file=sys.stderr)
        done("refused", 1)
    start, close = existing.index(BEGIN), existing.index(END) + len(END)
    current = existing[start:close]
    if current == region:
        done("unchanged")
    # The sidecar holds the region as we last wrote it. A region that differs
    # from it, or an install from before the sidecar existed, was possibly
    # typed by a person, so the whole file is backed up before replacing.
    marker = target.with_name(target.name + ".chewbacca-region")
    hand_edited = not marker.exists() or marker.read_bytes() != current
    if hand_edited and os.access(target, os.W_OK):
        backup(existing)
    write(existing[:start] + region + existing[close:])
    marker.write_bytes(region)
    done("updated")

if existing == standards:
    write(region + b"\n")
    target.with_name(target.name + ".chewbacca-region").write_bytes(region)
    done("adopted")

if not os.access(target, os.W_OK):
    write(existing)  # refuses
saved = backup(existing)
note = (b"\n\n---\n\n# Yours\n\n"
        b"Everything below was in your CLAUDE.md before Chewbacca was installed.\n"
        b"It is kept, and it wins where it disagrees with anything above, because\n"
        b"later instructions take precedence. The original is at\n"
        + saved.name.encode() + b".\n\n")
write(region + note + existing)
target.with_name(target.name + ".chewbacca-region").write_bytes(region)
done("merged")
PY
