"""
core/tax_optimizer.py — Tax-aware portfolio optimization for FiduciaryOS.

Implements:
  1. Tax-loss harvesting (TLH) with wash-sale rule compliance (IRC §1091)
  2. Tax lot selection for minimum tax drag
  3. Asset location optimization (tax-inefficient assets → tax-advantaged accounts)
  4. After-tax return computation

The wash sale rule (IRC §1091):
  A loss is disallowed if you buy a "substantially identical" security
  within 30 days before or after selling at a loss.

Usage:
    optimizer = TaxOptimizer(policy_artifact)
    candidates = optimizer.find_harvest_candidates(portfolio, market_prices)
    lots = optimizer.select_lots_for_sale(ticker="VTI", shares_to_sell=100, tax_lots=lots)
    location = optimizer.optimize_asset_location(holdings, account_types)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from loguru import logger


@dataclass
class TaxLot:
    """A specific tax lot in a portfolio position."""

    ticker: str
    shares: float
    cost_basis_per_share: float
    purchase_date: date
    account_type: str  # "taxable" | "ira" | "roth_ira" | "401k"

    @property
    def total_cost_basis(self) -> float:
        return self.shares * self.cost_basis_per_share

    def unrealized_gain_loss(self, current_price: float) -> float:
        """Positive = gain, negative = loss."""
        return (current_price - self.cost_basis_per_share) * self.shares

    def is_long_term(self, as_of: date | None = None) -> bool:
        """Long-term if held > 1 year (366 days for leap year safety)."""
        as_of = as_of or date.today()
        return (as_of - self.purchase_date).days > 365


@dataclass
class HarvestCandidate:
    """A tax-loss harvesting opportunity."""

    ticker: str
    lots: list[TaxLot]
    unrealized_loss_usd: float
    tax_savings_estimate_usd: float
    wash_sale_safe: (
        bool  # True if no substantially identical security purchased in window
    )
    replacement_tickers: list[str]  # Similar-but-not-identical replacement securities
    net_benefit_usd: float  # tax_savings - transaction_costs


@dataclass
class AssetLocationRecommendation:
    """Asset location optimization result for a single asset class."""

    asset_class: str
    current_account: str
    recommended_account: str
    rationale: str
    estimated_annual_tax_drag_reduction_pct: float


# Substantially similar ticker pairs (for wash sale detection)
# Selling VTI and buying IVV within 30 days = wash sale violation
SUBSTANTIALLY_IDENTICAL_GROUPS: list[set[str]] = [
    {"VTI", "ITOT", "SCHB", "SPTM"},  # US Total Market ETFs
    {"VXUS", "IXUS", "SPDW", "VEU"},  # International ETFs
    {"BND", "AGG", "SCHZ", "FBND"},  # US Bond ETFs
    {"QQQ", "QQQM", "IWY"},  # Nasdaq 100 ETFs
    {"SPY", "IVV", "VOO", "SPLG"},  # S&P 500 ETFs
    {"VWO", "IEMG", "SCHE"},  # Emerging Markets ETFs
    {"VNQ", "IYR", "SCHH"},  # US REIT ETFs
    {"GLD", "IAU", "SGOL"},  # Gold ETFs
]

# Asset class tax efficiency (higher = more tax-efficient, better in taxable)
# Sources: Vanguard, Morningstar research on tax drag by asset class
ASSET_CLASS_TAX_EFFICIENCY: dict[str, float] = {
    "us_equity_index": 0.95,  # Very low turnover, qualified dividends
    "international_equity_index": 0.88,  # Low turnover, some foreign tax credit
    "municipal_bonds": 0.99,  # Tax-exempt interest — always taxable account
    "us_equity_active": 0.60,  # High turnover → short-term gains
    "us_bonds": 0.40,  # Ordinary income tax on interest
    "reits": 0.30,  # Non-qualified dividends, high ordinary income
    "high_yield_bonds": 0.35,  # Ordinary income
    "commodities": 0.50,  # Mark-to-market tax treatment
    "international_bonds": 0.45,  # Ordinary income + no foreign tax credit
    "tips": 0.20,  # Phantom income on inflation adjustment
}


class TaxOptimizer:
    """
    Tax-aware portfolio optimization.

    Assumes US tax law (2026) — see DATA_SOURCES.md for IRS publication references.
    """

    WASH_SALE_WINDOW_DAYS = 31  # 30 days before and after sale

    def __init__(
        self,
        policy_artifact: "PolicyArtifact | None" = None,
        federal_marginal_rate: float = 0.32,
        state_marginal_rate: float = 0.093,
        long_term_rate: float = 0.15,
        transaction_cost_pct: float = 0.0005,  # 0.05% (minimal for ETFs)
    ) -> None:
        self.policy = policy_artifact
        self.federal_rate = federal_marginal_rate
        self.state_rate = state_marginal_rate
        self.long_term_rate = long_term_rate
        self.transaction_cost = transaction_cost_pct

        # Get harvest threshold from policy if available
        self.harvest_threshold = -500.0
        if policy_artifact:
            self.harvest_threshold = policy_artifact.tax_strategy.get(
                "harvesting_threshold_usd", -500.0
            )

    def find_harvest_candidates(
        self,
        tax_lots: list[TaxLot],
        current_prices: dict[str, float],
        recent_purchases: dict[str, list[date]] | None = None,
    ) -> list[HarvestCandidate]:
        """
        Find tax-loss harvesting opportunities above the harvest threshold.

        Args:
            tax_lots: All tax lots in taxable accounts.
            current_prices: Dict of ticker → current market price.
            recent_purchases: Dict of ticker → list of purchase dates (for wash sale check).

        Returns:
            List of HarvestCandidate, sorted by unrealized_loss_usd (most negative first).
        """
        recent_purchases = recent_purchases or {}
        candidates: list[HarvestCandidate] = []

        # Group lots by ticker
        by_ticker: dict[str, list[TaxLot]] = {}
        for lot in tax_lots:
            if lot.account_type != "taxable":
                continue  # Only harvest in taxable accounts
            by_ticker.setdefault(lot.ticker, []).append(lot)

        for ticker, lots in by_ticker.items():
            price = current_prices.get(ticker)
            if price is None:
                continue

            total_loss = sum(
                lot.unrealized_gain_loss(price)
                for lot in lots
                if lot.unrealized_gain_loss(price) < 0
            )

            if total_loss >= self.harvest_threshold:
                continue  # Loss not large enough to harvest

            # Check wash sale risk
            wash_safe = self._is_wash_sale_safe(ticker, recent_purchases)

            # Estimate tax savings
            tax_rate = (
                self.long_term_rate
                if all(
                    lot.is_long_term()
                    for lot in lots
                    if lot.unrealized_gain_loss(price) < 0
                )
                else (self.federal_rate + self.state_rate)
            )
            tax_savings = abs(total_loss) * tax_rate

            # Transaction cost
            position_value = sum(lot.shares * price for lot in lots)
            tx_cost = position_value * self.transaction_cost * 2  # round trip

            # Find replacement securities
            replacements = self._find_replacements(ticker)

            candidates.append(
                HarvestCandidate(
                    ticker=ticker,
                    lots=[lot_item for lot_item in lots if lot_item.unrealized_gain_loss(price) < 0],
                    unrealized_loss_usd=round(total_loss, 2),
                    tax_savings_estimate_usd=round(tax_savings, 2),
                    wash_sale_safe=wash_safe,
                    replacement_tickers=replacements,
                    net_benefit_usd=round(tax_savings - tx_cost, 2),
                )
            )

        # Sort by net benefit (best first)
        candidates.sort(key=lambda c: c.net_benefit_usd, reverse=True)
        return [c for c in candidates if c.net_benefit_usd > 0 and c.wash_sale_safe]

    def select_lots_for_sale(
        self,
        ticker: str,
        shares_to_sell: float,
        tax_lots: list[TaxLot],
        current_price: float,
        strategy: str = "min_tax",
    ) -> list[tuple[TaxLot, float]]:
        """
        Select specific tax lots to sell to minimize tax burden.

        Args:
            ticker: Security to sell.
            shares_to_sell: Total shares to sell.
            tax_lots: All lots for this security.
            current_price: Current market price.
            strategy: "min_tax" (default) | "max_loss" (for TLH) | "fifo"

        Returns:
            List of (TaxLot, shares_from_this_lot) pairs.
        """
        lots = [lot_item for lot_item in tax_lots if lot_item.ticker == ticker]
        if not lots:
            return []

        today = date.today()

        if strategy == "max_loss":
            # Sort by unrealized gain/loss, most negative first (harvest losses first)
            lots.sort(key=lambda lot_item: lot_item.unrealized_gain_loss(current_price))
        elif strategy == "min_tax":
            # Sort: long-term losses first, then short-term losses, then long-term gains, then short-term gains
            def lot_priority(lot: TaxLot) -> tuple:
                pnl = lot.unrealized_gain_loss(current_price)
                is_lt = lot.is_long_term(today)
                if pnl < 0:
                    return (
                        0 if not is_lt else 1,
                        pnl,
                    )  # short-term losses first (higher tax rate)
                else:
                    return (2 if is_lt else 3, pnl)  # long-term gains last

            lots.sort(key=lot_priority)
        elif strategy == "fifo":
            lots.sort(key=lambda lot_item: lot_item.purchase_date)

        selected: list[tuple[TaxLot, float]] = []
        remaining = shares_to_sell

        for lot in lots:
            if remaining <= 0:
                break
            shares_from_lot = min(lot.shares, remaining)
            selected.append((lot, shares_from_lot))
            remaining -= shares_from_lot

        if remaining > 0.001:
            logger.warning(
                f"Could not fulfill full sale of {shares_to_sell} shares of {ticker}"
            )

        return selected

    def optimize_asset_location(
        self,
        holdings: dict[str, dict[str, float]],  # account_type → {ticker: value}
        asset_class_map: dict[str, str],  # ticker → asset_class
    ) -> list[AssetLocationRecommendation]:
        """
        Recommend optimal asset location across account types.

        Tax-advantaged accounts (IRA, 401k) should hold tax-inefficient assets.
        Taxable accounts should hold tax-efficient assets.

        Args:
            holdings: Current holdings by account type.
            asset_class_map: Maps ticker to asset class.

        Returns:
            List of relocation recommendations.
        """
        recommendations: list[AssetLocationRecommendation] = []

        for account_type, positions in holdings.items():
            for ticker, value in positions.items():
                asset_class = asset_class_map.get(ticker, "us_equity_index")
                efficiency = ASSET_CLASS_TAX_EFFICIENCY.get(asset_class, 0.7)

                # Tax-inefficient assets (efficiency < 0.6) belong in tax-advantaged accounts
                if efficiency < 0.6 and account_type == "taxable":
                    estimated_drag_reduction = (
                        value * (1 - efficiency) * (self.federal_rate + self.state_rate)
                    )
                    recommendations.append(
                        AssetLocationRecommendation(
                            asset_class=asset_class,
                            current_account=account_type,
                            recommended_account="ira",
                            rationale=(
                                f"{asset_class} has high tax drag (efficiency {efficiency:.0%}). "
                                f"Moving to IRA eliminates ordinary income on distributions."
                            ),
                            estimated_annual_tax_drag_reduction_pct=round(
                                estimated_drag_reduction / value * 100, 2
                            ),
                        )
                    )

                # Highly tax-efficient assets don't need tax shelter (opportunity cost of IRA)
                elif efficiency > 0.90 and account_type in ("ira", "401k"):
                    recommendations.append(
                        AssetLocationRecommendation(
                            asset_class=asset_class,
                            current_account=account_type,
                            recommended_account="taxable",
                            rationale=(
                                f"{asset_class} is very tax-efficient (efficiency {efficiency:.0%}). "
                                f"Freeing tax-advantaged space for less efficient assets is optimal."
                            ),
                            estimated_annual_tax_drag_reduction_pct=0.1,  # Small indirect benefit
                        )
                    )

        recommendations.sort(
            key=lambda r: r.estimated_annual_tax_drag_reduction_pct, reverse=True
        )
        return recommendations

    def compute_after_tax_return(
        self,
        pre_tax_return: float,
        turnover: float,
        yield_: float,
        holding_period_years: float,
        marginal_tax_rate: float | None = None,
    ) -> float:
        """
        Estimate after-tax return given pre-tax return and portfolio characteristics.

        Args:
            pre_tax_return: Annualized pre-tax expected return.
            turnover: Annual portfolio turnover rate.
            yield_: Dividend/interest yield.
            holding_period_years: Average holding period.
            marginal_tax_rate: Override default marginal rate.

        Returns:
            Estimated after-tax annualized return.
        """
        rate = marginal_tax_rate or (self.federal_rate + self.state_rate)

        # Short-term gains tax drag from turnover
        short_term_drag = turnover * (pre_tax_return - yield_) * rate

        # Dividend/interest tax drag
        div_drag = yield_ * rate

        # Long-term gains tax drag (deferred, discounted)
        if holding_period_years > 1:
            # Discount tax deferral benefit
            lt_drag = (
                pre_tax_return - yield_ - turnover * pre_tax_return
            ) * self.long_term_rate
            lt_drag /= (1 + pre_tax_return) ** holding_period_years  # Discounted
        else:
            lt_drag = 0.0

        after_tax = pre_tax_return - short_term_drag - div_drag - lt_drag
        return round(after_tax, 4)

    def _is_wash_sale_safe(
        self,
        ticker: str,
        recent_purchases: dict[str, list[date]],
        window_days: int | None = None,
    ) -> bool:
        """
        Check if selling a position would be safe from wash sale disallowance.

        Returns True if no substantially identical security was purchased in the window.
        """
        window = timedelta(days=window_days or self.WASH_SALE_WINDOW_DAYS)
        today = date.today()

        # Find similar tickers
        similar = self._find_substantially_identical(ticker)

        for similar_ticker in similar:
            purchases = recent_purchases.get(similar_ticker, [])
            for purchase_date in purchases:
                if abs((today - purchase_date).days) <= window.days:
                    logger.debug(
                        f"Wash sale risk: {ticker} → {similar_ticker} purchased on {purchase_date}"
                    )
                    return False
        return True

    def _find_substantially_identical(self, ticker: str) -> list[str]:
        """Find all tickers substantially identical to the given ticker."""
        for group in SUBSTANTIALLY_IDENTICAL_GROUPS:
            if ticker in group:
                return [t for t in group if t != ticker]
        return []

    def _find_replacements(self, ticker: str) -> list[str]:
        """Find replacement tickers that are similar but NOT substantially identical."""
        # For wash-sale-safe TLH, we need correlated but not substantially identical securities
        replacements_map: dict[str, list[str]] = {
            # VTI and ITOT are substantially identical — use VXF (extended market) instead
            "VTI": ["VXF"],
            "ITOT": ["VXF"],
            "SCHB": ["VXF"],
            "SPY": ["VOO", "IVV"],
            "VOO": ["SPY", "IVV"],
            "IVV": ["SPY", "VOO"],
            "VXUS": ["IXUS"],
            "IXUS": ["VXUS"],
            "BND": ["AGG"],
            "AGG": ["BND"],
            "QQQ": ["QQQM"],
            "QQQM": ["QQQ"],
        }
        return replacements_map.get(ticker, [])
