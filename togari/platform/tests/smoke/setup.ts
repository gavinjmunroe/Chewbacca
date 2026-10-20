/**
 * Smoke test setup — runs before each test file.
 *
 * - Registers vi.mock for @google-cloud/bigquery, @slack/web-api, googleapis
 *   so production code never touches real external services.
 * - Stubs global fetch so we can intercept Anthropic / Google Calendar /
 *   Google OAuth / Fireflies / Slack HTTP API calls by URL.
 * - Exposes shared mutable state on globalThis.__smoke so tests can queue
 *   BigQuery responses, register fetch handlers, and inspect calls made
 *   by production code.
 *
 * Mocks are defined here (not in a helper) so vitest's transform can hoist
 * vi.mock calls correctly. Mock factories access globalThis lazily inside
 * each method so state is populated by the time production code runs.
 */

import { vi, beforeEach } from "vitest";

interface SmokeState {
  bq: {
    queries: Array<{ sql: string; params: Record<string, unknown> }>;
    writes: Array<{ sql: string; params: Record<string, unknown> }>;
    inserts: Array<{ dataset: string; table: string; rows: unknown[] }>;
    queryResponses: unknown[][];
    /** Optional per-write numDmlAffectedRows, consumed in order. Defaults to "1". */
    writeAffectedRows: string[];
  };
  slack: {
    postedMessages: any[];
    scheduledMessages: any[];
    remindersAdded: any[];
    viewsOpened: any[];
  };
  fetch: {
    calls: Array<{ url: string; init?: any }>;
    handlers: Array<{
      match: (url: string, init?: any) => boolean;
      response: (url: string, init?: any) => any;
    }>;
  };
  gmail: {
    sends: any[];
    drafts: any[];
  };
}

(globalThis as any).__smoke = {
  bq: { queries: [], writes: [], inserts: [], queryResponses: [], writeAffectedRows: [] },
  slack: {
    postedMessages: [],
    scheduledMessages: [],
    remindersAdded: [],
    viewsOpened: [],
  },
  fetch: { calls: [], handlers: [] },
  gmail: { sends: [], drafts: [] },
} as SmokeState;

// ── BigQuery mock ─────────────────────────────────────────────────

vi.mock("@google-cloud/bigquery", () => {
  class BigQuery {
    constructor(_opts?: any) {}

    async createQueryJob(opts: any) {
      const s: SmokeState = (globalThis as any).__smoke;
      const sql = String(opts.query);
      const upper = sql.trim().toUpperCase();
      const params = opts.params ?? {};

      if (upper.startsWith("SELECT") || upper.startsWith("WITH")) {
        s.bq.queries.push({ sql, params });
      } else {
        s.bq.writes.push({ sql, params });
      }

      const rows = s.bq.queryResponses.shift() ?? [];
      // Writes report 1 affected row unless a test queued otherwise. Queuing 0
      // is how a compare-and-set that lost (already-claimed row) is simulated.
      // Only consumed by writes, so a SELECT in the same flow doesn't eat it.
      const isWrite = !upper.startsWith("SELECT") && !upper.startsWith("WITH");
      const affected = (isWrite ? s.bq.writeAffectedRows.shift() : undefined) ?? "1";
      const job: any = {
        // Mirrors the real SDK: job.metadata is the job as CREATED and carries
        // no DML statistics. Only the fetched, finished job has them. Keeping
        // the mock honest is what stops "always 0" regressing.
        metadata: { statistics: { query: {} } },
        getMetadata: async () => [
          { statistics: { query: { numDmlAffectedRows: affected } } },
        ],
        getQueryResults: async (_?: any) => [
          rows,
          undefined,
          { schema: { fields: [] } },
        ],
      };
      return [job];
    }

    dataset(name: string) {
      return {
        table: (tableName: string) => ({
          insert: async (rows: unknown[]) => {
            const s: SmokeState = (globalThis as any).__smoke;
            s.bq.inserts.push({ dataset: name, table: tableName, rows });
          },
        }),
      };
    }
  }

  return { BigQuery };
});

// ── Slack mock ────────────────────────────────────────────────────

