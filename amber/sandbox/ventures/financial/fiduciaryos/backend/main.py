"""
FiduciaryOS FastAPI Backend

Exposes the Python core (policy compiler, risk guardian, portfolio agent,
tax optimizer, audit log) as HTTP endpoints consumed by the Next.js web app.

Run:
    uvicorn backend.main:app --port 8000 --reload

Deploy:
    Railway, Render, or wrap with Mangum for Vercel serverless.
"""

from __future__ import annotations

import os
import sys
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Allow importing from the project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Lazy imports so the backend starts even if some deps are missing ──────────
try:
    from core.policy_compiler import PolicyCompiler, ClientProfile as CPClientProfile
    from core.risk_guardian import RiskGuardian
    from core.audit_log import AuditLog
    from core.tax_optimizer import TaxOptimizer, TaxLot
    _CORE_AVAILABLE = True
except ImportError as e:
    print(f"[warn] Core modules not fully available: {e}")
    _CORE_AVAILABLE = False

try:
    from agents.portfolio_agent import PortfolioAgent
    _AGENT_AVAILABLE = True
except ImportError as e:
    print(f"[warn] PortfolioAgent not available: {e}")
    _AGENT_AVAILABLE = False


app = FastAPI(
    title="FiduciaryOS Backend",
    version="1.0.0",
    description="Fiduciary-grade portfolio management API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://fiduciary.cash",
        "https://www.fiduciary.cash",
        "https://fiduciaryos.vercel.app",
        os.environ.get("ALLOWED_ORIGIN", ""),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ────────────────────────────────────────────────────────────

class TargetAllocation(BaseModel):
    us_equity: float = 0.50
    international_equity: float = 0.20
    us_bonds: float = 0.20
    international_bonds: float = 0.05
    alternatives: float = 0.03
    cash: float = 0.02


class RebalancingBands(BaseModel):
    equities: float = 0.05
    bonds: float = 0.03
    cash: float = 0.02


class ClientProfileRequest(BaseModel):
    client_id: str
    risk_tolerance: str = "moderate"
    time_horizon_years: int = 37
    annual_income: float = 120000
    investable_assets: float = 100000
    target_allocation: TargetAllocation = TargetAllocation()
    rebalancing_bands: RebalancingBands = RebalancingBands()
    max_drawdown_tolerance: float = 0.18
    volatility_target: float = 0.10
    excluded_sectors: list[str] = []
    excluded_securities: list[str] = []
    max_single_security_pct: float = 0.10
    liquidity_reserve_months: int = 6
    alpha_sleeve_enabled: bool = False
    alpha_sleeve_max_pct: float = 0.05


class PortfolioStateBody(BaseModel):
    client_id: str
    total_value_usd: float
    holdings: dict[str, float] = {}
    allocation: dict[str, float] = {}
    unrealized_pnl_usd: float = 0
    drawdown_from_peak: float = 0
    daily_volatility: float = 0.008
    cash_usd: float = 0


class AnalyzeRequest(BaseModel):
    client_id: str
    portfolio: PortfolioStateBody
    artifact_json: str | None = None


class VerifyRequest(BaseModel):
    artifact_json: str


class TaxLotBody(BaseModel):
    ticker: str
    shares: float
    cost_basis_per_share: float
    purchase_date: str
    account_type: str


class HarvestRequest(BaseModel):
    tax_lots: list[TaxLotBody]
    current_prices: dict[str, float]
    recent_purchases: dict[str, list[str]] = {}
    federal_marginal_rate: float = 0.32
    state_marginal_rate: float = 0.093


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "core_available": _CORE_AVAILABLE,
        "agent_available": _AGENT_AVAILABLE,
    }


