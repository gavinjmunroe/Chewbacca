import { describe, it, expect, beforeEach } from "vitest";
import { onFetch, getMockState } from "../../../../tests/smoke/helpers";
import { pushRowsToClayTable, enrichViaClay } from "../client";

const WEBHOOK = "https://api.clay.com/v3/sources/webhook/tbl_test";

describe("pushRowsToClayTable", () => {
  beforeEach(() => {
    delete process.env.CLAY_API_KEY;
    delete process.env.CLAY_OUTBOUND_MAX_ROWS;
  });

  it("pushes each row and reports counts", async () => {
    onFetch(WEBHOOK, { ok: true });
    const rows = [{ email: "a@x.com" }, { email: "b@x.com" }];
    const result = await pushRowsToClayTable(WEBHOOK, rows);

    expect(result.pushed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.received).toBe(2);
    expect(result.truncated).toBe(false);

    const calls = getMockState().fetch.calls;
    expect(calls.length).toBe(2);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ email: "a@x.com" });
  });

  it("captures per-row failures without throwing", async () => {
    onFetch(WEBHOOK, (_url, init) => {
      const body = JSON.parse(init.body);
      // Fail exactly the second row.
      return body.email === "b@x.com"
        ? {
            ok: false,
            status: 422,
            statusText: "Unprocessable",
            text: async () => "bad",
            json: async () => ({}),
          }
        : {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => "",
            json: async () => ({}),
          };
    });

    const result = await pushRowsToClayTable(
      WEBHOOK,
      [{ email: "a@x.com" }, { email: "b@x.com" }],
      { concurrency: 1 },
    );
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("422");
  });

  it("truncates beyond the outbound cap", async () => {
    onFetch(WEBHOOK, { ok: true });
    const rows = Array.from({ length: 5 }, (_, i) => ({ n: i }));
    const result = await pushRowsToClayTable(WEBHOOK, rows, { maxRows: 3 });
    expect(result.received).toBe(5);
    expect(result.pushed).toBe(3);
    expect(result.truncated).toBe(true);
    expect(getMockState().fetch.calls.length).toBe(3);
  });

  it("sends CLAY_API_KEY as a Bearer token when set", async () => {
    process.env.CLAY_API_KEY = "secret-key";
    onFetch(WEBHOOK, { ok: true });
    await pushRowsToClayTable(WEBHOOK, [{ email: "a@x.com" }]);
    const call = getMockState().fetch.calls[0];
    expect(call.init.headers.Authorization).toBe("Bearer secret-key");
  });
});

describe("enrichViaClay", () => {
  it("pushes records and returns an async note", async () => {
    onFetch(WEBHOOK, { ok: true });
    const result = await enrichViaClay(WEBHOOK, [{ email: "a@x.com" }]);
    expect(result.pushed).toBe(1);
    expect(result.note).toContain("asynchronously");
  });
});
