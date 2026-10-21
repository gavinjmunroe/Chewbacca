"""
training/train_rl.py — Stage 2: GRPO policy optimization for FiduciaryOS.

Reinforcement learning stage using Group Relative Policy Optimization (GRPO).
The reward signal measures fiduciary compliance quality on three dimensions:

  1. Policy Compliance Reward (0.5 weight):
     - Correct identification of policy violations → +1.0
     - Missed violations → penalty proportional to severity
     - False positives → -0.2 penalty

  2. Format Reward (0.2 weight):
     - Valid JSON with required fields → +1.0
     - Parseable but missing fields → +0.5
     - Unparsable → 0.0

  3. Fiduciary Reasoning Quality (0.3 weight):
     - Cites correct legal standard (IA Act section) → +0.3
     - Quantifies dollar impact → +0.3
     - Identifies conflict of interest → +0.2
     - Recommends compliant alternative → +0.2

Run command (10x A6000 GPUs 8–17):
    deepspeed --num_gpus=10 training/train_rl.py \
        --model_path checkpoints/sft/merged \
        --data_path data/train/grpo_prompts.jsonl \
        --output_dir checkpoints/grpo

Expected runtime: ~40 hours on 10x A6000
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from datasets import Dataset
from loguru import logger
from trl import GRPOConfig, GRPOTrainer


# ---------------------------------------------------------------------------
# Reward functions (imported from shared module to avoid circular imports
# and to prevent training dependencies from loading at eval time — FD-11)
# ---------------------------------------------------------------------------

from core.reward_functions import (  # noqa: E402
    compute_policy_compliance_reward,
    compute_fiduciary_quality_reward,
    compute_format_reward,
)


def reward_fn(
    prompts: list[str],
    completions: list[str],
    ground_truth: list[dict] | None = None,
    **kwargs,
) -> list[float]:
    """
    TRL-compatible reward function for GRPO.

    Args:
        prompts: List of input prompts.
        completions: List of model completions.
        ground_truth: List of dicts with 'violations' and 'expected_verdict' keys.

    Returns:
        List of scalar rewards.
    """
    original_gts = ground_truth or []
    if not original_gts:
        ground_truth = [{}] * len(completions)
    elif len(original_gts) < len(completions):
        # GRPO generates G completions per prompt; repeat each ground truth G times
        # so that each completion is scored against its own prompt's ground truth.
        G = len(completions) // max(len(original_gts), 1)
        ground_truth = [gt for gt in original_gts for _ in range(G)]
        # Pad any remainder
        if len(ground_truth) < len(completions):
            ground_truth = ground_truth + [{}] * (len(completions) - len(ground_truth))
    else:
        ground_truth = original_gts

    rewards = []
    for i in range(len(completions)):
        gt = ground_truth[i]
        completion = completions[i]
        violations = gt.get("violations", [])

        r_compliance = compute_policy_compliance_reward(completion, violations)
        r_format = compute_format_reward(completion)
        r_quality = compute_fiduciary_quality_reward(completion)

        # Weighted sum
        reward = 0.50 * r_compliance + 0.20 * r_format + 0.30 * r_quality
        rewards.append(round(reward, 4))

    return rewards


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_grpo_dataset(data_path: str) -> Dataset:
    """Load GRPO prompt dataset with ground-truth violation labels."""
    records = []
    for line in Path(data_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            # Each record needs: prompt, ground_truth
            if "prompt" in obj:
                records.append(
                    {
                        "prompt": obj["prompt"],
                        "ground_truth": {
                            "violations": obj.get("violations", []),
                            "expected_verdict": obj.get("verdict", "UNKNOWN"),
                        },
                    }
                )
            elif "conversations" in obj:
                # Convert ShareGPT format — use human turn as prompt
                human_turns = [t for t in obj["conversations"] if t["from"] == "human"]
                if human_turns:
                    records.append(
                        {
                            "prompt": human_turns[0]["value"],
                            "ground_truth": obj.get("metadata", {}),
                        }
                    )
        except json.JSONDecodeError:
            continue

    logger.info(f"Loaded {len(records):,} GRPO prompts")
    return Dataset.from_list(records)


# ---------------------------------------------------------------------------
# Main training function
# ---------------------------------------------------------------------------


def train(args: argparse.Namespace) -> None:
    logger.info(f"FiduciaryOS GRPO Training | model={args.model_path}")

    dataset = load_grpo_dataset(args.data_path)

    grpo_config = GRPOConfig(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        bf16=True,
        logging_steps=10,
        save_strategy="steps",
        save_steps=250,
        save_total_limit=2,
        deepspeed=args.deepspeed,
        report_to="wandb" if os.environ.get("WANDB_API_KEY") else [],
        run_name="fiduciaryos-grpo-v1",
        # GRPO-specific
        num_generations=8,  # G=8: sample 8 completions per prompt
        max_completion_length=1024,
        temperature=0.9,
    )

    trainer = GRPOTrainer(
        model=args.model_path,
        reward_funcs=[reward_fn],
        args=grpo_config,
        train_dataset=dataset,
    )

    logger.info("Starting GRPO training...")
    trainer.train()
    trainer.save_model(args.output_dir)

    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(args.model_path, trust_remote_code=True)  # nosec B615
    tokenizer.save_pretrained(args.output_dir)

    logger.info(f"GRPO training complete. Model saved to {args.output_dir}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FiduciaryOS GRPO Training")
    parser.add_argument("--model_path", type=str, default="checkpoints/sft/merged")
    parser.add_argument(
        "--data_path", type=str, default="data/train/grpo_prompts.jsonl"
    )
    parser.add_argument("--output_dir", type=str, default="checkpoints/grpo")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch_size", type=int, default=1)
    parser.add_argument("--grad_accum", type=int, default=16)
    parser.add_argument("--learning_rate", type=float, default=1e-5)
    parser.add_argument(
        "--deepspeed", type=str, default="training/configs/deepspeed_zero3.json"
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to YAML config (currently unused)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    train(args)
