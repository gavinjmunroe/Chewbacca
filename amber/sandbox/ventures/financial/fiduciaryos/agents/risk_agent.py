"""
agents/risk_agent.py — Continuous portfolio risk monitoring and alert agent.

The RiskAgent runs on a schedule (default: every 15 minutes during market hours)
and continuously monitors:
  1. Real-time drawdown vs policy maximum
  2. Single-security concentration
  3. Portfolio volatility vs target
  4. Correlation breakdown (crisis regime detection)
  5. Liquidity reserve adequacy
  6. Tail-risk metrics (CVaR, expected shortfall)

Unlike the RiskGuardian (which enforces hard constraints synchronously),
the RiskAgent runs asynchronously and generates forward-looking alerts
with recommended hedging or de-risking actions.

Usage:
    agent = RiskAgent(policy_artifact)
    report = agent.assess(portfolio_state, returns_history)
    if report.requires_action:
        print(report.recommendations)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np
from loguru import logger

from core.policy_compiler import PolicyArtifact
from core.risk_guardian import AlertLevel, PortfolioState


@dataclass
class RiskMetrics:
    """Computed risk metrics for a portfolio."""

    # Drawdown
    current_drawdown: float  # Current drawdown from peak
    max_drawdown_policy: float  # Policy maximum drawdown
    drawdown_headroom: float  # How much more drawdown allowed

    # Volatility
    realized_volatility_ann: float  # Annualized realized volatility (20d)
    volatility_target: float  # Policy target
    volatility_ratio: float  # realized / target

    # Concentration
    max_concentration: float  # Largest single-security weight
    concentration_policy: float  # Policy maximum

    # Tail risk (requires returns history)
    var_95: float | None = None  # 95% VaR (1-day, parametric)
    cvar_95: float | None = None  # 95% CVaR / Expected Shortfall
    var_99: float | None = None  # 99% VaR

    # Correlation regime
    avg_correlation: float | None = None  # Average pairwise correlation
    correlation_regime: str = "NORMAL"  # "NORMAL" | "ELEVATED" | "CRISIS"

    # Liquidity
    cash_months_of_expenses: float = 0.0
    liquidity_reserve_months: float = 6.0


@dataclass
class RiskRecommendation:
    """A recommended risk-reduction action."""

    action_type: str  # "REDUCE_POSITION" | "ADD_HEDGE" | "RAISE_CASH" | "REBALANCE" | "ALERT_ONLY"
    ticker: str = ""
    rationale: str = ""
    urgency: str = "NORMAL"  # "NORMAL" | "URGENT" | "CRITICAL"
    estimated_risk_reduction: str = ""  # Human-readable description


@dataclass
class RiskReport:
    """Full risk assessment report from RiskAgent."""

    client_id: str
    assessed_at: str
    alert_level: AlertLevel
    metrics: RiskMetrics

    requires_action: bool
    recommendations: list[RiskRecommendation]
    alerts: list[str]

    # Narrative summary for audit log
    summary: str = ""


class RiskAgent:
    """
    Continuous portfolio risk monitoring agent.

    Runs independently of the PortfolioAgent. Produces forward-looking
    risk reports with specific recommended actions.

    Key difference from RiskGuardian:
    - RiskGuardian: Synchronous hard stop ("BLOCK this action")
    - RiskAgent: Asynchronous monitor ("WARN about this trend + suggest action")
    """

    # Crisis regime: average pairwise correlation above this is concerning
    CRISIS_CORRELATION_THRESHOLD = 0.80
    ELEVATED_CORRELATION_THRESHOLD = 0.65

    def __init__(
        self,
        policy_artifact: PolicyArtifact | None = None,
    ) -> None:
        self.policy = policy_artifact

        # Read policy parameters
        if policy_artifact:
            rp = policy_artifact.risk_profile
            self.max_drawdown = rp.get("max_drawdown_tolerance", 0.18)
            self.volatility_target = rp.get("volatility_target", 0.10)
            self.max_concentration = policy_artifact.constraints.get(
                "max_single_security_pct", 0.20
            )
            self.liquidity_reserve_months = policy_artifact.constraints.get(
                "liquidity_reserve_months", 6
            )
        else:
            self.max_drawdown = 0.18
            self.volatility_target = 0.10
            self.max_concentration = 0.20
            self.liquidity_reserve_months = 6

    def assess(
        self,
        portfolio: PortfolioState,
        returns_history: list[list[float]] | None = None,  # rows=days, cols=securities
        ticker_names: list[str] | None = None,
    ) -> RiskReport:
        """
        Run comprehensive risk assessment.

        Args:
            portfolio: Current portfolio state.
            returns_history: Historical daily returns matrix (optional).
                If provided, enables CVaR, VaR, and correlation regime detection.
            ticker_names: Ticker labels for returns_history columns.

        Returns:
            RiskReport with alert level, metrics, and recommendations.
        """
        logger.info(f"Risk assessment for client {portfolio.client_id[:8]}...")

        alerts: list[str] = []
        recommendations: list[RiskRecommendation] = []
        alert_level = AlertLevel.SAFE

        # Compute metrics
        var_95 = cvar_95 = var_99 = avg_corr = None
        corr_regime = "NORMAL"

        if returns_history and len(returns_history) >= 20:
            arr = np.array(returns_history)
            var_95, cvar_95, var_99 = self._compute_tail_risk(arr)
            if arr.shape[1] > 1:
                avg_corr, corr_regime = self._compute_correlation_regime(arr)

        # Monthly expense estimate: 4.8% of portfolio per year = 0.4% per month
        monthly_expense = portfolio.total_value_usd * 0.004
        cash_months = portfolio.cash_usd / max(monthly_expense, 1.0)

        metrics = RiskMetrics(
            current_drawdown=portfolio.drawdown_from_peak,
            max_drawdown_policy=self.max_drawdown,
            drawdown_headroom=max(
                0.0, self.max_drawdown - portfolio.drawdown_from_peak
            ),
            realized_volatility_ann=portfolio.daily_volatility * (252**0.5),
            volatility_target=self.volatility_target,
            volatility_ratio=(portfolio.daily_volatility * (252**0.5))
            / max(self.volatility_target, 0.001),
            max_concentration=max(portfolio.holdings.values(), default=0.0)
            / max(portfolio.total_value_usd, 1.0),
            concentration_policy=self.max_concentration,
            var_95=var_95,
            cvar_95=cvar_95,
            var_99=var_99,
            avg_correlation=avg_corr,
            correlation_regime=corr_regime,
            cash_months_of_expenses=round(cash_months, 1),
            liquidity_reserve_months=self.liquidity_reserve_months,
        )

        # --- Drawdown alerts ---
        if portfolio.drawdown_from_peak > self.max_drawdown * 0.90:
            msg = (
                f"CRITICAL: Drawdown {portfolio.drawdown_from_peak:.1%} is within 10% of "
                f"policy maximum {self.max_drawdown:.1%}"
            )
            alerts.append(msg)
            alert_level = max(alert_level, AlertLevel.SAFE_MODE)
            recommendations.append(
                RiskRecommendation(
                    action_type="RAISE_CASH",
                    rationale=msg,
                    urgency="CRITICAL",
                    estimated_risk_reduction="Selling 20% of equity positions would reduce further drawdown exposure",
                )
            )
        elif portfolio.drawdown_from_peak > self.max_drawdown * 0.70:
            msg = f"WARNING: Drawdown {portfolio.drawdown_from_peak:.1%} approaching policy limit {self.max_drawdown:.1%}"
            alerts.append(msg)
            alert_level = max(alert_level, AlertLevel.ALERT)
            recommendations.append(
                RiskRecommendation(
                    action_type="REBALANCE",
                    rationale="Rebalance toward lower-volatility assets to protect against breaching drawdown limit",
                    urgency="URGENT",
                )
            )
        elif portfolio.drawdown_from_peak > 0.05:
            alerts.append(f"Drawdown {portfolio.drawdown_from_peak:.1%} — monitoring")
            alert_level = max(alert_level, AlertLevel.MONITORING)

        # --- Concentration alerts ---
        if metrics.max_concentration > self.max_concentration:
            # Find the concentrated ticker
            concentrated_ticker = max(
                portfolio.holdings, key=lambda t: portfolio.holdings[t]
            )
            msg = (
                f"Concentration: {concentrated_ticker} is {metrics.max_concentration:.1%} of portfolio "
                f"(policy max: {self.max_concentration:.1%})"
            )
            alerts.append(msg)
            alert_level = max(alert_level, AlertLevel.ALERT)
            recommendations.append(
                RiskRecommendation(
                    action_type="REDUCE_POSITION",
                    ticker=concentrated_ticker,
                    rationale=msg,
                    urgency="URGENT",
                    estimated_risk_reduction=f"Trimming {concentrated_ticker} to {self.max_concentration:.0%} would reduce idiosyncratic risk",
                )
            )

        # --- Volatility alerts ---
        if metrics.volatility_ratio > 1.5:
            msg = (
                f"Volatility {metrics.realized_volatility_ann:.1%} is "
                f"{metrics.volatility_ratio:.1f}× above target {self.volatility_target:.1%}"
            )
            alerts.append(msg)
            alert_level = max(alert_level, AlertLevel.ALERT)
            recommendations.append(
                RiskRecommendation(
                    action_type="REBALANCE",
                    rationale="Shift 15% of equity exposure to bonds/cash to reduce realized volatility",
                    urgency="NORMAL",
                    estimated_risk_reduction="Adding 15% fixed income typically reduces portfolio volatility by 20-30%",
                )
            )
        elif metrics.volatility_ratio > 1.2:
            alerts.append(
                f"Elevated volatility {metrics.realized_volatility_ann:.1%} vs target {self.volatility_target:.1%}"
            )
            alert_level = max(alert_level, AlertLevel.MONITORING)

        # --- Correlation regime ---
        if corr_regime == "CRISIS":
            msg = f"CRISIS REGIME: average pairwise correlation {avg_corr:.2f} — diversification benefit severely reduced"
            alerts.append(msg)
            alert_level = max(alert_level, AlertLevel.ALERT)
            recommendations.append(
                RiskRecommendation(
                    action_type="ADD_HEDGE",
                    rationale=msg,
                    urgency="URGENT",
                    estimated_risk_reduction="Consider adding non-correlated assets: gold (GLD), short-term treasuries, or reducing overall equity exposure",
                )
            )
        elif corr_regime == "ELEVATED":
            alerts.append(f"Elevated correlation regime: average r={avg_corr:.2f}")
            alert_level = max(alert_level, AlertLevel.MONITORING)

        # --- Tail risk alerts ---
        if cvar_95 is not None:
            cvar_dollar = abs(cvar_95) * portfolio.total_value_usd
            if abs(cvar_95) > 0.04:  # >4% CVaR in a day
                msg = f"High tail risk: 95% CVaR = {cvar_95:.1%}/day (${cvar_dollar:,.0f})"
                alerts.append(msg)
                alert_level = max(alert_level, AlertLevel.ALERT)

        # --- Liquidity alerts ---
        if cash_months < self.liquidity_reserve_months:
            msg = (
                f"Liquidity: {cash_months:.1f} months of cash below "
                f"{self.liquidity_reserve_months}-month policy reserve"
            )
            alerts.append(msg)
            alert_level = max(alert_level, AlertLevel.ALERT)
            recommendations.append(
                RiskRecommendation(
                    action_type="RAISE_CASH",
                    rationale=msg,
                    urgency="NORMAL",
                    estimated_risk_reduction=f"Raise cash to {self.liquidity_reserve_months} months of expenses",
                )
            )

        requires_action = (
            len([r for r in recommendations if r.urgency in ("URGENT", "CRITICAL")]) > 0
        )

        # Build summary
        summary = self._build_summary(
            portfolio, metrics, alerts, recommendations, alert_level
        )

        report = RiskReport(
            client_id=portfolio.client_id,
            assessed_at=datetime.utcnow().isoformat(),
            alert_level=alert_level,
            metrics=metrics,
            requires_action=requires_action,
            recommendations=recommendations,
            alerts=alerts,
            summary=summary,
        )

        logger.info(
            f"Risk report: {alert_level.name} | "
            f"{len(alerts)} alerts | "
            f"{len(recommendations)} recommendations"
        )
        return report

    def _compute_tail_risk(self, returns: "np.ndarray") -> tuple[float, float, float]:
        """
        Compute parametric VaR and CVaR for portfolio.

        Uses equal-weighted portfolio of the provided returns columns.
        In production: use actual portfolio weights.
        """
        # TODO (FD-15): This uses equal-weighted returns, which ignores actual portfolio weights.
        # Fix requires accepting a `weights` parameter (array of floats summing to 1.0)
        # and computing: portfolio_returns = (returns * weights).sum(axis=1)
        # Equal-weighted portfolio returns (placeholder)
        portfolio_returns = returns.mean(axis=1)

        mu = float(np.mean(portfolio_returns))
        sigma = float(np.std(portfolio_returns))

        # Parametric (normal) VaR
        from scipy.stats import norm

        var_95 = mu - norm.ppf(0.95) * sigma  # negative number = loss
        var_99 = mu - norm.ppf(0.99) * sigma

        # CVaR (Expected Shortfall): E[loss | loss > VaR]
        # Parametric: mu - sigma * phi(z) / (1 - 0.95)
        z_95 = norm.ppf(0.95)
        pdf_z95 = norm.pdf(z_95)
        cvar_95 = mu - sigma * pdf_z95 / 0.05

        return round(var_95, 5), round(cvar_95, 5), round(var_99, 5)

    def _compute_correlation_regime(self, returns: "np.ndarray") -> tuple[float, str]:
        """
        Compute average pairwise correlation and classify regime.
        """
        if returns.shape[1] < 2:
            return 0.0, "NORMAL"

        corr_matrix = np.corrcoef(returns.T)
        n = corr_matrix.shape[0]

        # Average of upper triangle (exclude diagonal)
        upper = corr_matrix[np.triu_indices(n, k=1)]
        avg_corr = float(np.mean(upper))

        if avg_corr >= self.CRISIS_CORRELATION_THRESHOLD:
            regime = "CRISIS"
        elif avg_corr >= self.ELEVATED_CORRELATION_THRESHOLD:
            regime = "ELEVATED"
        else:
            regime = "NORMAL"

        return round(avg_corr, 4), regime

    def _build_summary(
        self,
        portfolio: PortfolioState,
        metrics: RiskMetrics,
        alerts: list[str],
        recommendations: list[RiskRecommendation],
        level: AlertLevel,
    ) -> str:
        """Build human-readable risk summary for audit log."""
        lines = [
            f"Risk Assessment — {level.name}",
            f"  Portfolio: ${portfolio.total_value_usd:,.0f} | "
            f"Drawdown: {metrics.current_drawdown:.1%} | "
            f"Vol: {metrics.realized_volatility_ann:.1%}",
        ]
        if alerts:
            lines.append("  Alerts: " + "; ".join(alerts[:3]))
        if recommendations:
            urgent = [r for r in recommendations if r.urgency == "CRITICAL"]
            if urgent:
                lines.append("  CRITICAL: " + urgent[0].rationale[:100])
        return " | ".join(lines)
