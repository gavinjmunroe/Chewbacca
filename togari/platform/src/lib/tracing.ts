/**
 * Tracing for Togari worker jobs.
 *
 * v1 uses Sentry spans + Node AsyncLocalStorage. The Braintrust integration
 * autotier ships is intentionally skipped for now — once we have a stable
 * baseline we can add it back behind a feature flag.
 *
 * Exports:
 * - `traceCall(name, fn)` — wraps `fn` in a Sentry span. Always runs `fn`;
 *   becomes a passthrough when Sentry isn't initialised.
 * - `withTraceContext(ctx, fn)` — attach `{tenantId, runId, companyId, pipeline}`
 *   to every span created inside `fn`. Stored in AsyncLocalStorage so concurrent
 *   Pub/Sub subscribers stay isolated.
 * - `currentTraceContext()` — read the active context (cost tracker uses this
 *   to tag `cost_logs` rows without callers having to thread it through).
 * - `flushTracing()` — graceful-shutdown flushing.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  tenantId: string;
  runId?: string;
  companyId?: string;
  pipeline?: "tiering" | "enrichment" | "ingest";
  /** Free-form key-value attributes promoted to span tags. */
  attrs?: Record<string, string | number | boolean>;
}

const contextStore = new AsyncLocalStorage<TraceContext>();

export function currentTraceContext(): TraceContext | undefined {
  return contextStore.getStore();
}

export function withTraceContext<T>(
  ctx: TraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return contextStore.run(ctx, fn);
}

interface SentryLike {
  startSpan?: (
    opts: { name: string; op?: string; attributes?: Record<string, unknown> },
    cb: (span: { setAttribute: (k: string, v: unknown) => void }) => unknown,
  ) => unknown;
  withScope?: (
    cb: (scope: { setExtra: (k: string, v: unknown) => void }) => void,
  ) => void;
  captureException?: (err: unknown) => void;
  close?: (ms: number) => Promise<boolean>;
}

let sentry: SentryLike | null = null;
let sentryLoadAttempted = false;

async function loadSentry(): Promise<SentryLike | null> {
  if (sentry || sentryLoadAttempted) return sentry;
  sentryLoadAttempted = true;
  if (!process.env.SENTRY_DSN) return null;
  try {
    const mod = (await import("@sentry/node")) as unknown as SentryLike;
    sentry = mod;
  } catch {
    sentry = null;
  }
  return sentry;
}

/**
 * Wrap `fn` in a Sentry span named `name`. The current `TraceContext` is added
 * as span attributes. Always returns the function's result; tracing failures
 * never bubble up.
 */
export async function traceCall<T>(
  name: string,
  fn: () => Promise<T>,
  opts?: { op?: string; attributes?: Record<string, unknown> },
): Promise<T> {
  const ctx = currentTraceContext();
  const baseAttributes: Record<string, unknown> = {
    ...(ctx?.tenantId ? { "togari.tenant_id": ctx.tenantId } : {}),
    ...(ctx?.runId ? { "togari.run_id": ctx.runId } : {}),
    ...(ctx?.companyId ? { "togari.company_id": ctx.companyId } : {}),
    ...(ctx?.pipeline ? { "togari.pipeline": ctx.pipeline } : {}),
    ...(ctx?.attrs ?? {}),
    ...(opts?.attributes ?? {}),
  };

  const s = await loadSentry();
  if (!s?.startSpan) return fn();

  return new Promise<T>((resolve, reject) => {
    s.startSpan!(
      { name, op: opts?.op ?? "togari.worker", attributes: baseAttributes },
      async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

export function captureSpanError(err: unknown): void {
  const s = sentry;
  if (!s?.captureException) return;
  const ctx = currentTraceContext();
  if (s.withScope) {
    s.withScope((scope) => {
      if (ctx?.tenantId) scope.setExtra("tenant_id", ctx.tenantId);
      if (ctx?.runId) scope.setExtra("run_id", ctx.runId);
      if (ctx?.companyId) scope.setExtra("company_id", ctx.companyId);
      if (ctx?.pipeline) scope.setExtra("pipeline", ctx.pipeline);
      s.captureException!(err);
    });
  } else {
    s.captureException(err);
  }
}

export async function flushTracing(timeoutMs = 2000): Promise<void> {
  if (!sentry?.close) return;
  try {
    await sentry.close(timeoutMs);
  } catch {
    // shutdown best-effort
  }
}
