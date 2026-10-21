/**
 * Integration tests for the voice backend — /v1/voice/dictate, /v1/voice/transcribe.
 *
 * Uses Fastify inject() against fakes injected through registerVoiceRoutes'
 * `deps` parameter: no OpenAI, no Gemini, no Cloud SQL.
 * The OpenAI batch-transcription wire call (transcribeWithOpenAI) is tested
 * directly against a stub fetch.
 *
 * All voice is voice-to-TEXT only: the OpenAI Realtime (WebRTC) streaming stack
 * and its /v1/realtime/session route were removed entirely, so those tests are
 * gone. Groq is the primary transcription engine, OpenAI/Gemini the fallbacks.
 *
 * Run with:  node --test src/routes/voice.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import {
  registerVoiceRoutes,
  transcribeWithOpenAI,
} from "./voice.js";

const TEST_DID = "did:amber:sagar-test";
const TEST_PHONE = "+13105550100";
const TEST_AMBER_ID = "amber-uuid-1";

function authStub({ did = TEST_DID, phone = TEST_PHONE } = {}) {
  return async (request) => {
    if (did || phone) request.privyUser = { userId: did, phone };
  };
}

function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  registerVoiceRoutes(app, {
    requireAuth: authStub(),
    resolveAmberIdByPhone: async (phone) => (phone === TEST_PHONE ? TEST_AMBER_ID : null),
    captureFromMessage: async () => ({ status: "captured", outcomes: [] }),
    transcribeWithOpenAI: async () => ({ transcript: "hello", model: "gpt-4o-transcribe" }),
    transcribeAndExtract: async () => null,
    ...deps,
  });
  return app;
}

const post = (app, url, payload) => app.inject({ method: "POST", url, payload });

// ── POST /v1/voice/dictate ───────────────────────────────────────────────────

test("dictate transcribes with OpenAI then captures the transcript", async () => {
  const captured = [];
  const app = buildApp({
    transcribeWithGroq: async () => null,
    transcribeWithOpenAI: async () => ({ transcript: "Maggie moved to Austin", model: "gpt-4o-transcribe" }),
    captureFromMessage: async (args) => {
      captured.push(args);
      return { status: "captured", outcomes: [{ route: "fact", status: "captured" }] };
    },
  });

  const res = await post(app, "/v1/voice/dictate", {
    audio: Buffer.from("fake-audio").toString("base64"),
    mimeType: "audio/m4a",
    durationMs: 3200,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.transcript, "Maggie moved to Austin");
  assert.equal(body.engine, "openai:gpt-4o-transcribe");
  assert.equal(body.outcomes.length, 1);
  assert.equal(captured[0].messageText, "Maggie moved to Austin");
  assert.equal(captured[0].source, "app_voice");
  assert.equal(captured[0].ownerId, TEST_AMBER_ID);
});

test("dictate falls back to Gemini when OpenAI transcription fails", async () => {
  const app = buildApp({
    transcribeWithGroq: async () => null,
    transcribeWithOpenAI: async () => null,
    transcribeAndExtract: async () => ({ transcript: "from gemini", structured: "" }),
  });
  const res = await post(app, "/v1/voice/dictate", { audio: "AAAA", mimeType: "audio/m4a" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().transcript, "from gemini");
  assert.equal(res.json().engine, "gemini");
});

test("dictate 502s only when ALL engines fail", async () => {
  const app = buildApp({
    transcribeWithGroq: async () => null,
    transcribeWithOpenAI: async () => null,
    transcribeAndExtract: async () => null,
  });
  const res = await post(app, "/v1/voice/dictate", { audio: "AAAA" });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error, "transcription_failed");
});

// ── auth / owner scoping, shared by all routes ───────────────────────────────

for (const [url, payload] of [
  ["/v1/voice/dictate", { audio: "AAAA" }],
  ["/v1/voice/transcribe", { audio: "AAAA" }],
]) {
  test(`${url} 401s without a token subject`, async () => {
    const app = buildApp({ requireAuth: authStub({ did: null, phone: null }) });
    const res = await post(app, url, payload);
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "no_user");
  });

  test(`${url} 400s when the session carries no phone`, async () => {
    const app = buildApp({ requireAuth: authStub({ phone: null }) });
    const res = await post(app, url, payload);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "no_phone_on_session");
  });

  test(`${url} 400s when the phone resolves to no owner`, async () => {
    const app = buildApp({ resolveAmberIdByPhone: async () => null });
    const res = await post(app, url, payload);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "could_not_resolve_owner");
  });
}

// ── OpenAI batch-transcription wire call, against a stub fetch ────────────────

test("transcribeWithOpenAI posts multipart audio and returns the text", async () => {
  let seen = null;
  const audioBase64 = Buffer.from("fake-audio-bytes").toString("base64");
  const out = await transcribeWithOpenAI({
    audioBase64,
    mimeType: "audio/wav",
    apiKey: "sk-test",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ text: "  hello world  " }), { status: 200 });
    },
  });

  assert.equal(out.transcript, "hello world");
  assert.equal(seen.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.ok(seen.init.body instanceof FormData);
  assert.equal(seen.init.body.get("model"), "gpt-4o-transcribe");
  const file = seen.init.body.get("file");
  assert.equal(file.name, "audio.wav"); // extension is derived from mimeType
  assert.equal(file.size, Buffer.from(audioBase64, "base64").length);
  // The multipart boundary must be left to fetch — setting content-type breaks it.
  assert.equal(seen.init.headers["Content-Type"], undefined);
});

test("transcribeWithOpenAI returns null (not throws) on a non-ok response", async () => {
  const out = await transcribeWithOpenAI({
    audioBase64: "AAAA",
    apiKey: "sk-test",
    fetchImpl: async () => new Response("nope", { status: 500 }),
  });
  assert.equal(out, null);
});

test("transcribeWithOpenAI returns null without an API key", async () => {
  assert.equal(await transcribeWithOpenAI({ audioBase64: "AAAA", apiKey: "" }), null);
});

/**
 * ── THE NOTE THAT CAME BACK AS "THANK YOU FOR WATCHING!" ─────────────────────
 *
 *   "None of that got recorded somehow, even though I saw the recording
 *    happening, and then it somehow added 'Thank you for watching' at the
 *    bottom."
 *
 * lib/transcript-filler.test.js pins WHICH phrases go. These pin the thing that
 * actually failed, which is the wiring: whether a filler-only result stops the
 * engine cascade, and whether what reaches capture is the user's words.
 */

