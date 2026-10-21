#!/bin/bash
# FiduciaryOS — Full pipeline: discovery → synthesis → train SFT → train RL → train DPO
# Runtime: ~40 hours on 18× A6000
#
# Resume from a stage: FROM_STAGE=3 ./scripts/run_all.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

FROM_STAGE="${FROM_STAGE:-1}"

# Load environment
if [ -f .env ]; then
	set -a
	source .env
	set +a
else
	echo "ERROR: .env file not found. Copy .env.example and fill in your keys."
	exit 1
fi

# Validate environment
echo "=== Validating environment ==="
bash scripts/check_env.sh

echo ""
echo "=== FiduciaryOS Full Pipeline ==="
echo "Started: $(date)"
echo "Resuming from stage: $FROM_STAGE"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 DISCOVER — SEC filings, enforcement actions, financial papers, market data
# ─────────────────────────────────────────────────────────────────────────────
if [ "$FROM_STAGE" -le 1 ]; then
	echo "━━━ STEP 1 DISCOVER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

	echo "  [1/5] Crawling SEC EDGAR filings (ADV Part 2, no-action letters, 13F)..."
	python -c "
from discovery.sec_filings import SECFilingCrawler
crawler = SECFilingCrawler()
n = crawler.crawl_adv_part2(max_advisers=5000)
print(f'ADV Part 2: {n} sections saved')
n = crawler.crawl_no_action_letters(max_letters=2000)
print(f'No-action letters: {n} saved')
"

	echo "  [2/5] Crawling SEC enforcement actions..."
	python -c "
from discovery.enforcement_actions import EnforcementActionCrawler
crawler = EnforcementActionCrawler()
n = crawler.crawl_sec_lit_releases(max_releases=3000)
print(f'SEC lit releases: {n} saved')
n = crawler.build_violation_pairs()
print(f'Violation pairs: {n} built')
"

	echo "  [3/5] Crawling financial research papers (Semantic Scholar + SSRN)..."
	python discovery/financial_papers.py \
		--output data/raw/financial_papers \
		--max-papers 8000

	echo "  [4/5] Collecting market data (yfinance + FRED)..."
	python discovery/market_data.py \
		--output data/raw/market_data \
		--start 2000-01-01

	echo "  [5/5] Collecting tax optimization knowledge (IRS publications + rules)..."
	python discovery/tax_optimization.py \
		--output data/raw/tax_data

	echo ""
	echo "  STEP 1 DISCOVER complete: $(date)"
	echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 SYNTHESIZE — Generate fiduciary reasoning pairs from scenarios
# ─────────────────────────────────────────────────────────────────────────────
if [ "$FROM_STAGE" -le 2 ]; then
	echo "━━━ STEP 2 SYNTHESIZE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

	echo "  Starting vLLM synthesis cluster (4 instances, GPUs 0-15)..."
	bash scripts/start_vllm.sh
	export VLLM_URLS="http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004"

	echo "  Generating portfolio construction reasoning pairs (target: 87,500)..."
	python synthesis/portfolio_synthesizer.py \
		--output data/synthesized/portfolio_pairs.jsonl \
		--count 87500 \
		--backend vllm

	echo "  Running bulk fiduciary synthesis (SFT + violation pairs)..."
	python synthesis/synthesize_bulk.py \
		--backend vllm

	echo "  Killing vLLM synthesis cluster..."
	pkill -f "vllm serve" 2>/dev/null || pkill -f "vllm.entrypoints" 2>/dev/null || true

	echo ""
	echo "  STEP 2 SYNTHESIZE complete: $(date)"
	echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 TRAIN SFT — Supervised fine-tuning on fiduciary decision corpus
# ─────────────────────────────────────────────────────────────────────────────
if [ "$FROM_STAGE" -le 3 ]; then
	echo "━━━ STEP 3 TRAIN SFT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	CUDA_VISIBLE_DEVICES=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17 \
		deepspeed --num_gpus=18 training/train.py \
		--config training/configs/sft_config.yaml \
		--deepspeed training/configs/deepspeed_zero3.json

	echo ""
	echo "  STEP 3 TRAIN SFT complete: $(date)"
	echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 TRAIN RL — GRPO with fiduciary quality reward
# ─────────────────────────────────────────────────────────────────────────────
if [ "$FROM_STAGE" -le 4 ]; then
	echo "━━━ STEP 4 TRAIN RL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	CUDA_VISIBLE_DEVICES=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17 \
		deepspeed --num_gpus=18 training/train_rl.py \
		--config training/configs/rl_config.yaml \
		--deepspeed training/configs/deepspeed_zero3.json

	echo ""
	echo "  STEP 4 TRAIN RL complete: $(date)"
	echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 TRAIN DPO — Direct preference optimization on fiduciary pairs
# ─────────────────────────────────────────────────────────────────────────────
if [ "$FROM_STAGE" -le 5 ]; then
	echo "━━━ STEP 5 TRAIN DPO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	CUDA_VISIBLE_DEVICES=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17 \
		deepspeed --num_gpus=18 training/train_dpo.py \
		--config training/configs/dpo_config.yaml \
		--deepspeed training/configs/deepspeed_zero3.json

	echo ""
	echo "  STEP 5 TRAIN DPO complete: $(date)"
	echo ""
fi

echo "=== Pipeline complete: $(date) ==="
echo "Final model: checkpoints/dpo/final/"
echo "Results: results/fiduciarybench_results.json"
