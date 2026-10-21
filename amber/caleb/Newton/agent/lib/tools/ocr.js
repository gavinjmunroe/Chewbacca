/**
 * ocr.js — OCR text extraction for PDFs and images via Mistral OCR API.
 *
 * Why Mistral OCR over alternatives:
 *   - One endpoint for both PDF and image inputs (no Tesseract install needed)
 *   - Returns structured markdown with preserved layout (tables, headings)
 *   - Works on URLs (no base64 upload round-trip for public links)
 *
 * Per-user secret: MISTRAL_API_KEY via lib/secrets.js.
 * Fallback: process.env.MISTRAL_API_KEY during migration.
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_OCR", [
  "Extract text and tables from PDFs (ocr_extract_text)",
  "Extract text from images (ocr_extract_text)",
]);

const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const DEFAULT_TIMEOUT_MS = 60_000;

async function getKey(tenant) {
  return getSecret(tenant, "MISTRAL_API_KEY", {
    fallbackEnv: "MISTRAL_API_KEY",
  });
}

async function callOcr(tenant, documentSpec) {
  const key = await getKey(tenant);
  if (!key) return { error: "MISTRAL_API_KEY not configured for tenant" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(MISTRAL_OCR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-ocr-latest",
        document: documentSpec,
        include_image_base64: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `mistral ocr ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    // Flatten pages → single markdown string (preserves order).
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const text = pages.map((p) => p.markdown || "").join("\n\n---\n\n");
    return {
      text,
      page_count: pages.length,
      model: data.model || "mistral-ocr-latest",
      usage: data.usage_info || null,
    };
  } catch (err) {
    clearTimeout(timer);
    return { error: `ocr failed: ${String(err).slice(0, 200)}` };
  }
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function ocrExtractText(input, tenant) {
  const { url, type } = input || {};
  if (!url || typeof url !== "string") {
    return { error: "url is required" };
  }
  const inferredType =
    type || (/\.pdf(\?|$)/i.test(url) ? "document_url" : "image_url");
  const spec =
    inferredType === "image_url"
      ? { type: "image_url", image_url: url }
      : { type: "document_url", document_url: url };
  return callOcr(tenant, spec);
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const OCR_TOOLS = [
  {
    name: "ocr_extract_text",
    description:
      "Extract text (with preserved tables and layout as markdown) from a PDF or image URL. Works on any publicly reachable URL including Google Drive download links. Returns markdown per page.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Publicly reachable PDF or image URL.",
        },
        type: {
          type: "string",
          enum: ["document_url", "image_url"],
          description:
            "Optional; auto-detected from URL extension. Set explicitly if the URL has no extension.",
        },
      },
      required: ["url"],
    },
  },
];

export async function executeOcrTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  switch (toolName) {
    case "ocr_extract_text":
      return ocrExtractText(input, tenant);
    default:
      return { error: `unknown ocr tool: ${toolName}` };
  }
}
