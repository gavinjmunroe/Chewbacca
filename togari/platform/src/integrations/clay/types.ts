/**
 * Clay OUTBOUND integration types.
 *
 * Togari's Clay model has two directions:
 *   - INBOUND  (existing): Clay POSTs enriched rows into our
 *     /webhooks/clay/* ingest routes.
 *   - OUTBOUND (this module): Togari POSTs rows from the warehouse INTO a
 *     Clay table's webhook URL so Clay can enrich them. Each Clay table
 *     exposes its own "Send Webhook to a Table" URL; posting JSON rows to
 *     that URL appends them to the table.
 *
 * Reference: https://www.clay.com/university/guide/webhook-source
 */

/** Options that tune an outbound push to a Clay table webhook. */
export interface ClayPushOptions {
  /**
   * Max rows to push in a single call. Anything beyond this is dropped and
   * reported as `truncated`. Defaults to CLAY_OUTBOUND_MAX_ROWS (or 500).
   */
  maxRows?: number;
  /**
   * How many rows to POST concurrently. Small by default so we never hammer
   * a table webhook. Defaults to 5.
   */
  concurrency?: number;
  /**
   * Optional Bearer token. When omitted the client falls back to
   * CLAY_API_KEY from the environment (only sent if present).
   */
  bearerToken?: string;
}

/** Result of an outbound push, aggregated across every row. */
export interface ClayPushResult {
  /** Rows successfully accepted by the Clay webhook (HTTP 2xx). */
  pushed: number;
  /** Rows the webhook rejected or that errored in transit. */
  failed: number;
  /** Human-readable per-row error strings (bounded, one per failed row). */
  errors: string[];
  /** True when the input exceeded the row cap and was trimmed. */
  truncated: boolean;
  /** Total rows the caller handed in, before the cap was applied. */
  received: number;
}

/**
 * Result of an enrichment push. Same counts as a plain push, plus a note
 * clarifying that enriched values return asynchronously via the inbound
 * /webhooks/clay/* route rather than in this response.
 */
export interface ClayEnrichResult extends ClayPushResult {
  /** Fixed explanatory note about the async return path. */
  note: string;
}
