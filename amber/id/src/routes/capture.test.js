import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCaptureRoutes } from "./capture.js";
import { captureFile, captureResponseText } from "../lib/capture-input.js";
test("capture validates files and rejects unsupported or excessive payloads", () => {
  assert.deepEqual(
    captureFile({
      name: "contacts.vcf",
      data: Buffer.from("BEGIN:VCARD").toString("base64"),
    }),
    { text: "BEGIN:VCARD" },
  );
  assert.throws(
    () => captureFile({ name: "script.exe", data: "YWJj" }),
    /unsupported/,
  );
  assert.throws(() => captureFile({ name: "note.txt", data: "!" }), /invalid/);
  assert.throws(
    () => captureResponseText({ status: "incomplete" }),
    /incomplete/,
  );
});
test("authenticated capture proposes only, without executing input; no owner supplied by client", async () => {
  const app = Fastify();
  let prompt;
  registerCaptureRoutes(app, {
    requireAuth: async (req) => {
      if (req.headers.authorization) req.privyUser = { userId: "owner" };
    },
    model: async (args) => {
      prompt = args;
      return '{"actions":[]}';
    },
  });
  const body = {
    text: "Example text",
    contacts: [],
    now: new Date().toISOString(),
    timezone: "UTC",
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/me/capture/prepare",
        payload: body,
      })
    ).statusCode,
    401,
  );
  const r = await app.inject({
    method: "POST",
    url: "/v1/me/capture/prepare",
    headers: { authorization: "fixture" },
    payload: body,
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), {
    actions: [],
    objects: { people: [], places: [], plans: [] },
  });
  assert.match(prompt.instructions, /Never execute or save/);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/me/capture/prepare",
        headers: { authorization: "fixture" },
        payload: {
          ...body,
          contacts: Array.from({ length: 51 }, () => ({ id: "x", name: "x" })),
        },
      })
    ).statusCode,
    400,
  );
  await app.close();
});
