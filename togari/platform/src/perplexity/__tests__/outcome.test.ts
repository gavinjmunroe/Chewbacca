import { describe, it, expect } from "vitest";
import { classifyOutcome, shouldHalt, isTerminalFailure, outcomeAlert } from "../outcome";

describe("classifyOutcome — step 07's table", () => {
  it("reads event when task_state is absent, which is the common real shape", () => {
    // Measured: a finished call returned {thread_id, event, text} only.
    expect(classifyOutcome({ event: "complete" })).toBe("complete");
  });

  it("reads task_state when that is the one present", () => {
    expect(classifyOutcome({ task_state: "complete" })).toBe("complete");
  });

  it.each(["waiting", "sleep", "timeout", "running"])(
    "treats %s as still working, not an error",
    (state) => {
      expect(classifyOutcome({ task_state: state })).toBe("working");
    },
  );

  it("separates out-of-credit from a broken login — opposite remedies", () => {
    expect(classifyOutcome({ task_state: "insufficient_credits" })).toBe(
      "insufficient_credits",
    );
    expect(classifyOutcome({ task_state: "auth_required" })).toBe("auth_required");
  });

  it("stops sending for both of those", () => {
    expect(shouldHalt("insufficient_credits")).toBe(true);
    expect(shouldHalt("auth_required")).toBe(true);
    expect(shouldHalt("working")).toBe(false);
  });

  it("fails the row only on access_denied", () => {
    expect(isTerminalFailure("access_denied")).toBe(true);
    expect(isTerminalFailure("unknown")).toBe(false);
    expect(isTerminalFailure("working")).toBe(false);
  });

  it("falls back to unknown, which the sweeper chases rather than retries", () => {
    expect(classifyOutcome({ task_state: "something_new" })).toBe("unknown");
    expect(classifyOutcome({})).toBe("unknown");
  });

  it("prefers the problem when a result carries both", () => {
    expect(classifyOutcome({ event: "complete", task_state: "auth_required" })).toBe(
      "auth_required",
    );
  });

  it("only writes an alert for the outcomes a person must act on", () => {
    expect(outcomeAlert("insufficient_credits", "serif", "r1")).toMatch(/out of credit/i);
    expect(outcomeAlert("auth_required", "serif", "r1")).toMatch(/login/i);
    expect(outcomeAlert("complete", "serif", "r1")).toBeNull();
    expect(outcomeAlert("working", "serif", "r1")).toBeNull();
  });
});
