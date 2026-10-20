/**
 * Shared helpers for the Phase 2 Tab 9 read-only MCP tool modules
 * (companies, contacts, datapoints, clay, costs, admin).
 *
 * Centralises:
 *   - The BigQueryClient factory + GCP credentials wiring (mirrors
 *     `src/lib/costTracking.ts` and `src/ingest/clay/persister.ts` so
 *     env vars stay consistent across the codebase).
 *   - Fully-qualified table-name constants for the togari_core dataset.
 *   - A markdown-table builder so every search/list tool emits a
 *     consistent text block instead of JSON.
 *
 * Tools should NOT import @google-cloud/bigquery directly — always go
 * through BigQueryClient so the smoke harness's vi.mock at
 * tests/smoke/setup.ts can intercept queries.
 */

import { BigQueryClient } from "../../bigquery/client";

export const PROJECT_ID =
  process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
export const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

function q(name: string): string {
  return `\`${PROJECT_ID}.${DATASET}.${name}\``;
}

export const T = {
  companies: q("companies"),
  mandates: q("mandates"),
  mandateCompanies: q("mandate_companies"),
  contacts: q("contacts"),
  datapoints: q("datapoints"),
  tieringRuns: q("tiering_runs"),
  tieringRunCompanies: q("tiering_run_companies"),
  enrichmentRuns: q("enrichment_runs"),
  enrichmentRunCompanies: q("enrichment_run_companies"),
  tiers: q("tiers"),
  costLogs: q("cost_logs"),
  adminSettings: q("admin_settings"),
  clayImports: q("clay_imports"),
} as const;

export function defaultBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/**
 * Tool modules accept an optional deps bag so tests can pass an
 * already-constructed BigQueryClient. In production the smoke setup
 * never runs and `defaultBq()` returns a real-credential client.
 */
export interface ToolDeps {
  bq?: BigQueryClient;
}

/**
 * Pretty-print a value coming out of BigQuery for a markdown cell.
 * Handles BigQueryTimestamp (returned as { value: ISO }), null, booleans,
 * numbers, and unknown objects (JSON-stringified, truncated).
 */
export function fmt(v: unknown, maxLen = 80): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    return v.length > maxLen ? v.slice(0, maxLen - 1) + "…" : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null && "value" in (v as any)) {
    // BigQueryTimestamp / Date-like wrappers
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "string") return fmt(inner, maxLen);
  }
  try {
    const s = JSON.stringify(v);
    return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
  } catch {
    return String(v);
  }
}

/**
 * Build a GitHub-flavored markdown table from rows.
 * Returns an italicised "_No rows._" string when rows is empty so the
 * tool always emits something readable.
 */
export function markdownTable(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  if (rows.length === 0) return "_No rows._";
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataLines = rows.map((r) => `| ${r.map((c) => fmt(c)).join(" | ")} |`);
  return [headerLine, sepLine, ...dataLines].join("\n");
}

/**
 * Build a markdown definition list ("- **Key:** value") for single-record
 * detail views. Skips entries whose value is null/undefined.
 */
export function markdownDl(entries: Array<[string, unknown]>): string {
  const lines: string[] = [];
  for (const [k, v] of entries) {
    if (v === null || v === undefined) continue;
    lines.push(`- **${k}:** ${fmt(v, 240)}`);
  }
  return lines.join("\n");
}

/** Coerce BQ's BigQueryTimestamp into an ISO string when possible. */
export function asIso(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in (v as any)) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "string") return inner;
  }
  return null;
}

/** Read a numeric BQ value safely. BQ returns numbers as numbers OR strings. */
export function asNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

/** Clamp a number into [min, max]. Used for limit args. */
export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
