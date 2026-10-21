# Contributing to FiduciaryOS

FiduciaryOS improves with community contributions, especially training data for fiduciary decision quality and market microstructure research.

---

## Ways to Contribute

### 1. Fiduciary Decision Case Studies

The most valuable contribution is a documented fiduciary decision case:

```json
{
  "scenario": "...",
  "client_profile": {"risk_tolerance": "...", "time_horizon": "..."},
  "proposed_action": "...",
  "fiduciary_analysis": {
    "is_fiduciary_optimal": false,
    "violation_type": "...",
    "applicable_rule": "FINRA Rule 2111",
    "better_action": "...",
    "rationale": "..."
  },
  "source": "doi or case citation"
}
```

Submit via PR to `data/community/fiduciary_cases.jsonl`.

**Important:** All contributed cases must be based on real documented cases or clearly labeled as synthetic. Do not fabricate enforcement actions.

### 2. Tax Optimization Scenarios

Tax law scenarios with authoritative sources:
- IRS ruling citations
- Tax Court decisions
- Revenue procedures and notices

Format: (`tax_situation`, `optimal_action`, `code_citation`) triplets.

### 3. FiduciaryBench Test Cases

```bash
python evaluation/fiduciarybench.py --add-test \
  --type violation_detection \
  --scenario "advisor_scenario.json" \
  --expected-violation "duty_of_loyalty"
```

### 4. Alpha Sleeve Research

If you have experience with prediction market microstructure or Polymarket historical data, contribute to the Alpha Sleeve training corpus. Contact maintainers via GitHub Issues with `[alpha-sleeve]` tag.

---

## Code Guidelines

- Python 3.11+, full type annotations required
- Docstrings on all public APIs (Google style)
- `loguru` for logging
- `pytest` for tests — 85%+ coverage on `core/` modules
- No `eval()`, `exec()`, or dynamic imports from external sources in any core module
- Format: `black --line-length 100`
- Lint: `ruff check`

### Security-Specific Guidelines

- **Never** hardcode API keys, account numbers, or client data
- **Never** add external plugin hooks (see SECURITY.md)
- **Always** run policy compliance check in tests for any new recommended action
- Tax and regulatory guidance must cite authoritative sources

---

## Testing

```bash
# Run full test suite
pytest tests/ -v

# Run security-specific tests
pytest tests/test_policy_enforcement.py -v
pytest tests/test_alpha_sleeve_isolation.py -v

# Run against FiduciaryBench
python evaluation/fiduciarybench.py --model checkpoints/fiduciaryos-final
```

---

## Disclaimer

Contributors affirm that their contributions do not constitute investment advice. FiduciaryOS is research software. All training data contributions must either cite authoritative sources or be clearly labeled as synthetic/hypothetical.

Contact: Caleb Newton ([@calebnewtonusc](https://github.com/calebnewtonusc))
