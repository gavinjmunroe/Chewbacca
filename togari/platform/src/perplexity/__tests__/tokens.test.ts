import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { onFetch, getMockState } from "../../../tests/smoke/helpers";
import {
  needsRefresh,
  getPerplexityAccessToken,
  getAccessTokenForClient,
  isPerplexityHalted,
  clearPerplexityHalt,
  perplexityHaltReason,
} from "../tokens";
import { perplexityAccountForClient } from "../config";
import type { StoredTokens } from "../oauth";
import * as oauth from "../oauth";

const HOUR = 3600_000;

function tokens(overrides: Partial<StoredTokens> = {}): StoredTokens {
  const now = Date.now();
  return {
    access_token: "at-live",
    refresh_token: "rt-live",
    issued_at: now,
    expires_at: now + HOUR,
    ...overrides,
  };
}

describe("needsRefresh — the 20% window", () => {
  it("leaves a fresh token alone", () => {
    expect(needsRefresh(tokens())).toBe(false);
  });

  it("renews inside the last 20% of the lifetime, before anything fails", () => {
    const now = Date.now();
    // 10 minutes left on a 60 minute token = 16%.
    expect(
      needsRefresh({ ...tokens(), issued_at: now - 50 * 60_000, expires_at: now + 10 * 60_000 }),
    ).toBe(true);
  });

  it("does not renew at 25% remaining — the window is 20%, not 'soon'", () => {
    const now = Date.now();
    expect(
      needsRefresh({ ...tokens(), issued_at: now - 45 * 60_000, expires_at: now + 15 * 60_000 }),
    ).toBe(false);
  });

  it("treats an already-expired token as needing refresh", () => {
    const now = Date.now();
    expect(
      needsRefresh({ ...tokens(), issued_at: now - 2 * HOUR, expires_at: now - HOUR }),
    ).toBe(true);
  });
});

