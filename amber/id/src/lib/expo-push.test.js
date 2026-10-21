/**
 * The Expo push sender's failure reporting.
 *
 * This is the file that made "notifications aren't working" invisible: Expo returns
 * HTTP 200 for a request it accepted and reports per-message outcomes in the BODY, so
 * checking only res.ok made a completely dead pipeline look like a successful send.
 * These tests pin the ticket parsing, because that is the only thing standing between
 * a credential problem and silence.
 *
 * Run with:  node --test src/lib/expo-push.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { sendExpoPush } from "./expo-push.js";

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

test("a 200 whose tickets are errors is reported as FAILED, not sent", async () => {
  const res = await sendExpoPush(
    [{ to: TOKEN_A, title: "t" }],
    {
      fetchImpl: async () =>
        ok({ data: [{ status: "error", message: "bad creds", details: { error: "InvalidCredentials" } }] }),
    },
  );
  assert.equal(res.sent, 0);
  assert.equal(res.failed, 1);
  assert.deepEqual(res.unregistered, []);
});

test("DeviceNotRegistered tokens come back so the caller can delete them", async () => {
  const res = await sendExpoPush(
    [{ to: TOKEN_A, title: "t" }, { to: TOKEN_B, title: "t" }],
    {
      fetchImpl: async () =>
        ok({
          data: [
            { status: "ok", id: "1" },
            { status: "error", details: { error: "DeviceNotRegistered" } },
          ],
        }),
    },
  );
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 1);
  assert.deepEqual(res.unregistered, [TOKEN_B]);
});

test("a successful send reports every ticket as sent", async () => {
  const res = await sendExpoPush(
    [{ to: TOKEN_A, title: "t" }, { to: TOKEN_B, title: "t" }],
    { fetchImpl: async () => ok({ data: [{ status: "ok" }, { status: "ok" }] }) },
  );
  assert.deepEqual(res, { sent: 2, failed: 0, unregistered: [] });
});

test("non-Expo tokens are dropped before the request", async () => {
  let body = null;
  const res = await sendExpoPush(
    [{ to: "not-a-token", title: "t" }, { to: TOKEN_A, title: "t" }],
    {
      fetchImpl: async (_u, init) => {
        body = JSON.parse(init.body);
        return ok({ data: [{ status: "ok" }] });
      },
    },
  );
  assert.equal(body.length, 1);
  assert.equal(body[0].to, TOKEN_A);
  assert.equal(res.sent, 1);
});

test("nothing valid to send makes no request at all", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return ok({ data: [] });
  };
  assert.deepEqual(await sendExpoPush([], { fetchImpl }), { sent: 0, failed: 0, unregistered: [] });
  assert.deepEqual(await sendExpoPush([{ to: "nope" }], { fetchImpl }), {
    sent: 0,
    failed: 0,
    unregistered: [],
  });
  assert.deepEqual(await sendExpoPush(null, { fetchImpl }), { sent: 0, failed: 0, unregistered: [] });
  assert.equal(calls, 0);
});

test("a non-2xx, a thrown fetch and unparseable JSON are all failures, never throws", async () => {
  const nonOk = await sendExpoPush([{ to: TOKEN_A }], {
    fetchImpl: async () => ({ ok: false, status: 502, text: async () => "bad gateway" }),
  });
  assert.equal(nonOk.failed, 1);

  const threw = await sendExpoPush([{ to: TOKEN_A }], {
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.equal(threw.failed, 1);

  // Accepted but no ticket array: counted as sent rather than inventing a failure.
  const weird = await sendExpoPush([{ to: TOKEN_A }], {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  assert.equal(weird.sent, 1);
});

test("more than 100 messages are batched", async () => {
  const sizes = [];
  const many = Array.from({ length: 250 }, () => ({ to: TOKEN_A, title: "t" }));
  await sendExpoPush(many, {
    fetchImpl: async (_u, init) => {
      const batch = JSON.parse(init.body);
      sizes.push(batch.length);
      return ok({ data: batch.map(() => ({ status: "ok" })) });
    },
  });
  assert.deepEqual(sizes, [100, 100, 50]);
});
