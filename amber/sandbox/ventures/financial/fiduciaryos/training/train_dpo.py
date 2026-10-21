"""
training/train_dpo.py — Stage 3: DPO preference alignment for FiduciaryOS.

Direct Preference Optimization using fiduciary quality preference pairs:
  chosen:   High-quality fiduciary response (specific, legally accurate, tax-aware)
  rejected: Low-quality response (vague, legally inaccurate, or advice-giver-centric)

DPO pairs are sourced from:
  1. synthesis/fiduciary_pairs.py curated templates (50 hand-crafted pairs)
  2. Auto-generated pairs where two completions were sampled and ranked
     by the GRPO reward function (top vs. bottom of G=8 sample)
  3. Human feedback from financial domain expert review (optional)

Expected improvement from DPO:
  - Reduces verbosity and generic platitudes
  - Increases specificity of tax calculations
  - Improves legal citation accuracy
  - Reduces hedge-all-bets non-answers

Run command (10x A6000 GPUs 8–17):
    deepspeed --num_gpus=10 training/train_dpo.py \
        --model_path checkpoints/grpo \
        --data_path data/train/fiduciary_dpo.jsonl \
        --output_dir checkpoints/dpo

Expected runtime: ~18 hours on 10x A6000
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import torch
from datasets import Dataset
from loguru import logger
from peft import PeftModel
from trl import DPOConfig, DPOTrainer
from transformers import AutoModelForCausalLM, AutoTokenizer


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_dpo_dataset(data_path: str) -> Dataset:
    """
    Load DPO training data.

    Expected format (each line):
    {
      "prompt": "...",
      "chosen": "...",
      "rejected": "...",
      "failure_reason": "..."  (optional, for logging)
    }

    Also accepts ShareGPT format with 'chosen_conversations' and 'rejected_conversations'.
    """
    records = []
    for line in Path(data_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)

            if "prompt" in obj and "chosen" in obj and "rejected" in obj:
                records.append(
                    {
                        "prompt": obj["prompt"],
                        "chosen": obj["chosen"],
                        "rejected": obj["rejected"],
                    }
                )

            elif (
                "human_message" in obj
                and "ideal_response" in obj
                and "rejection_example" in obj
            ):
                # fiduciary_pairs.py template format
                records.append(
                    {
                        "prompt": obj["human_message"],
                        "chosen": obj["ideal_response"],
                        "rejected": obj["rejection_example"],
                    }
                )

        except json.JSONDecodeError:
            continue

    logger.info(f"Loaded {len(records):,} DPO preference pairs")

    if not records:
        # Load from built-in templates as fallback
        from synthesis.fiduciary_pairs import TEMPLATES

        for t in TEMPLATES:
            records.append(
                {
                    "prompt": t.human_message,
                    "chosen": t.ideal_response,
                    "rejected": t.rejection_example,
                }
            )
        logger.info(
            f"Loaded {len(records)} built-in fiduciary pair templates as DPO seed data"
        )

    return Dataset.from_list(records)


# ---------------------------------------------------------------------------
# Main training function
# ---------------------------------------------------------------------------


def train(args: argparse.Namespace) -> None:
    logger.info(f"FiduciaryOS DPO Training | model={args.model_path}")

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(  # nosec B615
        args.model_path,
        trust_remote_code=True,
        padding_side="left",
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load policy model (the model we're training) from PEFT adapter checkpoint
    base_model = AutoModelForCausalLM.from_pretrained(  # nosec B615
        args.base_model,
        torch_dtype=torch.bfloat16,
        attn_implementation="flash_attention_2",
        device_map=None,
    )
    policy_model = PeftModel.from_pretrained(base_model, args.model_path)  # nosec B615
    policy_model.enable_input_require_grads()

    # Load dataset
    dataset = load_dpo_dataset(args.data_path)
    split = dataset.train_test_split(test_size=0.05, seed=42)
    train_dataset = split["train"]
    eval_dataset = split["test"]
    logger.info(f"DPO train: {len(train_dataset):,} | eval: {len(eval_dataset):,}")

    # DPO config
    dpo_config = DPOConfig(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.01,
        bf16=True,
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=200,
        save_strategy="steps",
        save_steps=200,
        save_total_limit=2,
        load_best_model_at_end=True,
        deepspeed=args.deepspeed,
        report_to="wandb" if os.environ.get("WANDB_API_KEY") else [],
        run_name="fiduciaryos-dpo-v1",
        # DPO-specific
        beta=0.1,  # KL divergence penalty (low = stay closer to SFT)
        loss_type="sigmoid",  # Standard DPO loss
        max_length=4096,
        max_prompt_length=2048,
    )

    # Load a frozen reference model (required for stable KL divergence computation)
    logger.info("Loading frozen reference model...")
    ref_base_model = AutoModelForCausalLM.from_pretrained(  # nosec B615
        args.base_model,
        torch_dtype=torch.bfloat16,
        device_map=None,
    )
    ref_model = PeftModel.from_pretrained(ref_base_model, args.model_path)  # nosec B615
    ref_model.eval()

    trainer = DPOTrainer(
        model=policy_model,
        ref_model=ref_model,
        args=dpo_config,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
    )

    logger.info("Starting DPO training...")
    trainer.train()

    logger.info(f"Saving final model to {args.output_dir}/final")
    policy_model.save_pretrained(f"{args.output_dir}/final")
    tokenizer.save_pretrained(f"{args.output_dir}/final")
    logger.info("DPO training complete.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FiduciaryOS DPO Training")
    parser.add_argument("--model_path", type=str, default="checkpoints/grpo")
    parser.add_argument(
        "--data_path", type=str, default="data/train/fiduciary_dpo.jsonl"
    )
    parser.add_argument("--output_dir", type=str, default="checkpoints/dpo")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch_size", type=int, default=2)
    parser.add_argument("--grad_accum", type=int, default=8)
    parser.add_argument("--learning_rate", type=float, default=5e-7)
    parser.add_argument(
        "--deepspeed", type=str, default="training/configs/deepspeed_zero3.json"
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to YAML config (currently unused)",
    )
    parser.add_argument(
        "--base_model", type=str, default="Qwen/Qwen2.5-7B-Coder-Instruct"
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    train(args)