vi.mock("@slack/web-api", () => {
  class WebClient {
    constructor(_token?: string) {}

    chat = {
      postMessage: async (args: any) => {
        const s: SmokeState = (globalThis as any).__smoke;
        s.slack.postedMessages.push(args);
        return {
          ok: true,
          ts: "1700000000.000100",
          channel: args.channel,
          message: { ts: "1700000000.000100" },
        };
      },
      scheduleMessage: async (args: any) => {
        const s: SmokeState = (globalThis as any).__smoke;
        s.slack.scheduledMessages.push(args);
        return {
          ok: true,
          scheduled_message_id: "sm_123",
          post_at: args.post_at,
          channel: args.channel,
        };
      },
      update: async (args: any) => ({
        ok: true,
        ts: args.ts,
        channel: args.channel,
      }),
      getPermalink: async (args: any) => ({
        ok: true,
        permalink: `https://slack.com/archives/${args.channel}/p${String(args.message_ts).replace(".", "")}`,
      }),
    };

    reminders = {
      add: async (args: any) => {
        const s: SmokeState = (globalThis as any).__smoke;
        s.slack.remindersAdded.push(args);
        return {
          ok: true,
          reminder: {
            id: "R1",
            user: args.user,
            text: args.text,
            time: args.time,
          },
        };
      },
    };

    views = {
      open: async (args: any) => {
        const s: SmokeState = (globalThis as any).__smoke;
        s.slack.viewsOpened.push(args);
        return { ok: true };
      },
    };

    auth = {
      test: async () => ({ ok: true, user_id: "UBOT", bot_id: "BBOT" }),
    };

    users = {
      info: async (args: any) => ({
        ok: true,
        user: {
          id: args.user,
          name: "test",
          profile: { display_name: "Test", real_name: "Test User" },
        },
      }),
    };

    conversations = {
      info: async (args: any) => ({
        ok: true,
        channel: { id: args.channel, name: "test-channel" },
      }),
    };
  }

  return { WebClient };
});

// ── googleapis mock (Gmail + OAuth) ───────────────────────────────

vi.mock("googleapis", () => {
  const gmailClient = {
    users: {
      messages: {
        send: async (args: any) => {
          const s: SmokeState = (globalThis as any).__smoke;
          s.gmail.sends.push(args);
          return { data: { id: "msg_123", threadId: "t1" } };
        },
      },
      drafts: {
        create: async (args: any) => {
          const s: SmokeState = (globalThis as any).__smoke;
          s.gmail.drafts.push(args);
          return {
            data: {
              id: "draft_123",
              message: { id: "msg_123", threadId: "t1" },
            },
          };
        },
      },
    },
  };

  class OAuth2 {
    setCredentials(_c: any) {}
    async getAccessToken() {
      return { token: "fake-access-token" };
    }
  }

  class JWT {
    constructor(_opts?: any) {}
    async authorize() {
      return { access_token: "fake-access-token" };
    }
    async getAccessToken() {
      return { token: "fake-access-token" };
    }
  }

  return {
    google: {
      gmail: () => gmailClient,
      auth: { OAuth2, JWT },
    },
  };
});

// ── Global fetch stub ─────────────────────────────────────────────

function jsonResponse(body: any, status = 200) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status < 300 ? "OK" : "ERR",
    headers: { get: (_: string) => null },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => bodyStr,
  };
}

async function stubbedFetch(
  url: string | URL | Request,
  init?: any,
): Promise<any> {
  const urlStr = typeof url === "string" ? url : (url as any).toString();
  const s: SmokeState = (globalThis as any).__smoke;
  s.fetch.calls.push({ url: urlStr, init });
  for (const h of s.fetch.handlers) {
    if (h.match(urlStr, init)) {
      const resp = h.response(urlStr, init);
      if (resp && typeof resp === "object" && "ok" in resp && "json" in resp)
        return resp;
      return jsonResponse(resp);
    }
  }
  return jsonResponse({ error: "no mock handler for " + urlStr }, 500);
}

vi.stubGlobal("fetch", stubbedFetch);

// ── Env vars expected by production code ─────────────────────────

process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || "test-anthropic-key";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET =
  process.env.SLACK_SIGNING_SECRET || "test-slack-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID =
  process.env.GOOGLE_OAUTH_CLIENT_ID || "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET || "test-client-secret";
process.env.GOOGLE_CALENDAR_REFRESH_TOKEN =
  process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || "test-refresh-token";
process.env.GMAIL_OAUTH_REFRESH_TOKEN =
  process.env.GMAIL_OAUTH_REFRESH_TOKEN || "test-gmail-refresh-token";
process.env.FIREFLIES_API_KEY =
  process.env.FIREFLIES_API_KEY || "test-fireflies-key";
process.env.GCP_CREDENTIALS_BASE64 = process.env.GCP_CREDENTIALS_BASE64 || "";

// ── Reset shared state between tests ─────────────────────────────

beforeEach(() => {
  const s: SmokeState = (globalThis as any).__smoke;
  s.bq.queries.length = 0;
  s.bq.writes.length = 0;
  s.bq.inserts.length = 0;
  s.bq.queryResponses.length = 0;
  s.bq.writeAffectedRows.length = 0;
  s.slack.postedMessages.length = 0;
  s.slack.scheduledMessages.length = 0;
  s.slack.remindersAdded.length = 0;
  s.slack.viewsOpened.length = 0;
  s.fetch.calls.length = 0;
  s.fetch.handlers.length = 0;
  s.gmail.sends.length = 0;
  s.gmail.drafts.length = 0;
});
