# FiduciaryOS Model Card

## Model Details

| Field | Value |
|-------|-------|
| **Model name** | FiduciaryOS-7B-v1 |
| **Base model** | Qwen/Qwen2.5-7B-Coder-Instruct |
| **Fine-tuning method** | LoRA (rank 64, alpha 128) → merged |
| **Training stages** | 3 (SFT → GRPO → DPO) |
| **Training data** | 350k+ pairs (5 streams, see DATA_SOURCES.md) |
| **Training hardware** | 18× NVIDIA A6000 48GB |
| **Training duration** | ~7 hours total |
| **Context length** | 8,192 tokens |
| **License** | Apache 2.0 |
| **Developer** | Caleb Newton (USC) |

---

## What This Model Does

FiduciaryOS-7B takes portfolio management inputs and produces fiduciary-quality recommended actions:

**Inputs:**
- Client Policy Artifact (signed JSON)
- Current portfolio holdings (ticker, shares, cost basis, account type)
- Current market prices and portfolio value
- Tax lot data (specific identification)
- Risk monitoring status

**Outputs:**
- Recommended action (BUY, SELL, HOLD, REBALANCE, HARVEST)
- Fiduciary justification (chain-of-thought rationale)
- Policy compliance assessment
- Audit log entry (all fields populated)
- Risk alert if applicable

---

## Intended Use

**Primary use cases:**
- Research demonstration of AI-driven fiduciary decision making
- Portfolio management automation for individual investors (research context)
- Training ground for AI financial planning research
- Fiduciary compliance analysis

**Not intended for:**
- Production use in real client portfolios without regulatory review
- Replacement of licensed investment advisers without appropriate legal structure
- High-frequency trading or market making

---

## Training Data Summary

| Stream | Description | Volume |
|--------|-------------|--------|
| Robo-advisor decision logs | Portfolio management demonstrations | 87k pairs |
| FINRA/SEC enforcement actions | Fiduciary violation examples + correct actions | 105k pairs |
| CFA Institute curriculum | Portfolio theory + ethics standards | 70k pairs |
| Tax optimization case studies | TLH, asset location, Roth conversion | 52k pairs |
| Behavioral finance + microstructure | Bias correction + Alpha Sleeve training | 35k pairs |

---

## Capabilities

**Portfolio management:**
- Mean-variance optimal asset allocation
- Factor-aware portfolio construction (value, momentum, quality, low-volatility)
- Drift detection with tax-aware rebalancing
- Multi-security lot selection for tax efficiency

**Tax optimization:**
- Tax-loss harvesting with wash sale compliance (31-day window, IRC §1091)
- Specific identification lot selection (minimize tax drag)
- Asset location optimization across taxable/IRA/401k
- After-tax return analysis

**Fiduciary reasoning:**
- Fiduciary violation detection (trained on FINRA/SEC enforcement corpus)
- Conflict of interest identification
- Best-interest vs. merely-suitable analysis
- Regulatory rule citation with FINRA/SEC rule references

**Risk management:**
- Portfolio VaR and CVaR estimation
- Concentration risk detection
- Drawdown monitoring and Risk Guardian triggers
- Stress test scenario analysis

---

## Limitations

**7B model scale:** Some fiduciary reasoning tasks require broad legal knowledge that 7B model may not contain. Complex tax situations (estate planning, business entity structuring) may produce incorrect outputs.

**Market simulation:** GRPO training uses historical returns for reward computation. The model has not been tested in live market conditions. Paper trading validation is strongly recommended before live deployment.

**Jurisdiction:** Model is trained primarily on US regulations (FINRA, SEC, IRS). International regulatory frameworks (MiFID II, FCA, IIROC) are not well-covered in v1.

**Tax law currency:** Tax law changes frequently. The training data has a cutoff of early 2026. Tax guidance from after this date may not be reflected.

**Alpha Sleeve:** The Alpha Sleeve module for prediction market arbitrage involves genuine financial risk. Models of any size can lose money in prediction markets. The model's Alpha Sleeve outputs should be treated as suggestions to human review, not autonomous execution instructions.

---

## Evaluation Results (FiduciaryBench v1)

*Results to be populated after training run completes.*

| Metric | FiduciaryOS-7B-v1 | Rules-based baseline |
|--------|-------------------|----------------------|
| Fiduciary violation detection | TBD | 65% (pattern matching) |
| Policy compliance rate | TBD | 100% (enforced by rules) |
| After-tax alpha vs. benchmark | TBD | +0.25%/yr |
| TLH yield | TBD | ~0.5%/yr |
| Audit log completeness | TBD | ~60% |

---

## Ethical Considerations

**Financial risk:** Recommended actions could result in financial loss if followed. All outputs should be reviewed by a licensed financial professional before implementation.

**Fiduciary responsibility:** The model is trained to reason about fiduciary duty but is not itself a fiduciary. The legal and ethical responsibility for portfolio management decisions lies with the human operator.

**Alpha Sleeve risk:** Prediction market participation involves loss of capital. The 5% portfolio cap and Safe Mode controls are designed to limit downside, but do not eliminate risk.

**Training data bias:** The FINRA/SEC enforcement action corpus is biased toward documented violations — successful fiduciary management is underrepresented because it is rarely documented in enforcement databases. This creates an asymmetry: the model may be better at identifying violations than identifying optimal actions.

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
