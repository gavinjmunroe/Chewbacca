import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AsyncLocalStorage } from 'node:async_hooks';

// ── Secrets ───────────────────────────────────────────────────────────────────
export function getSecret(name: string): Promise<string>;
export function getOptionalSecret(name: string): Promise<string | undefined>;

// ── Tenant context ────────────────────────────────────────────────────────────
export interface TenantContext {
  tenantId: string;
  userId?: string;
}
export const tenantStorage: AsyncLocalStorage<TenantContext>;
export function getCurrentTenant(): TenantContext;
export function checkTenantLimit(tenantId: string, operation: string): void;
export function setStdioFallback(ctx: TenantContext): void;
export function createStdioTenantContext(): TenantContext;

// ── Auth ──────────────────────────────────────────────────────────────────────
export function createAuthMiddleware(domain: string, audience: string): RequestHandler[];

// ── OAuth ─────────────────────────────────────────────────────────────────────
export function oauthProtectedResourceHandler(req: Request, res: Response): void;
export function oauthDiscoveryHandler(req: Request, res: Response): void;

// ── Audit ─────────────────────────────────────────────────────────────────────
export interface AuditEntry {
  operation: string;
  tenantId: string;
  transport: string;
  durationMs: number;
  status: 'success' | 'error';
  error?: string;
  timestamp: string;
}
export function createAuditEntry(
  operation: string,
  tenantId: string,
  transport: string,
  durationMs: number,
  status: 'success' | 'error',
  error?: string
): AuditEntry;
export function logAudit(entry: AuditEntry): void;

// ── Sentry ────────────────────────────────────────────────────────────────────
export function initSentry(): void;
export function flushSentry(): Promise<void>;
export function captureException(err: Error | unknown): void;

// ── Events ────────────────────────────────────────────────────────────────────
export function publishEvent(eventName: string, data: Record<string, unknown>): Promise<void>;

// ── BigQuery ──────────────────────────────────────────────────────────────────
export type QueryResult = Record<string, unknown>[];

export class BigQueryClient {
  constructor(projectId: string, credentialsPath?: string, credentialsBase64?: string);
  executeQuery(sql: string, params?: unknown[]): Promise<QueryResult>;
}

export class SqlGenerator {
  constructor(
    anthropicApiKey: string,
    projectId: string,
    dataset: string,
    table: string,
    schema: string
  );
  generate(naturalLanguageQuery: string): Promise<string>;
}

// ── Connector policy ──────────────────────────────────────────────────────────
export interface ConnectorPolicyOptions {
  name: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseMs?: number;
  cbThresholdPct?: number;
  cbHalfOpenAfterMs?: number;
  bulkheadConcurrency?: number;
  bulkheadQueue?: number;
}

export interface ConnectorPolicy {
  name: string;
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export function buildConnectorPolicy(options: ConnectorPolicyOptions): ConnectorPolicy;
