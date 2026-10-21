"""Model and tool routing layer for Perplexity Code.

Routes tasks to the optimal model based on task type, complexity,
and cost considerations. Never a one-model product.

Routing policy:
- Architecture/complex debugging -> strongest reasoning model
- Ecosystem discovery -> Sonar (search-grounded)
- Large code transforms -> fast cheap model + post-checks
- Repo comparison -> Search API + local reasoning
- Quick edits -> default model

Supports multi-provider routing via Perplexity Agent API.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# Model registry with REAL pricing from Perplexity docs (per 1M tokens)
# Sonar models: POST /chat/completions (search-enabled)
# Agent models: POST /v1/agent (third-party, no search by default)
MODEL_REGISTRY: dict[str, dict[str, Any]] = {
    # Sonar API models (search-native)
    "sonar": {
        "api": "sonar",
        "provider": "perplexity",
        "search": True,
        "cost_input": 1.0,
        "cost_output": 1.0,
        "tier": "fast",
    },
    "sonar-pro": {
        "api": "sonar",
        "provider": "perplexity",
        "search": True,
        "cost_input": 3.0,
        "cost_output": 15.0,
        "tier": "standard",
    },
    "sonar-reasoning-pro": {
        "api": "sonar",
        "provider": "perplexity",
        "search": True,
        "cost_input": 2.0,
        "cost_output": 8.0,
        "tier": "premium",
    },
    # Agent API models (POST /v1/agent, third-party providers)
    "openai/gpt-5.2": {
        "api": "agent",
        "provider": "openai",
        "search": False,
        "cost_input": 0.0,  # transparent pricing, varies
        "cost_output": 0.0,
        "tier": "premium",
    },
    "openai/gpt-5.4": {
        "api": "agent",
        "provider": "openai",
        "search": False,
        "cost_input": 0.0,
        "cost_output": 0.0,
        "tier": "premium",
    },
}

# Task classification patterns
TASK_PATTERNS = {
    "discovery": [
        r"find.*(?:repo|library|package|framework|starter)",
        r"search.*(?:for|how to)",
        r"what.*(?:best|recommended|popular)",
        r"compare.*(?:vs|versus|or|and)",
        r"(?:latest|current|recent).*(?:version|release|update)",
    ],
    "architecture": [
        r"(?:design|architect|structure|organize).*(?:system|app|project|database|schema)",
        r"how.*(?:should|best).*(?:structure|organize|design)",
        r"(?:migration|refactor).*(?:strategy|plan|approach)",
    ],
    "debugging": [
        r"(?:error|bug|crash|fail|broken|wrong|issue)",
        r"(?:fix|debug|troubleshoot|diagnose)",
        r"why.*(?:not working|failing|broken)",
        r"stack.*trace",
    ],
    "generation": [
        r"(?:create|build|write|generate|scaffold|add|implement)",
        r"(?:component|page|route|api|endpoint|hook|function|class)",
    ],
    "review": [
        r"(?:review|audit|check|inspect|analyze)",
        r"(?:security|performance|accessibility|type)",
    ],
    "quick": [
        r"(?:rename|move|delete|copy|format|lint)",
        r"(?:what is|explain|show me|list)",
    ],
}

# Three-tier routing: Ollama (free) -> Sonar (paid) -> Agent API (paid, third-party)
#
# "api" determines which endpoint gets called:
#   "ollama" -> local Ollama (localhost:11434, free, no search)
#   "sonar"  -> POST /chat/completions (paid, search-capable)
#   "agent"  -> POST /v1/agent (paid, third-party models)
#
# "ollama_eligible" means the task CAN run on Ollama if available.
# The router checks Ollama availability at runtime and falls back to Sonar if down.

ROUTING_TABLE: dict[str, dict[str, Any]] = {
    "quick": {
        "model": os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
        "api": "ollama",
        "fallback_model": "sonar",
        "fallback_api": "sonar",
        "search_enabled": False,
        "ollama_eligible": True,
        "reason": "Simple tasks run free on local Ollama",
    },
    "generation": {
        "model": os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
        "api": "ollama",
        "fallback_model": os.getenv("PERPLEXITY_MODEL", "sonar-reasoning-pro"),
        "fallback_api": "sonar",
        "search_enabled": False,
        "ollama_eligible": True,
        "reason": "Code generation tries local first, escalates to Sonar for complex tasks",
    },
    "debugging": {
        "model": os.getenv("PERPLEXITY_MODEL", "sonar-reasoning-pro"),
        "api": "sonar",
        "fallback_model": os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
        "fallback_api": "ollama",
        "search_enabled": False,
        "ollama_eligible": False,
        "reason": "Debugging needs strong reasoning, Sonar first",
    },
    "review": {
        "model": "sonar-reasoning-pro",
        "api": "sonar",
        "fallback_model": None,
        "fallback_api": None,
        "search_enabled": False,
        "ollama_eligible": False,
        "reason": "Review needs careful multi-lens reasoning, always paid",
    },
    "architecture": {
        "model": "sonar-reasoning-pro",
        "api": "sonar",
        "fallback_model": None,
        "fallback_api": None,
        "search_enabled": False,
        "ollama_eligible": False,
        "reason": "Architecture decisions need strongest reasoning",
    },
    "discovery": {
        "model": "sonar-pro",
        "api": "sonar",
        "fallback_model": None,
        "fallback_api": None,
        "search_enabled": True,
        "ollama_eligible": False,
        "reason": "Discovery requires web search, Sonar only",
    },
}

# Dangerous shell commands that should be blocked or warned
DANGEROUS_COMMANDS = {
    "block": [
        r"rm\s+-rf\s+/",
        r"rm\s+-rf\s+~",
        r"mkfs\.",
        r"dd\s+if=.*of=/dev/",
        r">\s*/dev/sd",
        r"chmod\s+-R\s+777\s+/",
        r":\(\)\s*\{",
    ],
    "warn": [
        r"rm\s+-rf",
        r"git\s+push\s+--force",
        r"git\s+reset\s+--hard",
        r"git\s+clean\s+-fd",
        r"drop\s+table",
        r"drop\s+database",
        r"truncate\s+table",
        r"curl.*\|\s*(?:bash|sh|zsh)",
        r"wget.*\|\s*(?:bash|sh|zsh)",
        r"npm\s+publish",
        r"vercel\s+--prod",
    ],
}


def classify_task(user_input: str) -> str:
    """Classify a user task into a routing category."""
    lower = user_input.lower()

    scores: dict[str, int] = {}
    for category, patterns in TASK_PATTERNS.items():
        score = 0
        for pattern in patterns:
            if re.search(pattern, lower):
                score += 1
        if score > 0:
            scores[category] = score

    if not scores:
        return "generation"

    return max(scores, key=scores.get)


def route_task(user_input: str, command: str | None = None) -> dict[str, Any]:
    """Determine the optimal model, API surface, and cost tier for a task.

    Three-tier routing:
      1. Ollama (free, local) for quick and simple generation tasks
      2. Sonar API (paid) for reasoning, review, debugging
      3. Agent API (paid) for third-party model access

    Falls back automatically: if Ollama is down and the route says ollama,
    it switches to the fallback_model/fallback_api.

    Returns:
        {
            "model": str,
            "api": str,           # "ollama" | "sonar" | "agent"
            "search_enabled": bool,
            "task_type": str,
            "reason": str,
            "cost_tier": str,     # "free" | "fast" | "standard" | "premium"
            "local": bool,        # True if using Ollama
        }
    """
    # Command-level overrides
    if command in ("debug", "refactor"):
        task_type = "debugging" if command == "debug" else "review"
    elif command in ("build", "new-project", "api", "design", "database"):
        task_type = "generation"
    elif command in ("review", "audit", "review-pr", "review-project", "ship"):
        task_type = "review"
    elif command in ("daily-brief", "standup", "sprint", "triage-prs", "triage-issues"):
        task_type = "quick"
    elif command in ("discover", "search", "compare", "docs"):
        task_type = "discovery"
    else:
        task_type = classify_task(user_input)

    route = ROUTING_TABLE.get(task_type, ROUTING_TABLE["generation"])

    # Determine actual API surface with Ollama availability check
    api = route.get("api", "sonar")
    model = route["model"]
    local = False

    if api == "ollama":
        # Check if Ollama is actually available
        from .ollama import is_available as ollama_is_available
        if ollama_is_available():
            local = True
        else:
            # Fall back to paid API
            fallback_api = route.get("fallback_api", "sonar")
            fallback_model = route.get("fallback_model")
            if fallback_api and fallback_model:
                api = fallback_api
                model = fallback_model
            else:
                api = "sonar"
                model = os.getenv("PERPLEXITY_MODEL", "sonar-reasoning-pro")

    # Determine cost tier
    if local:
        cost_tier = "free"
    else:
        model_info = MODEL_REGISTRY.get(model, {})
        cost_tier = model_info.get("tier", "standard")

    return {
        "model": model,
        "api": api,
        "search_enabled": route.get("search_enabled", False),
        "task_type": task_type,
        "reason": route["reason"],
        "cost_tier": cost_tier,
        "local": local,
    }


def should_use_discovery(user_input: str) -> bool:
    """Quick check: does this task need web search / discovery?"""
    task_type = classify_task(user_input)
    return task_type == "discovery"


def check_shell_safety(command: str) -> tuple[str, str]:
    """Check a shell command for dangerous patterns.

    Returns:
        ("allow", "") - safe to run
        ("block", reason) - must not run
        ("warn", reason) - needs explicit confirmation
    """
    lower = command.lower().strip()

    for pattern in DANGEROUS_COMMANDS["block"]:
        if re.search(pattern, lower):
            return "block", f"Blocked: dangerous command matches pattern '{pattern}'"

    for pattern in DANGEROUS_COMMANDS["warn"]:
        if re.search(pattern, lower):
            return "warn", f"Warning: potentially destructive command (matches '{pattern}')"

    return "allow", ""


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost for a model call in dollars."""
    info = MODEL_REGISTRY.get(model, {})
    cost_in = info.get("cost_input", 5.0)
    cost_out = info.get("cost_output", 15.0)
    return (input_tokens * cost_in + output_tokens * cost_out) / 1_000_000


