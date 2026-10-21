"""
agents/portfolio_agent.py — Main portfolio management orchestrator.

The PortfolioAgent coordinates all portfolio management tasks:
  1. Receive portfolio state + market data
  2. Query FiduciaryOS model for recommended action
  3. Verify action against Policy Artifact (via PolicyCompiler)
  4. Check Risk Guardian status
  5. Optionally execute via broker API
  6. Log to AuditLog

Every decision path produces an audit log entry, regardless of outcome.

Usage:
    agent = PortfolioAgent(model_url="http://localhost:9000")
    result = agent.run(client_id="client_001", portfolio=portfolio_state)
    print(result.recommended_actions)
    print(result.policy_violations)  # Should always be empty
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from loguru import logger

from core.audit_log import AuditLog
from core.policy_compiler import PolicyArtifact, PolicyCompiler, PolicyViolation
from core.risk_guardian import PortfolioState, RiskGuardian
from core.tax_optimizer import TaxOptimizer


@dataclass
class PortfolioAnalysisResult:
    """Output of PortfolioAgent.run()."""

    client_id: str
    analysis_timestamp: str
    risk_status_level: int
    risk_alerts: list[str]
    recommended_actions: list[dict]
    tax_harvest_candidates: list[dict]
    fiduciary_compliance_score: float
    policy_violations: list[str]  # Should always be empty
    audit_entry_id: str


class PortfolioAgent:
    """
    Main portfolio management agent.

    Coordinates model inference, policy enforcement, risk monitoring,
    and audit logging for every portfolio management decision.
    """

    def __init__(
        self,
        model_url: str | None = None,
        model_path: str | None = None,
        policy_compiler: PolicyCompiler | None = None,
    ) -> None:
        self.model_url = model_url
        self.model_path = model_path
        self.policy_compiler = policy_compiler or PolicyCompiler()
        self._llm_client = None

        if model_url:
            import openai

            self._llm_client = openai.OpenAI(
                base_url=f"{model_url}/v1",
                api_key=os.environ.get("VLLM_API_KEY", "dummy"),
            )

    def run(
        self,
        client_id: str,
        portfolio: PortfolioState,
        policy_artifact: PolicyArtifact | None = None,
        current_prices: dict[str, float] | None = None,
        tax_lots: list | None = None,
    ) -> PortfolioAnalysisResult:
        """
        Run full portfolio analysis for a client.

        Steps:
        1. Assess risk status (Risk Guardian)
        2. Build model prompt from portfolio state
        3. Get model recommendations
        4. Verify each recommendation against policy
        5. Filter by risk guardian (block if safe mode)
        6. Find tax harvest candidates
        7. Log everything to audit trail

        Returns:
            PortfolioAnalysisResult with all recommendations and compliance status.
        """
        logger.info(f"Portfolio analysis for client {client_id[:8]}...")
        audit_log = AuditLog(client_id=client_id)
        guardian = RiskGuardian(policy_artifact=policy_artifact)
        current_prices = current_prices or {}

        # Step 1: Risk assessment
        risk_status = guardian.assess(portfolio)
        logger.info(
            f"Risk status: {risk_status.level.name} ({len(risk_status.alerts)} alerts)"
        )

        # Step 2: Build model prompt
        prompt = self._build_prompt(portfolio, policy_artifact, risk_status)

        # Step 3: Get model recommendations
        raw_recommendations = self._get_model_recommendations(prompt)

        # Step 4 + 5: Policy verification + risk filtering
        verified_actions = []
        policy_violations = []

        for action in raw_recommendations:
            action_type = action.get("type", "UNKNOWN")

            # Risk Guardian check first
            if action_type in risk_status.blocked_action_types:
                logger.warning(
                    f"Action {action_type} blocked by Risk Guardian (level {risk_status.level.name})"
                )
                policy_violations.append(
                    f"{action_type} blocked by Risk Guardian ({risk_status.level.name})"
                )
                continue

            # Policy Artifact check
            if policy_artifact:
                try:
                    self.policy_compiler.check_action(policy_artifact, action)
                    verified_actions.append({**action, "policy_check": "PASSED"})
                except PolicyViolation as e:
                    logger.error(f"Policy violation: {e}")
                    policy_violations.append(str(e))
                    # Log the violation
                    audit_log.record(
                        action_type=action_type,
                        reasoning=f"Action proposed but blocked by policy: {e.constraint}",
                        proposed_action=action,
                        policy_check_passed=False,
                        portfolio_snapshot={
                            "client_id": client_id,
                            "value": portfolio.total_value_usd,
                        },
                        policy_check_detail=str(e),
                    )
            else:
                verified_actions.append({**action, "policy_check": "NO_POLICY"})

        # Step 6: Tax harvest opportunities
        harvest_candidates = []
        if tax_lots and current_prices:
            optimizer = TaxOptimizer(policy_artifact=policy_artifact)
            candidates = optimizer.find_harvest_candidates(tax_lots, current_prices)
            harvest_candidates = [
                {
                    "ticker": c.ticker,
                    "unrealized_loss_usd": c.unrealized_loss_usd,
                    "tax_savings_estimate_usd": c.tax_savings_estimate_usd,
                    "replacement_tickers": c.replacement_tickers,
                    "net_benefit_usd": c.net_benefit_usd,
                }
                for c in candidates[:5]  # Top 5 opportunities
            ]

        # Step 7: Audit log entry
        model_reasoning = (
            raw_recommendations[0].get("reasoning", "") if raw_recommendations else ""
        )
        entry = audit_log.record(
            action_type="PORTFOLIO_ANALYSIS",
            reasoning=model_reasoning,
            proposed_action={"recommended_actions": verified_actions},
            policy_check_passed=len(policy_violations) == 0,
            portfolio_snapshot={
                "client_id": client_id,
                "total_value_usd": portfolio.total_value_usd,
                "drawdown": portfolio.drawdown_from_peak,
                "risk_level": risk_status.level.name,
            },
            policy_check_detail="All actions passed"
            if not policy_violations
            else "; ".join(policy_violations),
        )

        # Compliance score: 1.0 if no violations, degrades per violation
        compliance_score = max(0.0, 1.0 - len(policy_violations) * 0.2)

        result = PortfolioAnalysisResult(
            client_id=client_id,
            analysis_timestamp=datetime.utcnow().isoformat(),
            risk_status_level=risk_status.level.value,
            risk_alerts=risk_status.alerts,
            recommended_actions=verified_actions,
            tax_harvest_candidates=harvest_candidates,
            fiduciary_compliance_score=round(compliance_score, 3),
            policy_violations=policy_violations,
            audit_entry_id=entry.entry_id,
        )

        logger.info(
            f"Analysis complete: {len(verified_actions)} actions | "
            f"compliance={compliance_score:.2f} | "
            f"violations={len(policy_violations)}"
        )
        return result

    def _build_prompt(
        self,
        portfolio: PortfolioState,
        policy: PolicyArtifact | None,
        risk_status: Any,
    ) -> str:
        """Build model prompt from portfolio state."""
        prompt_parts = [
            "You are FiduciaryOS, an autonomous wealth manager. "
            "Your recommendations must satisfy fiduciary duty to the client. "
            "Always prioritize the client's best interest over any other consideration.",
            "",
            "PORTFOLIO STATE:",
            f"  Total value: ${portfolio.total_value_usd:,.0f}",
            f"  Drawdown from peak: {portfolio.drawdown_from_peak:.1%}",
            f"  Daily volatility (annualized): {portfolio.daily_volatility * (252**0.5):.1%}",
            f"  Cash: ${portfolio.cash_usd:,.0f}",
            f"  Risk level: {risk_status.level.name}",
        ]

        if risk_status.alerts:
            prompt_parts.extend(
                ["", "RISK ALERTS:"] + [f"  - {a}" for a in risk_status.alerts]
            )

        if policy:
            prompt_parts.extend(
                [
                    "",
                    "CLIENT POLICY (summary):",
                    f"  Risk tolerance: {policy.risk_profile.get('tolerance', 'moderate')}",
                    f"  Max drawdown tolerance: {policy.risk_profile.get('max_drawdown_tolerance', 0.18):.0%}",
                    f"  Target allocation: {json.dumps(policy.target_allocation)}",
                    f"  Tax status: {policy.tax_strategy.get('tax_status', 'taxable')}",
                ]
            )

        prompt_parts.extend(
            [
                "",
                "TASK: Provide 1-3 portfolio management recommendations. "
                "Each recommendation must include: type (BUY/SELL/HOLD/REBALANCE/HARVEST), "
                "ticker (if applicable), reasoning, and estimated tax impact.",
                "",
                'Respond in JSON format: {"recommendations": [{"type": "...", '
                '"ticker": "...", "reasoning": "...", "amount_usd": 0, '
                '"pct_of_portfolio": 0.0, "tax_impact_usd": 0}]}',
            ]
        )

        return "\n".join(prompt_parts)

    def _get_model_recommendations(self, prompt: str) -> list[dict]:
        """Get portfolio recommendations from FiduciaryOS model."""
        if self._llm_client is None:
            # Fallback: return a HOLD recommendation
            return [
                {
                    "type": "HOLD",
                    "reasoning": "No model connected — holding all positions",
                    "amount_usd": 0,
                }
            ]

        try:
            resp = self._llm_client.chat.completions.create(
                model="fiduciaryos",
                messages=[
                    {
                        "role": "system",
                        "content": "You are FiduciaryOS, a fiduciary-grade autonomous wealth manager.",
                    },
                    {"role": "user", "content": prompt},
                ],
                max_tokens=1024,
                temperature=0.1,  # Low temperature for consistent financial recommendations
            )
            text = resp.choices[0].message.content.strip()

            # Parse JSON
            if text.startswith("```"):
                lines = text.split("\n")
                text = "\n".join(lines[1:-1])
            data = json.loads(text)
            return data.get("recommendations", [])

        except Exception as e:
            logger.error(f"Model inference failed: {e}")
            return [{"type": "HOLD", "reasoning": f"Model error: {e}", "amount_usd": 0}]
