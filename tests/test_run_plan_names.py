"""run_plan calls only functions that exist.

On 2026-10-03 every plan step with `verify` crashed with a NameError, because
the re-read called `_jarvis`, the helper's name before the rename to
`_chewie`. Python only finds that when the line runs, and no plan in the
suite used `verify`, so the check is on the source: every bare-name call must
resolve to something the module defines, imports or gets from builtins."""
import ast
import builtins
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "mac" / "lib" / "run_plan.py"
tree = ast.parse(PATH.read_text())
defined = set(dir(builtins))
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        defined.add(node.name)
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        defined.update((a.asname or a.name).split(".")[0] for a in node.names)
    elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
        defined.add(node.id)
    elif isinstance(node, ast.arg):
        defined.add(node.arg)
missing = sorted({n.func.id for n in ast.walk(tree)
                  if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id not in defined})
if missing:
    print("FAIL run_plan calls names it never defines:", ", ".join(missing))
    sys.exit(1)
print("ok   every call in run_plan resolves")
