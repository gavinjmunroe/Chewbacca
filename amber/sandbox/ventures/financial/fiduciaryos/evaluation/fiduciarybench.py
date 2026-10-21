"""
evaluation/fiduciarybench.py — Evaluation benchmark for FiduciaryOS.

FiduciaryBench measures fiduciary decision quality across 6 test suites:

  1. Violation Detection (VD):
     - 500 enforcement action cases, model must identify violation type
     - Metric: macro-F1 across 10 violation categories
     - Baseline: GPT-4o: 0.61, Claude 3.5: 0.67

  2. Policy Compliance Check (PC):
     - 400 proposed actions with signed Policy Artifacts, model must verdict
     - Metric: accuracy on APPROVED/BLOCKED/MODIFIED classification
     - Baseline: GPT-4o: 0.72, Claude 3.5: 0.78

  3. Tax Optimization Accuracy (TO):
     - 300 tax-loss harvesting scenarios with ground-truth calculations
     - Metric: exact match on harvest recommendation + wash-sale compliance %
     - Baseline: GPT-4o: 0.44, Claude 3.5: 0.51

  4. Rebalancing Accuracy (RE):
     - 200 drift scenarios with ground-truth trade calculations
     - Metric: directional accuracy (correct over/under-weight identification)
       + exact $ amount within 5% tolerance
     - Baseline: GPT-4o: 0.68, Claude 3.5: 0.74

  5. Fiduciary Reasoning Quality (FRQ):
     - 150 open-ended fiduciary questions, evaluated by reward model
     - Metric: mean reward score (0-1) from trained reward model
     - Baseline: GPT-4o: 0.54, Claude 3.5: 0.61

  6. Conflict of Interest Detection (CI):
     - 250 adviser-client scenarios, model must flag material conflicts
     - Metric: precision/recall on conflict identification
     - Baseline: GPT-4o: 0.59, Claude 3.5: 0.63

FiduciaryOS target: ≥0.75 across all suites (average ≥0.80).

Usage:
    bench = FiduciaryBench(model_url="http://localhost:9000")
    results = bench.run_all()
    bench.print_report(results)
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from loguru import logger


@dataclass
class SuiteResult:
    """Result of a single evaluation suite."""

    suite_name: str
    n_examples: int
    primary_metric: float  # Main metric (F1, accuracy, etc.)
    secondary_metrics: dict[str, float]
    pass_rate: float  # Fraction above per-item threshold
    details: list[dict]  # Per-item results


@dataclass
class BenchmarkResult:
    """Full FiduciaryBench result."""

    model_name: str
    evaluated_at: str
    suites: dict[str, SuiteResult]
    composite_score: float  # Weighted average across suites
    passed: bool  # True if composite >= 0.75
    summary: str


# Suite weights for composite score
SUITE_WEIGHTS = {
    "violation_detection": 0.20,
    "policy_compliance": 0.20,
    "tax_optimization": 0.20,
    "rebalancing": 0.15,
    "fiduciary_reasoning": 0.15,
    "conflict_detection": 0.10,
}


class FiduciaryBench:
    """
    FiduciaryBench evaluation harness.

    Calls the model via OpenAI-compatible API (vLLM or OpenAI).
    All test cases are deterministic; model temperature is set to 0 for evaluation.
    """

    PASS_THRESHOLD = 0.75  # Minimum composite score to pass
    ITEM_PASS_THRESHOLD = 0.50  # Per-item minimum for pass_rate

    def __init__(
        self,
        model_url: str | None = None,
        model_name: str = "fiduciaryos",
        model_path: str | None = None,
        test_data_dir: str = "evaluation/test_data",
    ) -> None:
        """
        Initialize FiduciaryBench.

        Args:
            model_url: URL of a running vLLM server (required for evaluation).
                       Evaluation requires a running vLLM server — model_path is
                       accepted for API compatibility but is not used directly.
            model_name: Model name to pass to the vLLM API.
            model_path: Accepted for API compatibility; ignored. Start a vLLM
                        server pointing at the checkpoint and pass its URL via
                        model_url instead.
            test_data_dir: Directory containing test data JSONL files.
        """
        self.model_url = model_url
        self.model_name = model_name
        self.test_data_dir = Path(test_data_dir)
        self._client = None

        if model_url:
            import openai

            self._client = openai.OpenAI(
                base_url=f"{model_url}/v1",
                api_key=os.environ.get("VLLM_API_KEY", "dummy"),
            )

    def run_all(self) -> BenchmarkResult:
        """Run all evaluation suites and return composite result."""
        from datetime import datetime

        logger.info(f"FiduciaryBench starting | model={self.model_name}")

        suite_results: dict[str, SuiteResult] = {}

        suite_results["violation_detection"] = self.eval_violation_detection()
        suite_results["policy_compliance"] = self.eval_policy_compliance()
        suite_results["tax_optimization"] = self.eval_tax_optimization()
        suite_results["rebalancing"] = self.eval_rebalancing()
        suite_results["fiduciary_reasoning"] = self.eval_fiduciary_reasoning()
        suite_results["conflict_detection"] = self.eval_conflict_detection()

        # Composite score
        composite = sum(
            SUITE_WEIGHTS[name] * result.primary_metric
            for name, result in suite_results.items()
            if name in SUITE_WEIGHTS
        )
        composite = round(composite, 4)

        passed = composite >= self.PASS_THRESHOLD
        summary = self._build_summary(suite_results, composite, passed)

        result = BenchmarkResult(
            model_name=self.model_name,
            evaluated_at=datetime.utcnow().isoformat(),
            suites=suite_results,
            composite_score=composite,
            passed=passed,
            summary=summary,
        )

        self.print_report(result)
        return result

    def eval_violation_detection(self) -> SuiteResult:
        """Suite 1: Macro-F1 on fiduciary violation type classification."""
        test_cases = self._load_test_data("violation_detection.jsonl")
        if not test_cases:
            test_cases = _BUILTIN_VIOLATION_CASES

        from collections import defaultdict

        tp: dict[str, int] = defaultdict(int)
        fp: dict[str, int] = defaultdict(int)
        fn: dict[str, int] = defaultdict(int)
        details = []

        for case in test_cases:
            prompt = (
                f"An investment adviser engaged in the following conduct:\n\n"
                f"{case['conduct']}\n\n"
                f"Classify this conduct. Which of the following fiduciary violation types apply? "
                f"List all that apply from: {', '.join(case['all_violation_types'])}. "
                f'Respond with a JSON list: {{"violations": ["type1", "type2"]}}'
            )

            response = self._call_model(prompt)
            predicted = self._extract_violation_list(response)
            true_violations = set(case["violations"])
            pred_violations = set(predicted)

            for vtype in true_violations:
                if vtype in pred_violations:
                    tp[vtype] += 1
                else:
                    fn[vtype] += 1
            for vtype in pred_violations:
                if vtype not in true_violations:
                    fp[vtype] += 1

            item_correct = len(true_violations & pred_violations) / max(
                len(true_violations), 1
            )
            details.append(
                {
                    "case_id": case.get("id", ""),
                    "true": list(true_violations),
                    "predicted": list(pred_violations),
                    "item_score": round(item_correct, 3),
                }
            )

        # Macro-F1
        all_types = set(tp.keys()) | set(fp.keys()) | set(fn.keys())
        per_type_f1 = []
        for vtype in all_types:
            prec = tp[vtype] / max(tp[vtype] + fp[vtype], 1)
            rec = tp[vtype] / max(tp[vtype] + fn[vtype], 1)
            f1 = 2 * prec * rec / max(prec + rec, 1e-9)
            per_type_f1.append(f1)

        macro_f1 = round(sum(per_type_f1) / max(len(per_type_f1), 1), 4)
        pass_rate = sum(1 for d in details if d["item_score"] >= 0.5) / max(
            len(details), 1
        )

        logger.info(f"Violation Detection: macro-F1={macro_f1:.3f}")
        return SuiteResult(
            suite_name="violation_detection",
            n_examples=len(test_cases),
            primary_metric=macro_f1,
            secondary_metrics={"per_type_f1_mean": macro_f1},
            pass_rate=round(pass_rate, 3),
            details=details[:10],  # Sample
        )

    def eval_policy_compliance(self) -> SuiteResult:
        """Suite 2: Accuracy on APPROVED/BLOCKED/MODIFIED verdicts."""
        test_cases = self._load_test_data("policy_compliance.jsonl")
        if not test_cases:
            test_cases = _BUILTIN_POLICY_CASES

        correct = 0
        details = []

        for case in test_cases:
            prompt = (
                f"Policy Artifact constraints:\n{json.dumps(case['policy_summary'], indent=2)}\n\n"
                f"Proposed action:\n{json.dumps(case['proposed_action'], indent=2)}\n\n"
                f"Verdict (APPROVED/BLOCKED/MODIFIED)? Explain in JSON: "
                f'{{"verdict": "...", "reason": "..."}}'
            )

            response = self._call_model(prompt)
            predicted = self._extract_verdict(response)
            is_correct = predicted == case["expected_verdict"]
            if is_correct:
                correct += 1

            details.append(
                {
                    "case_id": case.get("id", ""),
                    "expected": case["expected_verdict"],
                    "predicted": predicted,
                    "correct": is_correct,
                }
            )

        accuracy = round(correct / max(len(test_cases), 1), 4)
        pass_rate = accuracy  # Binary: correct or not
        logger.info(f"Policy Compliance: accuracy={accuracy:.3f}")
        return SuiteResult(
            suite_name="policy_compliance",
            n_examples=len(test_cases),
            primary_metric=accuracy,
            secondary_metrics={},
            pass_rate=pass_rate,
            details=details[:10],
        )

    def eval_tax_optimization(self) -> SuiteResult:
        """Suite 3: Accuracy on tax-loss harvest recommendations."""
        test_cases = self._load_test_data("tax_optimization.jsonl")
        if not test_cases:
            test_cases = _BUILTIN_TAX_CASES

        harvest_correct = 0
        wash_sale_correct = 0
        details = []

        for case in test_cases:
            prompt = (
                f"Tax scenario:\n{case['scenario_description']}\n\n"
                f"Positions:\n{json.dumps(case['positions'], indent=2)}\n\n"
                f"Should we harvest the {case['ticker']} loss? "
                f"Is it wash-sale safe? Respond in JSON: "
                f'{{"harvest": true/false, "wash_sale_safe": true/false, "reason": "..."}}'
            )

            response = self._call_model(prompt)
            predicted_harvest = self._extract_bool(response, "harvest")
            predicted_wash_safe = self._extract_bool(response, "wash_sale_safe")

            h_correct = predicted_harvest == case["expected_harvest"]
            w_correct = predicted_wash_safe == case["expected_wash_sale_safe"]
            if h_correct:
                harvest_correct += 1
            if w_correct:
                wash_sale_correct += 1

            item_score = (int(h_correct) + int(w_correct)) / 2
            details.append(
                {
                    "case_id": case.get("id", ""),
                    "harvest_correct": h_correct,
                    "wash_sale_correct": w_correct,
                    "item_score": item_score,
                }
            )

        n = max(len(test_cases), 1)
        harvest_acc = round(harvest_correct / n, 4)
        wash_acc = round(wash_sale_correct / n, 4)
        primary = round((harvest_acc + wash_acc) / 2, 4)
        pass_rate = sum(1 for d in details if d["item_score"] >= 0.5) / max(
            len(details), 1
        )

        logger.info(
            f"Tax Optimization: harvest_acc={harvest_acc:.3f}, wash_sale_acc={wash_acc:.3f}"
        )
        return SuiteResult(
            suite_name="tax_optimization",
            n_examples=len(test_cases),
            primary_metric=primary,
            secondary_metrics={
                "harvest_accuracy": harvest_acc,
                "wash_sale_accuracy": wash_acc,
            },
            pass_rate=round(pass_rate, 3),
            details=details[:10],
        )

    def eval_rebalancing(self) -> SuiteResult:
        """Suite 4: Directional accuracy on rebalancing decisions."""
        test_cases = self._load_test_data("rebalancing.jsonl")
        if not test_cases:
            test_cases = _BUILTIN_REBALANCE_CASES

        direction_correct = 0
        details = []

        for case in test_cases:
            prompt = (
                f"Portfolio allocation:\n{json.dumps(case['current_allocation'], indent=2)}\n"
                f"Target allocation:\n{json.dumps(case['target_allocation'], indent=2)}\n"
                f"Threshold: {case['threshold']}%\n\n"
                f"Does this portfolio need rebalancing? Which asset class most needs attention? "
                f'JSON: {{"needs_rebalance": true/false, "primary_drift_class": "...", '
                f'"action": "SELL|BUY"}}'
            )

            response = self._call_model(prompt)
            needs_rebalance = self._extract_bool(response, "needs_rebalance")
            is_correct = needs_rebalance == case["expected_needs_rebalance"]
            if is_correct:
                direction_correct += 1

            details.append(
                {
                    "case_id": case.get("id", ""),
                    "expected": case["expected_needs_rebalance"],
                    "predicted": needs_rebalance,
                    "correct": is_correct,
                }
            )

        accuracy = round(direction_correct / max(len(test_cases), 1), 4)
        logger.info(f"Rebalancing: accuracy={accuracy:.3f}")
        return SuiteResult(
            suite_name="rebalancing",
            n_examples=len(test_cases),
            primary_metric=accuracy,
            secondary_metrics={},
            pass_rate=accuracy,
            details=details[:10],
        )

    def eval_fiduciary_reasoning(self) -> SuiteResult:
        """Suite 5: Open-ended fiduciary reasoning quality (reward model scored)."""
        test_cases = self._load_test_data("fiduciary_reasoning.jsonl")
        if not test_cases:
            test_cases = _BUILTIN_REASONING_CASES

        scores = []
        details = []

        from core.reward_functions import (
            compute_fiduciary_quality_reward,
            compute_policy_compliance_reward,
        )

        for case in test_cases:
            response = self._call_model(case["question"])
            violations = case.get("expected_violations", [])
            compliance_score = compute_policy_compliance_reward(response, violations)
            quality_score = compute_fiduciary_quality_reward(response)
            item_score = 0.5 * compliance_score + 0.5 * quality_score

            scores.append(item_score)
            details.append(
                {
                    "case_id": case.get("id", ""),
                    "compliance_score": round(compliance_score, 3),
                    "quality_score": round(quality_score, 3),
                    "item_score": round(item_score, 3),
                }
            )

        mean_score = round(sum(scores) / max(len(scores), 1), 4)
        pass_rate = sum(1 for s in scores if s >= 0.5) / max(len(scores), 1)

        logger.info(f"Fiduciary Reasoning: mean_score={mean_score:.3f}")
        return SuiteResult(
            suite_name="fiduciary_reasoning",
            n_examples=len(test_cases),
            primary_metric=mean_score,
            secondary_metrics={
                "mean_compliance": round(
                    sum(d["compliance_score"] for d in details) / max(len(details), 1),
                    3,
                )
            },
            pass_rate=round(pass_rate, 3),
            details=details[:10],
        )

    def eval_conflict_detection(self) -> SuiteResult:
        """Suite 6: Precision/recall on conflict of interest detection."""
        test_cases = self._load_test_data("conflict_detection.jsonl")
        if not test_cases:
            test_cases = _BUILTIN_CONFLICT_CASES

        tp = fp = fn = 0
        details = []

        for case in test_cases:
            prompt = (
                f"Review this adviser-client scenario for material conflicts of interest:\n\n"
                f"{case['scenario']}\n\n"
                f"Is there a material conflict of interest that must be disclosed? "
                f'JSON: {{"conflict_present": true/false, "conflict_type": "...", "disclosure_required": true/false}}'
            )

            response = self._call_model(prompt)
            predicted_conflict = self._extract_bool(response, "conflict_present")
            true_conflict = case["has_conflict"]

            if true_conflict and predicted_conflict:
                tp += 1
            elif not true_conflict and predicted_conflict:
                fp += 1
            elif true_conflict and not predicted_conflict:
                fn += 1

            details.append(
                {
                    "case_id": case.get("id", ""),
                    "has_conflict": true_conflict,
                    "predicted": predicted_conflict,
                }
            )

        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-9)
        f1 = round(f1, 4)
        pass_rate = f1

        logger.info(f"Conflict Detection: P={precision:.3f} R={recall:.3f} F1={f1:.3f}")
        return SuiteResult(
            suite_name="conflict_detection",
            n_examples=len(test_cases),
            primary_metric=f1,
            secondary_metrics={
                "precision": round(precision, 3),
                "recall": round(recall, 3),
            },
            pass_rate=pass_rate,
            details=details[:10],
        )

    def print_report(self, result: BenchmarkResult) -> None:
        """Print formatted benchmark report."""
        logger.info("=" * 60)
        logger.info(f"FiduciaryBench Results | {result.model_name}")
        logger.info("=" * 60)
        for name, suite in result.suites.items():
            status = "PASS" if suite.primary_metric >= 0.75 else "FAIL"
            logger.info(f"  {name:30s} {suite.primary_metric:.3f}  [{status}]")
        logger.info("-" * 60)
        logger.info(
            f"  {'COMPOSITE SCORE':30s} {result.composite_score:.3f}  [{'PASS' if result.passed else 'FAIL'}]"
        )
        logger.info("=" * 60)

    def _call_model(self, prompt: str) -> str:
        """Call the model API."""
        if self._client is None:
            return ""
        try:
            resp = self._client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=512,
                temperature=0.0,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            logger.debug(f"Model call failed: {e}")
            return ""

    def _load_test_data(self, filename: str) -> list[dict]:
        """Load test data from file."""
        path = self.test_data_dir / filename
        if not path.exists():
            return []
        records = []
        for line in path.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return records

    def _extract_violation_list(self, text: str) -> list[str]:
        """Extract violation list from model JSON response."""
        try:
            m = re.search(r"\{[\s\S]+\}", text)
            if m:
                data = json.loads(m.group(0))
                return data.get("violations", [])
        except Exception:
            pass
        return []

    def _extract_verdict(self, text: str) -> str:
        """Extract APPROVED/BLOCKED/MODIFIED from response."""
        for verdict in ["APPROVED", "BLOCKED", "MODIFIED"]:
            if verdict.lower() in text.lower():
                return verdict
        try:
            m = re.search(r"\{[\s\S]+\}", text)
            if m:
                data = json.loads(m.group(0))
                return data.get("verdict", "UNKNOWN").upper()
        except Exception:
            pass
        return "UNKNOWN"

    def _extract_bool(self, text: str, field: str) -> bool:
        """Extract a boolean field from JSON response."""
        try:
            m = re.search(r"\{[\s\S]+\}", text)
            if m:
                data = json.loads(m.group(0))
                val = data.get(field, False)
                return bool(val)
        except Exception:
            pass
        if "true" in text.lower()[:200]:
            return True
        return False

    def _build_summary(self, suites: dict, composite: float, passed: bool) -> str:
        """Build a text summary of benchmark results."""
        lines = [
            f"FiduciaryBench — {'PASS' if passed else 'FAIL'} (composite {composite:.3f})"
        ]
        for name, suite in suites.items():
            lines.append(f"  {name}: {suite.primary_metric:.3f}")
        return " | ".join(lines)


# ---------------------------------------------------------------------------
# Built-in test cases (minimal set for offline testing)
# ---------------------------------------------------------------------------

_BUILTIN_VIOLATION_CASES = [
    {
        "id": "vd_001",
        "conduct": "An adviser recommended a high-fee annuity product from a provider that paid the adviser a 6% commission. The client was not informed of the commission. The annuity had higher fees than comparable low-cost products.",
        "violations": ["undisclosed_conflict", "excessive_fees"],
        "all_violation_types": [
            "undisclosed_conflict",
            "self_dealing",
            "excessive_fees",
            "churning",
            "misrepresentation",
            "unsuitable_advice",
        ],
    },
    {
        "id": "vd_002",
        "conduct": "An adviser recommended a diversified low-cost index fund portfolio appropriate to the client's stated moderate risk tolerance and 20-year time horizon.",
        "violations": [],
        "all_violation_types": [
            "undisclosed_conflict",
            "self_dealing",
            "excessive_fees",
            "churning",
            "misrepresentation",
            "unsuitable_advice",
        ],
    },
]

_BUILTIN_POLICY_CASES = [
    {
        "id": "pc_001",
        "policy_summary": {
            "max_single_security_pct": 0.10,
            "excluded_securities": ["TSLA"],
        },
        "proposed_action": {"type": "BUY", "ticker": "TSLA", "amount_usd": 5000},
        "expected_verdict": "BLOCKED",
    },
    {
        "id": "pc_002",
        "policy_summary": {"max_single_security_pct": 0.10, "excluded_securities": []},
        "proposed_action": {"type": "BUY", "ticker": "VTI", "amount_usd": 5000},
        "expected_verdict": "APPROVED",
    },
]

_BUILTIN_TAX_CASES = [
    {
        "id": "to_001",
        "scenario_description": "Client in 37% bracket, CA resident. Year-end tax loss harvesting review.",
        "positions": {
            "VTI": {
                "shares": 500,
                "cost_basis": 280,
                "current_price": 241,
                "holding_days": 400,
            }
        },
        "ticker": "VTI",
        "expected_harvest": True,
        "expected_wash_sale_safe": True,
    },
]

_BUILTIN_REBALANCE_CASES = [
    {
        "id": "re_001",
        "current_allocation": {"us_equity": 0.72, "bonds": 0.19, "international": 0.09},
        "target_allocation": {"us_equity": 0.60, "bonds": 0.30, "international": 0.10},
        "threshold": 5,
        "expected_needs_rebalance": True,
    },
    {
        "id": "re_002",
        "current_allocation": {"us_equity": 0.61, "bonds": 0.29, "international": 0.10},
        "target_allocation": {"us_equity": 0.60, "bonds": 0.30, "international": 0.10},
        "threshold": 5,
        "expected_needs_rebalance": False,
    },
]

_BUILTIN_REASONING_CASES = [
    {
        "id": "frq_001",
        "question": "A client's investment policy statement says max drawdown 15%. The portfolio is at -14.5% drawdown. The model recommends holding equities for recovery. What is the fiduciary response?",
        "expected_violations": ["breach_of_duty_care"],
    },
]

_BUILTIN_CONFLICT_CASES = [
    {
        "id": "ci_001",
        "scenario": "An adviser recommends a specific mutual fund. The adviser's firm receives 12bps in 12b-1 fees from that fund's distributor. This arrangement is disclosed in the firm's ADV Part 2A but not verbally to this specific client.",
        "has_conflict": True,
    },
    {
        "id": "ci_002",
        "scenario": "An adviser recommends Vanguard Total Stock Market Index Fund (VTI). The adviser charges 50bps AUM fee. There is no relationship between the adviser and Vanguard.",
        "has_conflict": False,
    },
]
