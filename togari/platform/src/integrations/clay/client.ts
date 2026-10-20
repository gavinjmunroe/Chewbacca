/**
 * Clay OUTBOUND client.
 *
 * Pushes warehouse rows INTO a Clay table's webhook URL so Clay can enrich
 * them. Each Clay table exposes its own "Send Webhook to a Table" endpoint
 * that accepts one JSON object per HTTP POST and appends it as a row.
 *
 * Design notes:
 *   - No throw on partial failure. Every push returns aggregated counts so
 *     the caller (MCP tool / route) decides how to report.
 *   - Outbound budget: at most CLAY_OUTBOUND_MAX_ROWS (default 500) rows per
 *     call. Anything beyond is trimmed and flagged via `truncated`.
 *   - Concurrency is capped (default 5) so a large push never floods a
 *     single table webhook.
 *   - CLAY_API_KEY, when set, is sent as `Authorization: Bearer <key>`.
 *     Most Clay table webhooks are unauthenticated, so it is optional.
 *
 * Reference: https://www.clay.com/university/guide/webhook-source
 */

import { createLogger } from "../../observability/logger";
import type {
  ClayEnrichResult,
  ClayPushOptions,
  ClayPushResult,
} from "./types";

const logger = createLogger("integrations/clay");

/** Default outbound row cap. Overridable via CLAY_OUTBOUND_MAX_ROWS. */
const DEFAULT_MAX_ROWS = 500;
/** Default number of rows POSTed concurrently. */
const DEFAULT_CONCURRENCY = 5;

function resolveMaxRows(opts?: ClayPushOptions): number {
  if (opts?.maxRows && opts.maxRows > 0) return opts.maxRows;
  const fromEnv = Number(process.env.CLAY_OUTBOUND_MAX_ROWS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return DEFAULT_MAX_ROWS;
}

function resolveBearer(opts?: ClayPushOptions): string | undefined {
  const token = opts?.bearerToken ?? process.env.CLAY_API_KEY;
  return token && token.trim() !== "" ? token.trim() : undefined;
}

/** POST a single row to a Clay table webhook. Never throws. */
async function postRow(
  webhookUrl: string,
  row: Record<string, unknown>,
  bearer: string | undefined,
  index: number,
): Promise<{ ok: boolean; error?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(row),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error:
          `row ${index}: HTTP ${response.status} ${response.statusText} ${text}`.trim(),
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `row ${index}: ${message}` };
  }
}

/**
 * Push rows to a Clay table webhook URL.
 *
 * Rows beyond the outbound cap are dropped and reported via `truncated`.
 * Each row is POSTed individually (Clay's webhook source is one-object-per
 * -request); a small concurrency window bounds the burst.
 */
export async function pushRowsToClayTable(
  webhookUrl: string,
  rows: Record<string, unknown>[],
  opts?: ClayPushOptions,
): Promise<ClayPushResult> {
  const received = rows.length;
  const maxRows = resolveMaxRows(opts);
  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY);
  const bearer = resolveBearer(opts);

  const truncated = received > maxRows;
  const toPush = truncated ? rows.slice(0, maxRows) : rows;

  const result: ClayPushResult = {
    pushed: 0,
    failed: 0,
    errors: [],
    truncated,
    received,
  };

  if (toPush.length === 0) {
    logger.info("clay.push.noop", { webhookHost: safeHost(webhookUrl) });
    return result;
  }

  // Simple bounded-concurrency worker pool over the row indices.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < toPush.length) {
      const idx = cursor;
      cursor += 1;
      const outcome = await postRow(webhookUrl, toPush[idx], bearer, idx);
      if (outcome.ok) {
        result.pushed += 1;
      } else {
        result.failed += 1;
        if (outcome.error) result.errors.push(outcome.error);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, toPush.length) },
    () => worker(),
  );
  await Promise.all(workers);

  logger.info("clay.push.done", {
    webhookHost: safeHost(webhookUrl),
    pushed: result.pushed,
    failed: result.failed,
    truncated: result.truncated,
    received: result.received,
  });

  return result;
}

/**
 * Push records to Clay for enrichment. Thin wrapper over
 * `pushRowsToClayTable`: Clay enriches the rows on its side and then calls
 * our inbound /webhooks/clay/* route back with the enriched values, so the
 * enriched data is NOT in this response. The returned `note` makes that
 * async contract explicit to callers.
 */
export async function enrichViaClay(
  webhookUrl: string,
  records: Record<string, unknown>[],
  opts?: ClayPushOptions,
): Promise<ClayEnrichResult> {
  const push = await pushRowsToClayTable(webhookUrl, records, opts);
  return {
    ...push,
    note: "Rows pushed for enrichment. Enriched values return asynchronously via the inbound /webhooks/clay/* webhook, not in this response.",
  };
}

/** Extract just the host for logs so we never log full webhook URLs. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}
