# FiduciaryOS — Full System Architecture
## "Fiduciary-grade autonomous wealth management."

---

## THE CORE INSIGHT

Every existing robo-advisor is fundamentally rules-based. Betterment, Wealthfront, Schwab Intelligent Portfolios — they all follow predetermined rules: "rebalance when drift > 5%", "harvest losses when unrealized loss > $500". These rules are legally compliant. They are not always optimal.

The difference between a rules-based robo-advisor and a fiduciary advisor is not compliance — it is judgment under uncertainty. A fiduciary asks: "Given everything I know about this client — their actual risk tolerance (not their survey answers), their tax situation, their time horizon, their psychological relationship with money — what is the *best* action right now?"

FiduciaryOS is the first model trained on this judgment. Not trained on the rules. Trained on the *reasons* those rules exist, and trained on the enforcement actions showing exactly what happens when they are violated.

```
Phase 1 (v1):   MANAGE         portfolio construction, rebalancing, TLH, risk control  ← CURRENT
Phase 2 (v1.5): OPTIMIZE       tax-aware multi-account asset location, Roth conversion
Phase 3 (v2):   PLAN           full financial planning — savings, insurance, estate
Phase 4 (v3):   CERTIFY        regulatory-grade fiduciary audit certificates
```

---

## 7 TECHNICAL DIFFERENTIATORS

### 1. The Policy Compiler — Machine-Checkable Fiduciary Constraints

The Policy Compiler transforms a client's Investment Policy Statement (IPS) into a signed, machine-readable JSON artifact. Every action FiduciaryOS proposes is verified against this artifact before execution. If the action violates any constraint, it is blocked — not logged and overridden, blocked.

```
Input:  Client profile (risk tolerance, time horizon, constraints, allocation targets)
Output: PolicyArtifact — signed JSON with:
          target_allocation: {equities: 0.70, bonds: 0.25, alternatives: 0.05}
          rebalancing_bands: {equities: ±0.05, bonds: ±0.03}
          max_drawdown_tolerance: 0.18
          excluded_securities: ["TOBACCO", ...]
          tax_strategy: {harvesting_threshold: -500, wash_sale_window: 30}
          liquidity_reserve: {months: 6, min_cash_pct: 0.02}
          alpha_sleeve_enabled: false
          signature: "RSA-4096:sha256:..."
```

This is the architecture innovation: a human-readable + machine-verifiable fiduciary contract that an AI must satisfy on every action. No other autonomous wealth management system has this.

### 2. Trained on Enforcement Actions (the data moat)

FINRA and the SEC publish every enforcement action — exactly what an advisor did wrong, why it violated fiduciary duty, and what the correct action should have been. This corpus is the most explicit supervision signal available for training fiduciary judgment.

FiduciaryOS is trained on thousands of these decisions:
```
Input:  "Advisor moved client from low-cost index funds to higher-cost active funds
         generating 3× the commissions without documented evidence of suitability analysis."
Output: VIOLATION: Duty of loyalty — advisor's financial interest conflicted with client's.
        CORRECT_ACTION: Document suitability analysis; select lowest-cost suitable option.
        PATTERN: Fee-conflicted recommendation (Pattern ID: FID-07)
```

No other model has been trained on this corpus for fiduciary reasoning. The enforcement action corpus creates a labeled dataset of fiduciary violations that would otherwise require years of regulatory experience to internalize.

### 3. Risk Guardian with Safe Mode

The Risk Guardian is a hard-constraint enforcement layer that operates independently of the FiduciaryOS model. If the model produces an action that violates risk limits, the Risk Guardian blocks it — the model cannot override this.

```
Risk Guardian triggers:
  Level 1 (MONITORING): Portfolio drift > 3% from target allocation
  Level 2 (ALERT): Drawdown > 10% | Concentration in single security > 20%
  Level 3 (SAFE MODE): Drawdown > 15% | Margin call risk | Liquidity < reserve
  Level 4 (HALT): Emergency liquidation signal | Regulatory hold | Account freeze
```

Safe Mode: all trading halted, all positions moved to cash equivalents, client notified. Requires explicit client consent to exit Safe Mode.

### 4. Cryptographically Replayable Audit Log

