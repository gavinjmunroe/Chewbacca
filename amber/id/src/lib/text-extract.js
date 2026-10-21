/**
 * PULLING THE WORDS OUT OF A FILE.
 *
 * A drive nobody can search is a bucket. Searching filenames finds the one
 * file whose name somebody remembers, which is not the file they are looking
 * for -- they are looking for the deck that mentioned the renewal, and its
 * name is "Q3 v4 FINAL (2).pptx".
 *
 * So the text comes out once, at upload, and is stored beside the row. Not
 * per query: re-parsing a forty-page PDF to answer a keystroke is not a search
 * box.
 *
 * WHAT IT REFUSES TO DO, AND WHY THAT IS THE DESIGN.
 *
 * It does not guess. A format with no text in it -- a PNG, a zip -- comes back
 * 'unsupported' rather than empty, because empty and "there is nothing to read
 * here" look identical in a column and mean opposite things to the person
 * wondering why their file is not in the results.
 *
 * It does not read a file larger than MAX_EXTRACT_BYTES. A parser handed 400MB
 * holds that much memory in a request worker, and the worst case is not a slow
 * upload, it is an API that falls over because somebody attached a video.
 *
 * It never throws. Extraction failing is not upload failing: the file is in
 * the bucket, the row is correct, and the only thing lost is that one file
 * being findable by its contents. Every path returns a status instead.
 */

/**
 * 12MB. Chosen as the size above which a parse is no longer a request-scoped
 * piece of work -- decks and reports are comfortably under it, media is not,
 * and media has no text in it anyway.
 */
export const MAX_EXTRACT_BYTES = 12 * 1024 * 1024;

/** No more than this much text per file, because an index entry is not a copy. */
const MAX_TEXT_CHARS = 200_000;

const PLAIN = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
]);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";

/** Is there any point downloading this at all? Asked before the bytes move. */
export function extractable(contentType, byteSize) {
  const t = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (byteSize != null && byteSize > MAX_EXTRACT_BYTES) return false;
  return PLAIN.has(t) || t === DOCX || t === PDF;
}

function tidy(text) {
  return String(text ?? "")
    // A PDF gives back the page's layout as whitespace. Collapsing it is not
    // cosmetic: the search index tokenizes on it, and forty blank lines
    // between two words makes them neighbors in the file and strangers in
    // the index.
    .replace(/\u0000/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * @param {Buffer|Uint8Array} bytes
 * @param {string} contentType
 * @returns {Promise<{status: 'ready'|'unsupported'|'too_large'|'failed', text: string|null, detail?: string}>}
 */
export async function extractText(bytes, contentType) {
  const t = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);

  if (buf.length === 0) return { status: "failed", text: null, detail: "empty" };
  if (buf.length > MAX_EXTRACT_BYTES) return { status: "too_large", text: null };

  try {
    if (PLAIN.has(t)) {
      return { status: "ready", text: tidy(buf.toString("utf8")) };
    }

    if (t === DOCX) {
      // Imported lazily so a deployment that never sees a .docx never pays for
      // loading the parser, and so a broken install of it cannot stop the
      // service booting.
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: buf });
      return { status: "ready", text: tidy(out?.value ?? "") };
    }

    if (t === PDF) {
      const mod = await import("pdf-parse");
      const pdfParse = mod.default ?? mod;
      const out = await pdfParse(buf);
      const text = tidy(out?.text ?? "");
      // A PDF of scanned pages parses fine and yields nothing. That is not a
      // failure and it is not unsupported -- it is a file whose text is in an
      // image, and saying so is the only honest answer.
      if (!text) return { status: "unsupported", text: null, detail: "no_text_layer" };
      return { status: "ready", text };
    }

    return { status: "unsupported", text: null };
  } catch (err) {
    return { status: "failed", text: null, detail: err?.message ? String(err.message) : String(err) };
  }
}

/**
 * Normalize tags once, where both the writer and the filter can reach it.
 *
 * Lowercased and deduplicated, because "Pricing" and "pricing" being two tags
 * is how a tag list becomes useless by week three. Capped, because a file with
 * forty tags has none.
 */
export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 40);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}
