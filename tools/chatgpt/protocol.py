from dataclasses import dataclass
from typing import Any, Dict

@dataclass
class ToolCall:
    tool: str
    args: Dict[str, Any]

@dataclass
class ToolResult:
    ok: bool
    output: Any

def dispatch(call: ToolCall) -> ToolResult:
    if call.tool == "shell":
        from subprocess import run

        p = run(
            call.args["command"],
            shell=True,
            capture_output=True,
            text=True,
        )

        return ToolResult(
            ok=p.returncode == 0,
            output={
                "stdout": p.stdout,
                "stderr": p.stderr,
                "exit_code": p.returncode,
            },
        )

    raise ValueError(f"Unknown tool: {call.tool}")