test("BOILERPLATE DOES NOT END THE CASCADE", async () => {
  /**
   * The whole bug in one test. Groq answers a quiet clip with a YouTube outro at
   * ordinary confidence, so the old ladder accepted it and stopped -- and the
   * second engine, which could hear the actual speech, was never asked. The
   * filter has to live INSIDE the ladder for this to work.
   */
  const asked = [];
  const captured = [];
  const app = buildApp({
    transcribeWithGroq: async () => {
      asked.push("groq");
      return { transcript: "Thank you for watching!", model: "whisper-large-v3" };
    },
    transcribeWithOpenAI: async () => {
      asked.push("openai");
      return { transcript: "Remind me to call the bank on Tuesday", model: "gpt-4o-transcribe" };
    },
    captureFromMessage: async (args) => {
      captured.push(args.messageText);
      return { status: "captured", outcomes: [] };
    },
  });

  const res = await post(app, "/v1/voice/dictate", { audio: "AAAA", mimeType: "audio/m4a" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(asked, ["groq", "openai"], "the second engine was never asked");
  assert.equal(res.json().transcript, "Remind me to call the bank on Tuesday");
  assert.deepEqual(captured, ["Remind me to call the bank on Tuesday"]);
});

test("a trailing hallucination is trimmed off real speech", async () => {
  const captured = [];
  const app = buildApp({
    transcribeWithGroq: async () => ({
      transcript: "Remind me to pick up my clothes tomorrow. Thank you for watching!",
      model: "whisper-large-v3",
    }),
    captureFromMessage: async (args) => {
      captured.push(args.messageText);
      return { status: "captured", outcomes: [] };
    },
  });

  const res = await post(app, "/v1/voice/dictate", { audio: "AAAA", mimeType: "audio/m4a" });
  assert.equal(res.json().transcript, "Remind me to pick up my clothes tomorrow.");
  // AND THE SAME TEXT REACHES CAPTURE. A transcript cleaned for display but not
  // for the extractor would file a reminder to thank somebody for watching.
  assert.deepEqual(captured, ["Remind me to pick up my clothes tomorrow."]);
});

test("a clip with nothing but boilerplate is SILENT, not broken", async () => {
  /**
   * Every engine heard nothing. The user needs to know the recording was quiet
   * so they can check their microphone -- "could not transcribe" sends them to
   * the wrong problem entirely, and saving the boilerplate as their note is
   * worse than either.
   */
  const app = buildApp({
    transcribeWithGroq: async () => ({ transcript: "Thanks for watching!", model: "whisper-large-v3" }),
    transcribeWithOpenAI: async () => ({ transcript: "you", model: "gpt-4o-transcribe" }),
    transcribeAndExtract: async () => ({ transcript: "♪♪♪" }),
  });

  for (const url of ["/v1/voice/dictate", "/v1/voice/transcribe"]) {
    const res = await post(app, url, { audio: "AAAA", mimeType: "audio/m4a" });
    assert.equal(res.statusCode, 502, url);
    assert.equal(res.json().error, "no_speech", `${url} blamed the transcriber`);
  }
});

test("a genuine engine failure still says the transcriber failed", async () => {
  // The other side of that split: nothing came back at all, which is not the
  // same as a quiet room and must not be reported as one.
  const app = buildApp({
    transcribeWithGroq: async () => null,
    transcribeWithOpenAI: async () => null,
    transcribeAndExtract: async () => null,
  });
  for (const url of ["/v1/voice/dictate", "/v1/voice/transcribe"]) {
    const res = await post(app, url, { audio: "AAAA", mimeType: "audio/m4a" });
    assert.equal(res.statusCode, 502, url);
    assert.equal(res.json().error, "transcription_failed", url);
  }
});

test("a low-confidence transcript still beats losing the recording", async () => {
  // Unchanged behavior, pinned because the ladder was rewritten around it.
  // Filler does not qualify for this fallback; real words do.
  const app = buildApp({
    transcribeWithGroq: async () => ({
      transcript: "something mumbled about Tuesday",
      model: "whisper-large-v3",
      lowConfidence: true,
    }),
    transcribeWithOpenAI: async () => null,
    transcribeAndExtract: async () => null,
  });
  const res = await post(app, "/v1/voice/transcribe", { audio: "AAAA", mimeType: "audio/m4a" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().transcript, "something mumbled about Tuesday");
  assert.match(res.json().engine, /lowconf/);
});
