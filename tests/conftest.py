"""Keep pytest away from script-style tests.

Many files here are scripts: their checks run at import and they end in
sys.exit. tests/run.sh runs each one as a script. Under pytest, importing one
ran its checks inside the collector, and the first sys.exit killed collection
with INTERNALERROR (tests/test_context_budget.py, 2026-10-05). Guarding the
exit was not enough: the same run then failed tests in test_codex_context.py
and test_chatgpt_gateway.py that pass alone, because the scripts set
CLAUDE_CONFIG_DIR and HOME at import and that leaked into every later test.

So a test file with no test functions is not collected. run.sh still runs it.

The second shape is a script whose test functions take arguments its own
main() passes in: a shared temp dir, a loaded module, a database the previous
test built. pytest reads those as fixtures that do not exist and errors at
setup. On 2026-10-09 test_gtm.py's `tmp` and `db_path` turned the pytest
group red, and test_gtm_memory, test_hud_listen and test_hud_speak had the
same shape. A file whose test functions ask for a name that is neither a
pytest builtin fixture nor a fixture it defines is not collected either.
"""
import ast
from pathlib import Path

# pytest's own fixtures, as listed by its "fixture not found" error.
BUILTIN_FIXTURES = frozenset({
    "cache", "capfd", "capfdbinary", "caplog", "capsys", "capsysbinary",
    "capteesys", "doctest_namespace", "monkeypatch", "pytestconfig",
    "record_property", "record_testsuite_property", "record_xml_attribute",
    "recwarn", "request", "subtests", "tmp_path", "tmp_path_factory",
    "tmpdir", "tmpdir_factory",
})


def takes_script_arguments(source: str) -> bool:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    fixtures = {f.name for f in functions
                if any("fixture" in ast.unparse(d) for d in f.decorator_list)}
    for f in functions:
        if not f.name.startswith("test_"):
            continue
        if any("parametrize" in ast.unparse(d) for d in f.decorator_list):
            continue
        if any(a.arg not in BUILTIN_FIXTURES and a.arg not in fixtures for a in f.args.args):
            return True
    return False


def pytest_ignore_collect(collection_path, config):
    path = Path(collection_path)
    if path.suffix != ".py" or not path.name.startswith("test_"):
        return None
    source = path.read_text(encoding="utf-8", errors="replace")
    if "def test_" not in source:
        return True
    if takes_script_arguments(source):
        return True
    return None
