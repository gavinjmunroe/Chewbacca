# FiduciaryOS Roadmap

> **Mission: Replace every financial intermediary — advisors, accountants, consultants, and compliance firms — with autonomous, fiduciary-grade AI.**

---

## v1 — Manage (Shipped)

**Theme:** Autonomous portfolio management with machine-checkable fiduciary constraints.

**Capabilities:**
- Policy Compiler: IPS → signed Policy Artifact (RSA-4096)
- Portfolio construction: mean-variance optimization + factor exposure management
- Rebalancing: drift-triggered with tax-aware lot selection
- Tax-loss harvesting: wash sale compliant, threshold-configurable
- Risk Guardian: 4-level alert system with Safe Mode and automatic halt
- Audit Log: cryptographically signed, replayable decision history
- FiduciaryBench v1: violation detection + return optimization evaluation
- Alpha Sleeve (opt-in): Polymarket arbitrage, isolated container, policy-constrained

**Training (v1):**
- 462,500 pairs across 6 data streams
- SFT on Qwen2.5-32B-Instruct + LoRA rank 128
- GRPO with fiduciary violation + return + audit completeness reward
- DPO on cautious vs. aggressive action preferences
- Hardware: 18× A6000 (864GB VRAM), ~18 hours total training

---

## v2 — Replace (Current Build)

**Theme:** Full CPA + accounting replacement. FiduciaryOS replaces every finance company: advisors, accountants, tax firms, consulting firms.

### New CPA-Replacement Capabilities

**Equity Compensation Intelligence:**
- ISO tax planning: exercise timing to minimize AMT, spread vs. strike analysis, §83(b) elections
- NSO exercise optimization: W-2 income recognition, withholding strategy
- RSU vesting tax management: supplemental withholding, sell-to-cover vs. cash-settle comparison
- ESPP: qualifying vs. disqualifying disposition, 2-year holding period optimization

**Alternative Minimum Tax (AMT):**
- Full Form 6251 computation: regular income → AMTI adjustments → exemption phase-out
- ISO preference item calculation (spread at exercise is AMT preference)
- AMT credit carryforward tracking (Form 8801)
- Annual AMT headroom analysis: how much ISO spread is safe to exercise this year

**Net Investment Income Tax (NIIT §1411):**
- 3.8% surtax on net investment income above $200k/$250k MAGI threshold
- NII = dividends + interest + LTCG + passive business income
- Real-time MAGI monitoring and NII threshold forecasting

**Schedule D & Capital Gains:**
- Precise short vs. long-term netting across all accounts
- §1231 gain treatment for business property dispositions
- Wash sale rule enforcement: 30-day window tracking, disallowed loss carryforward
- Loss harvesting optimization: prioritize short-term losses (offset at ordinary rates)

**Retirement Account Mastery:**
- Backdoor Roth IRA: pro-rata rule computation (Form 8606), optimal conversion sequencing
- Roth conversion ladder: fill 22%/24% brackets to minimize lifetime tax burden
- Required Minimum Distributions: age-based factor tables, account aggregation rules
- §72(t) SEPP: substantially equal periodic payment calculation for penalty-free early withdrawals
- Inherited IRA: 10-year rule planning, eligible designated beneficiary analysis

**QSBS §1202 Planning:**
- 100% federal gain exclusion on qualified small business stock (acquired after 9/27/2010)
- C-corp requirement verification, active business test, $10M exclusion cap tracking
- QSBS stacking: gifting to family members to multiply exclusion capacity
- State tax treatment: California does not conform (taxable at CA rates)

**Multi-State Tax Apportionment:**
- California: 13.3% top marginal rate, 9 brackets, CA SDI, no LTCG preference
- New York: 10.9% top rate, NYC surtax (3.876%), resident vs. nonresident allocation
- Texas/Florida/Nevada: 0% income tax — relocation value quantification
- Washington: 7% capital gains tax on LTCG over $262,000 (as of 2023)
- Domicile optimization: days-of-presence test, tax residency change planning

