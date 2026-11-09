#!/usr/bin/env python3
"""Every Python file in the repo imports on the Mac's stock /usr/bin/python3 (3.9).

An annotation like `x: dict | None` is evaluated when the def runs, and 3.9
has no `|` on types, so the module dies on import with "unsupported operand
type(s) for |: 'type' and 'NoneType'". On 2026-10-13 ten files did that, and
seven suite checks were red for it at once (cleanup-suite-before.log, d1013).
`from __future__ import annotations` makes every annotation a string, which
is the whole fix. Two 3.11 APIs did the same to three more checks that day
(TestCase.enterContext in test_tabs and test_work_ledger_context,
hashlib.file_digest in tools/task_graph.py), so those are refused too.

  py39_annotations_check.py          check the repo's tracked Python
  py39_annotations_check.py FILE...  check these files
"""
import ast
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


UNION = "a `X | Y` annotation without `from __future__ import annotations` fails to import on Python 3.9"
# Attribute names seen breaking the suite on 3.9, with the version that added them.
NEWER_APIS = {"enterContext": "3.11", "file_digest": "3.11"}


def has_union(node):
    return node is not None and any(
        isinstance(n, ast.BinOp) and isinstance(n.op, ast.BitOr) for n in ast.walk(node))


def findings(path):
    try:
        src = Path(path).read_text(encoding="utf-8")
        tree = ast.parse(src)
    except (OSError, UnicodeDecodeError, SyntaxError):
        return []
    future = any(isinstance(n, ast.ImportFrom) and n.module == "__future__"
                 and any(a.name == "annotations" for a in n.names) for n in tree.body)
    found = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Attribute) and n.attr in NEWER_APIS:
            found.add((n.lineno, f"{n.attr} is Python {NEWER_APIS[n.attr]}+ and fails on 3.9"))
        if future:
            continue
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = n.args.posonlyargs + n.args.args + n.args.kwonlyargs + [n.args.vararg, n.args.kwarg]
            if has_union(n.returns) or any(a is not None and has_union(a.annotation) for a in args):
                found.add((n.lineno, UNION))
        elif isinstance(n, ast.AnnAssign) and has_union(n.annotation):
            found.add((n.lineno, UNION))
    return sorted(found)


def tracked_python():
    out = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True, text=True).stdout
    for rel in filter(None, out.split("\0")):
        p = ROOT / rel
        if p.suffix == ".py":
            yield p
        elif p.suffix == "" and p.is_file():
            try:
                with p.open("rb") as fh:
                    first = fh.readline(200)
            except OSError:
                continue
            if first.startswith(b"#!") and b"python" in first:
                yield p


def main(argv):
    paths = [Path(a) for a in argv] or list(tracked_python())
    bad = 0
    for p in paths:
        for line, why in findings(p):
            rel = p.relative_to(ROOT) if p.is_absolute() and ROOT in p.parents else p
            print(f"{rel}:{line}: {why}")
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
