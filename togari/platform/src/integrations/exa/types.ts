/**
 * Exa API response types.
 *
 * The Exa API has stabilized around four endpoints we surface as MCP tools:
 *   /search        — neural / keyword / auto web search
 *   /findSimilar   — find pages similar to a seed URL
 *   /contents      — fetch full text / highlights / summaries for ids
 *   /answer        — synthesized answer with citations
 *
 * Reference: https://docs.exa.ai/reference/getting-started.
 *
 * The types here capture only the fields Togari actually reads. Exa returns a
 * number of optional fields (author, score, image, favicon, subpages, etc.) we
 * leave loosely typed so an SDK bump doesn't ripple through the MCP tools.
 */

export type ExaSearchType = "neural" | "keyword" | "auto";

export interface ExaSearchRequest {
  query: string;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  type?: ExaSearchType;
  startCrawlDate?: string;
  endCrawlDate?: string;
  startPublishedDate?: string;
  endPublishedDate?: string;
  useAutoprompt?: boolean;
  category?:
    | "company"
    | "research paper"
    | "news"
    | "github"
    | "tweet"
    | "movie"
    | "song"
    | "personal site"
    | "pdf";
  contents?: ExaContentsRequest;
}

export interface ExaFindSimilarRequest {
  url: string;
  numResults?: number;
  excludeSourceDomain?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  category?: ExaSearchRequest["category"];
  contents?: ExaContentsRequest;
}

export interface ExaContentsRequest {
  ids?: string[];
  text?:
    | boolean
    | {
        maxCharacters?: number;
        includeHtmlTags?: boolean;
      };
  highlights?:
    | boolean
    | {
        numSentences?: number;
        highlightsPerUrl?: number;
        query?: string;
      };
  summary?:
    | boolean
    | {
        query?: string;
      };
}

export interface ExaAnswerRequest {
  query: string;
  /** Include underlying text excerpts alongside the synthesized answer. */
  text?: boolean;
}

export interface ExaResultItem {
  id: string;
  url: string;
  title: string | null;
  publishedDate?: string | null;
  author?: string | null;
  score?: number | null;
  text?: string | null;
  highlights?: string[];
  highlightScores?: number[];
  summary?: string | null;
  /** Free-form extras Exa may add to a result without breaking changes. */
  [key: string]: unknown;
}

export interface ExaSearchResponse {
  results: ExaResultItem[];
  autopromptString?: string | null;
  /** Number of credits the request consumed. Exa returns these on most endpoints. */
  costDollars?: { total?: number } | null;
  requestId?: string;
}

export interface ExaContentsResponse {
  results: ExaResultItem[];
  costDollars?: { total?: number } | null;
  requestId?: string;
}

export interface ExaAnswerResponse {
  answer: string;
  citations: ExaResultItem[];
  costDollars?: { total?: number } | null;
  requestId?: string;
}
