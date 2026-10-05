"""Keep pytest away from script-style tests.

Many files here are scripts: their checks run at import and they end in
sys.exit. tests/run.sh runs each one as a script. Under pytest, importing one
ran its checks inside the collector, and the first sys.exit killed collection
with INTERNALERROR (tests/test_context_budget.py, 2026-10-05). Guarding the
exit was not enough: the same run then failed tests in test_codex_context.py
and test_chatgpt_gateway.py that pass alone, because the scripts set
CLAUDE_CONFIG_DIR and HOME at import and that leaked into every later test.

So a test file with no test functions is not collected. run.sh still runs it.
"""
from pathlib import Path


def pytest_ignore_collect(collection_path, config):
    path = Path(collection_path)
    if path.suffix != ".py" or not path.name.startswith("test_"):
        return None
    source = path.read_text(encoding="utf-8", errors="replace")
    if "def test_" not in source:
        return True
    return None
