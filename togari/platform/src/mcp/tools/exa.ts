/**
 * Exa MCP tools.
 *
 * Surfaces four Exa endpoints to MCP clients (Claude.ai custom connector,
 * ChatGPT custom GPT, internal agents). All four share the platform-level
 * `EXA_API_KEY`; per-tenant usage is logged into `cost_logs` and billed
 * back through Togari pricing.
 *
 * Tools registered:
 *   - togari_exa_search        — neural/keyword/auto web search
 *   - togari_exa_find_similar  — pages similar to a seed URL
 *   - togari_exa_get_contents  — full text / highlights / summaries for ids
 *   - togari_exa_answer        — synthesized answer with citations
 *
 * Each handler returns a markdown-formatted text block per the Togari MCP
 * output convention. Errors are caught by `registerToolModule` and surfaced
 * as `isError: true` results without crashing the transport.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import {
  exaAnswer,
  exaFindSimilar,
  exaGetContents,
  exaSearch,
} from "../../integrations/exa/client";
import type { ExaResultItem } from "../../integrations/exa/types";

function textResult(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text }] };
}

function formatResultLine(idx: number, r: ExaResultItem): string {
  const lines: string[] = [];
  const title = r.title?.trim() || "(no title)";
  lines.push(`${idx}. ${title}`);
  lines.push(`   URL: ${r.url}`);
  if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
  if (r.author) lines.push(`   Author: ${r.author}`);
  if (typeof r.score === "number") {
    lines.push(`   Score: ${r.score.toFixed(3)}`);
  }
  if (r.highlights?.length) {
    const snippet = r.highlights[0]?.slice(0, 280) ?? "";
    if (snippet) lines.push(`   Highlight: ${snippet}`);
  } else if (r.text) {
    const snippet = r.text.slice(0, 280);
    lines.push(`   Snippet: ${snippet}${r.text.length > 280 ? "…" : ""}`);
  }
  if (r.id) lines.push(`   ExaId: ${r.id}`);
  return lines.join("\n");
}

function costFooter(cost?: { total?: number } | null): string {
  if (!cost?.total) return "";
  return `\n(Exa cost: $${cost.total.toFixed(4)})`;
}

// ─── togari_exa_search ───────────────────────────────────────────────────────

const searchInput = {
  query: z.string().min(1).describe("Natural-language search query."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Number of results to return (default 10, max 50)."),
  type: z
    .enum(["neural", "keyword", "auto"])
    .optional()
    .describe(
      "'neural' (default) finds conceptually related pages; 'keyword' is BM25-style; 'auto' lets Exa pick.",
    ),
  includeDomains: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict results to these domains (e.g. ['linkedin.com', 'crunchbase.com']).",
    ),
  excludeDomains: z
    .array(z.string())
    .optional()
    .describe("Drop results from these domains."),
  category: z
    .enum([
      "company",
      "research paper",
      "news",
      "github",
      "tweet",
      "movie",
      "song",
      "personal site",
      "pdf",
    ])
    .optional()
    .describe("Bias the search toward a content category."),
  includeHighlights: z
    .boolean()
    .optional()
    .describe(
      "When true, ask Exa to return a short keyword-highlighted snippet per result.",
    ),
};

export const exaSearchTool: ToolModule = {
  name: "togari_exa_search",
  description:
    "Search the open web with Exa's neural-first engine. Returns a ranked list of URLs with titles, publish dates, scores, and (optionally) keyword highlights. Use when an agent needs fresh evidence from the public web.",
  inputSchema: searchInput,
  handler: async (args) => {
    const parsed = z.object(searchInput).parse(args ?? {});
    const response = await exaSearch({
      query: parsed.query,
      numResults: parsed.numResults ?? 10,
      type: parsed.type ?? "neural",
      includeDomains: parsed.includeDomains,
      excludeDomains: parsed.excludeDomains,
      category: parsed.category,
      contents: parsed.includeHighlights
        ? { highlights: { numSentences: 2, highlightsPerUrl: 1 } }
        : undefined,
    });

    if (!response.results?.length) {
      return textResult(`No Exa results for: ${parsed.query}`);
    }

    const header = `Exa search · ${response.results.length} results for "${parsed.query}"`;
    const body = response.results
      .map((r, i) => formatResultLine(i + 1, r))
      .join("\n\n");
    return textResult(
      `${header}\n\n${body}${costFooter(response.costDollars)}`,
    );
  },
};

// ─── togari_exa_find_similar ─────────────────────────────────────────────────

const findSimilarInput = {
  url: z.string().url().describe("Seed URL Exa should find similar pages to."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Number of similar pages to return (default 10)."),
  excludeSourceDomain: z
    .boolean()
    .optional()
    .describe(
      "Drop results from the seed URL's domain. Defaults to true for lookalike use cases.",
    ),
  includeDomains: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
  category: z
    .enum([
      "company",
      "research paper",
      "news",
      "github",
      "tweet",
      "movie",
      "song",
      "personal site",
      "pdf",
    ])
    .optional(),
};

export const exaFindSimilarTool: ToolModule = {
  name: "togari_exa_find_similar",
  description:
    "Given a seed URL, return pages Exa considers semantically similar. Ideal for lookalike-company discovery and competitor research.",
  inputSchema: findSimilarInput,
  handler: async (args) => {
    const parsed = z.object(findSimilarInput).parse(args ?? {});
    const response = await exaFindSimilar({
      url: parsed.url,
      numResults: parsed.numResults ?? 10,
      excludeSourceDomain: parsed.excludeSourceDomain ?? true,
      includeDomains: parsed.includeDomains,
      excludeDomains: parsed.excludeDomains,
      category: parsed.category,
    });

    if (!response.results?.length) {
      return textResult(`No similar results for: ${parsed.url}`);
    }

    const header = `Exa find_similar · ${response.results.length} results for ${parsed.url}`;
    const body = response.results
      .map((r, i) => formatResultLine(i + 1, r))
      .join("\n\n");
    return textResult(
      `${header}\n\n${body}${costFooter(response.costDollars)}`,
    );
  },
};

// ─── togari_exa_get_contents ─────────────────────────────────────────────────

const getContentsInput = {
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe(
      "Exa result ids returned by a prior search or find_similar call (max 20).",
    ),
  text: z
    .boolean()
    .optional()
    .describe("When true (default), include the full extracted text per id."),
  maxCharacters: z
    .number()
    .int()
    .min(100)
    .max(20000)
    .optional()
    .describe(
      "Cap the text returned per id (default Exa default; set 2000 for compact reads).",
    ),
  highlights: z
    .boolean()
    .optional()
    .describe("Return keyword-highlighted snippets in addition to text."),
  summary: z
    .boolean()
    .optional()
    .describe("Return an Exa-generated summary per id."),
};

export const exaGetContentsTool: ToolModule = {
  name: "togari_exa_get_contents",
  description:
    "Fetch full text, highlights, and/or model summaries for one or more Exa result ids. Use after search/find_similar when the agent needs to actually read the pages, not just rank them.",
  inputSchema: getContentsInput,
  handler: async (args) => {
    const parsed = z.object(getContentsInput).parse(args ?? {});
    const includeText = parsed.text ?? true;
    const response = await exaGetContents({
      ids: parsed.ids,
      text: includeText
        ? parsed.maxCharacters
          ? { maxCharacters: parsed.maxCharacters }
          : true
        : false,
      highlights: parsed.highlights ?? false,
      summary: parsed.summary ?? false,
    });

    if (!response.results?.length) {
      return textResult(`No contents found for ids: ${parsed.ids.join(", ")}`);
    }

    const blocks = response.results.map((r, i) => {
      const lines: string[] = [
        `${i + 1}. ${r.title?.trim() || "(no title)"}`,
        `   URL: ${r.url}`,
      ];
      if (r.summary) lines.push(`   Summary: ${r.summary}`);
      if (r.highlights?.length) {
        lines.push(`   Highlights:`);
        for (const h of r.highlights.slice(0, 5)) {
          lines.push(`     - ${h.slice(0, 280)}`);
        }
      }
      if (r.text) {
        lines.push(`   Text:\n${indent(r.text, 6)}`);
      }
      return lines.join("\n");
    });

    const header = `Exa contents · ${response.results.length} of ${parsed.ids.length} ids`;
    return textResult(
      `${header}\n\n${blocks.join("\n\n")}${costFooter(response.costDollars)}`,
    );
  },
};

// ─── togari_exa_answer ───────────────────────────────────────────────────────

const answerInput = {
  query: z
    .string()
    .min(1)
    .describe("Natural-language question Exa should synthesize an answer for."),
  includeText: z
    .boolean()
    .optional()
    .describe(
      "When true, include source text excerpts alongside each citation.",
    ),
};

export const exaAnswerTool: ToolModule = {
  name: "togari_exa_answer",
  description:
    "Ask Exa to return a synthesized answer with citations. Use when you want one-shot research instead of a ranked list of pages.",
  inputSchema: answerInput,
  handler: async (args) => {
    const parsed = z.object(answerInput).parse(args ?? {});
    const response = await exaAnswer({
      query: parsed.query,
      text: parsed.includeText ?? false,
    });

    const lines: string[] = [
      `Exa answer for: ${parsed.query}`,
      "",
      response.answer || "(no answer returned)",
    ];

    if (response.citations?.length) {
      lines.push("", `Citations (${response.citations.length}):`);
      response.citations.forEach((c, i) => {
        lines.push(`  ${i + 1}. ${c.title?.trim() || "(no title)"}`);
        lines.push(`     ${c.url}`);
        if (parsed.includeText && c.text) {
          lines.push(
            `     ${c.text.slice(0, 280)}${c.text.length > 280 ? "…" : ""}`,
          );
        }
      });
    }

    return textResult(`${lines.join("\n")}${costFooter(response.costDollars)}`);
  },
};

// ─── Registration helpers ────────────────────────────────────────────────────

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

export const TOGARI_EXA_TOOLS: ToolModule[] = [
  exaSearchTool,
  exaFindSimilarTool,
  exaGetContentsTool,
  exaAnswerTool,
];

/**
 * Register all Exa MCP tools on an `McpServer`. Called by
 * `src/transports/mcp/server.ts` alongside the other tool-module registrants.
 */
export function registerExaTools(server: McpServer): void {
  for (const mod of TOGARI_EXA_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as exaTools; exaTools.register(server)` pattern. */
export const register = registerExaTools;
