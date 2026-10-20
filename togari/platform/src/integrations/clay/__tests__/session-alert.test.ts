import { describe, expect, it } from "vitest";
import { sessionExpiry } from "../campaign-read";
import { sessionAlert } from "../session-alert";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 24 * 3_600_000;

describe("sessionExpiry", () => {
  it("reads Expires on the claysession cookie only", () => {
    expect(
      sessionExpiry([
        "other=1; Expires=Wed, 01 Jan 2031 00:00:00 GMT",
        "claysession=abc; Path=/; Expires=Wed, 21 Oct 2026 10:00:00 GMT; HttpOnly",
      ])?.toISOString(),
    ).toBe("2026-10-21T10:00:00.000Z");
  });

  it("prefers Max-Age, and reads the __Host- form", () => {
    expect(
      sessionExpiry(
        [
          "__Host-claysession=abc; Max-Age=3600; Expires=Wed, 21 Oct 2026 10:00:00 GMT",
        ],
        NOW,
      )?.getTime(),
    ).toBe(NOW + 3_600_000);
  });

  it("is null with no dated claysession cookie", () => {
    expect(sessionExpiry(["claysession=abc; Path=/"])).toBeNull();
    expect(sessionExpiry([])).toBeNull();
  });
});

describe("sessionAlert", () => {
  it("says nothing when the session is fine or its date is unknown", () => {
    expect(
      sessionAlert("Zeutara", { signedOut: false, expiresAt: null }, NOW),
    ).toBeNull();
    expect(
      sessionAlert(
        "Zeutara",
        { signedOut: false, expiresAt: new Date(NOW + 4 * DAY) },
        NOW,
      ),
    ).toBeNull();
  });

  it("warns inside three days of expiry", () => {
    const a = sessionAlert(
      "Zeutara",
      { signedOut: false, expiresAt: new Date(NOW + 30 * 3_600_000) },
      NOW,
    );
    expect(a?.kind).toBe("expiring");
    expect(a?.text).toContain("in 30h");
    expect(a?.text).toContain("2026-10-16 18:00 UTC");
  });

  it("reports signed out when Clay refused it or the date has passed", () => {
    expect(
      sessionAlert("Zeutara", { signedOut: true, expiresAt: null }, NOW)?.kind,
    ).toBe("signed_out");
    expect(
      sessionAlert(
        "Zeutara",
        { signedOut: false, expiresAt: new Date(NOW - 1000) },
        NOW,
      )?.kind,
    ).toBe("signed_out");
  });
});
