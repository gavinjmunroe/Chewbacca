/**
 * Health check endpoint — public, no auth.
 *
 * GET /api/v1/health
 *   200 if BQ reachable + env passes + Anthropic key shape is valid
 *   503 with structured failure detail otherwise
 *
 * Used by deploy verification (curl after every push) and by Karthik to
 * confirm the box is alive without grepping logs.
 */

import type { FastifyInstance } from "fastify";
import { BigQuery } from "@google-cloud/bigquery";
import { checkEnv } from "../lib/env.js";

interface HealthReport {
  ok: boolean;
  version: string;
  uptime_seconds: number;
  checks: {
    env: {
      ok: boolean;
      missing_required: string[];
      missing_optional_count: number;
    };
    bigquery: {
      ok: boolean;
      project: string;
      latency_ms?: number;
      error?: string;
    };
    anthropic_key: { ok: boolean; reason: string };
  };
}

const VERSION = process.env.npm_package_version ?? "1.0.0";
const PROJECT = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";

async function checkBigQuery(): Promise<HealthReport["checks"]["bigquery"]> {
  const t0 = Date.now();
  try {
    const opts: ConstructorParameters<typeof BigQuery>[0] = {
      projectId: PROJECT,
    };
    const b64 = process.env.GCP_CREDENTIALS_BASE64;
    if (b64)
      opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
    const bq = new BigQuery(opts);
    await bq.query({ query: "SELECT 1 AS ok", useLegacySql: false });
    return { ok: true, project: PROJECT, latency_ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      project: PROJECT,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkAnthropicKey(): HealthReport["checks"]["anthropic_key"] {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return { ok: false, reason: "not set (Haiku classifier degraded)" };
  if (!k.startsWith("sk-ant-"))
    return { ok: false, reason: "wrong prefix (expected sk-ant-)" };
  return { ok: true, reason: "present" };
}

export async function registerHealthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/health", async (_request, reply) => {
    const envReport = checkEnv();
    const [bq, anthropic] = await Promise.all([
      checkBigQuery(),
      Promise.resolve(checkAnthropicKey()),
    ]);

    const report: HealthReport = {
      ok: envReport.ok && bq.ok,
      version: VERSION,
      uptime_seconds: Math.round(process.uptime()),
      checks: {
        env: {
          ok: envReport.ok,
          missing_required: envReport.missingRequired,
          missing_optional_count: envReport.missingOptional.length,
        },
        bigquery: bq,
        anthropic_key: anthropic,
      },
    };

    await reply.status(report.ok ? 200 : 503).send(report);
  });

  app.log.info("[dedup] health route mounted: GET /api/v1/health");
}
