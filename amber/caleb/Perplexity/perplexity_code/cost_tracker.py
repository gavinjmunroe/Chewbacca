"""Token and cost tracking for Perplexity API usage."""

from __future__ import annotations


# Approximate pricing per 1K tokens (as of early 2026)
MODEL_PRICING = {
    "sonar-reasoning-pro": {"input": 0.002, "output": 0.008},
    "sonar-pro": {"input": 0.003, "output": 0.015},
    "sonar": {"input": 0.001, "output": 0.001},
}

DEFAULT_PRICING = {"input": 0.002, "output": 0.008}


class CostTracker:
    def __init__(self) -> None:
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.total_requests = 0
        self.session_costs: list[float] = []

    def record(self, usage: dict, model: str) -> float:
        input_tokens = usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0) or usage.get("output_tokens", 0)

        self.total_input_tokens += input_tokens
        self.total_output_tokens += output_tokens
        self.total_requests += 1

        pricing = MODEL_PRICING.get(model, DEFAULT_PRICING)
        cost = (input_tokens / 1000 * pricing["input"]) + (output_tokens / 1000 * pricing["output"])
        self.session_costs.append(cost)
        return cost

    @property
    def total_cost(self) -> float:
        return sum(self.session_costs)

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens

    def summary(self) -> str:
        lines = [
            f"Requests: {self.total_requests}",
            f"Input tokens: {self.total_input_tokens:,}",
            f"Output tokens: {self.total_output_tokens:,}",
            f"Total tokens: {self.total_tokens:,}",
            f"Estimated cost: ${self.total_cost:.4f}",
        ]
        return "\n".join(lines)
