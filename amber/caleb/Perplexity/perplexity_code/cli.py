from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path

import requests

from .hooks import ON_ERROR, POST_TOOL, PRE_TOOL, get_hooks, load_project_hook_config
from .logging_hook import log_tool_activity
from .session_store import load_session, save_current, save_snapshot, list_sessions
from .rules_engine import build_rules_prompt
from .command_registry import load_command_registry, get_command_prompt, list_commands_with_descriptions
from .discovery import sonar_search, discover_repos, discover_docs, compare_options, fetch_url_content
from .router import route_task, classify_task, should_use_discovery, check_shell_safety, RoutingBenchmark
from .source_registry import (
    init_default_sources, list_sources, add_source, remove_source,
    scan_all_sources, list_staged, apply_staged,
)
from .github_integration import build_github_context, gh_available
from .session_intelligence import get_repo_snapshot, TaskTracker, build_resume_context, smart_suggestions
from .hooks_extended import register_extended_hooks, POST_EDIT, POST_COMMAND, QUALITY_GATE, SESSION_END, CommandTimer
from .parallel_agents import ParallelAgentPool
from .context_manager import build_repo_map, build_smart_context, rank_files_for_task
from .lsp_integration import get_all_diagnostics, format_diagnostics, diagnostics_as_context
from .sandbox import SandboxManager
from .git_first import AutoCommitManager
from .ollama import chat_for_agent as ollama_chat, is_available as ollama_is_available, list_models as ollama_list_models
from .cost_tracker import CostTracker
from .streaming import stream_perplexity

def _load_dotenv() -> None:
    """Load .env from cwd if it exists. No dependency required."""
    env_path = Path.cwd() / ".env"
    if not env_path.is_file():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        pass

_load_dotenv()

API_URL = os.getenv("PERPLEXITY_API_URL", "https://api.perplexity.ai/chat/completions")
MODEL = os.getenv("PERPLEXITY_MODEL", "sonar-reasoning-pro")

VALID_MODES = {"ask", "plan", "acceptEdits"}
CURRENT_MODE = "ask"
LOADED_HOOK_CONFIG: list[dict] = []
COST_TRACKER = CostTracker()
STREAMING_ENABLED = os.getenv("PERPLEXITY_STREAM", "1") != "0"
RECENT_FILES = deque(maxlen=16)
SESSION_SUMMARY: list[str] = []
CONTEXT_BUDGET = int(os.getenv("PERPLEXITY_CONTEXT_BUDGET", "24"))
TASK_TRACKER = TaskTracker()
COMMAND_REGISTRY: dict = {}
CURRENT_WORKFLOW: str | None = None
ROUTING_BENCH: RoutingBenchmark | None = None
AGENT_POOL = ParallelAgentPool(max_concurrent=4)
SANDBOX = SandboxManager()
AUTOCOMMIT = AutoCommitManager()


