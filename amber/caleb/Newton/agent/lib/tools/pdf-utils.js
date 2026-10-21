/**
 * pdf-utils.js — PDF transforms (merge, split, extract text, watermark) via CloudConvert.
 *
 * CloudConvert is the single best multi-format PDF toolchain that's API-first
 * (no binary install, generous free tier, one key). Alternative: ilovepdf API.
 *
 * Per-user secret: CLOUDCONVERT_API_KEY via lib/secrets.js.
 * Fallback: process.env.CLOUDCONVERT_API_KEY during migration.
 *
 * Model: creates a CloudConvert "job" of chained tasks (import → op → export-url),
 * polls until status=finished, returns resulting file URL(s).
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_PDF", [
  "Merge multiple PDFs into one (pdf_merge)",
  "Split a PDF by page range (pdf_split)",
  "Extract plain text from a PDF (pdf_to_text)",
  "Add text watermark to a PDF (pdf_add_watermark)",
]);

const CC_BASE = "https://api.cloudconvert.com/v2";
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_MS = 120_000;

async function getKey(tenant) {
  return getSecret(tenant, "CLOUDCONVERT_API_KEY", {
    fallbackEnv: "CLOUDCONVERT_API_KEY",
  });
}

async function ccPost(path, key, body) {
  const res = await fetch(`${CC_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`cloudconvert ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()).data;
}

async function ccGet(path, key) {
  const res = await fetch(`${CC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`cloudconvert ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()).data;
}

async function waitForJob(jobId, key) {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_MS) {
    const job = await ccGet(`/jobs/${jobId}`, key);
    if (job.status === "finished") return job;
    if (job.status === "error") {
      const failedTask = (job.tasks || []).find((t) => t.status === "error");
      throw new Error(
        `job failed: ${failedTask ? failedTask.message : "unknown"}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("job timeout (>120s)");
}

function extractExportUrls(job) {
  const exportTask = (job.tasks || []).find(
    (t) => t.operation === "export/url" && t.status === "finished",
  );
  if (!exportTask?.result?.files) return [];
  return exportTask.result.files.map((f) => ({
    filename: f.filename,
    url: f.url,
    size: f.size,
  }));
}

async function runJob(tenant, tasks) {
  const key = await getKey(tenant);
  if (!key) return { error: "CLOUDCONVERT_API_KEY not configured for tenant" };
  try {
    const job = await ccPost("/jobs", key, { tasks });
    const done = await waitForJob(job.id, key);
    const files = extractExportUrls(done);
    if (!files.length) return { error: "no output files produced" };
    return { files, job_id: job.id };
  } catch (err) {
    return { error: String(err).slice(0, 300) };
  }
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function pdfMerge(input, tenant) {
  const { urls } = input || {};
  if (!Array.isArray(urls) || urls.length < 2) {
    return { error: "urls must be an array of at least 2 PDF URLs" };
  }
  const imports = {};
  urls.forEach((u, i) => {
    imports[`import-${i}`] = { operation: "import/url", url: u };
  });
  const tasks = {
    ...imports,
    merge: {
      operation: "merge",
      input: Object.keys(imports),
      output_format: "pdf",
    },
    export: { operation: "export/url", input: "merge" },
  };
  return runJob(tenant, tasks);
}

async function pdfSplit(input, tenant) {
  const { url, pages } = input || {};
  if (!url) return { error: "url is required" };
  if (!pages) return { error: "pages is required (e.g. '1-3,5,7-9')" };
  const tasks = {
    import: { operation: "import/url", url },
    split: {
      operation: "convert",
      input: "import",
      output_format: "pdf",
      pages,
    },
    export: { operation: "export/url", input: "split" },
  };
  return runJob(tenant, tasks);
}

async function pdfToText(input, tenant) {
  const { url } = input || {};
  if (!url) return { error: "url is required" };
  const tasks = {
    import: { operation: "import/url", url },
    convert: {
      operation: "convert",
      input: "import",
      output_format: "txt",
    },
    export: { operation: "export/url", input: "convert" },
  };
  const result = await runJob(tenant, tasks);
  if (result.error) return result;
  // Fetch the first .txt file contents so caller gets text directly.
  try {
    const res = await fetch(result.files[0].url);
    if (!res.ok) return { ...result, text_fetch_error: `HTTP ${res.status}` };
    const text = await res.text();
    return { ...result, text };
  } catch (err) {
    return { ...result, text_fetch_error: String(err).slice(0, 200) };
  }
}

async function pdfAddWatermark(input, tenant) {
  const { url, text } = input || {};
  if (!url) return { error: "url is required" };
  if (!text) return { error: "text is required" };
  const tasks = {
    import: { operation: "import/url", url },
    watermark: {
      operation: "watermark",
      input: "import",
      output_format: "pdf",
      text,
      layer: "above",
      font_size: 48,
      font_color: "#888888",
      rotation: 45,
      opacity: 40,
      position_vertical: "center",
      position_horizontal: "center",
    },
    export: { operation: "export/url", input: "watermark" },
  };
  return runJob(tenant, tasks);
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const PDF_TOOLS = [
  {
    name: "pdf_merge",
    description:
      "Merge 2+ PDFs (given as URLs) into a single PDF. Returns a download URL for the merged file.",
    input_schema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description:
            "Ordered list of PDF URLs to concatenate (minimum 2).",
          minItems: 2,
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "pdf_split",
    description:
      "Extract specified pages from a PDF and return them as a new PDF. Use page ranges like '1-3,5,7-9'.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Source PDF URL." },
        pages: {
          type: "string",
          description:
            "Pages to keep (1-indexed). Examples: '1-3', '1,5,7', '1-3,7-9'.",
        },
      },
      required: ["url", "pages"],
    },
  },
  {
    name: "pdf_to_text",
    description:
      "Extract plain text from a PDF. Returns both a .txt download URL and the raw text inline. Good for small PDFs; use ocr_extract_text for scanned documents.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Source PDF URL." },
      },
      required: ["url"],
    },
  },
  {
    name: "pdf_add_watermark",
    description:
      "Add a diagonal text watermark across every page of a PDF (e.g. 'DRAFT', 'CONFIDENTIAL'). Returns the watermarked PDF URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Source PDF URL." },
        text: {
          type: "string",
          description: "Watermark text (short — e.g. 'CONFIDENTIAL').",
        },
      },
      required: ["url", "text"],
    },
  },
];

export async function executePdfTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  switch (toolName) {
    case "pdf_merge":
      return pdfMerge(input, tenant);
    case "pdf_split":
      return pdfSplit(input, tenant);
    case "pdf_to_text":
      return pdfToText(input, tenant);
    case "pdf_add_watermark":
      return pdfAddWatermark(input, tenant);
    default:
      return { error: `unknown pdf tool: ${toolName}` };
  }
}
