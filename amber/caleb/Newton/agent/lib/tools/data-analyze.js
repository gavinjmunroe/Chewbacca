/**
 * data-analyze.js — `analyze_tabular` tool (Tab 24, the code interpreter for
 * inbound XLSX / CSV / TSV).
 *
 * Beyond OCR'd text: this runs real computation on a spreadsheet the user
 * drops in iMessage / Slack. "What's the sum of column B grouped by month?"
 * or "what's our top post by likes?" return an actual computed answer, plus
 * an optional hand-rolled SVG chart attached to the reply.
 *
 * Design (see ../tabular-analyze.js header for the full rationale): the model
 * passes a STRUCTURED analysis spec — filter / derive / group_by / aggregate
 * / sort — which a deterministic in-process engine executes over rows parsed
 * by SheetJS (XLSX) or a hand-rolled CSV parser. No DuckDB-wasm, no D3, no
 * arbitrary SQL/eval on untrusted input. Execution is bounded by a 30s fetch
 * timeout and a 2M-cell parse ceiling (the ~256MB budget from the brief).
 *
 * Returns plain objects; never throws (engine TabularErrors are caught and
 * surfaced as { error }). On a chart request the result carries both
 * `chart_url` and `image_url` so the agent's *_url scanner auto-attaches it.
 */

import { storeImage } from "../image-host.js";
import {
  parseCsvBuffer,
  parseXlsxBuffer,
  runAnalysis,
  renderChartSvg,
  TabularError,
} from "../tabular-analyze.js";

const FETCH_TIMEOUT_MS = 30_000;

// ── tool schema ──────────────────────────────────────────────────────────

export const DATA_ANALYZE_TOOLS = [
  {
    name: "analyze_tabular",
    description:
      "Run real computation on a spreadsheet (XLSX/XLS) or CSV/TSV file the user shared, going beyond OCR text. Pass the file URL plus a structured analysis plan to filter rows, derive columns (e.g. month from a date), group, aggregate (sum/avg/count/min/max/median/count_distinct), sort, and limit. Optionally render a bar or line chart that gets attached to the reply. Use this for questions like 'what is the sum of revenue by month', 'what is our top post by likes', 'average deal size per stage', or 'how many rows match X'.",
    input_schema: {
      type: "object",
      required: ["file_url", "question"],
      properties: {
        file_url: {
          type: "string",
          description:
            "Public URL of the .xlsx/.xls or .csv/.tsv file to analyze (the inbound attachment URL).",
        },
        question: {
          type: "string",
          description:
            "The natural-language question being answered. Used for the summary and logging.",
        },
        sheet: {
          type: "string",
          description:
            "Optional sheet name for XLSX workbooks. Defaults to the first sheet.",
        },
        operations: {
          type: "object",
          description:
            "Structured analysis plan executed in order: filter -> derive -> group_by/aggregate -> sort -> limit -> select.",
          properties: {
            filter: {
              type: "array",
              description:
                "Row filters, all ANDed. Each: { column, op, value }. op is one of eq, ne, gt, gte, lt, lte, contains, startswith, in, notnull.",
              items: {
                type: "object",
                required: ["column", "op"],
                properties: {
                  column: { type: "string" },
                  op: {
                    type: "string",
                    enum: [
                      "eq",
                      "ne",
                      "gt",
                      "gte",
                      "lt",
                      "lte",
                      "contains",
                      "startswith",
                      "in",
                      "notnull",
                    ],
                  },
                  value: {},
                },
              },
            },
            derive: {
              type: "array",
              description:
                "Computed columns appended before grouping. Each: { column, as, fn }. fn is one of month, year, year_month, day, weekday, lower, upper, number, abs, round. Use this to group by month: derive year_month from a date column, then group_by that.",
              items: {
                type: "object",
                required: ["column", "as", "fn"],
                properties: {
                  column: { type: "string" },
                  as: { type: "string" },
                  fn: {
                    type: "string",
                    enum: [
                      "month",
                      "year",
                      "year_month",
                      "day",
                      "weekday",
                      "lower",
                      "upper",
                      "number",
                      "abs",
                      "round",
                    ],
                  },
                },
              },
            },
            group_by: {
              type: "array",
              description: "Column names to group by.",
              items: { type: "string" },
            },
            aggregate: {
              type: "array",
              description:
                "Aggregations to compute per group (or over all rows if no group_by). Each: { fn, column?, as? }. fn is one of count, count_distinct, sum, avg, min, max, median. count needs no column.",
              items: {
                type: "object",
                required: ["fn"],
                properties: {
                  fn: {
                    type: "string",
                    enum: [
                      "count",
                      "count_distinct",
                      "sum",
                      "avg",
                      "min",
                      "max",
                      "median",
                    ],
                  },
                  column: { type: "string" },
                  as: { type: "string" },
                },
              },
            },
            sort: {
              type: "object",
              description:
                "Sort the result. { by, dir } where dir is asc or desc.",
              properties: {
                by: { type: "string" },
                dir: { type: "string", enum: ["asc", "desc"] },
              },
            },
            select: {
              type: "array",
              description: "Optional projection: only return these columns.",
              items: { type: "string" },
            },
            limit: {
              type: "integer",
              description: "Max result rows to return (default 100).",
            },
          },
        },
        chart: {
          type: "object",
          description:
            "Optional chart of the result. { type: 'bar'|'line', x, y, title }. x is the category column, y is the numeric column.",
          properties: {
            type: { type: "string", enum: ["bar", "line"] },
            x: { type: "string" },
            y: { type: "string" },
            title: { type: "string" },
          },
        },
      },
    },
  },
];