**Quarterly Estimated Taxes:**
- Safe harbor: 100% of prior year tax, or 110% if AGI > $150k
- Current year method: 90% of current year estimated tax
- Underpayment penalty calculation (Form 2210)
- Cash flow calendar: April 15, June 15, September 15, January 15 due dates

### Training (v2)
- 600,000+ pairs across **7 data streams** (added Stream 7: CPA-grade tax prep, 60k pairs)
- Base model: **Qwen2.5-32B-Instruct** (upgraded from 7B)
- LoRA rank 128 (upgraded from 64), alpha 256
- Hardware: 18× A6000, ~18 hours SFT + ~6 hours GRPO + ~4 hours DPO

### Stream Breakdown (v2)
| Stream | Topic | Pairs |
|--------|-------|-------|
| 1 | Portfolio analysis | 87,500 |
| 2 | Violation detection | 105,000 |
| 3 | Tax optimization | 70,000 |
| 4 | Rebalancing | 52,500 |
| 5 | Risk assessment | 35,000 |
| 6 | Francesca financial planning | 52,500 |
| 7 | CPA-grade tax preparation (**new**) | 60,000 |
| **Total** | | **462,500 base → 600k+ with augmentation** |

### v2 Web Features
- `/tax` dashboard: AMT forecast, NIIT exposure, quarterly estimates calendar
- Equity comp tracker: ISO exercise optimizer, RSU vesting tax calendar
- CPA mode: full year-end tax projection with actionable recommendations
- Schedule D visualizer: realized/unrealized gain/loss dashboard

---

## v3 — Compete (Q3 2026)

**Theme:** Displace consulting and compliance firms. FiduciaryOS charges 0.1% AUM vs. 1%+ for human advisors, and eliminates Big 4 tax preparation fees entirely.

**Competitive Displacement:**

| Firm Type | Annual Revenue | FiduciaryOS Replacement |
|-----------|---------------|------------------------|
| Financial advisors (1% AUM) | $330B/yr | Portfolio management + rebalancing + tax optimization |
| CPA firms (tax prep) | $160B/yr | AMT, NIIT, equity comp, Schedule D, quarterly estimates |
| Management consulting (finance) | $350B/yr | Capital allocation analysis, M&A tax structuring |
| RIAs + compliance firms | $80B/yr | Policy Artifact + audit log replaces compliance infrastructure |
| **Total addressable** | **$920B+/yr** | |

**New Capabilities:**
- Multi-entity structures: LLC/S-corp/C-corp entity selection optimization
- Business owner tax: §199A QBI deduction, reasonable compensation analysis, self-employment tax
- Trust & estate: irrevocable trust income shifting, GRAT/SLAT analysis, step-up in basis planning
- Regulatory exam readiness: automated SEC/FINRA examination response generation
- FiduciaryCertificate: signed, machine-readable attestation for regulatory filings
- White-label API: RIAs use FiduciaryOS as their compliance infrastructure

**Model:**
- FiduciaryOS-32B (current) → evaluate FiduciaryOS-70B for multi-entity complexity
- Multi-modal: accept PDFs (tax returns, brokerage statements, K-1s, W-2s)

---

## v4 — Global (Q1 2027)

**Theme:** International wealth management and cross-border tax compliance.

**New Capabilities:**
- EU MiFID II suitability + best execution
- UK FCA Consumer Duty compliance
- Canada: TFSA/RRSP optimization, Ontario surtax
- FATCA/FBAR reporting: Form 8938, FinCEN 114, foreign asset disclosure
- Treaty analysis: US-UK, US-Canada, US-Germany tax treaty optimization

---

## Business Model

| Tier | Price | Target |
|------|-------|--------|
| Personal | $49/month | Individuals with equity comp, multi-account complexity |
| Professional | $499/month | CPAs and advisors augmenting their practice |
| Enterprise | $50k+/year | RIAs replacing compliance infrastructure |
| White-label API | Revenue share | Financial institutions |

**Unit economics:** At 0.1% AUM on $1M portfolio = $1,000/year vs. $10,000+/year for human advisor + CPA. FiduciaryOS captures the $9,000 spread.
