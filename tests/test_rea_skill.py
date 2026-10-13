"""The reverse-engineering skill is an operator's guide that names real REA
tools. On 2026-10-12 three runs failed because they drove REA's CLI, which keeps
nothing between commands, and a UX study skipped REA because "the CLI isn't on
PATH" while the MCP was registered. The skill must route each question to an
MCP tool with a measured time, and every tool it names must exist in the pinned
REA, so a rename upstream fails here instead of in an agent's session."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "reverse-engineering" / "SKILL.md"
PIN = re.search(r'^PIN = .*"(\d+\.\d+\.\d+)"\)?$', (ROOT / "tools" / "rea_kit.py").read_text(), re.M).group(1)
SCRIPT = Path.home() / ".chewbacca" / "rea" / "pkg" / PIN / "node_modules" / "rea-agents" / "scripts" / "rea.mjs"

# The routes a session needs: inventory, scoped trace, semantic trace, paging,
# a live click, a live bundle, and native string-to-function.
CORE = ("analyze_javascript_application", "trace_application_feature", "trace_javascript_semantics",
        "inspect_analysis_view", "capture_browser_scenario", "analyze_web_bundle", "open_binary",
        "trace_feature")
# Native tools that exist only inside an MCP session (an open binary), so the
# CLI manifest never lists them. Seen in the live tool list on 2026-10-13.
SESSION_ONLY = {"open_binary", "close_binary", "trace_feature", "search_procedures", "analyze_function",
                "procedure_pseudo_code", "binary_session"}


def main() -> int:
    text = SKILL.read_text()
    missing = [t for t in CORE if "`%s`" % t not in text]
    assert not missing, "skill doesn't route to %s" % missing

    rows = [l for l in text.splitlines() if l.startswith("| ") and not l.startswith("| Question")
            and not l.startswith("| ---")]
    assert len(rows) >= 6, "the routing table has %d rows" % len(rows)
    untimed = [r[:60] for r in rows if not re.search(r"\d+(\.\d+)? ?(s|min)\b|not timed", r)]
    assert not untimed, "rows without a measured time: %s" % untimed

    for need in ('detail: "summary"', "record-and-continue", "headless: true", "parent_evidence_id"):
        assert need in text, "skill never says %s" % need

    named = set(re.findall(r"`([a-z]+(?:_[a-z]+)+)`", text))
    tools = {n for n in named if n in CORE or n in SESSION_ONLY or "_" in n and n.split("_")[0] in
             ("analyze", "trace", "inspect", "capture", "list", "open", "close", "search", "procedure", "compare")}
    if SCRIPT.exists():
        out = subprocess.run(["node", str(SCRIPT), "--llms"], capture_output=True, text=True, timeout=60).stdout
        manifest = {c.replace("-", "_") for c in re.findall(r"^\| `rea ([a-z-]+)", out, re.M)}
        assert len(manifest) > 50, "REA manifest unreadable (%d commands)" % len(manifest)
        unknown = sorted(t for t in tools if t not in manifest and t not in SESSION_ONLY)
        assert not unknown, "skill names tools REA %s doesn't have: %s" % (PIN, unknown)
        checked = "checked against REA %s" % PIN
    else:
        checked = "REA not installed, names unchecked"
    print("reverse-engineering skill: %d routes, all timed, %d tool names %s" % (len(rows), len(tools), checked))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
