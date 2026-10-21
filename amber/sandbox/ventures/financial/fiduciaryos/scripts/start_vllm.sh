#!/bin/bash
# start_vllm.sh — Start 5 vLLM synthesis servers on 18 GPUs (IYA Innovation Quest 2026)
# Instance 1: GPUs 0-3   → port 8001
# Instance 2: GPUs 4-7   → port 8002
# Instance 3: GPUs 8-11  → port 8003
# Instance 4: GPUs 12-15 → port 8004
# Instance 5: GPUs 16-17 → port 8005 (2-GPU instance for extra synthesis throughput)

set -euo pipefail

MODEL="${VLLM_SYNTHESIS_MODEL:-Qwen/Qwen2.5-72B-Instruct}"
VLLM_API_KEY="${VLLM_API_KEY:-fiduciaryos-secret}"
mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "Starting FiduciaryOS vLLM synthesis servers | model=${MODEL}"

# Instance 1 — GPUs 0,1,2,3
log "Launching Instance 1 (GPUs 0-3, port 8001)..."
CUDA_VISIBLE_DEVICES=0,1,2,3 \
	vllm serve "${MODEL}" \
	--tensor-parallel-size 4 \
	--port 8001 \
	--api-key "${VLLM_API_KEY}" \
	--max-model-len 8192 \
	--gpu-memory-utilization 0.92 \
	--disable-log-requests \
	>logs/vllm_instance1.log 2>&1 &
PID1=$!
log "  Instance 1 PID: ${PID1}"

# Instance 2 — GPUs 4,5,6,7
log "Launching Instance 2 (GPUs 4-7, port 8002)..."
CUDA_VISIBLE_DEVICES=4,5,6,7 \
	vllm serve "${MODEL}" \
	--tensor-parallel-size 4 \
	--port 8002 \
	--api-key "${VLLM_API_KEY}" \
	--max-model-len 8192 \
	--gpu-memory-utilization 0.92 \
	--disable-log-requests \
	>logs/vllm_instance2.log 2>&1 &
PID2=$!
log "  Instance 2 PID: ${PID2}"

# Instance 3 — GPUs 8,9,10,11
log "Launching Instance 3 (GPUs 8-11, port 8003)..."
CUDA_VISIBLE_DEVICES=8,9,10,11 \
	vllm serve "${MODEL}" \
	--tensor-parallel-size 4 \
	--port 8003 \
	--api-key "${VLLM_API_KEY}" \
	--max-model-len 8192 \
	--gpu-memory-utilization 0.92 \
	--disable-log-requests \
	>logs/vllm_instance3.log 2>&1 &
PID3=$!
log "  Instance 3 PID: ${PID3}"

# Instance 4 — GPUs 12,13,14,15
log "Launching Instance 4 (GPUs 12-15, port 8004)..."
CUDA_VISIBLE_DEVICES=12,13,14,15 \
	vllm serve "${MODEL}" \
	--tensor-parallel-size 4 \
	--port 8004 \
	--api-key "${VLLM_API_KEY}" \
	--max-model-len 8192 \
	--gpu-memory-utilization 0.92 \
	--disable-log-requests \
	>logs/vllm_instance4.log 2>&1 &
PID4=$!
log "  Instance 4 PID: ${PID4}"

# Instance 5 — GPUs 16,17 (extra synthesis throughput on remaining GPUs)
log "Launching Instance 5 (GPUs 16-17, port 8005)..."
CUDA_VISIBLE_DEVICES=16,17 \
	vllm serve "${MODEL}" \
	--tensor-parallel-size 2 \
	--port 8005 \
	--api-key "${VLLM_API_KEY}" \
	--max-model-len 8192 \
	--gpu-memory-utilization 0.92 \
	--disable-log-requests \
	>logs/vllm_instance5.log 2>&1 &
PID5=$!
log "  Instance 5 PID: ${PID5}"

log "Waiting 60s for servers to initialize..."
sleep 60

log "Health checks..."
for port in 8001 8002 8003 8004 8005; do
	if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
		log "  [OK] Instance on port ${port} healthy"
	else
		log "  [WARN] Instance on port ${port} not yet responding"
	fi
done

echo "${PID1}" >logs/vllm_instance1.pid
echo "${PID2}" >logs/vllm_instance2.pid
echo "${PID3}" >logs/vllm_instance3.pid
echo "${PID4}" >logs/vllm_instance4.pid
echo "${PID5}" >logs/vllm_instance5.pid

log "vLLM servers started. All 18 GPUs active."
log "VLLM_URLS=http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004,http://localhost:8005"
log "To stop: pkill -f 'vllm serve'"
