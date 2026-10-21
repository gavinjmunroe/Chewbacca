# FiduciaryOS — 18× A6000 GPU Setup

This guide covers the 18× NVIDIA A6000 (48GB) cluster setup for FiduciaryOS training.

---

## Hardware Configuration

```
Total VRAM:     18 × 48GB = 864GB
GPU allocation:
  GPUs 0-7:    vLLM synthesis (2 instances × 4 GPUs, Qwen2.5-72B)
  GPUs 8-17:   Training (10 GPUs, DeepSpeed ZeRO-3)

Host RAM:       512GB+ required (ZeRO-3 offloads optimizer states to CPU)
Storage:        2TB NVMe SSD (SEC/FINRA corpus ~50GB, processed ~30GB, model ~30GB)
Network:        10GbE minimum for multi-node; NVLink or PCIe Gen4 x16 for GPU interconnect
```

---

## Environment Setup

```bash
conda create -n fiduciaryos python=3.11 -y
conda activate fiduciaryos
pip install -r requirements.txt
pip install flash-attn --no-build-isolation  # Flash Attention 2

# Verify
python -c "import torch; print(f'GPUs: {torch.cuda.device_count()}')"
# Expected: GPUs: 18
```

---

## vLLM Synthesis Setup (GPUs 0–7)

```bash
bash scripts/start_vllm.sh
# Starts 2 Qwen2.5-72B instances on GPUs 0-3 and 4-7
# Instance 1: port 8001, Instance 2: port 8002
```

---

## Training Launch

### Stage 1 — SFT (4 hours estimated)

```bash
CUDA_VISIBLE_DEVICES=8,9,10,11,12,13,14,15,16,17 \
deepspeed --num_gpus=10 training/train.py \
  --model Qwen/Qwen2.5-7B-Coder-Instruct \
  --data-dir data/train \
  --output-dir checkpoints/fiduciaryos-sft \
  --epochs 3 \
  --batch-size 4 \
  --grad-accum 4 \
  --lr 2e-4 \
  --lora-r 64 \
  --max-length 8192 \
  --deepspeed training/configs/deepspeed_zero3.json
```

### Stage 2 — GRPO (2.5 hours estimated)

```bash
CUDA_VISIBLE_DEVICES=8,9,10,11,12,13,14,15,16,17 \
deepspeed --num_gpus=10 training/train_rl.py \
  --model checkpoints/fiduciaryos-sft \
  --data-dir data/train \
  --output-dir checkpoints/fiduciaryos-rl \
  --deepspeed training/configs/deepspeed_zero3.json
```

### Stage 3 — DPO (30 minutes estimated)

```bash
CUDA_VISIBLE_DEVICES=8,9,10,11,12,13,14,15,16,17 \
deepspeed --num_gpus=10 training/train_dpo.py \
  --model checkpoints/fiduciaryos-rl \
  --dpo-data data/train/dpo_pairs.jsonl \
  --output-dir checkpoints/fiduciaryos-final \
  --deepspeed training/configs/deepspeed_zero3.json
```

---

## Memory Estimates

| Stage | GPUs | VRAM/GPU | CPU RAM |
|-------|------|----------|---------|
| SFT (LoRA rank 64, seq 8192) | 10× A6000 | ~34GB | ~130GB |
| GRPO | 10× A6000 | ~38GB | ~150GB |
| DPO | 10× A6000 | ~30GB | ~120GB |
| vLLM synthesis (72B, TP=4) | 4× A6000 | ~46GB | ~40GB |

---

## Environment Validation

```bash
bash scripts/check_env.sh
```

Checks: Python 3.11+, CUDA 12.1+, GPU count ≥ 10, RAM ≥ 256GB, disk ≥ 500GB, all env vars.

---

## Inference Deployment

```bash
# Serve final model with vLLM
CUDA_VISIBLE_DEVICES=0,1 vllm serve checkpoints/fiduciaryos-final \
  --port 9000 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.92 \
  --api-key $VLLM_API_KEY

# Or use Docker Compose
cd deploy && docker compose up -d
```

---

## Performance Benchmarks

| Configuration | Tokens/sec | Latency (p50) | Portfolio analysis |
|---|---|---|---|
| 2× A100 80GB | ~1,200 | ~180ms | ~0.8s |
| 2× A6000 48GB | ~800 | ~250ms | ~1.2s |
| 1× A6000 48GB | ~400 | ~450ms | ~2.5s |
| CPU only | ~30 | ~8s | ~45s |

Minimum for real-time portfolio monitoring: 1× A6000 or equivalent.
