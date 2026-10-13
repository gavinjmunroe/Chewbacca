#!/usr/bin/env python3
"""Compare the shadow write-log with the real one, row by row.

In shadow mode (~/.chewbacca/writelog.mode says shadow) write_log.py writes
write-log.tsv and chewbacca-writelog writes write-log.shadow.tsv for the same
calls. A row matches when the other log has the same session, path and kind
within SLACK seconds. Exit 0 only when neither log has a row the other lacks.

    writelog_parity.py                    # since the shadow log began
    writelog_parity.py --since 1760241600 --show 20

A row only Python logged, for a call the binary handed back to Python in
shadow mode (`<shadow log>.misses` says "fallback" for that session within
SLACK), isn't a miss: in rust mode write_log.py writes that row itself. It's
counted apart and never fails the check. A call the binary couldn't observe
("unavailable") is a miss, and is named as one. Rows carry no tool id, so a
real miss in a parallel call of the same session within SLACK of a handed-back
one is excused with it; the misses file keeps the tool id for that hunt.
"""
import argparse
import os
from pathlib import Path
import sys

# Both runs stamp a row with the time their own record() began. Python's
# start trails the binary's on a Pre and leads it on a Post by one hook's run,
# 0.55 s at most on 2026-10-11; 5 s leaves room for a loaded Mac.
SLACK = 5.0


def rows(path, since):
    out = []
    try:
        with open(path, encoding='utf-8', errors='replace') as stream:
            for line in stream:
                parts = line.rstrip('\n').split('\t')
                if len(parts) < 4:
                    continue
                try:
                    when = float(parts[0])
                except ValueError:
                    continue
                if when >= since:
                    out.append((when, parts[1], parts[2], parts[3]))
    except FileNotFoundError:
        pass
    return out


def unmatched(mine, theirs):
    pool = {}
    for row in theirs:
        pool.setdefault(row[1:], []).append(row[0])
    missing = []
    for row in mine:
        times = pool.get(row[1:], [])
        hit = next((t for t in times if abs(t - row[0]) <= SLACK), None)
        if hit is None:
            missing.append(row)
        else:
            times.remove(hit)
    return missing


def misses(path, since):
    """{session: [(time, what)]} from the shadow run's misses file."""
    out = {}
    try:
        with open(path, encoding='utf-8', errors='replace') as stream:
            for line in stream:
                parts = line.rstrip('\n').split('\t')
                if len(parts) < 4:
                    continue
                try:
                    when = float(parts[0])
                except ValueError:
                    continue
                if when >= since - SLACK:
                    out.setdefault(parts[1], []).append((when, parts[3]))
    except FileNotFoundError:
        pass
    return out


def handed_back(row, missed):
    return any(what == 'fallback' and abs(when - row[0]) <= SLACK for when, what in missed.get(row[1], []))


def main(argv=None):
    home = Path(os.environ.get('CHEWBACCA_HOME') or Path.home() / '.chewbacca').expanduser()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--log', default=str(home / 'write-log.tsv'))
    parser.add_argument('--shadow', default=str(home / 'write-log.shadow.tsv'))
    parser.add_argument('--since', type=float, help='unix time; default the first shadow row')
    parser.add_argument('--show', type=int, default=10)
    args = parser.parse_args(argv)
    shadow = rows(args.shadow, 0)
    since = args.since if args.since is not None else (min(r[0] for r in shadow) - SLACK if shadow else 0)
    shadow = [r for r in shadow if r[0] >= since]
    real = rows(args.log, since)
    # A real row from a call the shadow never saw (logged before it began, or
    # by a host whose payload the binary hands back to Python) isn't a miss.
    py_only = unmatched(real, shadow)
    rust_only = unmatched(shadow, real)
    missed = misses(args.shadow + '.misses', since)
    python_wrote = [r for r in py_only if handed_back(r, missed)]
    py_only = [r for r in py_only if not handed_back(r, missed)]
    print(f'since {since:.0f}: python {len(real)} rows, rust {len(shadow)} rows, '
          f'python only {len(py_only)}, rust only {len(rust_only)}, '
          f'handed back to python {len(python_wrote)}')
    for label, found in (('python only', py_only), ('rust only', rust_only)):
        for when, sid, path, kind in found[:args.show]:
            note = ' (binary: unavailable)' if any(abs(t - when) <= SLACK for t, w in missed.get(sid, []) if w == 'unavailable') else ''
            print(f'  {label}: {when:.3f} {sid[:8]} {kind} {path}{note}')
    return 0 if not py_only and not rust_only else 1


if __name__ == '__main__':
    sys.exit(main())