describe("getPerplexityAccessToken", () => {
  beforeEach(() => {
    clearPerplexityHalt();
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.PERPLEXITY_ALERT_SLACK_CHANNEL = "C0C14UKEEUR";
    onFetch("chat.postMessage", { ok: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearPerplexityHalt();
  });

  it("returns the stored token without a network call when it is fresh", async () => {
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(tokens());
    const refresh = vi.spyOn(oauth, "refreshTokens");

    expect(await getPerplexityAccessToken("serif")).toBe("at-live");
    expect(refresh).not.toHaveBeenCalled();
  });

  // Plan's check one: expires_at in the past, next call renews and works.
  it("renews an expired token and returns the new one", async () => {
    const now = Date.now();
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(
      tokens({ issued_at: now - 2 * HOUR, expires_at: now - HOUR }),
    );
    vi.spyOn(oauth, "refreshTokens").mockResolvedValue(
      tokens({ access_token: "at-renewed" }),
    );

    expect(await getPerplexityAccessToken("serif")).toBe("at-renewed");
    expect(isPerplexityHalted("serif")).toBe(false);
  });

  // Plan's check two: corrupt the refresh token, get an alert, everything stops.
  it("halts and alerts when renewing fails, instead of carrying on", async () => {
    const now = Date.now();
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(
      tokens({ refresh_token: "rt-corrupt", issued_at: now - 2 * HOUR, expires_at: now - HOUR }),
    );
    vi.spyOn(oauth, "refreshTokens").mockRejectedValue(
      new Error("Perplexity token endpoint 400: invalid_grant"),
    );

    await expect(getPerplexityAccessToken("serif")).rejects.toThrow(/refresh failed|invalid_grant/i);

    expect(isPerplexityHalted("serif")).toBe(true);
    expect(perplexityHaltReason("serif")).toMatch(/invalid_grant/);

    const alerts = getMockState().fetch.calls.filter((c: any) =>
      String(c.url).includes("chat.postMessage"),
    );
    expect(alerts).toHaveLength(1);
    expect(JSON.parse(alerts[0].init.body).text).toMatch(/login is broken/i);
  });

  it("refuses every later call once halted, without hitting the network", async () => {
    const now = Date.now();
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(
      tokens({ issued_at: now - 2 * HOUR, expires_at: now - HOUR }),
    );
    const refresh = vi
      .spyOn(oauth, "refreshTokens")
      .mockRejectedValue(new Error("invalid_grant"));

    await expect(getPerplexityAccessToken("serif")).rejects.toThrow();
    refresh.mockClear();

    await expect(getPerplexityAccessToken("serif")).rejects.toThrow(/halted/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("halts when nobody has done the browser sign-in yet", async () => {
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(null);
    await expect(getPerplexityAccessToken("serif")).rejects.toThrow(/not signed in/i);
    expect(isPerplexityHalted("serif")).toBe(true);
  });
});


describe("per-client accounts", () => {
  beforeEach(() => {
    clearPerplexityHalt();
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.PERPLEXITY_ALERT_SLACK_CHANNEL = "C0C14UKEEUR";
    onFetch("chat.postMessage", { ok: true });
    delete process.env.PERPLEXITY_ACCOUNT_SERIF;
    delete process.env.PERPLEXITY_ACCOUNT_NEWCLIENT;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearPerplexityHalt();
    delete process.env.PERPLEXITY_ACCOUNT_SERIF;
  });

  it("puts Serif on Serif's account, not ours", () => {
    expect(perplexityAccountForClient("serif")).toBe("serif");
  });

  it("bills the test client to the same account, so one sign-in covers both", () => {
    expect(perplexityAccountForClient("serif_test")).toBe("serif");
  });

  it("gives an unknown client its own account rather than sharing one", () => {
    expect(perplexityAccountForClient("newclient")).toBe("newclient");
  });

  it("lets an env var repoint a client — the step 14 swap, with no deploy", () => {
    process.env.PERPLEXITY_ACCOUNT_SERIF = "bma";
    expect(perplexityAccountForClient("serif")).toBe("bma");
  });

  // The whole point of a per-account halt.
  it("does not stop other clients when one client's login breaks", async () => {
    const now = Date.now();
    vi.spyOn(oauth, "loadTokens").mockImplementation(async (account: string) =>
      account === "serif"
        ? tokens({ issued_at: now - 2 * HOUR, expires_at: now - HOUR })
        : tokens({ access_token: "at-bma" }),
    );
    vi.spyOn(oauth, "refreshTokens").mockRejectedValue(new Error("invalid_grant"));

    await expect(getPerplexityAccessToken("serif")).rejects.toThrow();
    expect(isPerplexityHalted("serif")).toBe(true);

    // BMA is untouched and still works.
    expect(isPerplexityHalted("bma")).toBe(false);
    expect(await getPerplexityAccessToken("bma")).toBe("at-bma");
  });

  it("reports which account did the work, for reply_items.pplx_account", async () => {
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(tokens());
    const result = await getAccessTokenForClient("serif_test");
    expect(result).toEqual({ account: "serif", accessToken: "at-live" });
  });
});

describe("redirect URI", () => {
  it("is loopback — Perplexity rejects a hosted https callback at authorize", async () => {
    const { perplexityRedirectUri } = await import("../config");
    expect(perplexityRedirectUri()).toMatch(/^http:\/\/localhost:\d+\/callback$/);
  });

  it("honours PERPLEXITY_OAUTH_PORT when the default port is taken", async () => {
    const prev = process.env.PERPLEXITY_OAUTH_PORT;
    process.env.PERPLEXITY_OAUTH_PORT = "9123";
    const { perplexityRedirectUri } = await import("../config");
    expect(perplexityRedirectUri()).toBe("http://localhost:9123/callback");
    if (prev === undefined) delete process.env.PERPLEXITY_OAUTH_PORT;
    else process.env.PERPLEXITY_OAUTH_PORT = prev;
  });
});

describe("when Perplexity issues no refresh token", () => {
  beforeEach(() => {
    clearPerplexityHalt();
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.PERPLEXITY_ALERT_SLACK_CHANNEL = "C0C14UKEEUR";
    onFetch("chat.postMessage", { ok: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearPerplexityHalt();
  });

  it("still serves the access token while it is valid", async () => {
    const { refresh_token, ...noRefresh } = tokens();
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(noRefresh as any);
    expect(await getPerplexityAccessToken("serif")).toBe("at-live");
    expect(isPerplexityHalted("serif")).toBe(false);
  });

  it("halts with a re-run instruction once it expires, without looping", async () => {
    const now = Date.now();
    const { refresh_token, ...noRefresh } = tokens({
      issued_at: now - 2 * HOUR,
      expires_at: now - HOUR,
    });
    vi.spyOn(oauth, "loadTokens").mockResolvedValue(noRefresh as any);
    const refresh = vi.spyOn(oauth, "refreshTokens");

    await expect(getPerplexityAccessToken("serif")).rejects.toThrow(/manual sign-in/i);

    // Never attempts a renewal it has nothing to renew with.
    expect(refresh).not.toHaveBeenCalled();
    expect(perplexityHaltReason("serif")).toMatch(/perplexity-signin/);
  });
});
