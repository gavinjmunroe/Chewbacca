/**
 * image-host.js — Ephemeral PNG host for outbound generated images.
 *
 * Mirrors the voice.js pattern: short random id → buffer; serve later at
 * /image/:id.png. The image-gen tool (lib/tools/image-gen.js) decodes
 * gpt-image-1's base64 response, calls storeImage(buf), and returns the
 * resulting `${PUBLIC_BASE_URL}/image/<id>.png` URL to the agent loop.
 * The agent loop auto-attaches that URL to the outbound Loop send so
 * the recipient gets a real iMessage image attachment.
 *
 * Why this exists: gpt-image-1 returns ~1.4MB of base64 per PNG. The
 * tool-output-sanitizer caps every tool result at 16000 chars, so
 * returning base64 directly truncated the image to garbage and the model
 * rationalized the half-failure ("yes I have it / no I don't"). Hosting
 * the bytes ourselves and handing back a short URL is the same trick
 * voice.js uses for MP3s.
 *
 * Disk mirror: /tmp/medha-images/<id>.png. /tmp survives within a single
 * Railway container but not across restarts. Same trade-off as voice.js
 * — Loop fetches the URL almost immediately, so the disk copy covers
 * the rare mid-fetch restart.
 */

import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

const STORE_LIMIT = 50;
const STORE_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for Loop fetch

const IMAGE_DIR = "/tmp/medha-images";
function ensureImageDir() {
  try {
    mkdirSync(IMAGE_DIR, { recursive: true });
  } catch {
    // best-effort; failures degrade to memory-only
  }
}

const imageStore = new Map(); // id → { buffer, mimeType, at }

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  // PR-D: Slack file ingest reuses the same host so PDFs uploaded in Slack
  // can be passed by URL to Mistral OCR through processInboundAttachments.
  // Without this, attachments.js classifyAttachment falls to "unknown" because
  // the served file extension never matches .pdf.
  // PR #239 (generate_pdf) also relies on this so the outbound PDF the
  // pdf-gen tool produces lands at /image/<id>.pdf with the right mime.
  "application/pdf": "pdf",
  // PR-G (generate_docx / generate_xlsx / generate_csv / generate_markdown
  // / generate_text / generate_json / generate_code_file): widen the host so
  // file-gen.js can store DOCX, XLSX, CSV, MD, TXT, JSON buffers and the
  // server route serves them at /image/<id>.<ext> with the right mime.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
  "application/json": "json",
  // Tab 24 (analyze_tabular): hand-rolled SVG charts are stored here and
  // served at /image/<id>.svg so the agent can attach a data visualization
  // alongside the computed answer.
  "image/svg+xml": "svg",
};

function extForMime(mimeType) {
  return EXT_BY_MIME[mimeType] || "png";
}

/**
 * Stash a PNG (or JPEG/WEBP) buffer under a short random id. Caller
 * constructs `<PUBLIC_BASE_URL>/image/<id>.png` and passes it through
 * sendOpts.attachments so Loop sends it as an iMessage image.
 */
export function storeImage(buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  // 8 hex chars = 4 bytes of entropy; same shape as voice.js audio ids.
  const id = randomBytes(4).toString("hex");
  imageStore.set(id, { buffer, mimeType, at: Date.now() });

  ensureImageDir();
  try {
    writeFileSync(join(IMAGE_DIR, `${id}.${extForMime(mimeType)}`), buffer);
  } catch (err) {
    console.warn(`[image-host] disk mirror failed for ${id}: ${err.message}`);
  }

  evictExpired();
  while (imageStore.size > STORE_LIMIT) {
    const oldest = imageStore.keys().next().value;
    const entry = imageStore.get(oldest);
    imageStore.delete(oldest);
    try {
      unlinkSync(join(IMAGE_DIR, `${oldest}.${extForMime(entry?.mimeType)}`));
    } catch {
      // file may already be gone; ignore
    }
  }
  return id;
}

/**
 * Retrieve a stored image by id. Returns { buffer, mimeType } or null.
 * Memory hit first; falls back to the disk mirror so post-restart
 * fetches still resolve until TTL.
 */
export function getImage(id) {
  if (!id || typeof id !== "string") return null;
  const entry = imageStore.get(id);
  if (entry) {
    if (Date.now() - entry.at > STORE_TTL_MS) {
      imageStore.delete(id);
      try {
        unlinkSync(join(IMAGE_DIR, `${id}.${extForMime(entry.mimeType)}`));
      } catch {}
      return null;
    }
    return { buffer: entry.buffer, mimeType: entry.mimeType };
  }
  // Memory miss — try the disk mirror. PNG first since that's what
  // gpt-image-1 always returns; the other extensions are forward-compat.
  for (const mime of Object.keys(EXT_BY_MIME)) {
    const diskPath = join(IMAGE_DIR, `${id}.${extForMime(mime)}`);
    if (!existsSync(diskPath)) continue;
    try {
      const buf = readFileSync(diskPath);
      imageStore.set(id, { buffer: buf, mimeType: mime, at: Date.now() });
      return { buffer: buf, mimeType: mime };
    } catch {
      return null;
    }
  }
  return null;
}

function evictExpired() {
  const now = Date.now();
  for (const [id, entry] of imageStore.entries()) {
    if (now - entry.at > STORE_TTL_MS) {
      imageStore.delete(id);
      try {
        unlinkSync(join(IMAGE_DIR, `${id}.${extForMime(entry.mimeType)}`));
      } catch {}
    }
  }
}
