import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../tests/smoke/helpers";
import { BigQueryClient } from "../../bigquery/client";
import { DncService } from "../service";
import { assertNotSuppressed, DncBlockedError } from "../guard";

const OPTS = { tenantId: "bma" };

function makeSvc() {
  return new DncService({ bq: new BigQueryClient("test-project", null, null) });
}

describe("DncService.check", () => {
  it("blocks on an exact email match", async () => {
    queueBqRows([
      {
        id: "c1",
        email: "jane@acme.com",
        company_domain: "acme.com",
        dnc_reason: "client request",
        dnc_added_at: { value: "2026-07-01T00:00:00Z" },
      },
    ]);
    const decision = await makeSvc().check({ email: "Jane@Acme.com" }, OPTS);
    expect(decision.suppressed).toBe(true);
    expect(decision.matches[0].matchedOn).toBe("email");
    expect(decision.reason).toBe("client request");

    const last = getMockState().bq.queries.at(-1);
    // Email is normalized lowercase in the params.
    expect(last.params.email).toBe("jane@acme.com");
  });

  it("derives and matches the domain from an email (domain-level block)", async () => {
    queueBqRows([
      {
        id: "d1",
        email: null,
        company_domain: "acme.com",
        dnc_reason: "whole company opted out",
        dnc_added_at: { value: "2026-07-02T00:00:00Z" },
      },
    ]);
    const decision = await makeSvc().check({ email: "someone@acme.com" }, OPTS);
    expect(decision.suppressed).toBe(true);
    expect(decision.matches[0].matchedOn).toBe("domain");

    const last = getMockState().bq.queries.at(-1);
    // The derived domain is passed as a param so the SQL can match it.
    expect(last.params.domain).toBe("acme.com");
  });

  it("allows when there is no match (empty rows)", async () => {
    queueBqRows([]);
    const decision = await makeSvc().check(
      { email: "nobody@nowhere.com" },
      OPTS,
    );
    expect(decision.suppressed).toBe(false);
    expect(decision.matches).toHaveLength(0);
  });

  it("allows on empty input without querying", async () => {
    const before = getMockState().bq.queries.length;
    const decision = await makeSvc().check({}, OPTS);
    expect(decision.suppressed).toBe(false);
    expect(getMockState().bq.queries.length).toBe(before);
  });
});

describe("DncService.suppress", () => {
  it("issues a MERGE with is_dnc = TRUE and the reason param", async () => {
    queueBqRows([]);
    const result = await makeSvc().suppress(
      { email: "block@acme.com", reason: "client request" },
      OPTS,
    );
    expect(result.suppressed).toBe(true);
    expect(result.id).toBeTruthy();

    const write = getMockState().bq.writes[0];
    expect(write.sql).toContain("MERGE");
    expect(write.sql).toContain("is_dnc");
    expect(write.params.reason).toBe("client request");
    expect(write.params.email).toBe("block@acme.com");
  });

  it("encodes expiresAt into the reason", async () => {
    queueBqRows([]);
    await makeSvc().suppress(
      {
        email: "temp@acme.com",
        reason: "trial block",
        expiresAt: "2026-12-31T00:00:00Z",
      },
      OPTS,
    );
    const write = getMockState().bq.writes[0];
    expect(write.params.reason).toContain("[expires:2026-12-31T00:00:00Z]");
  });

  it("inserts a domain-level row when only a domain is given", async () => {
    queueBqRows([]);
    await makeSvc().suppress(
      { domain: "Acme.com", reason: "company opted out" },
      OPTS,
    );
    const write = getMockState().bq.writes[0];
    expect(write.sql).toContain("INSERT INTO");
    expect(write.params.domain).toBe("acme.com");
  });
});

describe("assertNotSuppressed guard", () => {
  it("fails open (no throw) when enforcement is disabled", async () => {
    const prev = process.env.DNC_ENFORCEMENT_ENABLED;
    process.env.DNC_ENFORCEMENT_ENABLED = "false";
    try {
      // Even if a match would be found, the disabled flag short-circuits before any query.
      await expect(
        assertNotSuppressed({ email: "blocked@acme.com" }, OPTS),
      ).resolves.toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.DNC_ENFORCEMENT_ENABLED;
      else process.env.DNC_ENFORCEMENT_ENABLED = prev;
    }
  });

  it("throws DncBlockedError when a match is found", async () => {
    const prev = process.env.DNC_ENFORCEMENT_ENABLED;
    delete process.env.DNC_ENFORCEMENT_ENABLED; // default = enabled
    queueBqRows([
      {
        id: "c9",
        email: "stop@acme.com",
        company_domain: "acme.com",
        dnc_reason: "hard opt out",
        dnc_added_at: { value: "2026-07-03T00:00:00Z" },
      },
    ]);
    try {
      await expect(
        assertNotSuppressed({ email: "stop@acme.com" }, OPTS),
      ).rejects.toBeInstanceOf(DncBlockedError);
    } finally {
      if (prev !== undefined) process.env.DNC_ENFORCEMENT_ENABLED = prev;
    }
  });
});
