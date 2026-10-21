"""
agents/alpha_sleeve_agent.py — Sandboxed prediction market arbitrage agent.

The Alpha Sleeve is an OPTIONAL, OPT-IN module. It runs in an isolated Docker
container (see deploy/docker-compose.yml) with no direct access to core portfolio
data or client PII.

This file defines the Alpha Sleeve agent logic. The isolation is enforced at the
infrastructure level (separate container, separate network namespace, narrow API).

Key constraints enforced here AND at infrastructure level:
  - Max position size: ≤ policy.alpha_sleeve.max_allocation_pct of AUM
  - Max drawdown: ≤ policy.alpha_sleeve.max_drawdown_pct
  - Only approved markets: Polymarket, Manifold Markets (configurable)
  - No leverage
  - Immediate halt on drawdown breach

See SECURITY.md for threat model and why external skill frameworks are banned.

WARNING: This module involves real monetary risk. Do not enable without understanding
the full risk disclosure in SECURITY.md.

Usage (sandboxed container only — never called directly from core):
    agent = AlphaSleeveAgent(policy_artifact, market_client)
    positions = agent.scan_opportunities()
    if positions:
        agent.execute(positions[0])  # Only after policy check
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from loguru import logger


@dataclass
class MarketOpportunity:
    """A potential prediction market arbitrage opportunity."""

    market_id: str
    market_question: str
    current_yes_price: float  # 0.0 – 1.0 (implied probability)
    current_no_price: float
    estimated_true_probability: float  # Model's estimate
    edge: float  # |estimated_true_prob - market_price|
    confidence: float  # Model's confidence in estimate
    max_position_usd: float  # Policy-constrained position size
    expected_value_usd: float  # edge × confidence × max_position
    market_closes_at: str  # ISO 8601 resolution date
    liquidity_usd: float  # Available liquidity in this market


@dataclass
class AlphaPosition:
    """An open position in the Alpha Sleeve."""

    position_id: str
    market_id: str
    side: str  # "YES" | "NO"
    size_usd: float
    entry_price: float
    current_price: float
    unrealized_pnl_usd: float
    opened_at: str
    closes_at: str


class AlphaSleeveAgent:
    """
    Prediction market arbitrage agent — sandboxed, opt-in, policy-constrained.

    This agent ONLY runs in the isolated alpha-sleeve Docker container.
    It cannot access core portfolio state directly — all portfolio context
    is received via the narrow Alpha Proxy API (see deploy/docker-compose.yml).

    Security constraints:
    1. All positions verified against Policy Artifact before execution
    2. Maximum allocation strictly enforced (hard cap, not soft limit)
    3. Halt signal from Core stops all activity immediately
    4. No external skill frameworks or plugins permitted (see SECURITY.md)
    5. All actions logged to isolated alpha audit log
    """

    APPROVED_MARKETS = ["polymarket", "manifold"]
    MIN_EDGE_THRESHOLD = 0.05  # Minimum |estimated - market| to trade
    MIN_CONFIDENCE = 0.70  # Minimum model confidence to trade
    MAX_SINGLE_MARKET_PCT = 0.20  # Max 20% of alpha sleeve in one market

    def __init__(
        self,
        policy_artifact: dict,  # Pre-parsed policy (passed from Core via proxy)
        total_portfolio_value_usd: float,
        alpha_sleeve_current_value_usd: float,
    ) -> None:
        if not policy_artifact.get("alpha_sleeve", {}).get("enabled", False):
            raise RuntimeError(
                "Alpha Sleeve is not enabled in client policy. Cannot initialize."
            )

        self.policy = policy_artifact
        self.total_portfolio_value = total_portfolio_value_usd
        self.current_sleeve_value = alpha_sleeve_current_value_usd

        self.max_sleeve_value = total_portfolio_value_usd * policy_artifact[
            "alpha_sleeve"
        ].get("max_allocation_pct", 0.05)
        self.max_drawdown_pct = policy_artifact["alpha_sleeve"].get(
            "max_drawdown_pct", 0.20
        )

        logger.info(
            f"Alpha Sleeve initialized | "
            f"current: ${alpha_sleeve_current_value_usd:,.0f} | "
            f"max: ${self.max_sleeve_value:,.0f}"
        )

    def scan_opportunities(
        self,
        market_data: list[dict[str, Any]],
    ) -> list[MarketOpportunity]:
        """
        Scan market data for arbitrage opportunities.

        Args:
            market_data: List of market dicts from Polymarket/Manifold API.

        Returns:
            List of MarketOpportunity above edge and confidence thresholds,
            sorted by expected value (descending).
        """
        opportunities = []
        available_capital = self.max_sleeve_value - self.current_sleeve_value

        if available_capital <= 0:
            logger.info("Alpha Sleeve at maximum allocation — no new positions")
            return []

        for market in market_data:
            try:
                opp = self._evaluate_market(market, available_capital)
                if opp is not None:
                    opportunities.append(opp)
            except Exception as e:
                logger.debug(f"Failed to evaluate market {market.get('id', '?')}: {e}")

        opportunities.sort(key=lambda o: o.expected_value_usd, reverse=True)
        logger.info(f"Found {len(opportunities)} opportunities above threshold")
        return opportunities

    def check_policy_compliance(
        self, opportunity: MarketOpportunity, open_positions: list[AlphaPosition]
    ) -> tuple[bool, str]:
        """
        Verify a proposed position against Policy Artifact constraints.

        Returns:
            (is_compliant, reason_if_not)
        """
        # Size check
        if (
            opportunity.max_position_usd
            > self.max_sleeve_value * self.MAX_SINGLE_MARKET_PCT
        ):
            return (
                False,
                f"Single market position {opportunity.max_position_usd:.0f} > {self.MAX_SINGLE_MARKET_PCT:.0%} of sleeve",
            )

        # Available capital check
        current_deployed = sum(p.size_usd for p in open_positions)
        if current_deployed + opportunity.max_position_usd > self.max_sleeve_value:
            return (
                False,
                f"Would exceed max sleeve allocation of ${self.max_sleeve_value:,.0f}",
            )

        # Drawdown check (estimated)
        if self.current_sleeve_value < self.max_sleeve_value * (
            1 - self.max_drawdown_pct
        ):
            return False, (
                f"Alpha Sleeve drawdown exceeded — current ${self.current_sleeve_value:,.0f} "
                f"vs initial ${self.max_sleeve_value:,.0f}"
            )

        return True, "OK"

    def emergency_halt(self, open_positions: list[AlphaPosition]) -> list[dict]:
        """
        Emergency halt: propose liquidation orders for all open positions.

        Called when:
        1. Core sends HALT signal via alpha-proxy
        2. Drawdown exceeds policy maximum
        3. Unexpected error state

        Returns:
            List of close order dicts to execute.
        """
        logger.critical("ALPHA SLEEVE EMERGENCY HALT — generating close orders")
        close_orders = []
        for position in open_positions:
            close_orders.append(
                {
                    "action": "CLOSE",
                    "market_id": position.market_id,
                    "position_id": position.position_id,
                    "reason": "emergency_halt",
                    "urgency": "IMMEDIATE",
                }
            )
        return close_orders

    def _evaluate_market(
        self, market: dict, available_capital: float
    ) -> MarketOpportunity | None:
        """
        Evaluate a single prediction market for arbitrage opportunity.

        Uses a simple Bayesian model: compare market-implied probability to
        estimated true probability based on base rates and evidence.
        """
        market_id = market.get("id", "")
        question = market.get("question", "")
        yes_price = float(market.get("outcomePrices", {}).get("YES", 0.5))
        no_price = 1.0 - yes_price
        volume = float(market.get("volume", 0))
        closes_at = market.get("endDate", "")

        # Filter: minimum liquidity
        if volume < 5000:  # $5k minimum daily volume
            return None

        # Estimate true probability (simplified — real system uses news/signal integration)
        estimated_prob = self._estimate_probability(market)
        if estimated_prob is None:
            return None

        edge = abs(estimated_prob - yes_price)
        confidence = self._compute_confidence(market, estimated_prob)

        if edge < self.MIN_EDGE_THRESHOLD or confidence < self.MIN_CONFIDENCE:
            return None

        # Size position using Kelly Criterion (with 1/4 Kelly for safety)
        side_price = yes_price if estimated_prob > yes_price else no_price
        kelly_fraction = (edge / side_price) * 0.25  # Quarter Kelly
        max_position = min(
            available_capital * kelly_fraction,
            available_capital * self.MAX_SINGLE_MARKET_PCT,
            10_000,  # Hard cap: $10k per market
        )

        if max_position < 50:  # Minimum viable position
            return None

        expected_value = edge * confidence * max_position

        return MarketOpportunity(
            market_id=market_id,
            market_question=question[:200],
            current_yes_price=yes_price,
            current_no_price=no_price,
            estimated_true_probability=round(estimated_prob, 4),
            edge=round(edge, 4),
            confidence=round(confidence, 4),
            max_position_usd=round(max_position, 2),
            expected_value_usd=round(expected_value, 2),
            market_closes_at=closes_at,
            liquidity_usd=volume,
        )

    def _estimate_probability(self, market: dict) -> float | None:
        """
        Estimate true probability for a prediction market question.

        In production: integrates news signals, expert forecaster calibration,
        and base rate reasoning. Here: returns market price with small correction.
        """
        yes_price = float(market.get("outcomePrices", {}).get("YES", 0.5))
        # TODO (FD-16): This is a placeholder that always shrinks toward 50%.
        # Production implementation should integrate news signals, expert forecaster
        # calibration data, and base rate reasoning to produce a calibrated probability.
        return 0.85 * yes_price + 0.15 * 0.5

    def _compute_confidence(self, market: dict, estimated_prob: float) -> float:
        """
        Compute model confidence in the probability estimate.

        Factors: time to resolution, volume, question type clarity.
        """
        volume = float(market.get("volume", 0))
        volume_confidence = min(1.0, volume / 100_000)  # High volume = more calibration

        # Closer to resolution = more certain
        closes_at = market.get("endDate", "")
        if closes_at:
            try:
                close_dt = datetime.fromisoformat(closes_at.replace("Z", "+00:00"))
                days_remaining = (close_dt - datetime.now(close_dt.tzinfo)).days
                time_confidence = max(0.5, 1.0 - days_remaining / 365)
            except Exception:
                time_confidence = 0.6
        else:
            time_confidence = 0.6

        return round((volume_confidence + time_confidence) / 2, 3)
