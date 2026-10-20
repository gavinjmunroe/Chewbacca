import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn().mockResolvedValue([[{ ok: 1 }]]);
vi.mock("@google-cloud/bigquery", () => ({
  BigQuery: vi.fn().mockImplementation(function () {
    return { query: queryMock };
  }),
}));

describe("bigquery client", () => {
  beforeEach(() => vi.resetModules());

  it("table() builds a fully qualified id", async () => {
    const { table } = await import("./bigquery.js");
    expect(table("pdw", "persons")).toBe(
      "`midyear-glazing-485303-u3.togari_pdw.persons`",
    );
  });

  it("runQuery throws togari_not_configured without credentials", async () => {
    delete process.env.GCP_CREDENTIALS_BASE64;
    delete process.env.GOOGLE_CREDENTIALS_BASE64;
    const { runQuery } = await import("./bigquery.js");
    await expect(runQuery("SELECT 1")).rejects.toThrow("togari_not_configured");
  });

  it("runQuery passes sql and named params through", async () => {
    process.env.GCP_CREDENTIALS_BASE64 = Buffer.from(
      JSON.stringify({ client_email: "t@t", private_key: "k" }),
    ).toString("base64");
    const { runQuery } = await import("./bigquery.js");
    const rows = await runQuery("SELECT @a AS ok", { a: 1 });
    expect(rows).toEqual([{ ok: 1 }]);
    expect(queryMock).toHaveBeenCalledWith({
      query: "SELECT @a AS ok",
      params: { a: 1 },
    });
    delete process.env.GCP_CREDENTIALS_BASE64;
  });
});
