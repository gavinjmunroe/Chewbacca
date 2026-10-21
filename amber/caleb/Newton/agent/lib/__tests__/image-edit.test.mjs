import test from "node:test";
import assert from "node:assert/strict";

// The edit tool resolves a public base URL at call time; set it before the
// dynamic import so the resolver picks up our test host.
process.env.MEDHA_PUBLIC_AUDIO_BASE_URL = "https://test.medha.local";
process.env.OPENAI_API_KEY = "sk-test-key";

const ORIG_FETCH = global.fetch;

// 1x1 transparent PNG, base64 — stands in for the edited result.
const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/1eLAAAAAElFTkSuQmCC";

function fakeEditResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      data: [{ b64_json: ONE_PX_PNG, revised_prompt: "a bluer cat" }],
    }),
  };
}

test("parseHostedImageRef extracts id + ext from a hosted image URL", async () => {
  const { parseHostedImageRef } = await import("../tools/image-edit.js");
  assert.deepEqual(
    parseHostedImageRef("https://test.medha.local/image/abc123.png"),
    { id: "abc123", ext: "png" },
  );
  assert.deepEqual(parseHostedImageRef("https://x/image/deadbeef.jpg?cache=1"), {
    id: "deadbeef",
    ext: "jpg",
  });
});

test("parseHostedImageRef rejects non-hosted URLs", async () => {
  const { parseHostedImageRef } = await import("../tools/image-edit.js");
  assert.equal(parseHostedImageRef("https://example.com/cat.gif"), null);
  assert.equal(parseHostedImageRef(""), null);
  assert.equal(parseHostedImageRef(null), null);
});

test("edit_image errors when source_url is missing", async () => {
  const { executeImageEditTool } = await import("../tools/image-edit.js");
  const res = await executeImageEditTool(
    "edit_image",
    { prompt: "make it blue" },
    { tenant: null },
  );
  assert.equal(res.error, "source_url is required");
});

test("edit_image errors when prompt is missing", async () => {
  const { executeImageEditTool } = await import("../tools/image-edit.js");
  const res = await executeImageEditTool(
    "edit_image",
    { source_url: "https://test.medha.local/image/abc.png" },
    { tenant: null },
  );
  assert.equal(res.error, "prompt is required");
});

test("edit_image errors when a hosted source has expired from the host", async () => {
  const { executeImageEditTool } = await import("../tools/image-edit.js");
  const res = await executeImageEditTool(
    "edit_image",
    {
      source_url: "https://test.medha.local/image/ffffffff.png",
      prompt: "make it blue",
    },
    { tenant: null },
  );
  assert.match(res.error, /expired/);
});

test("edit_image edits a hosted image and returns a new image_url", async () => {
  const { storeImage } = await import("../image-host.js");
  const srcBuf = Buffer.from(ONE_PX_PNG, "base64");
  const id = storeImage(srcBuf, "image/png");
  assert.ok(id, "storeImage returned an id");
  const sourceUrl = `https://test.medha.local/image/${id}.png`;

  let calledUrl = null;
  global.fetch = async (url, opts) => {
    calledUrl = url;
    assert.ok(opts.body instanceof FormData, "body is FormData");
    assert.ok(
      !opts.headers || !opts.headers["Content-Type"],
      "no manual Content-Type",
    );
    return fakeEditResponse();
  };

  try {
    const { executeImageEditTool } = await import("../tools/image-edit.js");
    const res = await executeImageEditTool(
      "edit_image",
      { source_url: sourceUrl, prompt: "make the cat blue" },
      { tenant: null, contact: "+15551234567" },
    );
    assert.equal(calledUrl, "https://api.openai.com/v1/images/edits");
    assert.equal(res.model, "gpt-image-1");
    assert.equal(res.source_url, sourceUrl);
    assert.equal(res.revised_prompt, "a bluer cat");
    assert.match(
      res.image_url,
      /^https:\/\/test\.medha\.local\/image\/[a-f0-9]+\.png$/,
    );
    assert.notEqual(res.image_url, sourceUrl);
  } finally {
    global.fetch = ORIG_FETCH;
  }
});

test("edit_image surfaces an OpenAI error body", async () => {
  const { storeImage } = await import("../image-host.js");
  const id = storeImage(Buffer.from(ONE_PX_PNG, "base64"), "image/png");
  const sourceUrl = `https://test.medha.local/image/${id}.png`;

  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => "bad mask",
    json: async () => ({}),
  });

  try {
    const { executeImageEditTool } = await import("../tools/image-edit.js");
    const res = await executeImageEditTool(
      "edit_image",
      { source_url: sourceUrl, prompt: "make it blue" },
      { tenant: null },
    );
    assert.match(res.error, /openai edits 400/);
  } finally {
    global.fetch = ORIG_FETCH;
  }
});
