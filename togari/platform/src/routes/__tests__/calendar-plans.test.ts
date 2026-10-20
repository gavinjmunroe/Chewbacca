import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMockState, queueBqWriteAffected } from "../../../tests/smoke/helpers";
import { handleAddPlan, handleRemovePlan } from "../campaign-calendar";

const TOKEN = "c".repeat(40);
const PREV = process.env.DASHBOARD_TOKENS;
beforeAll(() => {
  process.env.DASHBOARD_TOKENS = JSON.stringify({ [TOKEN]: "serif", ["d".repeat(40)]: "amber" });
});
afterAll(() => {
  process.env.DASHBOARD_TOKENS = PREV;
});

function call(
  handler: (req: any, res: any) => Promise<void>,
  opts: { token?: string; body?: unknown; id?: string; json?: boolean },
): Promise<{ status: number; json: any }> {
  return new Promise((resolve) => {
    let status = 200;
    const res: any = {
      setHeader() { return this; },
      status(c: number) { status = c; return this; },
      json(j: any) { resolve({ status, json: j }); return this; },
    };
    const req: any = {
      params: { token: opts.token ?? TOKEN, id: opts.id },
      body: opts.body,
      is: () => opts.json !== false,
    };
    handler(req, res);
  });
}

const writes = () => getMockState().bq.writes.filter((w: any) => w.sql.includes("calendar_plans"));

describe("conferences from the calendar page", () => {
  it("adds one for the link's client", async () => {
    const res = await call(handleAddPlan, { body: { name: "HFMA Region 4", start: "2026-10-26", end: "2026-11-06" } });
    expect(res.status).toBe(201);
    expect(writes()[0].sql).toMatch(/^INSERT INTO/);
    expect(writes()[0].params).toMatchObject({ clientId: "serif", name: "HFMA Region 4", start: "2026-10-26", end: "2026-11-06" });
  });

  it("explains a bad form instead of saving it", async () => {
    const res = await call(handleAddPlan, { body: { name: "X", start: "2026-11-06", end: "2026-10-26" } });
    expect(res).toEqual({ status: 400, json: { error: "The end date is before the start date." } });
    expect(writes()).toHaveLength(0);
  });

  it("refuses an unknown link, a client without a calendar, and anything but JSON", async () => {
    expect((await call(handleAddPlan, { token: "e".repeat(40), body: {} })).status).toBe(404);
    expect((await call(handleAddPlan, { token: "d".repeat(40), body: {} })).status).toBe(404);
    expect((await call(handleAddPlan, { body: {}, json: false })).status).toBe(415);
    expect(writes()).toHaveLength(0);
  });

  it("removes one only for its own client", async () => {
    const id = "0b8f6a2e-4a52-4b39-9d4e-1f7f0f1f2a3b";
    const res = await call(handleRemovePlan, { id, body: {} });
    expect(res).toEqual({ status: 200, json: { removed: true } });
    expect(writes()[0].sql).toMatch(/^UPDATE/);
    expect(writes()[0].params).toEqual({ clientId: "serif", id });
    queueBqWriteAffected(0);
    expect((await call(handleRemovePlan, { id, body: {} })).status).toBe(404);
    expect((await call(handleRemovePlan, { id: "not-a-uuid", body: {} })).status).toBe(404);
  });
});
