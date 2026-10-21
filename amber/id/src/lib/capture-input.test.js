import test from "node:test";
import assert from "node:assert/strict";
import { captureModel } from "./capture-input.js";
test("JSON preparation sends the required JSON instruction in input messages and has no tools", async () => {
  let request;
  const output = await captureModel(
    {
      content: [{ type: "input_text", text: "Synthetic note" }],
      instructions: "Prepare drafts.",
      json: true,
    },
    {
      key: "fixture",
      fetch: async (url, args) => {
        request = JSON.parse(args.body);
        return {
          ok: true,
          json: async () => ({
            status: "completed",
            output: [
              { content: [{ type: "output_text", text: '{"actions":[]}' }] },
            ],
          }),
        };
      },
    },
  );
  assert.equal(output, '{"actions":[]}');
  assert.equal(request.store, false);
  assert.equal(request.tools, undefined);
  assert.ok(request.input[0].content.some((c) => /json/i.test(c.text || "")));
});
