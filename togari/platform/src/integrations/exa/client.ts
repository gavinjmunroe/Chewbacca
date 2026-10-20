/**
 * Exa API client.
 *
 * Exa is a neural-search-first web search engine. Togari uses it for:
 *   - `togari_exa_search`        — open-web research from the agent loop
 *   - `togari_exa_find_similar`  — lookalike-company crawling
 *   - `togari_exa_get_contents`  — pulling full text + highlights for ids
 *   - `togari_exa_answer`        — synthesized answers with citations
 *
 * Credential model is PLATFORM-LEVEL: one `EXA_API_KEY` shared across all
 * Togari tenants. Per-tenant usage is logged into `cost_logs` via
 * `logExternalAPICost` and billed back through `admin_settings.pricing_config`.
 *
 * Every method is wrapped with:
 *   - `withRetryAndCircuitBreaker` from `src/lib/retry` (handles 5xx + gateway markers)
 *   - `traceCall` so Sentry spans capture each call
 *   - `logExternalAPICost` so the per-tenant cost rolls up against the
 *     active run via `currentTraceContext()`
 *
 * Docs: https://docs.exa.ai/reference/getting-started.
 */

import { getOptionalSecret } from "../../secrets/manager";
import { withRetryAndCircuitBreaker } from "../../lib/retry";
import { traceCall, currentTraceContext } from "../../lib/tracing";
import { logExternalAPICost } from "../../lib/costTracking";
import { createLogger } from "../../observability/logger";
import type {
  ExaAnswerRequest,
  ExaAnswerResponse,
  ExaContentsRequest,
  ExaContentsResponse,
  ExaFindSimilarRequest,
  ExaSearchRequest,
  ExaSearchResponse,
} from "./types";

const logger = createLogger("integrations/exa");

const EXA_BASE_URL = "https://api.exa.ai";

let cachedKey: string | null | undefined;

async function getExaApiKey(): Promise<string> {
  if (cachedKey !== undefined && cachedKey !== null) return cachedKey;

  // Prefer the typed secret name (resolves via Cloud Run volume → Secret Manager → env).
  const fromSecret = await getOptionalSecret("exa-api-key");
  if (fromSecret) {
    cachedKey = fromSecret;
    return cachedKey;
  }
  // Direct env fallback for local dev / scripts that bypass the secret manager.
  const fromEnv = process.env.EXA_API_KEY;
  if (fromEnv) {
    cachedKey = fromEnv;
    return cachedKey;
  }
  throw new Error(
    "Exa is not configured. Set EXA_API_KEY in the environment or provision the 'exa-api-key' secret in GCP Secret Manager.",
  );
}

/**
 * Reset the cached API key. Tests rely on this to swap credentials between cases.
 */
export function _resetExaApiKeyCacheForTests(): void {
  cachedKey = undefined;
}

interface RequestOptions {
  body: unknown;
  operation: string;
  /** Path under EXA_BASE_URL, with leading slash. */
  path: string;
}

async function exaFetch<T>({
  path,
  body,
  operation,
}: RequestOptions): Promise<T> {
  const apiKey = await getExaApiKey();
  const url = `${EXA_BASE_URL}${path}`;
  const ctx = currentTraceContext();

  return traceCall(`exa.${operation}`, async () =>
    withRetryAndCircuitBreaker(
      async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `Exa ${operation} failed: ${response.status} ${response.statusText} ${text}`.trim(),
          );
        }

        const json = (await response.json()) as T;

        // Cost log after the body is fully consumed so failed calls don't double-bill.
        await logExternalAPICost({
          serviceType: "exa",
          operation,
          tenantId: ctx?.tenantId,
          metadata: { path },
        }).catch((err) => {
          logger.warn("exa cost log failed", err);
        });

        return json;
      },
      {
        operationName: `exa.${operation}`,
        maxRetries: 3,
        baseDelayMs: 500,
      },
    ),
  );
}

/**
 * Neural / keyword web search.
 *
 * @param input.query           Free-form search query.
 * @param input.numResults      Default 10. Exa caps at 100.
 * @param input.type            `'neural'` (default) | `'keyword'` | `'auto'`.
 * @param input.includeDomains  Restrict results to these domains.
 * @param input.excludeDomains  Drop results from these domains.
 * @param input.contents        Optionally fetch text/highlights in the same call.
 */
export async function exaSearch(
  input: ExaSearchRequest,
): Promise<ExaSearchResponse> {
  const body: Record<string, unknown> = {
    query: input.query,
    numResults: input.numResults ?? 10,
    type: input.type ?? "neural",
  };
  if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
  if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
  if (input.startCrawlDate) body.startCrawlDate = input.startCrawlDate;
  if (input.endCrawlDate) body.endCrawlDate = input.endCrawlDate;
  if (input.startPublishedDate)
    body.startPublishedDate = input.startPublishedDate;
  if (input.endPublishedDate) body.endPublishedDate = input.endPublishedDate;
  if (input.useAutoprompt !== undefined)
    body.useAutoprompt = input.useAutoprompt;
  if (input.category) body.category = input.category;
  if (input.contents) body.contents = input.contents;

  return exaFetch<ExaSearchResponse>({
    path: "/search",
    body,
    operation: "search",
  });
}

/**
 * Find pages similar to a seed URL.
 *
 * @param input.url                   Seed URL Exa anchors on.
 * @param input.numResults            Default 10.
 * @param input.excludeSourceDomain   When true, drop results from the seed's domain.
 */
export async function exaFindSimilar(
  input: ExaFindSimilarRequest,
): Promise<ExaSearchResponse> {
  const body: Record<string, unknown> = {
    url: input.url,
    numResults: input.numResults ?? 10,
  };
  if (input.excludeSourceDomain !== undefined) {
    body.excludeSourceDomain = input.excludeSourceDomain;
  }
  if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
  if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
  if (input.category) body.category = input.category;
  if (input.contents) body.contents = input.contents;

  return exaFetch<ExaSearchResponse>({
    path: "/findSimilar",
    body,
    operation: "find_similar",
  });
}

/**
 * Fetch full text / highlights / summaries for a list of Exa result ids.
 *
 * @param input.ids         One or more Exa result ids from a prior search call.
 * @param input.text        true (full text) or `{ maxCharacters?, includeHtmlTags? }`.
 * @param input.highlights  true or `{ numSentences?, highlightsPerUrl?, query? }`.
 * @param input.summary     true or `{ query? }` to ask Exa for a model summary.
 */
export async function exaGetContents(
  input: ExaContentsRequest & { ids: string[] },
): Promise<ExaContentsResponse> {
  if (!input.ids?.length) {
    throw new Error("exaGetContents requires at least one id");
  }
  const body: Record<string, unknown> = { ids: input.ids };
  if (input.text !== undefined) body.text = input.text;
  if (input.highlights !== undefined) body.highlights = input.highlights;
  if (input.summary !== undefined) body.summary = input.summary;

  return exaFetch<ExaContentsResponse>({
    path: "/contents",
    body,
    operation: "get_contents",
  });
}

/**
 * Synthesized answer with citations. Use when the agent wants a one-shot
 * answer rather than a list of links to read.
 *
 * @param input.query  Natural-language question.
 * @param input.text   When true, citations include their source text excerpts.
 */
export async function exaAnswer(
  input: ExaAnswerRequest,
): Promise<ExaAnswerResponse> {
  const body: Record<string, unknown> = { query: input.query };
  if (input.text !== undefined) body.text = input.text;

  return exaFetch<ExaAnswerResponse>({
    path: "/answer",
    body,
    operation: "answer",
  });
}
