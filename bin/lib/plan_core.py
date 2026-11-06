"""What a commit on a big plan actually covers, shared by plan-check and plan-commit-guard.

A commit used to be keyed to a file path, so on 2026-11-05 a reviewer rewrote a
committed plan's Outcome to "Sell one church t-shirts" and it still passed. The core
is the part a person really agreed to: the outcome, the chosen shape, the one-way
doors and each phase's exit.
"""
import hashlib
import json
import os
import re


def section(text, name):
    m = re.search(rf"(?ims)^##\s+{re.escape(name)}\s*$(.*?)(?=^##\s|\Z)", text)
    return m.group(1).strip() if m else ""


def core(text):
    shapes = re.findall(r"(?im)^###\s+(.*\bchosen\b.*)$", section(text, "shapes"))
    exits = re.findall(r"(?im)^\s*Exit:\s*(.*)$", section(text, "phases"))
    return {"outcome": section(text, "outcome"), "chosen": shapes,
            "doors": section(text, "one-way doors"), "exits": exits}


def core_hash(text):
    return hashlib.sha256(json.dumps(core(text), sort_keys=True).encode()).hexdigest()[:24]


def receipt_path(plan_file):
    """Next to the plan, so it moves and merges with it. A worktree's commit survives."""
    base, _ = os.path.splitext(plan_file)
    return base + ".commit.json"