def detect_repo_profile() -> list[str]:
    """Auto-detect repo type from real files present, return actual file paths for rules matching."""
    root = get_project_root()
    real_files: list[str] = []

    # Find real source files (not node_modules, .git, etc)
    skip_dirs = {".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "build", ".perplexity"}
    extensions = {".ts", ".tsx", ".js", ".jsx", ".py", ".css", ".html", ".sql", ".md"}

    try:
        for dirpath, dirnames, filenames in os.walk(root):
            # Prune skipped directories
            dirnames[:] = [d for d in dirnames if d not in skip_dirs]
            rel_dir = os.path.relpath(dirpath, root)
            depth = rel_dir.count(os.sep)
            if depth > 3:
                dirnames[:] = []
                continue
            for f in filenames[:50]:  # Cap per directory
                _, ext = os.path.splitext(f)
                if ext in extensions:
                    rel_path = os.path.join(rel_dir, f) if rel_dir != "." else f
                    real_files.append(rel_path)
                if len(real_files) >= 50:
                    break
            if len(real_files) >= 50:
                break
    except Exception:
        pass

    return real_files

WORKFLOW_PREFIXES = {
    "/debug": "Workflow: debug. Inspect local files first, isolate the root cause, propose the smallest reliable fix, and explain why it works.",
    "/refactor": "Workflow: refactor. Focus on structure, clarity, maintainability, and preserving behavior.",
    "/test": "Workflow: test. Focus on adding or improving local tests, smoke checks, and validation steps.",
    "/explain": "Workflow: explain. Focus on explaining the local codebase using only inspected files.",
}

BUILTIN_COMMANDS = {
    "help",
    "commands",
    "exit",
    "reset",
    "save",
    "sessions",
    "resume",
    "context",
    "plan",
    "mode",
    "memory",
    "hooks",
    "recent",
    "debug",
    "refactor",
    "test",
    "explain",
    "discover",
    "search",
    "compare",
    "docs",
    "fetch",
    "sources",
    "staged",
    "gate",
    "tasks",
    "route",
    "github",
    "stats",
    "scaffold",
    "parallel",
    "map",
    "diagnostics",
    "sandbox",
    "autocommit",
    "ollama",
}

SYSTEM_PROMPT = """You are Perplexity Code, a local coding agent.

You work in the user's current directory and can choose exactly one action at a time.
Always respond with ONLY a JSON object. No markdown. No prose outside JSON.

Valid action shapes:

{"type":"answer","message":"final answer to the user"}
{"type":"plan","message":"step-by-step plan description"}
{"type":"list_dir","path":"."}
{"type":"read_file","path":"relative/or/absolute/path"}
{"type":"run_shell","command":"ls -la"}
{"type":"write_file","path":"file.py","content":"full new file contents"}
{"type":"write_patch","path":"file.py","find":"exact old snippet","replace":"exact new snippet"}

Rules:
- Prefer inspecting local files before making claims.
- Prefer write_patch over write_file for focused edits.
- Use read_file before editing a file unless the user explicitly gives the full desired contents.
- Keep paths relative when possible.
- For write_file, return the FULL final contents of the file.
- Never output anything except valid JSON.
- Do not reference Claude, Claude Code, ~/.claude, .claude, or external competing tools.
- Do not cite websites, docs, or URLs.
- Work only from local files, tool results, and explicit user instructions.
"""

PLAN_SYSTEM_PROMPT = """You are Perplexity Code in planning mode.

Return ONLY a JSON object of the form:
{"type":"plan","message":"numbered step-by-step plan"}

Rules:
- Do not reference Claude, Claude Code, ~/.claude, or .claude.
- Only propose repository-local steps.
- Do not propose write_file or run_shell actions.
- No citations, no URLs, no markdown fences.
"""

_USE_COLOR = hasattr(sys.stdout, "isatty") and sys.stdout.isatty()

def color(text: str, code: str) -> str:
    if not _USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"

def info(msg: str) -> None:
    print(color(msg, "36"))

def warn(msg: str) -> None:
    print(color(msg, "33"))

def good(msg: str) -> None:
    print(color(msg, "32"))

def err(msg: str) -> None:
    print(color(msg, "31"), file=sys.stderr)

def get_project_root() -> Path:
    return Path.cwd()

def register_recent_file(path: str) -> None:
    if path:
        RECENT_FILES.append(path)

def load_project_memory() -> str:
    p = get_project_root() / "PERPLEXITY.md"
    if p.exists() and p.is_file():
        try:
            return p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return p.read_text(errors="replace")
    return ""

def get_git_status_short() -> str:
    try:
        proc = subprocess.run(
            ["git", "status", "--short"],
            cwd=str(get_project_root()),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
    except Exception:
        pass
    return ""

def compact_history_item(item: dict) -> str:
    role = item.get("role", "unknown")
    content = str(item.get("content", "")).replace("\n", " ").strip()
    if len(content) > 220:
        content = content[:220] + "..."
    return f"{role}: {content}"

def prune_history(history: list[dict]) -> None:
    while len(history) > CONTEXT_BUDGET:
        old = history.pop(0)
        SESSION_SUMMARY.append(compact_history_item(old))
    if len(SESSION_SUMMARY) > 60:
        del SESSION_SUMMARY[:-60]

def build_system_prompt(workflow: str | None = None, command: str | None = None) -> str:
    blocks = [SYSTEM_PROMPT]
    memory = load_project_memory().strip()
    if memory:
        blocks.append("Project Memory from PERPLEXITY.md:\n" + memory)
    git_status = get_git_status_short()
    if git_status:
        blocks.append("Current git status:\n" + git_status)

    # Active rules injection (file-type, workflow, command aware)
    # Combine recent files with auto-detected repo profile
    active_files = list(RECENT_FILES)
    repo_profile = detect_repo_profile()
    if repo_profile and not active_files:
        active_files = repo_profile
    rules_prompt = build_rules_prompt(
        get_project_root(),
        active_files=active_files,
        workflow=workflow or CURRENT_WORKFLOW,
        command=command,
    )
    if rules_prompt:
        blocks.append(rules_prompt)

    # GitHub context
    gh_context = build_github_context()
    if gh_context:
        blocks.append("GitHub context:\n" + gh_context)

    # LSP diagnostics (current code errors)
    lsp_context = diagnostics_as_context(get_project_root())
    if lsp_context:
        blocks.append(lsp_context)

    if RECENT_FILES:
        blocks.append("Recent files:\n" + "\n".join(f"- {p}" for p in RECENT_FILES))

    # Task lineage
    task_summary = TASK_TRACKER.get_summary()
    if task_summary and "No tasks" not in task_summary:
        blocks.append(task_summary)

    if SESSION_SUMMARY:
        blocks.append("Compressed session summary:\n" + "\n".join(f"- {x}" for x in SESSION_SUMMARY[-20:]))
    return "\n\n".join(blocks)

def build_plan_system_prompt() -> str:
    memory = load_project_memory().strip()
    if memory:
        return PLAN_SYSTEM_PROMPT + "\n\nProject Memory from PERPLEXITY.md:\n" + memory
    return PLAN_SYSTEM_PROMPT

def load_perplexity_commands() -> dict[str, str]:
    command_dir = get_project_root() / ".perplexity" / "commands"
    commands: dict[str, str] = {}
    if not command_dir.exists():
        return commands

    for pattern in ("*.md", "*.txt"):
        for path in sorted(command_dir.glob(pattern)):
            try:
                content = path.read_text(encoding="utf-8").strip()
            except UnicodeDecodeError:
                content = path.read_text(errors="replace").strip()
            if content:
                commands[path.stem] = content

    return commands

def split_dynamic_commands() -> tuple[list[str], list[str]]:
    commands = load_perplexity_commands()
    available = sorted([name for name in commands if name not in BUILTIN_COMMANDS])
    shadowed = sorted([name for name in commands if name in BUILTIN_COMMANDS])
    return available, shadowed


def list_perplexity_commands() -> list[str]:
    available, _shadowed = split_dynamic_commands()
    return available

def extract_json(text: str):
    """Extract a JSON action from model output. Must never crash."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    # Try direct parse first
    try:
        return json.loads(text)
    except Exception:
        pass

    # Try to find a valid JSON object using brace-matching
    start = text.find("{")
    if start != -1:
        # Fast approach: find matching closing brace by counting depth
        depth = 0
        in_string = False
        escape_next = False
        for i in range(start, len(text)):
            c = text[i]
            if escape_next:
                escape_next = False
                continue
            if c == "\\":
                escape_next = True
                continue
            if c == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break

    # If all parsing fails, try to extract key fields with regex
    type_match = re.search(r'"type"\s*:\s*"(\w+)"', text)
    msg_match = re.search(r'"message"\s*:\s*"([^"]*)"', text)
    path_match = re.search(r'"path"\s*:\s*"([^"]*)"', text)

    if type_match:
        result: dict = {"type": type_match.group(1)}
        if msg_match:
            result["message"] = msg_match.group(1)
        if path_match:
            result["path"] = path_match.group(1)
        return result

    # Absolute fallback: treat entire text as an answer
    return {"type": "answer", "message": text}

def detect_hallucination_in_answer(message: str) -> tuple[bool, str]:
    if re.search(r"\[\d+\]", message):
        return True, "Answer contains citation brackets like [1][2]"
    if re.search(r"according to the (documentation|docs)", message, re.IGNORECASE):
        return True, "Answer claims to have read documentation"
    if re.search(r"Claude Code|~/.claude|\.claude", message, re.IGNORECASE):
        return True, "Answer references external competing tool concepts"
    return False, ""

def call_perplexity(messages, model_override: str | None = None, search_enabled: bool = False, api_surface: str = "sonar"):
    """Route to the correct backend: Ollama (free), Sonar (paid), or Agent API (paid).

    api_surface:
        "ollama" -> local Ollama inference (free, no search)
        "sonar"  -> POST /chat/completions (paid, search-capable)
        "agent"  -> POST /v1/agent (paid, third-party models)
    """
    active_model = model_override or MODEL

    # Check if this model should go to Ollama
    from .router import MODEL_REGISTRY
    model_info = MODEL_REGISTRY.get(active_model, {})
    actual_api = model_info.get("api", api_surface)

    # Ollama route: free local inference
    if actual_api == "ollama" or api_surface == "ollama":
        if ollama_is_available():
            try:
                return ollama_chat(messages, model=active_model)
            except Exception:
                # Ollama failed mid-request, fall back to Sonar
                pass
        # Fall through to Sonar if Ollama unavailable or failed
        active_model = os.getenv("PERPLEXITY_MODEL", "sonar-reasoning-pro")
        actual_api = "sonar"

    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        raise RuntimeError("PERPLEXITY_API_KEY is not set. Set it or start Ollama for free local inference.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Agent API route: third-party models
    if actual_api == "agent":
        return _call_agent_api(messages, active_model, headers)

    # Sonar route: default
    return _call_sonar_api(messages, active_model, headers, search_enabled)


def _call_sonar_api(messages, model: str, headers: dict, search_enabled: bool) -> str:
    """Call the Sonar chat completions endpoint."""
    schema = {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": ["answer", "plan", "list_dir", "read_file", "run_shell", "write_file", "write_patch"]},
            "message": {"type": "string"},
            "path": {"type": "string"},
            "command": {"type": "string"},
            "content": {"type": "string"},
            "find": {"type": "string"},
            "replace": {"type": "string"},
        },
        "required": ["type"],
        "additionalProperties": False,
    }

    payload: dict = {
        "model": model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"schema": schema},
        },
    }

    if not search_enabled:
        payload["disable_search"] = True

    last_error = None
    for attempt in range(3):
        try:
            resp = requests.post(API_URL, headers=headers, json=payload, timeout=180)
            resp.raise_for_status()
            data = resp.json()

            usage = data.get("usage", {})
            if usage:
                COST_TRACKER.record(usage, model)

            return data["choices"][0]["message"]["content"]
        except (requests.ConnectionError, requests.Timeout) as e:
            last_error = e
            if attempt < 2:
                wait = 2 ** attempt
                warn(f"[retry] {type(e).__name__}, retrying in {wait}s...")
                time.sleep(wait)
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (429, 500, 502, 503, 504):
                last_error = e
                if attempt < 2:
                    wait = 2 ** attempt
                    warn(f"[retry] HTTP {e.response.status_code}, retrying in {wait}s...")
                    time.sleep(wait)
                continue
            raise
    raise last_error  # type: ignore[misc]


def _call_agent_api(messages, model: str, headers: dict) -> str:
    """Call the Agent API endpoint for third-party models.

    Translates messages format to Agent API input format,
    then translates response back to expected JSON action format.
    """
    # Convert messages to single input string for Agent API
    system_parts = []
    user_parts = []
    for msg in messages:
        if msg["role"] == "system":
            system_parts.append(msg["content"])
        else:
            user_parts.append(msg["content"])

    instructions = "\n\n".join(system_parts) if system_parts else ""
    user_input = "\n\n".join(user_parts)

    payload: dict = {
        "model": model,
        "input": user_input,
    }
    if instructions:
        payload["instructions"] = instructions

    agent_url = "https://api.perplexity.ai/v1/agent"
    resp = requests.post(agent_url, headers=headers, json=payload, timeout=180)
    resp.raise_for_status()
    data = resp.json()

    # Parse Agent API response: output[].content[].text
    text = ""
    for item in data.get("output", []):
        if item.get("type") == "message":
            for block in item.get("content", []):
                if block.get("type") == "output_text":
                    text += block.get("text", "")

    return text

def safe_path(path_str: str) -> Path:
    p = Path(path_str).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    resolved = p.resolve()
    # Block relative path traversal outside project root
    # Absolute paths and ~ paths are allowed (model may reference system files)
    # but relative paths like "../../etc/passwd" are blocked
    if not Path(path_str).is_absolute() and not path_str.startswith("~"):
        project_root = Path.cwd().resolve()
        try:
            resolved.relative_to(project_root)
        except ValueError:
            raise ValueError(f"Path traversal blocked: {path_str} resolves outside project root")
    return resolved

def tool_list_dir(path: str) -> str:
    root = safe_path(path)
    if not root.exists():
        return f"Path does not exist: {root}"
    if root.is_file():
        return f"{root} is a file, not a directory."

    lines = [f"Listing for {root}"]
    max_entries = 250
    count = 0

    for current_root, dirs, files in os.walk(root):
        rel = Path(current_root).relative_to(root)
        depth = len(rel.parts)
        if depth > 2:
            dirs[:] = []
            continue
        indent = "  " * depth
        lines.append(f"{indent}{Path(current_root).name}/")
        for d in sorted(dirs)[:50]:
            lines.append(f"{indent}  {d}/")
            count += 1
        for f in sorted(files)[:80]:
            lines.append(f"{indent}  {f}")
            count += 1
        if count > max_entries:
            lines.append("... truncated ...")
            break

    return "\n".join(lines)

def tool_read_file(path: str) -> str:
    p = safe_path(path)
    register_recent_file(path)
    if not p.exists():
        return f"File does not exist: {p}"
    if p.is_dir():
        return f"Path is a directory, not a file: {p}"
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = p.read_text(errors="replace")
    if len(text) > 24000:
        text = text[:24000] + "\n... truncated ..."
    return f"FILE: {p}\n\n{text}"

def tool_run_shell(command: str) -> str:
    return SANDBOX.execute(command, str(Path.cwd()))

def generate_diff(old_content: str, new_content: str, path: str, max_lines: int = 140) -> str:
    diff_lines = list(
        difflib.unified_diff(
            old_content.splitlines(),
            new_content.splitlines(),
            fromfile=f"{path} (old)",
            tofile=f"{path} (new)",
            lineterm="",
        )
    )
    if len(diff_lines) > max_lines:
        diff_lines = diff_lines[:max_lines] + ["... diff truncated ..."]
    return "\n".join(diff_lines)

def tool_write_file(path: str, content: str) -> str:
    p = safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    register_recent_file(path)
    return f"Wrote {len(content)} characters to {p}"

def apply_patch_edit(path: str, find: str, replace: str) -> tuple[str | None, str | None, str | None]:
    p = safe_path(path)
    register_recent_file(path)
    if not p.exists() or p.is_dir():
        return None, None, f"Patch target does not exist as a file: {p}"
    try:
        old = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        old = p.read_text(errors="replace")

    if find not in old:
        return None, None, "Patch failed: exact 'find' snippet was not found."

    new = old.replace(find, replace, 1)
    diff = generate_diff(old, new, path)
    return new, diff, None

def confirm(prompt: str) -> bool:
    reply = input(color(prompt + " [y/N]: ", "35")).strip().lower()
    return reply in {"y", "yes"}

def persist_state(history: list[dict]) -> None:
    save_current(get_project_root(), history, CURRENT_MODE, list(RECENT_FILES), SESSION_SUMMARY)


def persist_full_state(history: list[dict]) -> None:
    """Save full state including task tracker and repo snapshot."""
    from .session_store import get_sessions_dir
    import json as _json
    state = {
        "saved_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "mode": CURRENT_MODE,
        "recent_files": list(RECENT_FILES),
        "summary": list(SESSION_SUMMARY),
        "history": history,
        "tasks": TASK_TRACKER.to_dict(),
        "repo_snapshot": get_repo_snapshot(),
    }
    path = get_sessions_dir(get_project_root()) / "current.json"
    path.write_text(_json.dumps(state, indent=2), encoding="utf-8")

_spinner_active = False
_spinner_thread: threading.Thread | None = None

def _show_spinner_start() -> None:
    global _spinner_active, _spinner_thread
    _spinner_active = True
    def spin():
        frames = ["|", "/", "-", "\\"]
        i = 0
        while _spinner_active:
            sys.stdout.write(f"\r  {frames[i % 4]} thinking...")
            sys.stdout.flush()
            i += 1
            time.sleep(0.15)
        sys.stdout.write("\r\033[K")
        sys.stdout.flush()
    _spinner_thread = threading.Thread(target=spin, daemon=True)
    _spinner_thread.start()

def _show_spinner_stop() -> None:
    global _spinner_active, _spinner_thread
    _spinner_active = False
    if _spinner_thread:
        _spinner_thread.join(timeout=1)
        _spinner_thread = None


def run_plan(task: str):
    messages = [
        {"role": "system", "content": build_plan_system_prompt()},
        {"role": "user", "content": f"Current working directory: {Path.cwd()}\nCurrent mode: {CURRENT_MODE}\n\nTask: {task}"},
    ]
    raw = call_perplexity(messages)
    action = extract_json(raw)
    print()
    print(action.get("message", "Could not generate plan.").strip())
    print()

def run_agent(user_task: str, history, command: str | None = None):
    global CURRENT_MODE

    # Route to optimal model
    route = route_task(user_task, command=command)
    active_model = route["model"]
    search_on = route["search_enabled"]

    # Track task
    task_id = TASK_TRACKER.start_task(user_task[:200], task_type=route["task_type"])

    history.append({
        "role": "user",
        "content": f"Current working directory: {Path.cwd()}\nCurrent mode: {CURRENT_MODE}\n\nUser request: {user_task}",
    })
    prune_history(history)
    persist_state(history)

    timer = CommandTimer()
    timer.__enter__()

    for _ in range(16):
        if STREAMING_ENABLED:
            _show_spinner_start()
        raw = call_perplexity(
            [{"role": "system", "content": build_system_prompt(command=command)}] + history,
            model_override=active_model,
            search_enabled=search_on,
            api_surface=route.get("api", "sonar"),
        )
        if STREAMING_ENABLED:
            _show_spinner_stop()
        action = extract_json(raw)
        action_type = action.get("type")
        history.append({"role": "assistant", "content": json.dumps(action)})
        prune_history(history)

        if action_type == "answer":
            message = action.get("message", "").strip()
            bad, reason = detect_hallucination_in_answer(message)
            if bad:
                warn(f"\n[hallucination detected] {reason}")
                history.append({"role": "user", "content": f"HALLUCINATION DETECTED: {reason}. Re-answer using only inspected local files."})
                prune_history(history)
                persist_state(history)
                continue
            print()
            print(message)
            print()
            TASK_TRACKER.complete_task(task_id)
            timer.__exit__(None, None, None)
            get_hooks().trigger(POST_COMMAND, command=command or "agent", duration=timer.duration)
            if ROUTING_BENCH:
                ROUTING_BENCH.record(
                    task_type=route["task_type"],
                    model=active_model,
                    duration_ms=round(timer.duration * 1000),
                    success=True,
                )
            persist_state(history)
            return

        if action_type == "plan":
            print()
            print(action.get("message", "").strip())
            print()
            TASK_TRACKER.complete_task(task_id)
            timer.__exit__(None, None, None)
            persist_state(history)
            return

        if action_type == "list_dir":
            path = action.get("path", ".")
            info(f"\n[list_dir] {path}")
            get_hooks().trigger(PRE_TOOL, action_type="list_dir", path=path)
            result = tool_list_dir(path)
            get_hooks().trigger(POST_TOOL, action_type="list_dir", path=path, result=result)
            TASK_TRACKER.record_tool_use(task_id, "list_dir", path)

        elif action_type == "read_file":
            path = action.get("path", "")
            info(f"\n[read_file] {path}")
            get_hooks().trigger(PRE_TOOL, action_type="read_file", path=path)
            result = tool_read_file(path)
            get_hooks().trigger(POST_TOOL, action_type="read_file", path=path, result=result)
            TASK_TRACKER.record_tool_use(task_id, "read_file", path)

        elif action_type == "run_shell":
            command = action.get("command", "")
            if CURRENT_MODE == "plan":
                warn("Plan mode is read-only. run_shell is blocked.")
                result = "Blocked: plan mode is read-only."
            else:
                # Shell safety check
                safety, safety_reason = check_shell_safety(command)
                if safety == "block":
                    err(f"\n[BLOCKED] {safety_reason}")
                    result = f"Blocked by shell safety: {safety_reason}"
                elif safety == "warn":
                    warn(f"\n[SAFETY WARNING] {safety_reason}")
                    info(f"[run_shell] {command}")
                    get_hooks().trigger(PRE_TOOL, action_type="run_shell", command=command)
                    if not confirm("This command is potentially destructive. Run anyway?"):
                        result = "User denied dangerous shell command."
                    else:
                        result = SANDBOX.execute(command, str(Path.cwd()))
                    get_hooks().trigger(POST_TOOL, action_type="run_shell", command=command, result=result)
                else:
                    info(f"\n[run_shell] {command}")
                    get_hooks().trigger(PRE_TOOL, action_type="run_shell", command=command)
                    if not confirm("Run this shell command?"):
                        result = "User denied shell command."
                    else:
                        result = SANDBOX.execute(command, str(Path.cwd()))
                    get_hooks().trigger(POST_TOOL, action_type="run_shell", command=command, result=result)
            TASK_TRACKER.record_tool_use(task_id, "run_shell")

        elif action_type == "write_patch":
            path = action.get("path", "")
            find = action.get("find", "")
            replace = action.get("replace", "")
            if CURRENT_MODE == "plan":
                warn("Plan mode is read-only. write_patch is blocked.")
                result = "Blocked: plan mode is read-only."
            else:
                info(f"\n[write_patch] {path}")
                get_hooks().trigger(PRE_TOOL, action_type="write_patch", path=path, content_length=len(replace))
                if not find:
                    result = "Patch failed: missing 'find' content."
                else:
                    new_content, diff, patch_error = apply_patch_edit(path, find, replace)
                    if patch_error:
                        result = patch_error
                    else:
                        print(color("----- diff preview -----", "90"))
                        print(diff)
                        print(color("------------------------", "90"))
                        if CURRENT_MODE == "acceptEdits" or confirm(f"Apply patch to {path}?"):
                            result = tool_write_file(path, new_content)
                            AUTOCOMMIT.track_file(path)
                            commit_msg = AUTOCOMMIT.commit_if_enabled("write_patch", path, str(Path.cwd()))
                            if commit_msg:
                                good(f"  [auto-commit] {commit_msg}")
                        else:
                            result = "User denied patch apply."
                get_hooks().trigger(POST_TOOL, action_type="write_patch", path=path, result=result)

        elif action_type == "write_file":
            path = action.get("path", "")
            content = action.get("content", "")
            if CURRENT_MODE == "plan":
                warn("Plan mode is read-only. write_file is blocked.")
                result = "Blocked: plan mode is read-only."
            else:
                info(f"\n[write_file] {path}")
                get_hooks().trigger(PRE_TOOL, action_type="write_file", path=path, content_length=len(content))
                target = safe_path(path)
                if target.exists() and target.is_file():
                    try:
                        old_content = target.read_text(encoding="utf-8")
                    except UnicodeDecodeError:
                        old_content = target.read_text(errors="replace")
                    diff = generate_diff(old_content, content, path)
                    print(color("----- diff preview -----", "90"))
                    print(diff)
                    print(color("------------------------", "90"))
                else:
                    preview = content[:1200]
                    print(color("----- file preview -----", "90"))
                    print(preview)
                    if len(content) > 1200:
                        print(color("... preview truncated ...", "90"))
                    print(color("------------------------", "90"))

                if CURRENT_MODE == "acceptEdits" or confirm(f"Write file {path}?"):
                    result = tool_write_file(path, content)
                    AUTOCOMMIT.track_file(path)
                    commit_msg = AUTOCOMMIT.commit_if_enabled("write_file", path, str(Path.cwd()))
                    if commit_msg:
                        good(f"  [auto-commit] {commit_msg}")
                else:
                    result = "User denied file write."
                get_hooks().trigger(POST_TOOL, action_type="write_file", path=path, result=result)

        else:
            result = f"Unknown action type: {action_type}"

        history.append({"role": "user", "content": f"TOOL RESULT:\n{result}"})
        prune_history(history)
        persist_state(history)

    warn("Stopped after 16 tool steps.")
    TASK_TRACKER.fail_task(task_id, "exceeded 16 tool steps")
    timer.__exit__(None, None, None)
    persist_state(history)

def restore_state(history: list[dict], state: dict) -> None:
    global CURRENT_MODE
    history.clear()
    history.extend(state.get("history", []))
    CURRENT_MODE = state.get("mode", "ask")
    RECENT_FILES.clear()
    for item in state.get("recent_files", []):
        RECENT_FILES.append(item)
    SESSION_SUMMARY.clear()
    SESSION_SUMMARY.extend(state.get("summary", []))

def repl(initial_task=None):
    global CURRENT_MODE, SESSION_SUMMARY, MODEL
    history: list[dict] = []
    from . import __version__
    print(color(f"perplexity-code v{__version__}", "1;36"))
    print("Workflows: /plan /debug /refactor /test /explain /parallel")
    print("Discovery: /discover /search /compare /docs /fetch /scaffold")
    print("System:    /map /diagnostics /gate /sandbox /autocommit /stats")
    print("Session:   /save /resume /tasks /context   |   /help for all commands")
    if initial_task:
        run_agent(initial_task, history)

    while True:
        try:
            user_task = input(color("pc> ", "1;34")).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            if history:
                save_snapshot(get_project_root(), history, CURRENT_MODE, list(RECENT_FILES), SESSION_SUMMARY)
            break

        if not user_task:
            continue

        if user_task == "/help":
            print()
            from . import __version__
            print(f"Perplexity Code v{__version__}")
            print()
            print("Session:")
            print("  /help  /commands  /exit  /reset")
            print("  /save  /sessions  /resume [target]  /context")
            print()
            print("Config:")
            print("  /mode [ask|plan|acceptEdits]   Permission mode")
            print("  /model [name]                  Show/switch model")
            print("  /memory                        Show PERPLEXITY.md")
            print("  /hooks                         Show active hooks")
            print("  /recent                        Recent files")
            print("  /cost                          Token usage and cost")
            print()
            print("Workflows:")
            print("  /plan <task>      Plan without executing")
            print("  /debug <task>     Debug and fix")
            print("  /refactor <task>  Improve structure")
            print("  /test <task>      Write or improve tests")
            print("  /explain <task>   Explain code")
            print()
            print("Discovery:")
            print("  /discover <query>   Find repos, starters, libraries")
            print("  /search <query>     Web-grounded search via Sonar")
            print("  /compare <A vs B>   Compare options with reasoning")
            print("  /docs <topic>       Find official documentation")
            print("  /fetch <url>        Fetch and read a URL")
            print("  /scaffold <desc>    Find best starter template")
            print()
            print("Tools:")
            print("  /map                Repo file/function map")
            print("  /diagnostics        Run language server checks")
            print("  /gate               Quality gate (tsc, lint, git)")
            print("  /sandbox [on|off]   Sandboxed shell execution")
            print("  /autocommit [on|off] Auto-commit after edits")
            print("  /parallel \"t1\" \"t2\" Run tasks concurrently")
            print()
            print("System:")
            print("  /sources [init|scan] Source registry")
            print("  /staged              Pending ingestion updates")
            print("  /tasks               Task lineage this session")
            print("  /route <query>       Show model routing")
            print("  /github              GitHub context")
            print("  /ollama              Ollama status")
            print("  /stats               Routing performance stats")
            available, shadowed = split_dynamic_commands()
            if available:
                print()
                print("Dynamic command files:")
                for name in available:
                    print(f"  /{name}")
            if shadowed:
                print()
                print("Shadowed dynamic command files (built-ins win):")
                for name in shadowed:
                    print(f"  /{name}")
            print()
            continue

        if user_task == "/commands":
            available, shadowed = split_dynamic_commands()
            print()
            if available:
                print("Perplexity Command Files:")
                for name in available:
                    print(f"  /{name}")
            else:
                print("No dynamic .perplexity/commands files found.")
            if shadowed:
                print()
                print("Shadowed by built-ins:")
                for name in shadowed:
                    print(f"  /{name}")
            print()
            continue

        if user_task == "/exit":
            if history:
                save_snapshot(get_project_root(), history, CURRENT_MODE, list(RECENT_FILES), SESSION_SUMMARY)
            break

        if user_task == "/reset":
            history.clear()
            RECENT_FILES.clear()
            SESSION_SUMMARY.clear()
            good("Session reset.")
            persist_state(history)
            continue

        if user_task == "/save":
            path = save_snapshot(get_project_root(), history, CURRENT_MODE, list(RECENT_FILES), SESSION_SUMMARY)
            good(f"Saved session snapshot: {path.name}")
            continue

        if user_task == "/sessions":
            sessions = list_sessions(get_project_root())
            print()
            if sessions:
                print("Saved sessions:")
                for name in sessions:
                    print(f"  {name}")
            else:
                print("No saved sessions.")
            print()
            continue

        if user_task.startswith("/resume"):
            parts = user_task.split(maxsplit=1)
            target = parts[1].strip() if len(parts) > 1 else "latest"
            try:
                state = load_session(get_project_root(), target)
                restore_state(history, state)

                # Smart resume: show context and suggestions
                resume_ctx = build_resume_context(state, get_project_root())
                print()
                print(color("--- Resume Context ---", "36"))
                print(resume_ctx)

                suggestions = smart_suggestions(state)
                if suggestions:
                    print()
                    print(color("Suggestions:", "33"))
                    for s in suggestions:
                        print(f"  - {s}")

                print(color("--- End Resume ---", "36"))
                print()

                good(f"Resumed session: {target}")
                persist_state(history)
            except Exception as e:
                err(str(e))
            continue

        if user_task == "/context":
            print()
            print(f"Context budget: {CONTEXT_BUDGET}")
            print(f"History messages kept: {len(history)}")
            print(f"Summary items: {len(SESSION_SUMMARY)}")
            print(f"Recent files tracked: {len(RECENT_FILES)}")
            print()
            continue

        try:
            if user_task.startswith("/plan"):
                plan_task = user_task[len("/plan"):].strip()
                if not plan_task:
                    warn("Usage: /plan <task>")
                    continue
                run_plan(plan_task)
                continue

            if user_task == "/mode":
                print()
                print(f"Current mode: {CURRENT_MODE}")
                print()
                continue

            if user_task.startswith("/mode "):
                new_mode = user_task[len("/mode "):].strip()
                if new_mode not in VALID_MODES:
                    warn("Valid modes: ask, plan, acceptEdits")
                    continue
                CURRENT_MODE = new_mode
                good(f"Mode set to: {CURRENT_MODE}")
                persist_state(history)
                continue

            if user_task == "/memory":
                memory = load_project_memory()
                print()
                print(memory if memory else "No PERPLEXITY.md found in the current project root.")
                print()
                continue

            if user_task == "/hooks":
                hooks = get_hooks()
                print()
                print("Perplexity Code Hook Points:")
                print(f"  {PRE_TOOL}: {len(hooks.handlers_for(PRE_TOOL))} handler(s)")
                print(f"  {POST_TOOL}: {len(hooks.handlers_for(POST_TOOL))} handler(s)")
                print(f"  {ON_ERROR}: {len(hooks.handlers_for(ON_ERROR))} handler(s)")
                cfg = get_project_root() / "PERPLEXITY_HOOKS.json"
                if cfg.exists():
                    print(f"  config: {cfg}")
                    print(f"  loaded config hooks: {len(LOADED_HOOK_CONFIG)}")
                print()
                continue

            if user_task == "/recent":
                print()
                if RECENT_FILES:
                    for item in RECENT_FILES:
                        print(f"- {item}")
                else:
                    print("No recent files yet.")
                print()
                continue

            if user_task == "/cost":
                print()
                print(COST_TRACKER.summary())
                print()
                continue

            if user_task == "/model":
                from .router import MODEL_REGISTRY
                print()
                print(f"Current model: {MODEL}")
                print(f"Available Sonar models:")
                for name, info in MODEL_REGISTRY.items():
                    tier = info.get("tier", "")
                    api = info.get("api", "")
                    marker = " (active)" if name == MODEL else ""
                    print(f"  {name} [{api}/{tier}]{marker}")
                if ollama_is_available():
                    print(f"  Ollama (local, free)")
                print()
                continue

            if user_task.startswith("/model "):
                new_model = user_task[len("/model "):].strip()
                from .router import MODEL_REGISTRY
                if new_model in MODEL_REGISTRY or new_model.startswith("ollama/"):
                    MODEL = new_model
                    good(f"Model switched to: {MODEL}")
                else:
                    known = ", ".join(MODEL_REGISTRY.keys())
                    warn(f"Unknown model. Available: {known}")
                continue

            # --- Discovery commands ---
            if user_task == "/discover":
                warn("Usage: /discover <what to build>")
                continue
            if user_task.startswith("/discover "):
                query = user_task[len("/discover "):].strip()
                if query:
                    info("[discover] Searching for repos...")
                    try:
                        repos = discover_repos(query)
                        print()
                        for r in repos[:8]:
                            name = r.get("name", "")
                            url = r.get("url", "")
                            reason = r.get("reason", "")
                            print(f"  {name}")
                            if url:
                                print(f"    {url}")
                            if reason:
                                print(f"    {reason}")
                            print()
                    except Exception as e:
                        err(str(e))
                continue

            if user_task == "/search":
                warn("Usage: /search <query>")
                continue
            if user_task.startswith("/search "):
                query = user_task[len("/search "):].strip()
                if query:
                    info("[search] Sonar search...")
                    try:
                        result = sonar_search(query, stream=STREAMING_ENABLED)
                        if not STREAMING_ENABLED:
                            print()
                            print(result["answer"])
                        else:
                            print()
                        if result.get("citations"):
                            print("\nSources:")
                            for i, c in enumerate(result["citations"][:5], 1):
                                print(f"  {i}. {c}")
                        if result.get("cost"):
                            COST_TRACKER.record({"prompt_tokens": 0, "completion_tokens": 0}, "sonar")
                        print()
                    except Exception as e:
                        err(str(e))
                continue

            if user_task == "/compare":
                warn("Usage: /compare <A vs B>")
                continue
            if user_task.startswith("/compare "):
                query = user_task[len("/compare "):].strip()
                if query:
                    info("[compare] Analyzing options...")
                    try:
                        result = compare_options(query)
                        print()
                        print(result["answer"])
                        print()
                    except Exception as e:
                        err(str(e))
                continue

            if user_task == "/docs":
                warn("Usage: /docs <topic>")
                continue
            if user_task.startswith("/docs "):
                query = user_task[len("/docs "):].strip()
                if query:
                    info("[docs] Finding documentation...")
                    try:
                        result = discover_docs(query)
                        print()
                        print(result["answer"])
                        if result.get("citations"):
                            print("\nReferences:")
                            for i, c in enumerate(result["citations"][:5], 1):
                                print(f"  {i}. {c}")
                        print()
                    except Exception as e:
                        err(str(e))
                continue

            if user_task == "/fetch":
                warn("Usage: /fetch <url>")
                continue
            if user_task.startswith("/fetch "):
                url = user_task[len("/fetch "):].strip()
                if url:
                    info(f"[fetch] {url}")
                    try:
                        content = fetch_url_content(url)
                        print()
                        print(content[:4000])
                        if len(content) > 4000:
                            print("... (truncated)")
                        print()
                    except Exception as e:
                        err(str(e))
                continue

            # --- Source registry commands ---
            if user_task == "/sources":
                sources = list_sources(get_project_root())
                print()
                if sources:
                    print(f"Tracked sources ({len(sources)}):")
                    for s in sources:
                        status = "on" if s.get("enabled", True) else "off"
                        print(f"  [{status}] {s['name']} ({s['category']})")
                        if s.get("description"):
                            print(f"        {s['description']}")
                else:
                    print("No sources tracked. Run /sources init to add defaults.")
                print()
                continue

            if user_task == "/sources init":
                count = init_default_sources(get_project_root())
                good(f"Added {count} default sources to registry.")
                continue

            if user_task == "/sources scan":
                info("[sources] Checking for updates...")
                updates = scan_all_sources(get_project_root())
                if updates:
                    print()
                    for u in updates:
                        print(f"  [update] {u['source']}: {u.get('old_commit', '?')[:8]} -> {u['new_commit'][:8]}")
                    print()
                else:
                    print("All sources up to date.")
                continue

            if user_task == "/staged":
                staged = list_staged(get_project_root())
                print()
                if staged:
                    print(f"Staged updates ({len(staged)}):")
                    for p in staged:
                        print(f"  {p.name}")
                else:
                    print("No staged updates.")
                print()
                continue

            # --- Quality gate ---
            if user_task == "/gate":
                get_hooks().trigger(QUALITY_GATE, project_root=get_project_root())
                continue

            # --- Task tracking ---
            if user_task == "/tasks":
                print()
                print(TASK_TRACKER.get_summary())
                print()
                continue

            # --- Route info ---
            if user_task.startswith("/route "):
                query = user_task[len("/route "):].strip()
                if query:
                    route = route_task(query)
                    is_free = route.get("local", False)
                    cost_label = color("FREE (Ollama)", "32") if is_free else color(f"PAID ({route['cost_tier']})", "33")
                    print()
                    print(f"  Task type: {route['task_type']}")
                    print(f"  Model:     {route['model']}")
                    print(f"  API:       {route['api']}")
                    print(f"  Cost:      {cost_label}")
                    print(f"  Search:    {'enabled' if route['search_enabled'] else 'disabled'}")
                    print(f"  Reason:    {route['reason']}")
                    print()
                continue

            # --- GitHub info ---
            if user_task == "/github":
                ctx = build_github_context()
                print()
                print(ctx if ctx else "No GitHub context available (not in a git repo or gh not installed).")
                print()
                continue

            # --- Routing stats ---
            if user_task == "/stats":
                if ROUTING_BENCH:
                    stats = ROUTING_BENCH.get_stats()
                    print()
                    if stats["total_calls"] == 0:
                        print("No routing data yet. Use the agent to generate stats.")
                    else:
                        print(f"Routing Stats ({stats['total_calls']} calls):")
                        print(f"  Success rate: {stats['success_rate']}%")
                        print(f"  Avg duration: {stats['avg_duration_ms']}ms")
                        print(f"  Estimated cost: ${stats['total_estimated_cost']}")
                        if stats.get("by_task_type"):
                            print()
                            for tt, info in stats["by_task_type"].items():
                                print(f"  {tt}: {info['count']} calls, {info['success_rate']}% success, avg {info['avg_ms']}ms")
                    print()
                else:
                    print("Routing benchmark not initialized.")
                continue

            # --- Scaffold template ---
            if user_task == "/scaffold":
                warn("Usage: /scaffold <project description>")
                continue
            if user_task.startswith("/scaffold "):
                query = user_task[len("/scaffold "):].strip()
                if query:
                    info("[scaffold] Finding best starter template...")
                    try:
                        result = sonar_search(
                            f"Find the best GitHub starter template or scaffold for: {query}. "
                            "Return the exact git clone command and setup steps.",
                            system=(
                                "You are a project scaffold assistant. Find the best starter template "
                                "on GitHub for the user's request. Provide: "
                                "1. The exact git clone command "
                                "2. Setup steps (install, env, etc.) "
                                "3. Why this template is the best choice. "
                                "Be specific and opinionated."
                            ),
                        )
                        print()
                        print(result["answer"])
                        if result.get("citations"):
                            print("\nSources:")
                            for i, c in enumerate(result["citations"][:3], 1):
                                print(f"  {i}. {c}")
                        print()
                    except Exception as e:
                        err(str(e))
                continue

            # --- Ollama status ---
            if user_task == "/ollama":
                print()
                if ollama_is_available():
                    models = ollama_list_models()
                    good(f"Ollama: ONLINE ({len(models)} models)")
                    for m in models:
                        marker = " (active)" if m["name"] == os.getenv("OLLAMA_MODEL", "llama3.1:8b") else ""
                        print(f"  {m['name']} ({m['params']}, {m['size_gb']}GB){marker}")
                    print()
                    print("  Quick and generation tasks route here for free.")
                    print("  Discovery and review always use paid Sonar API.")
                else:
                    warn("Ollama: OFFLINE")
                    print("  All tasks routing to paid Sonar API.")
                    print("  Start Ollama for free local inference: ollama serve")
                print()
                continue

            # --- Parallel agents ---
            if user_task.startswith("/parallel "):
                args = user_task[len("/parallel "):].strip()
                if args == "status":
                    print()
                    print(AGENT_POOL.get_status())
                    print()
                elif args == "results":
                    results = AGENT_POOL.get_results()
                    print()
                    for r in results:
                        status = "[ok]" if r["status"] == "completed" else "[!!]"
                        print(f"  {status} #{r['id']}: {r['description'][:50]}")
                        if r["result"]:
                            for line in r["result"].splitlines()[:5]:
                                print(f"       {line}")
                        if r["error"]:
                            print(f"       Error: {r['error'][:80]}")
                    print()
                elif args == "clear":
                    AGENT_POOL.clear()
                    good("Parallel task pool cleared.")
                else:
                    # Parse quoted tasks: /parallel "task 1" "task 2" "task 3"
                    import shlex
                    try:
                        tasks = shlex.split(args)
                    except ValueError:
                        tasks = args.split('" "')
                        tasks = [t.strip('"') for t in tasks]

                    for desc in tasks:
                        if desc.strip():
                            AGENT_POOL.submit(desc.strip())

                    info(f"[parallel] Submitted {len(tasks)} tasks. Running...")
                    AGENT_POOL.run_all()
                    print()
                    print(AGENT_POOL.get_status())
                    print()
                continue

            # --- Repo map ---
            if user_task == "/map":
                info("[map] Building repository map...")
                repo_map = build_repo_map(get_project_root())
                print()
                print(repo_map if repo_map else "No indexable files found.")
                print()
                continue

            # --- LSP diagnostics ---
            if user_task == "/diagnostics":
                info("[diagnostics] Running language server checks...")
                diags = get_all_diagnostics(get_project_root())
                print()
                print(format_diagnostics(diags))
                print()
                continue

            # --- Sandbox control ---
            if user_task == "/sandbox on":
                result = SANDBOX.enable(get_project_root())
                print(result)
                continue
            if user_task == "/sandbox off":
                print(SANDBOX.disable())
                continue
            if user_task in ("/sandbox", "/sandbox status"):
                print(SANDBOX.status())
                continue

            # --- Auto-commit control ---
            if user_task == "/autocommit on":
                print(AUTOCOMMIT.enable())
                continue
            if user_task == "/autocommit off":
                print(AUTOCOMMIT.disable())
                continue
            if user_task in ("/autocommit", "/autocommit status"):
                print(AUTOCOMMIT.status())
                continue

            # --- Workflow commands ---
            handled_workflow = False
            for cmd, prefix in WORKFLOW_PREFIXES.items():
                if user_task.startswith(cmd + " "):
                    task = user_task[len(cmd):].strip()
                    run_agent(prefix + "\n\nTask: " + task, history, command=cmd.lstrip("/"))
                    handled_workflow = True
                    break
            if handled_workflow:
                continue

            # --- Dynamic commands with metadata ---
            first_token = user_task.split(maxsplit=1)[0]
            if first_token.startswith("/"):
                command_name = first_token[1:]

                # Try command registry first (with metadata)
                if command_name in COMMAND_REGISTRY and command_name not in BUILTIN_COMMANDS:
                    extra = user_task[len(first_token):].strip()
                    prompt, cmd_meta = get_command_prompt(COMMAND_REGISTRY, command_name, extra)
                    if prompt:
                        # Apply command-level mode override
                        old_mode = CURRENT_MODE
                        if cmd_meta.get("mode"):
                            CURRENT_MODE = cmd_meta["mode"]
                        run_agent(prompt, history, command=command_name)
                        CURRENT_MODE = old_mode
                        continue

                # Fallback to basic dynamic commands
                dynamic_commands = load_perplexity_commands()
                if command_name in dynamic_commands and command_name not in BUILTIN_COMMANDS:
                    extra = user_task[len(first_token):].strip()
                    command_prompt = (
                        f"Dynamic command: /{command_name}\n\n"
                        f"Instructions from .perplexity/commands/{command_name}:\n"
                        f"{dynamic_commands[command_name]}"
                    )
                    if extra:
                        command_prompt += f"\n\nUser input:\n{extra}"
                    run_agent(command_prompt, history)
                    continue

            run_agent(user_task, history)

        except requests.HTTPError as e:
            get_hooks().trigger(ON_ERROR, error_type="HTTPError", error_message=str(e), exception=e)
            err(f"HTTP error: {e}")
            if e.response is not None:
                body = e.response.text
                api_key = os.getenv("PERPLEXITY_API_KEY", "")
                if api_key and api_key in body:
                    body = body.replace(api_key, "***REDACTED***")
                err(body[:2000])
            persist_state(history)
        except Exception as e:
            get_hooks().trigger(ON_ERROR, error_type=type(e).__name__, error_message=str(e), exception=e)
            err(str(e))
            persist_state(history)

def main():
    global LOADED_HOOK_CONFIG, COMMAND_REGISTRY, ROUTING_BENCH

    parser = argparse.ArgumentParser()
    from . import __version__
    parser.add_argument("--version", action="version", version=f"perplexity {__version__}")
    parser.add_argument("task", nargs="*", help="Optional initial task")
    args = parser.parse_args()
    initial_task = " ".join(args.task).strip() if args.task else None

    # Initialize hook system
    hooks = get_hooks()
    hooks.on(PRE_TOOL, log_tool_activity)
    hooks.on(POST_TOOL, log_tool_activity)
    hooks.on(ON_ERROR, log_tool_activity)
    register_extended_hooks(hooks)
    LOADED_HOOK_CONFIG = load_project_hook_config(hooks=hooks)

    # Initialize command registry with metadata
    COMMAND_REGISTRY = load_command_registry(get_project_root())

    # Initialize routing benchmark
    ROUTING_BENCH = RoutingBenchmark(get_project_root())

    repl(initial_task=initial_task)

if __name__ == "__main__":
    main()
