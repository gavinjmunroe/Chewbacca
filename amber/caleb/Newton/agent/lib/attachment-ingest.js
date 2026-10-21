/**
 * attachment-ingest.js — orchestrate text extraction for inbound Loop
 * attachments.
 *
 * Loop's webhook delivers PDFs, images, office docs, and plain-text /
 * code files via `payload.attachments[]`. server.js (Tab 8) extracts
 * non-audio entries and hands them here; we classify each URL, then:
 *   - images + PDFs  -> existing `ocr_extract_text` tool (Mistral OCR
 *                       with Claude vision fallback) per attachment.
 *   - DOCX / XLSX / PPTX / CSV / TXT / MD / JSON / RTF / code
 *                    -> file-extract.js (native libs, no API keys).
 *   - unknown        -> marker only, no inlined text.
 *
 * Mistral OCR requires MISTRAL_API_KEY (preferred when configured for the
 * lower cost), but that key is not always set. If Mistral fails for any
 * reason on image / PDF kinds, we fall back to the Claude vision tool
 * (claude_vision_extract), which uses ANTHROPIC_API_KEY (already set in
 * prod) and natively handles both images and PDFs via the Messages API's
 * image + document blocks.
 *
 * Errors per attachment are isolated: one failure does not block the
 * others. Failures surface as a marker plus a short error tag so the
 * model still knows a file arrived and can ask the user to re-send.
 */

import {
  classifyAttachment,
  summarizeAttachmentForPrompt,
} from "./attachments.js";
import { chunkFileText } from "./file-chunker.js";
import { saveMemory } from "./memory.js";

/**
 * Tab 15 — build the Pinecone memory record for an inbound image after
 * OCR / vision extraction. Lets "show me the screenshot Shirley sent of the
 * Clay table" recall the extracted text plus the source URL. Pure +
 * exported so the metadata shape is unit-tested without any network.
 */
export function buildImageContentMemory({
  text,
  url,
  extractor = null,
  contact = null,
  filename = null,
  messageId = null,
}) {
  return {
    content: text,
    category: "image_content",
    dimensions: ["intellectual"],
    source: url,
    handle: contact || undefined,
    tags: ["image_content"],
    extra: {
      sourceUrl: url,
      extractor: extractor || null,
      contact: contact || null,
      filename: filename || null,
      messageId: messageId || null,
    },
  };
}

const MAX_ATTACHMENTS_PER_TURN = 5;
const MAX_INLINED_TEXT_PER_ATTACHMENT = 6000;

// Kinds whose extracted text we persist to Pinecone for durable semantic
// recall (Tab 14). Images are intentionally excluded — Tab 15 owns image
// content embedding via the vision OCR description. Legacy .doc/.ppt yield
// no text so they fall out naturally.
const PINECONE_INGEST_KINDS = new Set([
  "docx",
  "xlsx",
  "xls",
  "pptx",
  "csv",
  "txt",
  "md",
  "json",
  "rtf",
  "code",
  "pdf",
]);

// Kinds routed through the OCR pipeline (Mistral / Claude vision).
const OCR_KINDS = new Set(["image", "pdf"]);

// Kinds routed through the library-based file extractor.
const FILE_EXTRACT_KINDS = new Set([
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "ppt",
  "csv",
  "txt",
  "md",
  "json",
  "rtf",
  "code",
]);