export const DATA_ANALYZE_TOOL_NAMES = new Set(["analyze_tabular"]);

// ── helpers ────────────────────────────────────────────────────────────────

function resolvePublicBase() {
  return (
    process.env.MEDHA_PUBLIC_AUDIO_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : null)
  );
}

/**
 * Classify the file kind from the URL path (and an optional mime hint).
 * Returns "xlsx" | "csv" | "unknown".
 */
function classifyKind(url, mime) {
  const lowerUrl = String(url || "").toLowerCase();
  const path = lowerUrl.split("?")[0];
  if (/\.(xlsx|xls)$/.test(path)) return "xlsx";
  if (/\.(csv|tsv|txt)$/.test(path)) return "csv";
  const m = String(mime || "").toLowerCase();
  if (m.includes("spreadsheetml") || m.includes("ms-excel")) return "xlsx";
  if (
    m.includes("csv") ||
    m.includes("text/plain") ||
    m.includes("tab-separated")
  )
    return "csv";
  return "unknown";
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { error: `fetch ${res.status} ${res.statusText}` };
    const ab = await res.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      contentType: res.headers.get("content-type") || "",
    };
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? `fetch timed out after ${FETCH_TIMEOUT_MS}ms`
        : String(err?.message || err);
    return { error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a short human-readable summary so the model has a grounded answer to
 * relay even before it formats the rows.
 */
function buildSummary(question, analysis, parsed) {
  const { rows, columns, rowCount } = analysis;
  const head = `Analyzed ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} x ${parsed.columns.length} column${parsed.columns.length === 1 ? "" : "s"}.`;
  if (rows.length === 0) return `${head} No rows matched the analysis.`;
  if (rows.length === 1 && columns.length <= 4) {
    const pairs = columns.map((c) => `${c}=${rows[0][c]}`).join(", ");
    return `${head} Result: ${pairs}.`;
  }
  const shownNote =
    rowCount > rows.length
      ? ` (showing top ${rows.length} of ${rowCount})`
      : "";
  return `${head} ${rowCount} result row${rowCount === 1 ? "" : "s"}${shownNote}.`;
}

// ── executor ────────────────────────────────────────────────────────────────

export async function executeDataAnalyzeTool(toolName, input, _ctx) {
  if (toolName !== "analyze_tabular") {
    return { error: `Unknown data-analyze tool: ${toolName}` };
  }

  const { file_url, question, sheet, operations, chart } = input || {};
  if (!file_url || typeof file_url !== "string") {
    return { error: "file_url is required" };
  }
  if (!question || typeof question !== "string") {
    return { error: "question is required" };
  }

  const kindGuess = classifyKind(file_url);
  const { buffer, contentType, error: fetchErr } = await fetchBuffer(file_url);
  if (fetchErr) return { error: `could not fetch file: ${fetchErr}` };

  const kind =
    kindGuess === "unknown" ? classifyKind(file_url, contentType) : kindGuess;

  let parsed;
  try {
    if (kind === "xlsx") {
      parsed = await parseXlsxBuffer(buffer, { sheet });
    } else if (kind === "csv") {
      parsed = parseCsvBuffer(buffer);
    } else {
      // Last resort: try CSV (covers content-typeless attachments).
      parsed = parseCsvBuffer(buffer);
    }
  } catch (err) {
    const msg =
      err instanceof TabularError ? err.message : String(err?.message || err);
    return { error: `could not parse file: ${msg}` };
  }

  if (!parsed.columns.length) {
    return { error: "no columns found; the file looks empty or unreadable" };
  }

  let analysis;
  try {
    analysis = runAnalysis(parsed, operations || {});
  } catch (err) {
    const msg =
      err instanceof TabularError ? err.message : String(err?.message || err);
    return { error: `analysis failed: ${msg}`, columns: parsed.columns };
  }

  const result = {
    summary: buildSummary(question, analysis, parsed),
    source_columns: parsed.columns,
    result_columns: analysis.columns,
    row_count: analysis.rowCount,
    source_row_count: parsed.rows.length,
    rows: analysis.rows,
  };
  if (parsed.sheet) result.sheet = parsed.sheet;
  if (Array.isArray(parsed.sheetNames) && parsed.sheetNames.length > 1) {
    result.available_sheets = parsed.sheetNames;
  }

  // Optional chart — best-effort, never blocks the numeric answer.
  if (chart && typeof chart === "object" && chart.x && chart.y) {
    try {
      const svg = renderChartSvg(analysis, chart);
      if (svg) {
        const publicBase = resolvePublicBase();
        if (publicBase) {
          const id = storeImage(Buffer.from(svg, "utf8"), "image/svg+xml");
          if (id) {
            const url = `${publicBase}/image/${id}.svg`;
            result.chart_url = url;
            // Mirror onto image_url so the agent loop's *_url scanner
            // auto-attaches the chart to the outbound message.
            result.image_url = url;
          }
        } else {
          result.chart_note =
            "chart skipped: no public base URL configured for hosting";
        }
      } else {
        result.chart_note =
          "chart skipped: x/y columns not usable for the requested chart";
      }
    } catch (err) {
      result.chart_note = `chart failed: ${String(err?.message || err).slice(0, 160)}`;
    }
  }

  return result;
}
