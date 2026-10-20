import { afterEach, describe, expect, it, vi } from "vitest";
const secrets = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../../../secrets/tenantSecrets", () => ({
  getTenantSecret: secrets.read,
  setTenantSecret: secrets.write,
}));
import { ContinuationRefused, replyInThread, thread } from "../campaign-read";
afterEach(() => vi.unstubAllGlobals());
describe("Clay session isolation", () => {
  it("never reuses one tenant's cached session for another tenant", async () => {
    secrets.read.mockImplementation(
      async (tenant: string) => `${tenant}-session`,
    );
    const cookies: string[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      cookies.push((init.headers as Record<string, string>).cookie);
      return {
        ok: true,
        status: 200,
        headers: { getSetCookie: () => [] },
        json: async () => ({ history: [] }),
      };
    });
    await thread("tenant-a", "1", 2, 3);
    await thread("tenant-b", "4", 5, 6);
    await thread("tenant-a", "1", 2, 3);
    expect(cookies).toEqual([
      "claysession=tenant-a-session; __Host-claysession=tenant-a-session",
      "claysession=tenant-b-session; __Host-claysession=tenant-b-session",
      "claysession=tenant-a-session; __Host-claysession=tenant-a-session",
    ]);
  });
});

describe("Native thread continuation", () => {
  const parent = {
    type: "SENT",
    stats_id: "stats-1",
    message_id: "sent-parent",
    from: "jonah@sender.example",
    to: "investor@fund.example",
    time: "2026-10-15T12:00:00Z",
    email_body: "The answer already sent",
  };
  function provider(history: Array<Record<string, unknown>>, fail = false) {
    secrets.read.mockResolvedValue("native-test-session");
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      const send = url.endsWith("/master-inbox/reply");
      return {
        ok: !(send && fail),
        status: send && fail ? 500 : 200,
        headers: { getSetCookie: () => [] },
        json: async () => (send ? {} : { history }),
      };
    });
    return requests;
  }
  const send = () =>
    replyInThread(
      "zeutara",
      "1372623",
      42,
      7,
      "sent-parent",
      "investor@fund.example",
      "<p>Following up</p>",
    );
  it("targets the exact sent parent using Clay's native reply body", async () => {
    const calls = provider([parent]);
    await send();
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(
      "https://api.clay.com/v3/workspaces/1372623/clay-sequencer/master-inbox/reply",
    );
    expect(calls[1].body).toEqual({
      campaign_id: 42,
      reply_data: {
        email_stats_id: "stats-1",
        email_body: "<p>Following up</p>",
        reply_message_id: "sent-parent",
        reply_email_time: parent.time,
        reply_email_body: parent.email_body,
        add_signature: false,
      },
    });
  });
  it.each(["recipient", "missing stats", "duplicate parent", "new inbound"])(
    "does not send when %s invalidates the parent",
    async (reason) => {
      let history: Array<Record<string, unknown>> = [{ ...parent }];
      if (reason === "recipient") history[0].to = "someone-else@fund.example";
      if (reason === "missing stats") delete history[0].stats_id;
      if (reason === "duplicate parent") history.push({ ...parent });
      if (reason === "new inbound")
        history.push({
          type: "REPLY",
          message_id: "new",
          time: "2026-10-16T12:00:00Z",
        });
      const calls = provider(history);
      await expect(send()).rejects.toThrow();
      expect(calls).toHaveLength(1);
    },
  );
  it("does not retry or fall back after a provider error", async () => {
    const calls = provider([parent], true);
    await expect(send()).rejects.toThrow("Clay answered 500");
    await expect(send()).rejects.not.toBeInstanceOf(ContinuationRefused);
    expect(calls).toHaveLength(4);
  });
  // 2026-10-16: Ethan Austin's "what is the company?" could not be answered;
  // the webhook said "Already replied to this lead" and this path only took
  // our own SENT as a parent.
  const inbound = {
    type: "REPLY",
    stats_id: "stats-2",
    message_id: "inbound-parent",
    from: "investor@fund.example",
    to: "jonah@sender.example",
    time: "2026-10-16T19:17:50Z",
    email_body: "what is the company?",
  };
  const answer = () =>
    replyInThread(
      "zeutara",
      "1372623",
      42,
      7,
      "inbound-parent",
      "investor@fund.example",
      "<p>Answer</p>",
    );
  it("answers the investor's latest inbound reply natively", async () => {
    const calls = provider([parent, inbound]);
    await answer();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({
      campaign_id: 42,
      reply_data: {
        email_stats_id: "stats-2",
        email_body: "<p>Answer</p>",
        reply_message_id: "inbound-parent",
        reply_email_time: inbound.time,
        reply_email_body: inbound.email_body,
        add_signature: false,
      },
    });
  });
  it.each(["another sender", "already answered"])(
    "refuses before sending when %s",
    async (reason) => {
      const history: Array<Record<string, unknown>> = [parent, { ...inbound }];
      if (reason === "another sender") history[1].from = "someone@fund.example";
      if (reason === "already answered")
        history.push({
          ...parent,
          message_id: "later",
          time: "2026-10-16T19:30:00Z",
        });
      const calls = provider(history);
      const refusal = await answer().catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ContinuationRefused);
      // A newer message stops every route; a foreign parent may try the webhook.
      expect((refusal as ContinuationRefused).advanced).toBe(
        reason === "already answered",
      );
      expect(calls).toHaveLength(1);
    },
  );
});
