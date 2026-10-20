import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as replyStore from "../../replies/store";
import * as sender from "../../agents/smartlead-responder/slack-actions";
import { ReplyDeliveryUnknown } from "../../replies/delivery";
import {
  queueBqRows,
  getMockState,
  onFetch,
  queueBqWriteAffected,
} from "../../../tests/smoke/helpers";
import { createRepliesRouter } from "../replies";
import { replyItemId } from "../../replies/store";

const TOKEN = "test-replies-token";
const RESULT_TOKEN = "test-result-token";
const PREV_TOKEN = process.env.REPLIES_INGEST_TOKEN;

process.env.REPLIES_INGEST_TOKEN = TOKEN;
process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
// A reply must say which client it belongs to. The sample payload carries no
// client_id, standing in for a Clay column that has not been updated yet, so
// the fallback is what keeps these cases exercising the path under test.
process.env.REPLIES_DEFAULT_CLIENT_ID = "serif_test";
afterAll(() => {
  process.env.REPLIES_INGEST_TOKEN = PREV_TOKEN;
});

/** The exact payload from section 6 of the implementation plan. */
const PAYLOAD = {
  row_id: "clay_row_8f3a91",
  campaign: "q3-outbound-emea",
  thread_id: "thread-abc",
  from: "someone@prospect.com",
  sender_account: "outreach03@client.com",
  subject: "Re: quick question",
  body: "Interesting, can you send pricing?",
  received_at: "2026-09-11T02:14:02Z",
  lead_name: "Dana Whitfield",
  lead_title: "VP Operations",
  lead_company: "Prospect Co",
};

function invoke(
  router: ReturnType<typeof createRepliesRouter>,
  body: unknown,
  // null means "send no Authorization header at all". Not undefined: that
  // would fall back to the default value and silently authenticate.
  authHeader: string | null = `Bearer ${TOKEN}`,
  path = "/",
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body));
    let dataEmitted = false;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": String(raw.length),
    };
    if (authHeader) headers.authorization = authHeader;

    const req: any = {
      method: "POST",
      url: path,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers,
      header(name: string) {
        return this.headers[name.toLowerCase()];
      },
      on(event: string, cb: (chunk?: any) => void) {
        if (event === "data" && !dataEmitted) {
          dataEmitted = true;
          cb(raw);
        }
        if (event === "end") cb();
        return this;
      },
      once() {
        return this;
      },
      removeListener() {
        return this;
      },
      pipe() {
        return this;
      },
      unpipe() {
        return this;
      },
      resume() {
        return this;
      },
      setEncoding() {
        return this;
      },
    };

    let statusCode = 200;
    const res: any = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      set() {
        return this;
      },
      setHeader() {
        return this;
      },
      getHeader() {
        return undefined;
      },
      json(payload: any) {
        this.headersSent = true;
        resolve({ status: statusCode, json: payload });
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: statusCode, json: undefined });
        return this;
      },
    };

    (router as any).handle(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve({ status: statusCode, json: undefined });
    });
  });
}