Every decision FiduciaryOS makes is logged with:
- Decision timestamp (nanosecond precision)
- Policy Artifact hash (proving which policy was in effect)
- Input state (portfolio snapshot, market data, model inputs)
- Model reasoning (chain-of-thought justification)
- Output action (trade, rebalance, hold, alert)
- Policy compliance check result
- Cryptographic signature of the full record

The audit log is replayable: given the input state and the model checkpoint, you can reproduce every decision exactly. This is the format SEC/FINRA examiners would request in a regulatory review.

### 5. Tax-Optimal Multi-Dimensional Optimization

FiduciaryOS's tax optimizer reasons across three dimensions simultaneously:

1. **Tax-loss harvesting**: identify positions with unrealized losses, sell to realize the loss, buy a substantially-similar-but-not-identical replacement (wash sale rule compliance built in)

2. **Asset location**: place tax-inefficient assets (REITs, high-yield bonds) in tax-advantaged accounts (IRA, 401k); tax-efficient assets (index funds) in taxable accounts — learned from case study corpus

3. **Roth conversion optimization**: identify years where Roth conversion is tax-optimal given marginal rates, contribution limits, and RMD projections

This is genuinely complex multi-variable optimization that existing robo-advisors handle heuristically. FiduciaryOS was trained on the decision reasoning, not just the heuristic rules.

### 6. The Alpha Sleeve — Sandboxed Optional Microtrading

The Alpha Sleeve is a completely isolated module for prediction market arbitrage (Polymarket, Manifold Markets). Key properties:

- **Isolated**: runs in its own Docker container, separate network namespace, no shared memory with core portfolio management
- **Policy-constrained**: the same signed Policy Artifact governs the Alpha Sleeve — position size, drawdown limits, and emergency halt are all enforced
- **Size-limited**: capped at ≤5% of total portfolio AUM by policy enforcement
- **Opt-in only**: disabled by default, requires explicit client consent and risk acknowledgment
- **Training**: trained on market microstructure, Polymarket historical data, and prediction market mispricing patterns

**Why it's valuable**: Prediction markets are frequently mispriced around news events, election cycles, and geopolitical developments. A model trained on market microstructure can identify and exploit these mispricings in a market that's too small for institutional capital but not for individual accounts.

### 7. 3-Stage Training on Fiduciary Decision Quality

```
Stage 1 (SFT): Learn what fiduciary-optimal behavior looks like from expert demonstrations
Stage 2 (GRPO): Optimize on verifiable rewards:
                - Policy violation rate = 0 (hard constraint, reward = -inf for violation)
                - After-tax risk-adjusted return vs. benchmark
                - Audit trail completeness
Stage 3 (DPO): Prefer cautious, well-explained actions over aggressive, unexplained ones
```

The GRPO reward for Stage 2 is partially verifiable: policy violations are binary (violated or not), and can be checked against the signed Policy Artifact without human labelers. Return optimization requires market simulation but is grounded in historical return data.

---

## SYSTEM COMPONENTS

### Core Library (`core/`)

```
core/
├── policy_compiler.py      # Compiles IPS → signed Policy Artifact
├── risk_guardian.py        # Hard-constraint enforcement layer
├── audit_log.py            # Cryptographically signed, replayable decision log
└── tax_optimizer.py        # TLH, asset location, wash sale logic, Roth conversion
```

### Agents (`agents/`)

```
agents/
├── portfolio_agent.py      # Main portfolio management orchestrator
├── rebalancing_agent.py    # Drift detection and rebalancing execution
├── alpha_sleeve_agent.py   # Prediction market arbitrage (sandboxed, opt-in)
└── risk_agent.py           # Risk monitoring and Safe Mode management
```

### Discovery (`discovery/`)

```
discovery/
├── sec_filings.py          # EDGAR filing downloader (10-K, 8-K, enforcement actions)
└── enforcement_actions.py  # FINRA/SEC enforcement action corpus builder
```

### Synthesis (`synthesis/`)

```
synthesis/
├── prompts.py              # Prompt templates for all synthesis tasks
├── synthesize_bulk.py      # Parallel synthesis runner
└── fiduciary_pairs.py      # Fiduciary decision quality pair generation
```

### Evaluation (`evaluation/`)

