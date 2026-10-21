/** Bounded capture input; never dereferences a URL or executes document content. */
export const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|csv|tsv|json|vcf|ics|xml|log)$/i;
const DOC_EXT = /\.(pdf|docx|xlsx|pptx|rtf)$/i;
export function captureFile(input) {
  if (
    !input ||
    typeof input.name !== "string" ||
    input.name.length > 200 ||
    typeof input.data !== "string"
  )
    throw Error("invalid_file");
  if (
    input.data.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)
  )
    throw Error("invalid_file");
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES)
    throw Error("file_too_large");
  if (TEXT_EXT.test(input.name)) {
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    if (text.includes("\u0000") || text.length > 32000)
      throw Error("text_too_large");
    return { text };
  }
  const mime = input.mimeType;
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime))
    return {
      content: {
        type: "input_image",
        image_url: `data:${mime};base64,${input.data}`,
      },
    };
  if (!DOC_EXT.test(input.name)) throw Error("unsupported_file");
  return {
    content: {
      type: "input_file",
      filename: input.name.replace(/[/\\]/g, "_"),
      file_data: `data:${mime || "application/octet-stream"};base64,${input.data}`,
    },
  };
}
export function captureResponseText(payload) {
  if (payload?.status !== "completed") throw Error("capture_incomplete");
  const value = (payload.output ?? [])
    .flatMap((v) => v.content ?? [])
    .filter((v) => v.type === "output_text")
    .map((v) => v.text)
    .join("");
  if (!value.trim()) throw Error("capture_empty");
  return value;
}
export async function captureModel(
  { content, instructions, json = false },
  deps = {},
) {
  const key = deps.key ?? process.env.OPENAI_API_KEY;
  if (!key) throw Error("capture_unavailable");
  const response = await (deps.fetch ?? fetch)(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: process.env.CAPTURE_MODEL || "gpt-4.1-mini",
        store: false,
        instructions,
        input: [
          {
            role: "user",
            content: json
              ? [
                  ...content,
                  { type: "input_text", text: "Return the response as JSON." },
                ]
              : content,
          },
        ],
        max_output_tokens: 10000,
        ...(json ? { text: { format: { type: "json_object" } } } : {}),
      }),
    },
  );
  if (!response.ok) throw Error("capture_unavailable");
  return captureResponseText(await response.json());
}
