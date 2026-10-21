/**
 * WHAT IS IN THE PICTURE, IN WORDS THE SEARCH INDEX CAN HOLD.
 *
 * A drive that reads PDFs and ignores images is a drive where half of what a
 * company actually keeps -- logos, screenshots, diagrams, photos of a
 * whiteboard -- is findable only by a filename somebody did not write
 * carefully. "logo of an orange egg" should find the logo, and the only way
 * that works is if the words "orange" and "egg" are somewhere in the index.
 *
 * So an image gets one captioning call at UPLOAD and never again. The caption
 * goes into the same extracted_text column the PDF parser writes to, which
 * means the search, the ranking and the "why this matched" fragment all work
 * on images without knowing images exist.
 *
 * ── WHAT IT COSTS, SINCE THAT WAS THE QUESTION ─────────────────────────────
 *
 * One Haiku call per image, at upload only. An image resized to the 512px cap
 * below is roughly 600-900 input tokens; the caption is capped at ~120 output
 * tokens. At Haiku's rates that is on the order of a tenth of a cent per
 * image -- about a dollar per thousand uploads, once, forever. Searching is
 * free: it reads a column.
 *
 * The expensive design would be embedding every image and every query into a
 * vector space, which buys better recall on "a picture that FEELS like this"
 * and costs a vector index, a second retrieval path and a per-query call. It
 * is the right second step if captions turn out to miss things. It is the
 * wrong first one.
 *
 * ── WHY THE CAPTION IS WRITTEN THE WAY IT IS ───────────────────────────────
 *
 * The prompt asks for plain nouns and colors rather than prose, because the
 * index is a bag of words and "a striking minimalist composition evoking
 * warmth" contains none of the words anybody would type. Brand names, text
 * visible in the image and the kind of thing it is all go in, because those
 * are what people actually half-remember.
 *
 * IT NEVER THROWS. Captioning is an enhancement to findability; the bytes are
 * already in the bucket and the row is already correct. A failure means one
 * image is findable by name and tag only.
 */

const MODEL = process.env.FILE_VISION_MODEL || "claude-haiku-4-5-20251001";

/** Anything bigger is a photo, and a photo's caption does not improve with pixels. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function describable(contentType, byteSize) {
  const t = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (byteSize != null && byteSize > MAX_IMAGE_BYTES) return false;
  return SUPPORTED.has(t);
}

const PROMPT = [
  "Describe this image for a company file search index.",
  "",
  "Write plain keywords and short phrases, not prose. Include:",
  "- what kind of thing it is (logo, screenshot, chart, photo, diagram, scan)",
  "- the main subjects and shapes, in ordinary words",
  "- the dominant colors, named plainly (orange, navy, black and white)",
  "- any text or brand name visible in the image, transcribed exactly",
  "- what a person might call this when trying to find it again",
  "",
  "No preamble, no interpretation, no adjectives about mood or quality.",
  "Aim for 25 to 50 words.",
].join("\n");

/**
 * @param {Buffer} bytes
 * @param {string} contentType
 * @param {string} [filename] folded in as a hint; often the only real noun available
 * @returns {Promise<{status: 'ready'|'unsupported'|'failed', text: string|null, detail?: string}>}
 */
export async function describeImage(bytes, contentType, filename = "") {
  const t = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!SUPPORTED.has(t)) return { status: "unsupported", text: null };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Not configured is not failed. An image on a deployment with no key is an
  // image nobody captioned, and saying "failed" would send somebody looking
  // for a bug.
  if (!apiKey) return { status: "unsupported", text: null, detail: "no_api_key" };

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
    return { status: "unsupported", text: null, detail: "size" };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: t, data: buf.toString("base64") } },
              { type: "text", text: filename ? `${PROMPT}\n\nFilename: ${filename}` : PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      return { status: "failed", text: null, detail: `http_${res.status}` };
    }
    const body = await res.json();
    const text = (body?.content ?? [])
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);

    if (!text) return { status: "failed", text: null, detail: "empty" };

    /*
     * THE FILENAME IS KEPT ALONGSIDE THE CAPTION, not replaced by it. A model
     * cannot read "amber-logo-final-v3.png" off the pixels, and that string is
     * frequently the thing somebody actually types.
     */
    return { status: "ready", text: filename ? `${filename}. ${text}` : text };
  } catch (err) {
    return { status: "failed", text: null, detail: err?.message ? String(err.message) : "threw" };
  }
}
