import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("../../bigquery/client", () => ({
  BigQueryClient: class {
    executeWrite = mocks.write;
  },
}));
import { withReplySendClaim } from "../send-claim";
import { ReplyPreflightError, ReplyDeliveryUnknown } from "../delivery";

beforeEach(() => {
  mocks.write.mockReset();
  mocks.write.mockResolvedValue({ numDmlAffectedRows: "1" });
});

describe("shared reply send claim", () => {
  it("classifies acquisition failure before any delivery as preflight", async () => {
    mocks.write.mockRejectedValueOnce(new Error("warehouse unavailable"));
    const work = vi.fn(async () => {});
    await expect(withReplySendClaim("zeutara", work)).rejects.toBeInstanceOf(
      ReplyPreflightError,
    );
    expect(work).not.toHaveBeenCalled();
  });
  it("permits one overlapping sender and refuses the other before delivery", async () => {
    mocks.write
      .mockResolvedValueOnce({ numDmlAffectedRows: "1" })
      .mockResolvedValueOnce({ numDmlAffectedRows: "0" });
    let finish: () => void = () => {
      throw new Error("Send barrier was not initialized");
    };
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = vi.fn(() => held);
    const second = vi.fn(async () => {});
    const pending = withReplySendClaim("zeutara", first);
    await expect(withReplySendClaim("zeutara", second)).rejects.toBeInstanceOf(
      ReplyPreflightError,
    );
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(mocks.write.mock.calls[0][0]).toContain("SELECT COUNT(*)");
    finish();
    await pending;
    expect(mocks.write.mock.calls.at(-1)?.[0]).toContain("holder = @holder");
  });

  it("refuses an absent or duplicate lease row", async () => {
    for (const count of ["0", "2"]) {
      mocks.write.mockResolvedValueOnce({ numDmlAffectedRows: count });
      const work = vi.fn(async () => {});
      await expect(withReplySendClaim("zeutara", work)).rejects.toBeInstanceOf(
        ReplyPreflightError,
      );
      expect(work).not.toHaveBeenCalled();
    }
  });

  it("retains the lease for an uncertain delivery", async () => {
    await expect(
      withReplySendClaim("zeutara", async () => {
        throw new ReplyDeliveryUnknown("pending receipt");
      }),
    ).rejects.toBeInstanceOf(ReplyDeliveryUnknown);
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it("releases a proven preflight failure using its own claim identity", async () => {
    await expect(
      withReplySendClaim("zeutara", async () => {
        throw new ReplyPreflightError("no send attempted");
      }),
    ).rejects.toBeInstanceOf(ReplyPreflightError);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.write.mock.calls[1][1].holder).toBe(
      mocks.write.mock.calls[0][1].holder,
    );
  });
});
