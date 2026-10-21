# FiduciaryOS — Training Data Sources

## Overview

FiduciaryOS is trained on fiduciary *decision quality* — not just the rules, but the reasoning behind them. The training corpus combines regulatory enforcement actions (what went wrong and why), academic portfolio theory (what optimal looks like), and real-world tax optimization case studies (the gap between theory and practice).

Total target: **350,000+ training pairs** across 5 streams.

---

## Stream 1 — Robo-Advisor Decision Logs (25% — ~87k pairs)

**Source:** Synthetic decision logs derived from robo-advisor white papers, Morningstar analyses, and financial planning case studies.

**What we synthesize:**
- Portfolio state → rebalancing decision pairs
- Drift detection → threshold-triggering decision pairs
- Tax-loss harvesting opportunity → execution decision pairs
- Asset allocation → allocation rationale pairs

**Why this is the training backbone:** Robo-advisor decisions are structured, rule-following, and well-documented. They teach the model the mechanics of portfolio management. The gap between these decisions and fiduciary-optimal is exactly what the enforcement action corpus trains the model to understand.

**Synthesis:** `synthesis/fiduciary_pairs.py`
- Portfolio state (holdings, weights, market values) → recommended action
- Tax lot selection → optimal lot sequence (minimize tax drag)
- Drift scenario → rebalancing trigger + lot selection

---

## Stream 2 — FINRA/SEC Enforcement Actions (30% — ~105k pairs)

**Source:** FINRA enforcement actions (1990–2026), SEC enforcement releases, SEC no-action letters

**FINRA database:**
- `https://www.finra.org/rules-guidance/oversight-enforcement/finra-disciplinary-actions`
- 50,000+ enforcement actions since 1990
- Each action describes: what the advisor did, what rule was violated, what the correct action should have been, what the penalty was

**SEC enforcement releases:**
- `https://www.sec.gov/litigation/litreleases/`
- Investment adviser enforcement actions
- Reg BI Best Interest violations
- Churning, unsuitability, undisclosed conflicts

**No-action letters:**
- SEC staff guidance on what IS compliant
- Creates positive examples to complement enforcement negatives

**Synthesis to pairs:**
```
Input:  "Advisor X recommended client Y move 100% of 401k into variable annuity
         generating $8,000 commission without conducting suitability analysis
         or documenting investment objectives."
Output: {
  "violation_type": "duty_of_loyalty",
  "finra_rule": "FINRA Rule 2111 (Suitability)",
  "correct_action": "Conduct and document suitability analysis; recommend
                     lower-cost alternatives; disclose commission conflict",
  "pattern_id": "FID-07",
  "severity": "SEVERE"
}
```

**Collection:** `discovery/enforcement_actions.py` — FINRA and SEC API + HTML scraper

---

## Stream 3 — CFA Institute Curriculum (20% — ~70k pairs)

**Source:** CFA Institute curriculum materials, Standards of Professional Conduct, and associated ethics cases

**Topics covered:**
- CFA Standards of Professional Conduct (Standards I-VII)
- Portfolio Management (Level 3): behavioral finance, asset allocation, performance evaluation
- Ethics in investment management: conflicts of interest, client communication, fiduciary standards
- Risk management: VaR, CVaR, drawdown analysis, stress testing
- Fixed income: duration, convexity, credit risk, yield curve strategies
- Derivatives: options for hedging, collar strategies, protective puts
- Alternative investments: real estate, private equity, hedge funds

**Why CFA curriculum:** The CFA curriculum is the closest thing to a standardized fiduciary knowledge base. It represents the consensus of the investment management profession on what "best practice" means. Training on this corpus teaches the model the *theory* — the enforcement action corpus teaches the model where theory meets reality.

**Synthesis to pairs:**
- Ethical dilemma → Standard violation analysis
- Portfolio scenario → CFA-grounded recommendation with rationale
- Risk scenario → Risk management response with quantitative justification

---

## Stream 4 — Tax Optimization Case Studies (15% — ~52k pairs)

**Source:** IRS publications, tax court cases, financial planning literature, and synthesized case studies

**Coverage:**
- **Tax-loss harvesting**: specific identification vs. FIFO vs. average cost basis; wash sale rule (IRC §1091); substitute position selection
- **Asset location**: tax-drag reduction across account types; turnover analysis; asset class tax efficiency rankings
- **Roth conversion**: marginal rate analysis; RMD interactions; Social Security benefit taxation; ACA premium implications
- **Charitable giving**: qualified charitable distributions (QCD); donor-advised funds; appreciated securities
- **Estate planning**: step-up in basis at death; gift tax annual exclusion; irrevocable life insurance trusts

**Key IRS publications synthesized:**
- Publication 550: Investment Income and Expenses
- Publication 590-A/B: IRAs
- Publication 946: Depreciation
- Publication 525: Taxable and Nontaxable Income
- Revenue Rulings on wash sale compliance

**Synthesis to pairs:**
- Tax situation → optimal TLH action + wash sale compliant replacement
- Multi-account portfolio → asset location optimization
- Income projection → Roth conversion window identification

---

## Stream 5 — Behavioral Finance + Market Microstructure (10% — ~35k pairs)

**Source:** Academic behavioral finance papers (Thaler, Kahneman, Shiller), market microstructure texts, and Polymarket historical data

**Behavioral finance topics:**
- Loss aversion and its impact on portfolio construction
- Disposition effect: tendency to hold losers, sell winners (relevant for TLH timing)
- Home bias and its effect on international diversification
- Recency bias and its correction in long-run asset allocation

**Market microstructure (for Alpha Sleeve):**
- Bid-ask spread dynamics and market impact
- Information asymmetry in prediction markets
- Arbitrage constraints and limits of arbitrage
- Polymarket historical resolution and calibration data

**Synthesis to pairs:**
- Behavioral bias scenario → debiased recommendation
- Prediction market opportunity → Alpha Sleeve action (position size, entry, exit)
- Market microstructure condition → optimal execution strategy

---

## Data Quality Filters

1. **Length filter**: discard pairs with input <100 tokens or output <50 tokens
2. **Deduplication**: MinHash LSH at 0.85 similarity
3. **Regulatory validation**: all violation classifications cross-referenced against FINRA/SEC rule corpus
4. **Tax law validation**: all tax guidance cross-referenced against IRC and current IRS publications
5. **Policy compliance check**: all recommended actions verified against a canonical test policy artifact

**Expected yield after filtering:** ~80% of raw synthesis output

---

## Dataset Statistics (Target)

| Stream | Raw pairs | After filter | Format |
|--------|-----------|--------------|--------|
| Robo-advisor decision logs | 109k | 87k | JSONL (ShareGPT) |
| FINRA/SEC enforcement | 131k | 105k | JSONL (ShareGPT) |
| CFA Institute curriculum | 88k | 70k | JSONL (ShareGPT) |
| Tax optimization | 65k | 52k | JSONL (ShareGPT) |
| Behavioral + microstructure | 44k | 35k | JSONL (ShareGPT) |
| **Total** | **437k** | **349k** | — |

Train/val/test split: 90% / 5% / 5%
