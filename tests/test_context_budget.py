"""context-budget: startup attachments are attributed by source from a
transcript, the residual is the first turn's real usage minus them, and plugin
use is counted from Skill and plugin MCP calls. Fixture transcripts only."""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp())
os.environ["CLAUDE_CONFIG_DIR"] = str(root)
sys.dont_write_bytecode = True
path = Path(__file__).resolve().parent.parent / "bin" / "context-budget"
loader = importlib.machinery.SourceFileLoader("context_budget", str(path))
spec = importlib.util.spec_from_loader("context_budget", loader)
cb = importlib.util.module_from_spec(spec)
loader.exec_module(cb)

failed = 0


def check(name, ok):
    global failed
    print(("ok   " if ok else "FAIL ") + name)
    failed += not ok


def att(kind, **kw):
    return {"type": "attachment", "attachment": {"type": kind, **kw}}


proj = root / "projects" / "-x"
proj.mkdir(parents=True)
session = proj / "s1.jsonl"
rows = [
    att("hook_success", command="session-context.sh", content="c" * 280, stdout=""),
    att("hook_additional_context", content=["# $CMEM header\n" + "m" * 266]),
    att("instructions", files=[{"path": "/tmp/CLAUDE.md", "content": "i" * 2800}]),
    att("skill_listing", content="- vercel:deploy: Deploy it\n- people: who\n"),
    att("deferred_tools_delta", addedLines=["mcp__chart__bar", "WebFetch"]),
    {"type": "assistant", "message": {"usage": {"input_tokens": 10, "cache_creation_input_tokens": 3000, "cache_read_input_tokens": 0}}},
    {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Skill", "input": {"skill": "vercel:deploy"}},
        {"type": "tool_use", "name": "mcp__plugin_playwright_playwright__browser_click", "input": {}},
        {"type": "tool_use", "name": "Bash", "input": {}},
    ]}},
]
session.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
(root / "settings.json").write_text(json.dumps({"enabledPlugins": {
    "vercel@official": True, "playwright@official": True, "expo@official": True}}))

out = cb.budget(session)
src = out["sources"]
check("first turn total is the exact usage sum", out["first_turn_tokens"] == 3010)
check("instruction file attributed by path", src.get("file /tmp/CLAUDE.md") == 1000)
check("hook content attributed by command", src.get("hook session-context.sh") == 100)
check("additional context labelled by its first line", any(k.startswith("hook context: # $CMEM") for k in src))
check("prefixed skill grouped by plugin", "skills vercel" in src)
check("unprefixed skill grouped together", "skills (unprefixed skills)" in src)
check("mcp tool grouped by server", "tools mcp:chart" in src)
check("residual is usage minus attributed", out["residual_tokens_est"] == 3010 - out["attributed_tokens_est"])
check("a transcript with instructions is a main session", cb.is_main_session(cb.rows(session)))

use = {r["plugin"]: r for r in cb.usage(10)["plugins"]}
check("skill call counted for its plugin", use["vercel"]["skill_calls"] == 1)
check("plugin mcp call counted for its plugin", use["playwright"]["mcp_calls"] == 1)
check("unused plugin shows zero", use["expo"]["skill_calls"] + use["expo"]["mcp_calls"] == 0)

sys.exit(1 if failed else 0)
