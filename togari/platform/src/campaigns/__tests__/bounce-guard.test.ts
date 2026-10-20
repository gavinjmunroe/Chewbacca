import { describe, expect, it, vi } from "vitest";
vi.mock("../recovery-window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../recovery-window")>()),
  readRecoveryWindows: vi.fn().mockResolvedValue([]),
}));
import { checkBounceGuard, overBounceLimit } from "../bounce-guard";
import { parseRecoveryWindows, type RecoveryWindow } from "../recovery-window";
import type { CampaignStat } from "../../integrations/clay/campaign-read";

const campaign = (
  id: string,
  bounces: number,
  sent: number,
  status = "active",
): CampaignStat => ({
  id,
  name: `Zeutara | ${id}`,
  status,
  leads: sent,
  sent,
  replies: 0,
  bounces,
});

describe("Zeutara bounce guard", () => {
  const window: RecoveryWindow = {
    campaignId: "cam_high",
    workspaceId: "1372623",
    startedAt: "2026-10-15T00:00:00.000Z",
    baselineSent: 32,
    baselineBounces: 2,
    verifiedRepairSha256: "a".repeat(64),
  };

  it("uses new sends after repair while leaving lifetime counters intact", () => {
    const repaired = campaign("cam_high", 2, 42);
    expect(overBounceLimit([repaired], [window], window.workspaceId)).toEqual(
      [],
    );
    expect(repaired).toMatchObject({ sent: 42, bounces: 2 });
    expect(
      overBounceLimit([repaired], [window], "different-workspace"),
    ).toEqual([repaired]);
  });

  it("pauses on a new bounce with no new sends and on counter rollback", () => {
    for (const item of [
      campaign("cam_high", 3, 32),
      campaign("cam_high", 1, 32),
      campaign("cam_high", 2, 31),
      campaign("cam_high", 3, 42),
    ]) {
      expect(overBounceLimit([item], [window], window.workspaceId)).toEqual([
        item,
      ]);
    }
    expect(
      overBounceLimit(
        [campaign("cam_high", 5, 132)],
        [window],
        window.workspaceId,
      ),
    ).toEqual([]);
  });

  it("rejects duplicate, future and unverified recovery evidence", () => {
    expect(() =>
      parseRecoveryWindows(JSON.stringify([window, window])),
    ).toThrow();
    expect(() =>
      parseRecoveryWindows(
        JSON.stringify([{ ...window, startedAt: "2999-01-01T00:00:00Z" }]),
      ),
    ).toThrow();
    expect(() =>
      parseRecoveryWindows(
        JSON.stringify([{ ...window, verifiedRepairSha256: "" }]),
      ),
    ).toThrow();
  });

  it("falls back to the lifetime guard if recovery storage fails", async () => {
    let paused = false;
    const read = async () => [
      campaign("cam_high", 2, 32, paused ? "paused" : "active"),
    ];
    const pause = async () => {
      paused = true;
    };
    expect(
      await checkBounceGuard("zeutara", read, pause, async () => {
        throw new Error("unavailable");
      }),
    ).toEqual(["cam_high"]);
  });
  it("pauses only active campaigns strictly above 3%", () => {
    expect(
      overBounceLimit([
        campaign("cam_high", 2, 32),
        campaign("cam_equal", 3, 100),
        campaign("cam_paused", 2, 32, "paused"),
        campaign("cam_empty", 0, 0),
        { ...campaign("cam_other", 2, 32), name: "Other client" },
      ]).map((item) => item.id),
    ).toEqual(["cam_high"]);
  });

  it("checks Clay again before reporting a pause", async () => {
    const calls: string[] = [];
    let paused = false;
    const read = async () => [
      campaign("cam_high", 2, 32, paused ? "paused" : "active"),
    ];
    const pause = async (_tenant: string, _workspace: string, id: string) => {
      calls.push(id);
      paused = true;
    };
    expect(await checkBounceGuard("zeutara", read, pause)).toEqual([
      "cam_high",
    ]);
    expect(calls).toEqual(["cam_high"]);
  });

  it("fails when Clay still reports an active campaign", async () => {
    const read = async () => [campaign("cam_high", 2, 32)];
    const pause = async () => undefined;
    await expect(checkBounceGuard("zeutara", read, pause)).rejects.toThrow(
      "Clay did not confirm pause",
    );
  });

  it("attempts every risky campaign even if one pause fails", async () => {
    const attempted: string[] = [];
    const read = async () => [
      campaign("cam_one", 2, 32),
      campaign("cam_two", 2, 41),
    ];
    const pause = async (_tenant: string, _workspace: string, id: string) => {
      attempted.push(id);
      if (id === "cam_one") throw new Error("Clay unavailable");
    };
    await expect(checkBounceGuard("zeutara", read, pause)).rejects.toThrow();
    expect(attempted.sort()).toEqual(["cam_one", "cam_two"]);
  });
});