```
evaluation/
└── fiduciarybench.py       # FiduciaryBench — policy compliance + return optimization
```

---

## POLICY ARTIFACT SCHEMA

```json
{
  "version": "1.0",
  "client_id": "hashed_client_id",
  "created_at": "2026-03-01T00:00:00Z",
  "expires_at": "2027-03-01T00:00:00Z",
  "risk_profile": {
    "tolerance": "moderate",
    "time_horizon_years": 25,
    "max_drawdown_tolerance": 0.18,
    "volatility_target": 0.12
  },
  "target_allocation": {
    "us_equity": 0.45,
    "international_equity": 0.25,
    "us_bonds": 0.20,
    "international_bonds": 0.05,
    "alternatives": 0.03,
    "cash": 0.02
  },
  "rebalancing_bands": {
    "equities": 0.05,
    "bonds": 0.03,
    "cash": 0.01
  },
  "tax_strategy": {
    "harvesting_enabled": true,
    "harvesting_threshold_usd": -500,
    "wash_sale_window_days": 31,
    "asset_location_optimization": true
  },
  "constraints": {
    "excluded_sectors": ["tobacco", "weapons", "fossil_fuels"],
    "excluded_securities": [],
    "min_position_size_usd": 100,
    "max_single_security_pct": 0.10,
    "liquidity_reserve_months": 6
  },
  "alpha_sleeve": {
    "enabled": false,
    "max_allocation_pct": 0.05,
    "max_drawdown_pct": 0.20
  },
  "signature": {
    "algorithm": "RSA-4096",
    "hash": "sha256",
    "value": "<base64-encoded-signature>"
  }
}
```

---

## TRAINING PIPELINE

### Stage 1 — SFT: `training/train.py`

```
Base model:    Qwen/Qwen2.5-7B-Coder-Instruct
Training data: 350k+ pairs across 5 streams
Hardware:      18× A6000, DeepSpeed ZeRO-3, LoRA rank 64
Time:          ~4 hours

Input:  Portfolio state + policy artifact + market data
Output: Recommended action with fiduciary justification
```

### Stage 2 — GRPO: `training/train_rl.py`

```
Algorithm: GRPO
Reward:    R_fiduciary (0.5) + R_return (0.3) + R_audit (0.2)

where:
  R_fiduciary = 1.0 if no policy violations, -10.0 if any violation
  R_return    = after-tax return vs. benchmark in simulated environment
  R_audit     = completeness of decision log (all fields populated)

Hardware:  18× A6000, estimated 2.5 hours
```

### Stage 3 — DPO: `training/train_dpo.py`

```
DPO pairs: 15k expert-curated preference pairs
Focus:     Prefer cautious, well-documented actions
Beta:      0.1
Hardware:  18× A6000, estimated 30 minutes
```

---

## ALPHA SLEEVE ARCHITECTURE

The Alpha Sleeve is architecturally isolated:

```
Core FiduciaryOS Container
│
│  (reads policy artifact, reports PnL, receives halt signal)
│
└─► Alpha Sleeve Container (separate Docker network)
      │
      ├─► Polymarket API
      ├─► Manifold Markets API
      ├─► Market data feeds
      └─► Policy enforcement (local copy of signed artifact)
```

Communication between containers is via a single narrow API:
- Core → Alpha: `HALT` signal, updated policy artifact
- Alpha → Core: Position summary, daily PnL, risk utilization

No other cross-container communication is permitted. The Alpha Sleeve cannot access client PII, core portfolio state, or banking integrations.

---

## TARGET METRICS

| Version | Task | Target | Baseline |
|---------|------|--------|----------|
| v1 | Fiduciary violation detection | >95% | Rules-based: ~70% |
| v1 | Policy compliance rate | 100% | 100% (enforced) |
| v1 | After-tax alpha vs. benchmark | +0.8%/yr | +0.25%/yr (Betterment) |
| v1 | Tax-loss harvesting yield | >1.2%/yr | ~0.5%/yr |
| v1 | Audit log completeness | 100% | ~60% |
| v1.5 | Multi-account optimization | +0.4%/yr additional | — |
| v2 | Full financial plan accuracy | >90% | — |
| v3 | Regulatory audit pass rate | 100% | — |
