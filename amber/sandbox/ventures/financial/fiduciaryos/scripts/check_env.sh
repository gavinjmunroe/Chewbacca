#!/usr/bin/env bash
# scripts/check_env.sh — Validate FiduciaryOS environment and dependencies
#
# Checks:
#   - Python version (3.10+)
#   - Required packages (torch, transformers, peft, trl, deepspeed, cryptography)
#   - CUDA and GPU availability
#   - Required env vars
#   - Signing key files
#   - Disk space (data + checkpoints)

set -euo pipefail

PASS=0
FAIL=0
WARN=0

pass() {
	echo "  [PASS] $*"
	((PASS++)) || true
}
fail() {
	echo "  [FAIL] $*"
	((FAIL++)) || true
}
warn() {
	echo "  [WARN] $*"
	((WARN++)) || true
}

echo "=== FiduciaryOS Environment Check ==="
echo ""

# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------
echo "[ Python ]"
PY_VER=$(python --version 2>&1 | awk '{print $2}')
MAJOR=$(echo "${PY_VER}" | cut -d. -f1)
MINOR=$(echo "${PY_VER}" | cut -d. -f2)
if [[ "${MAJOR}" -ge 3 && "${MINOR}" -ge 10 ]]; then
	pass "Python ${PY_VER}"
else
	fail "Python ${PY_VER} — need 3.10+"
fi

# ---------------------------------------------------------------------------
# Core packages
# ---------------------------------------------------------------------------
echo ""
echo "[ Core Packages ]"

check_package() {
	PKG=$1
	if python -c "import ${PKG}; print(getattr(${PKG}, '__version__', 'ok'))" 2>/dev/null; then
		pass "${PKG}"
	else
		fail "${PKG} not found"
	fi
}

check_package torch
check_package transformers
check_package peft
check_package trl
check_package deepspeed
check_package datasets
check_package loguru
check_package cryptography
check_package requests
check_package numpy
check_package scipy

# ---------------------------------------------------------------------------
# CUDA and GPUs
# ---------------------------------------------------------------------------
echo ""
echo "[ CUDA & GPUs ]"

if python -c "import torch; assert torch.cuda.is_available()" 2>/dev/null; then
	GPU_COUNT=$(python -c "import torch; print(torch.cuda.device_count())")
	CUDA_VER=$(python -c "import torch; print(torch.version.cuda)")
	pass "CUDA ${CUDA_VER} — ${GPU_COUNT} GPU(s)"

	# Check for minimum GPU memory (A6000 = 48GB)
	for i in $(seq 0 $((GPU_COUNT - 1))); do
		MEM=$(python -c "import torch; print(torch.cuda.get_device_properties(${i}).total_memory // (1024**3))")
		GPU_NAME=$(python -c "import torch; print(torch.cuda.get_device_properties(${i}).name)")
		if [[ "${MEM}" -ge 24 ]]; then
			pass "GPU ${i}: ${GPU_NAME} (${MEM}GB)"
		else
			warn "GPU ${i}: ${GPU_NAME} (${MEM}GB) — 24GB+ recommended for 7B models with ZeRO-3"
		fi
	done

	if [[ "${GPU_COUNT}" -ge 10 ]]; then
		pass "${GPU_COUNT} GPUs available (training uses GPUs 8-17)"
	elif [[ "${GPU_COUNT}" -ge 2 ]]; then
		warn "${GPU_COUNT} GPUs — full training requires 10+ A6000 GPUs"
	else
		fail "Only ${GPU_COUNT} GPU(s) — distributed training not possible"
	fi
else
	fail "CUDA not available — GPU training not possible"
fi

# ---------------------------------------------------------------------------
# Environment variables
# ---------------------------------------------------------------------------
echo ""
echo "[ Environment Variables ]"

check_env() {
	VAR=$1
	REQUIRED=${2:-true}
	if [[ -n "${!VAR:-}" ]]; then
		pass "${VAR} set"
	elif [[ "${REQUIRED}" == "true" ]]; then
		fail "${VAR} not set (required)"
	else
		warn "${VAR} not set (optional)"
	fi
}

check_env ANTHROPIC_API_KEY true
check_env SEC_USER_AGENT false
check_env WANDB_API_KEY false
check_env HF_TOKEN false
check_env POLICY_SIGNING_KEY_PATH false
check_env VLLM_URLS false

# ---------------------------------------------------------------------------
# Signing keys
# ---------------------------------------------------------------------------
echo ""
echo "[ Signing Keys ]"

KEY_PATH="${POLICY_SIGNING_KEY_PATH:-.keys/policy_signing_key.pem}"
if [[ -f "${KEY_PATH}" ]]; then
	pass "Signing key found at ${KEY_PATH}"
else
	warn "Signing key not found at ${KEY_PATH} — Policy Artifacts will be unsigned (dev mode)"
	echo "    Generate keys: python -c \"from core.policy_compiler import PolicyCompiler; PolicyCompiler()\""
fi

# ---------------------------------------------------------------------------
# Disk space
# ---------------------------------------------------------------------------
echo ""
echo "[ Disk Space ]"

# Need: ~500GB for data, ~300GB for checkpoints
AVAILABLE=$(df -BG . | awk 'NR==2 {gsub("G",""); print $4}')
if [[ "${AVAILABLE}" -ge 800 ]]; then
	pass "${AVAILABLE}GB available (800GB+ recommended)"
elif [[ "${AVAILABLE}" -ge 400 ]]; then
	warn "${AVAILABLE}GB available — 800GB+ recommended for full training"
else
	fail "${AVAILABLE}GB available — insufficient for full training pipeline"
fi

# ---------------------------------------------------------------------------
# deepspeed config check
# ---------------------------------------------------------------------------
echo ""
echo "[ DeepSpeed Config ]"

if [[ -f "training/configs/deepspeed_zero3.json" ]]; then
	if python -c "import json; json.load(open('training/configs/deepspeed_zero3.json'))" 2>/dev/null; then
		pass "deepspeed_zero3.json valid JSON"
	else
		fail "deepspeed_zero3.json invalid JSON"
	fi
else
	fail "training/configs/deepspeed_zero3.json not found"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Summary ==="
echo "  PASS: ${PASS}"
echo "  WARN: ${WARN}"
echo "  FAIL: ${FAIL}"
echo ""

if [[ "${FAIL}" -gt 0 ]]; then
	echo "ENVIRONMENT CHECK FAILED — resolve above failures before running pipeline"
	exit 1
elif [[ "${WARN}" -gt 0 ]]; then
	echo "ENVIRONMENT CHECK PASSED (with warnings)"
	exit 0
else
	echo "ENVIRONMENT CHECK PASSED"
	exit 0
fi
