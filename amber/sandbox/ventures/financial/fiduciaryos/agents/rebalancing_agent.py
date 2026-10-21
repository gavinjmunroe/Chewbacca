"""
agents/rebalancing_agent.py — Tax-aware portfolio rebalancing agent.

The RebalancingAgent handles periodic and drift-triggered rebalancing with
full tax awareness:
  1. Detect allocation drift from policy target
  2. Compute minimum trades needed to restore target (minimize turnover)
  3. Select tax-optimal lots for any sells
  4. Apply wash-sale constraints
  5. Apply transaction cost model
  6. Generate ordered trade list with expected tax impact

The agent never executes trades directly — it produces a RebalancePlan
that must pass through PolicyCompiler and RiskGuardian before execution.

Usage:
    agent = RebalancingAgent(policy_artifact, tax_optimizer)
    plan = agent.plan(portfolio_state, current_prices, tax_lots)
    if plan.required:
        print(f"Rebalance: {len(plan.trades)} trades, "
              f"tax_impact=${plan.total_estimated_tax_usd:,.0f}")
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from loguru import logger

from core.policy_compiler import PolicyArtifact
from core.tax_optimizer import TaxLot, TaxOptimizer


@dataclass
class Trade:
    """A single proposed trade in the rebalancing plan."""

    ticker: str
    action: str  # "BUY" | "SELL"
    shares: float
    estimated_price: float
    notional_usd: float
    reason: str  # "DRIFT_CORRECTION" | "CASH_DEPLOY" | "TLH" | "MANUAL"

    # Tax metadata (for sells only)
    lot_selection_strategy: str = "min_tax"  # "min_tax" | "max_loss" | "fifo"
    estimated_short_term_gain_usd: float = 0.0
    estimated_long_term_gain_usd: float = 0.0
    estimated_tax_usd: float = 0.0
    wash_sale_safe: bool = True

    # Execution metadata
    order_type: str = "MARKET"  # "MARKET" | "LIMIT" | "TWAP"
    urgency: str = "NORMAL"  # "NORMAL" | "URGENT" | "DEFER"


@dataclass
class RebalancePlan:
    """Complete rebalancing plan for a portfolio."""

    client_id: str
    generated_at: str
    required: bool  # False if drift is within tolerance
    drift_from_target: dict[str, float]  # asset_class → absolute drift
    max_drift_pct: float  # Largest single drift

    trades: list[Trade]
    total_buy_usd: float
    total_sell_usd: float
    total_estimated_tax_usd: float  # Net tax impact (positive = tax cost)
    total_transaction_cost_usd: float
    net_cost_usd: float  # total_tax + total_transaction_cost

    # Context
    rebalance_trigger: str  # "DRIFT" | "SCHEDULED" | "CASH_INFLOW" | "MANUAL"
    drift_details: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class RebalancingAgent:
    """
    Tax-aware portfolio rebalancing agent.

    Core algorithm:
    1. Compute current vs target allocation for each asset class
    2. Flag asset classes exceeding drift_threshold
    3. For each over-weight asset class: sell the excess using min-tax lot selection
    4. For each under-weight asset class: buy to fill gap (using sell proceeds + cash)
    5. Order sells before buys (proceeds fund buys)
    6. Apply wash-sale constraints (defer sell if wash-sale risk)

    Tax optimization:
    - Prefer harvesting losses before realizing gains (net tax benefit)
    - Use short-term losses first (higher tax rate)
    - Defer short-term gains if near 1-year mark
    - Respect wash-sale window for all substitutions
    """

    def __init__(
        self,
        policy_artifact: PolicyArtifact | None = None,
        tax_optimizer: TaxOptimizer | None = None,
        drift_threshold: float = 0.05,  # 5% absolute drift before rebalance
        transaction_cost_pct: float = 0.0005,  # 0.05% per leg
    ) -> None:
        self.policy = policy_artifact
        self.tax_optimizer = tax_optimizer or TaxOptimizer(policy_artifact)
        self.drift_threshold = drift_threshold
        self.transaction_cost_pct = transaction_cost_pct

        # Read drift threshold from policy if available
        if policy_artifact:
            self.drift_threshold = policy_artifact.constraints.get(
                "rebalance_threshold", drift_threshold
            )

    def plan(
        self,
        holdings: dict[str, float],  # ticker → current_value_usd
        target_allocation: dict[str, float],  # asset_class → target_fraction
        ticker_to_asset_class: dict[str, str],  # ticker → asset_class
        total_portfolio_value: float,
        cash_usd: float,
        tax_lots: list[TaxLot] | None = None,
        current_prices: dict[str, float] | None = None,
        recent_purchases: dict[str, list[date]] | None = None,
        trigger: str = "DRIFT",
        client_id: str = "",
    ) -> RebalancePlan:
        """
        Generate a tax-optimized rebalancing plan.

        Args:
            holdings: Current portfolio holdings (ticker → USD value).
            target_allocation: Policy target by asset class (fractions summing to 1.0).
            ticker_to_asset_class: Maps each ticker to its asset class.
            total_portfolio_value: Total portfolio value including cash.
            cash_usd: Available cash (already included in total_portfolio_value).
            tax_lots: All tax lots for lot-level sell selection.
            current_prices: Current market prices (ticker → price).
            recent_purchases: Recent purchase dates for wash-sale checking.
            trigger: What triggered this rebalance.
            client_id: Client identifier for logging.

        Returns:
            RebalancePlan with ordered trade list.
        """
        current_prices = current_prices or {}
        tax_lots = tax_lots or []
        recent_purchases = recent_purchases or {}

        logger.info(
            f"Rebalancing analysis for client {client_id[:8] or 'unknown'}... | "
            f"trigger={trigger} | portfolio=${total_portfolio_value:,.0f}"
        )

        # Step 1: Compute current allocation by asset class
        current_by_class = self._aggregate_by_class(holdings, ticker_to_asset_class)

        # Add cash as its own class
        current_by_class["cash"] = cash_usd
        if "cash" not in target_allocation:
            target_allocation = {**target_allocation}
            target_allocation.setdefault("cash", 0.0)

        # Step 2: Compute drift
        drift = self._compute_drift(
            current_by_class, target_allocation, total_portfolio_value
        )
        max_drift = max(abs(v) for v in drift.values()) if drift else 0.0
        drift_details = [
            f"{cls}: current {(current_by_class.get(cls, 0) / total_portfolio_value):.1%} "
            f"vs target {target_allocation.get(cls, 0):.1%} "
            f"(drift {drift.get(cls, 0):+.1%})"
            for cls in sorted(
                drift.keys(), key=lambda k: abs(drift.get(k, 0)), reverse=True
            )
        ]

        logger.info(
            f"Max allocation drift: {max_drift:.1%} (threshold: {self.drift_threshold:.1%})"
        )

        # Check if rebalance is needed
        required = max_drift > self.drift_threshold
        if not required and trigger not in ("MANUAL", "CASH_INFLOW"):
            return RebalancePlan(
                client_id=client_id,
                generated_at=datetime.utcnow().isoformat(),
                required=False,
                drift_from_target=drift,
                max_drift_pct=max_drift,
                trades=[],
                total_buy_usd=0.0,
                total_sell_usd=0.0,
                total_estimated_tax_usd=0.0,
                total_transaction_cost_usd=0.0,
                net_cost_usd=0.0,
                rebalance_trigger=trigger,
                drift_details=drift_details,
                notes=[
                    f"No rebalance needed: max drift {max_drift:.1%} < threshold {self.drift_threshold:.1%}"
                ],
            )

        # Step 3: Compute target values
        target_values = {
            cls: total_portfolio_value * frac for cls, frac in target_allocation.items()
        }

        # Step 4: Identify sells (over-weight) and buys (under-weight)
        sells_needed: dict[str, float] = {}  # asset_class → USD to sell
        buys_needed: dict[str, float] = {}  # asset_class → USD to buy

        for cls, target_val in target_values.items():
            current_val = current_by_class.get(cls, 0.0)
            delta = target_val - current_val
            if delta < -500:  # Need to sell (over-weight by >$500)
                sells_needed[cls] = abs(delta)
            elif delta > 500:  # Need to buy (under-weight by >$500)
                buys_needed[cls] = delta

        # Step 5: Build trade list (sells first, then buys)
        trades: list[Trade] = []
        total_tax = 0.0

        # Generate sell trades
        for asset_class, sell_amount in sells_needed.items():
            class_trades, tax = self._generate_sell_trades(
                asset_class=asset_class,
                sell_amount_usd=sell_amount,
                holdings=holdings,
                ticker_to_asset_class=ticker_to_asset_class,
                tax_lots=tax_lots,
                current_prices=current_prices,
                recent_purchases=recent_purchases,
            )
            trades.extend(class_trades)
            total_tax += tax

        # Generate buy trades
        for asset_class, buy_amount in buys_needed.items():
            class_trades = self._generate_buy_trades(
                asset_class=asset_class,
                buy_amount_usd=buy_amount,
                holdings=holdings,
                ticker_to_asset_class=ticker_to_asset_class,
                current_prices=current_prices,
            )
            trades.extend(class_trades)

        # Step 6: Compute totals
        total_buy = sum(t.notional_usd for t in trades if t.action == "BUY")
        total_sell = sum(t.notional_usd for t in trades if t.action == "SELL")
        total_tx_cost = (total_buy + total_sell) * self.transaction_cost_pct

        notes = []
        if trigger == "CASH_INFLOW":
            notes.append(
                "Rebalance triggered by new cash inflow — deploying to under-weight asset classes"
            )
        deferred = [t for t in trades if t.urgency == "DEFER"]
        if deferred:
            notes.append(
                f"{len(deferred)} sell(s) deferred due to wash-sale risk: "
                + ", ".join(t.ticker for t in deferred)
            )

        plan = RebalancePlan(
            client_id=client_id,
            generated_at=datetime.utcnow().isoformat(),
            required=True,
            drift_from_target=drift,
            max_drift_pct=max_drift,
            trades=trades,
            total_buy_usd=round(total_buy, 2),
            total_sell_usd=round(total_sell, 2),
            total_estimated_tax_usd=round(total_tax, 2),
            total_transaction_cost_usd=round(total_tx_cost, 2),
            net_cost_usd=round(total_tax + total_tx_cost, 2),
            rebalance_trigger=trigger,
            drift_details=drift_details,
            notes=notes,
        )

        logger.info(
            f"Rebalance plan: {len(trades)} trades | "
            f"sell=${total_sell:,.0f} | buy=${total_buy:,.0f} | "
            f"est. tax=${total_tax:,.0f}"
        )
        return plan

    def _aggregate_by_class(
        self,
        holdings: dict[str, float],
        ticker_to_asset_class: dict[str, str],
    ) -> dict[str, float]:
        """Sum holdings by asset class."""
        by_class: dict[str, float] = {}
        for ticker, value in holdings.items():
            cls = ticker_to_asset_class.get(ticker, "us_equity_index")
            by_class[cls] = by_class.get(cls, 0.0) + value
        return by_class

    def _compute_drift(
        self,
        current_by_class: dict[str, float],
        target_allocation: dict[str, float],
        total_value: float,
    ) -> dict[str, float]:
        """
        Compute allocation drift (current - target) as fraction of portfolio.
        Positive = over-weight, negative = under-weight.
        """
        drift: dict[str, float] = {}
        all_classes = set(current_by_class.keys()) | set(target_allocation.keys())
        for cls in all_classes:
            current_frac = current_by_class.get(cls, 0.0) / max(total_value, 1.0)
            target_frac = target_allocation.get(cls, 0.0)
            drift[cls] = round(current_frac - target_frac, 4)
        return drift

    def _generate_sell_trades(
        self,
        asset_class: str,
        sell_amount_usd: float,
        holdings: dict[str, float],
        ticker_to_asset_class: dict[str, str],
        tax_lots: list[TaxLot],
        current_prices: dict[str, float],
        recent_purchases: dict[str, list[date]],
    ) -> tuple[list[Trade], float]:
        """Generate sell trades for an over-weight asset class."""
        # Find tickers in this asset class, sorted by value (sell largest first)
        class_tickers = [
            (t, v)
            for t, v in holdings.items()
            if ticker_to_asset_class.get(t) == asset_class and v > 0
        ]
        class_tickers.sort(key=lambda x: x[1], reverse=True)

        trades: list[Trade] = []
        total_tax = 0.0
        remaining = sell_amount_usd

        for ticker, holding_value in class_tickers:
            if remaining <= 0:
                break

            price = current_prices.get(ticker)
            if price is None or price <= 0:
                logger.error(f"No valid price available for {ticker} — skipping trade")
                continue

            sell_usd = min(holding_value, remaining)
            shares_to_sell = sell_usd / price

            # Check wash-sale safety
            wash_safe = self.tax_optimizer._is_wash_sale_safe(ticker, recent_purchases)

            # Tax estimation
            ticker_lots = [
                lot_item
                for lot_item in tax_lots
                if lot_item.ticker == ticker and lot_item.account_type == "taxable"
            ]
            st_gain = 0.0
            lt_gain = 0.0
            est_tax = 0.0

            if ticker_lots:
                selected = self.tax_optimizer.select_lots_for_sale(
                    ticker=ticker,
                    shares_to_sell=shares_to_sell,
                    tax_lots=ticker_lots,
                    current_price=price,
                    strategy="min_tax",
                )
                for lot, shares_sold in selected:
                    gain = lot.unrealized_gain_loss(price) * (shares_sold / lot.shares)
                    if lot.is_long_term():
                        lt_gain += gain
                    else:
                        st_gain += gain

                rate_st = (
                    self.tax_optimizer.federal_rate + self.tax_optimizer.state_rate
                )
                est_tax = (
                    max(0, st_gain) * rate_st
                    + max(0, lt_gain) * self.tax_optimizer.long_term_rate
                )

            trade = Trade(
                ticker=ticker,
                action="SELL",
                shares=round(shares_to_sell, 4),
                estimated_price=price,
                notional_usd=round(sell_usd, 2),
                reason="DRIFT_CORRECTION",
                lot_selection_strategy="min_tax",
                estimated_short_term_gain_usd=round(st_gain, 2),
                estimated_long_term_gain_usd=round(lt_gain, 2),
                estimated_tax_usd=round(est_tax, 2),
                wash_sale_safe=wash_safe,
                urgency="DEFER" if not wash_safe else "NORMAL",
            )
            trades.append(trade)
            total_tax += est_tax
            remaining -= sell_usd

        return trades, total_tax

    def _generate_buy_trades(
        self,
        asset_class: str,
        buy_amount_usd: float,
        holdings: dict[str, float],
        ticker_to_asset_class: dict[str, str],
        current_prices: dict[str, float],
    ) -> list[Trade]:
        """Generate buy trades for an under-weight asset class."""
        # Find existing tickers in this class (buy existing positions first)
        class_tickers = [
            t
            for t, _ in holdings.items()
            if ticker_to_asset_class.get(t) == asset_class
        ]

        if not class_tickers:
            # Use policy default tickers or skip
            logger.warning(
                f"No existing tickers for asset class {asset_class} — cannot auto-select"
            )
            return []

        # Buy the largest existing holding (simplest: maintain existing weights)
        ticker = max(class_tickers, key=lambda t: holdings.get(t, 0))
        price = current_prices.get(ticker, 100.0)  # fallback price

        return [
            Trade(
                ticker=ticker,
                action="BUY",
                shares=round(buy_amount_usd / price, 4),
                estimated_price=price,
                notional_usd=round(buy_amount_usd, 2),
                reason="DRIFT_CORRECTION",
            )
        ]