class RoutingBenchmark:
    """Track routing decisions and outcomes for continuous improvement."""

    def __init__(self, project_root: Path | None = None) -> None:
        self.project_root = project_root or Path.cwd()
        self.log_path = self.project_root / ".perplexity" / "routing_log.jsonl"

    def record(
        self,
        task_type: str,
        model: str,
        duration_ms: int,
        success: bool,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        """Record a routing decision and its outcome."""
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "task_type": task_type,
                "model": model,
                "duration_ms": duration_ms,
                "success": success,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "estimated_cost": estimate_cost(model, input_tokens, output_tokens),
            }
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass

    def get_stats(self) -> dict[str, Any]:
        """Get routing performance stats."""
        if not self.log_path.exists():
            return {"total_calls": 0}

        entries = []
        try:
            for line in self.log_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    entries.append(json.loads(line))
        except Exception:
            return {"total_calls": 0}

        if not entries:
            return {"total_calls": 0}

        total = len(entries)
        successes = sum(1 for e in entries if e.get("success"))
        total_cost = sum(e.get("estimated_cost", 0) for e in entries)
        avg_duration = sum(e.get("duration_ms", 0) for e in entries) / total

        by_type: dict[str, dict] = {}
        for e in entries:
            tt = e.get("task_type", "unknown")
            if tt not in by_type:
                by_type[tt] = {"count": 0, "successes": 0, "total_ms": 0}
            by_type[tt]["count"] += 1
            if e.get("success"):
                by_type[tt]["successes"] += 1
            by_type[tt]["total_ms"] += e.get("duration_ms", 0)

        return {
            "total_calls": total,
            "success_rate": round(successes / total * 100, 1),
            "total_estimated_cost": round(total_cost, 4),
            "avg_duration_ms": round(avg_duration),
            "by_task_type": {
                k: {
                    "count": v["count"],
                    "success_rate": round(v["successes"] / v["count"] * 100, 1),
                    "avg_ms": round(v["total_ms"] / v["count"]),
                }
                for k, v in by_type.items()
            },
        }
