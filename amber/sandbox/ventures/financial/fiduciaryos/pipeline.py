"""
pipeline.py — FiduciaryOS end-to-end orchestration.

Stages:
  discovery  — crawl SEC/FINRA enforcement actions + CFA corpus
  synthesis  — generate training pairs (portfolio, fiduciary, tax)
  train      — 3-stage training (SFT → GRPO → DPO)
  eval       — FiduciaryBench evaluation

Usage:
    python pipeline.py                          # full run
    python pipeline.py --stage discovery        # crawl only
    python pipeline.py --stage synthesis        # synthesis only
    python pipeline.py --stage train            # training only
    python pipeline.py --stage eval             # evaluation only
    python pipeline.py --stats                  # dataset statistics
    python pipeline.py --stage synthesis --backend claude  # use Claude API
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import subprocess
import sys
from pathlib import Path

from loguru import logger

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
TRAIN_DIR = DATA_DIR / "train"
CHECKPOINTS_DIR = ROOT / "checkpoints"

for d in [RAW_DIR, PROCESSED_DIR, TRAIN_DIR, CHECKPOINTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Stage runners
# ---------------------------------------------------------------------------


def stage_discovery(args: argparse.Namespace) -> None:
    """Crawl SEC/FINRA enforcement actions and CFA corpus."""
    logger.info("=== STAGE: DISCOVERY ===")

    logger.info("Crawling SEC EDGAR enforcement actions...")
    from discovery.sec_filings import SECFilingCrawler

    crawler = SECFilingCrawler(output_dir=RAW_DIR / "sec")
    n_sec = crawler.run(max_actions=30_000)
    logger.info(f"Collected {n_sec:,} SEC enforcement releases")

    logger.info("Crawling FINRA enforcement actions...")
    from discovery.enforcement_actions import EnforcementActionCrawler

    finra = EnforcementActionCrawler(output_dir=RAW_DIR / "finra")
    n_finra = finra.run(max_actions=30_000)
    logger.info(f"Collected {n_finra:,} FINRA enforcement actions")

    logger.info("Discovery complete.")
    logger.info(f"Total raw documents: {n_sec + n_finra:,}")


def stage_synthesis(args: argparse.Namespace) -> None:
    """Generate training pairs from crawled enforcement actions and case studies."""
    logger.info("=== STAGE: SYNTHESIS ===")

    backend = getattr(args, "backend", "vllm")
    vllm_urls = None
    if backend == "vllm":
        import os

        urls_str = os.environ.get(
            "VLLM_URLS",
            "http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004,http://localhost:8005",
        )
        vllm_urls = [u.strip() for u in urls_str.split(",")]
        logger.info(f"Using vLLM backend: {vllm_urls}")
    else:
        logger.info("Using Claude API backend")

    # --- Streams 1–5: enforcement, portfolio, tax, rebalance, risk ---
    from synthesis.synthesize_bulk import FiduciaryBulkSynthesizer

    synthesizer = FiduciaryBulkSynthesizer(
        output_dir=PROCESSED_DIR,
        backend=backend,
        vllm_urls=vllm_urls,
        max_workers=25,
    )
    stats = synthesizer.run()
    total = sum(stats.values())
    logger.info(f"Streams 1–5 complete: {total:,} pairs")
    logger.info(f"  portfolio pairs:    {stats.get('portfolio', 0):,}")
    logger.info(f"  violation pairs:    {stats.get('violation', 0):,}")
    logger.info(f"  tax pairs:          {stats.get('tax', 0):,}")
    logger.info(f"  rebalance pairs:    {stats.get('rebalance', 0):,}")
    logger.info(f"  risk pairs:         {stats.get('risk', 0):,}")

    # --- Stream 6: Francesca financial planning engines ---
    logger.info("Running Stream 6: Francesca financial planning synthesis...")
    from synthesis.financial_planning_synthesizer import FinancialPlanningSynthesizer

    fp_synthesizer = FinancialPlanningSynthesizer(
        output_dir=PROCESSED_DIR,
        backend=backend,
        vllm_urls=vllm_urls,
        max_workers=25,
    )
    fp_stats = fp_synthesizer.run()
    fp_total = sum(fp_stats.values())
    logger.info(f"Stream 6 complete: {fp_total:,} financial planning pairs")
    logger.info(f"  contribution_sequencing:     {fp_stats.get('contribution_sequencing', 0):,}")
    logger.info(f"  tax_analysis:                {fp_stats.get('tax_analysis', 0):,}")
    logger.info(f"  monte_carlo_interpretation:  {fp_stats.get('monte_carlo_interpretation', 0):,}")
    logger.info(f"  roth_phase_out:              {fp_stats.get('roth_phase_out', 0):,}")
    logger.info(f"  retirement_readiness:        {fp_stats.get('retirement_readiness', 0):,}")
    logger.info(f"  cashflow_optimization:       {fp_stats.get('cashflow_optimization', 0):,}")

    # --- Stream 7: CPA-grade tax preparation ---
    logger.info("Running Stream 7: CPA-grade tax preparation synthesis...")
    from synthesis.tax_preparation_synthesizer import TaxPreparationSynthesizer

    tax_synthesizer = TaxPreparationSynthesizer(
        output_dir=PROCESSED_DIR,
        backend=backend,
        vllm_urls=vllm_urls,
        max_workers=25,
    )
    tax_stats = tax_synthesizer.run()
    tax_total = sum(tax_stats.values())
    logger.info(f"Stream 7 complete: {tax_total:,} CPA tax preparation pairs")
    logger.info(f"  equity_compensation:   {tax_stats.get('equity_compensation', 0):,}")
    logger.info(f"  amt_planning:          {tax_stats.get('amt_planning', 0):,}")
    logger.info(f"  schedule_d_harvest:    {tax_stats.get('schedule_d_harvest', 0):,}")
    logger.info(f"  retirement_tax:        {tax_stats.get('retirement_tax', 0):,}")
    logger.info(f"  qsbs_planning:         {tax_stats.get('qsbs_planning', 0):,}")
    logger.info(f"  quarterly_estimates:   {tax_stats.get('quarterly_estimates', 0):,}")

    grand_total = total + fp_total + tax_total
    logger.info(f"All 7 streams complete: {grand_total:,} total training pairs")

    logger.info("Merging and splitting dataset...")
    _merge_and_split()


def _merge_and_split() -> None:
    """Merge, deduplicate, and split dataset into train/val/test."""
    import random

    try:
        from datasketch import MinHash, MinHashLSH

        HAS_DATASKETCH = True
    except ImportError:
        HAS_DATASKETCH = False

    all_pairs: list[dict] = []
    for f in sorted(PROCESSED_DIR.glob("*.jsonl")):
        for line in f.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    all_pairs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    logger.info(f"Total pairs before dedup: {len(all_pairs):,}")

    if HAS_DATASKETCH:
        lsh = MinHashLSH(threshold=0.85, num_perm=128)
        deduped: list[dict] = []
        for i, pair in enumerate(all_pairs):
            text = json.dumps(pair, sort_keys=True)
            m = MinHash(num_perm=128)
            for word in text.split():
                m.update(word.encode())
            key = f"pair_{i}"
            if not lsh.query(m):
                lsh.insert(key, m)
                deduped.append(pair)
    else:
        logger.warning("datasketch not installed — skipping MinHash deduplication")
        deduped = all_pairs

    logger.info(f"Pairs after dedup: {len(deduped):,}")

    random.shuffle(deduped)
    n = len(deduped)
    n_train = int(n * 0.90)
    n_val = int(n * 0.05)

    splits = {
        "train": deduped[:n_train],
        "val": deduped[n_train : n_train + n_val],
        "test": deduped[n_train + n_val :],
    }

    for split_name, pairs in splits.items():
        out_path = TRAIN_DIR / f"fiduciaryos_{split_name}.jsonl"
        out_path.write_text("\n".join(json.dumps(p) for p in pairs) + "\n")
        logger.info(f"  {split_name}: {len(pairs):,} → {out_path}")


def stage_train(args: argparse.Namespace) -> None:
    """Run 3-stage training: SFT → GRPO → DPO."""
    logger.info("=== STAGE: TRAINING ===")

    sft_ckpt = CHECKPOINTS_DIR / "fiduciaryos-sft"
    rl_ckpt = CHECKPOINTS_DIR / "fiduciaryos-rl"
    final_ckpt = CHECKPOINTS_DIR / "fiduciaryos-final"

    if not (sft_ckpt / "config.json").exists():
        logger.info("--- Stage 1: SFT ---")
        _run_deepspeed(
            "training/train.py",
            [
                "--model_name_or_path",
                "Qwen/Qwen2.5-32B-Instruct",
                "--data_path",
                str(TRAIN_DIR),
                "--output_dir",
                str(sft_ckpt),
                "--epochs",
                "3",
                "--batch_size",
                "1",
                "--grad_accum",
                "8",
                "--learning_rate",
                "2e-4",
                "--max_seq_length",
                "8192",
                "--deepspeed",
                "training/configs/deepspeed_zero3.json",
            ],
        )

    if not (rl_ckpt / "config.json").exists():
        logger.info("--- Stage 2: GRPO ---")
        _run_deepspeed(
            "training/train_rl.py",
            [
                "--model_path",
                str(sft_ckpt),
                "--data_path",
                str(TRAIN_DIR / "grpo_prompts.jsonl"),
                "--output_dir",
                str(rl_ckpt),
                "--deepspeed",
                "training/configs/deepspeed_zero3.json",
            ],
        )

    if not (final_ckpt / "config.json").exists():
        logger.info("--- Stage 3: DPO ---")
        _run_deepspeed(
            "training/train_dpo.py",
            [
                "--model_path",
                str(rl_ckpt),
                "--data_path",
                str(TRAIN_DIR / "dpo_pairs.jsonl"),
                "--output_dir",
                str(final_ckpt),
                "--deepspeed",
                "training/configs/deepspeed_zero3.json",
            ],
        )

    logger.info(f"Training complete. Final model: {final_ckpt}")


def _run_deepspeed(script: str, extra_args: list[str]) -> None:
    import os

    visible = os.environ.get("CUDA_VISIBLE_DEVICES", "")
    n_gpus = (
        len([x for x in visible.split(",") if x.strip()])
        if visible and visible.strip()
        else 10
    )
    cmd = ["deepspeed", f"--num_gpus={n_gpus}", script] + extra_args
    logger.info(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        logger.error(f"Training failed with exit code {result.returncode}")
        sys.exit(result.returncode)


def stage_eval(args: argparse.Namespace) -> None:
    """Run FiduciaryBench evaluation."""
    logger.info("=== STAGE: EVALUATION ===")
    final_ckpt = CHECKPOINTS_DIR / "fiduciaryos-final"
    if not final_ckpt.exists():
        logger.error(f"No final checkpoint at {final_ckpt}. Run training first.")
        sys.exit(1)

    from evaluation.fiduciarybench import FiduciaryBench

    bench = FiduciaryBench(model_path=str(final_ckpt))
    results = bench.run_all()

    logger.info("=== FiduciaryBench Results ===")
    results_dict = (
        dataclasses.asdict(results) if dataclasses.is_dataclass(results) else results
    )
    for metric, value in results_dict.items():
        if isinstance(value, (int, float)):
            logger.info(f"  {metric:<45} {value:.4f}")
        else:
            logger.info(f"  {metric:<45} {value}")

    results_path = ROOT / "results" / "fiduciarybench_results.json"
    results_path.parent.mkdir(exist_ok=True)
    results_path.write_text(json.dumps(results_dict, indent=2))


def print_stats() -> None:
    logger.info("=== DATASET STATS ===")
    for split in ["train", "val", "test"]:
        p = TRAIN_DIR / f"fiduciaryos_{split}.jsonl"
        if p.exists():
            n = len([line for line in p.read_text().splitlines() if line.strip()])
            logger.info(f"  {split}: {n:,} pairs")


def main() -> None:
    parser = argparse.ArgumentParser(description="FiduciaryOS pipeline")
    parser.add_argument("--stage", choices=["discovery", "synthesis", "train", "eval"])
    parser.add_argument("--backend", choices=["vllm", "claude"], default="vllm")
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    if args.stats:
        print_stats()
        return

    if args.stage is None:
        stage_discovery(args)
        stage_synthesis(args)
        stage_train(args)
        stage_eval(args)
    elif args.stage == "discovery":
        stage_discovery(args)
    elif args.stage == "synthesis":
        stage_synthesis(args)
    elif args.stage == "train":
        stage_train(args)
    elif args.stage == "eval":
        stage_eval(args)


if __name__ == "__main__":
    main()
