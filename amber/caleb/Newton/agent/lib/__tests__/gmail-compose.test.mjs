/**
 * Tests for Tab 26 — Gmail compose / reply / send-with-attachments.
 *
 * Covers the pure, network-free helpers that carry the threading and MIME
 * logic: buildRawEmail (plain, reply headers, multipart attachments),
 * deriveReplyMeta (Re: dedup, Reply-To preference, References chain), and the
 * tool registration + dispatch wiring.
 *
 * Run with: node --test Newton/agent/lib/__tests__/gmail-compose.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  buildRawEmail,
  deriveReplyMeta,
  base64UrlEncode,
  GMAIL_TOOLS,
  executeGmailTool,
} = await import("../tools/gmail.js");

/** Decode a Gmail `raw` base64url field back to the MIME string. */
function decodeRaw(raw) {
  return Buffer.from(
    raw.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");
}

test("base64UrlEncode produces url-safe, unpadded output", () => {
  const out = base64UrlEncode("hello>>>world???");
  assert.ok(!out.includes("+"), "no plus");
  assert.ok(!out.includes("/"), "no slash");
  assert.ok(!out.endsWith("="), "no padding");
  assert.equal(decodeRaw(out), "hello>>>world???");
});

test("buildRawEmail: plain text message has the expected headers and body", () => {
  const { raw, threadId } = buildRawEmail({
    to: "alice@example.com",
    subject: "Hello",
    body: "First line\nSecond line",
  });
  assert.equal(threadId, undefined, "no threadId when not supplied");
  const mime = decodeRaw(raw);
  assert.match(mime, /^To: alice@example\.com\r\n/);
  assert.match(mime, /\r\nSubject: Hello\r\n/);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.ok(mime.endsWith("First line\nSecond line"));
  // No reply or multipart artifacts on a plain message.
  assert.ok(!mime.includes("In-Reply-To"));
  assert.ok(!mime.includes("multipart/mixed"));
});

test("buildRawEmail: threadId passes through to the Gmail payload", () => {
  const payload = buildRawEmail({
    to: "a@b.com",
    subject: "s",
    body: "b",
    threadId: "thread-123",
  });
  assert.equal(payload.threadId, "thread-123");
});

test("buildRawEmail: reply headers are emitted when supplied", () => {
  const { raw } = buildRawEmail({
    to: "sender@example.com",
    subject: "Re: Proposal",
    body: "Sounds good.",
    inReplyTo: "<msg-1@mail.gmail.com>",
    references: "<root@mail.gmail.com> <msg-1@mail.gmail.com>",
  });
  const mime = decodeRaw(raw);
  assert.match(mime, /\r\nIn-Reply-To: <msg-1@mail\.gmail\.com>\r\n/);
  assert.match(
    mime,
    /\r\nReferences: <root@mail\.gmail\.com> <msg-1@mail\.gmail\.com>\r\n/,
  );
});

test("buildRawEmail: attachments produce a multipart/mixed body", () => {
  const contentBase64 = Buffer.from("PDF-BYTES").toString("base64");
  const { raw } = buildRawEmail({
    to: "emily@example.com",
    subject: "Newsletter",
    body: "Here is the draft.",
    attachments: [
      { filename: "draft.pdf", mimeType: "application/pdf", contentBase64 },
    ],
  });
  const mime = decodeRaw(raw);
  const boundaryMatch = mime.match(/boundary="(medha_[^"]+)"/);
  assert.ok(boundaryMatch, "boundary header present");
  const boundary = boundaryMatch[1];
  // Two part openers + one closing delimiter.
  assert.equal(
    mime.split(`--${boundary}`).length - 1,
    3,
    "two parts plus closing boundary",
  );
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /Content-Type: application\/pdf; name="draft\.pdf"/);
  assert.match(mime, /Content-Disposition: attachment; filename="draft\.pdf"/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.ok(mime.includes(contentBase64), "encoded attachment bytes present");
  assert.ok(mime.trimEnd().endsWith(`--${boundary}--`), "closes the boundary");
});

test("buildRawEmail: a quote in the filename cannot break the header", () => {
  const { raw } = buildRawEmail({
    to: "x@y.com",
    subject: "s",
    body: "b",
    attachments: [
      {
        filename: 'evil".pdf',
        mimeType: "application/pdf",
        contentBase64: "QQ==",
      },
    ],
  });
  const mime = decodeRaw(raw);
  assert.ok(!mime.includes('evil".pdf'), "quote stripped from filename");
  assert.match(mime, /filename="evil\.pdf"/);
});

test("deriveReplyMeta: adds Re: only when missing", () => {
  const withRe = deriveReplyMeta({
    payload: {
      headers: [
        { name: "From", value: "Bob <bob@example.com>" },
        { name: "Subject", value: "Re: Lunch" },
      ],
    },
  });
  assert.equal(withRe.subject, "Re: Lunch", "does not double the Re:");

  const noRe = deriveReplyMeta({
    payload: {
      headers: [
        { name: "From", value: "Bob <bob@example.com>" },
        { name: "Subject", value: "Lunch" },
      ],
    },
  });
  assert.equal(noRe.subject, "Re: Lunch", "prefixes Re: when absent");
});

test("deriveReplyMeta: prefers Reply-To over From, builds References chain", () => {
  const meta = deriveReplyMeta({
    payload: {
      headers: [
        { name: "From", value: "noreply@example.com" },
        { name: "Reply-To", value: "human@example.com" },
        { name: "Subject", value: "Question" },
        { name: "Message-ID", value: "<m2@mail>" },
        { name: "References", value: "<m0@mail> <m1@mail>" },
      ],
    },
  });
  assert.equal(meta.to, "human@example.com", "Reply-To wins");
  assert.equal(meta.inReplyTo, "<m2@mail>");
  assert.equal(meta.references, "<m0@mail> <m1@mail> <m2@mail>");
});

test("deriveReplyMeta: toOverride forces the recipient", () => {
  const meta = deriveReplyMeta(
    {
      payload: {
        headers: [
          { name: "From", value: "bob@example.com" },
          { name: "Subject", value: "Hi" },
        ],
      },
    },
    { toOverride: "carol@example.com" },
  );
  assert.equal(meta.to, "carol@example.com");
});

test("GMAIL_TOOLS registers the new compose tools with required fields", () => {
  const byName = Object.fromEntries(GMAIL_TOOLS.map((t) => [t.name, t]));
  assert.ok(byName.gmail_send_message, "gmail_send_message present");
  assert.ok(byName.gmail_draft_reply, "gmail_draft_reply present");
  assert.deepEqual(byName.gmail_draft_reply.input_schema.required, [
    "thread_id",
    "body",
  ]);
  assert.deepEqual(byName.gmail_send_message.input_schema.required, [
    "to",
    "subject",
    "body",
  ]);
  assert.equal(
    byName.gmail_send_message.input_schema.properties.attachments.type,
    "array",
  );
});

test("executeGmailTool: missing required input fails closed before any network call", async () => {
  // No tenant secrets -> gmailRequest would 401, but validation should reject
  // first with a clear message and never touch the network.
  const reply = await executeGmailTool(
    "gmail_draft_reply",
    { body: "hi" },
    {
      tenant: null,
    },
  );
  assert.equal(reply.error, "thread_id is required");

  const send = await executeGmailTool(
    "gmail_send_message",
    { subject: "x" },
    {
      tenant: null,
    },
  );
  assert.equal(send.error, "to is required");
});