describe("POST /replies — auth", () => {
  beforeEach(() => {
    process.env.REPLIES_INGEST_TOKEN = TOKEN;
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await invoke(createRepliesRouter(), PAYLOAD, null);
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("unauthorized");
  });

  it("rejects a wrong token", async () => {
    const res = await invoke(createRepliesRouter(), PAYLOAD, "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("fails closed when no token is configured", async () => {
    delete process.env.REPLIES_INGEST_TOKEN;
    const res = await invoke(createRepliesRouter(), PAYLOAD);
    expect(res.status).toBe(500);
  });

  it("accepts any token in a comma-separated rotation list", async () => {
    process.env.REPLIES_INGEST_TOKEN = `old-token, ${TOKEN}`;
    queueBqRows([]); // no existing row
    const res = await invoke(
      createRepliesRouter(),
      PAYLOAD,
      "Bearer old-token",
    );
    expect(res.status).toBe(201);
  });
});

describe("POST /replies — validation", () => {
  beforeEach(() => {
    process.env.REPLIES_INGEST_TOKEN = TOKEN;
  });

  it("rejects a missing row_id and saves nothing", async () => {
    const { row_id, ...noRowId } = PAYLOAD;
    const before = getMockState().bq.writes.length;
    const res = await invoke(createRepliesRouter(), noRowId);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_payload");
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("rejects a missing body and saves nothing", async () => {
    const { body, ...noBody } = PAYLOAD;
    const before = getMockState().bq.writes.length;
    const res = await invoke(createRepliesRouter(), noBody);
    expect(res.status).toBe(400);
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("treats an empty body as missing", async () => {
    const res = await invoke(createRepliesRouter(), {
      ...PAYLOAD,
      body: "   ",
    });
    expect(res.status).toBe(400);
  });

  it("coerces a numeric row_id rather than dropping the reply", async () => {
    queueBqRows([]);
    const res = await invoke(createRepliesRouter(), {
      ...PAYLOAD,
      row_id: 8391,
    });
    expect(res.status).toBe(201);
    expect(res.json.row_id).toBe("8391");
    expect(getMockState().bq.writes.at(-1).params.rowId).toBe("8391");
  });
});

describe("POST /replies — queueing", () => {
  beforeEach(() => {
    process.env.REPLIES_INGEST_TOKEN = TOKEN;
  });

  it("queues a new reply with 201 and maps every wire field", async () => {
    queueBqRows([]); // lookup finds nothing
    const res = await invoke(createRepliesRouter(), PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      id: replyItemId(PAYLOAD.row_id),
      row_id: PAYLOAD.row_id,
      state: "queued",
      duplicate: false,
    });

    const write = getMockState().bq.writes.at(-1);
    // No WHEN MATCHED branch: a repeat POST must never overwrite a live row.
    expect(write.sql).toContain("WHEN NOT MATCHED THEN INSERT");
    expect(write.sql).not.toContain("WHEN MATCHED");
    expect(write.sql).toContain("'queued'");
    // thread_id -> email_thread_id, from -> from_address.
    expect(write.params).toMatchObject({
      rowId: PAYLOAD.row_id,
      campaign: PAYLOAD.campaign,
      emailThreadId: PAYLOAD.thread_id,
      fromAddress: PAYLOAD.from,
      senderAccount: PAYLOAD.sender_account,
      subject: PAYLOAD.subject,
      body: PAYLOAD.body,
      receivedAt: PAYLOAD.received_at,
      leadName: PAYLOAD.lead_name,
      leadTitle: PAYLOAD.lead_title,
      leadCompany: PAYLOAD.lead_company,
    });
    // Comes from the payload's client_id, or the configured fallback — never
    // guessed. PAYLOAD carries none, so the fallback applies here.
    expect(write.params.clientId).toBe("serif_test");
  });

  it("returns 200 duplicate and writes nothing when row_id already exists", async () => {
    queueBqRows([
      {
        id: replyItemId(PAYLOAD.row_id),
        row_id: PAYLOAD.row_id,
        state: "dispatched",
      },
    ]);
    const before = getMockState().bq.writes.length;
    const res = await invoke(createRepliesRouter(), PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: replyItemId(PAYLOAD.row_id),
      row_id: PAYLOAD.row_id,
      duplicate: true,
    });
    // The row was mid-flight; the resend must not have touched it.
    expect(res.json.state).toBe("dispatched");
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("gives the same id on the 201 and the follow-up 200", async () => {
    queueBqRows([]);
    const first = await invoke(createRepliesRouter(), PAYLOAD);
    queueBqRows([
      { id: first.json.id, row_id: PAYLOAD.row_id, state: "queued" },
    ]);
    const second = await invoke(createRepliesRouter(), PAYLOAD);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json.id).toBe(first.json.id);
  });

  it("honours an explicit client_id over the default", async () => {
    queueBqRows([]);
    await invoke(createRepliesRouter(), { ...PAYLOAD, client_id: "bma" });
    expect(getMockState().bq.writes.at(-1).params.clientId).toBe("bma");
  });
});

// ── Step 04: the result callback ──────────────────────────────────

const QUEUED_ROW = {
  id: replyItemId(PAYLOAD.row_id),
  row_id: PAYLOAD.row_id,
  state: "dispatched",
  client_id: "serif",
  campaign: PAYLOAD.campaign,
  email_thread_id: PAYLOAD.thread_id,
  from_address: PAYLOAD.from,
  sender_account: PAYLOAD.sender_account,
  subject: PAYLOAD.subject,
  body: PAYLOAD.body,
  lead_id: 4242,
  campaign_id: 99,
  lead_name: PAYLOAD.lead_name,
  lead_title: PAYLOAD.lead_title,
  lead_company: PAYLOAD.lead_company,
};

const RESULT = {
  row_id: PAYLOAD.row_id,
  category: "positive",
  confidence: 0.71,
  draft: "Happy to help. Pricing depends on seat count.",
  reasoning: "Asks about pricing.",
  session_ref: "pplx_cmp_2f81",
};

function invokeResult(
  body: unknown,
  authHeader: string | null = `Bearer ${RESULT_TOKEN}`,
) {
  return invoke(createRepliesRouter(), body, authHeader, "/result");
}

/** Slack cards go out over fetch, not the Slack SDK client. */
function slackCards() {
  return getMockState().fetch.calls.filter((c: any) =>
    String(c.url).includes("chat.postMessage"),
  );
}

describe("POST /replies/result", () => {
  it("retains delivery repair even if a racing model callback calls it negative", async () => {
    queueBqRows([
      {
        ...QUEUED_ROW,
        body: "Delivery failure. Your message wasn't delivered to referral@example.com",
      },
    ]);
    const res = await invokeResult({
      row_id: PAYLOAD.row_id,
      category: "negative",
      confidence: 0.9,
      reasoning: "Automated bounce",
    });
    expect(res.json.state).toBe("awaiting_review");
    expect(
      getMockState().bq.writes.some((write: { sql: string }) =>
        /^DELETE FROM/.test(write.sql),
      ),
    ).toBe(false);
    expect(slackCards()).toHaveLength(0);
  });
  it("does not release another callback's processing claim after a failed lookup", async () => {
    const lookup = vi
      .spyOn(replyStore, "getReplyItem")
      .mockRejectedValue(new Error("database down"));
    const finish = vi.spyOn(replyStore, "finishReplyResult");
    try {
      expect((await invokeResult(RESULT)).status).toBe(500);
      expect(finish).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      finish.mockRestore();
    }
  });

  it("gives feeder and poller copies one identity while preserving later replies", () => {
    const p = { ...PAYLOAD, campaign_id: 42, lead_id: 7 };
    const first = replyStore.inboundReplyId("zeutara", p);
    expect(
      replyStore.inboundReplyId("zeutara", {
        ...p,
        row_id: "inbound-message-id",
      }),
    ).toBe(first);
    expect(
      replyStore.inboundReplyId("zeutara", {
        ...p,
        received_at: "2026-09-11T02:15:02Z",
      }),
    ).not.toBe(first);
    expect(replyStore.inboundReplyId("other", p)).not.toBe(first);
  });
  it("accepts a valid late callback after the draft task timed out", async () => {
    queueBqRows([{ ...QUEUED_ROW, state: "failed" }]);
    const res = await invokeResult(RESULT);
    expect(res.json.state).toBe("awaiting_review");
    const claim = getMockState().bq.writes.find((w: { sql: string }) =>
      w.sql.includes("SET state = 'processing'"),
    );
    expect(claim.sql).toContain("'failed'");
  });
  beforeEach(() => {
    process.env.REPLIES_INGEST_TOKEN = TOKEN;
    process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
    onFetch("chat.postMessage", { ok: true, ts: "1700000000.000100" });
  });

  it("rejects the intake token — the two callers are separate", async () => {
    const res = await invokeResult(RESULT, `Bearer ${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("404s an unknown row_id without writing", async () => {
    queueBqRows([]);
    const before = getMockState().bq.writes.length;
    const res = await invokeResult(RESULT);
    expect(res.status).toBe(404);
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("saves the verdict, claims the row, and posts one Slack card", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult(RESULT);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      row_id: PAYLOAD.row_id,
      state: "awaiting_review",
    });

    // Claim is a compare-and-set that cannot re-claim a done row.
    const write = getMockState().bq.writes.find((w: { sql: string }) =>
      w.sql.includes("SET state = 'processing'"),
    );
    expect(write.sql).toContain(
      "state IN ('queued', 'dispatching', 'dispatched', 'failed', 'needs_draft')",
    );
    expect(write.params).toMatchObject({
      rowId: PAYLOAD.row_id,
      category: "positive",
      confidence: "0.71",
      draft: RESULT.draft,
      reasoning: RESULT.reasoning,
      sessionRef: RESULT.session_ref,
    });

    expect(slackCards()).toHaveLength(1);
  });

  it("keeps an empty draft unresolved instead of completing it", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult({ ...RESULT, draft: "" });
    expect(res.json.state).toBe("needs_draft");
    expect(
      getMockState().bq.writes.some(
        (w: { params: { state?: string } }) => w.params.state === "needs_draft",
      ),
    ).toBe(true);
    expect(slackCards()).toHaveLength(0);
  });

  it("posts review work when saving the outgoing draft fails before transport", async () => {
    queueBqRows([{ ...QUEUED_ROW, client_id: "zeutara" }]);
    const save = vi
      .spyOn(replyStore, "saveExpectedReply")
      .mockRejectedValue(new Error("database down"));
    const send = vi.spyOn(sender, "sendReplyEmail");
    try {
      const res = await invokeResult(RESULT);
      expect(send).not.toHaveBeenCalled();
      expect(res.json.state).toBe("awaiting_review");
      expect(slackCards().length).toBeGreaterThan(0);
    } finally {
      save.mockRestore();
      send.mockRestore();
    }
  });

  it("holds an uncertain transport without posting an actionable resend card", async () => {
    queueBqRows([{ ...QUEUED_ROW, client_id: "zeutara" }]);
    const send = vi
      .spyOn(sender, "sendReplyEmail")
      .mockRejectedValue(new ReplyDeliveryUnknown("receipt only"));
    try {
      const res = await invokeResult(RESULT);
      expect(send).toHaveBeenCalledOnce();
      expect(res.status).toBe(202);
      expect(res.json.state).toBe("delivery_unknown");
      expect(slackCards()).toHaveLength(0);
    } finally {
      send.mockRestore();
    }
  });

  it("does not complete a row when posting the card fails", async () => {
    queueBqRows([QUEUED_ROW]);
    // Most recent handlers are tried last; replace the default success.
    getMockState().fetch.handlers.length = 0;
    onFetch("chat.postMessage", { ok: false, error: "channel_not_found" });
    const res = await invokeResult(RESULT);
    expect(res.status).toBe(500);
    expect(
      getMockState().bq.writes.some(
        (w: { params: { state?: string } }) => w.params.state === "needs_draft",
      ),
    ).toBe(true);
    expect(
      getMockState().bq.writes.some(
        (w: { params: { state?: string } }) => w.params.state === "done",
      ),
    ).toBe(false);
  });

  it("posts no second card when the row was already claimed", async () => {
    queueBqRows([{ ...QUEUED_ROW, state: "done" }]);
    queueBqWriteAffected(0); // compare-and-set matched nothing: already done
    const res = await invokeResult(RESULT);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ duplicate: true, state: "done" });
    expect(slackCards()).toHaveLength(0);
  });

  it("discards a negative outright — no card, and the row is deleted", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult({
      row_id: PAYLOAD.row_id,
      category: "negative",
      confidence: 0.9,
      reasoning: "Said they are not interested.",
    });

    expect(res.status).toBe(200);
    expect(res.json.state).toBe("discarded");
    expect(slackCards()).toHaveLength(0);

    const write = getMockState().bq.writes.at(-1);
    expect(write.sql).toMatch(/^DELETE FROM/);
    expect(write.params.rowId).toBe(PAYLOAD.row_id);

    // The Claude fallthrough would have gone out over fetch to Anthropic.
    const anthropicCalls = getMockState().fetch.calls.filter((c: any) =>
      String(c.url).includes("api.anthropic.com"),
    );
    expect(anthropicCalls).toHaveLength(0);
  });

  it("carries lead_id and campaign_id through to the card", async () => {
    queueBqRows([QUEUED_ROW]);
    await invokeResult(RESULT);
    const serialized = JSON.stringify(slackCards().at(-1));
    expect(serialized).toContain("4242");
    expect(serialized).toContain("99");
  });

  it("fills the card's Name / Title / Company line from the row", async () => {
    queueBqRows([QUEUED_ROW]);
    await invokeResult(RESULT);
    const serialized = JSON.stringify(slackCards().at(-1));
    expect(serialized).toContain("Dana Whitfield");
    expect(serialized).toContain("VP Operations");
    expect(serialized).toContain("Prospect Co");
  });
});

describe("test-channel routing", () => {
  it("posts serif_test cards to the test channel, not Serif's real one", async () => {
    process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
    onFetch("chat.postMessage", { ok: true, ts: "1700000000.000100" });
    queueBqRows([{ ...QUEUED_ROW, client_id: "serif_test" }]);

    await invokeResult(RESULT);

    const body = JSON.parse(slackCards().at(-1).init.body);
    expect(body.channel).toBe("C0C14UKEEUR");
    expect(body.channel).not.toBe("C0BAL9JV0E5");
  });

  it("routes a serif row to Serif's live replies channel", async () => {
    process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
    onFetch("chat.postMessage", { ok: true, ts: "1700000000.000100" });
    queueBqRows([{ ...QUEUED_ROW, client_id: "serif" }]);

    await invokeResult(RESULT);

    const body = JSON.parse(slackCards().at(-1).init.body);
    // Replies have their own channel now; C0BAL9JV0E5 is form fills only.
    expect(body.channel).toBe("C0C272SGCLD");
    expect(body.channel).not.toBe("C0C14UKEEUR");
  });
});

describe("result payload aliases", () => {
  beforeEach(() => {
    process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
    onFetch("chat.postMessage", { ok: true, ts: "1700000000.000100" });
  });

  it("accepts draft_body/reason/sentiment — a live run lost a draft to this", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult({
      row_id: PAYLOAD.row_id,
      sentiment: "needs_review",
      confidence: 0.95,
      draft_body: "Happy to pick this up when you're back.",
      reason: "Out-of-office with no interest signal.",
    });

    expect(res.status).toBe(200);
    const write = getMockState().bq.writes.find((w: { sql: string }) =>
      w.sql.includes("SET state = 'processing'"),
    );
    expect(write.params).toMatchObject({
      category: "needs_review",
      draft: "Happy to pick this up when you're back.",
      reasoning: "Out-of-office with no interest signal.",
    });
  });

  it("still rejects a payload with no category under any name", async () => {
    const res = await invokeResult({ row_id: PAYLOAD.row_id, draft: "x" });
    expect(res.status).toBe(400);
  });
});

describe("deleting an answered reply", () => {
  it("deletes by the Message-ID the card already carries", async () => {
    const { deleteReplyByThread } = await import("../../replies/store");
    queueBqWriteAffected(1);
    const deleted = await deleteReplyByThread("<m1@test>");

    expect(deleted).toBe(1);
    const write = getMockState().bq.writes.at(-1);
    expect(write.sql).toMatch(/^DELETE FROM/);
    expect(write.sql).toContain("WHERE email_thread_id = @inReplyTo");
    expect(write.params.inReplyTo).toBe("<m1@test>");
  });

  it("refuses an empty key rather than issuing an unkeyed delete", async () => {
    const { deleteReplyByThread } = await import("../../replies/store");
    const before = getMockState().bq.writes.length;
    expect(await deleteReplyByThread("   ")).toBe(0);
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("is on by default and switchable off", async () => {
    const { deleteAfterSendEnabled } = await import("../../replies/store");
    expect(deleteAfterSendEnabled()).toBe(true);
    process.env.REPLIES_DELETE_AFTER_SEND = "false";
    expect(deleteAfterSendEnabled()).toBe(false);
    delete process.env.REPLIES_DELETE_AFTER_SEND;
  });
});

describe("cards only when there is something to approve", () => {
  beforeEach(() => {
    process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
    onFetch("chat.postMessage", { ok: true, ts: "1700000000.000100" });
  });

  it("posts no card for a verdict with no draft, but still records it", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult({
      row_id: PAYLOAD.row_id,
      category: "needs_review",
      confidence: 0.95,
      reasoning: "Out-of-office auto-reply, nothing to answer.",
    });

    expect(res.status).toBe(200);
    expect(res.json.card_posted).toBe(false);
    expect(slackCards()).toHaveLength(0);
    // The classification is still saved — only the Slack post is skipped.
    expect(
      getMockState().bq.writes.find((w: { sql: string }) =>
        w.sql.includes("SET state = 'processing'"),
      ).params,
    ).toMatchObject({
      category: "needs_review",
    });
  });

  it("still posts when there is a draft", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult(RESULT);
    expect(res.status).toBe(200);
    expect(slackCards()).toHaveLength(1);
  });
});

describe("needs_review must carry a draft", () => {
  beforeEach(() => {
    process.env.REPLY_RESULT_TOKEN = RESULT_TOKEN;
    onFetch("chat.postMessage", { ok: true, ts: "1700000000.000100" });
  });

  it("posts a card for needs_review when it has one", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult({
      row_id: PAYLOAD.row_id,
      category: "needs_review",
      confidence: 0.6,
      draft: "Happy to pick this up when you're back at your desk.",
      reasoning: "Out-of-office; worth a note after their return date.",
    });

    expect(res.status).toBe(200);
    expect(slackCards()).toHaveLength(1);
  });

  it("keeps a draftless needs_review row so the miss is visible", async () => {
    queueBqRows([QUEUED_ROW]);
    const res = await invokeResult({
      row_id: PAYLOAD.row_id,
      category: "needs_review",
      confidence: 0.6,
      reasoning: "No draft written.",
    });

    expect(res.json.card_posted).toBe(false);
    // Not deleted — only negatives are discarded. A draftless needs_review is
    // the model failing to follow the guide, and deleting it would hide that.
    const writes = getMockState()
      .bq.writes.map((w: any) => w.sql)
      .join(" ");
    expect(writes).not.toMatch(/DELETE FROM/);
  });
});

describe("which client a reply belongs to", () => {
  const PREV = process.env.REPLIES_DEFAULT_CLIENT_ID;
  beforeEach(() => {
    process.env.REPLIES_INGEST_TOKEN = TOKEN;
    process.env.REPLIES_DEFAULT_CLIENT_ID = "serif_test";
  });
  afterAll(() => {
    if (PREV === undefined) delete process.env.REPLIES_DEFAULT_CLIENT_ID;
    else process.env.REPLIES_DEFAULT_CLIENT_ID = PREV;
  });

  it("takes the client from the payload — how a second client works at all", async () => {
    queueBqRows([]);
    await invoke(createRepliesRouter(), { ...PAYLOAD, client_id: "amber" });
    expect(getMockState().bq.writes.at(-1).params.clientId).toBe("amber");
  });

  it("refuses an unknown client rather than misattributing the reply", async () => {
    const before = getMockState().bq.writes.length;
    const res = await invoke(createRepliesRouter(), {
      ...PAYLOAD,
      client_id: "srif",
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("unknown_client_id");
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("refuses a reply with no client and no fallback configured", async () => {
    delete process.env.REPLIES_DEFAULT_CLIENT_ID;
    try {
      const res = await invoke(createRepliesRouter(), PAYLOAD);
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("client_id_required");
    } finally {
      process.env.REPLIES_DEFAULT_CLIENT_ID = "serif_test";
    }
  });
});
