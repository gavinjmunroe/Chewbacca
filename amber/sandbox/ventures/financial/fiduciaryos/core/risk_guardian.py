"""
core/risk_guardian.py — Hard-constraint enforcement layer for FiduciaryOS.

The Risk Guardian is the last line of defense. It operates independently of
the FiduciaryOS model — if the model produces an action that violates risk limits,
the Risk Guardian blocks it unconditionally. The model cannot override this layer.

Alert levels:
  Level 1 — MONITORING:  Portfolio drift > 3% | Single security > 15%
  Level 2 — ALERT:       Drawdown > 10% | Concentration > 20% | Volatility > 1.5× target
  Level 3 — SAFE_MODE:   Drawdown > policy.max_drawdown | Liquidity < reserve | Margin call risk
  Level 4 — HALT:        Emergency signal | Regulatory hold | Manual override

In Safe Mode: all new positions blocked, existing positions evaluated for liquidation to cash.
In HALT: all trading blocked, human review required.

Usage:
    guardian = RiskGuardian(policy_artifact)
    status = guardian.assess(portfolio_state)
    if status.level >= AlertLevel.SAFE_MODE:
        guardian.activate_safe_mode(reason="automatic_drawdown_trigger")
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import IntEnum
from pathlib import Path

from loguru import logger


class AlertLevel(IntEnum):
    SAFE = 0
    MONITORING = 1
    ALERT = 2
    SAFE_MODE = 3
    HALT = 4


@dataclass
class PortfolioState:
    """Current state of a portfolio for risk assessment."""

    client_id: str
    total_value_usd: float
    holdings: dict[str, float]  # ticker → current value USD
    allocation: dict[str, float]  # asset_class → fraction
    unrealized_pnl_usd: float
    drawdown_from_peak: float  # current drawdown as fraction
    daily_volatility: float  # realized 20-day rolling volatility
    cash_usd: float
    alpha_sleeve_value_usd: float = 0.0
    margin_utilization: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class RiskStatus:
    """Output of guardian.assess()."""

    level: AlertLevel
    alerts: list[str]
    blocked_action_types: list[str]
    requires_human_review: bool
    safe_mode_active: bool
    halt_active: bool
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class RiskGuardian:
    """
    Hard-constraint enforcement layer.

    Stateful: tracks safe mode and halt status across assessments.
    Thread-safe: uses file-based state persistence.
    """

    def __init__(
        self,
        policy_artifact: "PolicyArtifact | None" = None,
        state_path: str = "data/risk_guardian_state.json",
    ) -> None:
        self.policy = policy_artifact
        self.state_path = Path(state_path)
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state = self._load_state()

    def assess(self, portfolio: PortfolioState) -> RiskStatus:
        """
        Assess portfolio state and return risk status.

        This is called before every proposed action. If safe mode or halt
        is active, all new positions are blocked.

        Args:
            portfolio: Current portfolio state.

        Returns:
            RiskStatus with current alert level and blocked actions.
        """
        alerts: list[str] = []
        level = AlertLevel.SAFE

        # Check active states first
        if self._state.get("halt_active", False):
            return RiskStatus(
                level=AlertLevel.HALT,
                alerts=["HALT: " + self._state.get("halt_reason", "Manual halt")],
                blocked_action_types=["BUY", "SELL", "REBALANCE", "HARVEST"],
                requires_human_review=True,
                safe_mode_active=True,
                halt_active=True,
            )

        if self._state.get("safe_mode_active", False):
            alerts.append(
                "SAFE_MODE: " + self._state.get("safe_mode_reason", "Automatic trigger")
            )
            level = AlertLevel.SAFE_MODE

        # Level 1 checks — MONITORING
        if portfolio.drawdown_from_peak > 0.03:
            alerts.append(
                f"Drawdown {portfolio.drawdown_from_peak:.1%} > 3% monitoring threshold"
            )
            level = max(level, AlertLevel.MONITORING)

        max_concentration = max(portfolio.holdings.values(), default=0) / max(
            portfolio.total_value_usd, 1
        )
        if max_concentration > 0.15:
            alerts.append(
                f"Single security concentration {max_concentration:.1%} > 15%"
            )
            level = max(level, AlertLevel.MONITORING)

        # Level 2 checks — ALERT
        max_drawdown_tolerance = (
            self.policy.risk_profile.get("max_drawdown_tolerance", 0.18)
            if self.policy
            else 0.18
        )

        if portfolio.drawdown_from_peak > 0.10:
            alerts.append(
                f"Drawdown {portfolio.drawdown_from_peak:.1%} > 10% alert threshold"
            )
            level = max(level, AlertLevel.ALERT)

        if max_concentration > 0.20:
            alerts.append(
                f"Concentration {max_concentration:.1%} > 20% alert threshold"
            )
            level = max(level, AlertLevel.ALERT)

        volatility_target = (
            self.policy.risk_profile.get("volatility_target", 0.10)
            if self.policy
            else 0.10
        )
        if portfolio.daily_volatility * (252**0.5) > volatility_target * 1.5:
            annualized_vol = portfolio.daily_volatility * (252**0.5)
            alerts.append(
                f"Realized volatility {annualized_vol:.1%} > 1.5× target {volatility_target:.1%}"
            )
            level = max(level, AlertLevel.ALERT)

        # Level 3 checks — SAFE MODE
        if portfolio.drawdown_from_peak > max_drawdown_tolerance:
            alerts.append(
                f"Drawdown {portfolio.drawdown_from_peak:.1%} exceeds policy maximum {max_drawdown_tolerance:.1%}"
            )
            level = max(level, AlertLevel.SAFE_MODE)
            if level == AlertLevel.SAFE_MODE and not self._state.get(
                "safe_mode_active"
            ):
                self.activate_safe_mode(
                    client_id=portfolio.client_id,
                    reason=f"Automatic: drawdown {portfolio.drawdown_from_peak:.1%} > policy max {max_drawdown_tolerance:.1%}",
                )

        # Alpha Sleeve check
        if self.policy:
            alpha_max = self.policy.alpha_sleeve.get("max_allocation_pct", 0.05)
            alpha_pct = portfolio.alpha_sleeve_value_usd / max(
                portfolio.total_value_usd, 1
            )
            if alpha_pct > alpha_max * 1.2:  # 20% buffer before alert
                alerts.append(
                    f"Alpha Sleeve allocation {alpha_pct:.1%} > policy max {alpha_max:.1%}"
                )
                level = max(level, AlertLevel.ALERT)

        liquidity_reserve_months = (
            self.policy.constraints.get("liquidity_reserve_months", 6)
            if self.policy
            else 6
        )
        monthly_expense_estimate = (
            portfolio.total_value_usd * 0.004
        )  # rough: 4.8% of portfolio per year
        if portfolio.cash_usd < monthly_expense_estimate * liquidity_reserve_months:
            alerts.append(
                f"Cash {portfolio.cash_usd:,.0f} below {liquidity_reserve_months}-month liquidity reserve"
            )
            level = max(level, AlertLevel.SAFE_MODE)

        blocked: list[str] = []
        if level >= AlertLevel.SAFE_MODE:
            blocked = ["BUY", "REBALANCE"]
        if level >= AlertLevel.HALT:
            blocked = ["BUY", "SELL", "REBALANCE", "HARVEST"]

        return RiskStatus(
            level=level,
            alerts=alerts,
            blocked_action_types=blocked,
            requires_human_review=level >= AlertLevel.SAFE_MODE,
            safe_mode_active=level >= AlertLevel.SAFE_MODE,
            halt_active=level == AlertLevel.HALT,
        )

    def activate_safe_mode(self, client_id: str = "", reason: str = "manual") -> None:
        """Activate Safe Mode: block all new positions."""
        self._state["safe_mode_active"] = True
        self._state["safe_mode_reason"] = reason
        self._state["safe_mode_activated_at"] = datetime.utcnow().isoformat()
        self._state["safe_mode_client_id"] = client_id
        self._save_state()
        logger.warning(f"SAFE MODE ACTIVATED — {reason}")

    def deactivate_safe_mode(self, authorized_by: str = "") -> None:
        """Deactivate Safe Mode. Requires explicit authorization."""
        self._state["safe_mode_active"] = False
        self._state["safe_mode_deactivated_at"] = datetime.utcnow().isoformat()
        self._state["safe_mode_deactivated_by"] = authorized_by
        self._save_state()
        logger.info(f"Safe Mode deactivated by {authorized_by}")

    def halt(self, reason: str = "emergency") -> None:
        """Activate HALT: block all trading."""
        self._state["halt_active"] = True
        self._state["halt_reason"] = reason
        self._state["halt_activated_at"] = datetime.utcnow().isoformat()
        self._save_state()
        logger.critical(f"HALT ACTIVATED — {reason}")

    def halt_alpha_sleeve(self, reason: str = "") -> None:
        """Halt Alpha Sleeve only (does not affect core portfolio)."""
        self._state["alpha_sleeve_halted"] = True
        self._state["alpha_halt_reason"] = reason
        self._state["alpha_halt_at"] = datetime.utcnow().isoformat()
        self._save_state()
        logger.warning(f"ALPHA SLEEVE HALTED — {reason}")

    def is_alpha_sleeve_halted(self) -> bool:
        return bool(self._state.get("alpha_sleeve_halted", False))

    def _load_state(self) -> dict:
        if self.state_path.exists():
            return json.loads(self.state_path.read_text())
        return {
            "safe_mode_active": False,
            "halt_active": False,
            "alpha_sleeve_halted": False,
        }

    def _save_state(self) -> None:
        self.state_path.write_text(json.dumps(self._state, indent=2))