function clip(text, max) {
  if (typeof text !== "string") return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n[…truncated at ${max} chars]`;
}

/**
 * Normalize OCR results from different providers into a single shape so
 * the rendering loop doesn't have to branch.
 *
 * Mistral returns: { text, page_count, model, usage }
 * Claude vision returns: { ok, text, model, source_url, type }
 * Either one might surface `markdown` instead of `text` (some providers
 * differ); we collapse both to `text` here.
 */
function normalizeOcrResult(raw, source) {
  if (!raw) return null;
  const text =
    typeof raw.text === "string" && raw.text
      ? raw.text
      : typeof raw.markdown === "string"
        ? raw.markdown
        : "";
  return {
    text,
    page_count:
      typeof raw.page_count === "number" && raw.page_count > 0
        ? raw.page_count
        : null,
    model: raw.model || null,
    source,
  };
}

/**
 * processInboundAttachments({ tenant, urls, contact, messageId,
 *                             ocrExecutor?, claudeVisionExecutor?,
 *                             fileExtractor? })
 *   -> { extractedText: string, perAttachmentSummary: Array }
 *
 * - tenant: resolved tenant object (required for MISTRAL_API_KEY lookup)
 * - urls:   array of attachment URLs from Loop (already audio-filtered)
 * - ocrExecutor:          test seam — defaults to lib/tools/ocr.js
 * - claudeVisionExecutor: test seam — defaults to lib/tools/claude-vision-ocr.js
 * - fileExtractor:        test seam — defaults to lib/file-extract.js
 * - saveMemoriesFn:       test seam — defaults to lib/memory.js saveMemories
 *
 * Returns:
 *   extractedText: the prompt-ready prefix block (markers + inlined text)
 *   perAttachmentSummary: structured records for logging/observability
 *   chunksIndexed: count of file_content chunks written to Pinecone (Tab 14)
 */
export async function processInboundAttachments({
  tenant,
  urls,
  contact = null,
  messageId = null,
  ocrExecutor = null,
  claudeVisionExecutor = null,
  fileExtractor = null,
  saveMemoriesFn = null,
  memorySaver = saveMemory,
} = {}) {
  const empty = { extractedText: "", perAttachmentSummary: [] };
  if (!Array.isArray(urls) || urls.length === 0) return empty;

  const trimmed = urls
    .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
    .slice(0, MAX_ATTACHMENTS_PER_TURN);
  if (trimmed.length === 0) return empty;

  const classifications = trimmed.map((u) => classifyAttachment(u));
  const needsOcr = classifications.some((c) => OCR_KINDS.has(c.kind));
  const needsFileExtract = classifications.some((c) =>
    FILE_EXTRACT_KINDS.has(c.kind),
  );

  // Lazy-load executors so unit tests can pass stubs without us touching
  // Mistral / Anthropic / the network at all.
  let executeOcrTool = ocrExecutor;
  if (needsOcr && !executeOcrTool) {
    const mod = await import("./tools/ocr.js");
    executeOcrTool = mod.executeOcrTool;
  }

  let claudeVisionFn = claudeVisionExecutor;
  async function getClaudeVision() {
    if (claudeVisionFn) return claudeVisionFn;
    const mod = await import("./tools/claude-vision-ocr.js");
    claudeVisionFn = mod.executeClaudeVisionOcrTool;
    return claudeVisionFn;
  }

  let extractFileContent = fileExtractor;
  if (needsFileExtract && !extractFileContent) {
    const mod = await import("./file-extract.js");
    extractFileContent = mod.extractFileContent;
  }

  const results = await Promise.all(
    trimmed.map(async (url, i) => {
      const att = classifications[i];

      // Image / PDF -> OCR pipeline (Mistral with Claude vision fallback).
      if (OCR_KINDS.has(att.kind)) {
        const mistralType = att.kind === "image" ? "image_url" : "document_url";
        const claudeType = att.kind === "pdf" ? "pdf" : "image";
        try {
          const ocr = await executeOcrTool(
            "ocr_extract_text",
            { url, type: mistralType },
            { tenant },
          );
          if (!ocr?.error && (ocr?.text || ocr?.markdown)) {
            return {
              att,
              payload: normalizeOcrResult(ocr, "mistral"),
              error: null,
              source: "mistral",
            };
          }
          // Mistral failed; fall back to Claude vision.
          const mistralError = ocr?.error || "mistral returned empty result";
          const fn = await getClaudeVision();
          const cv = await fn(
            "claude_vision_extract",
            { url, type: claudeType },
            { tenant },
          );
          if (cv?.ok && cv?.text) {
            return {
              att,
              payload: normalizeOcrResult(cv, "claude_vision"),
              error: null,
              source: "claude_vision",
            };
          }
          return {
            att,
            payload: null,
            error: cv?.error
              ? `mistral: ${mistralError}; claude_vision: ${cv.error}`
              : mistralError,
            source: null,
          };
        } catch (err) {
          // Defensive: if Mistral threw, still try Claude vision.
          try {
            const fn = await getClaudeVision();
            const cv = await fn(
              "claude_vision_extract",
              { url, type: claudeType },
              { tenant },
            );
            if (cv?.ok && cv?.text) {
              return {
                att,
                payload: normalizeOcrResult(cv, "claude_vision"),
                error: null,
                source: "claude_vision",
              };
            }
            return {
              att,
              payload: null,
              error: String(err?.message || err),
              source: null,
            };
          } catch (err2) {
            return {
              att,
              payload: null,
              error: String(err2?.message || err2),
              source: null,
            };
          }
        }
      }

      // DOCX / XLSX / PPTX / CSV / TXT / MD / JSON / RTF / code
      // -> library-based file extractor.
      if (FILE_EXTRACT_KINDS.has(att.kind)) {
        try {
          const out = await extractFileContent({
            url,
            kind: att.kind,
            mime: att.mime,
            tenant,
            maxText: MAX_INLINED_TEXT_PER_ATTACHMENT,
          });
          if (out?.error) {
            return {
              att,
              payload: null,
              error: out.error,
              source: out.source || null,
            };
          }
          return {
            att,
            payload: {
              text: out?.text || "",
              page_count: out?.pageCount || null,
              model: null,
              source: out?.source || null,
            },
            error: null,
            source: out?.source || null,
          };
        } catch (err) {
          return {
            att,
            payload: null,
            error: String(err?.message || err),
            source: null,
          };
        }
      }

      // Unknown kind -> marker only.
      return { att, payload: null, error: null, source: null };
    }),
  );

  const summaries = [];
  const blocks = [];
  // Tab 14: file content destined for the tenant's Pinecone namespace.
  // Collected across all attachments and written in one batched call so a
  // multi-file turn costs one round-trip, off the reply's critical path.
  const memoryItems = [];
  const ingestedAt = new Date().toISOString();
  // Tab 15: inbound IMAGE OCR/vision text, saved per-image (separate from the
  // batched file_content path above, which excludes images by design).
  const memoryWrites = [];
  for (const { att, payload, error, source } of results) {
    const enriched = {
      ...att,
      pageCount: payload?.page_count || null,
    };
    summaries.push({
      url: att.url,
      kind: att.kind,
      filename: att.filename,
      pageCount: payload?.page_count || null,
      ok: !!payload && !!payload.text && !error,
      error: error || null,
      textLength: payload?.text ? payload.text.length : 0,
      source: source || null,
    });

    if (payload?.text && PINECONE_INGEST_KINDS.has(att.kind)) {
      const chunks = chunkFileText({ text: payload.text, kind: att.kind });
      for (const chunk of chunks) {
        memoryItems.push({
          content: chunk.text,
          category: "file_content",
          dimensions: ["intellectual"],
          source: att.url,
          handle: contact || undefined,
          tags: [
            "file_content",
            att.kind,
            source ? `extractor:${source}` : null,
          ].filter(Boolean),
          extra: {
            filename: att.filename || null,
            mime: att.mime || null,
            extractor: source || null,
            file_kind: att.kind,
            page_or_section: chunk.section,
            chunk_index: chunk.index,
            chunk_count: chunks.length,
            contact: contact || null,
            messageId: messageId || null,
            extractedAt: ingestedAt,
          },
        });
      }
    }

    const marker = summarizeAttachmentForPrompt(enriched);
    if (payload?.text) {
      blocks.push(
        `${marker}\n${clip(payload.text, MAX_INLINED_TEXT_PER_ATTACHMENT)}`,
      );
      // Tab 15 — index inbound image OCR/vision text into the tenant's
      // Pinecone so screenshots and photos are recallable later. PDFs and
      // office docs are Tab 14's file_content path; here we only cover
      // images. Best-effort: a memory write must never block the reply.
      if (att.kind === "image") {
        memoryWrites.push(
          memorySaver(
            buildImageContentMemory({
              text: payload.text,
              url: att.url,
              extractor: source || payload.source || null,
              contact,
              filename: att.filename || null,
              messageId,
            }),
            tenant,
          ),
        );
      }
    } else if (error) {
      // OCR kinds keep the legacy "[OCR failed: …]" prefix so existing
      // dashboards and tests keep matching. File-extract errors use the
      // generic "[error: …]" tag the prompt already knows about.
      const wasOcr = OCR_KINDS.has(att.kind);
      const tag = wasOcr ? "OCR failed" : "error";
      blocks.push(`${marker}\n[${tag}: ${String(error).slice(0, 200)}]`);
    } else {
      blocks.push(`${marker}\n[unsupported type, content not extracted]`);
    }
  }

  // Best-effort: let the image-content writes settle, but never throw out
  // of ingest if one fails (saveMemory is a no-op when amber-id is off).
  if (memoryWrites.length) {
    await Promise.allSettled(memoryWrites);
  }

  if (contact || messageId) {
    const tag = [
      contact ? `from=${contact}` : null,
      messageId ? `msg=${messageId}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const sources = summaries
      .map((s) => s.source)
      .filter(Boolean)
      .reduce((acc, s) => {
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {});
    const srcTag = Object.keys(sources).length
      ? " sources=" + JSON.stringify(sources)
      : "";
    console.log(
      `[attachments] ingest ${tag} count=${summaries.length} ok=${summaries.filter((s) => s.ok).length}${srcTag}`,
    );
  }

  // Tab 14: persist chunked file content to the tenant's Pinecone
  // namespace. One batched ingest-as call. Best-effort — a failure here
  // never blocks the reply (saveMemories already swallows its own errors,
  // and we guard the lazy import too).
  let chunksIndexed = 0;
  if (memoryItems.length > 0) {
    try {
      let save = saveMemoriesFn;
      if (!save) {
        const mod = await import("./memory.js");
        save = mod.saveMemories;
      }
      await save(memoryItems, tenant);
      chunksIndexed = memoryItems.length;
      console.log(
        `[attachments] indexed ${chunksIndexed} file_content chunk(s) to Pinecone`,
      );
    } catch (err) {
      console.warn(
        `[attachments] Pinecone indexing failed: ${err?.message || err}`,
      );
    }
  }

  return {
    extractedText: blocks.join("\n\n"),
    perAttachmentSummary: summaries,
    chunksIndexed,
  };
}
