/**
 * Unit tests for the retry + circuit-breaker helpers.
 *
 * Lives under worker/__tests__/ rather than lib/__tests__/ so the worker
 * harness owns its own coverage; other modules can add sibling tests
 * without churning this directory.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GATEWAY_ERROR_MARKERS,
  isGatewayOverloadError,
  resetCircuitBreaker,
  withRetry,
  withRetryAndCircuitBreaker,
  withRetrySilent,
} from "../../lib/retry";

describe("withRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the result on the first successful attempt", async () => {
    const fn = vi.fn(async () => 42);
    const result = await withRetry(fn, { maxRetries: 3, logRetries: false });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient errors and eventually succeeds", async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt < 3) {
        throw new Error("ECONNRESET while talking to upstream");
      }
      return "ok";
    });
    const result = await withRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
      logRetries: false,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new Error("bad request");
    });
    await expect(
      withRetry(fn, { maxRetries: 3, logRetries: false }),
    ).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetrySilent", () => {
  it("swallows failures and reports via onFailure", async () => {
    const onFailure = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await withRetrySilent(fn, {
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 2,
      logRetries: false,
      onFailure,
    });
    expect(result).toBeUndefined();
    expect(onFailure).toHaveBeenCalledOnce();
  });
});

describe("withRetryAndCircuitBreaker", () => {
  afterEach(() => {
    resetCircuitBreaker("test-bq");
  });

  it("opens the circuit after the threshold of consecutive failures", async () => {
    let calls = 0;
    const failing = vi.fn(async () => {
      calls++;
      throw new Error("503 service unavailable");
    });

    // failureThreshold=2, no per-call retries so each invocation hits once.
    for (let i = 0; i < 2; i++) {
      await expect(
        withRetryAndCircuitBreaker(failing, {
          circuitName: "test-bq",
          failureThreshold: 2,
          cooldownMs: 60_000,
          maxRetries: 0,
          baseDelayMs: 1,
          maxDelayMs: 2,
          logRetries: false,
        }),
      ).rejects.toThrow();
    }

    // Third call should be rejected by the open circuit before invoking fn.
    await expect(
      withRetryAndCircuitBreaker(failing, {
        circuitName: "test-bq",
        failureThreshold: 2,
        cooldownMs: 60_000,
        maxRetries: 0,
        baseDelayMs: 1,
        maxDelayMs: 2,
        logRetries: false,
      }),
    ).rejects.toThrow(/Circuit breaker test-bq is open/);

    expect(calls).toBe(2);
  });

  it("resets the circuit after a success", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("ETIMEDOUT");
      return "good";
    });

    const result = await withRetryAndCircuitBreaker(flaky, {
      circuitName: "test-bq",
      failureThreshold: 5,
      cooldownMs: 60_000,
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 2,
      logRetries: false,
    });
    expect(result).toBe("good");
  });
});

describe("isGatewayOverloadError", () => {
  it("flags 52x and HTML-body errors as gateway outages", () => {
    expect(isGatewayOverloadError(new Error("521 origin down"))).toBe(true);
    expect(isGatewayOverloadError("<!DOCTYPE html><body>...")).toBe(true);
    expect(isGatewayOverloadError(new Error("404 not found"))).toBe(false);
  });

  it("exposes a non-empty marker list", () => {
    expect(GATEWAY_ERROR_MARKERS.length).toBeGreaterThan(0);
  });
});
