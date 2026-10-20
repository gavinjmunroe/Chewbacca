/**
 * Counting what we spend at Perplexity (plan step 08f).
 *
 * Perplexity never tells us what a call cost, so this counter is the only
 * protection there is. Every call — dispatch or chase-up — is recorded before
 * it goes out, and the daily cap is checked before that.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";

const logger = createLogger("perplexity/call-log");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function callsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.perplexity_calls\``;
}

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/**
 * Which budget a call is counted against.
 *
 * Connection research runs on the same Perplexity seat as reply drafting, so a
 * shared counter would let a backfill of a few dozen people use up the day's
 * reply allowance by lunchtime. Each gets its own cap instead. The seat's
 * credits are still shared — that is what PERPLEXITY_CONNECTION_DAILY_CALL_CAP
 * being small is for.
 */
export type CallScope = "replies" | "connections";

/** The `kind` written for each scope. Replies keep their original names. */
export const CALL_KINDS: Record<CallScope, { dispatch: string; chase: string }> = {
  replies: { dispatch: "dispatch", chase: "chase" },
  connections: { dispatch: "connection_dispatch", chase: "connection_chase" },
};

/** The variable that sets a scope's cap, for alerts that tell someone to raise it. */
export function dailyCapEnvVar(scope: CallScope = "replies"): string {
  return scope === "connections"
    ? "PERPLEXITY_CONNECTION_DAILY_CALL_CAP"
    : "PERPLEXITY_DAILY_CALL_CAP";
}

/** Calls an account may make per UTC day, per scope, before that scope stops. */
export function dailyCallCap(scope: CallScope = "replies"): number {
  const n = Number(process.env[dailyCapEnvVar(scope)]);
  if (Number.isFinite(n) && n > 0) return n;
  // Each connection task researches several people, so it costs many times
  // what a reply does.
  return scope === "connections" ? 10 : 200;
}

export async function countCallsToday(
  account: string,
  scope: CallScope = "replies",
): Promise<number> {
  // Rows written before scopes existed have kind 'dispatch' or 'chase', so the
  // replies filter counts them exactly as it always did.
  const kindFilter =
    scope === "connections"
      ? "AND kind LIKE 'connection%'"
      : "AND (kind IS NULL OR kind NOT LIKE 'connection%')";
  const { rows } = await bq().executeQuery(
    `SELECT COUNT(*) AS n
       FROM ${callsTable()}
      WHERE account = @account
        AND DATE(created_at) = CURRENT_DATE()
        ${kindFilter}`,
    { account },
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Record a call. Written BEFORE the call goes out, deliberately: a call we
 * made but failed to log is worse than one logged and never made, because the
 * first undercounts spend and the second only costs us a little headroom.
 */
export async function recordCall(params: {
  account: string;
  rowId?: string | null;
  /** One of CALL_KINDS. */
  kind: string;
}): Promise<void> {
  try {
    await bq().executeWrite(
      `INSERT INTO ${callsTable()} (call_id, account, row_id, kind, created_at)
       VALUES (@callId, @account, @rowId, @kind, CURRENT_TIMESTAMP())`,
      {
        callId: crypto.randomUUID(),
        account: params.account,
        rowId: params.rowId ?? null,
        kind: params.kind,
      },
    );
  } catch (err) {
    // Never block a dispatch on the bookkeeping, but say so loudly — an
    // uncounted call is a hole in the only spend protection there is.
    logger.error(
      "perplexity.call_log.failed",
      err instanceof Error ? err : new Error(String(err)),
      { account: params.account, kind: params.kind },
    );
  }
}

/** True when this account has hit its daily cap for this scope and must stop. */
export async function isOverDailyCap(
  account: string,
  scope: CallScope = "replies",
): Promise<boolean> {
  const cap = dailyCallCap(scope);
  const used = await countCallsToday(account, scope);
  if (used >= cap) {
    logger.error(
      "perplexity.daily_cap_reached",
      new Error(`${used}/${cap} ${scope} calls today for ${account}`),
      { account, scope, used, cap },
    );
    return true;
  }
  return false;
}