@app.post("/policy/compile")
def compile_policy(req: ClientProfileRequest) -> dict[str, Any]:
    if not _CORE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Core modules not available")
    try:
        compiler = PolicyCompiler()
        profile = CPClientProfile(
            client_id=req.client_id,
            risk_tolerance=req.risk_tolerance,
            time_horizon_years=req.time_horizon_years,
            annual_income=req.annual_income,
            investable_assets=req.investable_assets,
            target_allocation=req.target_allocation.model_dump(),
            rebalancing_bands=req.rebalancing_bands.model_dump(),
            max_drawdown_tolerance=req.max_drawdown_tolerance,
            volatility_target=req.volatility_target,
            excluded_sectors=req.excluded_sectors,
            excluded_securities=req.excluded_securities,
            max_single_security_pct=req.max_single_security_pct,
            liquidity_reserve_months=req.liquidity_reserve_months,
            alpha_sleeve_enabled=req.alpha_sleeve_enabled,
            alpha_sleeve_max_pct=req.alpha_sleeve_max_pct,
        )
        artifact = compiler.compile(profile)
        artifact_json = compiler.to_json(artifact)
        return {
            "artifact_json": artifact_json,
            "expires_at": getattr(artifact, "expires_at", None),
            "signature": getattr(artifact, "signature", None),
        }
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/policy/verify")
def verify_policy(req: VerifyRequest) -> dict[str, Any]:
    if not _CORE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Core modules not available")
    try:
        compiler = PolicyCompiler()
        artifact = compiler.from_json(req.artifact_json)
        valid = compiler.verify(artifact)
        return {"valid": valid}
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/portfolio/analyze")
def analyze_portfolio(req: AnalyzeRequest) -> dict[str, Any]:
    if not _CORE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Core modules not available")
    try:
        # Determine risk level from drawdown
        drawdown = req.portfolio.drawdown_from_peak
        if drawdown > 0.15:
            risk_level = 3  # SAFE MODE
        elif drawdown > 0.10:
            risk_level = 2  # ALERT
        elif drawdown > 0.03:
            risk_level = 1  # MONITORING
        else:
            risk_level = 0  # SAFE

        risk_alerts = []
        if drawdown > 0.03:
            risk_alerts.append(f"Portfolio drawdown {drawdown:.1%} from peak")

        # Tax harvest candidates from tax_optimizer
        optimizer = TaxOptimizer(
            federal_marginal_rate=0.32,
            state_marginal_rate=0.093,
        )
        harvest_candidates = []  # Requires tax lots — not available from balance-only data

        # Simple rebalancing recommendations
        recommendations = []
        total = req.portfolio.total_value_usd
        if total > 0:
            target = req.portfolio.allocation or {"us_equity": 0.6, "us_bonds": 0.3, "cash": 0.1}
            cash_pct = req.portfolio.cash_usd / total if total > 0 else 0
            target_cash = target.get("cash", 0.02)
            if abs(cash_pct - target_cash) > 0.05:
                recommendations.append({
                    "action": "REBALANCE",
                    "ticker": "CASH",
                    "rationale": f"Cash allocation {cash_pct:.1%} deviates from target {target_cash:.1%} by more than 5%.",
                    "policy_check_passed": True,
                    "confidence": 0.85,
                })

        # Log to audit
        try:
            audit = AuditLog(client_id=req.client_id)
            audit.record(
                action_type="PORTFOLIO_ANALYSIS",
                reasoning=f"Analyzed portfolio. Drawdown: {drawdown:.2%}. Risk level: {risk_level}.",
                proposed_action={"total_value_usd": req.portfolio.total_value_usd, "risk_level": risk_level},
                policy_check_passed=True,
                portfolio_snapshot={"total_value_usd": req.portfolio.total_value_usd, "drawdown": drawdown},
            )
        except Exception:
            pass  # Audit log failure should not block analysis

        return {
            "risk_level": risk_level,
            "risk_alerts": risk_alerts,
            "harvest_candidates": harvest_candidates,
            "recommendations": recommendations,
            "policy_valid": req.artifact_json is not None,
            "policy_expires_at": None,
            "offline": False,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/harvest")
def find_harvest_candidates(req: HarvestRequest) -> dict[str, Any]:
    if not _CORE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Core modules not available")
    try:
        from datetime import date
        optimizer = TaxOptimizer(
            federal_marginal_rate=req.federal_marginal_rate,
            state_marginal_rate=req.state_marginal_rate,
        )
        lots = []
        for lb in req.tax_lots:
            lots.append(TaxLot(
                ticker=lb.ticker,
                shares=lb.shares,
                cost_basis_per_share=lb.cost_basis_per_share,
                purchase_date=date.fromisoformat(lb.purchase_date),
                account_type=lb.account_type,
            ))
        recent_purchases = {
            ticker: [date.fromisoformat(d) for d in dates]
            for ticker, dates in req.recent_purchases.items()
        }
        candidates = optimizer.find_harvest_candidates(lots, req.current_prices, recent_purchases)
        return {
            "candidates": [
                {
                    "ticker": c.ticker,
                    "unrealized_loss_usd": c.unrealized_loss_usd,
                    "tax_savings_estimate_usd": c.tax_savings_estimate_usd,
                    "wash_sale_safe": c.wash_sale_safe,
                    "replacement_tickers": c.replacement_tickers,
                    "net_benefit_usd": c.net_benefit_usd,
                }
                for c in candidates
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/audit/entries")
def get_audit_entries(client_id: str = "default", limit: int = 20) -> dict[str, Any]:
    if not _CORE_AVAILABLE:
        return {"entries": [], "offline": False}
    try:
        audit = AuditLog(client_id=client_id)
        entries = audit.get_entries(limit=limit) if hasattr(audit, "get_entries") else []
        return {
            "entries": [
                {
                    "id": getattr(e, "entry_id", str(i)),
                    "timestamp_iso": getattr(e, "timestamp_iso", ""),
                    "client_id_hash": getattr(e, "client_id_hash", ""),
                    "action_type": getattr(e, "action_type", ""),
                    "action_details": getattr(e, "proposed_action", {}),
                    "policy_check_passed": getattr(e, "policy_check_passed", True),
                    "risk_level": 0,
                    "model_reasoning": getattr(e, "reasoning", ""),
                    "signature": getattr(e, "signature", ""),
                }
                for i, e in enumerate(entries)
            ]
        }
    except Exception:
        return {"entries": []}


@app.get("/risk/status")
def get_risk_status() -> dict[str, Any]:
    return {"risk_level": 0, "alerts": [], "safe_mode": False}


@app.post("/risk/safe-mode")
def toggle_safe_mode(body: dict[str, Any]) -> dict[str, Any]:
    enable = body.get("enable", False)
    return {"safe_mode": enable, "acknowledged": True}


# ── Tax v2 endpoints ───────────────────────────────────────────────────────────

try:
    from core.tax_engine_v2 import (
        TaxProfile,
        compute_full_tax,
        compute_quarterly_estimates,
        compute_backdoor_roth_pro_rata,
        RothConversionLadder,
    )
    _TAX_V2_AVAILABLE = True
except ImportError as e:
    print(f"[warn] TaxEngineV2 not available: {e}")
    _TAX_V2_AVAILABLE = False


class TaxProjectionRequest(BaseModel):
    filing_status: str = "single"
    w2_income: float = 0
    iso_spread: float = 0
    nso_w2_income: float = 0
    short_term_gains: float = 0
    long_term_gains: float = 0
    qualified_dividends: float = 0
    ordinary_dividends: float = 0
    itemized_deductions: float = 0
    traditional_ira_contrib: float = 0
    k401_contrib: float = 0
    state_code: str = "CA"
    prior_year_tax: float = 0
    w2_withholding: float = 0
    qsbs_gain: float = 0
    qsbs_exclusion: float = 1.0


@app.post("/tax/projection")
def tax_projection(req: TaxProjectionRequest) -> dict[str, Any]:
    if not _TAX_V2_AVAILABLE:
        return {"error": "tax_engine_v2 not available", "offline": True}
    try:
        from dataclasses import asdict
        profile = TaxProfile(
            filing_status=req.filing_status,
            w2_income=req.w2_income,
            iso_spread=req.iso_spread,
            nso_w2_income=req.nso_w2_income,
            short_term_gains=req.short_term_gains,
            long_term_gains=req.long_term_gains,
            qualified_dividends=req.qualified_dividends,
            ordinary_dividends=req.ordinary_dividends,
            itemized_deductions=req.itemized_deductions,
            traditional_ira_contrib=req.traditional_ira_contrib,
            k401_contrib=req.k401_contrib,
            state_code=req.state_code,
            prior_year_tax=req.prior_year_tax,
            w2_withholding=req.w2_withholding,
            qsbs_gain=req.qsbs_gain,
            qsbs_exclusion=req.qsbs_exclusion,
        )
        result = compute_full_tax(profile)
        return asdict(result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/tax/roth-ladder")
def roth_ladder(body: dict[str, Any]) -> dict[str, Any]:
    if not _TAX_V2_AVAILABLE:
        return {"error": "tax_engine_v2 not available", "offline": True}
    try:
        ladder = RothConversionLadder()
        result = ladder.optimize(
            current_bracket_top=body.get("current_bracket_top", 103350),
            roth_balance=body.get("roth_balance", 0),
            trad_balance=body.get("trad_balance", 0),
            years_to_retirement=body.get("years_to_retirement", 25),
            expected_retirement_income=body.get("expected_retirement_income", 80000),
        )
        return {"conversions": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/tax/quarterly")
def quarterly_estimates(body: dict[str, Any]) -> dict[str, Any]:
    if not _TAX_V2_AVAILABLE:
        return {"error": "tax_engine_v2 not available", "offline": True}
    try:
        result = compute_quarterly_estimates(
            annual_tax=body.get("annual_tax", 0),
            prior_year_tax=body.get("prior_year_tax", 0),
            w2_withholding=body.get("w2_withholding", 0),
        )
        return {"quarterly_estimates": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/tax/equity")
def equity_tax(body: dict[str, Any]) -> dict[str, Any]:
    if not _TAX_V2_AVAILABLE:
        return {"error": "tax_engine_v2 not available", "offline": True}
    try:
        from core.tax_engine_v2 import TaxProfile, compute_full_tax
        from dataclasses import asdict
        profile = TaxProfile(
            filing_status=body.get("filing_status", "single"),
            w2_income=body.get("w2_income", 0),
            iso_spread=body.get("iso_spread", 0),
            nso_w2_income=body.get("nso_w2_income", 0),
            short_term_gains=body.get("short_term_gains", 0),
            long_term_gains=body.get("long_term_gains", 0),
            state_code=body.get("state_code", "CA"),
        )
        result = compute_full_tax(profile)
        return {
            "amt_triggered": result.amt_triggered,
            "amt_owed": result.amt,
            "iso_preference": body.get("iso_spread", 0),
            "recommendations": result.recommendations,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
