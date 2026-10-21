"""
core/reward_functions.py — Shared reward functions for FiduciaryOS.

These functions are used by both training (train_rl.py) and evaluation
(fiduciarybench.py) to ensure consistent scoring logic.

Moved here from training/train_rl.py to avoid importing heavy training
dependencies (TRL, DeepSpeed) at evaluation time (FD-11).
"""

from __future__ import annotations

import json
import re


# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------

IA_ACT_SECTIONS = {
    "206(1)": ["fraud", "deceit", "self-dealing", "undisclosed conflict"],
    "206(2)": [
        "negligent misrepresentation",
        "conflict",
        "omission",
        "false statement",
    ],
    "206(4)": ["performance fee", "custody", "advertising", "proxy voting"],
}

FIDUCIARY_QUALITY_MARKERS = [
    (r"§\s*206|section\s+206|advisers act", 0.30),  # Cites IA Act
    (r"\$[\d,]+|\d+\s*basis\s*point|\bpercent\b", 0.30),  # Quantifies impact
    (r"conflict\s+of\s+interest|material\s+conflict", 0.20),  # Identifies conflict
    (
        r"compliant\s+conduct|should\s+have|alternative\s+approach",
        0.20,
    ),  # Recommends fix
]


# ---------------------------------------------------------------------------
# Reward functions
# ---------------------------------------------------------------------------


def compute_policy_compliance_reward(
    response: str, ground_truth_violations: list[str]
) -> float:
    """
    Reward for correctly identifying policy violations.

    Args:
        response: Model response text.
        ground_truth_violations: List of violation types that should be flagged.

    Returns:
        Reward in [-0.5, 1.0].
    """
    if not ground_truth_violations:
        if any(
            word in response.lower()
            for word in ["compliant", "no violation", "permissible"]
        ):
            return 1.0
        return 0.0

    response_lower = response.lower()
    correctly_identified = 0
    false_positives = 0

    all_violation_types = [
        "undisclosed_conflict", "self_dealing", "churning", "unsuitable_advice",
        "misrepresentation", "excessive_fees", "front_running", "soft_dollar_abuse", "cherry_picking",
    ]
    ground_truth_set = set(ground_truth_violations)

    for violation in ground_truth_violations:
        keywords = _violation_keywords(violation)
        if any(kw in response_lower for kw in keywords):
            correctly_identified += 1

    # Count false positives: violation types mentioned that are not in ground truth
    for vtype in all_violation_types:
        if vtype not in ground_truth_set:
            keywords = _violation_keywords(vtype)
            if any(kw in response_lower for kw in keywords):
                false_positives += 1

    recall = correctly_identified / max(len(ground_truth_violations), 1)
    fp_penalty = 0.2 * false_positives

    return max(-0.5, round(recall - fp_penalty, 3))


def compute_fiduciary_quality_reward(response: str) -> float:
    """
    Reward for demonstrating high-quality fiduciary reasoning.
    """
    score = 0.0
    response_lower = response.lower()

    for pattern, weight in FIDUCIARY_QUALITY_MARKERS:
        if re.search(pattern, response_lower):
            score += weight

    return round(min(score, 1.0), 3)


def compute_format_reward(response: str) -> float:
    """
    Reward for producing well-structured, parseable responses.
    """
    has_headers = bool(
        re.search(r"\*\*[A-Za-z\s]+\*\*|^##?\s+[A-Za-z]", response, re.MULTILINE)
    )
    has_numbers = bool(re.search(r"\$[\d,]+|[\d.]+%", response))
    has_length = len(response) >= 300

    score = 0.0
    if has_headers:
        score += 0.4
    if has_numbers:
        score += 0.4
    if has_length:
        score += 0.2

    try:
        json_match = re.search(r"\{[^{}]*\}", response)
        if json_match:
            json.loads(json_match.group(0))
            score = min(1.0, score + 0.2)
    except (json.JSONDecodeError, AttributeError):
        pass

    return round(score, 3)


def _violation_keywords(violation_type: str) -> list[str]:
    """Map violation type to expected response keywords."""
    keyword_map = {
        "undisclosed_conflict": ["conflict", "disclose", "undisclosed", "material"],
        "self_dealing": ["self-deal", "personal benefit", "own account", "self deal"],
        "churning": ["churn", "excessive trading", "unnecessary trade"],
        "unsuitable_advice": [
            "unsuitable",
            "suitability",
            "not appropriate",
            "best interest",
        ],
        "misrepresentation": ["misrepresent", "false", "mislead", "material omission"],
        "excessive_fees": ["excessive fee", "unreasonable fee", "overcharge"],
        "front_running": ["front run", "ahead of client", "personal account"],
        "soft_dollar_abuse": ["soft dollar", "directed brokerage", "commission"],
        "cherry_picking": ["cherry pick", "favorable allocation", "allocation"],
    }
    return keyword_map.get(violation_type, [violation_type.replace("_", " ")])
