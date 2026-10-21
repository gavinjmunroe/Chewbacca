# FiduciaryOS API Service
# Multi-stage build for minimal production image

FROM python:3.11-slim AS base

# Security: non-root user
RUN groupadd --gid 1001 fiduciaryos && \
    useradd --uid 1001 --gid 1001 --no-create-home --shell /bin/false fiduciaryos

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Builder stage: install Python dependencies
# ---------------------------------------------------------------------------
FROM base AS builder

COPY requirements.txt .
# hadolint ignore=DL3013
RUN pip install --no-cache-dir --user -r requirements.txt && \
    pip install --no-cache-dir --user uvicorn[standard] fastapi

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM base AS runtime

# Copy installed packages from builder
COPY --from=builder /root/.local /home/fiduciaryos/.local

# Copy application code
COPY core/ ./core/
COPY agents/ ./agents/
COPY evaluation/ ./evaluation/
COPY api/ ./api/

# Data directories (mounted at runtime — not baked in)
RUN mkdir -p data/audit_logs data/risk_guardian && \
    chown -R fiduciaryos:fiduciaryos /app

# Keys directory: signing keys are mounted as secrets, never baked in
RUN mkdir -p .keys && chown fiduciaryos:fiduciaryos .keys

# Switch to non-root
USER fiduciaryos

# Expose API port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Entrypoint
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV PATH="/home/fiduciaryos/.local/bin:$PATH"

CMD ["uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "4"]
