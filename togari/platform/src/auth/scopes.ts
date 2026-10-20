/**
 * Scope-checking helpers for BigQuery dataset access.
 *
 * Every tool that queries BigQuery must call requireScope() with the
 * dataset name BEFORE executing the query. If the caller's scope list
 * doesn't include the dataset, the call throws and the tool returns
 * an isError response.
 *
 * Accepts any object with a `scopes: string[]` field — duck-typed so
 * both AuthContext (auth/token.ts) and AuthedTenantContext (tenant/
 * context.ts) work without an adapter layer.
 */

export interface ScopeBearer {
  scopes?: string[];
  orgId?: string;
  tenantId?: string;
}

export class ScopeDeniedError extends Error {
  public readonly dataset: string;
  public readonly ctx: ScopeBearer;

  constructor(dataset: string, ctx: ScopeBearer) {
    const owner = ctx.orgId ?? ctx.tenantId ?? "unknown";
    const scopeList = (ctx.scopes ?? []).join(", ");
    super(
      `Access denied to dataset \`${dataset}\`. Your org \`${owner}\` has access to: [${scopeList}].`,
    );
    this.name = "ScopeDeniedError";
    this.dataset = dataset;
    this.ctx = ctx;
  }
}

export function hasScope(ctx: ScopeBearer, dataset: string): boolean {
  return (ctx.scopes ?? []).includes(dataset);
}

export function requireScope(ctx: ScopeBearer, dataset: string): void {
  if (!hasScope(ctx, dataset)) {
    throw new ScopeDeniedError(dataset, ctx);
  }
}
