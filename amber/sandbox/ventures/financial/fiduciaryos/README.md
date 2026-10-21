# FiduciaryOS — Replace your advisor, CPA, and consultant.

[![Live App](https://img.shields.io/badge/live-fiduciary.cash-30d158?style=flat)](https://fiduciary.cash)
[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://python.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Model: Qwen2.5-32B](https://img.shields.io/badge/base_model-Qwen2.5--32B--Instruct-purple.svg)](https://huggingface.co/Qwen)
[![GPUs: 18x A6000](https://img.shields.io/badge/training-18×_A6000-red.svg)](https://www.nvidia.com)
[![Security: Audited](https://img.shields.io/badge/security-alpha_sleeve_sandboxed-blue.svg)](SECURITY.md)

**[→ fiduciary.cash](https://fiduciary.cash)**

> **"FiduciaryOS will replace ALL finance companies."**

FiduciaryOS is an autonomous wealth manager, tax advisor, and financial planner — trained to replace human advisors, CPAs, and consulting firms at a fraction of the cost. The model has internalized fiduciary duty from SEC enforcement actions, CFA curriculum, and IRS tax code, and applies it with mathematical precision across portfolios, equity compensation, AMT planning, and retirement tax strategy.

Every action is verified against a machine-readable, signed Policy Artifact before execution. The system ships with a **full-stack web application** (Next.js 15 + FastAPI) that connects to real brokerage accounts via Plaid, computes your full tax picture (AMT, NIIT, ISO/RSU/ESPP, Schedule D), and surfaces fiduciary-grade recommendations — all within a cryptographically-enforced policy envelope.

**v2 — CPA Replacement**: 7 synthesis streams, 600,000+ training pairs, Qwen2.5-32B-Instruct base model. Stream 7 adds 60,000 CPA-grade tax preparation pairs covering AMT (Form 6251), NIIT (§1411), equity compensation (ISO/NSO/RSU/ESPP), Schedule D, backdoor Roth pro-rata rule, QSBS §1202, and quarterly safe harbor estimates.

Optional: an opt-in **Alpha Sleeve** module (sandboxed, isolated) runs prediction market arbitrage on Polymarket under the same policy envelope. See [SECURITY.md](SECURITY.md) for the full sandboxing architecture.

---

## What Makes FiduciaryOS Different

| Capability | Betterment | Wealthfront | Vanguard Digital | Human Advisor | **FiduciaryOS** |
|---|---|---|---|---|---|
| Portfolio construction | Rules-based | Rules-based | Rules-based | Judgment | **Trained on decision quality** |
| Tax-loss harvesting | Basic | Advanced | Basic | Variable | **Optimal with wash sale logic** |
| Fiduciary enforcement | Compliance | Compliance | Compliance | Sworn duty | **Machine-checkable signed Policy Artifact** |
| Rebalancing | Threshold-based | Threshold-based | Threshold-based | Ad hoc | **Continuous with tax-aware drift correction** |
| Audit trail | Basic logs | Basic logs | Basic logs | Meeting notes | **Cryptographically replayable decision log** |
| Risk response | Fixed rules | Fixed rules | Fixed rules | Call client | **Risk Guardian with safe mode + override** |
| Prediction market alpha | — | — | — | — | **Opt-in Alpha Sleeve (sandboxed, policy-constrained)** |
| SEC/FINRA training data | — | — | — | — | **Trained on enforcement action corpus** |

---

## Architecture

```
                     User (browser / API)
                             │
               ┌─────────────────────────┐
               │   Next.js 15 Web App    │
               │  Plaid bank sync · JWT  │
               │  Claude advisor panel   │
               └──────────┬──────────────┘
                          │ FastAPI
              Client Onboarding + Risk Profile
                            │
                            ▼
              ┌─────────────────────────┐
              │      Policy Compiler    │
              │  Produces signed JSON   │
              │  Policy Artifact (IPS)  │
              └────────────┬────────────┘
                           │ Signs + persists (Supabase)
                           ▼
              ┌─────────────────────────┐
              │    FiduciaryOS Model    │
              │ (Qwen2.5-32B-Instruct + │
              │  LoRA r128, 3-stage)    │
              └──────┬──────────────────┘
                     │
     ┌───────────────┼──────────────────────────┐
     ▼               ▼                          ▼
┌──────────┐  ┌──────────────┐        ┌───────────────┐
│Portfolio  │  │  Rebalance   │        │  Risk Guardian │
│  Agent   │  │    Agent     │        │  (hard limits) │
└──────────┘  └──────────────┘        └───────────────┘
     │               │                          │
     └───────────────┴────────────┬─────────────┘
                                  │
                  ┌───────────────▼──────────┐
                  │        Audit Log          │
                  │  Cryptographically signed │
                  │  Replayable decision log  │
                  └───────────────────────────┘
                                  │
               ┌──────────────────┴─────────────────┐
               │        [Optional] Alpha Sleeve      │
               │  Isolated container · Polymarket    │
               │  prediction market arb · ≤5% AUM   │
               │  same Policy Artifact envelope      │
               └─────────────────────────────────────┘
```

**Training data streams (7 streams, 600k+ pairs):**
- Stream 1: Portfolio analysis — rebalancing, drift correction, mean-variance optimization (87,500 pairs)
- Stream 2: Violation detection — FINRA/SEC enforcement actions, fiduciary breach taxonomy (105,000 pairs)
- Stream 3: Tax optimization — TLH, asset location, wash sale rules, after-tax return (70,000 pairs)
- Stream 4: Rebalancing — drift-triggered, tax-aware lot selection, multi-account (52,500 pairs)
- Stream 5: Risk assessment — drawdown analysis, volatility, factor exposure, Risk Guardian (35,000 pairs)
- Stream 6: **Francesca financial planning** — Monte Carlo, Roth phase-out, contribution sequencing, retirement readiness (52,500 pairs)
- Stream 7: **CPA-grade tax preparation** — AMT (Form 6251), NIIT (§1411), ISO/NSO/RSU/ESPP, Schedule D, QSBS §1202, backdoor Roth, quarterly estimates (60,000 pairs)

---

## Quick Start

### ML Pipeline (IYA Supercomputer Cluster)

```bash
git clone https://github.com/calebnewtonusc/fiduciaryos
cd fiduciaryos
pip install -r requirements.txt
cp .env.example .env  # Fill in your API keys

# Validate environment (checks CUDA, vLLM, Anthropic key, disk space)
bash scripts/check_env.sh

# Run full pipeline (data → synthesis → training → eval), ~24h on 18× A6000
bash scripts/run_all.sh

# Or step by step:
python pipeline.py --stage discovery    # ~6h, crawl SEC/FINRA (30k actions each)
python pipeline.py --stage synthesis    # ~12h, 7 streams → 600k+ training pairs
python pipeline.py --stage train        # ~18h, SFT → GRPO → DPO on 18 GPUs (32B)
python pipeline.py --stage eval         # ~1h, FiduciaryBench evaluation suite

# Check dataset stats at any point:
python pipeline.py --stats
```

### Web Application (Local / Vercel)

```bash
cd web
cp .env.example .env.local  # Fill in Supabase, Plaid, Anthropic, JWT keys

npm install
npm run dev   # http://localhost:3000

# Run Supabase migration (first time only):
npx supabase db push --db-url $SUPABASE_URL

# Deploy to Vercel:
vercel deploy
# IRS limits auto-refresh via cron: January 1 at 9:00 AM UTC
```

---

## Create a Client Profile and Run Portfolio Management

```python
from fiduciaryos import FiduciaryOSClient

client = FiduciaryOSClient(api_url="http://localhost:9000")

# Compile client policy (one-time setup)
policy = client.compile_policy(
    client_id="client_001",
    risk_tolerance="moderate",
    time_horizon_years=25,
    target_allocation={"equities": 0.70, "bonds": 0.25, "alternatives": 0.05},
    tax_status="taxable",
    annual_income=180_000,
    restrictions=["no_tobacco", "no_weapons"],
    liquidity_reserve_months=6,
)
print(policy.signature)  # Cryptographic signature — all actions verified against this

# Run portfolio analysis
analysis = client.analyze_portfolio(
    client_id="client_001",
    holdings=[
        {"ticker": "VTI", "shares": 500, "cost_basis": 180.00},
        {"ticker": "VXUS", "shares": 200, "cost_basis": 55.00},
        {"ticker": "BND", "shares": 300, "cost_basis": 78.00},
    ],
    account_value=125_000,
)

print(analysis.fiduciary_compliance_score)   # 0.97
print(analysis.recommended_actions)          # List of policy-compliant actions
print(analysis.tax_loss_opportunities)       # Tax-loss harvesting candidates
print(analysis.risk_guardian_status)         # "SAFE" | "MONITORING" | "SAFE_MODE"
```

---

## Alpha Sleeve (Optional, Opt-in)

The Alpha Sleeve runs sandboxed prediction market arbitrage on Polymarket and similar platforms. It is:
- Completely isolated in its own Docker container
- Constrained by the same signed Policy Artifact
- Size-limited to ≤5% of total portfolio value
- Independently halt-able without affecting core portfolio

**See [SECURITY.md](SECURITY.md) for the full sandboxing architecture, why external skills (OpenClaw, MCP plugins) are explicitly banned, and the threat model.**

```python
# Only activated if client has opted in AND policy allows it
if policy.alpha_sleeve_enabled:
    alpha = client.alpha_sleeve.get_status()
    print(alpha.active_positions)
    print(alpha.pnl_today)
    print(alpha.policy_utilization)  # Current size / max allowed size
```

---

## FiduciaryBench

FiduciaryBench is our evaluation suite. It tests:

- **Fiduciary violation detection** — does the model flag prohibited actions?
- **Return optimization** — does the model construct near-optimal portfolios?
- **Tax efficiency** — does the model maximize after-tax returns?
- **Policy compliance** — does every proposed action pass the signed Policy Artifact?
- **Audit trail completeness** — is every decision logged and replayable?
- **Risk control accuracy** — does Risk Guardian trigger at correct thresholds?

```bash
python evaluation/fiduciarybench.py --model checkpoints/fiduciaryos-final
```

---

## Performance Targets (v1)

| Metric | Target | Betterment baseline |
|--------|--------|---------------------|
| Fiduciary violation detection rate | >95% | N/A (rules-based) |
| After-tax risk-adjusted return (vs. benchmark) | +0.8% annualized | +0.25% |
| Tax-loss harvesting yield | >1.2% annualized | ~0.5% |
| Max drawdown within policy bounds | 100% compliance | 100% |
| Audit trail completeness | 100% | ~60% |
| Policy compilation time | <2s | N/A |

---

## Security Notice

The Alpha Sleeve module executes real financial transactions on prediction markets. It is sandboxed, policy-constrained, and opt-in. See [SECURITY.md](SECURITY.md) for the complete threat model and why integrating external skill frameworks into this repo is prohibited.

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — Full system architecture, 7 differentiators, Policy Compiler spec, dual-runtime (ML + web)
- [DATA_SOURCES.md](DATA_SOURCES.md) — 6 training streams: SEC/FINRA enforcement, CFA curriculum, Francesca financial planning
- [MODEL_CARD.md](MODEL_CARD.md) — Model specification, capabilities, limitations
- [ROADMAP.md](ROADMAP.md) — v1 through v3 roadmap
- [SETUP_GPU.md](SETUP_GPU.md) — 18× A6000 cluster configuration for IYA Innovation Quest
- [SECURITY.md](SECURITY.md) — Alpha Sleeve sandboxing and threat model
- `web/` — Next.js 15 web application (Supabase + Plaid + Claude advisor panel)
- `synthesis/financial_planning_synthesizer.py` — Francesca engines: Monte Carlo, tax, contribution sequencing (Stream 6)

---

## Disclaimer

FiduciaryOS is research software. It is not a registered investment advisor. All outputs are for research and demonstration purposes only. Do not use FiduciaryOS for actual financial decisions without consulting a licensed financial professional. The Alpha Sleeve module involves real monetary risk — see SECURITY.md before enabling.

---

## Citation

```bibtex
@inproceedings{newton2026fiduciaryos,
  title     = {FiduciaryOS: Training an Autonomous Wealth Manager on Fiduciary Decision Quality},
  author    = {Newton, Caleb},
  booktitle = {ICAIF 2026 (ACM International Conference on AI in Finance)},
  year      = {2026},
}
```

---

*Target: 864GB VRAM, 600k+ training pairs across 7 synthesis streams. Qwen2.5-32B-Instruct base model (LoRA r128/α256, 8192 ctx). Training in progress — USC IYA Innovation Quest 2026.*
