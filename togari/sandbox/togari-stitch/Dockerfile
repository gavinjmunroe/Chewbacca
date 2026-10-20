# ============================================================================
# Togari Healthcare MCP Server — Multi-stage Dockerfile for Cloud Run
# ============================================================================

# --- Stage 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json build.mjs ./
COPY src/ src/

RUN node build.mjs

# Remove dev dependencies and source maps
RUN npm prune --production && \
    find dist/ -name '*.map' -delete 2>/dev/null || true

# --- Stage 2: Runtime ---
FROM node:20-slim AS runtime

WORKDIR /app

# Non-root user for security
RUN addgroup --system --gid 1001 togari && \
    adduser --system --uid 1001 --ingroup togari togari

# Copy built artifacts and production deps
COPY --from=builder --chown=togari:togari /app/dist/ ./dist/
COPY --from=builder --chown=togari:togari /app/node_modules/ ./node_modules/
COPY --from=builder --chown=togari:togari /app/package.json ./

# Cloud Run provides PORT env var (default 8080)
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

USER togari

# Health check (Cloud Run uses HTTP probes, not Docker HEALTHCHECK)
CMD ["node", "dist/index.cjs"]
